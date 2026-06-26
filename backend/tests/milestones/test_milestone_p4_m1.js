const { supabase } = require('../../src/db/supabase');

async function testMilestoneP4M1() {
  console.log('=== RUNNING MILESTONE P4-M1 DATABASE FOUNDATION VERIFICATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testMobile = '+918276071523'; // Admin/Staff user from seed
  const testWorkOrder = 'WB_BAN_102'; // Known valid work order in DB
  const requisitionNo = `REQ_P4_M1_TEST_${suffix}`;
  let requisitionId = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Insert a requisition row with requisition_status = 'Pending'
    // -------------------------------------------------------------
    console.log('Test 1: Inserting valid Pending requisition...');
    const { data: req1, error: err1 } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: testMobile,
        work_order_no: testWorkOrder,
        estimate_no: 'EST_M1_MOCK',
        estimate_amount: 10000.00,
        state: 'West Bengal',
        district: 'Bankura',
        area_code: 'Bankura Zone',
        department: 'PWD',
        site_details: 'Mock Site Details',
        requisition_no: requisitionNo,
        material_main_head: 'Pipes',
        requisition_pdf_url: 'mock_requisition_path.pdf',
        original_filename: 'mock.pdf',
        requisition_amount: 5000.00,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890',
        requisition_status: 'Pending',
        created_by: testMobile
      }])
      .select()
      .single();

    if (!err1 && req1) {
      console.log('  [PASS] Successfully inserted Pending requisition.');
      requisitionId = req1.requisition_id;
      passes++;
    } else {
      console.log('  [FAIL] Failed to insert Pending requisition:', err1);
      fails++;
      return; // Stop here if we cannot even insert the first row
    }

    // -------------------------------------------------------------
    // Test 2: Insert a second requisition with the same requisition_no
    // -------------------------------------------------------------
    console.log('Test 2: Inserting duplicate requisition_no...');
    const { error: err2 } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: testMobile,
        work_order_no: testWorkOrder,
        estimate_no: 'EST_M1_MOCK',
        estimate_amount: 10000.00,
        state: 'West Bengal',
        district: 'Bankura',
        area_code: 'Bankura Zone',
        department: 'PWD',
        site_details: 'Mock Site Details',
        requisition_no: requisitionNo, // Duplicate
        material_main_head: 'Pipes',
        requisition_pdf_url: 'mock_requisition_path_2.pdf',
        original_filename: 'mock2.pdf',
        requisition_amount: 2000.00,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890',
        requisition_status: 'Pending',
        created_by: testMobile
      }]);

    if (err2 && err2.code === '23505') { // unique_violation
      console.log('  [PASS] Correctly blocked duplicate requisition_no.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate requisition_no was not blocked. Error:', err2);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Attempt DELETE FROM requisitions
    // -------------------------------------------------------------
    console.log('Test 3: Attempting hard delete...');
    const { error: err3 } = await supabase
      .from('requisitions')
      .delete()
      .eq('requisition_id', requisitionId);

    if (err3 && err3.message.includes('prohibited')) {
      console.log('  [PASS] Hard delete prevention trigger blocked deletion.');
      passes++;
    } else {
      console.log('  [FAIL] Hard delete was not blocked. Error:', err3);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Update requisition_status; check audit_log
    // -------------------------------------------------------------
    console.log('Test 4: Verifying status change audit trigger...');
    const { error: err4Update } = await supabase
      .from('requisitions')
      .update({
        requisition_status: 'Hold',
        approve_type: 'Hold',
        approved_user_id: testMobile,
        remarks_approved_authority: 'Needs verification'
      })
      .eq('requisition_id', requisitionId);

    if (err4Update) {
      console.log('  [FAIL] Failed to update status to Hold:', err4Update);
      fails++;
    } else {
      const { data: audit, error: errAudit } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', requisitionId)
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!errAudit && audit && audit.new_value?.requisition_status === 'Hold') {
        console.log('  [PASS] Audit log captured status change correctly.');
        passes++;
      } else {
        console.log('  [FAIL] Audit log check failed. Log:', audit, 'Error:', errAudit);
        fails++;
      }
    }

    // -------------------------------------------------------------
    // Test 5: Update non-status field; check updated_at
    // -------------------------------------------------------------
    console.log('Test 5: Verifying set_requisition_updated_at trigger...');
    const { data: reqBeforeUpdate } = await supabase
      .from('requisitions')
      .select('updated_at')
      .eq('requisition_id', requisitionId)
      .single();

    // Sleep 1 sec to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 1000));

    const { error: err5Update } = await supabase
      .from('requisitions')
      .update({ expen_head_remarks: 'Updated remarks for Test 5' })
      .eq('requisition_id', requisitionId);

    if (err5Update) {
      console.log('  [FAIL] Failed to update non-status field:', err5Update);
      fails++;
    } else {
      const { data: reqAfterUpdate } = await supabase
        .from('requisitions')
        .select('updated_at')
        .eq('requisition_id', requisitionId)
        .single();

      if (reqBeforeUpdate && reqAfterUpdate && reqAfterUpdate.updated_at !== reqBeforeUpdate.updated_at) {
        console.log('  [PASS] updated_at was auto-updated.');
        passes++;
      } else {
        console.log('  [FAIL] updated_at did not change. Before:', reqBeforeUpdate?.updated_at, 'After:', reqAfterUpdate?.updated_at);
        fails++;
      }
    }

    // -------------------------------------------------------------
    // Test 6: Insert a requisition with gst_bill = 'Yes' but gst_bill_pdf_url = NULL
    // -------------------------------------------------------------
    console.log('Test 6: Testing chk_gst_bill_pdf constraint...');
    const { error: err6 } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: testMobile,
        work_order_no: testWorkOrder,
        estimate_no: 'EST_M1_MOCK',
        estimate_amount: 10000.00,
        state: 'West Bengal',
        district: 'Bankura',
        area_code: 'Bankura Zone',
        department: 'PWD',
        site_details: 'Mock Site Details',
        requisition_no: `REQ_M1_TEST_6_${suffix}`,
        material_main_head: 'Pipes',
        requisition_pdf_url: 'mock_requisition_path.pdf',
        original_filename: 'mock.pdf',
        requisition_amount: 3000.00,
        gst_bill: 'Yes',
        gst_bill_pdf_url: null, // Should violate constraint
        bank_details: 'SBI Account 1234567890',
        requisition_status: 'Pending',
        created_by: testMobile
      }]);

    if (err6 && err6.code === '23514') { // check_violation
      console.log('  [PASS] Correctly blocked missing GST URL with CHECK constraint.');
      passes++;
    } else {
      console.log('  [FAIL] Did not block missing GST URL. Error:', err6);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Insert a requisition with requisition_status = 'Approved' but wrong balance
    // -------------------------------------------------------------
    console.log('Test 7: Testing chk_balance_amount constraint...');
    const { error: err7 } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: testMobile,
        work_order_no: testWorkOrder,
        estimate_no: 'EST_M1_MOCK',
        estimate_amount: 10000.00,
        state: 'West Bengal',
        district: 'Bankura',
        area_code: 'Bankura Zone',
        department: 'PWD',
        site_details: 'Mock Site Details',
        requisition_no: `REQ_M1_TEST_7_${suffix}`,
        material_main_head: 'Pipes',
        requisition_pdf_url: 'mock_requisition_path.pdf',
        original_filename: 'mock.pdf',
        requisition_amount: 5000.00,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890',
        requisition_status: 'Approved',
        approved_user_id: testMobile,
        approve_type: 'Approve',
        approved_amount: 4000.00,
        approved_balance_amount: 9999.00, // Invalid (should be 1000)
        remarks_approved_authority: 'Approved some',
        created_by: testMobile
      }]);

    if (err7 && err7.code === '23514') { // check_violation
      console.log('  [PASS] Correctly blocked invalid balance with CHECK constraint.');
      passes++;
    } else {
      console.log('  [FAIL] Did not block invalid balance. Error:', err7);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected test error:', err);
    fails++;
  } finally {
    console.log('\nCleaning up / soft-cancelling verification test data...');
    if (requisitionId) {
      await supabase
        .from('requisitions')
        .update({ requisition_status: 'Cancelled', cancelled_by: testMobile, cancelled_at: new Date().toISOString() })
        .eq('requisition_id', requisitionId);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P4-M1 DATABASE TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P4-M1 DATABASE TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP4M1();
}

module.exports = { testMilestoneP4M1 };
