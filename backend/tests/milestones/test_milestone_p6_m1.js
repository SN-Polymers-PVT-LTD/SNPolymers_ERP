const { supabase } = require('../../src/db/supabase');

async function testMilestoneP6M1() {
  console.log('=== RUNNING MILESTONE P6-M1 DATABASE FOUNDATION VERIFICATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testBillNo = `BILL_M1_TEST_${suffix}`;
  let createdBillId = null;
  let mobile = null;
  let project = null;

  try {
    // Find a valid user and project (work order) to test with
    const { data: users, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1);
    if (userError || !users || !users.length) {
      console.log('  [FAIL] Failed to find a user:', userError);
      fails++;
      process.exit(1);
    }
    mobile = users[0].mobile_number;

    const { data: projects, error: projectError } = await supabase.from('projects_master').select('work_order_no, state, district, zone, department, site_details').limit(1);
    if (projectError || !projects || !projects.length) {
      console.log('  [FAIL] Failed to find a project:', projectError);
      fails++;
      process.exit(1);
    }
    project = projects[0];

    // Clean up any old test bills for this work order to avoid unique constraint issues
    const { error: cleanupError } = await supabase
      .from('ra_final_bills')
      .delete()
      .eq('work_order_no', project.work_order_no);
    if (cleanupError) {
      console.log('  [INFO] Cleanup delete tried, got expected restriction or success:', cleanupError.message);
    }

    // -------------------------------------------------------------
    // Test 1: Insert valid bill entry
    // -------------------------------------------------------------
    console.log('Test 1: Inserting valid RA bill row...');
    const validBill = {
      created_by: mobile,
      work_order_no: project.work_order_no,
      state: project.state,
      district: project.district,
      area_code: project.zone,
      department: project.department,
      site_details: project.site_details,
      payment_type: 'RA Bill 1',
      bill_date: new Date().toISOString().split('T')[0],
      bill_no: testBillNo,
      bill_amount_with_gst: 150000.00,
      earnest_money_deposit: 1000.00,
      security_deposit_amount: 2000.00,
      bill_copy_url: 'test-uuid-path.pdf',
      original_bill_filename: 'invoice.pdf',
      remarks: 'Test remarks'
    };

    const { data: insData, error: insError } = await supabase
      .from('ra_final_bills')
      .insert([validBill])
      .select();

    if (!insError && insData && insData.length > 0) {
      console.log('  [PASS] Successfully inserted valid RA bill.');
      createdBillId = insData[0].bill_id;
      passes++;
    } else {
      console.log('  [FAIL] Failed to insert valid RA bill row:', insError ? insError.message : 'No data returned');
      fails++;
      process.exit(1);
    }

    // -------------------------------------------------------------
    // Test 1b: Verify audit log entry for INSERT
    // -------------------------------------------------------------
    console.log('Test 1b: Verifying audit_log entry for INSERT...');
    const { data: auditData, error: auditError } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', createdBillId)
      .eq('module_name', 'RAFinalBill')
      .maybeSingle();

    if (!auditError && auditData && auditData.action === 'CREATE') {
      console.log('  [PASS] Audit log contains the CREATE action under RAFinalBill module.');
      passes++;
    } else {
      console.log('  [FAIL] Audit log check failed. Error:', auditError ? auditError.message : 'Not found');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Attempt DELETE FROM ra_final_bills (block hard delete)
    // -------------------------------------------------------------
    console.log('Test 2: Attempting hard delete (expecting restriction)...');
    const { error: delErr } = await supabase
      .from('ra_final_bills')
      .delete()
      .eq('bill_id', createdBillId);

    if (delErr && delErr.message.includes('Hard deletion of RA/Final bill records is permanently prohibited')) {
      console.log('  [PASS] Hard delete was correctly blocked.');
      passes++;
    } else {
      console.log('  [FAIL] Hard delete was not blocked or returned wrong message:', delErr ? delErr.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Update any field and verify updated_at trigger
    // -------------------------------------------------------------
    console.log('Test 3: Verifying updated_at trigger on UPDATE...');
    const oldUpdatedAt = insData[0].updated_at;
    
    // Brief sleep to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 500));

    const { data: updData, error: updError } = await supabase
      .from('ra_final_bills')
      .update({ remarks: 'Updated remarks for Test 3' })
      .eq('bill_id', createdBillId)
      .select();

    if (!updError && updData && updData.length > 0 && updData[0].updated_at !== oldUpdatedAt) {
      console.log('  [PASS] updated_at was automatically updated.');
      passes++;
    } else {
      console.log('  [FAIL] updated_at update check failed. Error:', updError ? updError.message : 'Timestamp did not change');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Insert with bill_amount_with_gst = 0
    // -------------------------------------------------------------
    console.log('Test 4: Inserting with bill_amount_with_gst = 0 (expecting check constraint failure)...');
    const invalidBillAmount0 = {
      ...validBill,
      payment_type: 'RA Bill 2',
      bill_no: `${testBillNo}_4`,
      bill_amount_with_gst: 0
    };
    const { error: errAmount0 } = await supabase
      .from('ra_final_bills')
      .insert([invalidBillAmount0]);

    if (errAmount0 && errAmount0.message.includes('chk_bill_amount_positive')) {
      console.log('  [PASS] Correctly blocked zero bill amount.');
      passes++;
    } else {
      console.log('  [FAIL] Zero bill amount was not blocked. Error:', errAmount0 ? errAmount0.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Insert with bill_amount_with_gst = -500
    // -------------------------------------------------------------
    console.log('Test 5: Inserting with bill_amount_with_gst = -500 (expecting check constraint failure)...');
    const invalidBillAmountNeg = {
      ...validBill,
      payment_type: 'RA Bill 2',
      bill_no: `${testBillNo}_5`,
      bill_amount_with_gst: -500
    };
    const { error: errAmountNeg } = await supabase
      .from('ra_final_bills')
      .insert([invalidBillAmountNeg]);

    if (errAmountNeg && errAmountNeg.message.includes('chk_bill_amount_positive')) {
      console.log('  [PASS] Correctly blocked negative bill amount.');
      passes++;
    } else {
      console.log('  [FAIL] Negative bill amount was not blocked. Error:', errAmountNeg ? errAmountNeg.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: Insert with earnest_money_deposit = -1
    // -------------------------------------------------------------
    console.log('Test 6: Inserting with earnest_money_deposit = -1 (expecting check constraint failure)...');
    const invalidEmdNeg = {
      ...validBill,
      payment_type: 'RA Bill 2',
      bill_no: `${testBillNo}_6`,
      earnest_money_deposit: -1
    };
    const { error: errEmdNeg } = await supabase
      .from('ra_final_bills')
      .insert([invalidEmdNeg]);

    if (errEmdNeg && errEmdNeg.message.includes('chk_emd_non_negative')) {
      console.log('  [PASS] Correctly blocked negative earnest money deposit.');
      passes++;
    } else {
      console.log('  [FAIL] Negative EMD was not blocked. Error:', errEmdNeg ? errEmdNeg.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Insert with payment_type = 'RA Bill 0'
    // -------------------------------------------------------------
    console.log('Test 7: Inserting with payment_type = "RA Bill 0" (expecting check constraint failure)...');
    const invalidType0 = {
      ...validBill,
      payment_type: 'RA Bill 0',
      bill_no: `${testBillNo}_7`
    };
    const { error: errType0 } = await supabase
      .from('ra_final_bills')
      .insert([invalidType0]);

    if (errType0 && errType0.message.includes('chk_payment_type_format')) {
      console.log('  [PASS] Correctly blocked RA Bill 0.');
      passes++;
    } else {
      console.log('  [FAIL] RA Bill 0 was not blocked. Error:', errType0 ? errType0.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: Insert with payment_type = 'ra bill 1' (lowercase)
    // -------------------------------------------------------------
    console.log('Test 8: Inserting with payment_type = "ra bill 1" (lowercase) (expecting check constraint failure)...');
    const invalidTypeLower = {
      ...validBill,
      payment_type: 'ra bill 1',
      bill_no: `${testBillNo}_8`
    };
    const { error: errTypeLower } = await supabase
      .from('ra_final_bills')
      .insert([invalidTypeLower]);

    if (errTypeLower && errTypeLower.message.includes('chk_payment_type_format')) {
      console.log('  [PASS] Correctly blocked lowercase payment type.');
      passes++;
    } else {
      console.log('  [FAIL] Lowercase payment type was not blocked. Error:', errTypeLower ? errTypeLower.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9: Insert with payment_type = 'Random String'
    // -------------------------------------------------------------
    console.log('Test 9: Inserting with payment_type = "Random String" (expecting check constraint failure)...');
    const invalidTypeRandom = {
      ...validBill,
      payment_type: 'Random String',
      bill_no: `${testBillNo}_9`
    };
    const { error: errTypeRandom } = await supabase
      .from('ra_final_bills')
      .insert([invalidTypeRandom]);

    if (errTypeRandom && errTypeRandom.message.includes('chk_payment_type_format')) {
      console.log('  [PASS] Correctly blocked invalid payment type format.');
      passes++;
    } else {
      console.log('  [FAIL] Invalid payment type format was not blocked. Error:', errTypeRandom ? errTypeRandom.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 10: Insert same (work_order_no, payment_type) twice
    // -------------------------------------------------------------
    console.log('Test 10: Inserting duplicate payment type for same work order (expecting unique constraint failure)...');
    const duplicateBill = {
      ...validBill,
      bill_no: `${testBillNo}_dup`
    };
    const { error: errDup } = await supabase
      .from('ra_final_bills')
      .insert([duplicateBill]);

    if (errDup && errDup.code === '23505') {
      console.log('  [PASS] Correctly blocked duplicate payment type via unique constraint.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate payment type was not blocked. Error:', errDup ? errDup.message : 'No error');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected test error:', err);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P6-M1 DATABASE TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P6-M1 DATABASE TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP6M1();
}

module.exports = { testMilestoneP6M1 };
