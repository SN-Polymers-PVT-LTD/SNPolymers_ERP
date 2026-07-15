import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  createFundRequest,
  actOnFundRequest,
  cancelFundRequest
} = require('../../../src/controllers/fundRequests.controller');

describe('Milestone P3-M3 — Fund Requests Workflow Integration', () => {
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const zoUser2 = { role: 'zo', mobile_number: '+918000000003' };
  const hoUser = { role: 'ho', mobile_number: '+918000000004' };
  let testWorkOrder;

  beforeAll(async () => {
    // Safely upsert users to prevent duplicate key violations and foreign key delete failures
    for (const u of [
      { mobile_number: zoUser.mobile_number, display_name: 'ZO User 1', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: zoUser2.mobile_number, display_name: 'ZO User 2', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: hoUser.mobile_number, display_name: 'HO User', role: 'ho', is_active: true, permissions: {} }
    ]) {
      const { error: upsertErr } = await supabase.from('authorised_users').upsert(u, { onConflict: 'mobile_number' });
      if (upsertErr) throw upsertErr;
    }

    const suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_P3M3_${suffix}`;

    // Insert a project owned by zoUser so the ZO ownership check in createFundRequest passes
    const { error: projErr } = await supabase.from('projects_master').insert({
      work_order_no: testWorkOrder,
      estimate_no: `EST_P3M3_${suffix}`,
      zo_user_id: zoUser.mobile_number,
      site_details: 'P3-M3 Test Site',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      work_order_value: 500000.00,
      created_by: zoUser.mobile_number,
      edited_by: zoUser.mobile_number
    });
    if (projErr) throw new Error(`P3-M3 project insert failed: ${projErr.message}`);

    // Insert a final approved cost estimate for the project so the new constraint passes
    const { error: estErr } = await supabase.from('project_cost_estimates').insert({
      estimate_id: crypto.randomUUID(),
      work_order_no: testWorkOrder,
      estimate_no: `EST_P3M3_${suffix}`,
      area_code: 'Kolkata Zone',
      zonal_office_no: 'ZO-1',
      estimate_amount: 100000.00,
      estimate_status: 'Final Approved',
      created_by: zoUser.mobile_number,
      last_modified_by: zoUser.mobile_number
    });
    if (estErr) throw new Error(`P3-M3 cost estimate insert failed: ${estErr.message}`);
  });

  afterAll(async () => {
    await supabase.from('fund_requests').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [zoUser.mobile_number, zoUser2.mobile_number, hoUser.mobile_number]);
  });

  async function createTestRequest(amount = 50000.00) {
    const uniqueNo = `TEST_M3_FR_${crypto.randomUUID().replace(/[^0-9]/g, '').substring(0, 6)}`;
    const req = {
      user: zoUser,
      body: {
        zo_fr_no: uniqueNo,
        work_order_no: testWorkOrder,
        zo_fr_amount: amount,
        zo_remarks: 'Workflow test'
      }
    };
    const res = mockRes();
    await createFundRequest(req, res);
    if (res.statusCode !== 201) {
      throw new Error(`Failed to create test request setup: ${JSON.stringify(res.jsonData)}`);
    }
    return res.jsonData.fundRequest;
  }

  describe('HO Actions on Fund Requests', () => {
    test('Test 1: HO approves fund request with valid params', async () => {
      const fr1 = await createTestRequest(25000.00);
      const reqApprove = {
        params: { id: fr1.fund_request_id },
        user: hoUser,
        body: {
          action: 'Approve',
          approve_ho_amount: 20000.00,
          transfer_from_account: 'CC',
          ho_remarks: 'Approved CC 20k'
        }
      };
      const resApprove = mockRes();
      await actOnFundRequest(reqApprove, resApprove);

      expect(resApprove.statusCode).toBe(200);
      expect(resApprove.jsonData.success).toBe(true);

      const updated = resApprove.jsonData.fundRequest;
      expect(updated.request_status).toBe('Approved');
      expect(Number(updated.approve_ho_amount)).toBe(20000.00);
      expect(updated.transfer_from_account).toBe('CC');
    });

    test('Test 2: HO places Pending fund request on Hold successfully', async () => {
      const fr2 = await createTestRequest(15000.00);
      const reqHold = {
        params: { id: fr2.fund_request_id },
        user: hoUser,
        body: {
          action: 'Hold',
          ho_remarks: 'Need further details'
        }
      };
      const resHold = mockRes();
      await actOnFundRequest(reqHold, resHold);

      expect(resHold.statusCode).toBe(200);
      expect(resHold.jsonData.success).toBe(true);

      const updated = resHold.jsonData.fundRequest;
      expect(updated.request_status).toBe('Hold');
      expect(updated.approve_ho_amount).toBeNull();
      expect(updated.transfer_from_account).toBeNull();
    });

    test('Test 3: Blocks HO approval when amount exceeds requested amount', async () => {
      const fr3 = await createTestRequest(10000.00);
      const reqExceed = {
        params: { id: fr3.fund_request_id },
        user: hoUser,
        body: {
          action: 'Approve',
          approve_ho_amount: 12000.00,
          transfer_from_account: 'OD'
        }
      };
      const resExceed = mockRes();
      await actOnFundRequest(reqExceed, resExceed);

      expect(resExceed.statusCode).toBe(400);
      expect(resExceed.jsonData.success).toBe(false);
    });

    test('Test 4: Blocks HO approval when transfer_from_account is missing', async () => {
      const fr4 = await createTestRequest(10000.00);
      const reqNoAccount = {
        params: { id: fr4.fund_request_id },
        user: hoUser,
        body: {
          action: 'Approve',
          approve_ho_amount: 5000.00
        }
      };
      const resNoAccount = mockRes();
      await actOnFundRequest(reqNoAccount, resNoAccount);

      expect(resNoAccount.statusCode).toBe(400);
      expect(resNoAccount.jsonData.success).toBe(false);
    });

    test('Test 5: Blocks taking action on an already approved request with 403', async () => {
      const fr5 = await createTestRequest(10000.00);
      
      // First approve
      await actOnFundRequest({
        params: { id: fr5.fund_request_id },
        user: hoUser,
        body: { action: 'Approve', approve_ho_amount: 10000.00, transfer_from_account: 'CR' }
      }, mockRes());

      // Try action again
      const reqRepeat = {
        params: { id: fr5.fund_request_id },
        user: hoUser,
        body: { action: 'Hold' }
      };
      const resRepeat = mockRes();
      await actOnFundRequest(reqRepeat, resRepeat);

      expect(resRepeat.statusCode).toBe(403);
      expect(resRepeat.jsonData.success).toBe(false);
    });
  });

  describe('ZO Cancellations', () => {
    test('Test 6: ZO cancels own Pending request successfully', async () => {
      const fr6 = await createTestRequest(10000.00);
      const reqCancel = {
        params: { id: fr6.fund_request_id },
        user: zoUser
      };
      const resCancel = mockRes();
      await cancelFundRequest(reqCancel, resCancel);

      expect(resCancel.statusCode).toBe(200);
      expect(resCancel.jsonData.success).toBe(true);

      const updated = resCancel.jsonData.fundRequest;
      expect(updated.request_status).toBe('Cancelled');
      expect(updated.cancelled_by).toBe(zoUser.mobile_number);
    });

    test('Test 7: Blocks ZO from cancelling an already Approved request with 403', async () => {
      const fr7 = await createTestRequest(10000.00);
      await actOnFundRequest({
        params: { id: fr7.fund_request_id },
        user: hoUser,
        body: { action: 'Approve', approve_ho_amount: 10000.00, transfer_from_account: 'CR' }
      }, mockRes());

      const reqCancelApproved = {
        params: { id: fr7.fund_request_id },
        user: zoUser
      };
      const resCancelApproved = mockRes();
      await cancelFundRequest(reqCancelApproved, resCancelApproved);

      expect(resCancelApproved.statusCode).toBe(403);
      expect(resCancelApproved.jsonData.success).toBe(false);
    });

    test('Test 8: Blocks ZO from cancelling a request belonging to another ZO with 403', async () => {
      const fr8 = await createTestRequest(10000.00);
      const reqCancelOther = {
        params: { id: fr8.fund_request_id },
        user: zoUser2
      };
      const resCancelOther = mockRes();
      await cancelFundRequest(reqCancelOther, resCancelOther);

      expect(resCancelOther.statusCode).toBe(403);
      expect(resCancelOther.jsonData.success).toBe(false);
    });
  });

  describe('Fund Request Constraints (Final Approved Cost Estimate)', () => {
    test('Test 9: Blocks creating fund request for WO without a Final Approved cost estimate', async () => {
      const suffix = crypto.randomUUID().substring(0, 8);
      const tempWO = `TEST_WO_P3M3_NOEST_${suffix}`;

      // Insert project WITHOUT cost estimate
      await supabase.from('projects_master').insert({
        work_order_no: tempWO,
        estimate_no: `EST_P3M3_NOEST_${suffix}`,
        zo_user_id: zoUser.mobile_number,
        site_details: 'P3-M3 Temp Site',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        work_order_value: 500000.00,
        created_by: zoUser.mobile_number,
        edited_by: zoUser.mobile_number
      });

      const uniqueNo = `TEST_M3_FR_NOEST_${crypto.randomUUID().replace(/[^0-9]/g, '').substring(0, 6)}`;
      const req = {
        user: zoUser,
        body: {
          zo_fr_no: uniqueNo,
          work_order_no: tempWO,
          zo_fr_amount: 10000.00,
          zo_remarks: 'Should fail validation'
        }
      };
      const res = mockRes();
      await createFundRequest(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toContain('without a Final Approved cost estimate');

      // Cleanup
      await supabase.from('projects_master').delete().eq('work_order_no', tempWO);
    });
  });
});
