'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  createRequisition,
  actOnRequisition,
  cancelRequisition
} = require('../../src/controllers/requisitions.controller');

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

async function testMilestoneP4M3() {
  console.log('=== RUNNING MILESTONE P4-M3 WORKFLOW INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  
  const jeUser = { role: 'je', mobile_number: '+918276071523' };
  const jeUser2 = { role: 'je', mobile_number: '+918000000002' };
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const adminUser = { role: 'admin', mobile_number: '+918276071523' };

  const workOrder = 'WB_BAN_102';
  let createdId = null;

  try {
    // Helper to create a fresh pending requisition for testing state changes
    async function createTestReq(reqNo, amount = 1000.00) {
      const req = {
        user: jeUser,
        body: {
          work_order_no: workOrder,
          requisition_no: reqNo,
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_requisition_path.pdf',
          original_filename: 'mock.pdf',
          requisition_amount: amount,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890'
        }
      };
      const res = mockRes();
      await createRequisition(req, res);
      return res.jsonData.requisition?.requisition_id || null;
    }

    // -------------------------------------------------------------
    // Test 1: Approve workflow (Approve, valid amount & remarks)
    // -------------------------------------------------------------
    console.log('Test 1: Approving Pending requisition...');
    createdId = await createTestReq(`REQ_M3_WF1_${suffix}`, 5000.00);

    const reqApprove = {
      user: zoUser,
      params: { id: createdId },
      body: {
        action: 'Approve',
        approved_amount: 4000.00,
        remarks_approved_authority: 'Approved partial amount'
      }
    };
    const resApprove = mockRes();
    await actOnRequisition(reqApprove, resApprove);

    if (resApprove.statusCode === 200 && resApprove.jsonData.success) {
      const updated = resApprove.jsonData.requisition;
      if (updated.requisition_status === 'Approved' && Number(updated.approved_amount) === 4000.00 && Number(updated.approved_balance_amount) === 1000.00) {
        console.log('  [PASS] Requisition approved successfully with correct balance calculations.');
        passes++;
      } else {
        console.log('  [FAIL] Approved values mismatch:', updated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to approve. Status:', resApprove.statusCode, 'Data:', resApprove.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Hold workflow (Hold, valid remarks)
    // -------------------------------------------------------------
    console.log('\nTest 2: Placing Pending requisition on Hold...');
    const holdId = await createTestReq(`REQ_M3_WF2_${suffix}`, 2000.00);

    const reqHold = {
      user: zoUser,
      params: { id: holdId },
      body: {
        action: 'Hold',
        remarks_approved_authority: 'Holding for document review'
      }
    };
    const resHold = mockRes();
    await actOnRequisition(reqHold, resHold);

    if (resHold.statusCode === 200 && resHold.jsonData.success) {
      const updated = resHold.jsonData.requisition;
      if (updated.requisition_status === 'Hold' && updated.approved_amount === null && updated.remarks_approved_authority === 'Holding for document review') {
        console.log('  [PASS] Requisition placed on Hold successfully with remarks.');
        passes++;
      } else {
        console.log('  [FAIL] Hold values mismatch:', updated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to place on hold. Status:', resHold.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Hold workflow reject if approved_amount is passed
    // -------------------------------------------------------------
    console.log('\nTest 3: Hold action fails if approved_amount is supplied...');
    const rejectHoldId = await createTestReq(`REQ_M3_WF3_${suffix}`, 2000.00);

    const reqRejectHold = {
      user: zoUser,
      params: { id: rejectHoldId },
      body: {
        action: 'Hold',
        approved_amount: 1000.00, // Invalid when action is Hold
        remarks_approved_authority: 'Holding with amount'
      }
    };
    const resRejectHold = mockRes();
    await actOnRequisition(reqRejectHold, resRejectHold);

    if (resRejectHold.statusCode === 400 && resRejectHold.jsonData.message.includes('must not be supplied')) {
      console.log('  [PASS] Correctly blocked passing approved_amount during Hold action.');
      passes++;
    } else {
      console.log('  [FAIL] Did not block passing approved_amount on Hold. Status:', resRejectHold.statusCode, 'Data:', resRejectHold.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Approve workflow fail if approved_amount > requisition_amount
    // -------------------------------------------------------------
    console.log('\nTest 4: Approve action fails if approved_amount exceeds request...');
    const limitId = await createTestReq(`REQ_M3_WF4_${suffix}`, 1000.00);

    const reqLimit = {
      user: zoUser,
      params: { id: limitId },
      body: {
        action: 'Approve',
        approved_amount: 1500.00, // Exceeds 1000.00
        remarks_approved_authority: 'Exceeding budget test'
      }
    };
    const resLimit = mockRes();
    await actOnRequisition(reqLimit, resLimit);

    if (resLimit.statusCode === 400 && resLimit.jsonData.message.includes('exceed requisition amount')) {
      console.log('  [PASS] Correctly blocked exceeding approved amount.');
      passes++;
    } else {
      console.log('  [FAIL] Exceeding check failed. Status:', resLimit.statusCode, 'Data:', resLimit.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Act on non-Pending requisition
    // -------------------------------------------------------------
    console.log('\nTest 5: Act on non-Pending requisition...');
    const reqNonPending = {
      user: zoUser,
      params: { id: createdId }, // already Approved
      body: {
        action: 'Hold',
        remarks_approved_authority: 'Try on non-pending'
      }
    };
    const resNonPending = mockRes();
    await actOnRequisition(reqNonPending, resNonPending);

    if (resNonPending.statusCode === 403) {
      console.log('  [PASS] Blocked workflow action on non-Pending requisition.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed workflow action on non-Pending. Status:', resNonPending.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: Cancel Pending requisition by owner JE
    // -------------------------------------------------------------
    console.log('\nTest 6: Cancelling Pending requisition as owner JE...');
    const cancelId1 = await createTestReq(`REQ_M3_WF6_${suffix}`, 2000.00);

    const reqCancel1 = {
      user: jeUser,
      params: { id: cancelId1 }
    };
    const resCancel1 = mockRes();
    await cancelRequisition(reqCancel1, resCancel1);

    if (resCancel1.statusCode === 200 && resCancel1.jsonData.success && resCancel1.jsonData.requisition.requisition_status === 'Cancelled') {
      console.log('  [PASS] Owner JE successfully cancelled Pending requisition.');
      passes++;
    } else {
      console.log('  [FAIL] Owner JE cancel failed. Status:', resCancel1.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Cancel Pending requisition by Admin (super-user check)
    // -------------------------------------------------------------
    console.log('\nTest 7: Cancelling Pending requisition as Admin (bypass)...');
    const cancelId2 = await createTestReq(`REQ_M3_WF7_${suffix}`, 2000.00);

    const reqCancel2 = {
      user: adminUser,
      params: { id: cancelId2 }
    };
    const resCancel2 = mockRes();
    await cancelRequisition(reqCancel2, resCancel2);

    if (resCancel2.statusCode === 200 && resCancel2.jsonData.success && resCancel2.jsonData.requisition.requisition_status === 'Cancelled') {
      console.log('  [PASS] Admin successfully bypassed ownership to cancel Pending requisition.');
      passes++;
    } else {
      console.log('  [FAIL] Admin cancel bypass failed. Status:', resCancel2.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: Cancel Pending requisition by non-owner JE
    // -------------------------------------------------------------
    console.log('\nTest 8: Block cancel by non-owner JE...');
    const cancelId3 = await createTestReq(`REQ_M3_WF8_${suffix}`, 2000.00);

    const reqCancel3 = {
      user: jeUser2, // non-owner
      params: { id: cancelId3 }
    };
    const resCancel3 = mockRes();
    await cancelRequisition(reqCancel3, resCancel3);

    if (resCancel3.statusCode === 403) {
      console.log('  [PASS] Blocked non-owner JE from cancelling.');
      passes++;
    } else {
      console.log('  [FAIL] Non-owner JE was able to cancel. Status:', resCancel3.statusCode);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error in workflow tests:', err);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P4-M3 WORKFLOW TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P4-M3 WORKFLOW TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP4M3();
}

module.exports = { testMilestoneP4M3 };
