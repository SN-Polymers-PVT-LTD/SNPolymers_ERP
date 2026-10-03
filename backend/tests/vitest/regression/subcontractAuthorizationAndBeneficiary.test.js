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
  getSubcontractFinanceCapacity
} = require('../../../src/controllers/requisitions.controller');

describe('Regression — Subcontract Finance Capacity Authorization & Beneficiary Master Resolution', () => {
  let suffix;
  let jeMobile;
  let zoMobile;
  let hoMobile;
  let adminMobile;
  let workOrderA;
  let workOrderB;
  let testBankId;
  let testBankRow;
  let subWork;
  let subContractor;
  let masterBeneficiary;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9811${suffix}`;
    zoMobile = `9812${suffix}`;
    hoMobile = `9813${suffix}`;
    adminMobile = `9814${suffix}`;
    workOrderA = `WO-AUTH-A-${suffix}`;
    workOrderB = `WO-AUTH-B-${suffix}`;

    testBankId = await getActiveTestBankId(supabase);
    const { data: bankData } = await supabase
      .from('indian_bank_master')
      .select('id, bank_name')
      .eq('id', testBankId)
      .single();
    testBankRow = bankData;

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` },
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `HO ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` }
    ]);

    await setupProject(workOrderA, `EST-A-${suffix}`, 500000.00, adminMobile);
    await setupProject(workOrderB, `EST-B-${suffix}`, 500000.00, adminMobile);

    const { error: updErr } = await supabase.from('projects_master').update({ zo_user_id: zoMobile }).in('work_order_no', [workOrderA, workOrderB]);
    if (updErr) throw updErr;

    // Active JE-ZO mapping
    const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert([{
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile
    }]);
    if (jeZoErr) throw jeZoErr;

    // JE mapped ONLY to workOrderA (not workOrderB)
    const { error: woMapErr } = await supabase.from('work_order_mappings').insert([{
      work_order_no: workOrderA,
      je_user_id: jeMobile,
      is_active: true,
      reason: 'Assigned',
      assigned_by: adminMobile
    }]);
    if (woMapErr) throw woMapErr;

    // Create Final Approved estimate for workOrderA for requisitions
    const { data: estRow, error: peErr } = await supabase.from('project_cost_estimates').insert([{
      work_order_no: workOrderA,
      estimate_no: `EST-A-${suffix}`,
      area_code: 'Zone',
      estimate_revision: 0,
      zonal_office_no: 'ZO-1',
      estimate_amount: 100000.00,
      estimate_status: 'Final Approved',
      created_by: adminMobile,
      last_modified_by: adminMobile
    }]).select('estimate_id').single();
    if (peErr) throw peErr;

    const { error: itemErr } = await supabase.from('project_cost_estimate_items').insert([{
      estimate_id: estRow.estimate_id,
      material_main_head: `Mat-${suffix}`,
      material_sub_head: 'General',
      material_details: 'Items',
      unit: 'Nos',
      qty: 10,
      rate: 10000,
      amount: 100000.00
    }]);
    if (itemErr) throw itemErr;

    // Material master row for non-subcontract requisitions
    await supabase.from('material_master').insert([{
      Material_Main_Head: `Mat-${suffix}`,
      Material_Sub_Head: 'General',
      Material_Details: 'Items',
      M_Unit: 'Nos',
      created_by: adminMobile
    }]);

    // Subcontract masters
    const { data: cData } = await supabase.from('subcontractor_master').insert([{
      subcontractor_name: `Contractor-${suffix}`,
      created_by: adminMobile
    }]).select('id').single();
    subContractor = cData;

    const { data: wData } = await supabase.from('subcontract_work_master').insert([{
      sub_head: `WorkSub-${suffix}`,
      material_details: `WorkDet-${suffix}`,
      unit: 'Mtr',
      created_by: adminMobile
    }]).select('id').single();
    subWork = wData;

    // Shared beneficiary master row for testing authoritative resolution
    const { data: bData } = await supabase.from('projects_beneficiary_master').insert([{
      beneficiary_name: `Master Beneficiary ${suffix}`,
      beneficiary_ac_no: '987654321012',
      beneficiary_ifsc: 'HDFC0001234',
      beneficiary_bank_id: testBankRow.id,
      beneficiary_bank_name: testBankRow.bank_name,
      created_by: adminMobile
    }]).select('*').single();
    masterBeneficiary = bData;
  });

  afterAll(async () => {
    await supabase.from('requisition_attachments').delete().eq('uploaded_by', jeMobile);
    await supabase.from('requisitions').delete().in('work_order_no', [workOrderA, workOrderB]);
    await supabase.from('project_cost_estimate_items').delete().eq('material_main_head', `Mat-${suffix}`);
    await supabase.from('project_cost_estimates').delete().in('work_order_no', [workOrderA, workOrderB]);
    await supabase.from('material_master').delete().eq('Material_Main_Head', `Mat-${suffix}`);
    await supabase.from('subcontract_work_master').delete().eq('id', subWork?.id);
    await supabase.from('subcontractor_master').delete().eq('id', subContractor?.id);
    await supabase.from('projects_beneficiary_master').delete().eq('id', masterBeneficiary?.id);
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrderA, workOrderB]);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, hoMobile, adminMobile]);
  });

  // ─── 1. Subcontract Finance Capacity Authorization ──────────────────────────

  test('JE cross-WO finance capacity returns 403', async () => {
    const req = {
      query: {
        work_order_no: workOrderB,
        subcontractor_id: subContractor.id,
        subcontract_work_id: subWork.id
      },
      user: { mobile_number: jeMobile, role: 'je' }
    };
    const res = mockRes();
    await getSubcontractFinanceCapacity(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.message).toMatch(/not assigned to this Work Order/i);
  });

  test('ZO cross-WO finance capacity returns 403', async () => {
    const req = {
      query: {
        work_order_no: workOrderB,
        subcontractor_id: subContractor.id,
        subcontract_work_id: subWork.id
      },
      user: { mobile_number: zoMobile, role: 'zo' }
    };
    const res = mockRes();
    await getSubcontractFinanceCapacity(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.message).toMatch(/not assigned to this Work Order/i);
  });

  test('JE and ZO mapped capacity returns 200', async () => {
    const jeReq = {
      query: {
        work_order_no: workOrderA,
        subcontractor_id: subContractor.id,
        subcontract_work_id: subWork.id
      },
      user: { mobile_number: jeMobile, role: 'je' }
    };
    const jeRes = mockRes();
    await getSubcontractFinanceCapacity(jeReq, jeRes);
    expect(jeRes.statusCode).toBe(200);
    expect(jeRes.jsonData.success).toBe(true);
    expect(jeRes.jsonData.capacity).toBeDefined();

    const zoReq = {
      query: {
        work_order_no: workOrderA,
        subcontractor_id: subContractor.id,
        subcontract_work_id: subWork.id
      },
      user: { mobile_number: zoMobile, role: 'zo' }
    };
    const zoRes = mockRes();
    await getSubcontractFinanceCapacity(zoReq, zoRes);
    expect(zoRes.statusCode).toBe(200);
    expect(zoRes.jsonData.success).toBe(true);
    expect(zoRes.jsonData.capacity).toBeDefined();
  });

  test('HO and Admin unrestricted capacity returns 200 for any work order', async () => {
    const hoReq = {
      query: {
        work_order_no: workOrderB,
        subcontractor_id: subContractor.id,
        subcontract_work_id: subWork.id
      },
      user: { mobile_number: hoMobile, role: 'ho' }
    };
    const hoRes = mockRes();
    await getSubcontractFinanceCapacity(hoReq, hoRes);
    expect(hoRes.statusCode).toBe(200);
    expect(hoRes.jsonData.success).toBe(true);

    const adminReq = {
      query: {
        work_order_no: workOrderB,
        subcontractor_id: subContractor.id,
        subcontract_work_id: subWork.id
      },
      user: { mobile_number: adminMobile, role: 'admin' }
    };
    const adminRes = mockRes();
    await getSubcontractFinanceCapacity(adminReq, adminRes);
    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.jsonData.success).toBe(true);
  });

  // ─── 2. Beneficiary Schema & Resolution Tests ───────────────────────────────

  test('neither beneficiary_id nor complete 4-part details returns 400', async () => {
    const attach = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrderA,
        requisition_no: `REQ-INV-${suffix}`,
        material_main_head: `Mat-${suffix}`,
        requisition_pdf_attachment_id: attach.attachmentId,
        original_filename: 'sample.pdf',
        requisition_amount: 1000,
        gst_bill: 'No',
        // Incomplete beneficiary info: only name, no ac/ifsc/bank_id, and no beneficiary_id
        beneficiary_name: 'Incomplete Beneficiary'
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.message).toMatch(/beneficiary/i);
  });

  test('valid beneficiary_id only succeeds and stored snapshots equal master', async () => {
    const attach = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const reqNo = `REQ-IDONLY-${suffix}`;
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrderA,
        requisition_no: reqNo,
        material_main_head: `Mat-${suffix}`,
        requisition_pdf_attachment_id: attach.attachmentId,
        original_filename: 'sample.pdf',
        requisition_amount: 2000,
        gst_bill: 'No',
        beneficiary_id: masterBeneficiary.id
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(201);

    // Verify stored requisition snapshot strictly matches the master beneficiary
    const { data: storedReq } = await supabase
      .from('requisitions')
      .select('beneficiary_id, beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_id')
      .eq('requisition_no', reqNo)
      .single();

    expect(storedReq.beneficiary_id).toBe(masterBeneficiary.id);
    expect(storedReq.beneficiary_name).toBe(masterBeneficiary.beneficiary_name);
    expect(storedReq.beneficiary_ac_no).toBe(masterBeneficiary.beneficiary_ac_no);
    expect(storedReq.beneficiary_ifsc).toBe(masterBeneficiary.beneficiary_ifsc);
    expect(storedReq.beneficiary_bank_id).toBe(masterBeneficiary.beneficiary_bank_id);
  });

  test('full manual snapshot without beneficiary_id succeeds with 201', async () => {
    const attach = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const reqNo = `REQ-MANUAL-${suffix}`;
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrderA,
        requisition_no: reqNo,
        material_main_head: `Mat-${suffix}`,
        requisition_pdf_attachment_id: attach.attachmentId,
        original_filename: 'sample.pdf',
        requisition_amount: 1500,
        gst_bill: 'No',
        ...validRequisitionBeneficiary(testBankId, {
          beneficiary_name: `Manual Ben ${suffix}`,
          beneficiary_ac_no: '112233445566',
          beneficiary_ifsc: 'SBIN0004321'
        })
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(201);

    const { data: storedReq } = await supabase
      .from('requisitions')
      .select('beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_id')
      .eq('requisition_no', reqNo)
      .single();

    expect(storedReq.beneficiary_name).toBe(`Manual Ben ${suffix}`);
    expect(storedReq.beneficiary_ac_no).toBe('112233445566');
    expect(storedReq.beneficiary_ifsc).toBe('SBIN0004321');
    expect(storedReq.beneficiary_bank_id).toBe(testBankId);
  });

  test('nonexistent beneficiary_id returns 422', async () => {
    const attach = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrderA,
        requisition_no: `REQ-NOBEN-${suffix}`,
        material_main_head: `Mat-${suffix}`,
        requisition_pdf_attachment_id: attach.attachmentId,
        original_filename: 'sample.pdf',
        requisition_amount: 1000,
        gst_bill: 'No',
        beneficiary_id: crypto.randomUUID()
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.jsonData.message).toMatch(/Selected beneficiary does not exist/i);
  });

  test('beneficiary_id + conflicting client snapshot makes master authoritative', async () => {
    const attach = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: jeMobile });
    const reqNo = `REQ-CONFLICT-${suffix}`;
    const req = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrderA,
        requisition_no: reqNo,
        material_main_head: `Mat-${suffix}`,
        requisition_pdf_attachment_id: attach.attachmentId,
        original_filename: 'sample.pdf',
        requisition_amount: 1000,
        gst_bill: 'No',
        beneficiary_id: masterBeneficiary.id,
        // Conflicting client payload
        beneficiary_name: 'Conflicting Fake Name',
        beneficiary_ac_no: '999999999999',
        beneficiary_ifsc: 'PUNB0001234'
      }
    };
    const res = mockRes();
    await createRequisition(req, res);

    expect(res.statusCode).toBe(201);

    // Stored snapshot must match master, NOT conflicting client input
    const { data: storedReq } = await supabase
      .from('requisitions')
      .select('beneficiary_name, beneficiary_ac_no, beneficiary_ifsc')
      .eq('requisition_no', reqNo)
      .single();

    expect(storedReq.beneficiary_name).toBe(masterBeneficiary.beneficiary_name);
    expect(storedReq.beneficiary_ac_no).toBe(masterBeneficiary.beneficiary_ac_no);
    expect(storedReq.beneficiary_ifsc).toBe(masterBeneficiary.beneficiary_ifsc);
  });
});
