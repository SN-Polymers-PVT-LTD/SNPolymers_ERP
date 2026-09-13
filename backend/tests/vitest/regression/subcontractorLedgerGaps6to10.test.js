import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const mockRes = require('../../helpers/mockRes');
const {
  cancelRequisition,
  getSubcontractorRequisitions,
  adjustSubcontractorBalance
} = require('../../../src/controllers/requisitions.controller');

describe('Subcontractor Ledger Hardening — GAPs 6 to 10 Comprehensive Regression Suite', () => {
  let suffix;
  let adminMobile, zoMobile, hoMobile, jeMobile;
  let workOrder, estimateNo, estimateId;
  let workOrderG8, estimateNoG8, estimateIdG8;

  const SUB_HEAD = 'HVAC Ducting';
  const DETAILS = 'AeroTech Systems';

  async function setEstimateStatus(estId, status) {
    return supabase.from('project_cost_estimates').update({ estimate_status: status }).eq('estimate_id', estId);
  }

  async function getBalance(wo, subHead = SUB_HEAD, details = DETAILS) {
    const { data } = await supabase
      .from('subcontractor_balances')
      .select('*')
      .eq('work_order_no', wo)
      .eq('material_sub_head', subHead)
      .eq('material_details', details)
      .maybeSingle();
    return data;
  }

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    adminMobile = `9721${suffix}`;
    zoMobile = `9722${suffix}`;
    hoMobile = `9723${suffix}`;
    jeMobile = `9724${suffix}`;

    workOrder = `WO_G610_${suffix}`;
    estimateNo = `EST_G610_${suffix}`;

    workOrderG8 = `WO_G8_${suffix}`;
    estimateNoG8 = `EST_G8_${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` },
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `HO ${suffix}` },
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` }
    ]);

    await setupProject(workOrder, estimateNo, 1000000.00, adminMobile);
    await setupProject(workOrderG8, estimateNoG8, 1000000.00, adminMobile);

    // Provide ZO balance for requisition debits
    await supabase.from('zo_balances').upsert({ zo_user_id: zoMobile, available_balance: 500000.00 });

    // Seed estimate 1 (Final Approved with Sub Contractor line item)
    const { data: est1 } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder,
        estimate_no: estimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_610',
        estimate_amount: 100000.00,
        estimate_status: 'Under ZO Review',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    estimateId = est1.estimate_id;

    const { data: item1 } = await supabase
      .from('project_cost_estimate_items')
      .insert([{
        estimate_id: estimateId,
        material_main_head: 'Sub Contractor',
        material_sub_head: SUB_HEAD,
        material_details: DETAILS,
        unit: 'lot',
        qty: 1,
        rate: 100000.00,
        amount: 100000.00
      }])
      .select()
      .single();

    // ZO approves item
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateId,
      p_approvals: [{ item_id: item1.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });

    // Move to HO Review and HO approves item (credits ledger +100000)
    await setEstimateStatus(estimateId, 'Under HO Review');
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateId,
      p_approvals: [{ item_id: item1.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });

    // Move to Final Approved
    await setEstimateStatus(estimateId, 'Final Approved');

    // Seed estimate 2 for GAP-08 adjustment testing
    const { data: estG8 } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrderG8,
        estimate_no: estimateNoG8,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_G8',
        estimate_amount: 50000.00,
        estimate_status: 'Under ZO Review',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    estimateIdG8 = estG8.estimate_id;

    const { data: itemG8 } = await supabase
      .from('project_cost_estimate_items')
      .insert([{
        estimate_id: estimateIdG8,
        material_main_head: 'Sub Contractor',
        material_sub_head: SUB_HEAD,
        material_details: DETAILS,
        unit: 'lot',
        qty: 1,
        rate: 50000.00,
        amount: 50000.00
      }])
      .select()
      .single();

    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdG8,
      p_approvals: [{ item_id: itemG8.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });
    await setEstimateStatus(estimateIdG8, 'Under HO Review');
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdG8,
      p_approvals: [{ item_id: itemG8.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });
    await setEstimateStatus(estimateIdG8, 'Final Approved');
  });

  afterAll(async () => {
    const wos = [workOrder, workOrderG8];
    await supabase.from('requisitions').delete().in('work_order_no', wos);
    await supabase.from('subcontractor_ledger').delete().in('work_order_no', wos);
    await supabase.from('subcontractor_balances').delete().in('work_order_no', wos);
    if (estimateId) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }
    if (estimateIdG8) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateIdG8);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateIdG8);
    }
    await supabase.from('zo_balances').delete().eq('zo_user_id', zoMobile);
    await supabase.from('projects_master').delete().in('work_order_no', wos);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, hoMobile, jeMobile]);
  });

  // --------------------------------------------------------------------------
  // TEST 1: GAP-06 — Retraction Verification & State Machine Guard
  // --------------------------------------------------------------------------
  test('1. GAP-06: cancelRequisition strictly blocks cancelling Approved requisitions, and Pending cancellation does not touch ledger', async () => {
    // 1. Create a requisition and approve it
    const { data: reqApp } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 100000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_G6_APP_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'req/g6.pdf',
      p_original_filename: 'g6.pdf',
      p_requisition_amount: 20000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Info',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });

    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqApp.requisition_id);
    await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqApp.requisition_id,
      p_approved_amount: 20000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved'
    });

    // Attempt to cancel the Approved requisition via cancelRequisition controller
    const reqMock = { params: { id: reqApp.requisition_id }, user: { mobile_number: adminMobile, role: 'admin' } };
    const resMock = mockRes();
    await cancelRequisition(reqMock, resMock);

    expect(resMock.statusCode).toBe(403);
    expect(resMock.jsonData.message).toContain('Only Pending or Hold requisitions can be cancelled');

    // 2. Create a second requisition left in Pending status
    const { data: reqPend } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 100000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_G6_PEND_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'req/g6p.pdf',
      p_original_filename: 'g6p.pdf',
      p_requisition_amount: 10000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Info',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });

    const balBeforeCancel = await getBalance(workOrder);

    const reqMock2 = { params: { id: reqPend.requisition_id }, user: { mobile_number: adminMobile, role: 'admin' } };
    const resMock2 = mockRes();
    await cancelRequisition(reqMock2, resMock2);

    expect(resMock2.statusCode).toBe(200);

    const balAfterCancel = await getBalance(workOrder);
    expect(Number(balAfterCancel.paid_total)).toBe(Number(balBeforeCancel.paid_total));
    expect(Number(balAfterCancel.available_balance)).toBe(Number(balBeforeCancel.available_balance));
  });

  // --------------------------------------------------------------------------
  // TEST 2: GAP-07 — Authoritative Financial Activity Predicate & Active Totals
  // --------------------------------------------------------------------------
  test('2. GAP-07: isFinanciallyActiveRequisition correctly filters cancelled and rejected requisitions from financial liabilities', async () => {
    // Import the utility from frontend source to test exact parity
    const { isFinanciallyActiveRequisition } = await import('../../../../frontend/src/utils/requisitionUtils.js');

    expect(isFinanciallyActiveRequisition('Approved')).toBe(true);
    expect(isFinanciallyActiveRequisition('Pending')).toBe(true);
    expect(isFinanciallyActiveRequisition('Hold')).toBe(true);
    expect(isFinanciallyActiveRequisition('Cancelled')).toBe(false);
    expect(isFinanciallyActiveRequisition('Rejected')).toBe(false);

    // Mock dataset simulating group.rows in UI
    const rows = [
      { requisition_amount: 30000, approved_amount: 30000, requisition_status: 'Approved' },
      { requisition_amount: 25000, approved_amount: 0, requisition_status: 'Cancelled' },
      { requisition_amount: 15000, approved_amount: 0, requisition_status: 'Rejected' },
      { requisition_amount: 10000, approved_amount: 0, requisition_status: 'Pending' }
    ];

    const activeRows = rows.filter(r => isFinanciallyActiveRequisition(r.requisition_status));
    const totalRequested = activeRows.reduce((sum, r) => sum + r.requisition_amount, 0);
    const totalApproved = activeRows.reduce((sum, r) => sum + r.approved_amount, 0);

    // Active requested must be 30,000 + 10,000 = 40,000 (NOT 80,000)
    expect(totalRequested).toBe(40000);
    expect(totalApproved).toBe(30000);
  });

  // --------------------------------------------------------------------------
  // TEST 3: GAP-08 — Admin Balance Adjustment Execution
  // --------------------------------------------------------------------------
  test('3. GAP-08: adjust_subcontractor_balance_transact successfully increases estimated and available totals', async () => {
    const balBefore = await getBalance(workOrderG8);
    const adjId = crypto.randomUUID();

    const { data: updated, error } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: adjId,
      p_work_order_no: workOrderG8,
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_adjustment_amount: 15000.00,
      p_remarks: 'Approved extra scope top-up per executive directive',
      p_actioned_by: hoMobile
    });

    expect(error).toBeNull();
    expect(Number(updated.estimated_total)).toBe(Number(balBefore.estimated_total) + 15000);
    expect(Number(updated.available_balance)).toBe(Number(balBefore.available_balance) + 15000);

    // Verify ledger row created
    const { data: ledgerEntry } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('reference_id', adjId)
      .single();

    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry.transaction_type).toBe('ADMIN_ADJUSTMENT');
    expect(ledgerEntry.reference_type).toBe('MANUAL_ADJUSTMENT');
    expect(Number(ledgerEntry.amount)).toBe(15000);
  });

  // --------------------------------------------------------------------------
  // TEST 4: GAP-08 — Strict Floor Invariant (new_estimated < paid_total)
  // --------------------------------------------------------------------------
  test('4. GAP-08: Negative adjustment cannot reduce estimated_total below paid_total (floor invariant BAL01)', async () => {
    // First, record a requisition debit on workOrderG8
    const { data: req } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrderG8,
      p_estimate_no: estimateNoG8,
      p_estimate_amount: 50000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_G8_FLR_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'req/g8.pdf',
      p_original_filename: 'g8.pdf',
      p_requisition_amount: 20000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Info',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });

    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', req.requisition_id);
    await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: req.requisition_id,
      p_approved_amount: 20000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved'
    });

    const bal = await getBalance(workOrderG8);
    // estimated_total is 65000, paid_total is 20000, available_balance is 45000
    expect(Number(bal.paid_total)).toBe(20000);

    // Attempt negative adjustment of -50000 (which would leave estimated_total = 15000 < paid_total 20000)
    const { error: floorErr } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: crypto.randomUUID(),
      p_work_order_no: workOrderG8,
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_adjustment_amount: -50000.00,
      p_remarks: 'Over-reduction test',
      p_actioned_by: hoMobile
    });

    expect(floorErr).toBeDefined();
    expect(floorErr.code).toBe('BAL01');
    expect(floorErr.message).toContain('below already paid total');
  });

  // --------------------------------------------------------------------------
  // TEST 5: GAP-08 — Idempotency & Retry Safety via adjustment_id
  // --------------------------------------------------------------------------
  test('5. GAP-08: adjustment_id idempotency prevents double-adjustment on network retry', async () => {
    const adjId = crypto.randomUUID();

    // Call 1
    const { data: firstCall, error: err1 } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: adjId,
      p_work_order_no: workOrderG8,
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_adjustment_amount: 5000.00,
      p_remarks: 'Idempotency test adjustment',
      p_actioned_by: hoMobile
    });
    expect(err1).toBeNull();

    // Call 2 with identical adjustment_id (simulating retry)
    const { data: secondCall, error: err2 } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: adjId,
      p_work_order_no: workOrderG8,
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_adjustment_amount: 5000.00,
      p_remarks: 'Idempotency test adjustment',
      p_actioned_by: hoMobile
    });
    expect(err2).toBeNull();
    expect(Number(secondCall.available_balance)).toBe(Number(firstCall.available_balance));

    // Confirm exactly one ledger record exists for this adjustment_id
    const { count } = await supabase
      .from('subcontractor_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('reference_id', adjId);

    expect(count).toBe(1);
  });

  // --------------------------------------------------------------------------
  // TEST 6: GAP-08 — Cross-Layer Authorization Verification
  // --------------------------------------------------------------------------
  test('6. GAP-08: Cross-layer authorization rejects adjustments by non-HO/Admin users at RPC level', async () => {
    const { error: zoErr } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: crypto.randomUUID(),
      p_work_order_no: workOrderG8,
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_adjustment_amount: 1000.00,
      p_remarks: 'Unauthorized ZO attempt',
      p_actioned_by: zoMobile
    });

    expect(zoErr).toBeDefined();
    expect(zoErr.code).toBe('AUTH2');
    expect(zoErr.message).toContain('Only HO or Admin can adjust subcontractor balances');

    const { error: jeErr } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: crypto.randomUUID(),
      p_work_order_no: workOrderG8,
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_adjustment_amount: 1000.00,
      p_remarks: 'Unauthorized JE attempt',
      p_actioned_by: jeMobile
    });

    expect(jeErr).toBeDefined();
    expect(jeErr.code).toBe('AUTH2');
  });

  // --------------------------------------------------------------------------
  // TEST 7: GAP-09 — Physical Accounting Identity Constraint Enforcement
  // --------------------------------------------------------------------------
  test('7. GAP-09: chk_scb_accounting_identity physically rejects direct SQL updates that break available = estimated - paid', async () => {
    // Attempt raw direct SQL mutation breaking the identity
    const { error: checkErr } = await supabase
      .from('subcontractor_balances')
      .update({ available_balance: 999999.00 })
      .eq('work_order_no', workOrderG8);

    expect(checkErr).toBeDefined();
    expect(checkErr.code).toBe('23514'); // check_violation
    expect(checkErr.message).toContain('chk_scb_accounting_identity');
  });

  // --------------------------------------------------------------------------
  // TEST 8: GAP-10A — IST Timezone Boundary (+05:30) Accuracy
  // --------------------------------------------------------------------------
  test('8. GAP-10A: IST (+05:30) boundary formatting queries calendar days correctly in getSubcontractorRequisitions', async () => {
    // Seed a requisition with created_at set to early morning IST (02:00 AM IST)
    // 02:00 AM IST on 2026-09-10 is 2026-09-09 20:30:00 UTC
    const reqDateIST = '2026-09-10';
    const timestampIST = `${reqDateIST}T02:00:00+05:30`;

    const { data: earlyReq } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: hoMobile,
        work_order_no: workOrder,
        estimate_no: estimateNo,
        estimate_amount: 100000.00,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        requisition_no: `REQ_IST_${suffix}`,
        material_main_head: 'Sub Contractor',
        material_sub_head: SUB_HEAD,
        material_details: DETAILS,
        requisition_pdf_url: 'req/ist.pdf',
        original_filename: 'ist.pdf',
        requisition_amount: 5000.00,
        gst_bill: 'No',
        bank_details: 'Bank Info',
        requisition_status: 'Pending',
        created_by: hoMobile,
        created_at: timestampIST
      }])
      .select()
      .single();

    expect(earlyReq).toBeDefined();

    // Query getSubcontractorRequisitions for date_from = reqDateIST, date_to = reqDateIST
    const reqMock = {
      query: {
        work_order_no: workOrder,
        date_from: reqDateIST,
        date_to: reqDateIST
      }
    };
    const resMock = mockRes();
    await getSubcontractorRequisitions(reqMock, resMock);

    expect(resMock.statusCode).toBe(200);
    const found = resMock.jsonData.requisitions.find(r => r.requisition_id === earlyReq.requisition_id);
    expect(found).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // TEST 9: GAP-10B — Creation Date vs Approval Date Basis Toggle
  // --------------------------------------------------------------------------
  test('9. GAP-10B: date_basis toggle correctly isolates Creation Date from Approval Date', async () => {
    // Seed requisition created in Month 1 (2026-08-15) and approved in Month 2 (2026-09-15)
    const createdDate = '2026-08-15T10:00:00+05:30';
    const approvedDate = '2026-09-15T15:00:00+05:30';

    const { data: reqDual, error: insErr } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: hoMobile,
        work_order_no: workOrder,
        estimate_no: estimateNo,
        estimate_amount: 100000.00,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        requisition_no: `REQ_DUAL_${suffix}`,
        material_main_head: 'Sub Contractor',
        material_sub_head: SUB_HEAD,
        material_details: DETAILS,
        requisition_pdf_url: 'req/dual.pdf',
        original_filename: 'dual.pdf',
        requisition_amount: 7000.00,
        approved_amount: 7000.00,
        approved_balance_amount: 0.00,
        approve_type: 'Approve',
        gst_bill: 'No',
        bank_details: 'Bank Info',
        requisition_status: 'Approved',
        created_by: hoMobile,
        created_at: createdDate,
        payment_date: approvedDate,
        zo_actioned_at: approvedDate
      }])
      .select()
      .single();

    expect(insErr).toBeNull();

    // 1. Query by Creation Date during August
    const reqMockCreated = {
      query: {
        work_order_no: workOrder,
        date_basis: 'created',
        date_from: '2026-08-01',
        date_to: '2026-08-31'
      }
    };
    const resMockCreated = mockRes();
    await getSubcontractorRequisitions(reqMockCreated, resMockCreated);
    expect(resMockCreated.jsonData.requisitions.some(r => r.requisition_id === reqDual.requisition_id)).toBe(true);

    // 2. Query by Approval Date during August -> MUST NOT match
    const reqMockAppAug = {
      query: {
        work_order_no: workOrder,
        date_basis: 'approved',
        date_from: '2026-08-01',
        date_to: '2026-08-31'
      }
    };
    const resMockAppAug = mockRes();
    await getSubcontractorRequisitions(reqMockAppAug, resMockAppAug);
    expect(resMockAppAug.jsonData.requisitions.some(r => r.requisition_id === reqDual.requisition_id)).toBe(false);

    // 3. Query by Approval Date during September -> MUST match
    const reqMockAppSep = {
      query: {
        work_order_no: workOrder,
        date_basis: 'approved',
        date_from: '2026-09-01',
        date_to: '2026-09-30'
      }
    };
    const resMockAppSep = mockRes();
    await getSubcontractorRequisitions(reqMockAppSep, resMockAppSep);
    expect(resMockAppSep.jsonData.requisitions.some(r => r.requisition_id === reqDual.requisition_id)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 10: GAP-10C — Search Filter Symmetry
  // --------------------------------------------------------------------------
  test('10. GAP-10C: getSubcontractorRequisitions search matches work_order_no and requisition_no', async () => {
    // Search by work_order_no
    const reqWo = { query: { search: workOrder.toLowerCase() } };
    const resWo = mockRes();
    await getSubcontractorRequisitions(reqWo, resWo);
    expect(resWo.statusCode).toBe(200);
    expect(resWo.jsonData.requisitions.length).toBeGreaterThan(0);
    expect(resWo.jsonData.requisitions.every(r => r.work_order_no === workOrder)).toBe(true);

    // Search by specific requisition_no
    const targetReqNo = `REQ_DUAL_${suffix}`;
    const reqNoSearch = { query: { search: targetReqNo.toLowerCase() } };
    const resNoSearch = mockRes();
    await getSubcontractorRequisitions(reqNoSearch, resNoSearch);
    expect(resNoSearch.statusCode).toBe(200);
    expect(resNoSearch.jsonData.requisitions.length).toBe(1);
    expect(resNoSearch.jsonData.requisitions[0].requisition_no).toBe(targetReqNo);
  });
});
