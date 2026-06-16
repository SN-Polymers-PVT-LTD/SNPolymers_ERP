const { supabase } = require('../../src/db/supabase');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview,
  _recalculateEstimateAmount
} = require('../../src/controllers/estimates.controller');

// Import Helpers
const mockRes = require('../helpers/mockRes');
const setupUsers = require('../helpers/setupUsers');
const setupProject = require('../helpers/setupProject');
const cleanupEstimate = require('../helpers/cleanupEstimate');

async function runEstimateAmountMatrixTests() {
  console.log('=== RUNNING ESTIMATE AMOUNT MATRIX TESTS ===\n');
  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(10000 + Math.random() * 90000);
  const mobileJE = `+9199100${suffix}`;
  const mobileZO = `+9199200${suffix}`;
  const mobileHO = `+9199300${suffix}`;
  const mobileAdmin = `+9199400${suffix}`;

  try {
    // 0. Setup whitelisted users using helper
    await setupUsers([
      { mobile_number: mobileJE, display_name: 'JE', role: 'je', is_active: true },
      { mobile_number: mobileZO, display_name: 'ZO', role: 'zo', is_active: true },
      { mobile_number: mobileHO, display_name: 'HO', role: 'ho', is_active: true },
      { mobile_number: mobileAdmin, display_name: 'Admin', role: 'admin', is_active: true }
    ]);

    // Setup materials
    const { data: testMats, error: matErr } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Mat A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Mat B ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Mat C ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();
    if (matErr) throw matErr;

    const setupProjectAndEstimate = async (testName) => {
      const wo = `TEST_WO_MAT_${testName}_${suffix}`;
      await setupProject(wo, `EST_MAT_${testName}_${suffix}`, 5000000.00, mobileAdmin);

      const res = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE, role: 'je' },
        body: { work_order_no: wo, zonal_office_no: 'ZO-1' }
      }, res);
      
      if (res.statusCode !== 201) {
        throw new Error(`Failed to create estimate: ${res.jsonData.message}`);
      }
      const id = res.jsonData.estimate.estimate_id;

      await saveDraftItems({
        params: { id },
        user: { mobile_number: mobileJE, role: 'je' },
        body: {
          items: [
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 100, rate_reference: 'Ref' },
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[1].Material_Details, unit: 'Bag', qty: 1, rate: 200, rate_reference: 'Ref' },
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[2].Material_Details, unit: 'Bag', qty: 1, rate: 300, rate_reference: 'Ref' }
          ]
        }
      }, mockRes());

      return { wo, estId: id };
    };

    const verifyHeaderAmount = async (id, expectedStatus, expectedAmount) => {
      const { data: est, error: estErr } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status, estimate_amount')
        .eq('estimate_id', id)
        .single();
      if (estErr) throw estErr;

      const { data: items, error: itemsErr } = await supabase
        .from('project_cost_estimate_items')
        .select('amount, zo_office_approve, ho_office_approve')
        .eq('estimate_id', id);
      if (itemsErr) throw itemsErr;

      const currentStatus = est.estimate_status;
      if (expectedStatus && currentStatus !== expectedStatus) {
        throw new Error(`Expected status to be ${expectedStatus}, but got ${currentStatus}`);
      }

      let computedSum = 0;
      if (['Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested', 'Rejected by ZO', 'Rejected by HO'].includes(currentStatus)) {
        computedSum = (items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      } else if (['ZO Approved', 'Under HO Review', 'HO Revision Requested'].includes(currentStatus)) {
        computedSum = (items || [])
          .filter(item => item.zo_office_approve === 'Approve')
          .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      } else if (currentStatus === 'Final Approved') {
        computedSum = (items || [])
          .filter(item => item.zo_office_approve === 'Approve' && item.ho_office_approve === 'Approve')
          .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      } else {
        computedSum = (items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      }
      computedSum = Math.round(computedSum * 100) / 100;

      const dbAmt = Number(est.estimate_amount);
      if (dbAmt !== computedSum) {
        throw new Error(`Header amount mismatch! DB has ${dbAmt}, computed sum is ${computedSum} for status ${currentStatus}`);
      }

      if (expectedAmount !== undefined && dbAmt !== expectedAmount) {
        throw new Error(`Header amount does not match expected amount! Expected ${expectedAmount}, got ${dbAmt}`);
      }

      return dbAmt;
    };

    // -------------------------------------------------------------------------
    // M1 — Draft (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M1 — Draft...');
    const m1Data = await setupProjectAndEstimate('M1');
    try {
      await verifyHeaderAmount(m1Data.estId, 'Draft', 600);
      console.log('  [PASS] M1 Draft: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M1 Draft: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m1Data.estId, m1Data.wo);

    // -------------------------------------------------------------------------
    // M2 — Submitted (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M2 — Submitted...');
    const m2Data = await setupProjectAndEstimate('M2');
    await submitEstimate({ params: { id: m2Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    try {
      await verifyHeaderAmount(m2Data.estId, 'Submitted', 600);
      console.log('  [PASS] M2 Submitted: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M2 Submitted: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m2Data.estId, m2Data.wo);

    // -------------------------------------------------------------------------
    // M3 — Under ZO Review (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M3 — Under ZO Review...');
    const m3Data = await setupProjectAndEstimate('M3');
    await submitEstimate({ params: { id: m3Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m3Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    try {
      await verifyHeaderAmount(m3Data.estId, 'Under ZO Review', 600);
      console.log('  [PASS] M3 Under ZO Review: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M3 Under ZO Review: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m3Data.estId, m3Data.wo);

    // -------------------------------------------------------------------------
    // M4 — ZO Approved (Expected: 300)
    // -------------------------------------------------------------------------
    console.log('M4 — ZO Approved...');
    const m4Data = await setupProjectAndEstimate('M4');
    await submitEstimate({ params: { id: m4Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m4Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const { data: itemsM4 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m4Data.estId).order('rate', { ascending: true });
    
    // Direct SQL RPC call to approve rows
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m4Data.estId,
      p_approvals: [
        { item_id: itemsM4[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM4[1].item_id, approve_status: 'Approve' },
        { item_id: itemsM4[2].item_id, approve_status: 'Not Approve', remarks: 'Too high' }
      ],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    // Manually transition status to 'ZO Approved' and recalculate
    await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Approved', last_modified_by: mobileZO }).eq('estimate_id', m4Data.estId);
    await _recalculateEstimateAmount(m4Data.estId, 'ZO Approved');

    try {
      await verifyHeaderAmount(m4Data.estId, 'ZO Approved', 300);
      console.log('  [PASS] M4 ZO Approved: Amount is 300.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M4 ZO Approved: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m4Data.estId, m4Data.wo);

    // -------------------------------------------------------------------------
    // M5 — Under HO Review (Expected: 300)
    // -------------------------------------------------------------------------
    console.log('M5 — Under HO Review...');
    const m5Data = await setupProjectAndEstimate('M5');
    await submitEstimate({ params: { id: m5Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m5Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM5 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m5Data.estId).order('rate', { ascending: true });
    
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m5Data.estId,
      p_approvals: [
        { item_id: itemsM5[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM5[1].item_id, approve_status: 'Approve' },
        { item_id: itemsM5[2].item_id, approve_status: 'Not Approve', remarks: 'Too high' }
      ],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    // Manually transition to 'Under HO Review' and recalculate
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Under HO Review', last_modified_by: mobileHO }).eq('estimate_id', m5Data.estId);
    await _recalculateEstimateAmount(m5Data.estId, 'Under HO Review');

    try {
      await verifyHeaderAmount(m5Data.estId, 'Under HO Review', 300);
      console.log('  [PASS] M5 Under HO Review: Amount is 300.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M5 Under HO Review: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m5Data.estId, m5Data.wo);

    // -------------------------------------------------------------------------
    // M6 — Final Approved (Expected: 300)
    // -------------------------------------------------------------------------
    console.log('M6 — Final Approved...');
    const m6Data = await setupProjectAndEstimate('M6');
    await submitEstimate({ params: { id: m6Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m6Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM6 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m6Data.estId).order('rate', { ascending: true });
    
    // ZO approves all
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m6Data.estId,
      p_approvals: itemsM6.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })),
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    // HO approves 100, 200, rejects 300
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m6Data.estId,
      p_approvals: [
        { item_id: itemsM6[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM6[1].item_id, approve_status: 'Approve' },
        { item_id: itemsM6[2].item_id, approve_status: 'Not Approve', remarks: 'Reject' }
      ],
      p_stage: 'HO',
      p_modified_by: mobileHO
    });

    // Final Approve manually
    await supabase.from('project_cost_estimates').update({
      estimate_status: 'Final Approved',
      ho_approved_by: mobileHO,
      ho_approval_date: new Date().toISOString(),
      last_modified_by: mobileHO
    }).eq('estimate_id', m6Data.estId);
    await _recalculateEstimateAmount(m6Data.estId, 'Final Approved');

    try {
      await verifyHeaderAmount(m6Data.estId, 'Final Approved', 300);
      console.log('  [PASS] M6 Final Approved: Amount is 300.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M6 Final Approved: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m6Data.estId, m6Data.wo);

    // -------------------------------------------------------------------------
    // M7 — Rejected by ZO (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M7 — Rejected by ZO...');
    const m7Data = await setupProjectAndEstimate('M7');
    await submitEstimate({ params: { id: m7Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m7Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM7 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m7Data.estId).order('rate', { ascending: true });
    
    await submitRowApprovals({
      params: { id: m7Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [
        { item_id: itemsM7[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM7[1].item_id, approve_status: 'Approve' },
        { item_id: itemsM7[2].item_id, approve_status: 'Not Approve', remarks: 'Bad' }
      ]}
    }, mockRes());
    await submitReview({ params: { id: m7Data.estId }, user: { mobile_number: mobileZO, role: 'zo' }, body: { remarks: 'Rejecting review' } }, mockRes());

    try {
      await verifyHeaderAmount(m7Data.estId, 'Rejected by ZO', 600);
      console.log('  [PASS] M7 Rejected by ZO: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M7 Rejected by ZO: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m7Data.estId, m7Data.wo);

    // -------------------------------------------------------------------------
    // M8 — Rejected by HO (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M8 — Rejected by HO...');
    const m8Data = await setupProjectAndEstimate('M8');
    await submitEstimate({ params: { id: m8Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m8Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM8 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m8Data.estId).order('rate', { ascending: true });
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m8Data.estId,
      p_approvals: itemsM8.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })),
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    await reviewEstimate({ params: { id: m8Data.estId }, user: { mobile_number: mobileHO, role: 'ho' } }, mockRes());
    
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m8Data.estId,
      p_approvals: [
        { item_id: itemsM8[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM8[1].item_id, approve_status: 'Approve' },
        { item_id: itemsM8[2].item_id, approve_status: 'Not Approve', remarks: 'Rej' }
      ],
      p_stage: 'HO',
      p_modified_by: mobileHO
    });

    // Manually transition to 'Rejected by HO'
    await supabase.from('project_cost_estimates').update({
      estimate_status: 'Rejected by HO',
      last_modified_by: mobileHO,
      updated_at: new Date().toISOString()
    }).eq('estimate_id', m8Data.estId);
    await _recalculateEstimateAmount(m8Data.estId, 'Rejected by HO');

    try {
      await verifyHeaderAmount(m8Data.estId, 'Rejected by HO', 600);
      console.log('  [PASS] M8 Rejected by HO: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M8 Rejected by HO: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m8Data.estId, m8Data.wo);

    // -------------------------------------------------------------------------
    // M9 — ZO Revision Requested (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M9 — ZO Revision Requested...');
    const m9Data = await setupProjectAndEstimate('M9');
    await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Revision Requested' }).eq('estimate_id', m9Data.estId);
    try {
      await verifyHeaderAmount(m9Data.estId, 'ZO Revision Requested', 600);
      console.log('  [PASS] M9 ZO Revision Requested: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M9 ZO Revision Requested: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m9Data.estId, m9Data.wo);

    // -------------------------------------------------------------------------
    // M10 — HO Revision Requested (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M10 — HO Revision Requested...');
    const m10Data = await setupProjectAndEstimate('M10');
    // For HO Revision Requested to have amount 600, all items must be approved by ZO first
    const { data: itemsM10 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m10Data.estId);
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m10Data.estId,
      p_approvals: itemsM10.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })),
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });
    await supabase.from('project_cost_estimates').update({ estimate_status: 'HO Revision Requested' }).eq('estimate_id', m10Data.estId);
    await _recalculateEstimateAmount(m10Data.estId, 'HO Revision Requested');
    try {
      await verifyHeaderAmount(m10Data.estId, 'HO Revision Requested', 600);
      console.log('  [PASS] M10 HO Revision Requested: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M10 HO Revision Requested: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m10Data.estId, m10Data.wo);

    // -------------------------------------------------------------------------
    // M11 — Resubmitted After ZO Revision (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M11 — Resubmitted After ZO Revision...');
    const m11Data = await setupProjectAndEstimate('M11');
    await submitEstimate({ params: { id: m11Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    try {
      await verifyHeaderAmount(m11Data.estId, 'Submitted', 600);
      console.log('  [PASS] M11 Resubmitted After ZO Revision: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M11: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m11Data.estId, m11Data.wo);

    // -------------------------------------------------------------------------
    // M12 — Resubmitted After HO Revision (Expected: 600)
    // -------------------------------------------------------------------------
    console.log('M12 — Resubmitted After HO Revision...');
    const m12Data = await setupProjectAndEstimate('M12');
    await submitEstimate({ params: { id: m12Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    try {
      await verifyHeaderAmount(m12Data.estId, 'Submitted', 600);
      console.log('  [PASS] M12 Resubmitted After HO Revision: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M12: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m12Data.estId, m12Data.wo);

    // -------------------------------------------------------------------------
    // M13 — All Rows Rejected By ZO
    // -------------------------------------------------------------------------
    console.log('M13 — All Rows Rejected By ZO...');
    const m13Data = await setupProjectAndEstimate('M13');
    await submitEstimate({ params: { id: m13Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m13Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM13 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m13Data.estId).order('rate', { ascending: true });
    
    await submitRowApprovals({
      params: { id: m13Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: itemsM13.map(i => ({ item_id: i.item_id, approve_status: 'Not Approve', remarks: 'Rej all' })) }
    }, mockRes());
    await submitReview({ params: { id: m13Data.estId }, user: { mobile_number: mobileZO, role: 'zo' }, body: { remarks: 'Rej all' } }, mockRes());

    try {
      await verifyHeaderAmount(m13Data.estId, 'Rejected by ZO', 600);
      console.log('  [PASS] M13 All Rows Rejected By ZO: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M13: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m13Data.estId, m13Data.wo);

    // -------------------------------------------------------------------------
    // M14 — All Rows Rejected By HO
    // -------------------------------------------------------------------------
    console.log('M14 — All Rows Rejected By HO...');
    const m14Data = await setupProjectAndEstimate('M14');
    await submitEstimate({ params: { id: m14Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m14Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM14 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m14Data.estId).order('rate', { ascending: true });
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m14Data.estId,
      p_approvals: itemsM14.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })),
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    await reviewEstimate({ params: { id: m14Data.estId }, user: { mobile_number: mobileHO, role: 'ho' } }, mockRes());
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m14Data.estId,
      p_approvals: itemsM14.map(i => ({ item_id: i.item_id, approve_status: 'Not Approve', remarks: 'Rej all HO' })),
      p_stage: 'HO',
      p_modified_by: mobileHO
    });

    // Manually transition to Rejected by HO
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Rejected by HO', last_modified_by: mobileHO }).eq('estimate_id', m14Data.estId);
    await _recalculateEstimateAmount(m14Data.estId, 'Rejected by HO');

    try {
      await verifyHeaderAmount(m14Data.estId, 'Rejected by HO', 600);
      console.log('  [PASS] M14 All Rows Rejected By HO: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M14: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m14Data.estId, m14Data.wo);

    // -------------------------------------------------------------------------
    // M15 — Single Row Approved Matrix
    // -------------------------------------------------------------------------
    console.log('M15 — Single Row Approved Matrix...');
    const m15Data = await setupProjectAndEstimate('M15');
    await submitEstimate({ params: { id: m15Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m15Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM15 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m15Data.estId).order('rate', { ascending: true });
    
    // ZO Approvals
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m15Data.estId,
      p_approvals: [
        { item_id: itemsM15[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM15[1].item_id, approve_status: 'Approve' },
        { item_id: itemsM15[2].item_id, approve_status: 'Not Approve', remarks: 'No' }
      ],
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });

    // HO Approvals
    await supabase.rpc('submit_row_approvals', {
      p_estimate_id: m15Data.estId,
      p_approvals: [
        { item_id: itemsM15[0].item_id, approve_status: 'Approve' },
        { item_id: itemsM15[1].item_id, approve_status: 'Not Approve', remarks: 'No' },
        { item_id: itemsM15[2].item_id, approve_status: 'Approve' }
      ],
      p_stage: 'HO',
      p_modified_by: mobileHO
    });

    // Manually transition to 'Final Approved' and recalculate
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Final Approved', last_modified_by: mobileHO }).eq('estimate_id', m15Data.estId);
    await _recalculateEstimateAmount(m15Data.estId, 'Final Approved');

    try {
      await verifyHeaderAmount(m15Data.estId, 'Final Approved', 100);
      console.log('  [PASS] M15 Single Row Approved Matrix: Amount is 100.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M15: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m15Data.estId, m15Data.wo);

    // -------------------------------------------------------------------------
    // M16 — Workflow-generated ZO Approved
    // -------------------------------------------------------------------------
    console.log('M16 — Workflow-generated ZO Approved...');
    const m16Data = await setupProjectAndEstimate('M16');
    await submitEstimate({ params: { id: m16Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: m16Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: itemsM16 } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', m16Data.estId).order('rate', { ascending: true });

    // Approve all items
    await submitRowApprovals({
      params: { id: m16Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: itemsM16.map(i => ({ item_id: i.item_id, approve_status: 'Approve' })) }
    }, mockRes());

    // Submit review using actual submitReview path
    const resM16Review = mockRes();
    await submitReview({
      params: { id: m16Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { remarks: 'All approved!' }
    }, resM16Review);

    try {
      if (resM16Review.statusCode !== 200) {
        throw new Error(`submitReview failed with code ${resM16Review.statusCode}: ${JSON.stringify(resM16Review.jsonData)}`);
      }
      await verifyHeaderAmount(m16Data.estId, 'ZO Approved', 600);
      console.log('  [PASS] M16 Workflow-generated ZO Approved: Amount is 600.');
      passes++;
    } catch (e) {
      console.log(`  [FAIL] M16: ${e.message}`);
      fails++;
    }
    await cleanupEstimate(m16Data.estId, m16Data.wo);

    // Cleanup materials & users
    await supabase.from('material_master').delete().in('id', testMats.map(m => m.id));
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO, mobileHO, mobileAdmin]);

  } catch (error) {
    console.error('Test run failed with error:', error);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);

  if (fails > 0) {
    console.log('\n>>> SOME MATRIX TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('\n>>> ALL MATRIX TESTS PASSED!');
    process.exit(0);
  }
}

runEstimateAmountMatrixTests();
