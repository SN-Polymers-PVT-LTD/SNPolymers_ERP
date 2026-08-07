import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const setupUsers = require('../../helpers/setupUsers');
const {
  upsertEstimatedBill,
  listWorkOrderOptions,
  getEstimatedBill,
  listEstimatedBills
} = require('../../../src/controllers/estimatedBills.controller');

describe('Estimated Bill Remaining Capacity Validation Suite', () => {
  let suffix;
  let testWorkOrder;
  let testEstimateNo;
  const testMobile = '+918276079999';

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_ESTCAP_${suffix}`;
    testEstimateNo = `EST_ESTCAP_${suffix}`;

    // 1. Setup user
    await setupUsers([
      { mobile_number: testMobile, display_name: 'Test Capacity Admin', role: 'admin', is_active: true }
    ]);

    // 2. Setup project with work_order_value = 100,000
    await setupProject(testWorkOrder, testEstimateNo, 100000.00, testMobile);
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('estimated_bills').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('ra_final_bills').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('authorised_users').delete().eq('mobile_number', testMobile);
  });

  test('Test 1: Allows creating an Estimated Bill within the initial Work Order value (no RA bills)', async () => {
    const req = {
      body: {
        work_order_no: testWorkOrder,
        estimated_bill_amount: 60000.00,
        estimated_payment_date: '2026-09-01',
        surety_pct: 80,
        remarks: 'Initial Forecast'
      },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const res = mockRes();

    await upsertEstimatedBill(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.message).toBe('Estimated bill saved successfully.');
  });

  test('Test 2: Fails when creating an Estimated Bill exceeding remaining capacity after inserting an RA Bill', async () => {
    // 1. Create an RA Bill of ₹70,000 (total billed = 70,000; remaining capacity = 30,000)
    const { error: billErr } = await supabase
      .from('ra_final_bills')
      .insert({
        work_order_no: testWorkOrder,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        payment_type: 'RA Bill 1',
        bill_date: '2026-08-01',
        bill_no: `BILL_1_${suffix}`,
        gross_bill: 70000.00,
        bill_copy_url: 'http://test.com/bill1.pdf',
        original_bill_filename: 'bill1.pdf',
        created_by: testMobile
      });

    if (billErr) throw billErr;

    // 2. Attempt to submit an Estimated Bill of ₹35,000 (which exceeds the ₹30,000 remaining capacity)
    const req = {
      body: {
        work_order_no: testWorkOrder,
        estimated_bill_amount: 35000.00,
        estimated_payment_date: '2026-09-02',
        surety_pct: 80,
        remarks: 'Over capacity forecast'
      },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const res = mockRes();

    await upsertEstimatedBill(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('exceeds remaining Work Order capacity');
  });

  test('Test 3: Allows creating an Estimated Bill exactly equal to remaining capacity', async () => {
    const req = {
      body: {
        work_order_no: testWorkOrder,
        estimated_bill_amount: 30000.00,
        estimated_payment_date: '2026-09-03',
        surety_pct: 90,
        remarks: 'Exact remaining capacity forecast'
      },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const res = mockRes();

    await upsertEstimatedBill(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
  });

  test('Test 4: View and options endpoints return correct capacity totals', async () => {
    // 1. Check options dropdown endpoint
    const reqOptions = {
      query: { work_order_no: testWorkOrder },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const resOptions = mockRes();

    await listWorkOrderOptions(reqOptions, resOptions);

    expect(resOptions.statusCode).toBe(200);
    const woOption = resOptions.jsonData.workOrders.find(w => w.work_order_no === testWorkOrder);
    expect(woOption).toBeDefined();
    expect(woOption.work_order_value).toBe(100000.00);
    expect(woOption.total_billed).toBe(70000.00);
    expect(woOption.remaining_value).toBe(30000.00);

    // 2. Check getEstimatedBill detail endpoint
    const reqDetail = {
      params: { work_order_no: testWorkOrder },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const resDetail = mockRes();

    await getEstimatedBill(reqDetail, resDetail);

    expect(resDetail.statusCode).toBe(200);
    expect(resDetail.jsonData.project.total_billed).toBe(70000.00);
    expect(resDetail.jsonData.project.remaining_value).toBe(30000.00);

    // 3. Check listEstimatedBills overview endpoint
    const reqList = {
      query: { work_order_no: testWorkOrder },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const resList = mockRes();

    await listEstimatedBills(reqList, resList);

    expect(resList.statusCode).toBe(200);
    const listRow = resList.jsonData.data.find(w => w.work_order_no === testWorkOrder);
    expect(listRow).toBeDefined();
    expect(listRow.total_billed).toBe(70000.00);
    expect(listRow.remaining_value).toBe(30000.00);
  });

  test('Test 5: Fails to create Estimated Bill when remaining capacity is completely exhausted', async () => {
    // 1. Create a second RA Bill of ₹30,000 (total billed is now 100,000; remaining capacity = 0)
    const { error: billErr } = await supabase
      .from('ra_final_bills')
      .insert({
        work_order_no: testWorkOrder,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        payment_type: 'RA Bill 2',
        bill_date: '2026-08-05',
        bill_no: `BILL_2_${suffix}`,
        gross_bill: 30000.00,
        bill_copy_url: 'http://test.com/bill2.pdf',
        original_bill_filename: 'bill2.pdf',
        created_by: testMobile
      });

    if (billErr) throw billErr;

    // 2. Attempt to create any estimated bill
    const req = {
      body: {
        work_order_no: testWorkOrder,
        estimated_bill_amount: 1000.00,
        estimated_payment_date: '2026-09-04',
        surety_pct: 50,
        remarks: 'Zero capacity forecast'
      },
      user: { role: 'admin', mobile_number: testMobile }
    };
    const res = mockRes();

    await upsertEstimatedBill(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(rpcMessageContainsZeroCapacity(res.jsonData.message)).toBe(true);
  });
});

function rpcMessageContainsZeroCapacity(msg) {
  return msg.includes('No remaining Work Order capacity') || msg.includes('exceeds remaining Work Order capacity');
}
