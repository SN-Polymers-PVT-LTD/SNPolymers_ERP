'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  createFundRequest,
  actOnFundRequest,
  cancelFundRequest
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

async function testMilestoneP3M3() {
  console.log('=== RUNNING MILESTONE P3-M3 FUND REQUESTS WORKFLOW INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const zoUser = { role: 'zo', mobile_number: '+918000000001' };
  const zoUser2 = { role: 'zo', mobile_number: '+918000000003' };
  const hoUser = { role: 'ho', mobile_number: '+918000000004' };

  try {
    // Helper to create a Pending request for workflow tests
    async function createTestRequest(amount = 50000.00) {
      const uniqueNo = `TEST_M3_FR_${Math.floor(100000 + Math.random() * 900000)}`;
      const req = {
        user: zoUser,
        body: {
          zo_fr_no: uniqueNo,
          zo_fr_amount: amount,
          zo_remarks: 'Workflow test'
        }
      };
      const res = mockRes();
      await createFundRequest(req, res);
      if (res.statusCode !== 201) {
        throw new Error(`Failed to create test request setup: ${JSON.stringify(res.jsonData)}`);
      }
      return res.jsonData.fundRequest;
    }

    // -------------------------------------------------------------
    // Test 1: HO approves fund request with valid params
    // -------------------------------------------------------------
    console.log('Test 1: HO approving Pending fund request...');
    const fr1 = await createTestRequest(25000.00);
    const reqApprove = {
      params: { id: fr1.fund_request_id },
      user: hoUser,
      body: {
        action: 'Approve',
        approve_ho_amount: 20000.00,
        transfer_from_account: 'CC',
        ho_remarks: 'Approved CC 20k'
      }
    };
    const resApprove = mockRes();
    await actOnFundRequest(reqApprove, resApprove);

    if (resApprove.statusCode === 200 && resApprove.jsonData.success) {
      const updated = resApprove.jsonData.fundRequest;
      if (updated.request_status === 'Approved' && Number(updated.approve_ho_amount) === 20000.00 && updated.transfer_from_account === 'CC') {
        console.log('  [PASS] Fund request approved successfully.');
        passes++;
      } else {
        console.log('  [FAIL] Approved values mismatch:', updated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to approve request. Status:', resApprove.statusCode, resApprove.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: HO holds fund request
    // -------------------------------------------------------------
    console.log('\nTest 2: HO placing Pending fund request on Hold...');
    const fr2 = await createTestRequest(15000.00);
    const reqHold = {
      params: { id: fr2.fund_request_id },
      user: hoUser,
      body: {
        action: 'Hold',
        ho_remarks: 'Need further details'
      }
    };
    const resHold = mockRes();
    await actOnFundRequest(reqHold, resHold);

    if (resHold.statusCode === 200 && resHold.jsonData.success) {
      const updated = resHold.jsonData.fundRequest;
      if (updated.request_status === 'Hold' && updated.approve_ho_amount === null && updated.transfer_from_account === null) {
        console.log('  [PASS] Fund request placed on hold successfully.');
        passes++;
      } else {
        console.log('  [FAIL] Hold values mismatch:', updated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to place request on hold. Status:', resHold.statusCode, resHold.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: HO approves with amount > requested amount
    // -------------------------------------------------------------
    console.log('\nTest 3: HO approving with amount exceeding requested...');
    const fr3 = await createTestRequest(10000.00);
    const reqExceed = {
      params: { id: fr3.fund_request_id },
      user: hoUser,
      body: {
        action: 'Approve',
        approve_ho_amount: 12000.00,
        transfer_from_account: 'OD'
      }
    };
    const resExceed = mockRes();
    await actOnFundRequest(reqExceed, resExceed);

    if (resExceed.statusCode === 400 && !resExceed.jsonData.success) {
      console.log('  [PASS] Blocked excess approval amount with 400 Bad Request.');
      passes++;
    } else {
      console.log('  [FAIL] Excess approval amount was not blocked. Status:', resExceed.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: HO approves with missing transfer_from_account
    // -------------------------------------------------------------
    console.log('\nTest 4: HO approving with missing transfer account...');
    const fr4 = await createTestRequest(10000.00);
    const reqNoAccount = {
      params: { id: fr4.fund_request_id },
      user: hoUser,
      body: {
        action: 'Approve',
        approve_ho_amount: 5000.00
      }
    };
    const resNoAccount = mockRes();
    await actOnFundRequest(reqNoAccount, resNoAccount);

    if (resNoAccount.statusCode === 400 && !resNoAccount.jsonData.success) {
      console.log('  [PASS] Blocked approval without transfer account with 400 Bad Request.');
      passes++;
    } else {
      console.log('  [FAIL] Missing transfer account not blocked. Status:', resNoAccount.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Action on non-Pending request
    // -------------------------------------------------------------
    console.log('\nTest 5: Taking action on an already approved request...');
    const fr5 = await createTestRequest(10000.00);
    // first approve
    await actOnFundRequest({
      params: { id: fr5.fund_request_id },
      user: hoUser,
      body: { action: 'Approve', approve_ho_amount: 10000.00, transfer_from_account: 'CR' }
    }, mockRes());

    // try action again
    const reqRepeat = {
      params: { id: fr5.fund_request_id },
      user: hoUser,
      body: { action: 'Hold' }
    };
    const resRepeat = mockRes();
    await actOnFundRequest(reqRepeat, resRepeat);

    if (resRepeat.statusCode === 403 && !resRepeat.jsonData.success) {
      console.log('  [PASS] Action blocked on non-Pending request with 403 Forbidden.');
      passes++;
    } else {
      console.log('  [FAIL] Action was not blocked. Status:', resRepeat.statusCode, resRepeat.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: ZO cancels own Pending request
    // -------------------------------------------------------------
    console.log('\nTest 6: ZO cancelling own Pending request...');
    const fr6 = await createTestRequest(10000.00);
    const reqCancel = {
      params: { id: fr6.fund_request_id },
      user: zoUser
    };
    const resCancel = mockRes();
    await cancelFundRequest(reqCancel, resCancel);

    if (resCancel.statusCode === 200 && resCancel.jsonData.success) {
      const updated = resCancel.jsonData.fundRequest;
      if (updated.request_status === 'Cancelled' && updated.cancelled_by === zoUser.mobile_number) {
        console.log('  [PASS] Fund request cancelled successfully.');
        passes++;
      } else {
        console.log('  [FAIL] Cancel values mismatch:', updated);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to cancel request. Status:', resCancel.statusCode, resCancel.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: ZO cancels Approved request
    // -------------------------------------------------------------
    console.log('\nTest 7: ZO cancelling an already Approved request...');
    const fr7 = await createTestRequest(10000.00);
    await actOnFundRequest({
      params: { id: fr7.fund_request_id },
      user: hoUser,
      body: { action: 'Approve', approve_ho_amount: 10000.00, transfer_from_account: 'CR' }
    }, mockRes());

    const reqCancelApproved = {
      params: { id: fr7.fund_request_id },
      user: zoUser
    };
    const resCancelApproved = mockRes();
    await cancelFundRequest(reqCancelApproved, resCancelApproved);

    if (resCancelApproved.statusCode === 403 && !resCancelApproved.jsonData.success) {
      console.log('  [PASS] Blocked cancelling of Approved request with 403.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed cancelling Approved request. Status:', resCancelApproved.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: ZO cancels another ZO's request
    // -------------------------------------------------------------
    console.log('\nTest 8: ZO cancelling request belonging to another ZO...');
    const fr8 = await createTestRequest(10000.00);
    const reqCancelOther = {
      params: { id: fr8.fund_request_id },
      user: zoUser2 // Different ZO user
    };
    const resCancelOther = mockRes();
    await cancelFundRequest(reqCancelOther, resCancelOther);

    if (resCancelOther.statusCode === 403 && !resCancelOther.jsonData.success) {
      console.log('  [PASS] Blocked cancellation of other ZO request with 403.');
      passes++;
    } else {
      console.log('  [FAIL] Allowed cancellation of other ZO request. Status:', resCancelOther.statusCode);
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
    console.log('\n>>> ALL MILESTONE P3-M3 WORKFLOW TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P3-M3 TESTS FAILED. <<<');
    process.exit(1);
  }
}

testMilestoneP3M3();
