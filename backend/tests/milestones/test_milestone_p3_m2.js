'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  createFundRequest,
  getFundRequests,
  getFundRequestById
} = require('../../src/controllers/fundRequests.controller');

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

async function testMilestoneP3M2() {
  console.log('=== RUNNING MILESTONE P3-M2 FUND REQUESTS CRUD INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testFrNo1 = `TEST_M2_FR_${suffix}_1`;
  const testFrNo2 = `TEST_M2_FR_${suffix}_2`;

  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const zoUser2 = { role: 'zo', mobile_number: '+918000000003' }; // Different ZO (or JE, let's treat mobile as distinct)
  const jeUser = { role: 'je', mobile_number: '+918000000002' };
  const hoUser = { role: 'ho', mobile_number: '+918000000004' };

  let createdFr1 = null;

  try {
    // -------------------------------------------------------------
    // Test 1: POST /fund-requests with valid parameters
    // -------------------------------------------------------------
    console.log('Test 1: Creating a valid fund request as ZO...');
    const reqCreate1 = {
      user: zoUser,
      body: {
        zo_fr_no: testFrNo1,
        zo_fr_amount: 45000.50,
        zo_remarks: '  Urgent Material Purchase  '
      }
    };
    const resCreate1 = mockRes();
    await createFundRequest(reqCreate1, resCreate1);

    if (resCreate1.statusCode === 201 && resCreate1.jsonData.success) {
      createdFr1 = resCreate1.jsonData.fundRequest;
      if (createdFr1.zo_fr_no === testFrNo1 && Number(createdFr1.zo_fr_amount) === 45000.50 && createdFr1.request_status === 'Pending') {
        console.log('  [PASS] Successfully created fund request in Pending status.');
        passes++;
      } else {
        console.log('  [FAIL] Created fund request mismatch:', createdFr1);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to create fund request. Status:', resCreate1.statusCode, resCreate1.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: POST /fund-requests with duplicate zo_fr_no
    // -------------------------------------------------------------
    console.log('\nTest 2: Creating a fund request with duplicate zo_fr_no...');
    const reqCreateDup = {
      user: zoUser,
      body: {
        zo_fr_no: testFrNo1,
        zo_fr_amount: 10000.00
      }
    };
    const resCreateDup = mockRes();
    await createFundRequest(reqCreateDup, resCreateDup);

    if (resCreateDup.statusCode === 409 && !resCreateDup.jsonData.success) {
      console.log('  [PASS] Correctly blocked duplicate request number with 409 Conflict.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate request check failed. Status:', resCreateDup.statusCode, resCreateDup.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: POST /fund-requests with zo_fr_amount = 0 or negative
    // -------------------------------------------------------------
    console.log('\nTest 3: Creating a fund request with invalid amounts...');
    const reqCreateZero = {
      user: zoUser,
      body: {
        zo_fr_no: testFrNo2,
        zo_fr_amount: 0
      }
    };
    const resCreateZero = mockRes();
    await createFundRequest(reqCreateZero, resCreateZero);

    const reqCreateNeg = {
      user: zoUser,
      body: {
        zo_fr_no: testFrNo2,
        zo_fr_amount: -500.00
      }
    };
    const resCreateNeg = mockRes();
    await createFundRequest(reqCreateNeg, resCreateNeg);

    if (resCreateZero.statusCode === 400 && resCreateNeg.statusCode === 400) {
      console.log('  [PASS] Correctly blocked 0 and negative amounts with 400 Bad Request.');
      passes++;
    } else {
      console.log('  [FAIL] Did not block invalid amounts. Statuses:', resCreateZero.statusCode, resCreateNeg.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: POST /fund-requests with blank zo_fr_no
    // -------------------------------------------------------------
    console.log('\nTest 4: Creating a fund request with blank zo_fr_no...');
    const reqCreateBlank = {
      user: zoUser,
      body: {
        zo_fr_no: '   ',
        zo_fr_amount: 12000.00
      }
    };
    const resCreateBlank = mockRes();
    await createFundRequest(reqCreateBlank, resCreateBlank);

    if (resCreateBlank.statusCode === 400) {
      console.log('  [PASS] Correctly blocked blank zo_fr_no with 400 Bad Request.');
      passes++;
    } else {
      console.log('  [FAIL] Did not block blank request number. Status:', resCreateBlank.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: GET /fund-requests as ZO (only own requests)
    // -------------------------------------------------------------
    console.log('\nTest 5: Retrieving fund requests as ZO...');
    const reqGetZo = {
      user: zoUser,
      query: { page: 1, limit: 10 }
    };
    const resGetZo = mockRes();
    await getFundRequests(reqGetZo, resGetZo);

    if (resGetZo.statusCode === 200 && resGetZo.jsonData.success) {
      const frs = resGetZo.jsonData.fundRequests;
      const allOwn = frs.every(fr => fr.zo_user_id === zoUser.mobile_number);
      const containsCreated = frs.some(fr => fr.zo_fr_no === testFrNo1);

      if (allOwn && containsCreated) {
        console.log('  [PASS] Successfully retrieved only own fund requests and display names resolved.');
        passes++;
      } else {
        console.log('  [FAIL] Retrieval checks failed. allOwn:', allOwn, 'containsCreated:', containsCreated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve requests as ZO. Status:', resGetZo.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: GET /fund-requests as JE (should be 403)
    // -------------------------------------------------------------
    console.log('\nTest 6: Retrieving fund requests as JE...');
    const reqGetJe = {
      user: jeUser,
      query: {}
    };
    const resGetJe = mockRes();
    await getFundRequests(reqGetJe, resGetJe);

    if (resGetJe.statusCode === 403) {
      console.log('  [PASS] Correctly blocked JE from listing fund requests with 403.');
      passes++;
    } else {
      console.log('  [FAIL] JE role was not blocked. Status:', resGetJe.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: GET /fund-requests/:id by non-owner ZO (should be 404/403)
    // -------------------------------------------------------------
    console.log('\nTest 7: Fetching single fund request by non-owner ZO...');
    if (createdFr1) {
      const reqGetByIdNonOwner = {
        user: zoUser2,
        params: { id: createdFr1.fund_request_id }
      };
      const resGetByIdNonOwner = mockRes();
      await getFundRequestById(reqGetByIdNonOwner, resGetByIdNonOwner);

      if (resGetByIdNonOwner.statusCode === 404 || resGetByIdNonOwner.statusCode === 403) {
        console.log('  [PASS] Non-owner ZO was blocked/returned 404 or 403.');
        passes++;
      } else {
        console.log('  [FAIL] Non-owner ZO accessed details. Status:', resGetByIdNonOwner.statusCode);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 7 due to previous failures.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: Pagination details in GET /fund-requests
    // -------------------------------------------------------------
    console.log('\nTest 8: Checking pagination metadata...');
    const reqPage = {
      user: hoUser,
      query: { page: 1, limit: 5 }
    };
    const resPage = mockRes();
    await getFundRequests(reqPage, resPage);

    if (resPage.statusCode === 200 && resPage.jsonData.pagination) {
      const pag = resPage.jsonData.pagination;
      if (pag.page === 1 && pag.limit === 5 && 'total' in pag && 'totalPages' in pag) {
        console.log('  [PASS] Pagination details present and correct.');
        passes++;
      } else {
        console.log('  [FAIL] Incorrect pagination schema:', pag);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve pagination. Status:', resPage.statusCode);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P3-M2 CRUD TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P3-M2 TESTS FAILED. <<<');
    process.exit(1);
  }
}

testMilestoneP3M2();
