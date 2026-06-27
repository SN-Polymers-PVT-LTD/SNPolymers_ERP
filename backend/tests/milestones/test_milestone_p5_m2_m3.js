'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  createProgressReport,
  getProgressReports,
  getProgressReportById,
  addAuthorityRemarks
} = require('../../src/controllers/dailyProgress.controller');

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

async function testMilestoneP5M2M3() {
  console.log('=== RUNNING MILESTONE P5-M2 & M3 CORE CRUD & REMARKS TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Find a valid user and project (work order) to test with
  const { data: users } = await supabase.from('authorised_users').select('mobile_number, role').limit(5);
  const jeUser = users.find(u => u.role === 'je') || { mobile_number: '+917980526576', role: 'je' };
  const jeUser2 = users.find(u => u.role === 'je' && u.mobile_number !== jeUser.mobile_number) || { mobile_number: '+918000000002', role: 'je' };
  const zoUser = users.find(u => u.role === 'zo') || { mobile_number: '+918000000001', role: 'zo' };

  const { data: projects } = await supabase.from('projects_master').select('work_order_no, status').limit(1);
  if (!projects || projects.length === 0) {
    console.log('  [FAIL] No project found in projects_master to test.');
    process.exit(1);
  }
  const activeWorkOrder = projects[0].work_order_no;
  const originalStatus = projects[0].status;
  const pad = (num) => String(num).padStart(2, '0');
  const d1 = new Date();
  d1.setDate(d1.getDate() - 5 - Math.floor(Math.random() * 10));
  const testDate = `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-${pad(d1.getDate())}`;
  
  const d2 = new Date();
  d2.setDate(d2.getDate() - 15 - Math.floor(Math.random() * 10));
  const testDate2 = `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())}`;

  let createdReportId = null;

  try {
    // Set status to Running for test 1
    await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', activeWorkOrder);
    // -------------------------------------------------------------
    // Test 1: POST /daily-progress (Valid creation)
    // -------------------------------------------------------------
    console.log('Test 1: Creating progress report as JE on Active project...');
    const reqCreate = {
      user: jeUser,
      body: {
        work_order_no: activeWorkOrder,
        site_visit_date: testDate,
        work_progress_details: 'API Test Progress details',
        physical_work_progress: 55.456, // checks rounding
        daily_site_photo_url: 'api-test-photo.jpg',
        original_photo_filename: 'original-api-test.jpg',
        remarks_after_site_visit: 'JE remarks'
      }
    };
    const resCreate = mockRes();
    await createProgressReport(reqCreate, resCreate);

    if (resCreate.statusCode === 201 && resCreate.jsonData.success) {
      const report = resCreate.jsonData.report;
      createdReportId = report.report_id;
      if (Number(report.physical_work_progress) === 55.46) {
        console.log('  [PASS] Report created successfully. Progress rounded to 55.46.');
        passes++;
      } else {
        console.log('  [FAIL] Progress was not rounded correctly:', report.physical_work_progress);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to create report. Status:', resCreate.statusCode, 'Data:', resCreate.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: POST /daily-progress (Duplicate report)
    // -------------------------------------------------------------
    console.log('\nTest 2: Attempting duplicate report creation...');
    const reqDup = {
      user: jeUser,
      body: {
        work_order_no: activeWorkOrder,
        site_visit_date: testDate, // same date
        work_progress_details: 'Duplicate details',
        physical_work_progress: 10,
        daily_site_photo_url: 'dup.jpg'
      }
    };
    const resDup = mockRes();
    await createProgressReport(reqDup, resDup);

    if (resDup.statusCode === 409 && resDup.jsonData.message.includes('already been submitted')) {
      console.log('  [PASS] Correctly rejected duplicate daily progress report.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate report not blocked or wrong status/message. Status:', resDup.statusCode, 'Message:', resDup.jsonData?.message);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: POST /daily-progress (Invalid photo url format)
    // -------------------------------------------------------------
    console.log('\nTest 3: Rejecting absolute photo URL...');
    const reqPhotoUrl = {
      user: jeUser,
      body: {
        work_order_no: activeWorkOrder,
        site_visit_date: testDate2,
        work_progress_details: 'Invalid photo url details',
        physical_work_progress: 25.00,
        daily_site_photo_url: 'https://supabase.co/storage/v1/object/public/photos/test.jpg' // absolute URL (invalid)
      }
    };
    const resPhotoUrl = mockRes();
    await createProgressReport(reqPhotoUrl, resPhotoUrl);

    if (resPhotoUrl.statusCode === 400) {
      console.log('  [PASS] Correctly rejected absolute photo URL.');
      passes++;
    } else {
      console.log('  [FAIL] Absolute photo URL check failed. Status:', resPhotoUrl.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: POST /daily-progress (Closed/Non-Active Project check)
    // -------------------------------------------------------------
    console.log('\nTest 4: Creating progress report on Closed project...');
    // We will temporarily update the project status to Closed, perform test, and restore it
    await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', activeWorkOrder);

    const reqClosed = {
      user: jeUser,
      body: {
        work_order_no: activeWorkOrder,
        site_visit_date: testDate2,
        work_progress_details: 'Progress on closed project',
        physical_work_progress: 60.00,
        daily_site_photo_url: 'closed-project.jpg'
      }
    };
    const resClosed = mockRes();
    await createProgressReport(reqClosed, resClosed);

    // Restore project status to Running
    await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', activeWorkOrder);

    if (resClosed.statusCode === 409 && resClosed.jsonData.message.includes('Active projects')) {
      console.log('  [PASS] Correctly blocked progress report creation on Closed project with 409 Conflict.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block progress report creation on Closed project. Status:', resClosed.statusCode, 'Data:', resClosed.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: GET /daily-progress (List filtering by JE role)
    // -------------------------------------------------------------
    console.log('\nTest 5: Retrieving progress reports as JE...');
    const reqGetJe = {
      user: jeUser,
      query: { page: 1, limit: 10 }
    };
    const resGetJe = mockRes();
    await getProgressReports(reqGetJe, resGetJe);

    if (resGetJe.statusCode === 200 && resGetJe.jsonData.success) {
      const list = resGetJe.jsonData.reports;
      const allOwn = list.every(r => r.created_by === jeUser.mobile_number);
      const containsCreated = list.some(r => r.report_id === createdReportId);

      if (allOwn && containsCreated) {
        console.log('  [PASS] Successfully retrieved own reports only.');
        passes++;
      } else {
        console.log('  [FAIL] Visibility checks failed for JE list. allOwn:', allOwn, 'containsCreated:', containsCreated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve reports as JE. Status:', resGetJe.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: GET /daily-progress (List retrieval by ZO role)
    // -------------------------------------------------------------
    console.log('\nTest 6: Retrieving progress reports as ZO...');
    const reqGetZo = {
      user: zoUser,
      query: { page: 1, limit: 10 }
    };
    const resGetZo = mockRes();
    await getProgressReports(reqGetZo, resGetZo);

    if (resGetZo.statusCode === 200 && resGetZo.jsonData.success) {
      const list = resGetZo.jsonData.reports;
      const containsCreated = list.some(r => r.report_id === createdReportId);

      if (containsCreated) {
        console.log('  [PASS] ZO successfully retrieved reports including JE\'s.');
        passes++;
      } else {
        console.log('  [FAIL] Created report not visible to ZO. List:', list);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve reports as ZO. Status:', resGetZo.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: GET /daily-progress/:id (Ownership & signed URL check)
    // -------------------------------------------------------------
    console.log('\nTest 7: Retrieving single progress report by ID...');
    if (createdReportId) {
      // Owner JE fetches
      const reqGetOwner = {
        user: jeUser,
        params: { id: createdReportId }
      };
      const resGetOwner = mockRes();
      await getProgressReportById(reqGetOwner, resGetOwner);

      // Non-owner JE fetches (should return 404)
      const reqGetNonOwner = {
        user: jeUser2,
        params: { id: createdReportId }
      };
      const resGetNonOwner = mockRes();
      await getProgressReportById(reqGetNonOwner, resGetNonOwner);

      const isValidOwnerRes = resGetOwner.statusCode === 200 &&
        (resGetOwner.jsonData.report.photo_signed_url === null || resGetOwner.jsonData.report.photo_signed_url.startsWith('https://'));
      const isBlockedNonOwner = resGetNonOwner.statusCode === 404;

      // Verify that database still stores the relative path
      const { data: dbRecord } = await supabase
        .from('daily_progress_reports')
        .select('daily_site_photo_url')
        .eq('report_id', createdReportId)
        .single();
      const dbPathIsRelative = dbRecord && !dbRecord.daily_site_photo_url.startsWith('https://');

      if (isValidOwnerRes && isBlockedNonOwner && dbPathIsRelative) {
        console.log('  [PASS] Verified signed URL generation, blocked non-owner, and DB relative storage.');
        passes++;
      } else {
        console.log('  [FAIL] Single query check failed. Owner Status:', resGetOwner.statusCode, 'Non-Owner Status:', resGetNonOwner.statusCode, 'DB Path Is Relative:', dbPathIsRelative, 'Signed URL:', resGetOwner.jsonData?.report?.photo_signed_url);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 7: no report created.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: PATCH /:id/remarks (Authority Remarks creation & overwrite)
    // -------------------------------------------------------------
    console.log('\nTest 8: Adding and overwriting authority remarks as ZO...');
    if (createdReportId) {
      const reqRemarks1 = {
        user: zoUser,
        params: { id: createdReportId },
        body: { remarks_approved_authority: 'ZO Approved Remarks 1' }
      };
      const resRemarks1 = mockRes();
      await addAuthorityRemarks(reqRemarks1, resRemarks1);

      const reqRemarks2 = {
        user: zoUser,
        params: { id: createdReportId },
        body: { remarks_approved_authority: 'ZO Overwritten Remarks 2' }
      };
      const resRemarks2 = mockRes();
      await addAuthorityRemarks(reqRemarks2, resRemarks2);

      const remarksCorrect = resRemarks2.statusCode === 200 &&
        resRemarks2.jsonData.report.remarks_approved_authority === 'ZO Overwritten Remarks 2' &&
        resRemarks2.jsonData.report.approved_user_id === zoUser.mobile_number &&
        resRemarks2.jsonData.report.approval_date !== null;

      if (remarksCorrect) {
        console.log('  [PASS] Authority remarks added and successfully overwritten.');
        passes++;
      } else {
        console.log('  [FAIL] Remarks update failed. Status:', resRemarks2.statusCode, 'Data:', resRemarks2.jsonData);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 8: no report created.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9: PATCH /:id/remarks (Remarks on Closed Project)
    // -------------------------------------------------------------
    console.log('\nTest 9: Attempting to add authority remarks on Closed project...');
    if (createdReportId) {
      // Temporarily mark parent project Closed
      await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', activeWorkOrder);

      const reqRemarksClosed = {
        user: zoUser,
        params: { id: createdReportId },
        body: { remarks_approved_authority: 'Trying to add remarks to closed WO' }
      };
      const resRemarksClosed = mockRes();
      await addAuthorityRemarks(reqRemarksClosed, resRemarksClosed);

      // Restore parent project Running
      await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', activeWorkOrder);

      if (resRemarksClosed.statusCode === 409 && resRemarksClosed.jsonData.message.includes('remarks cannot be added or modified')) {
        console.log('  [PASS] Correctly blocked authority remarks on Closed project with 409.');
        passes++;
      } else {
        console.log('  [FAIL] Remarks on Closed project were not blocked. Status:', resRemarksClosed.statusCode, 'Data:', resRemarksClosed.jsonData);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 9: no report created.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error in M2/M3 tests:', err);
    fails++;
  } finally {
    // Restore the project status back to its original state
    await supabase.from('projects_master').update({ status: originalStatus }).eq('work_order_no', activeWorkOrder);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P5-M2 & M3 TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P5-M2 & M3 TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP5M2M3();
}

module.exports = { testMilestoneP5M2M3 };
