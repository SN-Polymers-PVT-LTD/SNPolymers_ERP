import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const setupAttachment = require('../../helpers/setupAttachment');
const mockRes = require('../../helpers/mockRes');
const { getActiveTestBankId, validRequisitionBeneficiary } = require('../../helpers/requisitionTestFixtures');

const {
  createRequisition,
  cancelRequisition
} = require('../../../src/controllers/requisitions.controller');
const {
  uploadRequisitionPdf
} = require('../../../src/controllers/requisitions.uploads.controller');

describe('Regression — Cancelled requisition number reuse and storage cleanup', () => {
  let suffix;
  let jeMobile;
  let adminMobile;
  let zoMobile;
  let workOrder;
  let reqNo;
  let testBankId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9711${suffix}`;
    adminMobile = `9713${suffix}`;
    zoMobile = `9714${suffix}`;
    workOrder = `WO-REUSE-${suffix}`;
    reqNo = `REQ-REUSE-${suffix}`;
    testBankId = await getActiveTestBankId(supabase);

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` }
    ]);

    await setupProject(workOrder, `EST-REUSE-${suffix}`, 100000.00, adminMobile);
    await supabase.from('projects_master').update({ zo_user_id: zoMobile }).eq('work_order_no', workOrder);

    await supabase.from('project_cost_estimates').insert([{
      work_order_no: workOrder,
      estimate_no: `EST-REUSE-${suffix}`,
      area_code: 'Zone',
      estimate_revision: 0,
      zonal_office_no: 'ZO-1',
      estimate_amount: 50000.00,
      estimate_status: 'Final Approved',
      created_by: jeMobile,
      last_modified_by: jeMobile
    }]);

    const { data: estRow } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .eq('work_order_no', workOrder)
      .single();

    await supabase.from('project_cost_estimate_items').insert([{
      estimate_id: estRow.estimate_id,
      material_main_head: `Material REUSE-${suffix}`,
      material_sub_head: 'Subhead',
      material_details: 'Details',
      unit: 'Unit',
      qty: 10,
      rate: 5000,
      amount: 50000.00
    }]);

    await supabase.from('material_master').insert([{
      Material_Main_Head: `Material REUSE-${suffix}`,
      Material_Sub_Head: 'Subhead',
      Material_Details: 'Details',
      M_Unit: 'Unit',
      created_by: adminMobile
    }]);

    await supabase.from('je_zo_mappings').insert([{
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile
    }]);

    await supabase.from('work_order_mappings').insert([{
      work_order_no: workOrder,
      je_user_id: jeMobile,
      is_active: true,
      reason: 'Assigned',
      assigned_by: adminMobile
    }]);
  });

  afterAll(async () => {
    await supabase.from('requisition_attachments').delete().eq('uploaded_by', jeMobile);
    await supabase.from('requisitions').delete().eq('work_order_no', workOrder);
    await supabase.from('project_cost_estimate_items').delete().eq('material_main_head', `Material REUSE-${suffix}`);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', workOrder);
    await supabase.from('material_master').delete().eq('Material_Main_Head', `Material REUSE-${suffix}`);
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, adminMobile, zoMobile]);
  });

  test('full lifecycle: create -> cancel (cleans storage and clears URLs) -> recreate with same requisition_no', async () => {
    // 1. Upload initial PDF
    const uploadReq = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: { requisition_no: reqNo },
      file: {
        fieldname: 'file',
        originalname: 'first.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 first-version'),
        size: 24
      }
    };
    const uploadRes = mockRes();
    await uploadRequisitionPdf(uploadReq, uploadRes);
    expect(uploadRes.statusCode).toBe(201);
    const firstAttachmentId = uploadRes.jsonData.attachmentId;
    const firstStoragePath = uploadRes.jsonData.storagePath;

    // 2. Create Requisition #1
    const createReq1 = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: reqNo,
        material_main_head: `Material REUSE-${suffix}`,
        requisition_pdf_attachment_id: firstAttachmentId,
        original_filename: 'first.pdf',
        requisition_amount: 1000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ',
        ...validRequisitionBeneficiary(testBankId)
      }
    };
    const createRes1 = mockRes();
    await createRequisition(createReq1, createRes1);
    expect(createRes1.statusCode).toBe(201);
    const req1Id = createRes1.jsonData.requisition.requisition_id;

    // Verify attachment is committed
    const { data: committedAtt } = await supabase
      .from('requisition_attachments')
      .select('status, requisition_id')
      .eq('attachment_id', firstAttachmentId)
      .single();
    expect(committedAtt.status).toBe('committed');
    expect(committedAtt.requisition_id).toBe(req1Id);

    // 3. Cancel Requisition #1
    const cancelReq = {
      user: { mobile_number: jeMobile, role: 'je' },
      params: { id: req1Id }
    };
    const cancelRes = mockRes();
    await cancelRequisition(cancelReq, cancelRes);
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.jsonData.cleanup_pending).toBe(false);

    // Verify Requisition #1 in database: status Cancelled, URLs null
    const { data: req1Row } = await supabase
      .from('requisitions')
      .select('requisition_status, requisition_pdf_url, gst_bill_pdf_url')
      .eq('requisition_id', req1Id)
      .single();
    expect(req1Row.requisition_status).toBe('Cancelled');
    expect(req1Row.requisition_pdf_url).toBeNull();
    expect(req1Row.gst_bill_pdf_url).toBeNull();

    // Verify attachment row was deleted
    const { data: deletedAtt } = await supabase
      .from('requisition_attachments')
      .select('*')
      .eq('attachment_id', firstAttachmentId)
      .maybeSingle();
    expect(deletedAtt).toBeNull();

    // 4. Upload a second PDF for the SAME requisition_no
    const uploadReq2 = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: { requisition_no: reqNo },
      file: {
        fieldname: 'file',
        originalname: 'second.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 second-version'),
        size: 25
      }
    };
    const uploadRes2 = mockRes();
    await uploadRequisitionPdf(uploadReq2, uploadRes2);
    expect(uploadRes2.statusCode).toBe(201);
    const secondAttachmentId = uploadRes2.jsonData.attachmentId;

    // 5. Recreate Requisition #2 with the SAME requisition_no
    const createReq2 = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: reqNo,
        material_main_head: `Material REUSE-${suffix}`,
        requisition_pdf_attachment_id: secondAttachmentId,
        original_filename: 'second.pdf',
        requisition_amount: 1200.00,
        gst_bill: 'No',
        bank_details: 'Bank ABC',
        ...validRequisitionBeneficiary(testBankId)
      }
    };
    const createRes2 = mockRes();
    await createRequisition(createReq2, createRes2);
    expect(createRes2.statusCode).toBe(201);
    const req2Id = createRes2.jsonData.requisition.requisition_id;
    expect(req2Id).not.toBe(req1Id);

    // 6. Verify duplicate active requisition is rejected
    const uploadReq3 = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: { requisition_no: reqNo },
      file: {
        fieldname: 'file',
        originalname: 'third.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 third-version'),
        size: 24
      }
    };
    const uploadRes3 = mockRes();
    await uploadRequisitionPdf(uploadReq3, uploadRes3);
    expect(uploadRes3.statusCode).toBe(201);

    const createReq3 = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: reqNo,
        material_main_head: `Material REUSE-${suffix}`,
        requisition_pdf_attachment_id: uploadRes3.jsonData.attachmentId,
        original_filename: 'third.pdf',
        requisition_amount: 1500.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ',
        ...validRequisitionBeneficiary(testBankId)
      }
    };
    const createRes3 = mockRes();
    await createRequisition(createReq3, createRes3);
    expect(createRes3.statusCode).toBe(409);
    expect(createRes3.jsonData.message).toMatch(/already exists/i);

    // Clean up temporary storage and attachments
    await supabase.storage.from('requisition-pdfs').remove([uploadRes3.jsonData.storagePath]);
    await supabase.from('requisition_attachments').delete().eq('attachment_id', uploadRes3.jsonData.attachmentId);

    // 7. Cancelling an already cancelled requisition is rejected
    const doubleCancelReq = {
      user: { mobile_number: jeMobile, role: 'je' },
      params: { id: req1Id }
    };
    const doubleCancelRes = mockRes();
    await cancelRequisition(doubleCancelReq, doubleCancelRes);
    expect(doubleCancelRes.statusCode).toBe(403);
    expect(doubleCancelRes.jsonData.message).toMatch(/Only Pending or Hold requisitions can be cancelled/i);

    // 8. Direct database unique index violation check:
    // Attempting to directly insert an active requisition with the duplicate requisition_no
    // should fail at the Postgres partial unique index (uq_requisitions_active_requisition_no)
    const { data: activeRow } = await supabase
      .from('requisitions')
      .select('*')
      .eq('requisition_id', req2Id)
      .single();

    const { requisition_id, created_at, ...insertPayload } = activeRow;
    const { error: directInsertError } = await supabase.from('requisitions').insert([insertPayload]);
    expect(directInsertError).not.toBeNull();
    expect(directInsertError.code).toBe('23505'); // unique_violation: uq_requisitions_active_requisition_no
  });
});
