import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const { supabase } = require('../../../src/db/supabase');
const { importLineItem } = require('../../../src/controllers/acctRequisition.controller');
const fundRequestsRouter = require('../../../src/routes/fundRequests.routes');

describe('Fund Request canonical Draft → Submit workflow', () => {
  let adminMobile = `990${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let zoMobile = `991${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let workOrder;
  let estimateNo;
  let bankId;
  const frIds = [];
  const sheetIds = [];

  async function insertDraft(amount) {
    const { data, error } = await supabase.from('fund_requests').insert({
      zo_user_id: zoMobile, zo_fr_no: `FR-${crypto.randomUUID()}`, zo_fr_amount: amount,
      zo_remarks: 'Draft test', work_order_no: workOrder, created_by: zoMobile,
      beneficiary_name: 'Draft Supplier', beneficiary_ac_no: `987${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId, beneficiary_bank_name: 'State Bank of India'
    }).select().single();
    if (error) throw error;
    frIds.push(data.fund_request_id);
    return data;
  }

  beforeAll(async () => {
    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true },
      { mobile_number: zoMobile, role: 'zo', is_active: true }
    ]);
    workOrder = `WO_DRAFT_${crypto.randomUUID().slice(0, 8)}`;
    estimateNo = `EST_DRAFT_${crypto.randomUUID().slice(0, 8)}`;
    await setupProject(workOrder, estimateNo, 500000, adminMobile);
    await supabase.from('projects_master').update({ zo_user_id: zoMobile }).eq('work_order_no', workOrder);
    const { data: bank, error: bankError } = await supabase.from('indian_bank_master').select('id').eq('bank_name', 'State Bank of India').eq('is_active', true).limit(1).maybeSingle();
    if (bankError || !bank) throw bankError || new Error('Test bank not found');
    bankId = bank.id;
    const { error: estimateError } = await supabase.from('project_cost_estimates').insert({
      work_order_no: workOrder, estimate_no: estimateNo, area_code: 'Test', estimate_revision: 0,
      zonal_office_no: 'TEST', estimate_amount: 100000, estimate_status: 'Final Approved',
      created_by: adminMobile, last_modified_by: adminMobile
    });
    if (estimateError) throw estimateError;
  });

  afterAll(async () => {
    if (sheetIds.length) await supabase.from('acct_requisition_sheets').delete().in('id', sheetIds);
    if (frIds.length) await supabase.from('fund_requests').delete().in('fund_request_id', frIds);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', workOrder);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile]);
  });

  test('new rows are Draft and have no capacity effect until submitted', async () => {
    const fr = await insertDraft(80000);
    expect(fr.request_status).toBe('Draft');
    const { data: before } = await supabase.from('fund_requests').select('request_status, zo_fr_amount').eq('work_order_no', workOrder);
    expect((before || []).filter(r => ['Pending', 'Hold', 'Approved'].includes(r.request_status))).toHaveLength(0);
  });

  test('submission reserves capacity and records submission metadata', async () => {
    const fr = await insertDraft(20000);
    const { data, error } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: fr.fund_request_id, p_submitted_by: zoMobile
    });
    expect(error).toBeNull();
    expect(data.request_status).toBe('Pending');
    expect(data.submitted_at).toBeTruthy();
    expect(data.submitted_by).toBe(zoMobile);
  });

  test('concurrent submissions cannot over-reserve the estimate', async () => {
    const a = await insertDraft(60000);
    const b = await insertDraft(60000);
    const results = await Promise.all([
      supabase.rpc('submit_fund_request_transact', { p_fund_request_id: a.fund_request_id, p_submitted_by: zoMobile }),
      supabase.rpc('submit_fund_request_transact', { p_fund_request_id: b.fund_request_id, p_submitted_by: zoMobile })
    ]);
    expect(results.filter(r => !r.error)).toHaveLength(1);
    expect(results.filter(r => r.error?.code === 'BUD02')).toHaveLength(1);
  });

  test('Draft cannot be imported into an Accounts sheet', async () => {
    const fr = await insertDraft(1000);
    const { data: sheet, error: sheetError } = await supabase.from('acct_requisition_sheets').insert({
      sheet_number: `SHEET_${crypto.randomUUID().slice(0, 8)}`, sheet_status: 'Open', created_by: adminMobile
    }).select().single();
    if (sheetError) throw sheetError;
    sheetIds.push(sheet.id);
    const res = mockRes();
    await importLineItem({ params: { itemId: fr.fund_request_id }, body: { target_sheet_id: sheet.id, item_type: 'FUND_REQUEST' }, user: { role: 'accounts', mobile_number: adminMobile } }, res);
    expect(res.statusCode).toBe(409);
  });

  test('legacy direct settlement RPC no longer exists', async () => {
    const { error } = await supabase.rpc('approve_fund_request_transact', {
      p_fund_request_id: crypto.randomUUID(), p_approved_amount: 1,
      p_transfer_from_account: 'CC', p_actioned_by: adminMobile, p_remarks: null
    });
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/approve_fund_request_transact.*(does not exist|schema cache)/i);
  });

  test('legacy direct-action route is not registered', () => {
    const legacyRoute = fundRequestsRouter.stack.find((layer) => layer.route?.path === '/:id/action');
    expect(legacyRoute).toBeUndefined();
  });
});
