const { supabase } = require('../../src/db/supabase');

async function testMilestoneP5M1() {
  console.log('=== RUNNING MILESTONE P5-M1 DATABASE FOUNDATION VERIFICATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const randDay = Math.floor(1 + Math.random() * 26);
  const randMonth = Math.floor(1 + Math.random() * 12);
  const pad = (num) => String(num).padStart(2, '0');
  const testDate = `2026-${pad(randMonth)}-${pad(randDay)}`;
  const testDate2 = `2026-${pad(randMonth)}-${pad(randDay + 1)}`;
  let reportId = null;

  try {
    // Find a valid user and project (work order) to test with
    const { data: users, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1);
    if (userError || !users || !users.length) {
      console.log('  [FAIL] Failed to find a user:', userError);
      fails++;
      process.exit(1);
    }
    const mobile = users[0].mobile_number;

    const { data: projects, error: projectError } = await supabase.from('projects_master').select('work_order_no, state, district, zone, department, site_details').limit(1);
    if (projectError || !projects || !projects.length) {
      console.log('  [FAIL] Failed to find a project:', projectError);
      fails++;
      process.exit(1);
    }
    const project = projects[0];

    // Clean up any old reports for this work order to avoid unique constraint issues initially
    const { error: cleanupError } = await supabase
      .from('daily_progress_reports')
      .delete()
      .eq('work_order_no', project.work_order_no);
    if (cleanupError) {
      // It's expected to fail if delete trigger is active, but we log and proceed
      console.log('  [INFO] Cleanup delete tried, got expected restriction or success:', cleanupError.message);
    }

    // -------------------------------------------------------------
    // Test 1: Insert valid report row
    // -------------------------------------------------------------
    console.log('Test 1: Inserting valid report row...');
    const validReport = {
      created_by: mobile,
      work_order_no: project.work_order_no,
      state: project.state,
      district: project.district,
      area_code: project.zone,
      department: project.department,
      site_details: project.site_details,
      site_visit_date: testDate,
      work_progress_details: 'Test work progress description',
      physical_work_progress: 45.50,
      daily_site_photo_url: 'test-uuid-path.jpg',
      original_photo_filename: 'test.jpg'
    };

    const { data: insData, error: insError } = await supabase
      .from('daily_progress_reports')
      .insert([validReport])
      .select();

    if (!insError && insData && insData.length > 0) {
      console.log('  [PASS] Successfully inserted valid daily progress report.');
      reportId = insData[0].report_id;
      passes++;
    } else {
      console.log('  [FAIL] Failed to insert valid report row:', insError ? insError.message : 'No data returned');
      fails++;
      process.exit(1);
    }

    // -------------------------------------------------------------
    // Test 1b: Verify audit log entry
    // -------------------------------------------------------------
    console.log('Test 1b: Verifying audit_log entry for INSERT...');
    const { data: auditData, error: auditError } = await supabase
      .from('audit_log')
      .select('*')
      .eq('record_identifier', reportId)
      .eq('module_name', 'DailyProgress')
      .maybeSingle();

    if (!auditError && auditData && auditData.action === 'CREATE') {
      console.log('  [PASS] Audit log contains the CREATE action under DailyProgress module.');
      passes++;
    } else {
      console.log('  [FAIL] Audit log check failed. Error:', auditError ? auditError.message : 'Not found');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Attempt DELETE FROM daily_progress_reports
    // -------------------------------------------------------------
    console.log('Test 2: Attempting hard delete...');
    const { error: delErr } = await supabase
      .from('daily_progress_reports')
      .delete()
      .eq('report_id', reportId);

    if (delErr && delErr.message.includes('Hard deletion of daily progress reports is permanently prohibited')) {
      console.log('  [PASS] Hard delete was correctly blocked.');
      passes++;
    } else {
      console.log('  [FAIL] Hard delete was not blocked or returned wrong message:', delErr ? delErr.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Update a field and verify updated_at changes
    // -------------------------------------------------------------
    console.log('Test 3: Verifying updated_at trigger on UPDATE...');
    const oldUpdatedAt = insData[0].updated_at;
    
    // Brief sleep to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 500));

    const { data: updData, error: updError } = await supabase
      .from('daily_progress_reports')
      .update({ remarks_after_site_visit: 'Updated JE remarks' })
      .eq('report_id', reportId)
      .select();

    if (!updError && updData && updData.length > 0 && updData[0].updated_at !== oldUpdatedAt) {
      console.log('  [PASS] updated_at was automatically updated.');
      passes++;
    } else {
      console.log('  [FAIL] updated_at update check failed. Error:', updError ? updError.message : 'Timestamp did not change');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Physical progress 101
    // -------------------------------------------------------------
    console.log('Test 4: Inserting progress = 101.00 (expecting check constraint failure)...');
    const invalidProgressReport1 = {
      ...validReport,
      site_visit_date: testDate2,
      physical_work_progress: 101.00
    };
    const { error: err101 } = await supabase
      .from('daily_progress_reports')
      .insert([invalidProgressReport1]);

    if (err101 && err101.message.includes('chk_physical_work_progress')) {
      console.log('  [PASS] Correctly blocked out of bounds physical progress (> 100).');
      passes++;
    } else {
      console.log('  [FAIL] Out of bounds physical progress (> 100) was not blocked. Error:', err101 ? err101.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Physical progress -1
    // -------------------------------------------------------------
    console.log('Test 5: Inserting progress = -1.00 (expecting check constraint failure)...');
    const invalidProgressReport2 = {
      ...validReport,
      site_visit_date: testDate2,
      physical_work_progress: -1.00
    };
    const { error: errNeg } = await supabase
      .from('daily_progress_reports')
      .insert([invalidProgressReport2]);

    if (errNeg && errNeg.message.includes('chk_physical_work_progress')) {
      console.log('  [PASS] Correctly blocked negative physical progress.');
      passes++;
    } else {
      console.log('  [FAIL] Negative physical progress was not blocked. Error:', errNeg ? errNeg.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: Partial authority remarks consistency check
    // -------------------------------------------------------------
    console.log('Test 6: Inserting partial authority remarks (expecting check constraint failure)...');
    const partialAuthorityReport = {
      ...validReport,
      site_visit_date: testDate2,
      remarks_approved_authority: 'Approved remarks'
      // approved_user_id and approval_date are NULL
    };
    const { error: errPartial } = await supabase
      .from('daily_progress_reports')
      .insert([partialAuthorityReport]);

    if (errPartial && errPartial.message.includes('chk_authority_remarks_consistency')) {
      console.log('  [PASS] Correctly blocked inconsistent authority remarks.');
      passes++;
    } else {
      console.log('  [FAIL] Inconsistent authority remarks were not blocked. Error:', errPartial ? errPartial.message : 'No error');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Duplicate work order + date unique constraint
    // -------------------------------------------------------------
    console.log('Test 7: Inserting duplicate WO + date (expecting unique constraint failure)...');
    const duplicateReport = {
      ...validReport,
      site_visit_date: testDate, // Same date as validReport
      physical_work_progress: 50.00
    };
    const { error: errDup } = await supabase
      .from('daily_progress_reports')
      .insert([duplicateReport]);

    if (errDup && errDup.message.includes('uq_daily_progress_work_order_date')) {
      console.log('  [PASS] Correctly blocked duplicate WO + date.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate WO + date was not blocked. Error:', errDup ? errDup.message : 'No error');
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
    console.log('\n>>> ALL MILESTONE P5-M1 DATABASE TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P5-M1 DATABASE TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP5M1();
}

module.exports = { testMilestoneP5M1 };
