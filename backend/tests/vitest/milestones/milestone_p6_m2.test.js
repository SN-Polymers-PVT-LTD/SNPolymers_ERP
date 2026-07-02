import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const {
  createBill,
  getBills,
  getBillById,
  getBillSummaryByWorkOrder
} = require('../../../src/controllers/raFinalBill.controller');
const { uploadBillCopy } = require('../../../src/controllers/raFinalBill.uploads.controller');

describe('Milestone P6-M2 — RA/Final Bill CRUD & Summary Controller', () => {
  let suffix;
  let testBillNo;
  let testWorkOrder;
  let testEstimateNo;
  let createdBillId = null;
  let realUploadedPath = null;
  let hoUser = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testBillNo = `BILL_M2_TEST_${suffix}`;
    testWorkOrder = `TEST_WO_P6M2_${suffix}`;
    testEstimateNo = `EST_P6M2_${suffix}`;

    // 1. Resolve an authorized user (ho, zo, or admin)
    const { data: users, error: userError } = await supabase.from('authorised_users')
      .select('mobile_number, role')
      .in('role', ['ho', 'zo', 'admin'])
      .limit(1);

    if (userError || !users || users.length === 0) {
      throw new Error(`No authorized user (ho, zo, admin) found in DB: ${userError?.message}`);
    }
    hoUser = users[0];

    // 2. Setup a fresh project to guarantee a clean workspace without existing bills
    await setupProject(testWorkOrder, testEstimateNo, 1000000.00, hoUser.mobile_number);
  });

  afterAll(async () => {
    // Attempt clean up of projects_master
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
  });

  describe('RA/Final Bill Operations', () => {
    test('Test 0: Pre-upload a real test file to get a valid URL', async () => {
      const reqUpload = {
        file: {
          fieldname: 'file',
          originalname: 'm2_test_invoice.pdf',
          encoding: '7bit',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock pdf content for M2 test'),
          size: 35
        }
      };
      const resUpload = mockRes();
      await uploadBillCopy(reqUpload, resUpload);

      expect(resUpload.statusCode).toBe(200);
      expect(resUpload.jsonData.success).toBe(true);
      realUploadedPath = resUpload.jsonData.bill_copy_url;
    });

    test('Test 1: Creating valid RA Bill 1 successfully', async () => {
      expect(realUploadedPath).not.toBeNull();

      const reqCreate = {
        user: hoUser,
        body: {
          work_order_no: testWorkOrder,
          payment_type: 'RA Bill 1',
          bill_date: '2026-06-27',
          bill_no: testBillNo,
          bill_amount_with_gst: 100000.00,
          earnest_money_deposit: 1000.00,
          security_deposit_amount: 2000.00,
          bill_copy_url: realUploadedPath,
          original_bill_filename: 'm2_test_invoice.pdf',
          remarks: 'API Test RA Bill 1'
        }
      };
      const resCreate = mockRes();
      await createBill(reqCreate, resCreate);

      expect(resCreate.statusCode).toBe(201);
      expect(resCreate.jsonData.success).toBe(true);
      createdBillId = resCreate.jsonData.bill.bill_id;
    });

    test('Test 2: Rejects duplicate payment type for same work order', async () => {
      expect(realUploadedPath).not.toBeNull();

      const reqDup = {
        user: hoUser,
        body: {
          work_order_no: testWorkOrder,
          payment_type: 'RA Bill 1', // Duplicate of Test 1
          bill_date: '2026-06-27',
          bill_no: `${testBillNo}_dup`,
          bill_amount_with_gst: 100000.00,
          earnest_money_deposit: 1000.00,
          security_deposit_amount: 2000.00,
          bill_copy_url: realUploadedPath,
          original_bill_filename: 'm2_test_invoice.pdf',
          remarks: 'API Test RA Bill 1'
        }
      };
      const resDup = mockRes();
      await createBill(reqDup, resDup);

      expect(resDup.statusCode).toBe(409);
      expect(resDup.jsonData.message).toContain('already exists');
    });

    test('Test 3: Blocks creating non-sequential bills (RA Bill 3 without RA Bill 2)', async () => {
      expect(realUploadedPath).not.toBeNull();

      const reqSeq = {
        user: hoUser,
        body: {
          work_order_no: testWorkOrder,
          payment_type: 'RA Bill 3', // Non-sequential
          bill_date: '2026-06-27',
          bill_no: `${testBillNo}_3`,
          bill_amount_with_gst: 100000.00,
          earnest_money_deposit: 1000.00,
          security_deposit_amount: 2000.00,
          bill_copy_url: realUploadedPath,
          original_bill_filename: 'm2_test_invoice.pdf',
          remarks: 'API Test'
        }
      };
      const resSeq = mockRes();
      await createBill(reqSeq, resSeq);

      expect(resSeq.statusCode).toBe(422);
      expect(resSeq.jsonData.message).toContain('RA Bill 2 must be entered');
    });

    test('Test 4: Blocks bill creation for closed project with 403', async () => {
      expect(realUploadedPath).not.toBeNull();

      // Temporarily mark project closed
      await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', testWorkOrder);

      const reqClosed = {
        user: hoUser,
        body: {
          work_order_no: testWorkOrder,
          payment_type: 'RA Bill 2',
          bill_date: '2026-06-27',
          bill_no: `${testBillNo}_2`,
          bill_amount_with_gst: 100000.00,
          earnest_money_deposit: 1000.00,
          security_deposit_amount: 2000.00,
          bill_copy_url: realUploadedPath,
          original_bill_filename: 'm2_test_invoice.pdf',
          remarks: 'API Test'
        }
      };
      const resClosed = mockRes();
      await createBill(reqClosed, resClosed);

      // Restore to Running
      await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', testWorkOrder);

      expect(resClosed.statusCode).toBe(403);
      expect(resClosed.jsonData.message).toContain('Closed work orders');
    });

    test('Test 5: Retrieves correct bill summary and dropdown options for next bill', async () => {
      const reqSummary = {
        params: { work_order_no: testWorkOrder }
      };
      const resSummary = mockRes();
      await getBillSummaryByWorkOrder(reqSummary, resSummary);

      expect(resSummary.statusCode).toBe(200);
      expect(resSummary.jsonData.success).toBe(true);

      const summary = resSummary.jsonData;
      expect(summary.next_ra_bill_number).toBe(2);
      expect(Number(summary.previous_bill_amount)).toBe(100000.00);
      const isRa2Available = summary.dropdown_options.some(opt => opt.value === 'RA Bill 2' && opt.available);
      expect(isRa2Available).toBe(true);
    });

    test('Test 6: Retrieves lists of bills with correct filters and resolving names', async () => {
      expect(createdBillId).not.toBeNull();

      const reqList = {
        query: { work_order_no: testWorkOrder, page: 1, limit: 10 }
      };
      const resList = mockRes();
      await getBills(reqList, resList);

      expect(resList.statusCode).toBe(200);
      expect(resList.jsonData.success).toBe(true);

      const list = resList.jsonData.bills;
      const count = resList.jsonData.pagination.total;
      expect(count).toBe(1);
      expect(list[0].bill_id).toBe(createdBillId);
      expect(list[0].created_by_name).toBeDefined();
    });

    test('Test 7: Retrieves a single bill record by ID with resolved name and signed URL', async () => {
      expect(createdBillId).not.toBeNull();

      const reqGet = {
        params: { id: createdBillId }
      };
      const resGet = mockRes();
      await getBillById(reqGet, resGet);

      expect(resGet.statusCode).toBe(200);
      expect(resGet.jsonData.success).toBe(true);

      const bill = resGet.jsonData.bill;
      expect(bill.created_by_name).toBeDefined();
      expect(bill.bill_copy_signed_url).toBeDefined();
      expect(bill.bill_copy_signed_url.startsWith('https://')).toBe(true);
    });
  });
});
