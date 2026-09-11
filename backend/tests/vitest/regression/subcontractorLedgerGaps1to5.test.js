import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const { computeMainHeadCapacity, computeSubcontractorCapacity } = require('../../../src/services/mainHeadCapacity.service');

describe('Subcontractor Ledger Hardening — GAPs 1 to 5 Comprehensive Regression Suite', () => {
  let suffix;
  let adminMobile, zoMobile, hoMobile;
  let workOrder, estimateNo, estimateId;
  let workOrderGap2, estimateNoGap2, estimateIdGap2;
  let workOrderGap5, estimateNoGap5, estimateIdGap5;

  const SUB_HEAD = 'Pipeline Works';
  const DETAILS = 'Mandal Contractors';

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
    adminMobile = `9621${suffix}`;
    zoMobile = `9622${suffix}`;
    hoMobile = `9623${suffix}`;

    workOrder = `WO_GAP_${suffix}`;
    estimateNo = `EST_GAP_${suffix}`;

    workOrderGap2 = `WO_G2_${suffix}`;
    estimateNoGap2 = `EST_G2_${suffix}`;

    workOrderGap5 = `WO_G5_${suffix}`;
    estimateNoGap5 = `EST_G5_${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` },
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `HO ${suffix}` }
    ]);

    await setupProject(workOrder, estimateNo, 500000.00, adminMobile);
    await setupProject(workOrderGap2, estimateNoGap2, 500000.00, adminMobile);
    await setupProject(workOrderGap5, estimateNoGap5, 500000.00, adminMobile);

    // Give ZO balance for requisition debits
    await supabase.from('zo_balances').upsert({ zo_user_id: zoMobile, available_balance: 500000.00 });
  });

  afterAll(async () => {
    // Clean up created entities
    const wos = [workOrder, workOrderGap2, workOrderGap5];
    await supabase.from('requisitions').delete().in('work_order_no', wos);
    await supabase.from('subcontractor_ledger').delete().in('work_order_no', wos);
    await supabase.from('subcontractor_balances').delete().in('work_order_no', wos);
    if (estimateId) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateId);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }
    if (estimateIdGap2) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateIdGap2);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateIdGap2);
    }
    if (estimateIdGap5) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estimateIdGap5);
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateIdGap5);
    }
    await supabase.from('zo_balances').delete().eq('zo_user_id', zoMobile);
    await supabase.from('projects_master').delete().in('work_order_no', wos);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, hoMobile]);
  });

  // --------------------------------------------------------------------------
  // TEST 1: GAP-01 — Backfill & Accounting Identity Check
  // --------------------------------------------------------------------------
  test('1. GAP-01: Historical ledger reconciliation & chk_scb_accounting_identity invariant holds', async () => {
    const { data: balances, error } = await supabase
      .from('subcontractor_balances')
      .select('*');

    expect(error).toBeNull();
    expect(balances).toBeDefined();

    for (const b of balances) {
      const estimated = Number(b.estimated_total);
      const paid = Number(b.paid_total);
      const available = Number(b.available_balance);

      // Invariant: available_balance = estimated_total - paid_total
      expect(Math.abs(available - (estimated - paid))).toBeLessThan(0.01);
      expect(estimated).toBeGreaterThanOrEqual(0);
      expect(paid).toBeGreaterThanOrEqual(0);

      // Verify that ledger sum matches balances
      const { data: ledgerRows } = await supabase
        .from('subcontractor_ledger')
        .select('amount, transaction_type')
        .eq('work_order_no', b.work_order_no)
        .eq('material_main_head', b.material_main_head)
        .eq('material_sub_head', b.material_sub_head)
        .eq('material_details', b.material_details);

      if (ledgerRows && ledgerRows.length > 0) {
        const creditSum = ledgerRows
          .filter(r => r.transaction_type === 'ESTIMATE_ITEM_APPROVAL' || r.transaction_type === 'ESTIMATE_ITEM_REVERSAL')
          .reduce((sum, r) => sum + Number(r.amount), 0);
        const debitSum = ledgerRows
          .filter(r => r.transaction_type === 'REQUISITION_APPROVAL')
          .reduce((sum, r) => sum + Math.abs(Number(r.amount)), 0);

        expect(Math.abs(estimated - creditSum)).toBeLessThan(0.01);
        expect(Math.abs(paid - debitSum)).toBeLessThan(0.01);
      }
    }
  });

  // --------------------------------------------------------------------------
  // TEST 2: GAP-02 — Reversal on Terminal Rejection
  // --------------------------------------------------------------------------
  test('2. GAP-02: submit_ho_review terminal rejection (Rejected by HO) generates compensating reversals', async () => {
    // Create estimate for GAP-02
    const { data: est, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrderGap2,
        estimate_no: estimateNoGap2,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_G2',
        estimate_amount: 35000.00,
        estimate_status: 'Under ZO Review',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    expect(estErr).toBeNull();
    estimateIdGap2 = est.estimate_id;

    const { data: items, error: itmErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([
        { estimate_id: estimateIdGap2, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: DETAILS, unit: 'lot', qty: 1, rate: 25000.00, amount: 25000.00 },
        { estimate_id: estimateIdGap2, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: `${DETAILS} Part 2`, unit: 'lot', qty: 1, rate: 10000.00, amount: 10000.00 }
      ])
      .select();
    expect(itmErr).toBeNull();

    const [item1, item2] = items;

    // ZO approves both items
    const { error: zoErr } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdGap2,
      p_approvals: [
        { item_id: item1.item_id, approve_status: 'Approve', remarks: null },
        { item_id: item2.item_id, approve_status: 'Approve', remarks: null }
      ],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });
    expect(zoErr).toBeNull();

    // Move to Under HO Review
    await setEstimateStatus(estimateIdGap2, 'Under HO Review');

    // HO approves Item 1 (credits ledger +25000)
    const { error: hoErr1 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdGap2,
      p_approvals: [{ item_id: item1.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });
    expect(hoErr1).toBeNull();

    // Verify interim credit exists
    const balanceBefore = await getBalance(workOrderGap2, SUB_HEAD, DETAILS);
    expect(Number(balanceBefore.available_balance)).toBe(25000);

    // HO rejects Item 2 ('Not Approve' with remarks)
    const { error: hoErr2 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdGap2,
      p_approvals: [{ item_id: item2.item_id, approve_status: 'Not Approve', remarks: 'Unit rate exceeds regional schedule' }],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });
    expect(hoErr2).toBeNull();

    // HO finalizes review -> terminal rejection
    const { error: hoReviewErr } = await supabase.rpc('submit_ho_review', {
      p_estimate_id: estimateIdGap2,
      p_reviewer: hoMobile,
      p_remarks: 'Terminal rejection due to Item 2 overbudget'
    });
    expect(hoReviewErr).toBeNull();

    // Verify estimate status is 'Rejected by HO'
    const { data: rejectedEst } = await supabase
      .from('project_cost_estimates')
      .select('estimate_status')
      .eq('estimate_id', estimateIdGap2)
      .single();
    expect(rejectedEst.estimate_status).toBe('Rejected by HO');

    // GAP-02 assertion: Compensating reversal row inserted in subcontractor_ledger
    const { data: revRows } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('reference_id', item1.item_id)
      .eq('transaction_type', 'ESTIMATE_ITEM_REVERSAL');
    expect(revRows.length).toBe(1);
    expect(Number(revRows[0].amount)).toBe(-25000);

    // Balance in subcontractor_balances should now be reversed back to 0
    const balanceAfter = await getBalance(workOrderGap2, SUB_HEAD, DETAILS);
    expect(Number(balanceAfter.estimated_total)).toBe(0);
    expect(Number(balanceAfter.available_balance)).toBe(0);
  });

  // --------------------------------------------------------------------------
  // TEST 3: GAP-03 — Out-of-Order Stage Guard
  // --------------------------------------------------------------------------
  test('3. GAP-03: Direct RPC out-of-order execution is strictly blocked by submit_row_approvals', async () => {
    // Create estimate in Under ZO Review
    const { data: est, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder,
        estimate_no: estimateNo,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_G3',
        estimate_amount: 50000.00,
        estimate_status: 'Under ZO Review',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    expect(estErr).toBeNull();
    estimateId = est.estimate_id;

    const { data: itemData, error: itmErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([{
        estimate_id: estimateId,
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
    expect(itmErr).toBeNull();

    // 1. Attempt HO stage while estimate is Under ZO Review -> MUST FAIL
    const { error: hoPrematureErr } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateId,
      p_approvals: [{ item_id: itemData.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });
    expect(hoPrematureErr).toBeDefined();
    expect(hoPrematureErr.message).toContain('HO row approvals can only be submitted when estimate is Under HO Review');

    // 2. ZO approves item
    const { error: zoOkErr } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateId,
      p_approvals: [{ item_id: itemData.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });
    expect(zoOkErr).toBeNull();

    // Move to Under HO Review
    await setEstimateStatus(estimateId, 'Under HO Review');

    // 3. Attempt ZO stage while estimate is Under HO Review -> MUST FAIL
    const { error: zoBelatedErr } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateId,
      p_approvals: [{ item_id: itemData.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });
    expect(zoBelatedErr).toBeDefined();
    expect(zoBelatedErr.message).toContain('ZO row approvals can only be submitted when estimate is Under ZO Review');
  });

  // --------------------------------------------------------------------------
  // TEST 4: GAP-04 — Model A Reopen Lifecycle Pause (EST02)
  // --------------------------------------------------------------------------
  test('4. GAP-04: create_requisition_secure blocks requisition creation with EST02 during estimate revision', async () => {
    // Set estimate status to 'Estimate Reopened'
    await setEstimateStatus(estimateId, 'Estimate Reopened');

    const { error: reqReopenedErr } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 50000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_G4_REOP_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'req/g4.pdf',
      p_original_filename: 'g4.pdf',
      p_requisition_amount: 1000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Info',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });

    expect(reqReopenedErr).toBeDefined();
    expect(reqReopenedErr.code).toBe('EST02');
    expect(reqReopenedErr.message).toContain('is currently undergoing estimate revision (Estimate Reopened)');

    // Set estimate status to 'Under ZO Review'
    await setEstimateStatus(estimateId, 'Under ZO Review');
    const { error: reqZoReviewErr } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: workOrder,
      p_estimate_no: estimateNo,
      p_estimate_amount: 50000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_G4_ZO_${suffix}`,
      p_material_main_head: 'Sub Contractor',
      p_material_sub_head: SUB_HEAD,
      p_material_details: DETAILS,
      p_requisition_pdf_url: 'req/g4.pdf',
      p_original_filename: 'g4.pdf',
      p_requisition_amount: 1000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Info',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });

    expect(reqZoReviewErr).toBeDefined();
    expect(reqZoReviewErr.code).toBe('EST02');
    expect(reqZoReviewErr.message).toContain('is currently undergoing estimate revision (Under ZO Review)');
  });

  // --------------------------------------------------------------------------
  // TEST 5: GAP-05 — Whitespace Normalization Across 4 Identity Fields
  // --------------------------------------------------------------------------
  test('5. GAP-05: 4-field TRIM normalization stores clean keys in subcontractor_balances', async () => {
    // Insert estimate with untrimmed details
    const { data: est5, error: estErr5 } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrderGap5,
        estimate_no: estimateNoGap5,
        area_code: 'Kolkata Zone',
        estimate_revision: 0,
        zonal_office_no: 'TEST_ZO_G5',
        estimate_amount: 15000.00,
        estimate_status: 'Under ZO Review',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();
    expect(estErr5).toBeNull();
    estimateIdGap5 = est5.estimate_id;

    const { data: item5, error: itmErr5 } = await supabase
      .from('project_cost_estimate_items')
      .insert([{
        estimate_id: estimateIdGap5,
        material_main_head: '  Sub Contractor  ',
        material_sub_head: `  ${SUB_HEAD}  `,
        material_details: `  ${DETAILS} Trim Test  `,
        unit: 'lot',
        qty: 1,
        rate: 15000.00,
        amount: 15000.00
      }])
      .select()
      .single();
    expect(itmErr5).toBeNull();

    // ZO approve
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdGap5,
      p_approvals: [{ item_id: item5.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });

    // Move to Under HO Review and HO approve
    await setEstimateStatus(estimateIdGap5, 'Under HO Review');
    const { error: hoAppErr } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estimateIdGap5,
      p_approvals: [{ item_id: item5.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });
    expect(hoAppErr).toBeNull();

    // Verify stored balance has trimmed fields
    const { data: b5, error: b5Err } = await supabase
      .from('subcontractor_balances')
      .select('*')
      .eq('work_order_no', workOrderGap5)
      .eq('material_sub_head', SUB_HEAD)
      .eq('material_details', `${DETAILS} Trim Test`)
      .single();

    expect(b5Err).toBeNull();
    expect(b5.work_order_no).toBe(workOrderGap5);
    expect(b5.material_main_head).toBe('Sub Contractor');
    expect(b5.material_sub_head).toBe(SUB_HEAD);
    expect(b5.material_details).toBe(`${DETAILS} Trim Test`);
    expect(Number(b5.available_balance)).toBe(15000);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Backfill Idempotency & Unique Constraint
  // --------------------------------------------------------------------------
  test('6. Backfill idempotency: re-running historical insert does not duplicate or violate UNIQUE', async () => {
    // Attempt duplicate ledger insert with same (transaction_type, reference_type, reference_id)
    const { data: existingRows } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('transaction_type', 'ESTIMATE_ITEM_APPROVAL')
      .limit(1);

    if (existingRows && existingRows.length > 0) {
      const row = existingRows[0];
      const { error: dupErr } = await supabase
        .from('subcontractor_ledger')
        .insert([{
          work_order_no: row.work_order_no,
          material_main_head: row.material_main_head,
          material_sub_head: row.material_sub_head,
          material_details: row.material_details,
          transaction_type: row.transaction_type,
          reference_type: row.reference_type,
          reference_id: row.reference_id,
          amount: row.amount,
          created_by: adminMobile
        }]);

      expect(dupErr).toBeDefined();
      expect(dupErr.code).toBe('23505'); // unique violation
      expect(dupErr.message).toContain('uq_scl_tx_ref');
    }
  });

  // --------------------------------------------------------------------------
  // TEST 7: Reversal Idempotency
  // --------------------------------------------------------------------------
  test('7. Reversal idempotency: calling terminal rejection logic twice does not duplicate reversals', async () => {
    // Re-run submit_ho_review on the already rejected estimate
    // It should safely fail with 'Expected Under HO Review, found Rejected by HO' without adding rows
    const { count: countBefore } = await supabase
      .from('subcontractor_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('work_order_no', workOrderGap2)
      .eq('transaction_type', 'ESTIMATE_ITEM_REVERSAL');

    expect(countBefore).toBe(1);

    const { error: secondSubmitErr } = await supabase.rpc('submit_ho_review', {
      p_estimate_id: estimateIdGap2,
      p_reviewer: hoMobile,
      p_remarks: 'Second submission test'
    });
    expect(secondSubmitErr).toBeDefined();

    const { count: countAfter } = await supabase
      .from('subcontractor_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('work_order_no', workOrderGap2)
      .eq('transaction_type', 'ESTIMATE_ITEM_REVERSAL');

    expect(countAfter).toBe(countBefore);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Mixed HO Batch Atomicity (GAP-03)
  // --------------------------------------------------------------------------
  test('8. GAP-03: Mixed HO approval batch with one unapproved ZO item rolls back entirely', async () => {
    // Create new estimate under HO review
    const { data: estMix } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder,
        estimate_no: `${estimateNo}_MIX`,
        area_code: 'Kolkata Zone',
        estimate_revision: 1,
        zonal_office_no: 'TEST_ZO_MIX',
        estimate_amount: 30000.00,
        estimate_status: 'Under ZO Review',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }])
      .select()
      .single();

    const { data: itemsMix } = await supabase
      .from('project_cost_estimate_items')
      .insert([
        { estimate_id: estMix.estimate_id, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: `${DETAILS} Mix A`, unit: 'lot', qty: 1, rate: 20000.00, amount: 20000.00 },
        { estimate_id: estMix.estimate_id, material_main_head: 'Sub Contractor', material_sub_head: SUB_HEAD, material_details: `${DETAILS} Mix B`, unit: 'lot', qty: 1, rate: 10000.00, amount: 10000.00 }
      ])
      .select();

    const [itemA, itemB] = itemsMix;

    // ZO only approves Item A, leaves Item B pending
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estMix.estimate_id,
      p_approvals: [{ item_id: itemA.item_id, approve_status: 'Approve', remarks: null }],
      p_stage: 'ZO',
      p_modified_by: zoMobile
    });

    // Move to Under HO Review
    await setEstimateStatus(estMix.estimate_id, 'Under HO Review');

    // HO submits batch approving BOTH Item A and Item B.
    // Item B is NOT approved by ZO -> must throw exception and abort batch!
    const { error: batchErr } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: estMix.estimate_id,
      p_approvals: [
        { item_id: itemA.item_id, approve_status: 'Approve', remarks: null },
        { item_id: itemB.item_id, approve_status: 'Approve', remarks: null }
      ],
      p_stage: 'HO',
      p_modified_by: hoMobile
    });

    expect(batchErr).toBeDefined();
    expect(batchErr.message).toContain('cannot be approved by HO because ZO approval is missing or rejected');

    // Atomicity assertion: Item A was NOT approved by HO due to rollback
    const { data: itemACheck } = await supabase
      .from('project_cost_estimate_items')
      .select('ho_office_approve')
      .eq('item_id', itemA.item_id)
      .single();

    expect(itemACheck.ho_office_approve).toBeNull();

    // No ledger credit for Item A was committed
    const { data: ledgerMix } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('reference_id', itemA.item_id);

    expect(ledgerMix.length).toBe(0);

    // Clean up temporary estimate
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', estMix.estimate_id);
    await supabase.from('project_cost_estimates').delete().eq('estimate_id', estMix.estimate_id);
  });

  // --------------------------------------------------------------------------
  // TEST 9: GAP-04 — Reopen Preserves Balance While Blocking Requisitions
  // --------------------------------------------------------------------------
  test('9. GAP-04: computeSubcontractorCapacity preserves running balance and reports lifecycle pause during reopen', async () => {
    // Check capacity for the balance created in Test 5
    // Set estimate to 'Estimate Reopened'
    await setEstimateStatus(estimateIdGap5, 'Estimate Reopened');

    const capacity = await computeSubcontractorCapacity(workOrderGap5, SUB_HEAD, `${DETAILS} Trim Test`);

    // Preserves existing balance
    expect(capacity.estimatedTotal).toBe(15000);
    expect(capacity.availableBalance).toBe(15000);

    // Lifecycle metadata signals requisitions are blocked
    expect(capacity.estimateLifecycle).toBeDefined();
    expect(capacity.estimateLifecycle.status).toBe('Estimate Reopened');
    expect(capacity.estimateLifecycle.isReopened).toBe(true);
    expect(capacity.estimateLifecycle.requisitionsBlocked).toBe(true);
    expect(capacity.estimateLifecycle.blockReason).toContain('Estimate is currently undergoing revision');

    // Also verify computeMainHeadCapacity reflects this
    const mainHeadCap = await computeMainHeadCapacity(workOrderGap5, 'Sub Contractor');
    expect(mainHeadCap.estimateLifecycle.isReopened).toBe(true);
    expect(mainHeadCap.estimateLifecycle.requisitionsBlocked).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 10: GAP-05 — Whitespace Collision Prevention
  // --------------------------------------------------------------------------
  test('10. GAP-05: Untrimmed requisition fields match existing trimmed balance row cleanly', async () => {
    // Promote estimate 5 to Final Approved so requisition can proceed
    await setEstimateStatus(estimateIdGap5, 'Final Approved');

    const { data: req5, error: req5Err } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: hoMobile,
      p_work_order_no: `  ${workOrderGap5}  `,
      p_estimate_no: estimateNoGap5,
      p_estimate_amount: 15000.00,
      p_state: 'West Bengal',
      p_district: 'Kolkata',
      p_area_code: 'Kolkata Zone',
      p_department: 'PWD',
      p_site_details: 'Testing Site',
      p_requisition_no: `REQ_G5_DEBIT_${suffix}`,
      p_material_main_head: '  Sub Contractor  ',
      p_material_sub_head: `  ${SUB_HEAD}  `,
      p_material_details: `  ${DETAILS} Trim Test  `,
      p_requisition_pdf_url: 'req/g5.pdf',
      p_original_filename: 'g5.pdf',
      p_requisition_amount: 5000.00,
      p_gst_bill: 'No',
      p_gst_bill_pdf_url: null,
      p_bank_details: 'Bank Details',
      p_expen_head_remarks: 'Remarks',
      p_requisition_status: 'Pending',
      p_created_by: hoMobile
    });

    expect(req5Err).toBeNull();
    const reqId = req5.requisition_id;

    // Assign ZO
    await supabase.from('requisitions').update({ zo_user_id: zoMobile }).eq('requisition_id', reqId);

    // Approve requisition (transact debit) with untrimmed parameters or standard RPC
    const { error: appErr } = await supabase.rpc('approve_requisition_transact', {
      p_requisition_id: reqId,
      p_approved_amount: 5000.00,
      p_actioned_by: zoMobile,
      p_remarks_approved_authority: 'Approved Trim Test Requisition'
    });
    expect(appErr).toBeNull();

    // Verify subcontractor_balances has been debited on the exact same row (no duplicate row created)
    const { data: balances, error: bListErr } = await supabase
      .from('subcontractor_balances')
      .select('*')
      .eq('work_order_no', workOrderGap5);

    expect(bListErr).toBeNull();
    expect(balances.length).toBe(1); // Exact 1 row, no whitespace duplicates
    expect(Number(balances[0].paid_total)).toBe(5000);
    expect(Number(balances[0].available_balance)).toBe(10000);
    expect(Number(balances[0].estimated_total)).toBe(15000);

    // Verify ledger row was created with negative amount -5000
    const { data: lRows } = await supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('reference_id', reqId);

    expect(lRows.length).toBe(1);
    expect(lRows[0].transaction_type).toBe('REQUISITION_APPROVAL');
    expect(Number(lRows[0].amount)).toBe(-5000);
  });
});
