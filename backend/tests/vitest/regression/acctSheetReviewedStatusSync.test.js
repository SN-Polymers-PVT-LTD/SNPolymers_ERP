import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');

// Migration 028 (narrowed by 037_terminal_hold_and_rejected.sql):
// acct_requisition_sheets.sheet_status is kept in sync with its own line
// items by a DB trigger (sync_acct_sheet_review_status), in both directions
// — Submitted -> Reviewed when the last Pending HO Review item clears (On
// Hold no longer blocks this — it's terminal now, not "still awaiting
// decision"), and back to Submitted if a Returned-for-Correction item is
// resubmitted. Reopen used to be the other path back to Submitted, but it's
// retired (037) along with every other in-place re-decision on an On
// Hold/Rejected item — re-import into a new sheet is the only way forward
// from either now. Driven by a trigger (not duplicated per RPC) so every
// path that can change requisition_status — single-item action, batch
// action, resubmit — stays correct without re-implementing the check.
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

  test('flips Reviewed -> Submitted when a Returned-for-Correction item is resubmitted', async () => {
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
      p_line_item_id: items[0].id, p_action: 'Return', p_actioned_by: ctx.ho1Mobile, p_ho_remarks: 'fix beneficiary'
    });
    // Returned for Correction was never counted as "still pending" here —
    // it's with Accounts, not HO — so the sheet already flips to Reviewed.
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');

    await supabase.rpc('resubmit_acct_line_item_transact', {
      p_line_item_id: items[0].id, p_resubmitted_by: ctx.accountsMobile,
      p_req_amount: 100, p_payment_mode: 'NEFT', p_debit_bank_ac_type: ctx.bankName
    });
    expect(await getSheetStatus(sheet.id)).toBe('Submitted');
  });

  test('On Hold no longer blocks Submitted -> Reviewed — it is terminal, not still-pending', async () => {
    const { data: sheet } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `SYNC-D-${ctx.id}`, sheet_status: 'Submitted',
      created_by: ctx.accountsMobile, submitted_by: ctx.accountsMobile, submitted_at: new Date().toISOString()
    }]).select().single();
    ctx.sheetIds.push(sheet.id);

    const { data: items } = await supabase.from('acct_requisition_line_items').insert([
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'E', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' }
    ]).select();
    ctx.itemIds.push(...items.map(i => i.id));

    await supabase.rpc('act_acct_line_item_non_approve_transact', {
      p_line_item_id: items[0].id, p_action: 'Hold', p_actioned_by: ctx.ho1Mobile, p_ho_remarks: 'need info'
    });
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');

    // And it stays terminal — no in-place path moves it off On Hold anymore.
    const reHold = await supabase.rpc('act_acct_line_item_non_approve_transact', {
      p_line_item_id: items[0].id, p_action: 'Hold', p_actioned_by: ctx.ho1Mobile, p_ho_remarks: 'still on hold'
    });
    expect(reHold.error?.code).toBe('STA01');
  });

  test('a sheet full of Pending Review + decided items still reaches Reviewed (041)', async () => {
    const { data: sheet } = await supabase.from('acct_requisition_sheets').insert([{
      sheet_number: `SYNC-F-${ctx.id}`, sheet_status: 'Submitted',
      created_by: ctx.accountsMobile, submitted_by: ctx.accountsMobile, submitted_at: new Date().toISOString()
    }]).select().single();
    ctx.sheetIds.push(sheet.id);

    const { data: items } = await supabase.from('acct_requisition_line_items').insert([
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'F1', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' },
      { sheet_id: sheet.id, created_by: ctx.accountsMobile, particulars: 'F2', req_amount: 100, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, requisition_status: 'Pending HO Review' }
    ]).select();
    ctx.itemIds.push(...items.map(i => i.id));

    // Decide one, leave the other still Pending HO Review.
    await supabase.rpc('approve_acct_line_item_transact', {
      p_line_item_id: items[0].id, p_ho_process: 'Approved', p_ho_pass_amount: null, p_actioned_by: ctx.ho1Mobile, p_ho_remarks: null
    });
    expect(await getSheetStatus(sheet.id)).toBe('Submitted');

    const { data: closed, error: closeErr } = await supabase.rpc('close_acct_sheet_review_transact', {
      p_sheet_id: sheet.id, p_closed_by: ctx.ho1Mobile
    });
    expect(closeErr).toBeNull();
    expect(closed.sheet_status).toBe('Reviewed');
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');

    const { data: sweptItem } = await supabase.from('acct_requisition_line_items').select('requisition_status').eq('id', items[1].id).single();
    expect(sweptItem.requisition_status).toBe('Pending Review');
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
