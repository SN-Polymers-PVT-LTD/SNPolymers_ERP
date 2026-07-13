import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const {
  createRequisition,
  actOnRequisition,
  cancelRequisition
} = require('../../../src/controllers/requisitions.controller');

describe('Milestone P4-M3 — Requisitions Workflow API', () => {
  let suffix;
  let testWorkOrder;
  let testEstimateNo;
  let estimateId = null;
  const jeUser = { role: 'je', mobile_number: '+918000000002' }; // Actual je in DB
  const jeUser2 = { role: 'je', mobile_number: '+918000000003' }; // Non-owner je in DB
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const adminUser = { role: 'admin', mobile_number: '+918276071523' }; // Actual admin in DB
  let createdId = null;
  let woMappingId = null;
  let jeZoMappingId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testWorkOrder = `TEST_WO_M3_${suffix}`;
    testEstimateNo = `EST_M3_${suffix}`;

    // 1. Create a fresh project with zo_user_id
    const { error: projErr } = await supabase.from('projects_master').insert({
      work_order_no: testWorkOrder,
      estimate_no: testEstimateNo,
      work_order_value: 1000000.00,
      zo_user_id: zoUser.mobile_number,
      site_details: 'Testing Site',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      created_by: zoUser.mobile_number,
      edited_by: zoUser.mobile_number
    });
    if (projErr) throw new Error(`P4-M3 project insert failed: ${projErr.message}`);

    // 1b. JE-ZO mapping FIRST (work_order_mappings trigger requires it)
    const { data: jeZoData, error: jeZoErr } = await supabase.from('je_zo_mappings').insert({
      je_user_id: jeUser.mobile_number,
      zo_user_id: zoUser.mobile_number,
      is_active: true,
      assigned_by: zoUser.mobile_number
    }).select('id').single();
    if (jeZoErr) console.error('P4-M3 JE-ZO Mapping error:', jeZoErr);
    jeZoMappingId = jeZoData?.id || null;

    // 1c. Work order mapping for JE (trigger checks je_zo_mappings)
    const { data: woMapData, error: woMapErr } = await supabase.from('work_order_mappings').insert({
      work_order_no: testWorkOrder,
      je_user_id: jeUser.mobile_number,
      is_active: true,
      reason: 'Assigned',
      assigned_by: zoUser.mobile_number
    }).select('id').single();
    if (woMapErr) console.error('P4-M3 WO Mapping error:', woMapErr);
    woMappingId = woMapData?.id || null;

    // 1d. Seed ZO balance so approve_requisition_transact can deduct
    await supabase.from('zo_balances').upsert({
      zo_user_id: zoUser.mobile_number,
      available_balance: 100000.00,
      updated_at: new Date().toISOString()
    });

    // 2. Create a Final Approved estimate header to provide a valid balance snapshot
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
        created_by: jeUser.mobile_number,
        last_modified_by: jeUser.mobile_number
      }])
      .select()
      .single();

    if (estErr) throw new Error(`Failed to create test estimate: ${estErr.message}`);
    estimateId = estData.estimate_id;
  });

  afterAll(async () => {
    if (woMappingId) await supabase.from('work_order_mappings').delete().eq('id', woMappingId);
    if (jeZoMappingId) await supabase.from('je_zo_mappings').delete().eq('id', jeZoMappingId);

    if (estimateId) {
      // Restore estimate status to allow deleting project/estimate reference
      await supabase.from('project_cost_estimates').update({
        estimate_status: 'Draft'
      }).eq('estimate_id', estimateId);

      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }

    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
  });

  async function createTestReq(reqNo, amount = 1000.00) {
    const req = {
      user: jeUser,
      body: {
        work_order_no: testWorkOrder,
        requisition_no: reqNo,
        material_main_head: 'Pipes',
        requisition_pdf_url: 'mock_requisition_path.pdf',
        original_filename: 'mock.pdf',
        requisition_amount: amount,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890'
      }
    };
    const res = mockRes();
    await createRequisition(req, res);
    if (res.statusCode !== 201) {
      throw new Error(`Failed to create test req: ${JSON.stringify(res.jsonData)}`);
    }
    return res.jsonData.requisition?.requisition_id || null;
  }

  describe('Requisition Actions (Approve & Hold)', () => {
    test('Test 1: Approves Pending requisition with correct balance calculations', async () => {
      createdId = await createTestReq(`REQ_M3_WF1_${suffix}`, 5000.00);

      const reqApprove = {
        user: zoUser,
        params: { id: createdId },
        body: {
          action: 'Approve',
          approved_amount: 4000.00,
          remarks_approved_authority: 'Approved partial amount'
        }
      };
      const resApprove = mockRes();
      await actOnRequisition(reqApprove, resApprove);

      expect(resApprove.statusCode).toBe(200);
      expect(resApprove.jsonData.success).toBe(true);

      const updated = resApprove.jsonData.requisition;
      expect(updated.requisition_status).toBe('Approved');
      expect(Number(updated.approved_amount)).toBe(4000.00);
      expect(Number(updated.approved_balance_amount)).toBe(1000.00);
    });

    test('Test 2: Places Pending requisition on Hold successfully with remarks', async () => {
      const holdId = await createTestReq(`REQ_M3_WF2_${suffix}`, 2000.00);

      const reqHold = {
        user: zoUser,
        params: { id: holdId },
        body: {
          action: 'Hold',
          remarks_approved_authority: 'Holding for document review'
        }
      };
      const resHold = mockRes();
      await actOnRequisition(reqHold, resHold);

      expect(resHold.statusCode).toBe(200);
      expect(resHold.jsonData.success).toBe(true);

      const updated = resHold.jsonData.requisition;
      expect(updated.requisition_status).toBe('Hold');
      expect(updated.approved_amount).toBeNull();
      expect(updated.remarks_approved_authority).toBe('Holding for document review');
    });

    test('Test 3: Blocks Hold action if approved_amount is passed with 400', async () => {
      const rejectHoldId = await createTestReq(`REQ_M3_WF3_${suffix}`, 2000.00);

      const reqRejectHold = {
        user: zoUser,
        params: { id: rejectHoldId },
        body: {
          action: 'Hold',
          approved_amount: 1000.00,
          remarks_approved_authority: 'Holding with amount'
        }
      };
      const resRejectHold = mockRes();
      await actOnRequisition(reqRejectHold, resRejectHold);

      expect(resRejectHold.statusCode).toBe(400);
      expect(resRejectHold.jsonData.message).toContain('must not be supplied');
    });

    test('Test 4: Blocks Approve action if approved_amount exceeds request with 400', async () => {
      const limitId = await createTestReq(`REQ_M3_WF4_${suffix}`, 1000.00);

      const reqLimit = {
        user: zoUser,
        params: { id: limitId },
        body: {
          action: 'Approve',
          approved_amount: 1500.00,
          remarks_approved_authority: 'Exceeding budget test'
        }
      };
      const resLimit = mockRes();
      await actOnRequisition(reqLimit, resLimit);

      expect(resLimit.statusCode).toBe(400);
      expect(resLimit.jsonData.message).toContain('exceed requisition amount');
    });

    test('Test 5: Blocks workflow action on an already Approved requisition with 409', async () => {
      expect(createdId).not.toBeNull();

      const reqNonPending = {
        user: zoUser,
        params: { id: createdId },
        body: {
          action: 'Hold',
          remarks_approved_authority: 'Try on non-pending'
        }
      };
      const resNonPending = mockRes();
      await actOnRequisition(reqNonPending, resNonPending);

      expect(resNonPending.statusCode).toBe(409);
    });
  });

  describe('Requisition Cancellations', () => {
    test('Test 6: Owner JE successfully cancels Pending requisition', async () => {
      const cancelId1 = await createTestReq(`REQ_M3_WF6_${suffix}`, 2000.00);

      const reqCancel1 = {
        user: jeUser,
        params: { id: cancelId1 }
      };
      const resCancel1 = mockRes();
      await cancelRequisition(reqCancel1, resCancel1);

      expect(resCancel1.statusCode).toBe(200);
      expect(resCancel1.jsonData.success).toBe(true);
      expect(resCancel1.jsonData.requisition.requisition_status).toBe('Cancelled');
    });

    test('Test 7: Admin successfully bypasses ownership to cancel Pending requisition', async () => {
      const cancelId2 = await createTestReq(`REQ_M3_WF7_${suffix}`, 2000.00);

      const reqCancel2 = {
        user: adminUser,
        params: { id: cancelId2 }
      };
      const resCancel2 = mockRes();
      await cancelRequisition(reqCancel2, resCancel2);

      expect(resCancel2.statusCode).toBe(200);
      expect(resCancel2.jsonData.success).toBe(true);
      expect(resCancel2.jsonData.requisition.requisition_status).toBe('Cancelled');
    });

    test('Test 8: Blocks non-owner JE from cancelling with 403', async () => {
      const cancelId3 = await createTestReq(`REQ_M3_WF8_${suffix}`, 2000.00);

      const reqCancel3 = {
        user: jeUser2,
        params: { id: cancelId3 }
      };
      const resCancel3 = mockRes();
      await cancelRequisition(reqCancel3, resCancel3);

      expect(resCancel3.statusCode).toBe(403);
    });
  });
});
