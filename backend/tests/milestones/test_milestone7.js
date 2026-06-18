const { supabase } = require('../../src/db/supabase');
const {
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../../src/controllers/estimates.controller');

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

async function testMilestone7() {
  console.log('=== RUNNING MILESTONE 7 INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const testZoMobile = '+918000000001';
  const testJeMobile = '+918000000002';
  const testOtherMobile = '+918000000003';
  const testHoMobile = '+918000000004';
  const testAdminMobile = '+918276071523';
  const testWorkOrder = 'WB_BAN_102'; // Running work order

  let testEstimateId = null;
  let testEstimateIdZeroItems = null;
  let testItemId = null;
  let testItemId2 = null;

  try {
    // 0. Setup: Prepare test users and estimate
    console.log('Setup: Preparing test users and estimate...');
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);

    // Insert Users
    await supabase.from('authorised_users').insert([
      { mobile_number: testZoMobile, display_name: 'Test ZO User', role: 'zo', is_active: true },
      { mobile_number: testJeMobile, display_name: 'Test JE User', role: 'je', is_active: true },
      { mobile_number: testOtherMobile, display_name: 'Other JE User', role: 'je', is_active: true },
      { mobile_number: testHoMobile, display_name: 'Test HO User', role: 'ho', is_active: true }
    ]);

    // Clear active estimates for this work order to bypass unique checks
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO', last_modified_by: testAdminMobile })
      .eq('work_order_no', testWorkOrder);

    // Insert test estimate
    const { data: estimate, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: 'EST-M7-TEMP',
        area_code: 'South Bengal',
        estimate_revision: 0,
        zonal_office_no: 'ZO-01',
        estimate_amount: 150000,
        estimate_status: 'ZO Approved',
        created_by: testJeMobile,
        last_modified_by: testZoMobile,
        zo_approved_by: testZoMobile,
        zo_approval_date: new Date().toISOString()
      })
      .select()
      .single();

    if (estErr) throw estErr;
    testEstimateId = estimate.estimate_id;

    // Create two line items for it, approved by ZO
    const { data: items, error: itemsErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([
        {
          estimate_id: testEstimateId,
          material_main_head: 'Labour',
          material_sub_head: 'Unskilled',
          material_details: 'Unskilled Worker',
          unit: 'Nos',
          qty: 100,
          rate: 500,
          amount: 50000,
          zo_office_approve: 'Approve'
        },
        {
          estimate_id: testEstimateId,
          material_main_head: 'Materials',
          material_sub_head: 'Cement',
          material_details: 'Cement Bags',
          unit: 'Bag',
          qty: 200,
          rate: 500,
          amount: 100000,
          zo_office_approve: 'Approve'
        }
      ])
      .select();

    if (itemsErr) throw itemsErr;
    testItemId = items[0].item_id;
    testItemId2 = items[1].item_id;

    // -------------------------------------------------------------
    // Test 1: HO and Admin can open ZO Approved estimate
    // -------------------------------------------------------------
    console.log('Test 1: Opening ZO Approved estimate by HO...');
    const req1 = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile }
    };
    const res1 = mockRes();
    await reviewEstimate(req1, res1);

    if (res1.statusCode === 200 && res1.jsonData.success && res1.jsonData.estimate.estimate_status === 'Under HO Review') {
      console.log('  [PASS] HO successfully opened estimate (Under HO Review).');
      passes++;
    } else {
      console.log('  [FAIL] HO failed to open estimate. Status:', res1.statusCode, res1.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Role Block checks
    // -------------------------------------------------------------
    console.log('\nTest 2: Testing role guards for reviewEstimate at HO stage...');
    // Reset to ZO Approved to test blocking
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'ZO Approved', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    const checkBlock = async (role, mobile) => {
      const req = {
        params: { id: testEstimateId },
        user: { role, mobile_number: mobile }
      };
      const res = mockRes();
      await reviewEstimate(req, res);
      return res.statusCode === 403;
    };

    const isJeBlocked = await checkBlock('je', testJeMobile);
    const isZoBlocked = await checkBlock('zo', testZoMobile);

    if (isJeBlocked && isZoBlocked) {
      console.log('  [PASS] JE and ZO correctly blocked from opening HO review.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block roles:', { isJeBlocked, isZoBlocked });
      fails++;
    }

    // Set back to Under HO Review for subsequent tests
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // -------------------------------------------------------------
    // Test 3: HO row approvals & field isolation
    // -------------------------------------------------------------
    console.log('\nTest 3: Testing HO row approvals and field isolation...');
    const req3 = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: {
        approvals: [
          { item_id: testItemId, approve_status: 'Approve' },
          { item_id: testItemId2, approve_status: 'Approve' }
        ]
      }
    };
    const res3 = mockRes();
    await submitRowApprovals(req3, res3);

    if (res3.statusCode === 200 && res3.jsonData.success) {
      // Check database to verify ho_office_approve is written and zo_office_approve is untouched
      const { data: dbItems } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', testEstimateId)
        .order('created_at', { ascending: true });

      const item1Ok = dbItems[0].ho_office_approve === 'Approve' && dbItems[0].zo_office_approve === 'Approve';
      const item2Ok = dbItems[1].ho_office_approve === 'Approve' && dbItems[1].zo_office_approve === 'Approve';

      if (item1Ok && item2Ok) {
        console.log('  [PASS] HO row approvals saved successfully with complete field isolation.');
        passes++;
      } else {
        console.log('  [FAIL] Row approvals or zo approvals inconsistent in DB:', dbItems);
        fails++;
      }
    } else {
      console.log('  [FAIL] submitRowApprovals failed. Status:', res3.statusCode, res3.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: HO submit review undecided rows check
    // -------------------------------------------------------------
    console.log('\nTest 4: Submitting HO review with undecided rows...');
    // Reset ho_office_approve on one row
    await supabase.from('project_cost_estimate_items')
      .update({ ho_office_approve: null })
      .eq('item_id', testItemId2);

    const req4 = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { remarks: 'My HO review comments' }
    };
    const res4 = mockRes();
    await submitReview(req4, res4);

    if (res4.statusCode === 422 && res4.jsonData.message.includes('must be decided')) {
      console.log('  [PASS] submitReview blocked due to undecided rows.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed submitReview with undecided rows. Status:', res4.statusCode, res4.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: HO submit review zero line items check
    // -------------------------------------------------------------
    console.log('\nTest 5: Submitting HO review with zero line items...');
    
    // Create a separate temporary estimate with zero line items specifically for this test
    const { data: estZero, error: estZeroErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: 'EST-M7-ZERO',
        area_code: 'South Bengal',
        estimate_revision: 0,
        zonal_office_no: 'ZO-01',
        estimate_amount: 0,
        estimate_status: 'Under HO Review',
        created_by: testJeMobile,
        last_modified_by: testZoMobile,
        zo_approved_by: testZoMobile,
        zo_approval_date: new Date().toISOString()
      })
      .select()
      .single();

    if (estZeroErr) throw estZeroErr;
    testEstimateIdZeroItems = estZero.estimate_id;

    const reqZero = {
      params: { id: testEstimateIdZeroItems },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { remarks: 'HO Zero Items Review' }
    };
    const res5 = mockRes();
    await submitReview(reqZero, res5);

    if (res5.statusCode === 422 && res5.jsonData.message.includes('no line items')) {
      console.log('  [PASS] submitReview correctly blocked submission for zero items.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed review submission for zero items. Status:', res5.statusCode, res5.jsonData);
      fails++;
    }

    // Clean up zero items estimate header
    await supabase.from('project_cost_estimates').delete().eq('estimate_id', testEstimateIdZeroItems);
    testEstimateIdZeroItems = null;

    // -------------------------------------------------------------
    // Test 6: Defensive verification of ZO approvals
    // -------------------------------------------------------------
    console.log('\nTest 6: Submitting HO review with inconsistent ZO approvals...');
    // Reset items to Approve for both ZO and HO first
    await supabase.from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' })
      .eq('estimate_id', testEstimateId);

    // Break ZO approval on one item (Approved by HO but Not Approved by ZO)
    await supabase.from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Not Approve' })
      .eq('item_id', testItemId2);

    const res6 = mockRes();
    await submitReview(req4, res6);

    if (res6.statusCode === 400 && res6.jsonData.message.includes('Inconsistent review state')) {
      console.log('  [PASS] Blocked inconsistent HO approval correctly.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed final review with inconsistent ZO approvals. Status:', res6.statusCode, res6.jsonData);
      fails++;
    }

    // Restore ZO approval
    await supabase.from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve' })
      .eq('item_id', testItemId2);

    // -------------------------------------------------------------
    // Test 7: Successful HO final approval (Final Approved)
    // -------------------------------------------------------------
    console.log('\nTest 7: Submitting HO review with all items approved...');
    const res7 = mockRes();
    await submitReview(req4, res7);

    if (res7.statusCode === 200 && res7.jsonData.success) {
      const est = res7.jsonData.estimate;
      const amountMatches = Number(est.estimate_amount) === 150000;
      const isStamped = est.ho_approved_by === testHoMobile && est.ho_remarks === 'My HO review comments' && est.ho_approval_date;

      if (est.estimate_status === 'Final Approved' && amountMatches && isStamped) {
        console.log('  [PASS] Review submitted successfully: Final Approved status, amount is 150000, and HO audit fields are stamped.');
        passes++;
      } else {
        console.log('  [FAIL] Incorrect estimate state after final approval:', { status: est.estimate_status, amount: est.estimate_amount, isStamped });
        fails++;
      }
    } else {
      console.log('  [FAIL] Final approval submission failed. Status:', res7.statusCode, res7.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: Stencils on Rejection (Rejected by HO)
    // -------------------------------------------------------------
    console.log('\nTest 8: Testing HO final review rejection and audit stamps...');
    // Set status back to Under HO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // Set one item as Not Approve by HO
    await supabase.from('project_cost_estimate_items')
      .update({ ho_office_approve: 'Not Approve', ho_remarks: 'Rejected item' })
      .eq('item_id', testItemId2);

    const req8 = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { remarks: 'HO Reject Remarks' }
    };
    const res8 = mockRes();
    await submitReview(req8, res8);

    if (res8.statusCode === 200 && res8.jsonData.success) {
      const est = res8.jsonData.estimate;
      const isStamped = est.ho_approved_by === testHoMobile && est.ho_remarks === 'HO Reject Remarks' && est.ho_approval_date;
      const amountMatches = Number(est.estimate_amount) === 150000; // Rejected sums all items

      if (est.estimate_status === 'Rejected by HO' && isStamped && amountMatches) {
        console.log('  [PASS] Rejection successfully stamped all HO audit fields and retained total amount.');
        passes++;
      } else {
        console.log('  [FAIL] Rejection failed to set stamps or status correctly:', { status: est.estimate_status, amount: est.estimate_amount, isStamped });
        fails++;
      }
    } else {
      console.log('  [FAIL] submitReview rejection failed. Status:', res8.statusCode, res8.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9: Admin Paths
    // -------------------------------------------------------------
    console.log('\nTest 9: Verifying Admin support for HO workflows...');
    // Reset to ZO Approved
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'ZO Approved', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // Admin opens HO review
    const reqAdminOpen = {
      params: { id: testEstimateId },
      user: { role: 'admin', mobile_number: testAdminMobile }
    };
    const resAdminOpen = mockRes();
    await reviewEstimate(reqAdminOpen, resAdminOpen);

    const openOk = resAdminOpen.statusCode === 200 && resAdminOpen.jsonData.estimate.estimate_status === 'Under HO Review';

    // Admin saves row approvals
    const reqAdminRows = {
      params: { id: testEstimateId },
      user: { role: 'admin', mobile_number: testAdminMobile },
      body: {
        approvals: [
          { item_id: testItemId, approve_status: 'Approve' },
          { item_id: testItemId2, approve_status: 'Approve' }
        ]
      }
    };
    const resAdminRows = mockRes();
    await submitRowApprovals(reqAdminRows, resAdminRows);

    const rowsOk = resAdminRows.statusCode === 200 && resAdminRows.jsonData.success;

    // Reset items to 'Approve' for both ZO and HO to avoid defensive inconsistency blocks
    await supabase.from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' })
      .eq('estimate_id', testEstimateId);

    // Admin submits review
    const reqAdminSubmit = {
      params: { id: testEstimateId },
      user: { role: 'admin', mobile_number: testAdminMobile },
      body: { remarks: 'Admin HO Review' }
    };
    const resAdminSubmit = mockRes();
    await submitReview(reqAdminSubmit, resAdminSubmit);

    const submitOk = resAdminSubmit.statusCode === 200 && resAdminSubmit.jsonData.estimate.estimate_status === 'Final Approved';

    if (openOk && rowsOk && submitOk) {
      console.log('  [PASS] Admin successfully executed open review, row approvals, and final review submission.');
      passes++;
    } else {
      console.log('  [FAIL] Admin operations failed:', { openOk, rowsOk, submitOk });
      fails++;
    }

    // -------------------------------------------------------------
    // Test 10: Concurrency Test
    // -------------------------------------------------------------
    console.log('\nTest 10: Testing concurrency safety under multiple simultaneous review submissions...');
    // Reset status back to Under HO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // Make concurrent requests
    const reqC1 = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { remarks: 'Concurrent Review 1' }
    };
    const reqC2 = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { remarks: 'Concurrent Review 2' }
    };

    const resC1 = mockRes();
    const resC2 = mockRes();

    await Promise.all([
      submitReview(reqC1, resC1),
      submitReview(reqC2, resC2)
    ]);

    const codes = [resC1.statusCode, resC2.statusCode];
    console.log('      Concurrent review responses:', codes);

    const hasSuccess = codes.includes(200);
    const hasConflict = codes.includes(409);

    if (hasSuccess && hasConflict) {
      console.log('  [PASS] Concurrency verified: exactly one submission succeeded, the other returned 409 Conflict.');
      passes++;

      // Fetch from database and verify persisted state
      const { data: dbEst, error: dbEstErr } = await supabase
        .from('project_cost_estimates')
        .select('*')
        .eq('estimate_id', testEstimateId)
        .single();

      if (dbEstErr) throw dbEstErr;

      const correctStatus = dbEst.estimate_status === 'Final Approved';
      const hoApprovedByCorrect = dbEst.ho_approved_by === testHoMobile;
      const hoApprovalDateExists = dbEst.ho_approval_date !== null;
      const amountCorrect = Number(dbEst.estimate_amount) === 150000;

      if (correctStatus && hoApprovedByCorrect && hoApprovalDateExists && amountCorrect) {
        console.log('  [PASS] Concurrency persisted state verified (status: Final Approved, ho_approved_by and date set, amount is 150000).');
        passes++;
      } else {
        console.log('  [FAIL] Concurrency persisted state incorrect:', {
          status: dbEst.estimate_status,
          ho_approved_by: dbEst.ho_approved_by,
          ho_approval_date: dbEst.ho_approval_date,
          estimate_amount: dbEst.estimate_amount
        });
        fails++;
      }
    } else {
      console.log('  [FAIL] Concurrency check failed. Response codes:', codes);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error during test run:', err);
    fails++;
  } finally {
    // Clean up test data
    console.log('\nCleaning up integration test data...');
    if (testEstimateIdZeroItems) {
      await supabase.from('project_cost_estimates').update({
        work_order_no: 'WB_BAN_102',
        created_by: '+918276071523',
        last_modified_by: '+918276071523',
        je_user_id: '+918276071523',
        zo_approved_by: null,
        ho_approved_by: null
      }).eq('estimate_id', testEstimateIdZeroItems);
    }
    if (testEstimateId) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', testEstimateId);
      await supabase.from('project_cost_estimates')
        .update({
          estimate_status: 'Rejected by ZO',
          created_by: '+918276071523',
          last_modified_by: '+918276071523',
          je_user_id: '+918276071523',
          zo_approved_by: null,
          ho_approved_by: null
        })
        .eq('estimate_id', testEstimateId);
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', testEstimateId);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);
    console.log('  [PASS] Test data cleaned up.');
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE 7 INTEGRATION TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME INTEGRATION TESTS FAILED. <<<');
    process.exit(1);
  }
}

module.exports = { testMilestone7 };

// If run directly
if (require.main === module) {
  testMilestone7();
}
