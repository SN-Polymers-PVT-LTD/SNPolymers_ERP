import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const mockRes = require('../../helpers/mockRes');

// Controllers under test
const { createRequisition, getRequisitions, getRequisitionById, actOnRequisition } = require('../../../src/controllers/requisitions.controller');
const { createFundRequest, getFundRequests, getFundRequestById, actOnFundRequest } = require('../../../src/controllers/fundRequests.controller');
const { createProgressReport, getProgressReports, getProgressReportById, addAuthorityRemarks } = require('../../../src/controllers/dailyProgress.controller');
const { getEstimates, getEstimateById } = require('../../../src/controllers/estimates.core.controller');
const { createBill, getBills, getBillById, getBillSummaryByWorkOrder } = require('../../../src/controllers/raFinalBill.controller');
const { getProjects, getProjectByWorkOrder } = require('../../../src/controllers/projects.controller');

describe('Milestone P7-M6 — Operational Modules Integration Tests', () => {
  let suffix;
  let zo1Mobile;
  let zo2Mobile;
  let jeMobile;
  let adminMobile;

  let workOrder1;
  let workOrder2;

  let reqId;
  let frId;
  let progressId;
  let estimateId;
  let billId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    zo1Mobile = `9501${suffix}`;
    zo2Mobile = `9502${suffix}`;
    jeMobile = `9503${suffix}`;
    adminMobile = `9504${suffix}`;

    workOrder1 = `WO-P7-M6-A-${suffix}`;
    workOrder2 = `WO-P7-M6-B-${suffix}`;

    // Create test users
    await setupUsers([
      { mobile_number: zo1Mobile, role: 'zo', is_active: true, display_name: `ZO A ${suffix}` },
      { mobile_number: zo2Mobile, role: 'zo', is_active: true, display_name: `ZO B ${suffix}` },
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` }
    ]);

    // Create Projects
    const { error: pErr } = await supabase.from('projects_master').insert([
      {
        work_order_no: workOrder1,
        estimate_no: `EST-M6-A-${suffix}`,
        zo_user_id: zo1Mobile,
        site_details: `Site A ${suffix}`,
        state: 'State',
        district: 'District',
        zone: 'Zone',
        department: 'Dept',
        created_by: adminMobile,
        edited_by: adminMobile,
        work_order_value: 100000.00,
        status: 'Running'
      },
      {
        work_order_no: workOrder2,
        estimate_no: `EST-M6-B-${suffix}`,
        zo_user_id: zo2Mobile,
        site_details: `Site B ${suffix}`,
        state: 'State',
        district: 'District',
        zone: 'Zone',
        department: 'Dept',
        created_by: adminMobile,
        edited_by: adminMobile,
        work_order_value: 100000.00,
        status: 'Running'
      }
    ]);
    if (pErr) console.error('SETUP Projects error:', pErr);

    // Create a Final Approved estimate for WO A (required for requisition budget secure RPC)
    const { data: estData, error: eErr } = await supabase.from('project_cost_estimates').insert([
      {
        work_order_no: workOrder1,
        estimate_no: `EST-M6-A-${suffix}`,
        area_code: 'Zone',
        estimate_revision: 0,
        zonal_office_no: 'ZO-1',
        estimate_amount: 50000.00,
        estimate_status: 'Final Approved',
        created_by: jeMobile,
        last_modified_by: jeMobile
      }
    ]).select().single();
    if (eErr) console.error('SETUP Estimate error:', eErr);
    estimateId = estData?.estimate_id;

    // Create Material Master reference (required for requisitions creation)
    const { error: mmErr } = await supabase.from('material_master').insert([
      {
        Material_Main_Head: `Material M6-${suffix}`,
        Material_Sub_Head: 'Subhead',
        Material_Details: 'Details',
        M_Unit: 'Unit',
        created_by: adminMobile
      }
    ]);
    if (mmErr) console.error('SETUP Material Master error:', mmErr);

    // Setup active JE-ZO mapping: JE mapped to ZO 1
    const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert([
      {
        je_user_id: jeMobile,
        zo_user_id: zo1Mobile,
        is_active: true,
        assigned_by: adminMobile
      }
    ]);
    if (jeZoErr) console.error('SETUP JE-ZO Mapping error:', jeZoErr);

    // Setup active Work Order Mapping: JE mapped to Work Order 1
    const { error: woMapErr } = await supabase.from('work_order_mappings').insert([
      {
        work_order_no: workOrder1,
        je_user_id: jeMobile,
        is_active: true,
        reason: 'Assigned',
        assigned_by: adminMobile
      }
    ]);
    if (woMapErr) console.error('SETUP Work Order Mapping error:', woMapErr);

    // Initialize ZO 1 balance to 20000.00
    const { error: balErr } = await supabase.from('zo_balances').upsert({
      zo_user_id: zo1Mobile,
      available_balance: 20000.00,
      updated_at: new Date().toISOString()
    });
    if (balErr) console.error('SETUP Balance error:', balErr);
  });

  afterAll(async () => {
    // Delete in reverse order of dependencies
    await supabase.from('ra_final_bills').delete().eq('work_order_no', workOrder1);
    await supabase.from('daily_progress_reports').delete().eq('work_order_no', workOrder1);
    await supabase.from('zo_balances').delete().in('zo_user_id', [zo1Mobile, zo2Mobile]);
    await supabase.from('zo_fund_ledger').delete().in('zo_user_id', [zo1Mobile, zo2Mobile]);
    await supabase.from('requisitions').delete().eq('work_order_no', workOrder1);
    await supabase.from('fund_requests').delete().eq('work_order_no', workOrder1);
    if (estimateId) await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId);
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', workOrder1);
    await supabase.from('material_master').delete().eq('Material_Main_Head', `Material M6-${suffix}`);
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrder1, workOrder2]);
    await supabase.from('authorised_users').delete().in('mobile_number', [zo1Mobile, zo2Mobile, jeMobile, adminMobile]);
  });

  test('M6-TC-01: Requisition creation gates & zo_user_id population', async () => {
    // 1. Try creating a requisition for Work Order 2 (not assigned to JE) -> Should fail with 403
    const reqCreateFail = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder2,
        requisition_no: `REQ-M6-Fail-${suffix}`,
        material_main_head: `Material M6-${suffix}`,
        requisition_pdf_url: 'path/pdf',
        original_filename: 'pdf.pdf',
        requisition_amount: 5000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ',
        expen_head_remarks: 'Remarks'
      }
    };
    const resCreateFail = mockRes();
    await createRequisition(reqCreateFail, resCreateFail);
    expect(resCreateFail.statusCode).toBe(403);

    // 2. Create for Work Order 1 (assigned to JE) -> Should succeed and set zo_user_id = zo1Mobile
    const reqCreateOk = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder1,
        requisition_no: `REQ-M6-Ok-${suffix}`,
        material_main_head: `Material M6-${suffix}`,
        requisition_pdf_url: 'path/pdf',
        original_filename: 'pdf.pdf',
        requisition_amount: 5000.00,
        gst_bill: 'No',
        bank_details: 'Bank XYZ',
        expen_head_remarks: 'Remarks'
      }
    };
    const resCreateOk = mockRes();
    await createRequisition(reqCreateOk, resCreateOk);
    if (resCreateOk.statusCode !== 201) {
      console.log('DEBUG TC-01 Requisition Create Ok failed payload/response:', resCreateOk.jsonData);
    }
    expect(resCreateOk.statusCode).toBe(201);
    expect(resCreateOk.jsonData.requisition.zo_user_id).toBe(zo1Mobile);
    reqId = resCreateOk.jsonData.requisition.requisition_id;
  });

  test('M6-TC-02: Requisition approval deducts Zonal Balance cache and logs to ledger', async () => {
    if (!reqId) return;

    // 1. Approve as ZO 2 -> Should fail with 403 (mismatching ZO user)
    const reqApproveFail = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { id: reqId },
      body: {
        action: 'Approve',
        approved_amount: 4000.00,
        remarks_approved_authority: 'Approved partial'
      }
    };
    const resApproveFail = mockRes();
    await actOnRequisition(reqApproveFail, resApproveFail);
    expect(resApproveFail.statusCode).toBe(403);

    // 2. Approve as ZO 1 -> Should succeed, update balance (20000 - 4000 = 16000), insert debit ledger
    const reqApproveOk = {
      user: { mobile_number: zo1Mobile, role: 'zo' },
      params: { id: reqId },
      body: {
        action: 'Approve',
        approved_amount: 4000.00,
        remarks_approved_authority: 'Approved 4000'
      }
    };
    const resApproveOk = mockRes();
    await actOnRequisition(reqApproveOk, resApproveOk);
    if (resApproveOk.statusCode !== 200) {
      console.log('DEBUG TC-02 Requisition Action failed response:', resApproveOk.jsonData);
    }
    expect(resApproveOk.statusCode).toBe(200);

    // Verify balance
    const { data: balanceData } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zo1Mobile)
      .single();
    expect(Number(balanceData.available_balance)).toBe(16000.00);

    // Verify negative ledger posting
    const { data: ledgerEntry } = await supabase
      .from('zo_fund_ledger')
      .select('*')
      .eq('reference_id', reqId)
      .single();
    expect(ledgerEntry.transaction_type).toBe('REQUISITION_APPROVAL');
    expect(Number(ledgerEntry.amount)).toBe(-4000.00);
  });

  test('M6-TC-03: Fund Request creation & transactional approval', async () => {
    // 1. Create a fund request for Work Order 2 as ZO 1 -> Should fail with 400 (ZO 1 does not own WO 2)
    const reqFrFail = {
      user: { mobile_number: zo1Mobile, role: 'zo' },
      body: {
        zo_fr_no: `FR-M6-Fail-${suffix}`,
        work_order_no: workOrder2,
        zo_fr_amount: 8000.00,
        zo_remarks: 'Need cash'
      }
    };
    const resFrFail = mockRes();
    await createFundRequest(reqFrFail, resFrFail);
    expect(resFrFail.statusCode).toBe(400);

    // 2. Create for Work Order 1 as ZO 1 -> Should succeed
    const reqFrOk = {
      user: { mobile_number: zo1Mobile, role: 'zo' },
      body: {
        zo_fr_no: `FR-M6-Ok-${suffix}`,
        work_order_no: workOrder1,
        zo_fr_amount: 8000.00,
        zo_remarks: 'Need cash'
      }
    };
    const resFrOk = mockRes();
    await createFundRequest(reqFrOk, resFrOk);
    if (resFrOk.statusCode !== 201) {
      console.log('DEBUG TC-03 Fund Request Create Ok failed response:', resFrOk.jsonData);
    }
    expect(resFrOk.statusCode).toBe(201);
    frId = resFrOk.jsonData.fundRequest.fund_request_id;

    // 3. Approve as HO -> Should credit balance (16000 + 8000 = 24000), insert credit ledger
    const reqApproveFr = {
      user: { mobile_number: adminMobile, role: 'admin' },
      params: { id: frId },
      body: {
        action: 'Approve',
        approve_ho_amount: 8000.00,
        transfer_from_account: 'OD',
        ho_remarks: 'Approved HO allocation'
      }
    };
    const resApproveFr = mockRes();
    await actOnFundRequest(reqApproveFr, resApproveFr);
    if (resApproveFr.statusCode !== 200) {
      console.log('DEBUG TC-03 Fund Request Action failed response:', resApproveFr.jsonData);
    }
    expect(resApproveFr.statusCode).toBe(200);

    // Verify balance updated
    const { data: balanceData } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zo1Mobile)
      .single();
    expect(Number(balanceData.available_balance)).toBe(24000.00);

    // Verify positive ledger credit
    const { data: ledgerEntry } = await supabase
      .from('zo_fund_ledger')
      .select('*')
      .eq('reference_id', frId)
      .single();
    expect(ledgerEntry.transaction_type).toBe('ALLOCATION');
    expect(Number(ledgerEntry.amount)).toBe(8000.00);
  });

  test('M6-TC-04: Daily Progress visibility controls & auto-population', async () => {
    // 1. Create a progress report as JE -> Should auto-populate zo_user_id = zo1Mobile
    const reqCreateProgress = {
      user: { mobile_number: jeMobile, role: 'je' },
      body: {
        work_order_no: workOrder1,
        site_visit_date: new Date().toISOString().split('T')[0],
        work_progress_details: 'Bricks and cement laid',
        physical_work_progress: 10,
        daily_site_photo_url: 'path/photo',
        original_photo_filename: 'photo.jpg',
        remarks_after_site_visit: 'Reported on site'
      }
    };
    const resCreateProgress = mockRes();
    await createProgressReport(reqCreateProgress, resCreateProgress);
    expect(resCreateProgress.statusCode).toBe(201);
    expect(resCreateProgress.jsonData.report.zo_user_id).toBe(zo1Mobile);
    progressId = resCreateProgress.jsonData.report.report_id;

    // 2. List progress reports as ZO 2 -> Should not see the report
    const reqListZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      query: {}
    };
    const resListZo2 = mockRes();
    await getProgressReports(reqListZo2, resListZo2);
    expect(resListZo2.statusCode).toBe(200);
    const hasReportZo2 = resListZo2.jsonData.reports.some(r => r.report_id === progressId);
    expect(hasReportZo2).toBe(false);

    // 3. List progress reports as ZO 1 -> Should see the report
    const reqListZo1 = {
      user: { mobile_number: zo1Mobile, role: 'zo' },
      query: {}
    };
    const resListZo1 = mockRes();
    await getProgressReports(reqListZo1, resListZo1);
    expect(resListZo1.statusCode).toBe(200);
    const hasReportZo1 = resListZo1.jsonData.reports.some(r => r.report_id === progressId);
    expect(hasReportZo1).toBe(true);

    // 4. Retrieve single report as ZO 2 -> Should return 404
    const reqGetZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { id: progressId }
    };
    const resGetZo2 = mockRes();
    await getProgressReportById(reqGetZo2, resGetZo2);
    expect(resGetZo2.statusCode).toBe(404);

    // 5. Update authority remarks as ZO 2 -> Should fail with 403
    const reqRemarksZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { id: progressId },
      body: {
        remarks_approved_authority: 'ZO 2 tries to reject',
        action: 'Reject'
      }
    };
    const resRemarksZo2 = mockRes();
    await addAuthorityRemarks(reqRemarksZo2, resRemarksZo2);
    expect(resRemarksZo2.statusCode).toBe(403);
  });

  test('M6-TC-05: Cost Estimates & Projects visibility boundaries', async () => {
    // 1. List estimates as ZO 2 -> Should not see the estimate
    const reqEstZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      query: {}
    };
    const resEstZo2 = mockRes();
    await getEstimates(reqEstZo2, resEstZo2);
    expect(resEstZo2.statusCode).toBe(200);
    const hasEstZo2 = resEstZo2.jsonData.estimates.some(e => e.estimate_id === estimateId);
    expect(hasEstZo2).toBe(false);

    // 2. List estimates as ZO 1 -> Should see the estimate
    const reqEstZo1 = {
      user: { mobile_number: zo1Mobile, role: 'zo' },
      query: {}
    };
    const resEstZo1 = mockRes();
    await getEstimates(reqEstZo1, resEstZo1);
    expect(resEstZo1.statusCode).toBe(200);
    const hasEstZo1 = resEstZo1.jsonData.estimates.some(e => e.estimate_id === estimateId);
    expect(hasEstZo1).toBe(true);

    // 3. View estimate details as ZO 2 -> Should return 404
    const reqGetEstZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { id: estimateId }
    };
    const resGetEstZo2 = mockRes();
    await getEstimateById(reqGetEstZo2, resGetEstZo2);
    expect(resGetEstZo2.statusCode).toBe(404);

    // 4. List projects as ZO 2 -> Should not see project 1
    const reqProjZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      query: {}
    };
    const resProjZo2 = mockRes();
    await getProjects(reqProjZo2, resProjZo2);
    expect(resProjZo2.statusCode).toBe(200);
    const hasProjZo2 = resProjZo2.jsonData.projects.some(p => p.work_order_no === workOrder1);
    expect(hasProjZo2).toBe(false);

    // 5. View project details for WO 1 as ZO 2 -> Should return 404
    const reqGetProjZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { work_order_no: workOrder1 }
    };
    const resGetProjZo2 = mockRes();
    await getProjectByWorkOrder(reqGetProjZo2, resGetProjZo2);
    expect(resGetProjZo2.statusCode).toBe(404);
  });

  test('M6-TC-06: RA / Final Bills visibility and creation boundaries', async () => {
    // 1. Create a bill for Work Order 1 as ZO 2 -> Should fail with 403 (mismatch ZO)
    const reqBillZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      body: {
        work_order_no: workOrder1,
        payment_type: 'RA Bill 1',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `BILL-M6-Fail-${suffix}`,
        gross_bill: 1000.00,
        agency_payment: 1000.00,
        bill_copy_url: 'path/copy',
        original_bill_filename: 'bill.pdf'
      }
    };
    const resBillZo2 = mockRes();
    await createBill(reqBillZo2, resBillZo2);
    expect(resBillZo2.statusCode).toBe(403);

    // 2. Create for Work Order 1 as ZO 1 -> Should succeed
    const reqBillZo1 = {
      user: { mobile_number: zo1Mobile, role: 'zo' },
      body: {
        work_order_no: workOrder1,
        payment_type: 'RA Bill 1',
        bill_date: new Date().toISOString().split('T')[0],
        bill_no: `BILL-M6-Ok-${suffix}`,
        gross_bill: 1000.00,
        agency_payment: 1000.00,
        bill_copy_url: 'path/copy',
        original_bill_filename: 'bill.pdf'
      }
    };
    const resBillZo1 = mockRes();
    await createBill(reqBillZo1, resBillZo1);
    if (resBillZo1.statusCode !== 201) {
      console.log('DEBUG TC-06 Bill Create Ok failed response:', resBillZo1.jsonData);
    }
    expect(resBillZo1.statusCode).toBe(201);
    billId = resBillZo1.jsonData.bill.bill_id;

    // 3. List bills as ZO 2 -> Should not see this bill
    const reqListBillZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      query: {}
    };
    const resListBillZo2 = mockRes();
    await getBills(reqListBillZo2, resListBillZo2);
    expect(resListBillZo2.statusCode).toBe(200);
    const hasBillZo2 = resListBillZo2.jsonData.bills.some(b => b.bill_id === billId);
    expect(hasBillZo2).toBe(false);

    // 4. View bill details as ZO 2 -> Should return 404
    const reqGetBillZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { id: billId }
    };
    const resGetBillZo2 = mockRes();
    await getBillById(reqGetBillZo2, resGetBillZo2);
    expect(resGetBillZo2.statusCode).toBe(404);

    // 5. Get bill summary for Work Order 1 as ZO 2 -> Should return 404
    const reqSumZo2 = {
      user: { mobile_number: zo2Mobile, role: 'zo' },
      params: { work_order_no: workOrder1 }
    };
    const resSumZo2 = mockRes();
    await getBillSummaryByWorkOrder(reqSumZo2, resSumZo2);
    expect(resSumZo2.statusCode).toBe(404);
  });
});
