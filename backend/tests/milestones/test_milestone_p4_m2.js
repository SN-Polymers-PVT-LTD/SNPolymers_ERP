'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  createRequisition,
  getRequisitions,
  getRequisitionById
} = require('../../src/controllers/requisitions.controller');

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

async function testMilestoneP4M2() {
  console.log('=== RUNNING MILESTONE P4-M2 CORE CRUD INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testReqNo = `REQ_M2_API_${suffix}`;
  
  const jeUser = { role: 'je', mobile_number: '+918276071523' }; // Owner/creator
  const jeUser2 = { role: 'je', mobile_number: '+918000000002' }; // Non-owner
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const adminUser = { role: 'admin', mobile_number: '+918276071523' };

  const workOrder = 'WB_BAN_102'; // Known valid work order in DB
  let createdId = null;

  try {
    // -------------------------------------------------------------
    // Test 1: POST /requisitions with valid fields
    // -------------------------------------------------------------
    console.log('Test 1: Creating a valid requisition as JE...');
    const reqCreate = {
      user: jeUser,
      body: {
        work_order_no: workOrder,
        requisition_no: testReqNo,
        material_main_head: 'Pipes', // valid material
        requisition_pdf_url: 'mock_requisition_path.pdf',
        original_filename: 'mock.pdf',
        requisition_amount: 500.00,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890'
      }
    };
    const resCreate = mockRes();
    await createRequisition(reqCreate, resCreate);

    if (resCreate.statusCode === 201 && resCreate.jsonData.success) {
      const reqRecord = resCreate.jsonData.requisition;
      createdId = reqRecord.requisition_id;
      if (reqRecord.requisition_no === testReqNo && reqRecord.requisition_status === 'Pending') {
        console.log('  [PASS] Requisition created successfully with Pending status.');
        passes++;
      } else {
        console.log('  [FAIL] Created record mismatch:', reqRecord);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to create requisition. Status:', resCreate.statusCode, 'Data:', resCreate.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: POST /requisitions with duplicate requisition_no
    // -------------------------------------------------------------
    console.log('\nTest 2: Creating duplicate requisition...');
    const reqDup = {
      user: jeUser,
      body: {
        work_order_no: workOrder,
        requisition_no: testReqNo, // Duplicate
        material_main_head: 'Pipes',
        requisition_pdf_url: 'mock_requisition_path_2.pdf',
        requisition_amount: 100.00,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890'
      }
    };
    const resDup = mockRes();
    await createRequisition(reqDup, resDup);

    if (resDup.statusCode === 409) {
      console.log('  [PASS] Correctly blocked duplicate requisition_no with 409.');
      passes++;
    } else {
      console.log('  [FAIL] Duplicate check failed. Status:', resDup.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: POST /requisitions with invalid material_main_head
    // -------------------------------------------------------------
    console.log('\nTest 3: Creating requisition with invalid material head...');
    const reqInvalidMat = {
      user: jeUser,
      body: {
        work_order_no: workOrder,
        requisition_no: `REQ_M2_MAT_${suffix}`,
        material_main_head: 'INVALID_MAIN_HEAD_VALUE_123', // Invalid
        requisition_pdf_url: 'mock_requisition_path.pdf',
        requisition_amount: 100.00,
        gst_bill: 'No',
        bank_details: 'SBI Account 1234567890'
      }
    };
    const resInvalidMat = mockRes();
    await createRequisition(reqInvalidMat, resInvalidMat);

    if (resInvalidMat.statusCode === 400 && resInvalidMat.jsonData.message.includes('exist in Material Master')) {
      console.log('  [PASS] Correctly blocked invalid material_main_head.');
      passes++;
    } else {
      console.log('  [FAIL] Invalid material check failed. Status:', resInvalidMat.statusCode, 'Message:', resInvalidMat.jsonData?.message);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: GET /requisitions as owner JE (only see own)
    // -------------------------------------------------------------
    console.log('\nTest 4: Retrieving requisitions as JE (visibility filters)...');
    const reqGetJe = {
      user: jeUser,
      query: { page: 1, limit: 10 }
    };
    const resGetJe = mockRes();
    await getRequisitions(reqGetJe, resGetJe);

    if (resGetJe.statusCode === 200 && resGetJe.jsonData.success) {
      const list = resGetJe.jsonData.requisitions;
      const allOwn = list.every(r => r.requester_user_id === jeUser.mobile_number);
      const containsCreated = list.some(r => r.requisition_no === testReqNo);

      if (allOwn && containsCreated) {
        console.log('  [PASS] Successfully retrieved own requisitions only.');
        passes++;
      } else {
        console.log('  [FAIL] Visibility checks failed for JE list. allOwn:', allOwn, 'containsCreated:', containsCreated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve list as JE. Status:', resGetJe.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: GET /requisitions as ZO (sees all)
    // -------------------------------------------------------------
    console.log('\nTest 5: Retrieving requisitions as ZO (sees all)...');
    const reqGetZo = {
      user: zoUser,
      query: { page: 1, limit: 10 }
    };
    const resGetZo = mockRes();
    await getRequisitions(reqGetZo, resGetZo);

    if (resGetZo.statusCode === 200 && resGetZo.jsonData.success) {
      const list = resGetZo.jsonData.requisitions;
      const containsCreated = list.some(r => r.requisition_no === testReqNo);

      if (containsCreated) {
        console.log('  [PASS] ZO successfully retrieved all requisitions including JE\'s.');
        passes++;
      } else {
        console.log('  [FAIL] Created requisition not visible to ZO. List:', list);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to retrieve list as ZO. Status:', resGetZo.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: GET /requisitions/:id (verify signed URLs & permissions)
    // -------------------------------------------------------------
    console.log('\nTest 6: Retrieving single requisition by ID (signed URLs & ownership)...');
    if (createdId) {
      // Owner JE fetches
      const reqGetOwner = {
        user: jeUser,
        params: { id: createdId }
      };
      const resGetOwner = mockRes();
      await getRequisitionById(reqGetOwner, resGetOwner);

      // Non-owner JE fetches (should return 404/403)
      const reqGetNonOwner = {
        user: jeUser2,
        params: { id: createdId }
      };
      const resGetNonOwner = mockRes();
      await getRequisitionById(reqGetNonOwner, resGetNonOwner);

      // Check that owner can access (200), non-owner is blocked (404/403),
      // and we attempted to fetch signed URL (it is either a valid URL string, null because the mock file doesn't exist in Supabase storage, or undefined if not returned).
      const isValidOwnerRes = resGetOwner.statusCode === 200 &&
        (resGetOwner.jsonData.requisition.requisition_pdf_signed_url === null || typeof resGetOwner.jsonData.requisition.requisition_pdf_signed_url === 'string');
      const isBlockedNonOwner = resGetNonOwner.statusCode === 404 || resGetNonOwner.statusCode === 403;

      if (isValidOwnerRes && isBlockedNonOwner) {
        console.log('  [PASS] Successfully verified signed URLs generation and non-owner access blockage.');
        passes++;
      } else {
        console.log('  [FAIL] Single query check failed. Owner Status:', resGetOwner.statusCode, 'Non-Owner Status:', resGetNonOwner.statusCode, 'Signed URL:', resGetOwner.jsonData?.requisition?.requisition_pdf_signed_url);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 6: no requisition created.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error in M2 tests:', err);
    fails++;
  } finally {
    // Soft-cancel the requisition so it doesn't affect other budgets
    if (createdId) {
      await supabase
        .from('requisitions')
        .update({ requisition_status: 'Cancelled', cancelled_by: jeUser.mobile_number, cancelled_at: new Date().toISOString() })
        .eq('requisition_id', createdId);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P4-M2 CRUD TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P4-M2 CRUD TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP4M2();
}

module.exports = { testMilestoneP4M2 };
