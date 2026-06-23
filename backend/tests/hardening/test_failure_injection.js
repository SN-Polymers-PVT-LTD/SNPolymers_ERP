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

async function runFailureInjectionTests() {
  console.log('=== RUNNING FAILURE INJECTION TESTS ===\n');
  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(10000 + Math.random() * 90000);
  const mobileJE = `+9197100${suffix}`;
  const mobileZO = `+9197200${suffix}`;
  const mobileHO = `+9197300${suffix}`;
  const mobileAdmin = `+9197400${suffix}`;

  try {
    // 0. Setup whitelisted users
    await setupUsers([
      { mobile_number: mobileJE, display_name: 'JE User', role: 'je', is_active: true },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true },
      { mobile_number: mobileHO, display_name: 'HO User', role: 'ho', is_active: true },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true }
    ]);

    // Setup materials
    const { data: testMats, error: matErr } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Cement Fail A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();
    if (matErr) throw matErr;

    const setupProjectAndEstimate = async (testName) => {
      const wo = `TEST_FAIL_WO_${testName}_${suffix}`;
      await setupProject(wo, `EST_FAIL_${testName}_${suffix}`, 5000000.00, mobileAdmin);

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
    // F1 — Invalid Item In Large Batch
    // -------------------------------------------------------------------------
    console.log('F1 — Invalid Item In Large Batch...');
    const f1Data = await setupProjectAndEstimate('F1');

    // Direct insert 100 items (valid ones)
    const validItems = Array.from({ length: 100 }).map(() => ({
      estimate_id: f1Data.estId,
      material_main_head: 'Raw Materials',
      material_sub_head: 'Cement',
      material_details: testMats[0].Material_Details,
      unit: 'Bag',
      qty: 1,
      rate: 10,
      amount: 10.00,
      rate_reference: 'Ref'
    }));
    const { data: insertedItemsF1, error: f1InsErr } = await supabase.from('project_cost_estimate_items').insert(validItems).select('item_id');
    if (f1InsErr) throw f1InsErr;

    await submitEstimate({ params: { id: f1Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: f1Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    // Prepare 101 approvals (100 valid, 1 invalid ID)
    const approvalsF1 = insertedItemsF1.map(i => ({ item_id: i.item_id, approve_status: 'Approve' }));
    approvalsF1.push({ item_id: '00000000-0000-0000-0000-000000000000', approve_status: 'Approve' });

    const resF1 = mockRes();
    await submitRowApprovals({
      params: { id: f1Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: approvalsF1 }
    }, resF1);

    // Verify rollback: count of approved rows should be 0
    const { data: finalItemsF1 } = await supabase.from('project_cost_estimate_items').select('zo_office_approve').eq('estimate_id', f1Data.estId);
    const approvedCountF1 = finalItemsF1.filter(i => i.zo_office_approve !== null).length;

    if (resF1.statusCode === 404 && approvedCountF1 === 0) {
      console.log('  [PASS] F1: Large batch rolled back entirely on one invalid item ID.');
      passes++;
    } else {
      console.log(`  [FAIL] F1: status = ${resF1.statusCode}, approved count = ${approvedCountF1}`);
      fails++;
    }
    await cleanupEstimate(f1Data.estId, f1Data.wo);

    // -------------------------------------------------------------------------
    // F2 — Duplicate Item IDs Mid Batch
    // -------------------------------------------------------------------------
    console.log('F2 — Duplicate Item IDs Mid Batch...');
    const f2Data = await setupProjectAndEstimate('F2');
    await saveDraftItems({
      params: { id: f2Data.estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: {
        items: [
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 10, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 2, rate: 10, rate_reference: 'Ref' }
        ]
      }
    }, mockRes());

    await submitEstimate({ params: { id: f2Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: f2Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const { data: itemsF2 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', f2Data.estId);
    
    // Duplicate item_id
    const approvalsF2 = [
      { item_id: itemsF2[0].item_id, approve_status: 'Approve' },
      { item_id: itemsF2[1].item_id, approve_status: 'Approve' },
      { item_id: itemsF2[0].item_id, approve_status: 'Not Approve', remarks: 'Dup reject' }
    ];

    const resF2 = mockRes();
    await submitRowApprovals({
      params: { id: f2Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: approvalsF2 }
    }, resF2);

    if (resF2.statusCode === 400 && resF2.jsonData.message.includes('Duplicate item_id')) {
      console.log('  [PASS] F2: Duplicate item IDs mid batch rejected cleanly.');
      passes++;
    } else {
      console.log(`  [FAIL] F2: Expected 400 with duplicate msg, got: ${resF2.statusCode}`);
      fails++;
    }
    await cleanupEstimate(f2Data.estId, f2Data.wo);

    // -------------------------------------------------------------------------
    // F3 — Wrong Estimate / Right Item
    // -------------------------------------------------------------------------
    console.log('F3 — Wrong Estimate / Right Item...');
    const f3A = await setupProjectAndEstimate('F3A');
    const f3B = await setupProjectAndEstimate('F3B');

    await saveDraftItems({
      params: { id: f3A.estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: { items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 10, rate_reference: 'Ref' }] }
    }, mockRes());
    await saveDraftItems({
      params: { id: f3B.estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: { items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 10, rate_reference: 'Ref' }] }
    }, mockRes());

    await submitEstimate({ params: { id: f3A.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await submitEstimate({ params: { id: f3B.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());

    await reviewEstimate({ params: { id: f3A.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    await reviewEstimate({ params: { id: f3B.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const { data: itemsF3A } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', f3A.estId);
    const { data: itemsF3B } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', f3B.estId);

    // Call approvals for Estimate A, but pass Estimate B's item ID
    const resF3 = mockRes();
    await submitRowApprovals({
      params: { id: f3A.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [{ item_id: itemsF3B[0].item_id, approve_status: 'Approve' }] }
    }, resF3);

    if (resF3.statusCode === 404 && resF3.jsonData.message.includes('do not belong to this estimate')) {
      console.log('  [PASS] F3: Cross-estimate item approval rejected cleanly with 404.');
      passes++;
    } else {
      console.log(`  [FAIL] F3: Expected 404 for wrong estimate mapping, got: ${resF3.statusCode}`);
      fails++;
    }
    await cleanupEstimate(f3A.estId, f3A.wo);
    await cleanupEstimate(f3B.estId, f3B.wo);

    // -------------------------------------------------------------------------
    // F4 — Empty Batch
    // -------------------------------------------------------------------------
    console.log('F4 — Empty Batch...');
    const f4Data = await setupProjectAndEstimate('F4');
    await saveDraftItems({
      params: { id: f4Data.estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: { items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 10, rate_reference: 'Ref' }] }
    }, mockRes());

    await submitEstimate({ params: { id: f4Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: f4Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const resF4 = mockRes();
    await submitRowApprovals({
      params: { id: f4Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [] }
    }, resF4);

    // The official behavior is 200 no-op (safely does nothing and returns success)
    if (resF4.statusCode === 200 && resF4.jsonData.success) {
      console.log('  [PASS] F4: Empty approval batch handled as a safe 200 no-op.');
      passes++;
    } else {
      console.log(`  [FAIL] F4: Empty batch returned status: ${resF4.statusCode}`);
      fails++;
    }
    await cleanupEstimate(f4Data.estId, f4Data.wo);

    // -------------------------------------------------------------------------
    // F5 — Concurrent Delete During Review
    // -------------------------------------------------------------------------
    console.log('F5 — Concurrent Delete During Review...');
    const f5Data = await setupProjectAndEstimate('F5');
    await saveDraftItems({
      params: { id: f5Data.estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: { items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 10, rate_reference: 'Ref' }] }
    }, mockRes());

    await submitEstimate({ params: { id: f5Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: f5Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    // Attempt direct database deletion which should fail due to prevent_estimate_hard_delete trigger
    const { error: delErr } = await supabase.from('project_cost_estimates').delete().eq('estimate_id', f5Data.estId);
    
    // Check estimate still exists and review stage survived
    const { data: estF5 } = await supabase.from('project_cost_estimates').select('estimate_status').eq('estimate_id', f5Data.estId).single();

    if (delErr && delErr.message.includes('Hard deletion of project_cost_estimates is permanently prohibited') && estF5 && estF5.estimate_status === 'Under ZO Review') {
      console.log('  [PASS] F5: Hard delete trigger correctly rejected deletion during active review.');
      passes++;
    } else {
      console.log(`  [FAIL] F5: Deletion was not blocked cleanly. Error:`, delErr, `Estimate status:`, estF5);
      fails++;
    }
    // Set back to Draft to allow teardown
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Draft' }).eq('estimate_id', f5Data.estId);
    await cleanupEstimate(f5Data.estId, f5Data.wo);

    // -------------------------------------------------------------------------
    // F6 — Audit Log Failure
    // -------------------------------------------------------------------------
    console.log('F6 — Audit Log Failure...');
    const f6Data = await setupProjectAndEstimate('F6');
    
    // Attempt to change status directly in SQL but pass last_modified_by with an invalid/non-existent user.
    // This will trigger a foreign key constraint violation on project_cost_estimates, causing a rollback.
    const { error: updateErrF6 } = await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Submitted', last_modified_by: '+919999999999' })
      .eq('estimate_id', f6Data.estId);

    // Fetch estimate to verify status did NOT change (remains Draft)
    const { data: estF6 } = await supabase.from('project_cost_estimates').select('estimate_status').eq('estimate_id', f6Data.estId).single();

    if (updateErrF6 && estF6.estimate_status === 'Draft') {
      console.log('  [PASS] F6: Database constraint failure successfully rolled back status transition.');
      passes++;
    } else {
      console.log(`  [FAIL] F6: Update did not rollback. Error:`, updateErrF6, `Status: ${estF6.estimate_status}`);
      fails++;
    }
    await cleanupEstimate(f6Data.estId, f6Data.wo);

    // -------------------------------------------------------------------------
    // F7 — Recalculation Failure (Numeric Overflow)
    // -------------------------------------------------------------------------
    console.log('F7 — Recalculation Failure...');
    const f7Data = await setupProjectAndEstimate('F7');

    // Insert 200 items, each with individual valid amount (e.g. rate = 9999999999999.00 and qty = 1.00)
    // This fits the individual project_cost_estimate_items.amount constraint of NUMERIC(18,2)
    // But the cumulative sum = 200 * 9.99e12 = 1.99e15. Let's make it bigger:
    // Rate: 99999999999999.00, Qty: 1.00. 150 items of this size will yield a sum of 1.49e16.
    // Since project_cost_estimates.estimate_amount is NUMERIC(18,2), the maximum value allowed is 99999999999999.99 (16 digits total, wait, total 18 digits including 2 decimals, so 16 digits max before decimal point).
    // Let's insert 200 items with rate = 99999999999999.00 and qty = 1.00
    const hugeItems = Array.from({ length: 200 }).map(() => ({
      estimate_id: f7Data.estId,
      material_main_head: 'Raw Materials',
      material_sub_head: 'Cement',
      material_details: testMats[0].Material_Details,
      unit: 'Bag',
      qty: 1,
      rate: 99999999999999.00,
      amount: 99999999999999.00,
      rate_reference: 'Ref'
    }));

    const { error: insErrF7 } = await supabase.from('project_cost_estimate_items').insert(hugeItems);
    if (insErrF7) throw insErrF7;

    // Call submitEstimate. Recalculation will compute the sum as 200 * 99999999999999.00 = 19999999999999800.00 (17 digits before decimal)
    // When updating project_cost_estimates.estimate_amount, it will trigger Postgres numeric overflow, failing the update.
    const resF7 = mockRes();
    await submitEstimate({ params: { id: f7Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, resF7);

    // Verify rollback: status should remain Draft
    const { data: estF7 } = await supabase.from('project_cost_estimates').select('estimate_status, estimate_amount').eq('estimate_id', f7Data.estId).single();

    if (resF7.statusCode === 500 && estF7.estimate_status === 'Draft') {
      console.log('  [PASS] F7: Numeric overflow during recalculation rolled back transaction safely.');
      passes++;
    } else {
      console.log(`  [FAIL] F7: Recalculation did not fail or status changed. Code: ${resF7.statusCode}, Status: ${estF7.estimate_status}, Amount: ${estF7.estimate_amount}`);
      fails++;
    }
    await cleanupEstimate(f7Data.estId, f7Data.wo);

    // -------------------------------------------------------------------------
    // F8 — Invalid Enum Mixed With Valid Data
    // -------------------------------------------------------------------------
    console.log('F8 — Invalid Enum Mixed With Valid Data...');
    const f8Data = await setupProjectAndEstimate('F8');
    await saveDraftItems({
      params: { id: f8Data.estId },
      user: { mobile_number: mobileJE, role: 'je' },
      body: {
        items: [
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 1, rate: 10, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: testMats[0].Material_Details, unit: 'Bag', qty: 2, rate: 10, rate_reference: 'Ref' }
        ]
      }
    }, mockRes());

    await submitEstimate({ params: { id: f8Data.estId }, user: { mobile_number: mobileJE, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: f8Data.estId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const { data: itemsF8 } = await supabase.from('project_cost_estimate_items').select('item_id').eq('estimate_id', f8Data.estId);

    const approvalsF8 = [
      { item_id: itemsF8[0].item_id, approve_status: 'Approve' },
      { item_id: itemsF8[1].item_id, approve_status: 'INVALID_STATUS_ENUM' }
    ];

    const resF8 = mockRes();
    await submitRowApprovals({
      params: { id: f8Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: approvalsF8 }
    }, resF8);

    const { data: finalItemsF8 } = await supabase.from('project_cost_estimate_items').select('zo_office_approve').eq('estimate_id', f8Data.estId);
    const approvedCountF8 = finalItemsF8.filter(i => i.zo_office_approve !== null).length;

    if (resF8.statusCode === 400 && approvedCountF8 === 0) {
      console.log('  [PASS] F8: Invalid enum value mid batch correctly aborted and rolled back batch.');
      passes++;
    } else {
      console.log(`  [FAIL] F8: Status = ${resF8.statusCode}, Approved count = ${approvedCountF8}`);
      fails++;
    }
    await cleanupEstimate(f8Data.estId, f8Data.wo);

    // -------------------------------------------------------------------------
    // F9 — Revision Request Without Deadline
    // -------------------------------------------------------------------------
    console.log('F9 — Revision Request Without Deadline...');
    const f9Data = await setupProjectAndEstimate('F9');
    
    // Direct database insert into revision log without a deadline (or deadline = null)
    // The table schema has NOT NULL constraint on revision_deadline, which should reject the insert.
    const { error: f9Error } = await supabase.from('estimate_revision_log').insert({
      estimate_id: f9Data.estId,
      revision_cycle: 1,
      stage: 'ZO',
      requested_by: mobileZO,
      revision_deadline: null
    });

    if (f9Error && f9Error.message.includes('violates not-null constraint')) {
      console.log('  [PASS] F9: Revision log request without deadline correctly rejected by NOT NULL constraint.');
      passes++;
    } else {
      console.log(`  [FAIL] F9: Missing deadline insertion was not rejected. Error:`, f9Error);
      fails++;
    }
    await cleanupEstimate(f9Data.estId, f9Data.wo);

    // -------------------------------------------------------------------------
    // F10 — Corrupt Workflow Transition (Draft -> Final Approved)
    // -------------------------------------------------------------------------
    console.log('F10 — Corrupt Workflow Transition...');
    const f10Data = await setupProjectAndEstimate('F10');

    // Call submitReview (which transitions ZO stage) directly on Draft estimate.
    // It should be blocked by the status guards in controller.
    const resF10 = mockRes();
    await submitReview({
      params: { id: f10Data.estId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { remarks: 'Hacking status to ZO Approved' }
    }, resF10);

    const { data: estF10 } = await supabase.from('project_cost_estimates').select('estimate_status').eq('estimate_id', f10Data.estId).single();

    if (resF10.statusCode === 403 && estF10.estimate_status === 'Draft') {
      console.log('  [PASS] F10: Controller workflow guards rejected invalid transition from Draft to review stage.');
      passes++;
    } else {
      console.log(`  [FAIL] F10: Invalid transition allowed. Status: ${resF10.statusCode}, Estimate DB Status: ${estF10.estimate_status}`);
      fails++;
    }
    await cleanupEstimate(f10Data.estId, f10Data.wo);

    // Cleanup whitelists
    await supabase.from('material_master').delete().in('id', testMats.map(m => m.id));
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO, mobileHO, mobileAdmin]);

  } catch (error) {
    console.error('Test execution error:', error);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);

  if (fails > 0) {
    console.log('\n>>> SOME FAILURE INJECTION TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('\n>>> ALL FAILURE INJECTION TESTS PASSED!');
    process.exit(0);
  }
}

runFailureInjectionTests();
