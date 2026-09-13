import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const { supabase } = require('../../../src/db/supabase');
const { importLineItem } = require('../../../src/controllers/acctRequisition.controller');
const {
  createFundRequest,
  updateFundRequestDraft,
  submitFundRequest
} = require('../../../src/controllers/fundRequests.controller');
const fundRequestsRouter = require('../../../src/routes/fundRequests.routes');

describe('Fund Request canonical Draft → Submit workflow', () => {
  let adminMobile = `990${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let zoMobile = `991${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let otherZoMobile = `992${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let workOrder;
  let otherWorkOrder;
  let estimateNo;
  let otherEstimateNo;
  let bankId;
  const frIds = [];
  const sheetIds = [];
  const testBankIds = [];

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
      { mobile_number: zoMobile, role: 'zo', is_active: true },
      { mobile_number: otherZoMobile, role: 'zo', is_active: true }
    ]);
    workOrder = `WO_DRAFT_${crypto.randomUUID().slice(0, 8)}`;
    estimateNo = `EST_DRAFT_${crypto.randomUUID().slice(0, 8)}`;
    await setupProject(workOrder, estimateNo, 500000, adminMobile);
    await supabase.from('projects_master').update({ zo_user_id: zoMobile }).eq('work_order_no', workOrder);

    otherWorkOrder = `WO_OTHER_${crypto.randomUUID().slice(0, 8)}`;
    otherEstimateNo = `EST_OTHER_${crypto.randomUUID().slice(0, 8)}`;
    await setupProject(otherWorkOrder, otherEstimateNo, 500000, adminMobile);
    await supabase.from('projects_master').update({ zo_user_id: otherZoMobile }).eq('work_order_no', otherWorkOrder);

    const { data: bank, error: bankError } = await supabase.from('indian_bank_master').select('id').eq('bank_name', 'State Bank of India').eq('is_active', true).limit(1).maybeSingle();
    if (bankError || !bank) throw bankError || new Error('Test bank not found');
    bankId = bank.id;
    const { error: estimateError } = await supabase.from('project_cost_estimates').insert({
      work_order_no: workOrder, estimate_no: estimateNo, area_code: 'Test', estimate_revision: 0,
      zonal_office_no: 'TEST', estimate_amount: 100000, estimate_status: 'Final Approved',
      created_by: adminMobile, last_modified_by: adminMobile
    });
    if (estimateError) throw estimateError;

    const { error: otherEstimateError } = await supabase.from('project_cost_estimates').insert({
      work_order_no: otherWorkOrder, estimate_no: otherEstimateNo, area_code: 'Test', estimate_revision: 0,
      zonal_office_no: 'TEST', estimate_amount: 100000, estimate_status: 'Final Approved',
      created_by: adminMobile, last_modified_by: adminMobile
    });
    if (otherEstimateError) throw otherEstimateError;
  });

  afterAll(async () => {
    if (sheetIds.length) await supabase.from('acct_requisition_sheets').delete().in('id', sheetIds);
    if (frIds.length) await supabase.from('fund_requests').delete().in('fund_request_id', frIds);
    await supabase.from('project_cost_estimates').delete().in('work_order_no', [workOrder, otherWorkOrder]);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrder, otherWorkOrder]);
    if (testBankIds.length) await supabase.from('indian_bank_master').delete().in('id', testBankIds);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, otherZoMobile]);
  });

  test('new rows are Draft and have no capacity effect until submitted', async () => {
    const fr = await insertDraft(80000);
    expect(fr.request_status).toBe('Draft');
    const { data: before } = await supabase.from('fund_requests').select('request_status, zo_fr_amount').eq('work_order_no', workOrder);
    expect((before || []).filter(r => ['Pending', 'Hold', 'Approved'].includes(r.request_status))).toHaveLength(0);
  });

  test('submission reserves capacity, records submission metadata, and populates beneficiary_id', async () => {
    const fr = await insertDraft(20000);
    // Simulate a stale caller or older client having marked the Draft as
    // dismissed before submission. Draft -> Pending must restore queue
    // visibility atomically at the database boundary.
    const { error: staleDismissError } = await supabase
      .from('fund_requests')
      .update({ accounts_import_dismissed: true })
      .eq('fund_request_id', fr.fund_request_id);
    expect(staleDismissError).toBeNull();

    const { data, error } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: fr.fund_request_id, p_submitted_by: zoMobile
    });
    expect(error).toBeNull();
    expect(data.request_status).toBe('Pending');
    expect(data.submitted_at).toBeTruthy();
    expect(data.submitted_by).toBe(zoMobile);
    expect(data.beneficiary_id).toBeTruthy();
    expect(data.accounts_import_dismissed).toBe(false);

    const { data: pbmRow, error: pbmErr } = await supabase
      .from('projects_beneficiary_master')
      .select('*')
      .eq('id', data.beneficiary_id)
      .single();
    expect(pbmErr).toBeNull();
    expect(pbmRow).toBeTruthy();
    expect(pbmRow.beneficiary_ac_no).toBe(fr.beneficiary_ac_no);
    expect(pbmRow.beneficiary_ifsc).toBe(fr.beneficiary_ifsc);
    expect(pbmRow.beneficiary_name).toBe(fr.beneficiary_name);
    expect(pbmRow.beneficiary_bank_id).toBe(bankId);
  });

  test('7-argument submit_fund_request_transact overload does not exist', async () => {
    const { error } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: crypto.randomUUID(),
      p_submitted_by: zoMobile,
      p_beneficiary_name: 'Test Payee',
      p_beneficiary_ac_no: '123456789012',
      p_beneficiary_ifsc: 'SBIN0001234',
      p_beneficiary_bank_id: bankId,
      p_beneficiary_bank_name: 'State Bank of India'
    });
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/submit_fund_request_transact.*(does not exist|schema cache|parameter)/i);
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

  test('Draft with amount 0 → save succeeds → submit fails', async () => {
    // Save draft with amount 0 succeeds
    const resCreate = mockRes();
    await createFundRequest({
      body: {
        work_order_no: workOrder,
        zo_fr_amount: 0,
        zo_remarks: 'Zero amount draft',
        beneficiary_name: 'Zero Amount Supplier',
        beneficiary_ac_no: '987111222333',
        beneficiary_ifsc: 'SBIN0001234',
        beneficiary_bank_id: bankId,
        beneficiary_bank_name: 'State Bank of India'
      },
      user: { role: 'zo', mobile_number: zoMobile }
    }, resCreate);
    expect(resCreate.statusCode).toBe(201);
    const draftId = resCreate.jsonData.id;
    frIds.push(draftId);

    // Submit via controller fails with 422
    const resSubmit = mockRes();
    await submitFundRequest({
      params: { id: draftId },
      user: { role: 'zo', mobile_number: zoMobile }
    }, resSubmit);
    expect(resSubmit.statusCode).toBe(422);
    expect(resSubmit.jsonData.message).toMatch(/amount must be greater than zero/i);

    // Direct RPC submit fails with VAL01
    const { error: rpcErr } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: draftId,
      p_submitted_by: zoMobile
    });
    expect(rpcErr).toBeTruthy();
    expect(rpcErr.code).toBe('VAL01');
    expect(rpcErr.message).toMatch(/amount must be greater than zero/i);
  });

  test('Draft with missing beneficiary → save succeeds → submit fails', async () => {
    // Save draft with no beneficiary details succeeds
    const resCreate = mockRes();
    await createFundRequest({
      body: {
        work_order_no: workOrder,
        zo_fr_amount: 15000,
        zo_remarks: 'Draft without beneficiary'
      },
      user: { role: 'zo', mobile_number: zoMobile }
    }, resCreate);
    expect(resCreate.statusCode).toBe(201);
    const draftId = resCreate.jsonData.id;
    frIds.push(draftId);

    // Submit via controller fails with 400
    const resSubmit = mockRes();
    await submitFundRequest({
      params: { id: draftId },
      user: { role: 'zo', mobile_number: zoMobile }
    }, resSubmit);
    expect(resSubmit.statusCode).toBe(400);
    expect(resSubmit.jsonData.message).toMatch(/Complete beneficiary bank details are required/i);

    // Direct RPC submit fails with VAL01
    const { error: rpcErr } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: draftId,
      p_submitted_by: zoMobile
    });
    expect(rpcErr).toBeTruthy();
    expect(rpcErr.code).toBe('VAL01');
    expect(rpcErr.message).toMatch(/Complete beneficiary bank details are required/i);
  });

  test('Draft with inactive bank → submit fails', async () => {
    const inactiveBankName = `Inactive Test Bank ${crypto.randomUUID().slice(0, 6)}`;
    const { data: inactiveBank, error: bankErr } = await supabase.from('indian_bank_master').insert({
      bank_name: inactiveBankName,
      is_active: false,
      created_by: adminMobile
    }).select().single();
    if (bankErr) throw bankErr;
    testBankIds.push(inactiveBank.id);

    // Draft inserted with inactive bank
    const { data: draft, error: draftErr } = await supabase.from('fund_requests').insert({
      zo_user_id: zoMobile,
      zo_fr_no: `FR-${crypto.randomUUID()}`,
      zo_fr_amount: 5000,
      zo_remarks: 'Draft with inactive bank',
      work_order_no: workOrder,
      created_by: zoMobile,
      beneficiary_name: 'Inactive Bank Payee',
      beneficiary_ac_no: '987654321098',
      beneficiary_ifsc: 'SBIN0001234',
      beneficiary_bank_id: inactiveBank.id,
      beneficiary_bank_name: inactiveBankName
    }).select().single();
    if (draftErr) throw draftErr;
    frIds.push(draft.fund_request_id);

    // Submit via controller fails with 422
    const resSubmit = mockRes();
    await submitFundRequest({
      params: { id: draft.fund_request_id },
      user: { role: 'zo', mobile_number: zoMobile }
    }, resSubmit);
    expect(resSubmit.statusCode).toBe(422);
    expect(resSubmit.jsonData.message).toMatch(/bank is currently inactive|bank does not exist or is inactive/i);

    // Direct RPC submit fails with VAL01
    const { error: rpcErr } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: draft.fund_request_id,
      p_submitted_by: zoMobile
    });
    expect(rpcErr).toBeTruthy();
    expect(rpcErr.code).toBe('VAL01');
    expect(rpcErr.message).toMatch(/bank does not exist or is inactive/i);
  });

  test('Draft with WO belonging to another ZO → submit fails', async () => {
    // Draft created by zoMobile but points to otherWorkOrder (owned by otherZoMobile)
    const { data: mismatchDraft, error: draftErr } = await supabase.from('fund_requests').insert({
      zo_user_id: zoMobile,
      zo_fr_no: `FR-${crypto.randomUUID()}`,
      zo_fr_amount: 5000,
      zo_remarks: 'Draft with mismatched WO',
      work_order_no: otherWorkOrder,
      created_by: zoMobile,
      beneficiary_name: 'Mismatch Payee',
      beneficiary_ac_no: '987555666777',
      beneficiary_ifsc: 'SBIN0001234',
      beneficiary_bank_id: bankId,
      beneficiary_bank_name: 'State Bank of India'
    }).select().single();
    if (draftErr) throw draftErr;
    frIds.push(mismatchDraft.fund_request_id);

    // Submit via controller returns 400 (mapped from AUT01)
    const resSubmit = mockRes();
    await submitFundRequest({
      params: { id: mismatchDraft.fund_request_id },
      user: { role: 'zo', mobile_number: zoMobile }
    }, resSubmit);
    expect(resSubmit.statusCode).toBe(400);
    expect(resSubmit.jsonData.message).toMatch(/Work Order mismatch with Zonal Office/i);

    // Direct RPC submit fails with AUT01
    const { error: rpcErr } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: mismatchDraft.fund_request_id,
      p_submitted_by: zoMobile
    });
    expect(rpcErr).toBeTruthy();
    expect(rpcErr.code).toBe('AUT01');
    expect(rpcErr.message).toMatch(/Work Order mismatch with Zonal Office/i);
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
