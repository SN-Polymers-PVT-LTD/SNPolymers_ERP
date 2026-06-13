const { getProjects, getProjectByWorkOrder, createProject, updateProject, updateProjectStatus } = require('/home/zenoguy/Desktop/SNPolymers/backend/src/controllers/projects.controller');
const { getReports, getReportById, createReport, updateReport, deleteReport, restoreReport } = require('/home/zenoguy/Desktop/SNPolymers/backend/src/controllers/reports.controller');
const { supabase } = require('/home/zenoguy/Desktop/SNPolymers/backend/src/db/supabase');
const requireAdmin = require('/home/zenoguy/Desktop/SNPolymers/backend/src/middleware/requireAdmin');

// Helper to create mock res object
function mockRes() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.jsonData = data;
      return this;
    }
  };
  return res;
}

async function testPhase2() {
  console.log('=== RUNNING PHASE 2 BACKEND CONTROLLER & MUTABILITY GATE TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Use isolated temporary projects instead of mutating real seed data
  const testWOUnderTest = 'TEST_WO_PHASE2_A';
  const testWOClosed = 'TEST_WO_PHASE2_B';

  try {
    // 0. Setup: Clean up any previous test remnants & insert clean test projects
    console.log('Cleaning up leftovers and inserting temporary test projects...');
    await supabase.from('fund_reports').delete().in('work_order_no', [testWOUnderTest, testWOClosed]);
    await supabase.from('projects_master').delete().in('work_order_no', [testWOUnderTest, testWOClosed]);

    await supabase.from('projects_master').insert([
      {
        work_order_no: testWOUnderTest,
        estimate_no: 'TEST_EST_A',
        site_details: 'Test Site A',
        state: 'West Bengal',
        district: 'Alipurduar',
        zone: 'North Bengal',
        department: 'PWD',
        status: 'Running',
        created_by: '+918276071523',
        edited_by: '+918276071523'
      },
      {
        work_order_no: testWOClosed,
        estimate_no: 'TEST_EST_B',
        site_details: 'Test Site B',
        state: 'Bihar',
        district: 'Araria',
        zone: 'North Bihar',
        department: 'Irrigation',
        status: 'Closed',
        created_by: '+918276071523',
        edited_by: '+918276071523'
      }
    ]);
    console.log('Temporary test projects inserted successfully.');

    // 1. Test getProjects controller
    console.log('\n1. Testing getProjects controller...');
    const req1 = { user: { role: 'staff' } };
    const res1 = mockRes();
    await getProjects(req1, res1);

    if (res1.statusCode === 200 && res1.jsonData.success && res1.jsonData.projects.length >= 2) {
      console.log(`  [PASS] Successfully retrieved ${res1.jsonData.projects.length} projects.`);
      passes++;
    } else {
      console.log(`  [FAIL] Failed to retrieve projects. Status: ${res1.statusCode}`);
      fails++;
    }

    // 2. Test createProject validation
    console.log('\n2. Testing createProject validation (missing fields)...');
    const req2 = {
      user: { role: 'admin', mobile_number: '+918276071523' },
      body: { work_order_no: 'TEST_WO_999' } // missing estimate_no, etc.
    };
    const res2 = mockRes();
    await createProject(req2, res2);

    if (res2.statusCode === 400 && !res2.jsonData.success) {
      console.log('  [PASS] Rejected request with missing required fields.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 400 validation error, got: ${res2.statusCode}`);
      fails++;
    }

    // 3. Test Mutability Gate: Create report on Running project (Should succeed)
    console.log(`\n3. Testing report creation on Running project (${testWOUnderTest})...`);
    const req3 = {
      user: { mobile_number: '+918276071523' },
      body: { work_order_no: testWOUnderTest, amount: 50000.00, remarks: 'Initial funding' }
    };
    const res3 = mockRes();
    await createReport(req3, res3);

    let testReportId = null;
    if (res3.statusCode === 201 && res3.jsonData.success) {
      testReportId = res3.jsonData.report.fund_report_id;
      console.log(`  [PASS] Created report successfully. ID: ${testReportId}`);
      passes++;
    } else {
      console.log(`  [FAIL] Failed to create report on Running project. Status: ${res3.statusCode}, Error: ${res3.jsonData?.message}`);
      fails++;
    }

    // 4. Test Mutability Gate: Create report on Closed project (Should fail)
    console.log(`\n4. Testing report creation on Closed project (${testWOClosed})...`);
    const req4 = {
      user: { mobile_number: '+918276071523' },
      body: { work_order_no: testWOClosed, amount: 25000.00, remarks: 'Funding closed project' }
    };
    const res4 = mockRes();
    await createReport(req4, res4);

    if (res4.statusCode === 403 && !res4.jsonData.success && res4.jsonData.message.includes('Closed')) {
      console.log('  [PASS] Mutability gate blocked report creation on Closed project.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 403 Forbidden, got status: ${res4.statusCode}, Msg: ${res4.jsonData?.message}`);
      fails++;
    }

    if (testReportId) {
      // 5. Test Live Join: Fetch the report and check project columns are returned live
      console.log('\n5. Testing Live Join lookup for reports...');
      const req5 = { params: { fund_report_id: testReportId } };
      const res5 = mockRes();
      await getReportById(req5, res5);

      if (res5.statusCode === 200 && res5.jsonData.success) {
        const report = res5.jsonData.report;
        if (report.projects_master && report.projects_master.estimate_no === 'TEST_EST_A' && report.projects_master.state === 'West Bengal') {
          console.log('  [PASS] Report fetched successfully with live project master columns:');
          console.log(`         Estimate: ${report.projects_master.estimate_no}`);
          console.log(`         State: ${report.projects_master.state}`);
          passes++;
        } else {
          console.log('  [FAIL] Project master columns are missing or incorrect in joined result:', report.projects_master);
          fails++;
        }
      } else {
        console.log(`  [FAIL] Failed to fetch report by ID. Status: ${res5.statusCode}`);
        fails++;
      }

      // 6. Test Mutability Gate: Update report linked to Running project (Should succeed)
      console.log('\n6. Testing report update on Running project...');
      const req6 = {
        params: { fund_report_id: testReportId },
        user: { mobile_number: '+918276071523' },
        body: { amount: 65000.00, remarks: 'Updated funding' }
      };
      const res6 = mockRes();
      await updateReport(req6, res6);

      if (res6.statusCode === 200 && res6.jsonData.success && parseFloat(res6.jsonData.report.amount) === 65000) {
        console.log('  [PASS] Report successfully updated.');
        passes++;
      } else {
        console.log(`  [FAIL] Update failed. Status: ${res6.statusCode}, Error: ${res6.jsonData?.message}`);
        fails++;
      }

      // Now temporarily move the project under test to Closed to test update/delete gates
      console.log(`\nTemporarily setting ${testWOUnderTest} to 'Closed' to test edit gate...`);
      await supabase
        .from('projects_master')
        .update({ status: 'Closed', edited_by: '+918276071523' })
        .eq('work_order_no', testWOUnderTest);

      // 7. Test Mutability Gate: Update report linked to Closed project (Should fail)
      console.log('7. Testing report update on Closed project...');
      const req7 = {
        params: { fund_report_id: testReportId },
        user: { mobile_number: '+918276071523' },
        body: { amount: 75000.00, remarks: 'Illegal update' }
      };
      const res7 = mockRes();
      await updateReport(req7, res7);

      if (res7.statusCode === 403 && !res7.jsonData.success && res7.jsonData.message.includes('Closed')) {
        console.log('  [PASS] Mutability gate blocked editing report of Closed project.');
        passes++;
      } else {
        console.log(`  [FAIL] Expected 403 Forbidden, got status: ${res7.statusCode}, Msg: ${res7.jsonData?.message}`);
        fails++;
      }

      // 8. Test Mutability Gate: Delete report linked to Closed project (Should fail)
      console.log('\n8. Testing report delete on Closed project...');
      const req8 = {
        params: { fund_report_id: testReportId },
        user: { mobile_number: '+918276071523' }
      };
      const res8 = mockRes();
      await deleteReport(req8, res8);

      if (res8.statusCode === 403 && !res8.jsonData.success && res8.jsonData.message.includes('Closed')) {
        console.log('  [PASS] Mutability gate blocked deleting report of Closed project.');
        passes++;
      } else {
        console.log(`  [FAIL] Expected 403 Forbidden, got status: ${res8.statusCode}, Msg: ${res8.jsonData?.message}`);
        fails++;
      }

      // Re-open project under test to 'Running'
      console.log(`\nRe-opening ${testWOUnderTest} to 'Running'...`);
      await supabase
        .from('projects_master')
        .update({ status: 'Running', edited_by: '+918276071523' })
        .eq('work_order_no', testWOUnderTest);

      // 9. Test Soft Delete & Metadata: Delete report linked to Running project (Should succeed)
      console.log('9. Testing report soft-delete & metadata on Running project...');
      const req9 = {
        params: { fund_report_id: testReportId },
        user: { mobile_number: '+918276071523' }
      };
      const res9 = mockRes();
      await deleteReport(req9, res9);

      const report = res9.jsonData?.report;
      if (
        res9.statusCode === 200 &&
        res9.jsonData.success &&
        report.is_deleted === true &&
        report.deleted_by === '+918276071523' &&
        report.deleted_at !== null
      ) {
        console.log('  [PASS] Report soft-deleted successfully and verified metadata (deleted_by, deleted_at).');
        passes++;
      } else {
        console.log(`  [FAIL] Soft delete failed or metadata missing. Status: ${res9.statusCode}, report:`, report);
        fails++;
      }

      // 10. Verify Soft-Deleted report is hidden in default fetch
      console.log('\n10. Verifying soft-deleted report is hidden in default reports list...');
      const req10 = { user: { role: 'staff' } };
      const res10 = mockRes();
      await getReports(req10, res10);

      const found = res10.jsonData.reports.some(r => r.fund_report_id === testReportId);
      if (!found) {
        console.log('  [PASS] Soft-deleted report is filtered out of active reports list.');
        passes++;
      } else {
        console.log('  [FAIL] Soft-deleted report was still returned in reports list!');
        fails++;
      }

      // 11. Test Restore: Restore report linked to Running project (Should succeed)
      console.log('\n11. Testing report restore on Running project...');
      const req11 = {
        params: { fund_report_id: testReportId },
        user: { mobile_number: '+918276071523' }
      };
      const res11 = mockRes();
      await restoreReport(req11, res11);

      if (res11.statusCode === 200 && res11.jsonData.success && res11.jsonData.report.is_deleted === false) {
        console.log('  [PASS] Report restored successfully.');
        passes++;
      } else {
        console.log(`  [FAIL] Restoration failed. Status: ${res11.statusCode}`);
        fails++;
      }

      // 12. Verify Restore State in DB (Explicit verification of DB columns post-restore)
      console.log('\n12. Verifying persisted database record columns after restore...');
      const { data: dbReport, error: dbErr } = await supabase
        .from('fund_reports')
        .select('*')
        .eq('fund_report_id', testReportId)
        .single();

      if (!dbErr && dbReport && dbReport.is_deleted === false && dbReport.deleted_by === null && dbReport.deleted_at === null) {
        console.log('  [PASS] DB record state verified: is_deleted is false, metadata fields cleared to null.');
        passes++;
      } else {
        console.log(`  [FAIL] DB record state invalid after restore:`, dbReport, dbErr);
        fails++;
      }

      // 13. Verify Audit Log Creation
      console.log('\n13. Testing Audit Log record creation...');
      const { data: auditLogs, error: auditErr } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', testReportId)
        .order('timestamp', { ascending: true });

      if (auditErr) throw auditErr;

      const actions = auditLogs.map(l => l.action);
      const hasCreate = actions.includes('CREATE');
      const hasEdit = actions.includes('EDIT');
      const hasSoftDelete = actions.includes('SOFT_DELETE');
      const hasRestore = actions.includes('RESTORE');

      if (hasCreate && hasEdit && hasSoftDelete && hasRestore) {
        console.log('  [PASS] Successfully verified all expected audit logs (CREATE, EDIT, SOFT_DELETE, RESTORE) exist.');
        passes++;
      } else {
        console.log(`  [FAIL] Missing expected audit logs. Found actions: ${actions.join(', ')}`);
        fails++;
      }
    }

    // 14. Verify Admin Permission Boundary (requireAdmin Middleware check)
    console.log('\n14. Testing Admin Permission Boundary (requireAdmin middleware Staff block)...');
    const reqStaff = { user: { role: 'staff' } };
    const resStaff = mockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    requireAdmin(reqStaff, resStaff, next);

    if (resStaff.statusCode === 403 && !resStaff.jsonData?.success && !nextCalled) {
      console.log('  [PASS] requireAdmin middleware successfully blocked staff role with 403 Forbidden.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected requireAdmin to block staff with 403. Status: ${resStaff.statusCode}, nextCalled: ${nextCalled}`);
      fails++;
    }

    // 15. Verify Controller-Level Access boundary (createProject Staff block)
    console.log('\n15. Testing controller-level createProject block for Staff/Project Manager role...');
    const reqCtrlCreate = {
      user: { role: 'staff', mobile_number: '+918276071523' },
      body: {
        work_order_no: 'TEST_WO_STAFF_FAIL',
        estimate_no: 'EST_FAIL',
        site_details: 'Site Fail',
        state: 'West Bengal',
        district: 'Alipurduar',
        zone: 'North Bengal',
        department: 'PWD'
      }
    };
    const resCtrlCreate = mockRes();
    await createProject(reqCtrlCreate, resCtrlCreate);

    if (resCtrlCreate.statusCode === 403 && !resCtrlCreate.jsonData?.success) {
      console.log('  [PASS] createProject controller successfully rejected staff role with 403 Forbidden.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected createProject controller to reject staff with 403. Status: ${resCtrlCreate.statusCode}`);
      fails++;
    }

    // 16. Verify Controller-Level Access boundary (updateProjectStatus Staff block)
    console.log('\n16. Testing controller-level updateProjectStatus block for Staff/Project Manager role...');
    const reqCtrlStatus = {
      user: { role: 'staff', mobile_number: '+918276071523' },
      params: { work_order_no: testWOUnderTest },
      body: { status: 'Closed' }
    };
    const resCtrlStatus = mockRes();
    await updateProjectStatus(reqCtrlStatus, resCtrlStatus);

    if (resCtrlStatus.statusCode === 403 && !resCtrlStatus.jsonData?.success) {
      console.log('  [PASS] updateProjectStatus controller successfully rejected staff role with 403 Forbidden.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected updateProjectStatus controller to reject staff with 403. Status: ${resCtrlStatus.statusCode}`);
      fails++;
    }

    // 17. Verify Complete Under Maintenance status gate (Creation & Edits Allowed)
    console.log(`\n17. Testing 'Complete Under Maintenance' status permission matrix...`);
    // A. Temporarily update status
    await supabase
      .from('projects_master')
      .update({ status: 'Complete Under Maintenance', edited_by: '+918276071523' })
      .eq('work_order_no', testWOUnderTest);

    // B. Attempt to create report under Complete Under Maintenance (Should succeed)
    const reqMaintCreate = {
      user: { mobile_number: '+918276071523' },
      body: { work_order_no: testWOUnderTest, amount: 20000, remarks: 'Maintenance report' }
    };
    const resMaintCreate = mockRes();
    await createReport(reqMaintCreate, resMaintCreate);

    let maintReportId = null;
    let maintCreatePassed = false;
    if (resMaintCreate.statusCode === 201 && resMaintCreate.jsonData?.success) {
      maintReportId = resMaintCreate.jsonData.report.fund_report_id;
      console.log('  [PASS] Successfully created fund report under Complete Under Maintenance status.');
      maintCreatePassed = true;
    } else {
      console.log(`  [FAIL] Failed to create report under Complete Under Maintenance. Status: ${resMaintCreate.statusCode}`);
    }

    // C. Attempt to edit report under Complete Under Maintenance (Should succeed)
    let maintEditPassed = false;
    if (maintReportId) {
      const reqMaintEdit = {
        params: { fund_report_id: maintReportId },
        user: { mobile_number: '+918276071523' },
        body: { amount: 25000, remarks: 'Maintenance report updated' }
      };
      const resMaintEdit = mockRes();
      await updateReport(reqMaintEdit, resMaintEdit);

      if (resMaintEdit.statusCode === 200 && resMaintEdit.jsonData?.success) {
        console.log('  [PASS] Successfully updated fund report under Complete Under Maintenance status.');
        maintEditPassed = true;
      } else {
        console.log(`  [FAIL] Failed to update report under Complete Under Maintenance. Status: ${resMaintEdit.statusCode}`);
      }

      // Cleanup maintenance report
      await supabase.from('fund_reports').delete().eq('fund_report_id', maintReportId);
    }

    if (maintCreatePassed && maintEditPassed) {
      passes++;
    } else {
      fails++;
    }

    // 18. Testing report creation with invalid work_order_no
    console.log('\n18. Testing report creation with invalid work_order_no...');
    const req18 = {
      user: { mobile_number: '+918276071523' },
      body: { work_order_no: 'NONEXISTENT_WO_XYZ', amount: 10000, remarks: 'Invalid' }
    };
    const res18 = mockRes();
    await createReport(req18, res18);

    if (res18.statusCode === 404 && !res18.jsonData?.success) {
      console.log('  [PASS] Correctly rejected report creation on nonexistent project with 404.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 404 for nonexistent project, got: ${res18.statusCode}`);
      fails++;
    }

    // 19. Testing retrieving nonexistent report ID
    console.log('\n19. Testing retrieving nonexistent report ID...');
    const req19 = { params: { fund_report_id: '00000000-0000-0000-0000-000000000000' } };
    const res19 = mockRes();
    await getReportById(req19, res19);

    if (res19.statusCode === 404 && !res19.jsonData?.success) {
      console.log('  [PASS] Correctly returned 404 for nonexistent report ID.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 404 for nonexistent report, got: ${res19.statusCode}`);
      fails++;
    }

  } catch (err) {
    console.log('Unexpected validation error:', err.message);
    fails++;
  } finally {
    // Programmatic Cleanup (Ensures zero seed data pollution even if scripts crash mid-run)
    console.log('\nCleaning up temporary test reports and projects...');
    try {
      await supabase.from('fund_reports').delete().in('work_order_no', [testWOUnderTest, testWOClosed]);
      await supabase.from('projects_master').delete().in('work_order_no', [testWOUnderTest, testWOClosed]);
      console.log('  [PASS] Temporary test artifacts deleted cleanly. Seed data remains unpolluted.');
      passes++;
    } catch (cleanupErr) {
      console.log(`  [FAIL] Failed to clean up test projects/reports: ${cleanupErr.message}`);
      fails++;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}/${passes + fails}`);
  console.log(`Failed: ${fails}/${passes + fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL PHASE 2 BACKEND TESTS PASSED! <<<');
  } else {
    console.log('\n>>> SOME TESTS FAILED. CHECK THE BACKEND LOGIC AND DB CONSTRAINTS. <<<');
  }
}

testPhase2();
