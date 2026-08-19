import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');

// Migration 028: acct_requisition_sheets.sheet_status is kept in sync with
// its own line items by a DB trigger (sync_acct_sheet_review_status), in
// both directions — Submitted -> Reviewed when the last Pending HO Review /
// On Hold item clears, and back to Submitted if a decided item is reopened.
// Driven by a trigger (not duplicated per RPC) so every path that can change
// requisition_status — single-item action, batch action, reopen, resubmit —
// stays correct without re-implementing the check each time.
describe('acct_requisition_sheets.sheet_status — auto-synced from line items', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
  });

  async function getSheetStatus(sheetId) {
    const { data } = await supabase.from('acct_requisition_sheets').select('sheet_status').eq('id', sheetId).single();
    return data.sheet_status;
  }

  test('flips Submitted -> Reviewed when the last actionable item on the sheet clears', async () => {
    const { data: sheet } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `SYNC-A-${ctx.id}`, sheet_status: 'Submitted',
      created_by: ctx.accountsMobile, submitted_by: ctx.accountsMobile, submitted_at: new Date().toISOString()
    }]).select().single();
    ctx.sheetIds.push(sheet.id);

    const { data: items } = await supabase.from('acct_requisition_line_items').insert([
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'A', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' },
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'B', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' }
    ]).select();
    ctx.itemIds.push(...items.map(i => i.id));

    expect(await getSheetStatus(sheet.id)).toBe('Submitted');

    await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: items[0].id, p_ho_process: 'Approved', p_ho_pass_amount: null, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    // One of two items still Pending HO Review — sheet must not flip yet.
    expect(await getSheetStatus(sheet.id)).toBe('Submitted');

    await supabase.rpc('act_acct_line_item_non_approve_transact', {
      p_line_item_id: items[1].id, p_action: 'Reject', p_actioned_by: ctx.ho1Mobile, p_ho_remarks: 'test'
    });
    // Last item cleared — sheet flips to Reviewed.
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');
  });

  test('flips Reviewed -> Submitted when a decided item is reopened', async () => {
    const { data: sheet } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `SYNC-B-${ctx.id}`, sheet_status: 'Submitted',
      created_by: ctx.accountsMobile, submitted_by: ctx.accountsMobile, submitted_at: new Date().toISOString()
    }]).select().single();
    ctx.sheetIds.push(sheet.id);

    const { data: items } = await supabase.from('acct_requisition_line_items').insert([
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'C', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' }
    ]).select();
    ctx.itemIds.push(...items.map(i => i.id));

    await supabase.rpc('act_acct_line_item_non_approve_transact', {
      p_line_item_id: items[0].id, p_action: 'Reject', p_actioned_by: ctx.ho1Mobile, p_ho_remarks: 'test'
    });
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');

    await supabase.rpc('reopen_acct_line_item_transact', {
      p_line_item_id: items[0].id, p_reopened_by: ctx.ho1Mobile, p_reopen_remark: 'new info received'
    });
    expect(await getSheetStatus(sheet.id)).toBe('Submitted');
  });

  test('the batch RPC path also flips Submitted -> Reviewed on the last item', async () => {
    const { data: sheet } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `SYNC-C-${ctx.id}`, sheet_status: 'Submitted',
      created_by: ctx.accountsMobile, submitted_by: ctx.accountsMobile, submitted_at: new Date().toISOString()
    }]).select().single();
    ctx.sheetIds.push(sheet.id);

    const { data: items } = await supabase.from('acct_requisition_line_items').insert([
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'D', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' }
    ]).select();
    ctx.itemIds.push(...items.map(i => i.id));

    await supabase.rpc('act_acct_line_items_batch_transact', {
      p_actions: [{ line_item_id: items[0].id, action: 'Approve', ho_pass_amount: null, ho_remarks: null }],
      p_actioned_by: ctx.ho1Mobile
    });

    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');
  });
});
