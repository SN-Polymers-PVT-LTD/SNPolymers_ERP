import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const { getCreditLedger } = require('../../../src/controllers/acctRequisition.controller');

// Regression coverage for 042_credit_purchases_and_ledger.sql: a dealer
// purchase made on credit (Debit Bank Type = 'Credit') gets a new all-or-
// nothing HO decision, 'Credit Approved', which creates a credit_ledger row
// instead of debiting any real bank. Every later installment against that
// ledger row is a normal cash line item (real bank, normal Approve/
// Partially Approve) that debits the ledger's remaining balance on
// approval, and the ledger stays repeatably importable — unlike the
// existing On Hold/Rejected/Pending Review queue's one-shot import — until
// its balance hits zero.
describe('Credit Purchases & the Credit Ledger', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();

    // credit_approve_acct_line_item_transact requires a bank_balance_master
    // row named 'Credit' (FK on debit_bank_ac_type) — seeded by migration
    // 042 itself (dynamic admin lookup, same convention as 026). Fail loudly
    // here rather than let every test below die on an opaque FK violation.
    const { data: creditBank } = await supabase
      .from('bank_balance_master')
      .select('bank_name, is_virtual')
      .eq('bank_name', 'Credit')
      .maybeSingle();
    if (!creditBank) {
      throw new Error(
        "bank_balance_master has no 'Credit' sentinel row — migration 042's seed was skipped " +
        '(no admin user existed in authorised_users at migration-apply time). Seed one and re-run migrations.'
      );
    }
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
  });

  // ── helpers ────────────────────────────────────────────────────────────

  const dealer = (n) => ({
    beneficiary_ac_no: `9${n}${ctx.id}`.padEnd(9, '0'),
    beneficiary_ifsc: `TEST0${String(n).padStart(6, '0')}`,
    beneficiary_name: `Dealer ${n} ${ctx.id}`,
    beneficiary_bank_name: 'HDFC Bank'
  });

  // A Submitted sheet with items inserted directly at 'Pending HO Review' —
  // same shortcut acctSheetReviewedStatusSync.test.js uses to test RPCs in
  // isolation without going through the full create/add/submit HTTP flow.
  async function makeSubmittedSheet(label) {
    const { data: sheet, error } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `CRED-${label}-${ctx.id}`, sheet_status: 'Submitted',
      created_by: ctx.accountsMobile, submitted_by: ctx.accountsMobile, submitted_at: new Date().toISOString()
    }]).select().single();
    if (error) throw error;
    ctx.sheetIds.push(sheet.id);
    return sheet;
  }

  async function makeOpenSheet(label) {
    const { data: sheet, error } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `CRED-${label}-${ctx.id}`, sheet_status: 'Open', created_by: ctx.accountsMobile
    }]).select().single();
    if (error) throw error;
    ctx.sheetIds.push(sheet.id);
    return sheet;
  }

  async function insertItem(sheetId, overrides) {
    const { data: item, error } = await supabase.from('acct_requisition_line_items').insert([{
      sheet_id: sheetId, created_by: ctx.accountsMobile, requisition_status: 'Pending HO Review',
      ...overrides
    }]).select().single();
    if (error) throw error;
    ctx.itemIds.push(item.id);
    return item;
  }

  async function getLedger(sourceLineItemId) {
    const { data } = await supabase.from('credit_ledger').select('*').eq('source_line_item_id', sourceLineItemId).single();
    return data;
  }

  // ── 1. original purchase entry ────────────────────────────────────────

  test('Credit Approved creates the ledger row with opening balance = req_amount', async () => {
    const sheet = await makeSubmittedSheet('A1');
    const item = await insertItem(sheet.id, {
      particulars: 'Bulk polymer purchase', req_amount: 20000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(1)
    });

    const { data: approved, error } = await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: item.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(error).toBeNull();
    expect(approved.requisition_status).toBe('Credit Approved');
    expect(approved.ho_process).toBe('Credit Approved');
    expect(Number(approved.ho_pass_amount)).toBe(20000);

    const ledger = await getLedger(item.id);
    expect(ledger).toBeTruthy();
    expect(Number(ledger.opening_balance)).toBe(20000);
    expect(Number(ledger.remaining_balance)).toBe(20000);
    expect(Number(ledger.paid_total)).toBe(0);
    expect(ledger.ledger_status).toBe('Open');
  });

  // ── 2 & 3. guards on credit_approve_acct_line_item_transact ─────────────

  test('VAL06: Credit Approved rejected when debit_bank_ac_type is a real bank', async () => {
    const sheet = await makeSubmittedSheet('A2');
    const item = await insertItem(sheet.id, {
      particulars: 'Not actually credit', req_amount: 5000,
      payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, ...dealer(2)
    });

    const { error } = await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: item.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(error?.code).toBe('VAL06');
  });

  test('VAL07: Credit Approved rejected when beneficiary fields are missing', async () => {
    const sheet = await makeSubmittedSheet('A3');
    const item = await insertItem(sheet.id, {
      particulars: 'Missing dealer details', req_amount: 5000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit'
    });

    const { error } = await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: item.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(error?.code).toBe('VAL07');
  });

  // ── 4. dealer auto-upsert, dedup across two purchases from the same dealer ─

  test('the same dealer across two purchases dedups to one beneficiary_master row', async () => {
    const sameDealer = dealer(4);
    const sheet = await makeSubmittedSheet('A4');
    const itemOne = await insertItem(sheet.id, {
      particulars: 'Purchase one', req_amount: 8000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...sameDealer
    });
    const itemTwo = await insertItem(sheet.id, {
      particulars: 'Purchase two', req_amount: 12000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...sameDealer
    });

    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: itemOne.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: itemTwo.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });

    const { data: beneficiaryRows } = await supabase
      .from('beneficiary_master')
      .select('id, is_credit_dealer')
      .eq('account_number', sameDealer.beneficiary_ac_no)
      .eq('ifsc', sameDealer.beneficiary_ifsc);
    expect(beneficiaryRows.length).toBe(1);
    expect(beneficiaryRows[0].is_credit_dealer).toBe(true);

    const ledgerOne = await getLedger(itemOne.id);
    const ledgerTwo = await getLedger(itemTwo.id);
    expect(ledgerOne.beneficiary_id).toBe(beneficiaryRows[0].id);
    expect(ledgerTwo.beneficiary_id).toBe(beneficiaryRows[0].id);
  });

  // ── 5. approve_acct_line_item_transact must reject a Credit-type item ────

  test('VAL09: Approve is rejected on a Credit-type item — must use Credit Approved', async () => {
    const sheet = await makeSubmittedSheet('A5');
    const item = await insertItem(sheet.id, {
      particulars: 'Wrong action attempted', req_amount: 5000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(5)
    });

    const { error } = await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: item.id, p_ho_process: 'Approved', p_ho_pass_amount: null,
      p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(error?.code).toBe('VAL09');
  });

  // ── 6, 7 & 8. installment import — repeatable, prefilled, gated on Open ──

  test('import_credit_installment_transact creates an installment prefilled from the purchase, and is repeatable', async () => {
    const sheet = await makeSubmittedSheet('A6');
    const purchase = await insertItem(sheet.id, {
      particulars: 'Repeatable purchase', account_sub_title_text: 'Cement', req_amount: 15000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(6)
    });
    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: purchase.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    const ledger = await getLedger(purchase.id);

    const targetSheetOne = await makeOpenSheet('A6T1');
    const { data: installmentOne, error: errOne } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheetOne.id, p_imported_by: ctx.accountsMobile
    });
    expect(errOne).toBeNull();
    ctx.itemIds.push(installmentOne.id);
    expect(installmentOne.credit_ledger_id).toBe(ledger.id);
    expect(installmentOne.beneficiary_name).toBe(dealer(6).beneficiary_name);
    // Particulars/Account Sub-title are copied from the original purchase
    // (043_credit_installment_copies_particulars.sql) — only amount, debit
    // bank, and payment mode are left blank since those vary per installment.
    expect(installmentOne.particulars).toBe('Repeatable purchase');
    expect(installmentOne.account_sub_title_text).toBe('Cement');
    expect(installmentOne.req_amount).toBeNull();
    expect(installmentOne.debit_bank_ac_type).toBeNull();
    expect(installmentOne.payment_mode).toBeNull();

    // Repeatable: importing the same still-Open ledger entry again (before
    // either installment is approved/settled) succeeds — no one-shot
    // "already imported" restriction, unlike import_acct_line_item_transact.
    const targetSheetTwo = await makeOpenSheet('A6T2');
    const { data: installmentTwo, error: errTwo } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheetTwo.id, p_imported_by: ctx.accountsMobile
    });
    expect(errTwo).toBeNull();
    ctx.itemIds.push(installmentTwo.id);
    expect(installmentTwo.id).not.toBe(installmentOne.id);
  });

  // ── 9 & 10. installment approval debits the ledger; final one settles it ─

  test('approving installments debits the ledger and settles it at zero remaining', async () => {
    const sheet = await makeSubmittedSheet('A9');
    const purchase = await insertItem(sheet.id, {
      particulars: 'Two-installment purchase', req_amount: 10000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(9)
    });
    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: purchase.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    const ledger = await getLedger(purchase.id);

    const { data: bankBefore } = await supabase.from('bank_balance_master').select('available_balance').eq('bank_name', ctx.bankName).single();

    // First installment: partial, less than the remaining balance.
    const targetSheet1 = await makeOpenSheet('A9T1');
    const { data: installment1 } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheet1.id, p_imported_by: ctx.accountsMobile
    });
    ctx.itemIds.push(installment1.id);
    await supabase.from('acct_requisition_line_items').update({
      req_amount: 4000, debit_bank_ac_type: ctx.bankName, payment_mode: 'NEFT'
    }).eq('id', installment1.id);

    const { data: approved1, error: approveErr1 } = await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: installment1.id, p_ho_process: 'Approved', p_ho_pass_amount: null,
      p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(approveErr1).toBeNull();
    expect(approved1.requisition_status).toBe('Approved');

    let ledgerAfter1 = await getLedger(purchase.id);
    expect(Number(ledgerAfter1.paid_total)).toBe(4000);
    expect(Number(ledgerAfter1.remaining_balance)).toBe(6000);
    expect(ledgerAfter1.ledger_status).toBe('Open');

    const { data: bankAfter1 } = await supabase.from('bank_balance_master').select('available_balance').eq('bank_name', ctx.bankName).single();
    expect(Number(bankAfter1.available_balance)).toBe(Number(bankBefore.available_balance) - 4000);

    // Second installment: exactly the remaining balance — settles the ledger.
    const targetSheet2 = await makeOpenSheet('A9T2');
    const { data: installment2 } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheet2.id, p_imported_by: ctx.accountsMobile
    });
    ctx.itemIds.push(installment2.id);
    await supabase.from('acct_requisition_line_items').update({
      req_amount: 6000, debit_bank_ac_type: ctx.bankName, payment_mode: 'NEFT'
    }).eq('id', installment2.id);

    const { error: approveErr2 } = await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: installment2.id, p_ho_process: 'Approved', p_ho_pass_amount: null,
      p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(approveErr2).toBeNull();

    const ledgerFinal = await getLedger(purchase.id);
    expect(Number(ledgerFinal.remaining_balance)).toBe(0);
    expect(ledgerFinal.ledger_status).toBe('Settled');
    expect(ledgerFinal.settled_at).toBeTruthy();
  });

  // ── 7 (continued). STA09 — import against a Settled ledger entry ────────

  test('STA09: importing against a Settled ledger entry is rejected', async () => {
    const sheet = await makeSubmittedSheet('A7');
    const purchase = await insertItem(sheet.id, {
      particulars: 'Single-shot settle', req_amount: 3000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(7)
    });
    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: purchase.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    const ledger = await getLedger(purchase.id);

    const targetSheet = await makeOpenSheet('A7T1');
    const { data: installment } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheet.id, p_imported_by: ctx.accountsMobile
    });
    ctx.itemIds.push(installment.id);
    await supabase.from('acct_requisition_line_items').update({
      req_amount: 3000, debit_bank_ac_type: ctx.bankName, payment_mode: 'NEFT'
    }).eq('id', installment.id);
    await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: installment.id, p_ho_process: 'Approved', p_ho_pass_amount: null,
      p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });

    const settledLedger = await getLedger(purchase.id);
    expect(settledLedger.ledger_status).toBe('Settled');

    const anotherTargetSheet = await makeOpenSheet('A7T2');
    const { error } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: anotherTargetSheet.id, p_imported_by: ctx.accountsMobile
    });
    expect(error?.code).toBe('STA09');
  });

  // ── 11. VAL10 — installment amount exceeds remaining ledger balance ─────

  test('VAL10: approving an installment for more than the remaining balance is rejected', async () => {
    const sheet = await makeSubmittedSheet('A11');
    const purchase = await insertItem(sheet.id, {
      particulars: 'Overpay attempt', req_amount: 5000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(11)
    });
    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: purchase.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    const ledger = await getLedger(purchase.id);

    const targetSheet = await makeOpenSheet('A11T1');
    const { data: installment } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheet.id, p_imported_by: ctx.accountsMobile
    });
    ctx.itemIds.push(installment.id);
    // 6000 > the ledger's 5000 remaining balance.
    await supabase.from('acct_requisition_line_items').update({
      req_amount: 6000, debit_bank_ac_type: ctx.bankName, payment_mode: 'NEFT'
    }).eq('id', installment.id);

    const { error } = await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: installment.id, p_ho_process: 'Approved', p_ho_pass_amount: null,
      p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(error?.code).toBe('VAL10');
  });

  // ── 12. queue exclusion via the getCreditLedger controller ─────────────

  test('a Settled entry disappears from the Open list and appears under Settled', async () => {
    const sheet = await makeSubmittedSheet('A12');
    const purchase = await insertItem(sheet.id, {
      particulars: 'Queue exclusion check', req_amount: 2500,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(12)
    });
    await supabase.rpc('credit_approve_acct_line_item_transact', {
      p_line_item_id: purchase.id, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    const ledger = await getLedger(purchase.id);

    const targetSheet = await makeOpenSheet('A12T1');
    const { data: installment } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledger.id, p_target_sheet_id: targetSheet.id, p_imported_by: ctx.accountsMobile
    });
    ctx.itemIds.push(installment.id);
    await supabase.from('acct_requisition_line_items').update({
      req_amount: 2500, debit_bank_ac_type: ctx.bankName, payment_mode: 'NEFT'
    }).eq('id', installment.id);
    await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: installment.id, p_ho_process: 'Approved', p_ho_pass_amount: null,
      p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });

    const openRes = mockRes();
    await getCreditLedger({ query: { status: 'Open', limit: 100 }, user: { role: 'ho', mobile_number: ctx.ho1Mobile } }, openRes);
    expect(openRes.jsonData.entries.some((e) => e.id === ledger.id)).toBe(false);

    const settledRes = mockRes();
    await getCreditLedger({ query: { status: 'Settled', limit: 100 }, user: { role: 'ho', mobile_number: ctx.ho1Mobile } }, settledRes);
    expect(settledRes.jsonData.entries.some((e) => e.id === ledger.id)).toBe(true);
  });

  // ── 13. batch dispatch — CreditApprove alongside Approve/Hold ───────────

  test('act_acct_line_items_batch_transact dispatches CreditApprove correctly', async () => {
    const sheet = await makeSubmittedSheet('A13');
    const creditItem = await insertItem(sheet.id, {
      particulars: 'Batch credit item', req_amount: 4000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(13)
    });
    const cashItem = await insertItem(sheet.id, {
      particulars: 'Batch cash item', req_amount: 1000,
      payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const holdItem = await insertItem(sheet.id, {
      particulars: 'Batch hold item', req_amount: 500,
      payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });

    const { data: results, error } = await supabase.rpc('act_acct_line_items_batch_transact', {
      p_actions: [
        { line_item_id: creditItem.id, action: 'CreditApprove', ho_pass_amount: null, ho_remarks: null },
        { line_item_id: cashItem.id, action: 'Approve', ho_pass_amount: null, ho_remarks: null },
        { line_item_id: holdItem.id, action: 'Hold', ho_pass_amount: null, ho_remarks: 'need paperwork' }
      ],
      p_actioned_by: ctx.ho1Mobile
    });
    expect(error).toBeNull();

    const byId = Object.fromEntries(results.map((r) => [r.line_item_id, r]));
    expect(byId[creditItem.id].success).toBe(true);
    expect(byId[creditItem.id].item.requisition_status).toBe('Credit Approved');
    expect(byId[cashItem.id].success).toBe(true);
    expect(byId[cashItem.id].item.requisition_status).toBe('Approved');
    expect(byId[holdItem.id].success).toBe(true);
    expect(byId[holdItem.id].item.requisition_status).toBe('On Hold');

    expect(await getLedger(creditItem.id)).toBeTruthy();
  });

  // ── 14. submit-time guard for Credit payment_mode ───────────────────────

  test('VAL02: submitting a sheet with a Credit item missing beneficiary fields is blocked', async () => {
    const sheet = await makeOpenSheet('A14');
    await insertItem(sheet.id, {
      particulars: 'Missing dealer at submit time', req_amount: 3000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', requisition_status: null
    });

    const { error } = await supabase.rpc('submit_acct_sheet_transact', {
      p_sheet_id: sheet.id, p_submitted_by: ctx.accountsMobile
    });
    expect(error?.code).toBe('VAL02');
  });

  // ── 15. Reject still works unmodified on a Credit-type item ─────────────

  test('Reject succeeds unmodified on a Credit-type item and creates no ledger row', async () => {
    const sheet = await makeSubmittedSheet('A15');
    const item = await insertItem(sheet.id, {
      particulars: 'Credit purchase rejected outright', req_amount: 9000,
      payment_mode: 'Credit', debit_bank_ac_type: 'Credit', ...dealer(15)
    });

    const { data: rejected, error } = await supabase.rpc('act_acct_line_item_non_approve_transact', {
      p_line_item_id: item.id, p_action: 'Reject', p_actioned_by: ctx.ho1Mobile, p_ho_remarks: 'declined'
    });
    expect(error).toBeNull();
    expect(rejected.requisition_status).toBe('Rejected');

    const ledger = await getLedger(item.id);
    expect(ledger).toBeFalsy();
  });
});
