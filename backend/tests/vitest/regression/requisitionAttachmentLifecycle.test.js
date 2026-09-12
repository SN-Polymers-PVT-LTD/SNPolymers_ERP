import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const setupAttachment = require('../../helpers/setupAttachment');
const mockRes = require('../../helpers/mockRes');

const {
  uploadRequisitionPdf,
  deleteRequisitionPdf
} = require('../../../src/controllers/requisitions.uploads.controller');
const { createRequisition, cancelRequisition, retryCancelledRequisitionAttachmentCleanup } = require('../../../src/controllers/requisitions.controller');

describe('Regression — requisition_attachments lifecycle (upload -> claim / delete)', () => {
  let suffix;
  let jeMobile;
  let otherJeMobile;
  let adminMobile;
  let zoMobile;
  let workOrder;
  let bankId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9701${suffix}`;
    otherJeMobile = `9702${suffix}`;
    adminMobile = `9703${suffix}`;
    zoMobile = `9704${suffix}`;
    workOrder = `WO-ATTLC-${suffix}`;

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: otherJeMobile, role: 'je', is_active: true, display_name: `Other JE ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` }
    ]);

    const { data: bank, error: bankError } = await supabase
      .from('indian_bank_master')
      .select('id')
      .eq('bank_name', 'State Bank of India')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (bankError || !bank) throw bankError || new Error('Test bank not found');
    bankId = bank.id;

    await setupProject(workOrder, `EST-ATTLC-${suffix}`, 100000.00, adminMobile);
    await supabase.from('projects_master').update({ zo_user_id: zoMobile }).eq('work_order_no', workOrder);

    const { error: eErr } = await supabase.from('project_cost_estimates').insert([{
      work_order_no: workOrder,
      estimate_no: `EST-ATTLC-${suffix}`,
      area_code: 'Zone',
      estimate_revision: 0,
      zonal_office_no: 'ZO-1',
      estimate_amount: 50000.00,
      estimate_status: 'Final Approved',
      created_by: jeMobile,
      last_modified_by: jeMobile
    }]);
    if (eErr) console.error('SETUP Estimate error:', eErr);

    const { data: estRow } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .eq('work_order_no', workOrder)
      .single();

    await supabase.from('project_cost_estimate_items').insert([{
      estimate_id: estRow.estimate_id,
      material_main_head: `Material ATTLC-${suffix}`,
      material_sub_head: 'Subhead',
      material_details: 'Details',
      unit: 'Unit',
      qty: 10,
      rate: 5000,
      amount: 50000.00
    }]);

    await supabase.from('material_master').insert([{
      Material_Main_Head: `Material ATTLC-${suffix}`,
      Material_Sub_Head: 'Subhead',
      Material_Details: 'Details',
      M_Unit: 'Unit',
      created_by: adminMobile
    }]);

    const { error: jzErr } = await supabase.from('je_zo_mappings').insert([{
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile
    }]);
    if (jzErr) console.error('SETUP je_zo_mappings error:', jzErr);

    const { error: womErr } = await supabase.from('work_order_mappings').insert([{
      work_order_no: workOrder,
      je_user_id: jeMobile,
      is_active: true,
      reason: 'Assigned',
      assigned_by: adminMobile
    }]);
    if (womErr) console.error('SETUP work_order_mappings error:', womErr);
  });

  afterAll(async () => {
    await supabase.from('requisition_attachments').delete().in('uploaded_by', [jeMobile, otherJeMobile]);
    await supabase.from('requisitions').delete().eq('work_order_no', workOrder);
    await supabase.from('project_cost_estimate_items').delete().eq('material_main_head', `Material ATTLC-${suffix}`);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', workOrder);
    await supabase.from('material_master').delete().eq('Material_Main_Head', `Material ATTLC-${suffix}`);
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, otherJeMobile, adminMobile, zoMobile]);
  });

  test('upload creates a pending, unclaimed attachment row', async () => {
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: { requisition_no: `REQ-ATTLC-UP-${suffix}` },
      file: {
        fieldname: 'file',
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 test'),
        size: 14
      }
    };
    const res = mockRes();
    await uploadRequisitionPdf(req, res);

    expect(res.statusCode).toBe(201);
    const { data: row } = await supabase
      .from('requisition_attachments')
      .select('status, requisition_id, uploaded_by')
      .eq('attachment_id', res.jsonData.attachmentId)
      .single();
    expect(row.status).toBe('pending');
    expect(row.requisition_id).toBeNull();
    expect(row.uploaded_by).toBe(jeMobile);

    await supabase.storage.from('requisition-pdfs').remove([res.jsonData.storagePath]);
    await supabase.from('requisition_attachments').delete().eq('attachment_id', res.jsonData.attachmentId);
  });

  test('delete rejects a caller who does not own the attachment with 403', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const req = {
      user: { mobile_number: otherJeMobile, role: 'je' },
      body: { attachment_id: attachment.attachmentId }
    };
    const res = mockRes();
    await deleteRequisitionPdf(req, res);

    expect(res.statusCode).toBe(403);

    const { data: row } = await supabase
      .from('requisition_attachments')
      .select('status')
      .eq('attachment_id', attachment.attachmentId)
      .maybeSingle();
    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');
  });

  test('delete of an already-committed attachment is rejected with 409', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    await supabase
      .from('requisition_attachments')
      .update({ status: 'committed', committed_at: new Date().toISOString() })
      .eq('attachment_id', attachment.attachmentId);

    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: { attachment_id: attachment.attachmentId }
    };
    const res = mockRes();
    await deleteRequisitionPdf(req, res);

    expect(res.statusCode).toBe(409);

    await supabase.from('requisition_attachments').delete().eq('attachment_id', attachment.attachmentId);
  });

  test('createRequisition claims a valid pending attachment atomically (status -> committed, requisition_id set)', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const reqNo = `REQ-ATTLC-CLAIM-${suffix}`;
    const { error: storageUploadError } = await supabase.storage
      .from('requisition-pdfs')
      .upload(attachment.storagePath, Buffer.from('%PDF-1.4 committed-test'), { contentType: 'application/pdf' });
    if (storageUploadError) throw storageUploadError;
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: reqNo,
        material_main_head: `Material ATTLC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId,
        original_filename: 'test.pdf',
        requisition_amount: 1000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ', beneficiary_name: 'Attachment Test Beneficiary', beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(201);
    const { data: row } = await supabase
      .from('requisition_attachments')
      .select('status, requisition_id')
      .eq('attachment_id', attachment.attachmentId)
      .single();
    expect(row.status).toBe('committed');
    expect(row.requisition_id).toBe(res.jsonData.requisition.requisition_id);

    const deleteRes = mockRes();
    await deleteRequisitionPdf({ user: { mobile_number: jeMobile, role: 'je' }, body: { attachment_id: attachment.attachmentId } }, deleteRes);
    expect(deleteRes.statusCode).toBe(409);
    const { data: storedFile, error: downloadError } = await supabase.storage
      .from('requisition-pdfs').download(attachment.storagePath);
    expect(downloadError).toBeNull();
    expect(storedFile).not.toBeNull();

    await supabase.from('requisitions').delete().eq('requisition_no', reqNo);
    await supabase.storage.from('requisition-pdfs').remove([attachment.storagePath]);
    await supabase.from('requisition_attachments').delete().eq('attachment_id', attachment.attachmentId);
  });

  test('a deleting attachment can be resumed and finalized without returning to pending', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const first = await supabase.rpc('acquire_requisition_attachment_delete', {
      p_attachment_id: attachment.attachmentId, p_actor: jeMobile, p_kind: 'requisition_pdf'
    });
    expect(first.error).toBeNull();
    expect(first.data.status).toBe('deleting');

    const resumed = await supabase.rpc('acquire_requisition_attachment_delete', {
      p_attachment_id: attachment.attachmentId, p_actor: jeMobile, p_kind: 'requisition_pdf'
    });
    expect(resumed.error).toBeNull();
    expect(resumed.data.status).toBe('deleting');

    const finalized = await supabase.rpc('finalize_requisition_attachment_delete', {
      p_attachment_id: attachment.attachmentId
    });
    expect(finalized.error).toBeNull();
    expect(finalized.data).toBe(true);
  });

  test('cancelled requisition cleanup claims committed attachments and is retryable', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const reqNo = `REQ-ATTLC-CANCEL-${suffix}`;
    const { error: uploadError } = await supabase.storage.from('requisition-pdfs').upload(
      attachment.storagePath, Buffer.from('%PDF-1.4 cancellation-test'), { contentType: 'application/pdf' }
    );
    expect(uploadError).toBeNull();
    const createRes = mockRes();
    await createRequisition({
      user: { mobile_number: jeMobile, role: 'je' },
      body: { work_order_no: workOrder, requisition_no: reqNo, material_main_head: `Material ATTLC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId, original_filename: 'cancel.pdf',
        requisition_amount: 1000, gst_bill: 'No', bank_details: 'Bank XYZ', beneficiary_name: 'Attachment Test Beneficiary', beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId }
    }, createRes);
    expect(createRes.statusCode).toBe(201);
    const requisitionId = createRes.jsonData.requisition.requisition_id;
    const { error: cancelError } = await supabase.from('requisitions').update({ requisition_status: 'Cancelled' }).eq('requisition_id', requisitionId);
    expect(cancelError).toBeNull();

    const claimed = await supabase.rpc('acquire_cancelled_requisition_attachment_cleanup', {
      p_requisition_id: requisitionId, p_actor: jeMobile
    });
    expect(claimed.error).toBeNull();
    expect(claimed.data).toHaveLength(1);
    expect(claimed.data[0].status).toBe('deleting');

    const resumed = await supabase.rpc('acquire_cancelled_requisition_attachment_cleanup', {
      p_requisition_id: requisitionId, p_actor: jeMobile
    });
    expect(resumed.error).toBeNull();
    expect(resumed.data).toHaveLength(1);
    expect((await supabase.rpc('finalize_requisition_attachment_delete', { p_attachment_id: attachment.attachmentId })).data).toBe(true);
    await supabase.storage.from('requisition-pdfs').remove([attachment.storagePath]);
    await supabase.from('requisitions').delete().eq('requisition_id', requisitionId);
  });

  async function createCommittedRequisition(attachment, reqNo) {
    const { error: uploadError } = await supabase.storage.from('requisition-pdfs').upload(
      attachment.storagePath, Buffer.from('%PDF-1.4 failure-test'), { contentType: 'application/pdf' }
    );
    expect(uploadError).toBeNull();
    const response = mockRes();
    await createRequisition({
      user: { mobile_number: jeMobile, role: 'je' },
      body: { work_order_no: workOrder, requisition_no: reqNo, material_main_head: `Material ATTLC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId, original_filename: 'failure.pdf',
        requisition_amount: 1000, gst_bill: 'No', bank_details: 'Bank XYZ', beneficiary_name: 'Attachment Test Beneficiary', beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId }
    }, response);
    expect(response.statusCode).toBe(201);
    return response.jsonData.requisition.requisition_id;
  }

  test('Storage failure leaves cancellation successful and cleanup retryable', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const requisitionId = await createCommittedRequisition(attachment, `REQ-ATTLC-STORAGE-FAIL-${suffix}`);
    const storageFrom = vi.spyOn(supabase.storage, 'from').mockReturnValue({
      remove: vi.fn().mockResolvedValue({ error: { message: 'simulated storage outage' } })
    });
    const cancelRes = mockRes();
    await cancelRequisition({ params: { id: requisitionId }, body: {}, user: { mobile_number: jeMobile, role: 'je' } }, cancelRes);
    storageFrom.mockRestore();
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.jsonData.cleanup_pending).toBe(true);
    const { data: deleting } = await supabase.from('requisition_attachments').select('status').eq('attachment_id', attachment.attachmentId).single();
    expect(deleting.status).toBe('deleting');

    const retryRes = mockRes();
    await retryCancelledRequisitionAttachmentCleanup({ params: { id: requisitionId }, user: { mobile_number: jeMobile, role: 'je' } }, retryRes);
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.jsonData.cleanup_pending).toBe(false);
    const { data: removed } = await supabase.from('requisition_attachments').select('attachment_id').eq('attachment_id', attachment.attachmentId).maybeSingle();
    expect(removed).toBeNull();
    await supabase.from('requisitions').delete().eq('requisition_id', requisitionId);
  });

  test('cleanup-acquire failure still returns successful cancellation', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const reqNo = `REQ-ATTLC-ACQUIRE-FAIL-${suffix}`;
    const requisitionId = await createCommittedRequisition(attachment, reqNo);
    const originalRpc = supabase.rpc.bind(supabase);
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation(async (name, args) => {
      if (name === 'acquire_cancelled_requisition_attachment_cleanup') return { data: null, error: { message: 'simulated acquire outage' } };
      return originalRpc(name, args);
    });
    const cancelRes = mockRes();
    await cancelRequisition({ params: { id: requisitionId }, body: {}, user: { mobile_number: jeMobile, role: 'je' } }, cancelRes);
    rpcSpy.mockRestore();
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.jsonData.success).toBe(true);
    expect(cancelRes.jsonData.cleanup_pending).toBe(true);
    await supabase.from('requisition_attachments').delete().eq('attachment_id', attachment.attachmentId);
    await supabase.from('requisitions').delete().eq('requisition_id', requisitionId);
  });

  test('finalize failure leaves deleting metadata and retry removes it after Storage succeeded', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const requisitionId = await createCommittedRequisition(attachment, `REQ-ATTLC-FINALIZE-FAIL-${suffix}`);
    const originalRpc = supabase.rpc.bind(supabase);
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation(async (name, args) => {
      if (name === 'finalize_requisition_attachment_delete') return { data: null, error: { message: 'simulated finalize outage' } };
      return originalRpc(name, args);
    });
    const cancelRes = mockRes();
    await cancelRequisition({ params: { id: requisitionId }, body: {}, user: { mobile_number: jeMobile, role: 'je' } }, cancelRes);
    rpcSpy.mockRestore();
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.jsonData.cleanup_pending).toBe(true);
    const { data: deleting } = await supabase.from('requisition_attachments').select('status').eq('attachment_id', attachment.attachmentId).single();
    expect(deleting.status).toBe('deleting');

    const retryRes = mockRes();
    await retryCancelledRequisitionAttachmentCleanup({ params: { id: requisitionId }, user: { mobile_number: jeMobile, role: 'je' } }, retryRes);
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.jsonData.cleanup_pending).toBe(false);
    const { data: removed } = await supabase.from('requisition_attachments').select('attachment_id').eq('attachment_id', attachment.attachmentId).maybeSingle();
    expect(removed).toBeNull();
    await supabase.from('requisitions').delete().eq('requisition_id', requisitionId);
  });

  test('createRequisition rejects an attachment id owned by a different user with 400', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: otherJeMobile });
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: `REQ-ATTLC-XUSER-${suffix}`,
        material_main_head: `Material ATTLC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId,
        original_filename: 'test.pdf',
        requisition_amount: 1000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ', beneficiary_name: 'Attachment Test Beneficiary', beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(400);

    const { data: row } = await supabase
      .from('requisition_attachments')
      .select('status, requisition_id')
      .eq('attachment_id', attachment.attachmentId)
      .single();
    expect(row.status).toBe('pending');
    expect(row.requisition_id).toBeNull();
  });

  test('createRequisition rejects reusing an already-committed attachment with 400', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const firstReqNo = `REQ-ATTLC-REUSE1-${suffix}`;
    const firstRes = mockRes();
    await createRequisition({
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: firstReqNo,
        material_main_head: `Material ATTLC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId,
        original_filename: 'test.pdf',
        requisition_amount: 1000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ', beneficiary_name: 'Attachment Test Beneficiary', beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId
      }
    }, firstRes);
    expect(firstRes.statusCode).toBe(201);

    const secondReqNo = `REQ-ATTLC-REUSE2-${suffix}`;
    const secondRes = mockRes();
    await createRequisition({
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: secondReqNo,
        material_main_head: `Material ATTLC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId,
        original_filename: 'test.pdf',
        requisition_amount: 1000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ', beneficiary_name: 'Attachment Test Beneficiary', beneficiary_ac_no: '9876543210', beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: bankId
      }
    }, secondRes);

    expect(secondRes.statusCode).toBe(400);

    await supabase.from('requisitions').delete().in('requisition_no', [firstReqNo, secondReqNo]);
  });
});
