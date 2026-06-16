const { supabase } = require('../../src/db/supabase');
const {
  createEstimate,
  submitEstimate,
  reviewEstimate
} = require('../../src/controllers/estimates.controller');
const { getMaterials } = require('../../src/controllers/materials.controller');
const { getReports } = require('../../src/controllers/reports.controller');

// Import Helpers
const mockRes = require('../helpers/mockRes');
const setupUsers = require('../helpers/setupUsers');
const setupProject = require('../helpers/setupProject');
const cleanupEstimate = require('../helpers/cleanupEstimate');

async function runPerformanceTests() {
  console.log('=== RUNNING PERFORMANCE TESTS ===\n');
  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(10000 + Math.random() * 90000);
  const mobileJE = `+9196100${suffix}`;
  const mobileZO = `+9196200${suffix}`;
  const mobileAdmin = `+9196400${suffix}`;

  try {
    // 0. Setup whitelisted users
    await setupUsers([
      { mobile_number: mobileJE, display_name: 'JE User', role: 'je', is_active: true },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true }
    ]);

    // Setup materials
    const { data: testMats, error: matErr } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Perf A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();
    if (matErr) throw matErr;

    const setupProjectAndEstimate = async (testName) => {
      const wo = `TEST_WO_PERF_${testName}_${suffix}`;
      await setupProject(wo, `EST_PERF_${testName}_${suffix}`, 5000000.00, mobileAdmin);

      const res = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE, role: 'je' },
        body: { work_order_no: wo, zonal_office_no: 'ZO-1' }
      }, res);
      
      if (res.statusCode !== 201) {
        throw new Error(`Failed to create estimate: ${res.jsonData.message}`);
      }
      return { wo, estId: res.jsonData.estimate.estimate_id };
    };

    // -------------------------------------------------------------------------
    // P1 — 500 Row Approvals Execution (< 2 sec)
    // -------------------------------------------------------------------------
    console.log('P1 — 500 Row Approvals Execution...');
    const p1Data = await setupProjectAndEstimate('P1');
    const p1Items = Array.from({ length: 500 }).map(() => ({
      estimate_id: p1Data.estId,
      material_main_head: 'Raw Materials',
      material_sub_head: 'Cement',
      material_details: testMats[0].Material_Details,
      unit: 'Bag',
      qty: 1,
      rate: 10,
      amount: 10.00,
      rate_reference: 'Ref'
    }));
    const { data: insertedP1, error: insErrP1 } = await supabase.from('project_cost_estimate_items').insert(p1Items).select('item_id');
    if (insErrP1) throw insErrP1;

    await submitEstimate({ params: { id: p1Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: p1Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const approvalsP1 = insertedP1.map(i => ({ item_id: i.item_id, approve_status: 'Approve' }));

    const startP1 = Date.now();
    const { error: rpcErrP1 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: p1Data.estId,
      p_approvals: approvalsP1,
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });
    const durP1 = Date.now() - startP1;

    if (!rpcErrP1 && durP1 < 2000) {
      console.log(`  [PASS] P1: 500 approvals executed in ${durP1} ms (< 2000 ms).`);
      passes++;
    } else {
      console.log(`  [FAIL] P1: error =`, rpcErrP1, `duration = ${durP1} ms`);
      fails++;
    }
    await cleanupEstimate(p1Data.estId, p1Data.wo);

    // -------------------------------------------------------------------------
    // P2 — 1000 Row Approvals Execution (< 5 sec)
    // -------------------------------------------------------------------------
    console.log('P2 — 1000 Row Approvals Execution...');
    const p2Data = await setupProjectAndEstimate('P2');
    const p2Items = Array.from({ length: 1000 }).map(() => ({
      estimate_id: p2Data.estId,
      material_main_head: 'Raw Materials',
      material_sub_head: 'Cement',
      material_details: testMats[0].Material_Details,
      unit: 'Bag',
      qty: 1,
      rate: 10,
      amount: 10.00,
      rate_reference: 'Ref'
    }));
    const { data: insertedP2, error: insErrP2 } = await supabase.from('project_cost_estimate_items').insert(p2Items).select('item_id');
    if (insErrP2) throw insErrP2;

    await submitEstimate({ params: { id: p2Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: p2Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const approvalsP2 = insertedP2.map(i => ({ item_id: i.item_id, approve_status: 'Approve' }));

    const startP2 = Date.now();
    const { error: rpcErrP2 } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: p2Data.estId,
      p_approvals: approvalsP2,
      p_stage: 'ZO',
      p_modified_by: mobileZO
    });
    const durP2 = Date.now() - startP2;

    if (!rpcErrP2 && durP2 < 5000) {
      console.log(`  [PASS] P2: 1000 approvals executed in ${durP2} ms (< 5000 ms).`);
      passes++;
    } else {
      console.log(`  [FAIL] P2: error =`, rpcErrP2, `duration = ${durP2} ms`);
      fails++;
    }
    await cleanupEstimate(p2Data.estId, p2Data.wo);

    // -------------------------------------------------------------------------
    // P3 — getMaterials Pagination with Thousands of Materials
    // -------------------------------------------------------------------------
    console.log('P3 — getMaterials Pagination Performance...');
    const extraMats = Array.from({ length: 1000 }).map((_, idx) => ({
      Material_Main_Head: 'Raw Materials',
      Material_Sub_Head: 'Cement',
      Material_Details: `Cement Temp ${idx} ${suffix}`,
      M_Unit: 'Bag',
      is_active: true,
      created_by: mobileAdmin
    }));
    const { data: insertedMats, error: matInsErr } = await supabase.from('material_master').insert(extraMats).select('id');
    if (matInsErr) throw matInsErr;

    const startP3 = Date.now();
    const resP3 = mockRes();
    await getMaterials({
      query: { page: 1, limit: 50 },
      user: { role: 'admin' }
    }, resP3);
    const durP3 = Date.now() - startP3;

    if (resP3.statusCode === 200 && durP3 < 1000) {
      console.log(`  [PASS] P3: getMaterials returned 200 in ${durP3} ms (< 1000 ms).`);
      passes++;
    } else {
      console.log(`  [FAIL] P3: code = ${resP3.statusCode}, duration = ${durP3} ms`);
      fails++;
    }
    // Cleanup materials
    await supabase.from('material_master').delete().in('id', insertedMats.map(m => m.id));

    // -------------------------------------------------------------------------
    // P4 — getReports Pagination with Thousands of Reports
    // -------------------------------------------------------------------------
    console.log('P4 — getReports Pagination Performance...');
    const f4Proj = `TEST_WO_PERF_P4_${suffix}`;
    await setupProject(f4Proj, `EST_PERF_P4_${suffix}`, 5000000.00, mobileAdmin);

    const extraReports = Array.from({ length: 1000 }).map((_, idx) => ({
      work_order_no: f4Proj,
      amount: 100,
      remarks: `Report Temp ${idx} ${suffix}`,
      created_by: mobileAdmin,
      edited_by: mobileAdmin,
      is_deleted: false
    }));
    const { data: insertedReports, error: repInsErr } = await supabase.from('fund_reports').insert(extraReports).select('fund_report_id');
    if (repInsErr) throw repInsErr;

    const startP4 = Date.now();
    const resP4 = mockRes();
    await getReports({
      query: { page: 1, limit: 50 }
    }, resP4);
    const durP4 = Date.now() - startP4;

    if (resP4.statusCode === 200 && durP4 < 1000) {
      console.log(`  [PASS] P4: getReports returned 200 in ${durP4} ms (< 1000 ms).`);
      passes++;
    } else {
      console.log(`  [FAIL] P4: code = ${resP4.statusCode}, duration = ${durP4} ms`);
      fails++;
    }
    // Cleanup reports & projects & users
    await supabase.from('fund_reports').delete().in('fund_report_id', insertedReports.map(r => r.fund_report_id));
    await supabase.from('projects_master').delete().eq('work_order_no', f4Proj);
    await supabase.from('material_master').delete().in('id', testMats.map(m => m.id));
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO, mobileAdmin]);

  } catch (error) {
    console.error('Performance test run failed with error:', error);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);

  if (fails > 0) {
    console.log('\n>>> SOME PERFORMANCE TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('\n>>> ALL PERFORMANCE TESTS PASSED!');
    process.exit(0);
  }
}

runPerformanceTests();
