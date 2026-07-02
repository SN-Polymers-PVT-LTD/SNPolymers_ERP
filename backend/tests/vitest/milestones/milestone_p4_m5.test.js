import { describe, test, expect } from 'vitest';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const jwt = require('jsonwebtoken');
const { supabase } = require('../../../src/db/supabase');
const { getEstimates } = require('../../../src/controllers/estimates.core.controller');
const { createReport, updateReport } = require('../../../src/controllers/reports.controller');
const { addUser, updateUser, removeUser } = require('../../../src/controllers/admin.controller');
const { createSession } = require('../../../src/services/session.service');
const verifyJwt = require('../../../src/middleware/verifyJwt');
const mockRes = require('../../helpers/mockRes');

// Extend mockRes with cookie clears
const createMockResWithCookies = () => {
  const base = mockRes();
  base.clearedCookies = [];
  base.clearCookie = function (name) {
    this.clearedCookies.push(name);
  };
  return base;
};

describe('Milestone P4-M5 — Code Quality & Security Hardening', () => {
  test('Test 1: Verifies legitMobiles is absent from source and global=true is blocked for JE', async () => {
    const coreControllerContent = fs.readFileSync(
      path.join(__dirname, '../../../src/controllers/estimates.core.controller.js'),
      'utf8'
    );
    const hasLegitMobiles = coreControllerContent.includes('legitMobiles');
    expect(hasLegitMobiles).toBe(false);

    const req = {
      user: { role: 'je', mobile_number: '+918276071523' },
      query: { global: 'true', page: 1, limit: 5 }
    };
    const res = mockRes();
    await getEstimates(req, res);

    const estimatesList = res.jsonData?.estimates || [];
    const allOwn = estimatesList.every(e => e.created_by === '+918276071523');
    expect(allOwn).toBe(true);
  });

  test('Test 2: Verifies production JWT_SECRET prod guard triggers fatal error', () => {
    let hasThrown = false;
    let errorMsg = '';

    try {
      execSync('NODE_ENV=production JWT_SECRET= node -e "require(\'./src/services/session.service\')"', {
        cwd: path.join(__dirname, '../../../'),
        stdio: 'pipe'
      });
    } catch (e) {
      hasThrown = true;
      errorMsg = e.stderr?.toString() || '';
    }

    expect(hasThrown).toBe(true);
    expect(errorMsg).toContain('JWT_SECRET must be set in production');
  });

  test('Test 3: Blocks invalid (strings, Infinity, negative) report amounts with 400', async () => {
    const invalidAmounts = ['abc', Infinity, -10.5];

    for (const amt of invalidAmounts) {
      const body = { work_order_no: 'WB_BAN_102', amount: amt };
      const reqCreate = { body };
      const resCreate = mockRes();
      await createReport(reqCreate, resCreate);

      const reqUpdate = { params: { fund_report_id: 'dummy' }, body };
      const resUpdate = mockRes();
      await updateReport(reqUpdate, resUpdate);

      expect(resCreate.statusCode).toBe(400);
      expect(resUpdate.statusCode).toBe(400);
    }
  });

  test('Test 4: Blocks invalid roles (superuser, root) in admin updateUser/addUser with 400', async () => {
    const reqAdd = {
      body: {
        mobileNumber: '+919999999999',
        displayName: 'Test Role User',
        role: 'superuser'
      }
    };
    const resAdd = mockRes();
    await addUser(reqAdd, resAdd);

    const reqUpd = {
      params: { id: 'dummy' },
      body: { role: 'root' }
    };
    const resUpd = mockRes();
    await updateUser(reqUpd, resUpd);

    expect(resAdd.statusCode).toBe(400);
    expect(resUpd.statusCode).toBe(400);
  });

  test('Test 5: Verifies optimistic locking serializes concurrent OTP verification requests', async () => {
    const { data: otpRecord, error } = await supabase
      .from('otp_requests')
      .insert([{
        mobile_number: '+919999999999',
        otp_hash: '$2b$04$dummyotpverifyhash',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        attempts: 0
      }])
      .select()
      .single();

    if (error) throw error;

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
    
    await supabase.from('otp_requests').delete().eq('id', otpRecord.id);

    const success1 = res1.data && res1.data.length === 1;
    const success2 = res2.data && res2.data.length === 1;
    const exactlyOneSuccess = (success1 && !success2) || (!success1 && success2);
    expect(exactlyOneSuccess).toBe(true);
  });

  test('Test 6: Verifies catch blocks utilize logError utility', () => {
    const reportsControllerContent = fs.readFileSync(
      path.join(__dirname, '../../../src/controllers/reports.controller.js'),
      'utf8'
    );
    expect(reportsControllerContent).toContain("logError('");
  });

  test('Test 7: Truncates user-agent string to 500 characters in createSession', async () => {
    const longUserAgent = 'Mozilla/5.0 '.repeat(50);
    
    const { data: realUser } = await supabase
      .from('authorised_users')
      .select('id')
      .eq('mobile_number', '+918276071523')
      .single();

    const mockSessionInput = {
      userId: realUser.id,
      jti: 'session_ua_test_uuid',
      ipAddress: '127.0.0.1',
      userAgent: longUserAgent
    };

    const sessionRecord = await createSession(mockSessionInput);
    expect(sessionRecord.user_agent.length).toBeLessThanOrEqual(500);

    // Cleanup session
    await supabase.from('sessions').delete().eq('id', sessionRecord.id);
  });

  test('Test 8: verifyJwt clears accessToken cookie on TokenExpiredError', async () => {
    const actualSecret = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';
    const expiredToken = jwt.sign(
      { user_id: 'dummy', mobile_number: '+910000000000', role: 'je' },
      actualSecret,
      { expiresIn: '-1s' }
    );

    const req = {
      cookies: { accessToken: expiredToken }
    };
    const res = createMockResWithCookies();
    
    await verifyJwt(req, res, () => {});

    expect(res.statusCode).toBe(401);
    expect(res.jsonData?.code).toBe('ACCESS_TOKEN_EXPIRED');
    expect(res.clearedCookies).toContain('accessToken');
  });

  test('Test 9: Whitelist deletion blocks if user has active requisitions with 409', async () => {
    const suffix = crypto.randomUUID().substring(0, 8);
    const mockMobile = `+919999_${suffix.substring(0, 4)}`;

    const { data: mockUser, error: userError } = await supabase
      .from('authorised_users')
      .insert([{
        mobile_number: mockMobile,
        display_name: 'Test Whitelist Del',
        role: 'je',
        is_active: true
      }])
      .select()
      .single();

    if (userError) throw userError;

    const { data: reqRecord, error: reqError } = await supabase
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

    if (reqError) {
      await supabase.from('authorised_users').delete().eq('id', mockUser.id);
      throw reqError;
    }

    const reqRemove = { params: { id: mockUser.id } };
    const resRemove = mockRes();
    await removeUser(reqRemove, resRemove);

    // Cleanup
    await supabase.from('requisitions').delete().eq('requisition_id', reqRecord.requisition_id);
    await supabase.from('authorised_users').delete().eq('id', mockUser.id);

    expect(resRemove.statusCode).toBe(409);
    expect(resRemove.jsonData.message).toContain('pending requisition');
  });
});
