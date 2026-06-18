const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../../src/controllers/estimates.controller');

// Helper to create mock res object
function mockRes() {
  return {
    statusCode: 200,
    jsonData: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    }
  };
}

async function testMilestone5() {
  console.log('=== RUNNING MILESTONE 5 BACKEND TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Generate unique suffix for test isolation
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const activeWorkOrder = `TEST_WO_M5_ACTIVE_${suffix}`;

  const mobileJE_Owner = `+91900000${suffix}`;
  const mobileJE_Other = `+91911111${suffix}`;
  const mobileZO = `+91922222${suffix}`;
  const mobileHO = `+91933333${suffix}`;
  const mobileAdmin = `+91944444${suffix}`;

  let createdEstimateId = null;
  const insertedMaterialIds = [];

  try {
    // 0. Setup: Clean up and insert test records
    console.log('0. Setting up isolated test records...');

    // Delete existing records to avoid conflict
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileHO, mobileAdmin]);

    // Insert Users
    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE_Owner, display_name: 'JE Owner', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJE_Other, display_name: 'JE Other', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileHO, display_name: 'HO User', role: 'ho', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    // Insert Project
    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder,
        estimate_no: `EST_M5_${suffix}`,
        work_order_value: 1000000.00,
        site_details: 'Staging Site M5',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    // Insert Materials
    const { data: testMats, error: matsError } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement B ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement C ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();

    if (matsError) throw matsError;
    if (testMats) {
      testMats.forEach(m => insertedMaterialIds.push(m.id));
    }

    // Create Estimate
    const resCreate = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-10' }
    }, resCreate);

    if (resCreate.statusCode === 201) {
      createdEstimateId = resCreate.jsonData.estimate.estimate_id;
      console.log(`   Test records set up successfully. Estimate ID: ${createdEstimateId}`);
    } else {
      throw new Error(`Failed to create test estimate: ${resCreate.jsonData.message}`);
    }

    // Save 3 valid items to calculate amount changes
    const resSaveItems = mockRes();
    await saveDraftItems({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement A ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 100,
            rate_reference: 'Ref'
          },
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement B ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 200,
            rate_reference: 'Ref'
          },
          {
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement C ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 300,
            rate_reference: 'Ref'
          }
        ]
      }
    }, resSaveItems);

    if (resSaveItems.statusCode !== 200) {
      throw new Error(`Failed to save items: ${resSaveItems.jsonData.message}`);
    }

    // Submit Estimate to start review
    const resSubmit = mockRes();
    await submitEstimate({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' }
    }, resSubmit);

    if (resSubmit.statusCode !== 200) {
      throw new Error(`Failed to submit estimate: ${resSubmit.jsonData.message}`);
    }

    // Retrieve saved items database IDs for testing row approvals
    const { data: currentItems, error: fetchItemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', createdEstimateId)
      .order('created_at', { ascending: true });

    if (fetchItemsError) throw fetchItemsError;
    const itemIdA = currentItems[0].item_id;
    const itemIdB = currentItems[1].item_id;
    const itemIdC = currentItems[2].item_id;

    // -------------------------------------------------------------
    // Test 1: Start Review (ZO) - Transitions Submitted -> Under ZO Review
    // -------------------------------------------------------------
    console.log('\n1. Testing start review (ZO)...');
    const req1 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' }
    };
    const res1 = mockRes();
    await reviewEstimate(req1, res1);

    if (res1.statusCode === 200 && res1.jsonData.estimate.estimate_status === 'Under ZO Review') {
      console.log('   [PASS] Estimate transitioned to Under ZO Review successfully.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 200 and Under ZO Review, got: ${res1.statusCode}`, res1.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Start Review Guard (Unauthorized) - JE calling review Estimate
    // -------------------------------------------------------------
    console.log('\n2. Testing start review guard (Unauthorized Actor JE)...');
    const req2 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' }
    };
    const res2 = mockRes();
    await reviewEstimate(req2, res2);

    if (res2.statusCode === 403) {
      console.log('   [PASS] JE was blocked from calling reviewEstimate.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403, got: ${res2.statusCode}`, res2.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Start Review Guard (Wrong Stage) - ZO calling review on ZO Approved
    // -------------------------------------------------------------
    console.log('\n3. Testing start review guard (Wrong Stage ZO Approved for ZO)...');
    // Manually force status to ZO Approved for testing guard
    await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Approved' }).eq('estimate_id', createdEstimateId);

    const req3 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' }
    };
    const res3 = mockRes();
    await reviewEstimate(req3, res3);

    if (res3.statusCode === 403) {
      console.log('   [PASS] ZO was blocked from reviewing a ZO Approved estimate.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 403, got: ${res3.statusCode}`, res3.jsonData);
      fails++;
    }

    // Restore to Under ZO Review
    await supabase.from('project_cost_estimates').update({ estimate_status: 'Under ZO Review' }).eq('estimate_id', createdEstimateId);

    // -------------------------------------------------------------
    // Test 4: Submit Row Approvals - Updating item approval status
    // -------------------------------------------------------------
    console.log('\n4. Testing submit row approvals (Approve A and B, Not Approve C with remarks)...');
    const req4 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: itemIdA, approve_status: 'Approve' },
          { item_id: itemIdB, approve_status: 'Approve' },
          { item_id: itemIdC, approve_status: 'Not Approve', remarks: 'Needs revision' }
        ]
      }
    };
    const res4 = mockRes();
    await submitRowApprovals(req4, res4);

    if (res4.statusCode === 200) {
      const items = res4.jsonData.items;
      const approvedA = items.find(i => i.item_id === itemIdA);
      const approvedB = items.find(i => i.item_id === itemIdB);
      const rejectedC = items.find(i => i.item_id === itemIdC);

      if (
        approvedA.zo_office_approve === 'Approve' &&
        approvedB.zo_office_approve === 'Approve' &&
        rejectedC.zo_office_approve === 'Not Approve' &&
        rejectedC.zo_remarks === 'Needs revision'
      ) {
        console.log('   [PASS] Row approvals applied correctly to database items.');
        passes++;
      } else {
        console.log('   [FAIL] Items approval state not updated correctly:', items);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200, got: ${res4.statusCode}`, res4.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Submit Row Approvals Guard (Invalid Item)
    // -------------------------------------------------------------
    console.log('\n5. Testing row approvals guard for invalid item ID...');
    const req5 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: '00000000-0000-0000-0000-000000000000', approve_status: 'Approve' }
        ]
      }
    };
    const res5 = mockRes();
    await submitRowApprovals(req5, res5);

    if (res5.statusCode === 404) {
      console.log('   [PASS] Correctly blocked row approvals for non-existent item ID.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 404, got: ${res5.statusCode}`, res5.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: Submit Row Approvals Guard (Invalid Status)
    // -------------------------------------------------------------
    console.log('\n6. Testing row approvals guard for invalid status...');
    const req6 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: itemIdA, approve_status: 'Maybe' }
        ]
      }
    };
    const res6 = mockRes();
    await submitRowApprovals(req6, res6);

    if (res6.statusCode === 400) {
      console.log('   [PASS] Correctly blocked row approvals for invalid status.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 400, got: ${res6.statusCode}`, res6.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Submit Row Approvals Guard (Duplicate IDs)
    // -------------------------------------------------------------
    console.log('\n7. Testing row approvals guard for duplicate item IDs...');
    const req7 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: itemIdA, approve_status: 'Approve' },
          { item_id: itemIdA, approve_status: 'Not Approve', remarks: 'Duplicate entry' }
        ]
      }
    };
    const res7 = mockRes();
    await submitRowApprovals(req7, res7);

    if (res7.statusCode === 400 && res7.jsonData.message.includes('Duplicate item_id')) {
      console.log('   [PASS] Blocked row approvals containing duplicate item IDs.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 400 with duplicate message, got: ${res7.statusCode}`, res7.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: Submit Row Approvals Guard (Remarks Required on Reject)
    // -------------------------------------------------------------
    console.log('\n8. Testing row approvals guard for missing remarks on rejection...');
    const req8 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: itemIdC, approve_status: 'Not Approve', remarks: '   ' } // empty remarks
        ]
      }
    };
    const res8 = mockRes();
    await submitRowApprovals(req8, res8);

    if (res8.statusCode === 400 && res8.jsonData.message.includes('Remarks are required')) {
      console.log('   [PASS] Blocked rejection row approval with missing/blank remarks.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 400 with remarks error, got: ${res8.statusCode}`, res8.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9: Submit Review Guard (Undecided Rows)
    // -------------------------------------------------------------
    console.log('\n9. Testing submit review guard with undecided rows...');
    // Reset itemIdA's decision to NULL in database
    await supabase.from('project_cost_estimate_items').update({ zo_office_approve: null }).eq('item_id', itemIdA);

    const req9 = {
      params: { id: createdEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { remarks: 'Final Review Comments' }
    };
    const res9 = mockRes();
    await submitReview(req9, res9);

    if (res9.statusCode === 422 && res9.jsonData.message.includes('All rows must be decided')) {
      console.log('   [PASS] Correctly blocked final review submission with undecided rows.');
      passes++;
    } else {
      console.log(`   [FAIL] Expected 422, got: ${res9.statusCode}`, res9.jsonData);
      fails++;
    }

    // Restore itemIdA decision to Approve
    await supabase.from('project_cost_estimate_items').update({ zo_office_approve: 'Approve' }).eq('item_id', itemIdA);

    // -------------------------------------------------------------
    // Test 10: Submit Review Approved (All Approved)
    // -------------------------------------------------------------
    console.log('\n10. Testing submit review approved (all rows Approve)...');
    // Ensure all items are approved
    await supabase.from('project_cost_estimate_items').update({ zo_office_approve: 'Approve' }).eq('estimate_id', createdEstimateId);

    const res10 = mockRes();
    await submitReview(req9, res10);

    if (res10.statusCode === 200 && res10.jsonData.estimate.estimate_status === 'ZO Approved') {
      const est = res10.jsonData.estimate;
      if (
        est.zo_approved_by === mobileZO &&
        est.zo_remarks === 'Final Review Comments' &&
        est.zo_approval_date !== null
      ) {
        console.log('   [PASS] Final review submitted and transitioned to ZO Approved successfully.');
        passes++;
      } else {
        console.log('   [FAIL] Incorrect stamps on ZO Approved estimate header:', est);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200 and ZO Approved status, got: ${res10.statusCode}`, res10.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 11: Submit Review Rejected (At Least One Rejected)
    // -------------------------------------------------------------
    console.log('\n11. Testing submit review rejected (at least one row Not Approve)...');
    // Prepare another estimate
    const suffix2 = Math.floor(10000 + Math.random() * 90000);
    const activeWorkOrder2 = `TEST_WO_M5_REJ_${suffix2}`;
    
    // Insert Users/Projects
    await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder2,
        estimate_no: `EST_M5_R_${suffix2}`,
        work_order_value: 500000.00,
        site_details: 'Staging Site M5 Rej',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);

    const resCreateRej = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder2, zonal_office_no: 'ZO-10' }
    }, resCreateRej);

    const rejEstimateId = resCreateRej.jsonData.estimate.estimate_id;

    await saveDraftItems({
      params: { id: rejEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' }
        ]
      }
    }, mockRes());

    await submitEstimate({
      params: { id: rejEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' }
    }, mockRes());

    await reviewEstimate({
      params: { id: rejEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' }
    }, mockRes());

    const { data: rejItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', rejEstimateId).order('created_at', { ascending: true });
    
    // Approve item 1, Reject item 2
    await submitRowApprovals({
      params: { id: rejEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: rejItems[0].item_id, approve_status: 'Approve' },
          { item_id: rejItems[1].item_id, approve_status: 'Not Approve', remarks: 'Bad choice' }
        ]
      }
    }, mockRes());

    // Submit Review (expect Rejected by ZO)
    const resRejReview = mockRes();
    await submitReview({
      params: { id: rejEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { remarks: 'Rejection remarks' }
    }, resRejReview);

    if (resRejReview.statusCode === 200 && resRejReview.jsonData.estimate.estimate_status === 'Rejected by ZO') {
      const est = resRejReview.jsonData.estimate;
      if (
        est.zo_approved_by === mobileZO &&
        est.zo_remarks === 'Rejection remarks' &&
        est.zo_approval_date !== null
      ) {
        console.log('   [PASS] Final review submitted and transitioned to Rejected by ZO with stamps successfully.');
        passes++;
      } else {
        console.log('   [FAIL] Stamps missing/incorrect on Rejected by ZO header:', est);
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200 and Rejected by ZO status, got: ${resRejReview.statusCode}`, resRejReview.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 12: Test Mixed Approval Rejection Amount Recalculation
    // -------------------------------------------------------------
    console.log('\n12. Testing amount recalculation on Rejected by ZO vs ZO Approved...');
    // Recall amount rules:
    // - Rejected by ZO retains full amount: sum(all items) = 10*100 + 10*200 = 3000
    // - ZO Approved recalculates: sum(approved items only) = 10*100 + 10*200 + 10*300 = 6000
    const rejEstAmount = Number(resRejReview.jsonData.estimate.estimate_amount);
    const appEstAmount = Number(res10.jsonData.estimate.estimate_amount);

    if (rejEstAmount === 3000.00 && appEstAmount === 6000.00) {
      console.log('   [PASS] Amount recalculation rules verified (Rejections retain total, Approved sums approved items).');
      passes++;
    } else {
      console.log(`   [FAIL] Incorrect estimate amounts. Rejected: ${rejEstAmount} (expected 3000), Approved: ${appEstAmount} (expected 6000)`);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 13: Auto-Resubmit ZO Revision
    // -------------------------------------------------------------
    console.log('\n13. Testing auto-resubmission of expired ZO Revision Requested...');
    // Create new estimate
    const suffix3 = Math.floor(10000 + Math.random() * 90000);
    const activeWorkOrder3 = `TEST_WO_M5_ZO_AR_${suffix3}`;
    await supabase.from('projects_master').insert([
      { work_order_no: activeWorkOrder3, estimate_no: `EST_M5_ZAR_${suffix3}`, work_order_value: 500000.00, site_details: 'Staging ZAR', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD', status: 'Running', created_by: mobileAdmin, edited_by: mobileAdmin }
    ]);

    const resCreateZar = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder3, zonal_office_no: 'ZO-10' }
    }, resCreateZar);
    const zarEstimateId = resCreateZar.jsonData.estimate.estimate_id;

    await saveDraftItems({
      params: { id: zarEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' }
        ]
      }
    }, mockRes());

    // Submit and move to Under ZO Review
    await submitEstimate({ params: { id: zarEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: zarEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    const { data: zarItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', zarEstimateId).order('created_at', { ascending: true });
    
    // Set 1 Approved, 1 Not Approve
    await submitRowApprovals({
      params: { id: zarEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: zarItems[0].item_id, approve_status: 'Approve' },
          { item_id: zarItems[1].item_id, approve_status: 'Not Approve', remarks: 'Bad' }
        ]
      }
    }, mockRes());

    // Force status to ZO Revision Requested and create expired revision log
    await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Revision Requested', estimate_revision: 1 }).eq('estimate_id', zarEstimateId);

    const expiredDate = new Date();
    expiredDate.setMinutes(expiredDate.getMinutes() - 10);

    const { error: zarLogErr } = await supabase.from('estimate_revision_log').insert({
      estimate_id: zarEstimateId,
      revision_cycle: 1,
      stage: 'ZO',
      requested_by: mobileZO,
      revision_deadline: expiredDate.toISOString(),
      created_at: expiredDate.toISOString()
    });
    if (zarLogErr) throw zarLogErr;

    // Fetch before-state
    const { data: estBefore } = await supabase.from('project_cost_estimates').select('*').eq('estimate_id', zarEstimateId).single();

    // Call reviewEstimate as ZO (expecting auto-resubmission)
    const resZarReview = mockRes();
    await reviewEstimate({
      params: { id: zarEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' }
    }, resZarReview);

    if (resZarReview.statusCode === 200 && resZarReview.jsonData.estimate.estimate_status === 'Submitted') {
      const estAfter = resZarReview.jsonData.estimate;
      
      // Verify revision incremented by 1
      const isRevisionIncremented = estAfter.estimate_revision === estBefore.estimate_revision + 1;

      // Verify unapproved item reset
      const { data: itemsAfter } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', zarEstimateId).order('created_at', { ascending: true });
      const item1Reset = itemsAfter[0].zo_office_approve === 'Approve';
      const item2Reset = itemsAfter[1].zo_office_approve === null; // Was 'Not Approve', now NULL

      // Verify single AUTO_RESUBMIT audit entry
      const { data: auditLogs } = await supabase.from('audit_log').select('*').eq('record_identifier', zarEstimateId).eq('action', 'AUTO_RESUBMIT');
      const singleAudit = auditLogs && auditLogs.length === 1 && auditLogs[0].user_id === null;

      if (isRevisionIncremented && item1Reset && item2Reset && singleAudit) {
        console.log('   [PASS] Expired ZO Revision Requested auto-resubmitted successfully (Submitted, +1 revision, NULLed Not Approve rows, single AUTO_RESUBMIT log).');
        passes++;
      } else {
        console.log('   [FAIL] Auto-resubmission state check failed:', { isRevisionIncremented, item1Reset, item2Reset, singleAudit, auditLogs });
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200 and Submitted status, got: ${resZarReview.statusCode}`, resZarReview.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 14: Auto-Resubmit HO Revision
    // -------------------------------------------------------------
    console.log('\n14. Testing auto-resubmission of expired HO Revision Requested...');
    // Create new estimate
    const suffix4 = Math.floor(10000 + Math.random() * 90000);
    const activeWorkOrder4 = `TEST_WO_M5_HO_AR_${suffix4}`;
    await supabase.from('projects_master').insert([
      { work_order_no: activeWorkOrder4, estimate_no: `EST_M5_HAR_${suffix4}`, work_order_value: 500000.00, site_details: 'Staging HAR', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD', status: 'Running', created_by: mobileAdmin, edited_by: mobileAdmin }
    ]);

    const resCreateHar = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder4, zonal_office_no: 'ZO-10' }
    }, resCreateHar);
    const harEstimateId = resCreateHar.jsonData.estimate.estimate_id;

    await saveDraftItems({
      params: { id: harEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' }
        ]
      }
    }, mockRes());

    // Submit and move to ZO Approved
    await submitEstimate({ params: { id: harEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: harEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: harItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', harEstimateId).order('created_at', { ascending: true });
    
    // ZO Approves all
    await submitRowApprovals({
      params: { id: harEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: {
        approvals: [
          { item_id: harItems[0].item_id, approve_status: 'Approve' },
          { item_id: harItems[1].item_id, approve_status: 'Approve' }
        ]
      }
    }, mockRes());
    await submitReview({ params: { id: harEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

    // Force status to HO Revision Requested, create HO unapproved row, and create expired revision log
    await supabase.from('project_cost_estimates').update({ estimate_status: 'HO Revision Requested', estimate_revision: 2 }).eq('estimate_id', harEstimateId);
    
    // Simulate HO row approval (Approve item 1, Not Approve item 2)
    await supabase.from('project_cost_estimate_items').update({
      ho_office_approve: 'Approve'
    }).eq('item_id', harItems[0].item_id);

    await supabase.from('project_cost_estimate_items').update({
      ho_office_approve: 'Not Approve',
      ho_remarks: 'Bad size'
    }).eq('item_id', harItems[1].item_id);

    const expiredDate2 = new Date();
    expiredDate2.setMinutes(expiredDate2.getMinutes() - 10);

    const { error: harLogErr } = await supabase.from('estimate_revision_log').insert({
      estimate_id: harEstimateId,
      revision_cycle: 1,
      stage: 'HO',
      requested_by: mobileHO,
      revision_deadline: expiredDate2.toISOString(),
      created_at: expiredDate2.toISOString()
    });
    if (harLogErr) throw harLogErr;

    // Fetch before-state
    const { data: estBeforeHO } = await supabase.from('project_cost_estimates').select('*').eq('estimate_id', harEstimateId).single();

    // Call reviewEstimate as HO (expecting auto-resubmission)
    const resHarReview = mockRes();
    await reviewEstimate({
      params: { id: harEstimateId },
      user: { mobile_number: mobileHO, role: 'ho' }
    }, resHarReview);

    if (resHarReview.statusCode === 200 && resHarReview.jsonData.estimate.estimate_status === 'Under HO Review') {
      const estAfterHO = resHarReview.jsonData.estimate;

      // Verify revision incremented by 1
      const isRevisionIncrementedHO = estAfterHO.estimate_revision === estBeforeHO.estimate_revision + 1;

      // Verify HO unapproved item reset, ZO approvals preserved
      const { data: itemsAfterHO } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', harEstimateId).order('created_at', { ascending: true });
      const zoPreserved1 = itemsAfterHO[0].zo_office_approve === 'Approve';
      const zoPreserved2 = itemsAfterHO[1].zo_office_approve === 'Approve';
      const hoApproved1 = itemsAfterHO[0].ho_office_approve === 'Approve';
      const hoReset2 = itemsAfterHO[1].ho_office_approve === null; // Was 'Not Approve', now NULL

      // Verify amount recalculation for Under HO Review (only sums ZO approved rows = 10*100 + 10*200 = 3000.00)
      const amountCorrect = Number(estAfterHO.estimate_amount) === 3000.00;

      // Verify single AUTO_RESUBMIT audit entry
      const { data: auditLogsHO } = await supabase.from('audit_log').select('*').eq('record_identifier', harEstimateId).eq('action', 'AUTO_RESUBMIT');
      const singleAuditHO = auditLogsHO && auditLogsHO.length === 1 && auditLogsHO[0].user_id === null;

      if (isRevisionIncrementedHO && zoPreserved1 && zoPreserved2 && hoApproved1 && hoReset2 && amountCorrect && singleAuditHO) {
        console.log('   [PASS] Expired HO Revision Requested auto-resubmitted successfully (Under HO Review, +1 revision, zo preserved, ho NULLed, correct amount, single AUTO_RESUBMIT log).');
        passes++;
      } else {
        console.log('   [FAIL] HO Auto-resubmission state check failed:', { isRevisionIncrementedHO, zoPreserved1, zoPreserved2, hoApproved1, hoReset2, amountCorrect, singleAuditHO });
        fails++;
      }
    } else {
      console.log(`   [FAIL] Expected 200 and Under HO Review status, got: ${resHarReview.statusCode}`, resHarReview.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 15: Auto-Resubmit Guard (Unauthorized Actor)
    // -------------------------------------------------------------
    console.log('\n15. Testing auto-resubmission guards for unauthorized actors...');
    // Create another ZO revision requested expired estimate
    const suffix5 = Math.floor(10000 + Math.random() * 90000);
    const activeWorkOrder5 = `TEST_WO_M5_GUARD_${suffix5}`;
    await supabase.from('projects_master').insert([
      { work_order_no: activeWorkOrder5, estimate_no: `EST_M5_G_${suffix5}`, work_order_value: 500000.00, site_details: 'Staging G', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD', status: 'Running', created_by: mobileAdmin, edited_by: mobileAdmin }
    ]);

    const resCreateG = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder5, zonal_office_no: 'ZO-10' }
    }, resCreateG);
    const gEstimateId = resCreateG.jsonData.estimate.estimate_id;

    await saveDraftItems({
      params: { id: gEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }]
      }
    }, mockRes());

    // Submit and move to ZO Revision Requested
    await submitEstimate({ params: { id: gEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
    await reviewEstimate({ params: { id: gEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
    const { data: gItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', gEstimateId);
    
    await submitRowApprovals({
      params: { id: gEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' },
      body: { approvals: [{ item_id: gItems[0].item_id, approve_status: 'Not Approve', remarks: 'Bad' }] }
    }, mockRes());

    await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Revision Requested' }).eq('estimate_id', gEstimateId);
    await supabase.from('estimate_revision_log').insert({
      estimate_id: gEstimateId,
      revision_cycle: 1,
      stage: 'ZO',
      requested_by: mobileZO,
      revision_deadline: expiredDate.toISOString(),
      created_at: expiredDate.toISOString()
    });

    // Call reviewEstimate as HO actor on ZO Revision Requested (should fail 403)
    const resGuardZO = mockRes();
    await reviewEstimate({
      params: { id: gEstimateId },
      user: { mobile_number: mobileHO, role: 'ho' }
    }, resGuardZO);

    // Force status to HO Revision Requested and create expired log
    await supabase.from('project_cost_estimates').update({ estimate_status: 'HO Revision Requested' }).eq('estimate_id', gEstimateId);
    await supabase.from('estimate_revision_log').update({ stage: 'HO', requested_by: mobileHO }).eq('estimate_id', gEstimateId);

    // Call reviewEstimate as ZO actor on HO Revision Requested (should fail 403)
    const resGuardHO = mockRes();
    await reviewEstimate({
      params: { id: gEstimateId },
      user: { mobile_number: mobileZO, role: 'zo' }
    }, resGuardHO);

    if (resGuardZO.statusCode === 403 && resGuardHO.statusCode === 403) {
      console.log('   [PASS] Auto-resubmission guards successfully blocked unauthorized actors.');
      passes++;
    } else {
      console.log('   [FAIL] Auto-resubmission guards failed to block unauthorized actors:', { zoGuardStatus: resGuardZO.statusCode, hoGuardStatus: resGuardHO.statusCode });
      fails++;
    }

  } catch (error) {
    console.error(`Milestone 5 Test Suite failed: ${error.message}`);
    fails++;
  } finally {
    // -------------------------------------------------------------
    // Cleanup: Remove test estimates and master records to prevent pollution
    // -------------------------------------------------------------
    console.log('\nCleaning up verification records...');
    
    const { data: testEsts } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .like('work_order_no', 'TEST_WO_M5_%');

    const testEstIds = (testEsts || []).map(e => e.estimate_id);

    if (createdEstimateId && !testEstIds.includes(createdEstimateId)) {
      testEstIds.push(createdEstimateId);
    }

    if (testEstIds.length > 0) {
      await supabase.from('estimate_revision_log').delete().in('estimate_id', testEstIds);
      await supabase.from('project_cost_estimate_items').delete().in('estimate_id', testEstIds);
      
      // Dissociate estimate headers from test projects and test users
      await supabase.from('project_cost_estimates').update({
        work_order_no: 'WB_BAN_102',
        created_by: '+918276071523',
        last_modified_by: '+918276071523',
        je_user_id: '+918276071523',
        zo_approved_by: null,
        ho_approved_by: null
      }).in('estimate_id', testEstIds);
    }

    await supabase.from('projects_master').delete().like('work_order_no', 'TEST_WO_M5_%');
    if (insertedMaterialIds.length > 0) {
      await supabase.from('material_master').delete().in('id', insertedMaterialIds);
    }

    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileHO, mobileAdmin]);

    console.log('   Cleanup done.');
  }

  // Final summary
  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);

  if (fails === 0 && passes === 15) {
    console.log('\n>>> ALL MILESTONE 5 TESTS PASSED SUCCESSFULLY! <<<\n');
    process.exit(0);
  } else {
    console.log('\n>>> SOME MILESTONE 5 TESTS FAILED! <<<\n');
    process.exit(1);
  }
}

// Execute tests if run directly
if (require.main === module) {
  testMilestone5();
}
