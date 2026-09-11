import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { createFundRequest, submitFundRequest, cancelFundRequest } = require('../../../src/controllers/fundRequests.controller');

describe('Milestone P3-M3 — Fund Request Draft and Submission Workflow', () => {
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const zoUser2 = { role: 'zo', mobile_number: '+918000000003' };
  let testWorkOrder;
  let bankId;

  beforeAll(async () => {
    for (const user of [
      { mobile_number: zoUser.mobile_number, display_name: 'ZO User 1', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: zoUser2.mobile_number, display_name: 'ZO User 2', role: 'zo', is_active: true, permissions: {} }
    ]) {
      const { error } = await supabase.from('authorised_users').upsert(user, { onConflict: 'mobile_number' });
      if (error) throw error;
    }
    const suffix = crypto.randomUUID().slice(0, 8);
    testWorkOrder = `TEST_WO_P3M3_${suffix}`;
    const { error: projectError } = await supabase.from('projects_master').insert({
      work_order_no: testWorkOrder, estimate_no: `EST_P3M3_${suffix}`, zo_user_id: zoUser.mobile_number,
      site_details: 'P3-M3 Test Site', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD',
      status: 'Running', work_order_value: 500000, created_by: zoUser.mobile_number, edited_by: zoUser.mobile_number
    });
    if (projectError) throw projectError;
    const { error: estimateError } = await supabase.from('project_cost_estimates').insert({
      estimate_id: crypto.randomUUID(), work_order_no: testWorkOrder, estimate_no: `EST_P3M3_${suffix}`,
      area_code: 'Kolkata Zone', zonal_office_no: 'ZO-1', estimate_amount: 100000, estimate_status: 'Final Approved',
      created_by: zoUser.mobile_number, last_modified_by: zoUser.mobile_number
    });
    if (estimateError) throw estimateError;
    const { data: bank, error: bankError } = await supabase.from('indian_bank_master').select('id')
      .eq('bank_name', 'State Bank of India').eq('is_active', true).limit(1).maybeSingle();
    if (bankError || !bank) throw bankError || new Error('Active State Bank of India test bank not found');
    bankId = bank.id;
  });

  afterAll(async () => {
    await supabase.from('fund_requests').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
  });

  async function createTestDraft(amount = 10000) {
    const res = mockRes();
    await createFundRequest({ user: zoUser, body: {
      zo_fr_no: `TEST_M3_FR_${crypto.randomUUID().slice(0, 8)}`, work_order_no: testWorkOrder,
      zo_fr_amount: amount, zo_remarks: 'Draft workflow test', beneficiary_name: 'Test Supplier',
      beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId
    } }, res);
    expect(res.statusCode).toBe(201);
    return res.jsonData.fundRequest;
  }

  test('Test 1: a ZO creates a Draft and submits it to Pending', async () => {
    const draft = await createTestDraft(25000);
    expect(draft.request_status).toBe('Draft');
    const res = mockRes();
    await submitFundRequest({ params: { id: draft.fund_request_id }, user: zoUser }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.fundRequest.request_status).toBe('Pending');
  });

  test('Test 2: only the draft owner may submit it', async () => {
    const draft = await createTestDraft();
    const res = mockRes();
    await submitFundRequest({ params: { id: draft.fund_request_id }, user: zoUser2 }, res);
    expect(res.statusCode).toBe(403);
  });

  test('Test 3: a draft cannot be submitted twice', async () => {
    const draft = await createTestDraft();
    const first = mockRes();
    await submitFundRequest({ params: { id: draft.fund_request_id }, user: zoUser }, first);
    expect(first.statusCode).toBe(200);
    const retry = mockRes();
    await submitFundRequest({ params: { id: draft.fund_request_id }, user: zoUser }, retry);
    expect(retry.statusCode).toBe(409);
  });

  test('Test 4: a ZO can cancel its own unimported draft', async () => {
    const draft = await createTestDraft();
    const res = mockRes();
    await cancelFundRequest({ params: { id: draft.fund_request_id }, user: zoUser }, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.fundRequest.request_status).toBe('Cancelled');
  });

  test('Test 5: a ZO cannot cancel another ZO’s request', async () => {
    const draft = await createTestDraft();
    const res = mockRes();
    await cancelFundRequest({ params: { id: draft.fund_request_id }, user: zoUser2 }, res);
    expect(res.statusCode).toBe(403);
  });
});
