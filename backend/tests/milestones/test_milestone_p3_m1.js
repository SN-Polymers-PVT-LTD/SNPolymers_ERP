const { supabase } = require('../../src/db/supabase');

async function testMilestoneP3M1() {
  console.log('=== RUNNING MILESTONE P3-M1 DATABASE FOUNDATION VERIFICATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testZofrNo1 = `TEST_ZO_FR_${suffix}_1`;
  const testZofrNo2 = `TEST_ZO_FR_${suffix}_2`;
  
  // Using whitelisted user from standard seeds
  const testZoMobile = '+918000000001'; 
  const testAdminMobile = '+918276071523';

  let insertedRequest1 = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Insert a fund request row (Pending, unique request number)
    // -------------------------------------------------------------
    console.log('Test 1: Inserting valid fund request...');
    const { data: fr1, error: errFr1 } = await supabase
      .from('fund_requests')
      .insert([
        {
          zo_user_id: testZoMobile,
          zo_fr_no: testZofrNo1,
          zo_fr_amount: 50000.00,
          zo_remarks: 'Test Request 1',
          created_by: testZoMobile
        }
      ])
      .select()
      .single();

    if (!errFr1 && fr1) {
      console.log('  [PASS] Fund request inserted successfully.');
      passes++;
      insertedRequest1 = fr1;
    } else {
      console.log('  [FAIL] Failed to insert fund request:', errFr1);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Insert a duplicate request number (should fail)
    // -------------------------------------------------------------
    console.log('Test 2: Inserting duplicate request number...');
    const { error: errFrDup } = await supabase
      .from('fund_requests')
      .insert([
        {
          zo_user_id: testZoMobile,
          zo_fr_no: testZofrNo1, // Duplicate
          zo_fr_amount: 25000.00,
          created_by: testZoMobile
        }
      ]);

    if (errFrDup && errFrDup.code === '23505') { // unique_violation
      console.log('  [PASS] Unique constraint blocked duplicate request number.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate request number check failed to block. Error:', errFrDup);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Insert request with different number (should succeed)
    // -------------------------------------------------------------
    console.log('Test 3: Inserting request with different request number...');
    const { data: fr2, error: errFr2 } = await supabase
      .from('fund_requests')
      .insert([
        {
          zo_user_id: testZoMobile,
          zo_fr_no: testZofrNo2,
          zo_fr_amount: 15000.00,
          created_by: testZoMobile
        }
      ])
      .select()
      .single();

    if (!errFr2 && fr2) {
      console.log('  [PASS] Second fund request inserted successfully.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to insert second fund request:', errFr2);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Block hard DELETE
    // -------------------------------------------------------------
    if (insertedRequest1) {
      console.log('Test 4: Attempting hard delete of fund request...');
      const { error: errDelete } = await supabase
        .from('fund_requests')
        .delete()
        .eq('fund_request_id', insertedRequest1.fund_request_id);

      if (errDelete && errDelete.message.includes('permanently prohibited')) {
        console.log('  [PASS] Hard delete prevention trigger blocked deletion.');
        passes++;
      } else {
        console.log('  [FAIL] Hard deletion was not blocked. Error:', errDelete);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 4: Inserted request not available.');
    }

    // -------------------------------------------------------------
    // Test 5: Verify status change audit trigger
    // -------------------------------------------------------------
    if (insertedRequest1) {
      console.log('Test 5: Verifying status change audit trigger...');
      const { error: errUpdateStatus } = await supabase
        .from('fund_requests')
        .update({
          request_status: 'Cancelled',
          cancelled_by: testZoMobile,
          cancelled_at: new Date().toISOString()
        })
        .eq('fund_request_id', insertedRequest1.fund_request_id);

      if (errUpdateStatus) {
        console.log('  [FAIL] Failed to update fund request status:', errUpdateStatus);
        fails++;
      } else {
        const { data: auditLog, error: errAudit } = await supabase
          .from('audit_log')
          .select('*')
          .eq('record_identifier', insertedRequest1.fund_request_id)
          .eq('action', 'STATUS_CHANGE')
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!errAudit && auditLog && auditLog.new_value?.request_status === 'Cancelled') {
          console.log('  [PASS] Audit log captured status change correctly.');
          passes++;
        } else {
          console.log('  [FAIL] Audit log entry was not found or incorrect:', auditLog, errAudit);
          fails++;
        }
      }
    } else {
      console.log('  [SKIP] Skipping Test 5: Inserted request not available.');
    }

    // -------------------------------------------------------------
    // Test 6: Verify updated_at trigger on non-status update
    // -------------------------------------------------------------
    if (insertedRequest1) {
      console.log('Test 6: Verifying updated_at trigger...');
      const { data: frBefore } = await supabase
        .from('fund_requests')
        .select('updated_at')
        .eq('fund_request_id', insertedRequest1.fund_request_id)
        .single();

      // Wait a moment to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data: frAfter, error: errUpdateRemarks } = await supabase
        .from('fund_requests')
        .update({ zo_remarks: 'Updated Remarks' })
        .eq('fund_request_id', insertedRequest1.fund_request_id)
        .select()
        .single();

      if (!errUpdateRemarks && frAfter) {
        const timeBefore = new Date(frBefore.updated_at).getTime();
        const timeAfter = new Date(frAfter.updated_at).getTime();
        if (timeAfter > timeBefore) {
          console.log('  [PASS] updated_at timestamp updated automatically.');
          passes++;
        } else {
          console.log(`  [FAIL] updated_at was not modified: Before: ${frBefore.updated_at}, After: ${frAfter.updated_at}`);
          fails++;
        }
      } else {
        console.log('  [FAIL] Failed to update remarks:', errUpdateRemarks);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 6: Inserted request not available.');
    }

  } catch (err) {
    console.error('Unexpected test error:', err);
    fails++;
  } finally {
    console.log('\nCleaning up verification test data...');
    try {
      // Direct hard delete is blocked by trigger. We temporarily disable trigger or bypass it?
      // Wait, there is no bypass, but we can't delete them. Can we delete them?
      // Since hard delete is permanently prohibited by trigger, they will remain as test records.
      // But wait! Does the trigger block deletions for TEST_ records?
      // Let's check: the trigger prevents delete on ALL fund_requests. There is no exception for TEST_!
      // So they will stay in the DB. This is fine since it's a development database.
      console.log('  [NOTE] Test rows left in DB (hard deletes are permanently blocked by design).');
    } catch (cleanupErr) {
      console.warn('  [WARN] Cleanup error:', cleanupErr.message);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL DATABASE VERIFICATION TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME VERIFICATION TESTS FAILED. <<<');
    process.exit(1);
  }
}

testMilestoneP3M1();
