const { supabase } = require('../../src/db/supabase');
const requireRole = require('../../src/middleware/requireRole');
const {
  getPurchaseOptions,
  createPurchaseOption,
  updatePurchaseOption,
  togglePurchaseOptionStatus
} = require('../../src/controllers/purchaseData.controller');

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

async function testMilestone2() {
  console.log('=== RUNNING MILESTONE 2 INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Clean up any test leftovers
  await supabase.from('purchase_data').delete().filter('name', 'ilike', 'TEST_M2_%');

  try {
    // -------------------------------------------------------------
    // Test 1: Middleware requireRole normalizes staff -> je
    // -------------------------------------------------------------
    console.log('Test 1: Testing requireRole middleware behavior...');
    const jeGuard = requireRole(['je', 'admin']);

    let nextCalled = false;
    const reqStaff = { user: { role: 'staff' } };
    const resStaff = mockRes();
    jeGuard(reqStaff, resStaff, () => { nextCalled = true; });

    if (nextCalled) {
      console.log('  [PASS] normalized staff to je and allowed access.');
      passes++;
    } else {
      console.log('  [FAIL] failed to allow normalized staff role.');
      fails++;
    }

    // Reset and test blocked role
    nextCalled = false;
    const reqZo = { user: { role: 'zo' } };
    const resZo = mockRes();
    jeGuard(reqZo, resZo, () => { nextCalled = true; });

    if (!nextCalled && resZo.statusCode === 403) {
      console.log('  [PASS] blocked unauthorized zo role.');
      passes++;
    } else {
      console.log('  [FAIL] did not block unauthorized zo role.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Create Purchase Option with normal name & trimming
    // -------------------------------------------------------------
    console.log('\nTest 2: Creating a valid purchase option with surrounding spaces (trimming check)...');
    const reqCreate = {
      user: { role: 'admin', mobile_number: '+918276071523' },
      body: { name: '  TEST_M2_Local Market  ' }
    };
    const resCreate = mockRes();
    await createPurchaseOption(reqCreate, resCreate);

    let testOption = null;
    if (resCreate.statusCode === 201 && resCreate.jsonData.success) {
      testOption = resCreate.jsonData.purchaseOption;
      if (testOption.name === 'TEST_M2_Local Market') {
        console.log('  [PASS] Created purchase option and successfully trimmed leading/trailing spaces.');
        passes++;
      } else {
        console.log(`  [FAIL] Option name was not trimmed: "${testOption.name}"`);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to create purchase option. Status:', resCreate.statusCode, resCreate.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Uniqueness Constraint (Case-insensitive check)
    // -------------------------------------------------------------
    console.log('\nTest 3: Creating a duplicate purchase option with different capitalization...');
    if (testOption) {
      const reqDuplicate = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        body: { name: 'test_m2_local market' } // Same name, lower case
      };
      const resDuplicate = mockRes();
      await createPurchaseOption(reqDuplicate, resDuplicate);

      if (resDuplicate.statusCode === 409 && !resDuplicate.jsonData.success) {
        console.log('  [PASS] Blocked duplicate purchase option (case-insensitive) with 409 Conflict.');
        passes++;
      } else {
        console.log('  [FAIL] Allowed duplicate or returned incorrect status:', resDuplicate.statusCode, resDuplicate.jsonData);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping duplicate test due to previous create failure.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Blank name validation check
    // -------------------------------------------------------------
    console.log('\nTest 4: Creating a purchase option with blank/whitespace name...');
    const reqBlank = {
      user: { role: 'admin', mobile_number: '+918276071523' },
      body: { name: '   ' }
    };
    const resBlank = mockRes();
    await createPurchaseOption(reqBlank, resBlank);

    if (resBlank.statusCode === 400 && !resBlank.jsonData.success) {
      console.log('  [PASS] Rejected blank purchase option name with 400 Bad Request.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed blank option name or returned incorrect status:', resBlank.statusCode, resBlank.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Update purchase option with duplicate/invalid check
    // -------------------------------------------------------------
    console.log('\nTest 5: Updating purchase option name...');
    if (testOption) {
      // Create another one to test duplicate on update
      const reqOther = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        body: { name: 'TEST_M2_Other Option' }
      };
      const resOther = mockRes();
      await createPurchaseOption(reqOther, resOther);
      const otherOption = resOther.jsonData.purchaseOption;

      // Update to duplicate name
      const reqUpdateDup = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: otherOption.id },
        body: { name: 'test_m2_local market' } // already taken by testOption
      };
      const resUpdateDup = mockRes();
      await updatePurchaseOption(reqUpdateDup, resUpdateDup);

      if (resUpdateDup.statusCode === 409) {
        console.log('  [PASS] Blocked updating to an existing duplicate name (case-insensitive).');
        passes++;
      } else {
        console.log('  [FAIL] Update allowed duplicate name. Status:', resUpdateDup.statusCode);
        fails++;
      }

      // Update to valid name
      const reqUpdateOk = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: otherOption.id },
        body: { name: '  TEST_M2_Third Option  ' } // with spaces
      };
      const resUpdateOk = mockRes();
      await updatePurchaseOption(reqUpdateOk, resUpdateOk);

      if (resUpdateOk.statusCode === 200 && resUpdateOk.jsonData.purchaseOption.name === 'TEST_M2_Third Option') {
        console.log('  [PASS] Successfully updated name and trimmed inputs.');
        passes++;
      } else {
        console.log('  [FAIL] Failed to update name. Status:', resUpdateOk.statusCode);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping update tests due to previous create failure.');
      fails += 2;
    }

    // -------------------------------------------------------------
    // Test 6: Atomic Toggle is_active status (Supabase RPC)
    // -------------------------------------------------------------
    console.log('\nTest 6: Toggling option status atomically...');
    if (testOption) {
      const reqToggle = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: testOption.id }
      };
      const resToggle = mockRes();

      // First toggle (true -> false)
      await togglePurchaseOptionStatus(reqToggle, resToggle);
      const firstStatus = resToggle.jsonData.purchaseOption.is_active;

      // Second toggle (false -> true)
      const resToggle2 = mockRes();
      await togglePurchaseOptionStatus(reqToggle, resToggle2);
      const secondStatus = resToggle2.jsonData.purchaseOption.is_active;

      if (firstStatus === false && secondStatus === true) {
        console.log('  [PASS] Atomic toggle RPC modified status correctly (true -> false -> true).');
        passes++;
      } else {
        console.log('  [FAIL] Toggle did not modify status correctly. Statuses:', firstStatus, secondStatus);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping toggle test due to previous create failure.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Case-Insensitive sorting and non-admin filter in getPurchaseOptions
    // -------------------------------------------------------------
    console.log('\nTest 7: Testing getPurchaseOptions filters and sorting...');
    // Create multiple options with varying cases to test sorting order: C, a, B
    const optionsToCreate = ['TEST_M2_C Option', 'TEST_M2_a Option', 'TEST_M2_B Option'];
    for (const name of optionsToCreate) {
      await createPurchaseOption({
        user: { role: 'admin', mobile_number: '+918276071523' },
        body: { name }
      }, mockRes());
    }

    // Get options as non-admin (should only see active, and sorted case-insensitively: a, B, C)
    const reqGetNonAdmin = {
      user: { role: 'je', mobile_number: '+919999999999' }
    };
    const resGetNonAdmin = mockRes();
    await getPurchaseOptions(reqGetNonAdmin, resGetNonAdmin);

    const m2Options = resGetNonAdmin.jsonData.purchaseOptions.filter(o => o.name.startsWith('TEST_M2_'));
    const names = m2Options.map(o => o.name);

    console.log('      Returned options:', names);

    // Expected order:
    // 1. TEST_M2_a Option
    // 2. TEST_M2_B Option
    // 3. TEST_M2_C Option
    // (Note: other option 'TEST_M2_Third Option' and 'TEST_M2_Local Market' are also active, but we check relative sorting of these 3)
    const indexA = names.indexOf('TEST_M2_a Option');
    const indexB = names.indexOf('TEST_M2_B Option');
    const indexC = names.indexOf('TEST_M2_C Option');

    if (indexA !== -1 && indexB !== -1 && indexC !== -1 && indexA < indexB && indexB < indexC) {
      console.log('  [PASS] Options are returned sorted case-insensitively (a < B < C).');
      passes++;
    } else {
      console.log('  [FAIL] Case-insensitive sorting order failed.');
      fails++;
    }

    // Deactivate one option and verify non-admin cannot see it
    if (testOption) {
      // Make testOption inactive
      await supabase.from('purchase_data').update({ is_active: false }).eq('id', testOption.id);

      const resGetNonAdmin2 = mockRes();
      await getPurchaseOptions(reqGetNonAdmin, resGetNonAdmin2);
      const hasInactiveNonAdmin = resGetNonAdmin2.jsonData.purchaseOptions.some(o => o.id === testOption.id);

      const reqGetAdmin = {
        user: { role: 'admin', mobile_number: '+918276071523' }
      };
      const resGetAdmin = mockRes();
      await getPurchaseOptions(reqGetAdmin, resGetAdmin);
      const hasInactiveAdmin = resGetAdmin.jsonData.purchaseOptions.some(o => o.id === testOption.id);

      if (!hasInactiveNonAdmin && hasInactiveAdmin) {
        console.log('  [PASS] Non-admin only sees active options, whereas admin sees both.');
        passes++;
      } else {
        console.log('  [FAIL] Visibility filtering failed. Inactive visible to non-admin:', hasInactiveNonAdmin, 'visible to admin:', hasInactiveAdmin);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping active filter test.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    fails++;
  } finally {
    // Clean up all M2 test rows
    console.log('\nCleaning up integration test data...');
    await supabase.from('purchase_data').delete().filter('name', 'ilike', 'TEST_M2_%');
    console.log('  [PASS] Test data cleaned up.');
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE 2 INTEGRATION TESTS PASSED SUCCESSFULLY! <<<');
  } else {
    console.log('\n>>> SOME INTEGRATION TESTS FAILED. <<<');
  }
}

testMilestone2();
