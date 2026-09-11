import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupAttachment = require('../../helpers/setupAttachment');
const mockRes = require('../../helpers/mockRes');

// Monkeypatch computeMainHeadCapacity BEFORE requiring the controller under test, so the
// controller's `const { computeMainHeadCapacity } = require(...)` destructure captures our
// wrapper. This lets us force a failure in the success-path code that runs AFTER
// create_requisition_secure has already committed the row — exactly the scenario the
// `rowCommitted` guard (backend/src/controllers/requisitions.controller.js) and the
// zo_user_id-in-RPC fold (migration 055) are meant to protect against, without introducing
// a mocking framework/convention this test suite doesn't otherwise use (it's real-local-DB
// integration testing throughout).
const mainHeadCapacityService = require('../../../src/services/mainHeadCapacity.service');
const originalComputeMainHeadCapacity = mainHeadCapacityService.computeMainHeadCapacity;
let forcePostCommitFailure = false;
mainHeadCapacityService.computeMainHeadCapacity = async (...args) => {
  if (forcePostCommitFailure) {
    throw new Error('Simulated post-commit failure (requisitionPostCommitAtomicity.test.js)');
  }
  return originalComputeMainHeadCapacity(...args);
};

const { createRequisition } = require('../../../src/controllers/requisitions.controller');

describe('Regression — requisition creation stays atomic across a post-commit failure', () => {
  let suffix;
  let zoMobile;
  let jeMobile;
  let adminMobile;
  let workOrder;
  let reqNo;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    zoMobile = `9601${suffix}`;
    jeMobile = `9602${suffix}`;
    adminMobile = `9603${suffix}`;
    workOrder = `WO-ATOMIC-${suffix}`;
    reqNo = `REQ-ATOMIC-${suffix}`;

    await setupUsers([
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` },
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` }
    ]);

    const { error: pErr } = await supabase.from('projects_master').insert([{
      work_order_no: workOrder,
      estimate_no: `EST-ATOMIC-${suffix}`,
      zo_user_id: zoMobile,
      site_details: `Site ${suffix}`,
      state: 'State',
      district: 'District',
      zone: 'Zone',
      department: 'Dept',
      created_by: adminMobile,
      edited_by: adminMobile,
      work_order_value: 100000.00,
      status: 'Running'
    }]);
    if (pErr) console.error('SETUP Project error:', pErr);

    const { data: estData, error: eErr } = await supabase.from('project_cost_estimates').insert([{
      work_order_no: workOrder,
      estimate_no: `EST-ATOMIC-${suffix}`,
      area_code: 'Zone',
      estimate_revision: 0,
      zonal_office_no: 'ZO-1',
      estimate_amount: 50000.00,
      estimate_status: 'Final Approved',
      created_by: jeMobile,
      last_modified_by: jeMobile
    }]).select().single();
    if (eErr) console.error('SETUP Estimate error:', eErr);
    const estimateId = estData?.estimate_id;

    if (estimateId) {
      const { error: itemErr } = await supabase.from('project_cost_estimate_items').insert([{
        estimate_id: estimateId,
        material_main_head: `Material ATOMIC-${suffix}`,
        material_sub_head: 'Subhead',
        material_details: 'Details',
        unit: 'Unit',
        qty: 10,
        rate: 5000,
        amount: 50000.00
      }]);
      if (itemErr) console.error('SETUP Estimate Item error:', itemErr);
    }

    const { error: mmErr } = await supabase.from('material_master').insert([{
      Material_Main_Head: `Material ATOMIC-${suffix}`,
      Material_Sub_Head: 'Subhead',
      Material_Details: 'Details',
      M_Unit: 'Unit',
      created_by: adminMobile
    }]);
    if (mmErr) console.error('SETUP Material Master error:', mmErr);

    const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert([{
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile
    }]);
    if (jeZoErr) console.error('SETUP JE-ZO Mapping error:', jeZoErr);

    const { error: woMapErr } = await supabase.from('work_order_mappings').insert([{
      work_order_no: workOrder,
      je_user_id: jeMobile,
      is_active: true,
      reason: 'Assigned',
      assigned_by: adminMobile
    }]);
    if (woMapErr) console.error('SETUP Work Order Mapping error:', woMapErr);
  });

  afterAll(async () => {
    mainHeadCapacityService.computeMainHeadCapacity = originalComputeMainHeadCapacity;

    await supabase.from('requisition_attachments').delete().eq('uploaded_by', jeMobile);
    await supabase.from('requisitions').delete().eq('work_order_no', workOrder);
    await supabase.from('project_cost_estimate_items').delete().eq('material_main_head', `Material ATOMIC-${suffix}`);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', workOrder);
    await supabase.from('material_master').delete().eq('Material_Main_Head', `Material ATOMIC-${suffix}`);
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrder);
    await supabase.from('authorised_users').delete().in('mobile_number', [zoMobile, jeMobile, adminMobile]);
  });

  test('a failure AFTER create_requisition_secure commits does not delete or corrupt the row', async () => {
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const payload = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: reqNo,
        material_main_head: `Material ATOMIC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId,
        original_filename: 'requisition.pdf',
        requisition_amount: 5000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ',
        expen_head_remarks: 'Remarks'
      }
    };

    forcePostCommitFailure = true;
    const res = mockRes();
    await createRequisition(payload, res);
    forcePostCommitFailure = false;

    // The forced failure happens after the RPC commits, so the controller must surface it
    // as an error response...
    expect(res.statusCode).toBe(500);

    // ...but the row itself must still exist, atomically committed by create_requisition_secure,
    // with zo_user_id set (migration 055's fold) and its PDF reference untouched (the
    // rowCommitted guard must have skipped cleanupUploadedFiles()).
    const { data: persisted, error } = await supabase
      .from('requisitions')
      .select('requisition_id, zo_user_id, requisition_pdf_url, requisition_status')
      .eq('requisition_no', reqNo)
      .maybeSingle();

    expect(error).toBeNull();
    expect(persisted).not.toBeNull();
    expect(persisted.zo_user_id).toBe(zoMobile);
    expect(persisted.requisition_pdf_url).toBe(attachment.storagePath);
    expect(persisted.requisition_status).toBe('Pending');

    // The attachment must also have been atomically claimed by the RPC (status ->
    // 'committed', requisition_id set) despite the post-commit failure — it's committed
    // inside the same transaction as the insert, before the forced failure ever runs.
    const { data: attRow } = await supabase
      .from('requisition_attachments')
      .select('status, requisition_id')
      .eq('attachment_id', attachment.attachmentId)
      .single();
    expect(attRow.status).toBe('committed');
    expect(attRow.requisition_id).toBe(persisted.requisition_id);
  });

  test('sanity: the same flow succeeds end-to-end when nothing fails post-commit', async () => {
    const okReqNo = `${reqNo}-OK`;
    const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const payload = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder,
        requisition_no: okReqNo,
        material_main_head: `Material ATOMIC-${suffix}`,
        requisition_pdf_attachment_id: attachment.attachmentId,
        original_filename: 'requisition.pdf',
        requisition_amount: 1000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ',
        expen_head_remarks: 'Remarks'
      }
    };

    const res = mockRes();
    await createRequisition(payload, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.requisition.zo_user_id).toBe(zoMobile);

    await supabase.from('requisitions').delete().eq('requisition_no', okReqNo);
    await supabase.from('requisition_attachments').delete().eq('attachment_id', attachment.attachmentId);
  });
});
