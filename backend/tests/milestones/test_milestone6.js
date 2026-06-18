const { supabase } = require('../../src/db/supabase');
const {
  requestRevision,
  getRevisionLog
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

async function testMilestone6() {
  console.log('=== RUNNING MILESTONE 6 INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const testZoMobile = '+918000000001';
  const testJeMobile = '+918000000002';
  const testOtherMobile = '+918000000003';
  const testHoMobile = '+918000000004';
  const testAdminMobile = '+918276071523';
  const testWorkOrder = 'WB_BAN_102'; // Running work order

  let testEstimateId = null;
  let testItemId = null;

  try {
    // 0. Setup test users and estimate
    console.log('Setup: Preparing test users and estimate...');
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);
    
    // Insert ZO
    await supabase.from('authorised_users').insert({
      mobile_number: testZoMobile,
      display_name: 'Test ZO User',
      role: 'zo',
      is_active: true
    });

    // Insert JE
    await supabase.from('authorised_users').insert({
      mobile_number: testJeMobile,
      display_name: 'Test JE User',
      role: 'je',
      is_active: true
    });

    // Insert Other JE
    await supabase.from('authorised_users').insert({
      mobile_number: testOtherMobile,
      display_name: 'Other JE User',
      role: 'je',
      is_active: true
    });

    // Insert HO
    await supabase.from('authorised_users').insert({
      mobile_number: testHoMobile,
      display_name: 'Test HO User',
      role: 'ho',
      is_active: true
    });

    // Clear active estimates for this work order to bypass unique checks
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO', last_modified_by: testAdminMobile })
      .eq('work_order_no', testWorkOrder);

    // Insert test estimate in 'Draft' status
    const { data: estimate, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: 'EST-M6-TEMP',
        area_code: 'South Bengal',
        estimate_revision: 0,
        zonal_office_no: 'ZO-01',
        estimate_amount: 50000,
        estimate_status: 'Draft',
        created_by: testJeMobile,
        last_modified_by: testJeMobile
      })
      .select()
      .single();

    if (estErr) throw estErr;
    testEstimateId = estimate.estimate_id;

    // Create a line item for it
    const { data: item, error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .insert({
        estimate_id: testEstimateId,
        material_main_head: 'Labour',
        material_sub_head: 'Unskilled',
        material_details: 'Unskilled Worker',
        unit: 'Nos',
        qty: 100,
        rate: 500,
        amount: 50000
      })
      .select()
      .single();

    if (itemErr) throw itemErr;
    testItemId = item.item_id;

    // -------------------------------------------------------------
    // Test 1: Stage Guard check
    // -------------------------------------------------------------
    console.log('Test 1: Testing stage guards for requestRevision...');
    const req1 = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: {}
    };
    const res1 = mockRes();
    await requestRevision(req1, res1);

    if (res1.statusCode === 403 && !res1.jsonData.success) {
      console.log('  [PASS] Correctly blocked revision request for Draft status.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block revision request for Draft status. Status:', res1.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Rejection Row requirement check
    // -------------------------------------------------------------
    console.log('\nTest 2: Testing rejection row requirement (no Not Approve rows)...');
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    const req2 = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: {}
    };
    const res2 = mockRes();
    await requestRevision(req2, res2);

    if (res2.statusCode === 422 && !res2.jsonData.success && res2.jsonData.message.includes('Not Approve')) {
      console.log('  [PASS] Correctly rejected revision request due to no "Not Approve" rows.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block revision request with no Not Approve rows. Status:', res2.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Strict Validation of deadline_hours
    // -------------------------------------------------------------
    console.log('\nTest 3: Testing decimal and boundary validation for deadline_hours...');
    // Mark item as 'Not Approve' for ZO Review
    await supabase.from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Not Approve', zo_remarks: 'Disapproved by ZO' })
      .eq('item_id', testItemId);

    const checkInvalidHours = async (hours) => {
      const req = {
        params: { id: testEstimateId },
        user: { role: 'zo', mobile_number: testZoMobile },
        body: { deadline_hours: hours }
      };
      const res = mockRes();
      await requestRevision(req, res);
      return res.statusCode === 400;
    };

    const isDecimalBlocked = await checkInvalidHours(12.5);
    const isZeroBlocked = await checkInvalidHours(0);
    const isNegativeBlocked = await checkInvalidHours(-10);
    const isTooLargeBlocked = await checkInvalidHours(169);

    if (isDecimalBlocked && isZeroBlocked && isNegativeBlocked && isTooLargeBlocked) {
      console.log('  [PASS] Successfully rejected decimal, zero, negative, and out-of-bounds hours with 400 Bad Request.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block invalid deadline_hours:', {
        isDecimalBlocked, isZeroBlocked, isNegativeBlocked, isTooLargeBlocked
      });
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3b: Test Default deadline_hours Behavior & modified_item_ids Default
    // -------------------------------------------------------------
    console.log('\nTest 3b: Testing default deadline_hours and modified_item_ids defaults...');
    const reqDefault = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: {} // deadline_hours omitted
    };
    const resDefault = mockRes();
    
    const timeBeforeCall = Date.now();
    await requestRevision(reqDefault, resDefault);

    if (resDefault.statusCode === 200 && resDefault.jsonData.success) {
      const log = resDefault.jsonData.revisionLog;
      const expectedDeadline = timeBeforeCall + 24 * 60 * 60 * 1000;
      const actualDeadline = new Date(log.revision_deadline).getTime();
      const diffSeconds = Math.abs(expectedDeadline - actualDeadline) / 1000;

      // Assert deadline is ~24 hours from now
      const isDeadlineCorrect = diffSeconds < 15; // 15 seconds tolerance
      // Assert modified_item_ids is returned as an array and uses the default empty value '{}' from DB (represented as [] in JSON)
      const isModifiedItemIdsArray = Array.isArray(log.modified_item_ids) && log.modified_item_ids.length === 0;

      if (isDeadlineCorrect && isModifiedItemIdsArray) {
        console.log('  [PASS] Successfully defaulted deadline to 24 hours (diff: ' + diffSeconds.toFixed(2) + 's) and modified_item_ids to empty array.');
        passes++;
      } else {
        console.log('  [FAIL] Default calculations incorrect:', {
          diffSeconds,
          isDeadlineCorrect,
          modified_item_ids: log.modified_item_ids
        });
        fails++;
      }
    } else {
      console.log('  [FAIL] Default deadline request failed. Status:', resDefault.statusCode, resDefault.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Verify Stage-Specific Cycle Numbering & Admin Revisions
    // -------------------------------------------------------------
    console.log('\nTest 4: Verifying stage-specific cycle numbering and Admin actions...');
    
    // Close the Test 3b log entry first so we can trigger a new one
    await supabase.from('estimate_revision_log')
      .update({ resubmitted_at: new Date().toISOString() })
      .eq('estimate_id', testEstimateId);

    // 4.1 Admin ZO Revision: Estimate in Under ZO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    const reqAdminZo = {
      params: { id: testEstimateId },
      user: { role: 'admin', mobile_number: testAdminMobile },
      body: { deadline_hours: 48 }
    };
    const resAdminZo = mockRes();
    await requestRevision(reqAdminZo, resAdminZo);

    if (resAdminZo.statusCode === 200 && resAdminZo.jsonData.success) {
      const log = resAdminZo.jsonData.revisionLog;
      if (log.revision_cycle === 2 && log.stage === 'ZO' && resAdminZo.jsonData.estimate.estimate_status === 'ZO Revision Requested') {
        console.log('  [PASS] Admin successfully requested ZO revision (cycle incremented to 2).');
        passes++;
      } else {
        console.log('  [FAIL] Admin ZO revision failed validation:', log);
        fails++;
      }
    } else {
      console.log('  [FAIL] Admin ZO revision failed. Status:', resAdminZo.statusCode);
      fails++;
    }

    // Close the cycle 2 log entry
    await supabase.from('estimate_revision_log')
      .update({ resubmitted_at: new Date().toISOString() })
      .eq('estimate_id', testEstimateId);

    // 4.2 HO Workflow and Cycle Reset: Estimate in Under HO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // Mark item as 'Not Approve' for HO Review
    await supabase.from('project_cost_estimate_items')
      .update({ ho_office_approve: 'Not Approve', ho_remarks: 'Disapproved by HO' })
      .eq('item_id', testItemId);

    const reqHo = {
      params: { id: testEstimateId },
      user: { role: 'ho', mobile_number: testHoMobile },
      body: { deadline_hours: 12 }
    };
    const resHo = mockRes();
    await requestRevision(reqHo, resHo);

    if (resHo.statusCode === 200 && resHo.jsonData.success) {
      const log = resHo.jsonData.revisionLog;
      const updated = resHo.jsonData.estimate;
      
      // The revision_cycle for stage 'HO' should start at 1 (not 3, since ZO cycle was 2)
      if (log.revision_cycle === 1 && log.stage === 'HO' && updated.estimate_status === 'HO Revision Requested') {
        console.log('  [PASS] HO successfully requested revision (stage-specific cycle starts at 1).');
        passes++;
      } else {
        console.log('  [FAIL] HO cycle numbering or status incorrect:', log, updated.estimate_status);
        fails++;
      }
    } else {
      console.log('  [FAIL] HO revision request failed. Status:', resHo.statusCode);
      fails++;
    }

    // Close the cycle 1 HO log entry
    await supabase.from('estimate_revision_log')
      .update({ resubmitted_at: new Date().toISOString() })
      .eq('estimate_id', testEstimateId);

    // 4.3 Admin HO Revision
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    const reqAdminHo = {
      params: { id: testEstimateId },
      user: { role: 'admin', mobile_number: testAdminMobile },
      body: { deadline_hours: 24 }
    };
    const resAdminHo = mockRes();
    await requestRevision(reqAdminHo, resAdminHo);

    if (resAdminHo.statusCode === 200 && resAdminHo.jsonData.success) {
      const log = resAdminHo.jsonData.revisionLog;
      if (log.revision_cycle === 2 && log.stage === 'HO' && resAdminHo.jsonData.estimate.estimate_status === 'HO Revision Requested') {
        console.log('  [PASS] Admin successfully requested HO revision (cycle incremented to 2).');
        passes++;
      } else {
        console.log('  [FAIL] Admin HO revision failed validation:', log);
        fails++;
      }
    } else {
      console.log('  [FAIL] Admin HO revision failed. Status:', resAdminHo.statusCode);
      fails++;
    }

    // Close active log
    await supabase.from('estimate_revision_log')
      .update({ resubmitted_at: new Date().toISOString() })
      .eq('estimate_id', testEstimateId);

    // -------------------------------------------------------------
    // Test 5: Prevent multiple active revisions
    // -------------------------------------------------------------
    console.log('\nTest 5: Requesting revision when one is already active...');
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // Create an active log
    const reqActive = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: {}
    };
    await requestRevision(reqActive, mockRes());

    // Try requesting again
    const reqDup = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: {}
    };
    const resDup = mockRes();
    await requestRevision(reqDup, resDup);

    if (resDup.statusCode === 409 && !resDup.jsonData.success && resDup.jsonData.message.includes('already active')) {
      console.log('  [PASS] Blocked active revision duplicate request with 409 Conflict.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block duplicate active revision request. Status:', resDup.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5b: Explicit Unique Constraint Violation Check
    // -------------------------------------------------------------
    console.log('\nTest 5b: Verifying PostgreSQL error code 23505 unique constraint check...');
    // We already have an active log for testEstimateId. Let's try to bypass the controller
    // and attempt to insert a second active log directly via Supabase client.
    const { error: directInsertError } = await supabase
      .from('estimate_revision_log')
      .insert({
        estimate_id: testEstimateId,
        revision_cycle: 99,
        stage: 'ZO',
        requested_by: testZoMobile,
        revision_deadline: new Date().toISOString(),
        resubmitted_at: null // Active
      });

    if (directInsertError && directInsertError.code === '23505') {
      console.log('  [PASS] Database constraint uniq_active_revision successfully threw 23505 error.');
      passes++;
    } else {
      console.log('  [FAIL] Database constraint failed or threw wrong error:', directInsertError);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: Concurrency Safety Test
    // -------------------------------------------------------------
    console.log('\nTest 6: Testing concurrency safety under multiple simultaneous requests...');
    // Close existing active revision
    await supabase.from('estimate_revision_log')
      .update({ resubmitted_at: new Date().toISOString() })
      .eq('estimate_id', testEstimateId);

    // Reset estimate status to Under ZO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // Call requestRevision concurrently twice
    const reqC1 = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: { deadline_hours: 24 }
    };
    const reqC2 = {
      params: { id: testEstimateId },
      user: { role: 'zo', mobile_number: testZoMobile },
      body: { deadline_hours: 24 }
    };

    const resC1 = mockRes();
    const resC2 = mockRes();

    await Promise.all([
      requestRevision(reqC1, resC1),
      requestRevision(reqC2, resC2)
    ]);

    const codes = [resC1.statusCode, resC2.statusCode];
    console.log('      Concurrent responses:', codes);

    const hasSuccess = codes.includes(200);
    const hasConflict = codes.includes(409);

    const { data: activeLogs } = await supabase
      .from('estimate_revision_log')
      .select('*')
      .eq('estimate_id', testEstimateId)
      .is('resubmitted_at', null);

    if (hasSuccess && hasConflict && activeLogs.length === 1) {
      console.log('  [PASS] Concurrency safeguard verified: 1 request succeeded, 1 request returned 409 Conflict, and exactly 1 active log exists.');
      passes++;
    } else {
      console.log('  [FAIL] Concurrency safeguard failed. Outputs:', {
        codes,
        activeLogCount: activeLogs.length
      });
      fails++;
    }

    // Close logs again
    await supabase.from('estimate_revision_log')
      .update({ resubmitted_at: new Date().toISOString() })
      .eq('estimate_id', testEstimateId);

    // -------------------------------------------------------------
    // Test 7: Expanded Authorization Matrix for getRevisionLog
    // -------------------------------------------------------------
    console.log('\nTest 7: Verifying expanded role authorization matrix for getRevisionLog...');

    // Helper to evaluate access
    const checkLogAccess = async (role, mobile, expectedCode) => {
      const req = {
        params: { id: testEstimateId },
        user: { role, mobile_number: mobile }
      };
      const res = mockRes();
      await getRevisionLog(req, res);
      return res.statusCode === expectedCode;
    };

    // Prepare estimate in Under ZO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under ZO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // 7.1 Admin Access (should succeed)
    const isAdminAllowed = await checkLogAccess('admin', testAdminMobile, 200);

    // 7.2 Estimate Owner JE (should succeed)
    const isOwnerJeAllowed = await checkLogAccess('je', testJeMobile, 200);

    // 7.3 Unauthorized JE (should fail with 404 to avoid leak)
    const isOtherJeBlocked = await checkLogAccess('je', testOtherMobile, 404);

    // 7.4 ZO Access during ZO stage (Under ZO Review -> should succeed)
    const isZoReviewAllowed = await checkLogAccess('zo', testZoMobile, 200);

    // 7.5 HO Access during ZO stage (Under ZO Review -> should fail with 404)
    const isHoReviewBlocked = await checkLogAccess('ho', testHoMobile, 404);

    // Transition estimate to HO Review
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
      .eq('estimate_id', testEstimateId);

    // 7.6 ZO Access during HO stage (Under HO Review -> should fail with 404)
    const isZoHoBlocked = await checkLogAccess('zo', testZoMobile, 404);

    // 7.7 HO Access during HO stage (Under HO Review -> should succeed)
    const isHoHoAllowed = await checkLogAccess('ho', testHoMobile, 200);

    // 7.8 Other legacy staff / unauthorized role
    const isLegacyStaffBlocked = await checkLogAccess('staff', '+918000000099', 404);

    if (
      isAdminAllowed && isOwnerJeAllowed && isOtherJeBlocked &&
      isZoReviewAllowed && isHoReviewBlocked &&
      isZoHoBlocked && isHoHoAllowed && isLegacyStaffBlocked
    ) {
      console.log('  [PASS] Authorization matrix fully verified (Admin/Owner/Stage-Specific ZO/HO access allowed, other cases return 404).');
      passes++;
    } else {
      console.log('  [FAIL] Visibility matrix check failed:', {
        isAdminAllowed, isOwnerJeAllowed, isOtherJeBlocked,
        isZoReviewAllowed, isHoReviewBlocked,
        isZoHoBlocked, isHoHoAllowed, isLegacyStaffBlocked
      });
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error during test run:', err);
    fails++;
  } finally {
    // Clean up test data
    console.log('\nCleaning up integration test data...');
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
    console.log('\n>>> ALL MILESTONE 6 INTEGRATION TESTS PASSED SUCCESSFULLY! <<<');
  } else {
    console.log('\n>>> SOME INTEGRATION TESTS FAILED. <<<');
  }
}

module.exports = { testMilestone6 };

// If run directly
if (require.main === module) {
  testMilestone6();
}
