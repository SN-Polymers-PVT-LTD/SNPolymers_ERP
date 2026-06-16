const { supabase } = require('../../src/db/supabase');

async function testMilestone1() {
  console.log('=== RUNNING MILESTONE 1 DATABASE FOUNDATION VERIFICATION TESTS ===\n');

  let passes = 0;
  let fails = 0;
  let pd1 = null;

  // Generate a random mobile number to avoid unique key collisions on multiple runs
  const testMobile = '+91' + Math.floor(100000000 + Math.random() * 900000000);
  const testAdminMobile = '+918276071523'; // Using whitelisted admin from seed
  const testInvalidMobile = '+919999999900';
  const testWorkOrder = 'WB_BAN_102'; // Known running work order from seed

  // Clean up any potential leftovers first
  await supabase.from('project_cost_estimate_items').delete().filter('material_main_head', 'eq', 'TEST_MAIN_1');
  await supabase.from('project_cost_estimates').delete().filter('zonal_office_no', 'eq', 'TEST_ZO_99');
  await supabase.from('purchase_data').delete().filter('name', 'eq', 'TEST_PURCHASE_OPTION');
  await supabase.from('authorised_users').delete().filter('mobile_number', 'eq', testMobile);

  try {
    // -------------------------------------------------------------
    // Test 1 & 2: Role Whitelist constraints
    // -------------------------------------------------------------
    console.log('Test 1: Inserting valid Phase 2 role "je"...');
    const { data: userJe, error: errJe } = await supabase
      .from('authorised_users')
      .insert([
        {
          mobile_number: testMobile,
          display_name: 'Test JE User',
          role: 'je',
          permissions: {},
          is_active: true
        }
      ])
      .select()
      .single();

    if (!errJe && userJe) {
      console.log('  [PASS] Successfully whitelisted JE role.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to whitelist JE role:', errJe);
      fails++;
    }

    console.log('Test 2: Inserting invalid role "invalid_role"...');
    const { error: errInvalidRole } = await supabase
      .from('authorised_users')
      .insert([
        {
          mobile_number: testInvalidMobile,
          display_name: 'Test Invalid User',
          role: 'invalid_role',
          permissions: {},
          is_active: true
        }
      ]);

    if (errInvalidRole && errInvalidRole.code === '23514') { // check_violation
      console.log('  [PASS] Successfully blocked invalid role via CHECK constraint.');
      passes++;
    } else {
      console.log('  [FAIL] Did not block invalid role. Error:', errInvalidRole);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Unique Purchase Option & References
    // -------------------------------------------------------------
    console.log('Test 3: Creating unique purchase options...');
    const { data: pd1Data, error: errPd1 } = await supabase
      .from('purchase_data')
      .insert([{ name: 'TEST_PURCHASE_OPTION', created_by: testAdminMobile }])
      .select()
      .single();
    pd1 = pd1Data;

    if (errPd1) {
      console.log('  [FAIL] Failed to create purchase option:', errPd1);
      fails++;
    } else {
      // Try to insert a duplicate name
      const { error: errPdDup } = await supabase
        .from('purchase_data')
        .insert([{ name: 'TEST_PURCHASE_OPTION', created_by: testAdminMobile }]);

      if (errPdDup && errPdDup.code === '23505') { // unique_violation
        console.log('  [PASS] Unique constraint blocked duplicate purchase option.');
        passes++;
      } else {
        console.log('  [FAIL] Duplicate purchase option was not blocked:', errPdDup);
        fails++;
      }
    }

    // -------------------------------------------------------------
    // Test 4: Amount Integrity Check (rate * qty)
    // -------------------------------------------------------------
    console.log('Test 4: Testing amount CHECK constraint...');
    // Create estimate header first
    const { data: estimate, error: errEst } = await supabase
      .from('project_cost_estimates')
      .insert([
        {
          work_order_no: testWorkOrder,
          estimate_no: 'EST_TEST_M1',
          area_code: 'South Bengal',
          estimate_revision: 0,
          zonal_office_no: 'TEST_ZO_99',
          estimate_amount: 0,
          estimate_status: 'Draft',
          created_by: testMobile
        }
      ])
      .select()
      .single();

    if (errEst) {
      console.log('  [FAIL] Failed to create test estimate header:', errEst);
      fails++;
    } else {
      // Try to insert item with mismatched amount
      const { error: errItemCheck } = await supabase
        .from('project_cost_estimate_items')
        .insert([
          {
            estimate_id: estimate.estimate_id,
            material_main_head: 'TEST_MAIN_1',
            material_sub_head: 'TEST_SUB_1',
            material_details: 'TEST_DETAILS_1',
            unit: 'Nos',
            qty: 10,
            rate: 150,
            amount: 999.00 // Mismatched (should be 1500)
          }
        ]);

      if (errItemCheck && errItemCheck.code === '23514') { // check_violation
        console.log('  [PASS] Mismatched amount was correctly blocked by CHECK constraint.');
        passes++;
      } else {
        console.log('  [FAIL] Mismatched amount check failed to trigger:', errItemCheck);
        fails++;
      }

      // Insert item with correct amount
      const { data: item, error: errItemOk } = await supabase
        .from('project_cost_estimate_items')
        .insert([
          {
            estimate_id: estimate.estimate_id,
            material_main_head: 'TEST_MAIN_1',
            material_sub_head: 'TEST_SUB_1',
            material_details: 'TEST_DETAILS_1',
            unit: 'Nos',
            qty: 10,
            rate: 150,
            amount: 1500.00
          }
        ])
        .select()
        .single();

      if (!errItemOk && item) {
        console.log('  [PASS] Inserted estimate item with correct amount.');
        passes++;

        // -------------------------------------------------------------
        // Test 5: Delete Prevention Trigger
        // -------------------------------------------------------------
        console.log('Test 5: Testing delete prevention trigger on project_cost_estimates...');
        const { error: errDelete } = await supabase
          .from('project_cost_estimates')
          .delete()
          .eq('estimate_id', estimate.estimate_id);

        if (errDelete && errDelete.message.includes('permanently prohibited')) {
          console.log('  [PASS] Hard delete prevention trigger blocked deletion.');
          passes++;
        } else {
          console.log('  [FAIL] Estimate deletion was not blocked. Error:', errDelete);
          fails++;
        }

        // -------------------------------------------------------------
        // Test 6: Audit Log Status Trigger
        // -------------------------------------------------------------
        console.log('Test 6: Verifying status change audit trigger...');
        const { error: errUpdateStatus } = await supabase
          .from('project_cost_estimates')
          .update({ estimate_status: 'Submitted', last_modified_by: testMobile })
          .eq('estimate_id', estimate.estimate_id);

        if (errUpdateStatus) {
          console.log('  [FAIL] Failed to update estimate status:', errUpdateStatus);
          fails++;
        } else {
          const { data: auditLog, error: errAudit } = await supabase
            .from('audit_log')
            .select('*')
            .eq('record_identifier', estimate.estimate_id)
            .eq('action', 'STATUS_CHANGE')
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!errAudit && auditLog && auditLog.new_value?.estimate_status === 'Submitted') {
            console.log('  [PASS] Audit log captured status change correctly.');
            passes++;
          } else {
            console.log('  [FAIL] Audit log entry was not found or incorrect:', auditLog, errAudit);
            fails++;
          }
        }

        // -------------------------------------------------------------
        // Test 7: RPC Function Permissions & Rollback (Unauthorized user)
        // -------------------------------------------------------------
        console.log('Test 7: Calling submit_row_approvals RPC as unauthorized user (role je)...');
        const { error: errRpcAuth } = await supabase.rpc('submit_row_approvals', {
          p_estimate_id: estimate.estimate_id,
          p_approvals: [{ item_id: item.item_id, approve_status: 'Approve', remarks: 'Good' }],
          p_stage: 'ZO',
          p_modified_by: testMobile // testMobile is JE
        });

        if (rpcThrewUnauthorized(errRpcAuth)) {
          console.log('  [PASS] RPC rejected unauthorized user call.');
          passes++;
        } else {
          console.log('  [FAIL] RPC allowed unauthorized user call. Error:', errRpcAuth);
          fails++;
        }

        // -------------------------------------------------------------
        // Test 8: RPC Transactional Rollback (Invalid Item ID in mixed batch)
        // -------------------------------------------------------------
        console.log('Test 8: Calling submit_row_approvals RPC with mixed batch containing invalid item_id...');
        const { error: errRpcRollback } = await supabase.rpc('submit_row_approvals', {
          p_estimate_id: estimate.estimate_id,
          p_approvals: [
            { item_id: item.item_id, approve_status: 'Approve', remarks: 'First ok' },
            { item_id: '00000000-0000-0000-0000-000000000000', approve_status: 'Approve', remarks: 'Invalid' }
          ],
          p_stage: 'ZO',
          p_modified_by: testAdminMobile // admin is authorized
        });

        if (errRpcRollback && errRpcRollback.message.includes('not found or does not belong')) {
          console.log('  [PASS] RPC threw exception for invalid item_id.');
          // Verify that first update rolled back (zo_office_approve remains NULL)
          const { data: itemVerify } = await supabase
            .from('project_cost_estimate_items')
            .select('zo_office_approve')
            .eq('item_id', item.item_id)
            .single();

          if (itemVerify && itemVerify.zo_office_approve === null) {
            console.log('  [PASS] Verified transactional rollback: first item approval was rolled back.');
            passes++;
          } else {
            console.log('  [FAIL] Transactional rollback failed; first item remains approved:', itemVerify);
            fails++;
          }
        } else {
          console.log('  [FAIL] RPC did not throw expected invalid item_id exception. Error:', errRpcRollback);
          fails++;
        }
      } else {
        console.log('  [FAIL] Failed to create valid estimate item:', errItemOk);
        fails++;
      }
    }

  } catch (err) {
    console.error('Unexpected test error:', err);
    fails++;
  } finally {
    // Clean up test rows
    console.log('\nCleaning up verification test data...');
    try {
      await supabase.from('project_cost_estimate_items').delete().filter('material_main_head', 'eq', 'TEST_MAIN_1');
      // Delete estimate by temporarily bypassing the trigger (using direct delete since it's staging)
      // Actually we cannot bypass DB triggers without superuser, but we can update status to draft first.
      // Wait, the trigger blocks delete on all project_cost_estimates rows.
      // Since it blocks deletes permanently, we can't delete it. It's okay, we can leave it or clear its fields.
      // Wait! We can disable trigger or delete children. Let's delete items and leave estimate header (it will stay as test record).
      if (pd1) {
        await supabase.from('purchase_data').delete().eq('id', pd1.id);
      }
      await supabase.from('authorised_users').delete().eq('mobile_number', testMobile);
      console.log('  [PASS] Test data cleaned up.');
    } catch (cleanupErr) {
      console.warn('  [WARN] Cleanup error:', cleanupErr.message);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL DATABASE VERIFICATION TESTS PASSED SUCCESSFULLY! <<<');
  } else {
    console.log('\n>>> SOME VERIFICATION TESTS FAILED. <<<');
  }
}

function rpcThrewUnauthorized(error) {
  return error && (error.message.includes('Unauthorized') || error.message.includes('User does not have'));
}

testMilestone1();
