import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  createFundRequest,
  getFundRequests,
  getFundRequestById
} = require('../../../src/controllers/fundRequests.controller');

describe('Milestone P3-M2 — Fund Requests CRUD Integration', () => {
  let suffix;
  let testFrNo1;
  let testFrNo2;
  let testWorkOrder;
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const zoUser2 = { role: 'zo', mobile_number: '+918000000003' };
  const jeUser = { role: 'je', mobile_number: '+918000000002' };
  const hoUser = { role: 'ho', mobile_number: '+918000000004' };
  let createdFr1 = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testFrNo1 = `TEST_M2_FR_${suffix}_1`;
    testFrNo2 = `TEST_M2_FR_${suffix}_2`;
    testWorkOrder = `TEST_WO_P3M2_${suffix}`;

    // Insert a project owned by zoUser so the ZO ownership check in createFundRequest passes
    const { error: projErr } = await supabase.from('projects_master').insert({
      work_order_no: testWorkOrder,
      estimate_no: `EST_P3M2_${suffix}`,
      zo_user_id: zoUser.mobile_number,
      site_details: 'P3-M2 Test Site',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      work_order_value: 500000.00,
      created_by: zoUser.mobile_number,
      edited_by: zoUser.mobile_number
    });
    if (projErr) throw new Error(`P3-M2 project insert failed: ${projErr.message}`);
  });

  afterAll(async () => {
    await supabase.from('fund_requests').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
  });

  describe('Fund Request Creation', () => {
    test('Test 1: Creates a valid fund request as ZO (Pending status)', async () => {
      const reqCreate1 = {
        user: zoUser,
        body: {
          zo_fr_no: testFrNo1,
          work_order_no: testWorkOrder,
          zo_fr_amount: 45000.50,
          zo_remarks: '  Urgent Material Purchase  '
        }
      };
      const resCreate1 = mockRes();
      await createFundRequest(reqCreate1, resCreate1);

      expect(resCreate1.statusCode).toBe(201);
      expect(resCreate1.jsonData.success).toBe(true);
      expect(resCreate1.jsonData.fundRequest.zo_fr_no).toBe(testFrNo1);
      expect(Number(resCreate1.jsonData.fundRequest.zo_fr_amount)).toBe(45000.50);
      expect(resCreate1.jsonData.fundRequest.request_status).toBe('Pending');
      createdFr1 = resCreate1.jsonData.fundRequest;
    });

    test('Test 2: Blocks duplicate zo_fr_no with 409 Conflict', async () => {
      const reqCreateDup = {
        user: zoUser,
        body: {
          zo_fr_no: testFrNo1,
          work_order_no: testWorkOrder,
          zo_fr_amount: 10000.00
        }
      };
      const resCreateDup = mockRes();
      await createFundRequest(reqCreateDup, resCreateDup);

      expect(resCreateDup.statusCode).toBe(409);
      expect(resCreateDup.jsonData.success).toBe(false);
    });

    test('Test 3: Blocks 0 and negative zo_fr_amount with 400 Bad Request', async () => {
      const reqCreateZero = {
        user: zoUser,
        body: {
          zo_fr_no: testFrNo2,
          work_order_no: testWorkOrder,
          zo_fr_amount: 0
        }
      };
      const resCreateZero = mockRes();
      await createFundRequest(reqCreateZero, resCreateZero);

      const reqCreateNeg = {
        user: zoUser,
        body: {
          zo_fr_no: testFrNo2,
          work_order_no: testWorkOrder,
          zo_fr_amount: -500.00
        }
      };
      const resCreateNeg = mockRes();
      await createFundRequest(reqCreateNeg, resCreateNeg);

      expect(resCreateZero.statusCode).toBe(400);
      expect(resCreateNeg.statusCode).toBe(400);
    });

    test('Test 4: Blocks blank/whitespace zo_fr_no with 400 Bad Request', async () => {
      const reqCreateBlank = {
        user: zoUser,
        body: {
          zo_fr_no: '   ',
          work_order_no: testWorkOrder,
          zo_fr_amount: 12000.00
        }
      };
      const resCreateBlank = mockRes();
      await createFundRequest(reqCreateBlank, resCreateBlank);

      expect(resCreateBlank.statusCode).toBe(400);
    });
  });

  describe('Fund Request Retrieval & Access Gating', () => {
    test('Test 5: Retrieving list as ZO returns only own fund requests', async () => {
      const reqGetZo = {
        user: zoUser,
        query: { page: 1, limit: 10 }
      };
      const resGetZo = mockRes();
      await getFundRequests(reqGetZo, resGetZo);

      expect(resGetZo.statusCode).toBe(200);
      expect(resGetZo.jsonData.success).toBe(true);

      const frs = resGetZo.jsonData.fundRequests;
      const allOwn = frs.every(fr => fr.zo_user_id === zoUser.mobile_number);
      const containsCreated = frs.some(fr => fr.zo_fr_no === testFrNo1);

      expect(allOwn).toBe(true);
      expect(containsCreated).toBe(true);
    });

    test('Test 6: Blocks JE role from listing fund requests with 403', async () => {
      const reqGetJe = {
        user: jeUser,
        query: {}
      };
      const resGetJe = mockRes();
      await getFundRequests(reqGetJe, resGetJe);

      expect(resGetJe.statusCode).toBe(403);
    });

    test('Test 7: Blocks non-owner ZO from fetching a single fund request detail', async () => {
      expect(createdFr1).not.toBeNull();

      const reqGetByIdNonOwner = {
        user: zoUser2,
        params: { id: createdFr1.fund_request_id }
      };
      const resGetByIdNonOwner = mockRes();
      await getFundRequestById(reqGetByIdNonOwner, resGetByIdNonOwner);

      const isBlocked = resGetByIdNonOwner.statusCode === 404 || resGetByIdNonOwner.statusCode === 403;
      expect(isBlocked).toBe(true);
    });

    test('Test 8: Returns correct pagination metadata', async () => {
      const reqPage = {
        user: hoUser,
        query: { page: 1, limit: 5 }
      };
      const resPage = mockRes();
      await getFundRequests(reqPage, resPage);

      expect(resPage.statusCode).toBe(200);
      expect(resPage.jsonData.pagination).toBeDefined();
      expect(resPage.jsonData.pagination.page).toBe(1);
      expect(resPage.jsonData.pagination.limit).toBe(5);
      expect(resPage.jsonData.pagination.total).toBeDefined();
      expect(resPage.jsonData.pagination.totalPages).toBeDefined();
    });
  });
});
