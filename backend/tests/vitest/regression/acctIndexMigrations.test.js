import { describe, test, expect } from 'vitest';
const {
  fetchExtensions,
  fetchExistingIndexNames,
  fetchIndexes,
  explainPlan,
  planUsesIndex
} = require('../../../scripts/lib/manifest-queries');

// Coverage for migrations 031 (line-item filter indexes) and 032 (accounts
// master index cleanup). These migrations only change index definitions, not
// application behavior, so the functional lifecycle/filter suites passing
// doesn't prove anything about the indexes themselves — Postgres returns
// identical rows with or without them, just slower. This file asserts the
// indexes' own claims directly: that they exist with the right definition,
// that the indexes 031/032 intentionally dropped are actually gone, and
// (via EXPLAIN with enable_seqscan off — see manifest-queries.explainPlan)
// that each index is actually usable by the planner for the query shape it
// was built for, not just present and unused.
describe('acctIndexMigrations — 031/032 index coverage', () => {
  test('pg_trgm extension is installed (required by the trigram GIN indexes)', async () => {
    const installed = await fetchExtensions(['pg_trgm']);
    expect(installed).toContain('pg_trgm');
  });

  test('031: new acct_requisition_line_items indexes exist with expected definitions', async () => {
    const indexes = await fetchIndexes([
      'idx_arli_created_at',
      'idx_arli_sub_title_trgm',
      'idx_arli_beneficiary_ac_no_trgm',
      'idx_arli_debit_bank_ac_type'
    ]);

    expect(indexes.idx_arli_created_at.table).toBe('acct_requisition_line_items');
    expect(indexes.idx_arli_created_at.definition).toMatch(/USING btree \(created_at\)/);

    expect(indexes.idx_arli_sub_title_trgm.table).toBe('acct_requisition_line_items');
    expect(indexes.idx_arli_sub_title_trgm.definition).toMatch(/USING gin \(account_sub_title_text gin_trgm_ops\)/);

    expect(indexes.idx_arli_beneficiary_ac_no_trgm.table).toBe('acct_requisition_line_items');
    expect(indexes.idx_arli_beneficiary_ac_no_trgm.definition).toMatch(/USING gin \(beneficiary_ac_no gin_trgm_ops\)/);

    expect(indexes.idx_arli_debit_bank_ac_type.table).toBe('acct_requisition_line_items');
    expect(indexes.idx_arli_debit_bank_ac_type.definition).toMatch(/USING btree \(debit_bank_ac_type\)/);

    // The narrower, pre-existing partial index for the balance-guardrail RPC
    // must survive both migrations untouched — it serves a different query.
    const guardrail = await fetchIndexes(['idx_arli_debit_bank_approved']);
    expect(guardrail.idx_arli_debit_bank_approved.table).toBe('acct_requisition_line_items');
  });

  test('032: beneficiary_master trigram indexes exist with expected definitions', async () => {
    const indexes = await fetchIndexes(['idx_bm_account_number_trgm', 'idx_bm_beneficiary_name_trgm']);

    expect(indexes.idx_bm_account_number_trgm.table).toBe('beneficiary_master');
    expect(indexes.idx_bm_account_number_trgm.definition).toMatch(/USING gin \(account_number gin_trgm_ops\)/);

    expect(indexes.idx_bm_beneficiary_name_trgm.table).toBe('beneficiary_master');
    expect(indexes.idx_bm_beneficiary_name_trgm.definition).toMatch(/USING gin \(beneficiary_name gin_trgm_ops\)/);
  });

  test('032: replacement sheet_status index exists, covering all three statuses plus created_at ordering', async () => {
    const indexes = await fetchIndexes(['idx_ars_sheet_status_created_at']);
    expect(indexes.idx_ars_sheet_status_created_at.table).toBe('acct_requisition_sheets');
    expect(indexes.idx_ars_sheet_status_created_at.definition).toMatch(
      /USING btree \(sheet_status, created_at DESC\)/
    );
  });

  test('032: the three superseded/dead indexes no longer exist', async () => {
    const stillPresent = await fetchExistingIndexNames([
      'idx_ars_sheet_status',   // replaced by idx_ars_sheet_status_created_at
      'idx_astm_title_lower',   // dropped — never queried server-side
      'idx_pm_title_lower'      // dropped — never queried server-side
    ]);
    expect(stillPresent).toEqual([]);
  });

  // ── Planner-usability checks ────────────────────────────────────────────
  // enable_seqscan=off (inside explainPlan) forces the planner to consider
  // the index path even on the near-empty test DB. If any of these fail, the
  // index exists but can't actually serve the query it was built for —
  // wrong column, wrong operator class, or the extension not backing it.

  test('date range filter on acct_requisition_line_items can use idx_arli_created_at', async () => {
    const plan = await explainPlan(
      `SELECT id FROM acct_requisition_line_items WHERE created_at >= $1 AND created_at <= $2`,
      ['2026-01-01', '2026-12-31T23:59:59.999']
    );
    expect(planUsesIndex(plan, 'idx_arli_created_at')).toBe(true);
  });

  test('account_sub_title_text ilike filter can use idx_arli_sub_title_trgm', async () => {
    const plan = await explainPlan(
      `SELECT id FROM acct_requisition_line_items WHERE account_sub_title_text ILIKE $1`,
      ['%Freight%']
    );
    expect(planUsesIndex(plan, 'idx_arli_sub_title_trgm')).toBe(true);
  });

  test('beneficiary_ac_no ilike filter on line items can use idx_arli_beneficiary_ac_no_trgm', async () => {
    const plan = await explainPlan(
      `SELECT id FROM acct_requisition_line_items WHERE beneficiary_ac_no ILIKE $1`,
      ['%1234%']
    );
    expect(planUsesIndex(plan, 'idx_arli_beneficiary_ac_no_trgm')).toBe(true);
  });

  test('debit_bank_ac_type equality filter can use idx_arli_debit_bank_ac_type', async () => {
    const plan = await explainPlan(
      `SELECT id FROM acct_requisition_line_items WHERE debit_bank_ac_type = $1`,
      ['CANARA SNP CA']
    );
    expect(planUsesIndex(plan, 'idx_arli_debit_bank_ac_type')).toBe(true);
  });

  test('getBeneficiaries-style OR ilike search can use both beneficiary_master trigram indexes', async () => {
    const plan = await explainPlan(
      `SELECT id FROM beneficiary_master WHERE account_number ILIKE $1 OR beneficiary_name ILIKE $1`,
      ['%test%']
    );
    expect(planUsesIndex(plan, 'idx_bm_account_number_trgm')).toBe(true);
    expect(planUsesIndex(plan, 'idx_bm_beneficiary_name_trgm')).toBe(true);
  });

  test('sheet_status filter + created_at ordering can use idx_ars_sheet_status_created_at', async () => {
    const plan = await explainPlan(
      `SELECT id FROM acct_requisition_sheets WHERE sheet_status = $1 ORDER BY created_at DESC`,
      ['Submitted']
    );
    expect(planUsesIndex(plan, 'idx_ars_sheet_status_created_at')).toBe(true);
  });
});
