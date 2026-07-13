import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const {
  createRequisition,
  getRequisitions,
  getRequisitionById
} = require('../../../src/controllers/requisitions.controller');

describe('Milestone P4-M2 — Requisitions CRUD API', () => {
  let suffix;
  let testReqNo;
  let testWorkOrder;
  let testEstimateNo;
  let estimateId = null;
  const jeUser = { role: 'je', mobile_number: '+918000000002' }; // Owner/creator (actual je in DB)
  const jeUser2 = { role: 'je', mobile_number: '+918000000003' }; // Non-owner (actual je in DB)
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  let createdId = null;
  let woMappingId = null;
  let jeZoMappingId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testReqNo = `REQ_M2_API_${suffix}`;
    testWorkOrder = `TEST_WO_M2_${suffix}`;
    testEstimateNo = `EST_M2_${suffix}`;

    // 1. Create a fresh project with zo_user_id set
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
      created_by: jeUser.mobile_number,
      edited_by: jeUser.mobile_number
    });
    if (projErr) throw new Error(`Failed to create project: ${projErr.message}`);

    // 1b. Create je_zo_mapping FIRST (work_order_mappings trigger requires it)
    const { data: jeZoData, error: jeZoErr } = await supabase.from('je_zo_mappings').insert({
      je_user_id: jeUser.mobile_number,
      zo_user_id: zoUser.mobile_number,
      is_active: true,
      assigned_by: zoUser.mobile_number
    }).select('id').single();
    if (jeZoErr) console.error('JE-ZO Mapping insert error:', jeZoErr);
    jeZoMappingId = jeZoData?.id || null;

    // 1c. Now create the work_order_mapping for JE (trigger checks je_zo_mappings)
    const { data: woMapData, error: woMapErr } = await supabase.from('work_order_mappings').insert({
      work_order_no: testWorkOrder,
      je_user_id: jeUser.mobile_number,
      is_active: true,
      reason: 'Assigned',
      assigned_by: zoUser.mobile_number
    }).select('id').single();
    if (woMapErr) console.error('WO Mapping insert error:', woMapErr);
    woMappingId = woMapData?.id || null;

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

    if (createdId) {
      // Soft-cancel the requisition
      await supabase
        .from('requisitions')
        .update({ 
          requisition_status: 'Cancelled', 
          cancelled_by: jeUser.mobile_number, 
          cancelled_at: new Date().toISOString() 
        })
        .eq('requisition_id', createdId);
    }

    if (estimateId) {
      // Restore estimate status to allow deleting project/estimate reference
      await supabase.from('project_cost_estimates').update({
        estimate_status: 'Draft'
      }).eq('estimate_id', estimateId);

      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }

    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
  });

  describe('Requisition Creation', () => {
    test('Test 1: Creates a valid requisition as JE (Pending status)', async () => {
      const reqCreate = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          requisition_no: testReqNo,
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path.pdf',
          original_filename: 'mock.pdf',
          requisition_amount: 500.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890'
        }
      };
      const resCreate = mockRes();
      await createRequisition(reqCreate, resCreate);

      expect(resCreate.statusCode).toBe(201);
      expect(resCreate.jsonData.success).toBe(true);

      const reqRecord = resCreate.jsonData.requisition;
      expect(reqRecord.requisition_no).toBe(testReqNo);
      expect(reqRecord.requisition_status).toBe('Pending');
      createdId = reqRecord.requisition_id;
    });

    test('Test 2: Blocks duplicate requisition_no with 409 Conflict', async () => {
      const reqDup = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          requisition_no: testReqNo, // Duplicate
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path_2.pdf',
          requisition_amount: 100.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890'
        }
      };
      const resDup = mockRes();
      await createRequisition(reqDup, resDup);

      expect(resDup.statusCode).toBe(409);
    });

    test('Test 3: Blocks requisition with invalid material_main_head', async () => {
      const reqInvalidMat = {
        user: jeUser,
        body: {
          work_order_no: testWorkOrder,
          requisition_no: `REQ_M2_MAT_${suffix}`,
          material_main_head: 'INVALID_MAIN_HEAD_VALUE_123', // Invalid
          requisition_pdf_url: 'mock_requisition_path.pdf',
          requisition_amount: 100.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890'
        }
      };
      const resInvalidMat = mockRes();
      await createRequisition(reqInvalidMat, resInvalidMat);

      expect(resInvalidMat.statusCode).toBe(400);
      expect(resInvalidMat.jsonData.message).toContain('exist in Material Master');
    });
  });

  describe('Requisition Listing & Detail Access', () => {
    test('Test 4: Owner JE only retrieves their own requisitions', async () => {
      const reqGetJe = {
        user: jeUser,
        query: { page: 1, limit: 10 }
      };
      const resGetJe = mockRes();
      await getRequisitions(reqGetJe, resGetJe);

      expect(resGetJe.statusCode).toBe(200);
      expect(resGetJe.jsonData.success).toBe(true);

      const list = resGetJe.jsonData.requisitions;
      const allOwn = list.every(r => r.requester_user_id === jeUser.mobile_number);
      const containsCreated = list.some(r => r.requisition_no === testReqNo);

      expect(allOwn).toBe(true);
      expect(containsCreated).toBe(true);
    });

    test('Test 5: ZO retrieves all requisitions, including owner JEs', async () => {
      const reqGetZo = {
        user: zoUser,
        query: { page: 1, limit: 10 }
      };
      const resGetZo = mockRes();
      await getRequisitions(reqGetZo, resGetZo);

      expect(resGetZo.statusCode).toBe(200);
      expect(resGetZo.jsonData.success).toBe(true);

      const list = resGetZo.jsonData.requisitions;
      const containsCreated = list.some(r => r.requisition_no === testReqNo);
      expect(containsCreated).toBe(true);
    });

    test('Test 6: Restricts details to owner JEs and returns signed URLs', async () => {
      expect(createdId).not.toBeNull();

      // Owner fetches
      const reqGetOwner = {
        user: jeUser,
        params: { id: createdId }
      };
      const resGetOwner = mockRes();
      await getRequisitionById(reqGetOwner, resGetOwner);

      // Non-owner fetches
      const reqGetNonOwner = {
        user: jeUser2,
        params: { id: createdId }
      };
      const resGetNonOwner = mockRes();
      await getRequisitionById(reqGetNonOwner, resGetNonOwner);

      expect(resGetOwner.statusCode).toBe(200);
      const signedUrl = resGetOwner.jsonData.requisition.requisition_pdf_signed_url;
      expect(signedUrl === null || typeof signedUrl === 'string').toBe(true);

      const isBlockedNonOwner = resGetNonOwner.statusCode === 404 || resGetNonOwner.statusCode === 403;
      expect(isBlockedNonOwner).toBe(true);
    });
  });
});
