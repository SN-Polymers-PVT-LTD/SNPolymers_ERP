import { describe, test, expect, beforeAll, afterAll } from 'vitest';
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
const { createRequisition } = require('../../../src/controllers/requisitions.controller');

describe('Regression — requisition_attachments lifecycle (upload -> claim / delete)', () => {
  let suffix;
  let jeMobile;
  let otherJeMobile;
  let adminMobile;
  let zoMobile;
  let workOrder;

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
        bank_details: 'Bank XYZ'
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

    await supabase.from('requisitions').delete().eq('requisition_no', reqNo);
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
        bank_details: 'Bank XYZ'
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
        bank_details: 'Bank XYZ'
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
        bank_details: 'Bank XYZ'
      }
    }, secondRes);

    expect(secondRes.statusCode).toBe(400);

    await supabase.from('requisitions').delete().in('requisition_no', [firstReqNo, secondReqNo]);
  });
});
