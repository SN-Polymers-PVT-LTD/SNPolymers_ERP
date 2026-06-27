'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  createBill,
  getBills,
  getBillById,
  getBillSummaryByWorkOrder
} = require('../../src/controllers/raFinalBill.controller');
const { uploadBillCopy } = require('../../src/controllers/raFinalBill.uploads.controller');

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

async function testMilestoneP6M2() {
  console.log('=== RUNNING MILESTONE P6-M2 CRUD & SUMMARY CONTROLLER TESTS ===\n');

  let passes = 0;
  let fails = 0;

  // Resolve an authorized user (ho, zo, or admin)
  const { data: users } = await supabase.from('authorised_users')
    .select('mobile_number, role')
    .in('role', ['ho', 'zo', 'admin'])
    .limit(1);
    
  if (!users || users.length === 0) {
    console.log('  [FAIL] No authorized user (ho, zo, admin) found in DB.');
    process.exit(1);
  }
  const hoUser = users[0];
  console.log(`Using authorized user for tests: ${hoUser.mobile_number} (${hoUser.role})`);
  
  // Find a work order that doesn't have any bills entered yet (since bills are immutable)
  const { data: projects } = await supabase.from('projects_master').select('work_order_no, status, work_order_value');
  const { data: bills } = await supabase.from('ra_final_bills').select('work_order_no');
  
  const billedWOs = new Set((bills || []).map(b => b.work_order_no));
  const freeProject = (projects || []).find(p => !billedWOs.has(p.work_order_no) && p.status !== 'Closed');

  if (!freeProject) {
    console.log('  [FAIL] Could not find any project without existing bills to run CRUD tests.');
    process.exit(1);
  }

  const activeWorkOrder = freeProject.work_order_no;
  const originalStatus = freeProject.status;

  console.log(`Using free project for tests: ${activeWorkOrder}`);

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testBillNo = `BILL_M2_TEST_${suffix}`;
  let createdBillId = null;
  let realUploadedPath = null;

  try {
    // Ensure project is Running (non-closed) for tests
    await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', activeWorkOrder);

    // 0. Pre-upload a real test file to get a valid URL
    console.log('Pre-uploading a real test PDF...');
    const reqUpload = {
      file: {
        fieldname: 'file',
        originalname: 'm2_test_invoice.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 mock pdf content for M2 test'),
        size: 35
      }
    };
    const resUpload = mockRes();
    await uploadBillCopy(reqUpload, resUpload);

    if (resUpload.statusCode === 200 && resUpload.jsonData.success) {
      realUploadedPath = resUpload.jsonData.bill_copy_url;
      console.log('  [INFO] Pre-upload successful, path:', realUploadedPath);
    } else {
      console.log('  [FAIL] Pre-upload failed, cannot run test suite. Status:', resUpload.statusCode, 'Data:', resUpload.jsonData);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // Test 1: POST / (Valid RA Bill 1 creation)
    // -------------------------------------------------------------
    console.log('\nTest 1: Creating valid RA Bill 1...');
    const reqCreate = {
      user: hoUser,
      body: {
        work_order_no: activeWorkOrder,
        payment_type: 'RA Bill 1',
        bill_date: '2026-06-27',
        bill_no: testBillNo,
        bill_amount_with_gst: 100000.00,
        earnest_money_deposit: 1000.00,
        security_deposit_amount: 2000.00,
        bill_copy_url: realUploadedPath,
        original_bill_filename: 'm2_test_invoice.pdf',
        remarks: 'API Test RA Bill 1'
      }
    };
    const resCreate = mockRes();
    await createBill(reqCreate, resCreate);

    if (resCreate.statusCode === 201 && resCreate.jsonData.success) {
      createdBillId = resCreate.jsonData.bill.bill_id;
      console.log('  [PASS] Successfully created RA Bill 1.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to create RA Bill 1. Status:', resCreate.statusCode, 'Data:', resCreate.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: POST / (Duplicate Payment Type prevention)
    // -------------------------------------------------------------
    console.log('\nTest 2: Creating duplicate RA Bill 1...');
    const reqDup = {
      user: hoUser,
      body: {
        ...reqCreate.body,
        bill_no: `${testBillNo}_dup`
      }
    };
    const resDup = mockRes();
    await createBill(reqDup, resDup);

    if (resDup.statusCode === 409 && resDup.jsonData.message.includes('already exists')) {
      console.log('  [PASS] Correctly rejected duplicate payment type.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate payment type check failed. Status:', resDup.statusCode, 'Data:', resDup.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: POST / (Sequential RA Bill N-1 check)
    // -------------------------------------------------------------
    console.log('\nTest 3: Creating RA Bill 3 without RA Bill 2...');
    const reqSeq = {
      user: hoUser,
      body: {
        ...reqCreate.body,
        payment_type: 'RA Bill 3',
        bill_no: `${testBillNo}_3`
      }
    };
    const resSeq = mockRes();
    await createBill(reqSeq, resSeq);

    if (resSeq.statusCode === 422 && resSeq.jsonData.message.includes('RA Bill 2 must be entered')) {
      console.log('  [PASS] Correctly blocked non-sequential RA Bill.');
      passes++;
    } else {
      console.log('  [FAIL] Non-sequential RA Bill check failed. Status:', resSeq.statusCode, 'Data:', resSeq.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: POST / (Closed work order check)
    // -------------------------------------------------------------
    console.log('\nTest 4: Creating bill for Closed work order...');
    await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', activeWorkOrder);

    const reqClosed = {
      user: hoUser,
      body: {
        ...reqCreate.body,
        payment_type: 'RA Bill 2',
        bill_no: `${testBillNo}_2`
      }
    };
    const resClosed = mockRes();
    await createBill(reqClosed, resClosed);

    // Restore to Running
    await supabase.from('projects_master').update({ status: 'Running' }).eq('work_order_no', activeWorkOrder);

    if (resClosed.statusCode === 403 && resClosed.jsonData.message.includes('Closed work orders')) {
      console.log('  [PASS] Correctly blocked bill creation for closed project.');
      passes++;
    } else {
      console.log('  [FAIL] Closed project check failed. Status:', resClosed.statusCode, 'Data:', resClosed.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: GET /summary/:work_order_no
    // -------------------------------------------------------------
    console.log('\nTest 5: Retrieving bill summary...');
    const reqSummary = {
      params: { work_order_no: activeWorkOrder }
    };
    const resSummary = mockRes();
    await getBillSummaryByWorkOrder(reqSummary, resSummary);

    if (resSummary.statusCode === 200 && resSummary.jsonData.success) {
      const summary = resSummary.jsonData;
      if (
        summary.next_ra_bill_number === 2 &&
        Number(summary.previous_bill_amount) === 100000.00 &&
        summary.dropdown_options.some(opt => opt.value === 'RA Bill 2' && opt.available)
      ) {
        console.log('  [PASS] Summary calculations and next bill options are correct.');
        passes++;
      } else {
        console.log('  [FAIL] Summary response incorrect:', summary);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve summary. Status:', resSummary.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: GET / (List pagination and filtering)
    // -------------------------------------------------------------
    console.log('\nTest 6: Retrieving all bills with filters...');
    const reqList = {
      query: { work_order_no: activeWorkOrder, page: 1, limit: 10 }
    };
    const resList = mockRes();
    await getBills(reqList, resList);

    if (resList.statusCode === 200 && resList.jsonData.success) {
      const list = resList.jsonData.bills;
      const count = resList.jsonData.pagination.total;
      const first = list[0];
      if (count === 1 && first.bill_id === createdBillId && first.created_by_name) {
        console.log('  [PASS] List, filters, and display name resolution are correct.');
        passes++;
      } else {
        console.log('  [FAIL] List verification failed. Count:', count, 'First:', first);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve bills list. Status:', resList.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: GET /:id (Get single record & Signed URL check)
    // -------------------------------------------------------------
    console.log('\nTest 7: Retrieving single bill by ID...');
    if (createdBillId) {
      const reqGet = {
        params: { id: createdBillId }
      };
      const resGet = mockRes();
      await getBillById(reqGet, resGet);

      if (resGet.statusCode === 200 && resGet.jsonData.success) {
        const bill = resGet.jsonData.bill;
        if (bill.created_by_name && bill.bill_copy_signed_url && bill.bill_copy_signed_url.startsWith('https://')) {
          console.log('  [PASS] Successfully retrieved bill details with resolved name and signed URL.');
          passes++;
        } else {
          console.log('  [FAIL] Detail verification failed. Signed URL:', bill.bill_copy_signed_url);
          fails++;
        }
      } else {
        console.log('  [FAIL] Failed to retrieve bill details. Status:', resGet.statusCode);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 7: no bill created.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error in M2 tests:', err);
    fails++;
  } finally {
    // Restore status
    await supabase.from('projects_master').update({ status: originalStatus }).eq('work_order_no', activeWorkOrder);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P6-M2 TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P6-M2 TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP6M2();
}

module.exports = { testMilestoneP6M2 };
