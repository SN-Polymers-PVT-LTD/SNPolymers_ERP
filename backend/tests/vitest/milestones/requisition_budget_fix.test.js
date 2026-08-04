import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const setupUsers = require('../../helpers/setupUsers');
const { getRequisitionById } = require('../../../src/controllers/requisitions.controller');

describe('Requisition Budget Reallocation Fix Suite', () => {
  let suffix;
  let testWorkOrder;
  let testEstimateNo;
  let estimateId = null;
  const testMobile = '+918276071523';

  let reqAId = null;
  let reqBId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_BUD_${suffix}`;
    testEstimateNo = `EST_BUD_${suffix}`;

    // Ensure the admin user exists
    await setupUsers([
      { mobile_number: testMobile, display_name: 'Test Admin User', role: 'admin', permissions: {}, is_active: true }
    ]);

    // 1. Setup project
    await setupProject(testWorkOrder, testEstimateNo, 1000000.00, testMobile);

    // 2. Create Final Approved estimate with budget 500,000
    const { data: estData, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: testWorkOrder,
        estimate_no: testEstimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_99',
        estimate_amount: 500000.00,
        estimate_status: 'Final Approved',
        created_by: testMobile,
        last_modified_by: testMobile
      }])
      .select()
      .single();

    if (estErr) throw estErr;
    estimateId = estData.estimate_id;

    // 3. Create Requisition A (Requested 10,000, Approved 4,000)
    const { data: reqA, error: reqAErr } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: testMobile,
        work_order_no: testWorkOrder,
        estimate_no: testEstimateNo,
        estimate_amount: 500000.00,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'Irrigation',
        site_details: 'Site A',
        requisition_no: `REQ_A_${suffix}`,
        material_main_head: 'Cement',
        requisition_pdf_url: 'http://test.com/a.pdf',
        requisition_amount: 10000.00,
        gst_bill: 'No',
        bank_details: 'Bank Details A',
        requisition_status: 'Approved',
        approved_user_id: testMobile,
        payment_date: new Date().toISOString(),
        approve_type: 'Approve',
        approved_amount: 4000.00,
        approved_balance_amount: 6000.00,
        created_by: testMobile
      }])
      .select()
      .single();

    if (reqAErr) throw reqAErr;
    reqAId = reqA.requisition_id;

    // 4. Create Requisition B (Requested 2,000, Pending)
    const { data: reqB, error: reqBErr } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: testMobile,
        work_order_no: testWorkOrder,
        estimate_no: testEstimateNo,
        estimate_amount: 500000.00,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'Irrigation',
        site_details: 'Site B',
        requisition_no: `REQ_B_${suffix}`,
        material_main_head: 'Cement',
        requisition_pdf_url: 'http://test.com/b.pdf',
        requisition_amount: 2000.00,
        gst_bill: 'No',
        bank_details: 'Bank Details B',
        requisition_status: 'Pending',
        created_by: testMobile
      }])
      .select()
      .single();

    if (reqBErr) throw reqBErr;
    reqBId = reqB.requisition_id;
  });

  afterAll(async () => {
    // Cleanup database records
    if (reqAId) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqAId);
    }
    if (reqBId) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqBId);
    }
    if (estimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }
    await supabase.from('authorised_users').delete().eq('mobile_number', testMobile);
    // SetupProject deletes the project record automatically if mapped correctly
  });

  test('Test 1: Recalculates remaining budget counting only approved amount for Approved requisitions', async () => {
    const req = {
      params: { id: reqBId },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const res = mockRes();

    await getRequisitionById(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);

    // Remaining budget should be: EstimateAmount - (Approved REQ_A + Requested REQ_B)
    // 500,000 - (4,000 + 2,000) = 494,000.00
    // Under old logic, it would have been: 500,000 - (10,000 + 2,000) = 488,000.00
    expect(Number(res.jsonData.requisition.remainingEstimateAmount)).toBe(494000.00);
  });
});
