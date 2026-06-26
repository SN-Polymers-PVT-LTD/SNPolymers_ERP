'use strict';

const { supabase } = require('../../src/db/supabase');
const { getEstimates } = require('../../src/controllers/estimates.core.controller');
const { createReport, updateReport } = require('../../src/controllers/reports.controller');
const { addUser, updateUser, removeUser } = require('../../src/controllers/admin.controller');
const { createSession } = require('../../src/services/session.service');
const verifyJwt = require('../../src/middleware/verifyJwt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper to create mock res object
function mockRes() {
  return {
    statusCode: 200,
    jsonData: null,
    clearedCookies: [],
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    },
    clearCookie: function (name) {
      this.clearedCookies.push(name);
    }
  };
}

async function testMilestoneP4M5() {
  console.log('=== RUNNING MILESTONE P4-M5 CODE QUALITY & SECURITY INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);

  try {
    // -------------------------------------------------------------
    // Test 1: CQ-1 / CQ-6 verification (Role limits)
    // -------------------------------------------------------------
    console.log('Test 1: Verifying legitMobiles is absent and global=true is blocked for JE...');
    
    // Check that legitMobiles is absent from source code
    const coreControllerContent = fs.readFileSync(
      path.join(__dirname, '../../src/controllers/estimates.core.controller.js'),
      'utf8'
    );
    const hasLegitMobiles = coreControllerContent.includes('legitMobiles');
    
    // Call getEstimates as JE with global=true and verify it doesn't leak other JEs' estimates
    const reqGet = {
      user: { role: 'je', mobile_number: '+918276071523' },
      query: { global: 'true', page: 1, limit: 5 }
    };
    const resGet = mockRes();
    await getEstimates(reqGet, resGet);

    const estimatesList = resGet.jsonData?.estimates || [];
    const allOwn = estimatesList.every(e => e.created_by === '+918276071523');

    if (!hasLegitMobiles && allOwn) {
      console.log('  [PASS] legitMobiles absent and global=true restricted.');
      passes++;
    } else {
      console.log('  [FAIL] Whitelist or global bypass check failed. hasLegitMobiles:', hasLegitMobiles, 'allOwn:', allOwn);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: CQ-3 verification (JWT_SECRET Prod guard)
    // -------------------------------------------------------------
    console.log('\nTest 2: Verifying production JWT_SECRET check...');
    try {
      execSync('NODE_ENV=production JWT_SECRET= node -e "require(\'../../src/services/session.service\')"', {
        cwd: __dirname,
        stdio: 'pipe'
      });
      console.log('  [FAIL] Production startup did not throw fatal error without JWT_SECRET.');
      fails++;
    } catch (e) {
      const errorMsg = e.stderr?.toString() || '';
      if (errorMsg.includes('JWT_SECRET must be set in production')) {
        console.log('  [PASS] Production startup threw fatal error successfully.');
        passes++;
      } else {
        console.log('  [FAIL] Production startup threw incorrect error:', errorMsg);
        fails++;
      }
    }

    // -------------------------------------------------------------
    // Test 3: CQ-5 verification (Reports numeric checks)
    // -------------------------------------------------------------
    console.log('\nTest 3: Testing report amount finite numeric validation...');
    const reports = [
      { work_order_no: 'WB_BAN_102', amount: 'abc' },
      { work_order_no: 'WB_BAN_102', amount: Infinity },
      { work_order_no: 'WB_BAN_102', amount: -10.5 }
    ];

    let allReportsBlocked = true;
    for (const body of reports) {
      const reqCreate = { body };
      const resCreate = mockRes();
      await createReport(reqCreate, resCreate);

      const reqUpdate = { params: { fund_report_id: 'dummy' }, body };
      const resUpdate = mockRes();
      await updateReport(reqUpdate, resUpdate);

      if (resCreate.statusCode !== 400 || resUpdate.statusCode !== 400) {
        allReportsBlocked = false;
        console.log('  [FAIL] Failed to block invalid report amount:', body.amount);
      }
    }

    if (allReportsBlocked) {
      console.log('  [PASS] Invalid report amounts (strings, Infinity, negative) successfully blocked with 400.');
      passes++;
    } else {
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: CQ-7 verification (Admin role validation)
    // -------------------------------------------------------------
    console.log('\nTest 4: Verifying user role validation in admin endpoints...');
    // Create user with invalid role
    const reqAdd = {
      body: {
        mobileNumber: '+919999999999',
        displayName: 'Test Role User',
        role: 'superuser' // Invalid
      }
    };
    const resAdd = mockRes();
    await addUser(reqAdd, resAdd);

    // Update user with invalid role
    const reqUpd = {
      params: { id: 'dummy' },
      body: { role: 'root' } // Invalid
    };
    const resUpd = mockRes();
    await updateUser(reqUpd, resUpd);

    if (resAdd.statusCode === 400 && resUpd.statusCode === 400) {
      console.log('  [PASS] Invalid roles (superuser, root) correctly rejected with 400.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to reject invalid roles. Add Status:', resAdd.statusCode, 'Update Status:', resUpd.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: CQ-9 verification (OTP Optimistic locking concurrent updates)
    // -------------------------------------------------------------
    console.log('\nTest 5: Verifying concurrent OTP attempts optimistic lock (CQ-9)...');
    
    // Create a mock OTP record in DB
    const { data: otpRecord, error: otpErr } = await supabase
      .from('otp_requests')
      .insert([{
        mobile_number: '+919999999999',
        otp_hash: '$2b$04$dummyotpverifyhash',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        attempts: 0
      }])
      .select()
      .single();

    if (!otpErr && otpRecord) {
      // Fire two concurrent updates with optimistic lock constraint
      const p1 = supabase
        .from('otp_requests')
        .update({ attempts: otpRecord.attempts + 1 })
        .eq('id', otpRecord.id)
        .eq('attempts', otpRecord.attempts)
        .select();

      const p2 = supabase
        .from('otp_requests')
        .update({ attempts: otpRecord.attempts + 1 })
        .eq('id', otpRecord.id)
        .eq('attempts', otpRecord.attempts)
        .select();

      const [res1, res2] = await Promise.all([p1, p2]);
      
      const success1 = res1.data && res1.data.length === 1;
      const success2 = res2.data && res2.data.length === 1;

      // Clean up the dummy OTP record
      await supabase.from('otp_requests').delete().eq('id', otpRecord.id);

      // Verify that exactly one update call succeeded and the other was blocked
      if ((success1 && !success2) || (!success1 && success2)) {
        console.log('  [PASS] Concurrent updates correctly serialised via optimistic lock.');
        passes++;
      } else {
        console.log('  [FAIL] Concurrent update mismatch. success1:', success1, 'success2:', success2);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 5: failed to create mock OTP. Error:', otpErr);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: CQ-12 verification (NODE_ENV aware logging helper)
    // -------------------------------------------------------------
    console.log('\nTest 6: Checking file catch blocks for logError utility usage...');
    const reportsControllerContent = fs.readFileSync(
      path.join(__dirname, '../../src/controllers/reports.controller.js'),
      'utf8'
    );
    const hasLogErrorUtility = reportsControllerContent.includes("logError('");

    if (hasLogErrorUtility) {
      console.log('  [PASS] Catch blocks are refactored to use logError utility.');
      passes++;
    } else {
      console.log('  [FAIL] catch blocks are not using logError utility.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: SEC-3 verification (User-agent truncation)
    // -------------------------------------------------------------
    console.log('\nTest 7: Verifying User-Agent string truncation to 500 characters...');
    const longUserAgent = 'Mozilla/5.0 '.repeat(50); // ~600 chars
    
    // Fetch a valid user ID from authorised_users
    const { data: realUser } = await supabase
      .from('authorised_users')
      .select('id')
      .eq('mobile_number', '+918276071523')
      .single();
    
    if (realUser) {
      const mockSessionInput = {
        userId: realUser.id,
        jti: 'session_ua_test_uuid',
        ipAddress: '127.0.0.1',
        userAgent: longUserAgent
      };

      try {
        const sessionRecord = await createSession(mockSessionInput);
        const isTruncated = sessionRecord.user_agent.length <= 500;
        
        // Cleanup session
        await supabase.from('sessions').delete().eq('id', sessionRecord.id);

        if (isTruncated) {
          console.log('  [PASS] User-Agent successfully truncated to: ' + sessionRecord.user_agent.length + ' chars.');
          passes++;
        } else {
          console.log('  [FAIL] User-Agent was not truncated. Length: ' + sessionRecord.user_agent.length);
          fails++;
        }
      } catch (e) {
        console.log('  [SKIP] Skipping Test 7: user session insert failed. Error:', e.message);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 7: no valid user found in whitelisted seed.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: SEC-4 verification (TokenExpiredError cookie clearing)
    // -------------------------------------------------------------
    console.log('\nTest 8: Verifying cookie clean-up on TokenExpiredError...');
    const actualSecret = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';
    const expiredToken = jwt.sign(
      { user_id: 'dummy', mobile_number: '+910000000000', role: 'je' },
      actualSecret,
      { expiresIn: '-1s' }
    );

    const req = {
      cookies: { accessToken: expiredToken }
    };
    const res = mockRes();
    
    await verifyJwt(req, res, () => {});

    const isExpiredError = res.statusCode === 401 && res.jsonData?.code === 'ACCESS_TOKEN_EXPIRED';
    const isCookieCleared = res.clearedCookies.includes('accessToken');

    if (isExpiredError && isCookieCleared) {
      console.log('  [PASS] Expired token returned 401 ACCESS_TOKEN_EXPIRED and cleared accessToken cookie.');
      passes++;
    } else {
      console.log('  [FAIL] Cookie clean-up check failed. Status:', res.statusCode, 'Cleared Cookies:', res.clearedCookies);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9: SEC-5 verification (Whitelist deletion FK pre-check)
    // -------------------------------------------------------------
    console.log('\nTest 9: Verifying whitelist deletion blocks if user has active requisitions...');
    
    const mockMobile = `+919999${suffix}`;
    // Insert mock whitelisted user
    const { data: mockUserRecord, error: userError } = await supabase
      .from('authorised_users')
      .insert([{
        mobile_number: mockMobile,
        display_name: 'Test Whitelist Del',
        role: 'je',
        is_active: true
      }])
      .select()
      .maybeSingle();

    if (userError) {
      console.log('  [FAIL] Supabase user insert error:', userError);
    }

    if (mockUserRecord) {
      // Create a mock pending requisition associated with this user
      const { data: reqRecord } = await supabase
        .from('requisitions')
        .insert([{
          requester_user_id: mockMobile,
          work_order_no: 'WB_BAN_102',
          estimate_no: 'BAN_2',
          estimate_amount: 1000.00,
          state: 'West Bengal',
          district: 'Bankura',
          area_code: 'South Bengal',
          department: 'PWD',
          site_details: 'Mock site details',
          requisition_no: `REQ_M5_DEL_${suffix}`,
          material_main_head: 'Pipes',
          requisition_pdf_url: 'mock_path.pdf',
          requisition_amount: 100.00,
          gst_bill: 'No',
          bank_details: 'SBI Account 1234567890',
          requisition_status: 'Pending',
          created_by: mockMobile
        }])
        .select()
        .single();

      if (reqRecord) {
        // Attempt removeUser
        const reqRemove = { params: { id: mockUserRecord.id } };
        const resRemove = mockRes();
        await removeUser(reqRemove, resRemove);

        // Cleanup
        await supabase.from('requisitions').delete().eq('requisition_id', reqRecord.requisition_id);
        await supabase.from('authorised_users').delete().eq('id', mockUserRecord.id);

        if (resRemove.statusCode === 409 && resRemove.jsonData.message.includes('pending requisition')) {
          console.log('  [PASS] Whitelist deletion successfully blocked with 409 Conflict.');
          passes++;
        } else {
          console.log('  [FAIL] Whitelist deletion was not blocked. Status:', resRemove.statusCode, 'Data:', resRemove.jsonData);
          fails++;
        }
      } else {
        await supabase.from('authorised_users').delete().eq('id', mockUserRecord.id);
        console.log('  [SKIP] Skipping Test 9: failed to create mock requisition.');
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 9: failed to create mock user.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error in M5 tests:', err);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P4-M5 CODE QUALITY & SECURITY TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P4-M5 CODE QUALITY & SECURITY TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP4M5();
}

module.exports = { testMilestoneP4M5 };
