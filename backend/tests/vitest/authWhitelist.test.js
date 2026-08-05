import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const { requestOtp, checkLinkStatus, verifyOtpCode } = require('../../src/controllers/auth.controller');
const { addUser } = require('../../src/controllers/admin.controller');
const { mobileNumberVariants } = require('../../src/utils/mobile');
const mockRes = require('../helpers/mockRes');

/**
 * Regression suite for production login failures caused by mobile format drift:
 * - Frontend (Login.jsx) always sends +91XXXXXXXXXX
 * - Production authorised_users rows are often stored as 91XXXXXXXXXX (no +)
 * - Auth must accept both; admin inserts must use canonical storage
 */

const FRONTEND_FORMAT = (tenDigits) => `+91${tenDigits}`;

function uniqueTestMobile() {
  const suffix = crypto.randomUUID().replace(/\D/g, '').slice(0, 10);
  return {
    canonical: `91${suffix}`,
    frontend: FRONTEND_FORMAT(suffix)
  };
}

async function deleteUserByMobile(mobile) {
  const variants = mobileNumberVariants(mobile);
  if (variants.length === 0) return;
  await supabase.from('otp_requests').delete().in('mobile_number', variants);
  await supabase.from('authorised_users').delete().in('mobile_number', variants);
}

describe('Auth whitelist — mobile format regression', () => {
  let digitsOnlyUser;
  let plusPrefixedUser;
  let adminAddedUser;

  beforeAll(async () => {
    digitsOnlyUser = uniqueTestMobile();
    plusPrefixedUser = uniqueTestMobile();
    adminAddedUser = uniqueTestMobile();

    await deleteUserByMobile(digitsOnlyUser.canonical);
    await deleteUserByMobile(plusPrefixedUser.frontend);
    await deleteUserByMobile(adminAddedUser.canonical);

    const { error: errDigits } = await supabase.from('authorised_users').insert([{
      mobile_number: digitsOnlyUser.canonical,
      display_name: 'Digits-only whitelist user',
      role: 'je',
      is_active: true,
      telegram_chat_id: '1111111111'
    }]);
    if (errDigits) throw new Error(`Setup failed (digits-only): ${errDigits.message}`);

    const { error: errPlus } = await supabase.from('authorised_users').insert([{
      mobile_number: plusPrefixedUser.frontend,
      display_name: 'Plus-prefixed whitelist user',
      role: 'je',
      is_active: true,
      telegram_chat_id: '2222222222'
    }]);
    if (errPlus) throw new Error(`Setup failed (+prefix): ${errPlus.message}`);
  });

  afterAll(async () => {
    await deleteUserByMobile(digitsOnlyUser?.canonical);
    await deleteUserByMobile(plusPrefixedUser?.frontend);
    await deleteUserByMobile(adminAddedUser?.canonical);
  });

  test('request-otp: frontend +91 payload matches digits-only DB row (production scenario)', async () => {
    const req = { body: { mobileNumber: digitsOnlyUser.frontend } };
    const res = mockRes();

    await requestOtp(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData?.success).toBe(true);
    expect(res.jsonData?.needsTelegramSetup).toBe(false);
  });

  test('request-otp: digits-only payload matches digits-only DB row', async () => {
    const req = { body: { mobileNumber: digitsOnlyUser.canonical } };
    const res = mockRes();

    await requestOtp(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData?.success).toBe(true);
  });

  test('request-otp: frontend +91 payload matches legacy +91 DB row', async () => {
    const req = { body: { mobileNumber: plusPrefixedUser.frontend } };
    const res = mockRes();

    await requestOtp(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData?.success).toBe(true);
    expect(res.jsonData?.needsTelegramSetup).toBe(false);
  });

  test('request-otp: rejects non-whitelisted number with 403', async () => {
    const req = { body: { mobileNumber: FRONTEND_FORMAT('0000000000') } };
    const res = mockRes();

    await requestOtp(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData?.message).toMatch(/not whitelisted/i);
  });

  test('check-link-status: accepts frontend +91 payload for digits-only DB row', async () => {
    const req = { query: { mobileNumber: digitsOnlyUser.frontend } };
    const res = mockRes();

    await checkLinkStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData?.linked).toBe(true);
  });

  test('verify-otp: full login flow works when frontend sends +91 but DB stores 91', async () => {
    const requestReq = { body: { mobileNumber: digitsOnlyUser.frontend } };
    const requestRes = mockRes();
    await requestOtp(requestReq, requestRes);
    expect(requestRes.statusCode).toBe(200);

    const verifyReq = {
      body: {
        mobileNumber: digitsOnlyUser.frontend,
        otp: '123456' // NODE_ENV=test bypass in otp.service
      }
    };
    const verifyRes = mockRes();
    verifyRes.cookie = function () { return this; };

    await verifyOtpCode(verifyReq, verifyRes);

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.jsonData?.success).toBe(true);
    expect(verifyRes.jsonData?.user?.mobile_number).toBe(digitsOnlyUser.canonical);
  });

  test('admin addUser: stores canonical digits-only format', async () => {
    const req = {
      body: {
        mobileNumber: adminAddedUser.frontend,
        displayName: 'Admin-added user',
        role: 'je',
        telegramChatId: '3333333333'
      }
    };
    const res = mockRes();

    await addUser(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData?.user?.mobile_number).toBe(adminAddedUser.canonical);

    const otpReq = { body: { mobileNumber: adminAddedUser.frontend } };
    const otpRes = mockRes();
    await requestOtp(otpReq, otpRes);
    expect(otpRes.statusCode).toBe(200);
  });

  test('admin addUser: rejects duplicate when only + prefix differs', async () => {
    const req = {
      body: {
        mobileNumber: digitsOnlyUser.frontend,
        displayName: 'Duplicate attempt',
        role: 'je'
      }
    };
    const res = mockRes();

    await addUser(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.jsonData?.message).toMatch(/already whitelisted/i);
  });
});
