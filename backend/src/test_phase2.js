const { getProjects, getProjectByWorkOrder, createProject, updateProject, updateProjectStatus } = require('/home/zenoguy/Desktop/SNPolymers/backend/src/controllers/projects.controller');
const { getReports, getReportById, createReport, updateReport, deleteReport, restoreReport } = require('/home/zenoguy/Desktop/SNPolymers/backend/src/controllers/reports.controller');
const { supabase } = require('/home/zenoguy/Desktop/SNPolymers/backend/src/db/supabase');

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

  // Setup a test project and a closed project
  const testWOUnderTest = 'WB_APD_101'; // Running (from seeds)
  const testWOClosed = 'WB_BAN_102'; // Running (we will close it to test the gate)

  try {
    // Force set testWOClosed to Closed for test purposes
    console.log(`Setting ${testWOClosed} to 'Closed' for mutability gate testing...`);
    await supabase
      .from('projects_master')
      .update({ status: 'Closed', edited_by: '+918276071523' })
      .eq('work_order_no', testWOClosed);

    // 1. Test getProjects controller
    console.log('\n1. Testing getProjects controller...');
    const req1 = { user: { role: 'staff' } };
    const res1 = mockRes();
    await getProjects(req1, res1);

    if (res1.statusCode === 200 && res1.jsonData.success && res1.jsonData.projects.length >= 20) {
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
        if (report.projects_master && report.projects_master.estimate_no === 'APD_1' && report.projects_master.state === 'West Bengal') {
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

      // Now temporarily move the project under test to Closed to test update gate
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

      // Re-open project under test
      console.log(`\nRe-opening ${testWOUnderTest} to 'Running'...`);
      await supabase
        .from('projects_master')
        .update({ status: 'Running', edited_by: '+918276071523' })
        .eq('work_order_no', testWOUnderTest);

      // 9. Test Soft Delete: Delete report linked to Running project (Should succeed)
      console.log('9. Testing report soft-delete on Running project...');
      const req9 = {
        params: { fund_report_id: testReportId },
        user: { mobile_number: '+918276071523' }
      };
      const res9 = mockRes();
      await deleteReport(req9, res9);

      if (res9.statusCode === 200 && res9.jsonData.success && res9.jsonData.report.is_deleted === true) {
        console.log('  [PASS] Report soft-deleted successfully.');
        passes++;
      } else {
        console.log(`  [FAIL] Soft delete failed. Status: ${res9.statusCode}`);
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

      // Clean up by hard-deleting the test report from the DB (admin operation directly via client)
      console.log('\nCleaning up test report from database...');
      await supabase.from('fund_reports').delete().eq('fund_report_id', testReportId);
    }

    // Clean up project status
    console.log('Restoring test projects to default "Running" state...');
    await supabase
      .from('projects_master')
      .update({ status: 'Running', edited_by: '+918276071523' })
      .eq('work_order_no', testWOClosed);

  } catch (err) {
    console.log('Unexpected validation error:', err.message);
    fails++;
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
