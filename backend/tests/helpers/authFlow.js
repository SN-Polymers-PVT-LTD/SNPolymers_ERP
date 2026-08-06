const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const { requestOtp, verifyOtpCode } = require('../../src/controllers/auth.controller');
const { mobileNumberVariants } = require('../../src/utils/mobile');
const mockResWithCookies = require('./mockResWithCookies');

const DEV_OTP = '123456';
const FRONTEND_FORMAT = (tenDigits) => `+91${tenDigits}`;

function uniqueTestMobile() {
  const suffix = crypto.randomUUID().replace(/\D/g, '').slice(0, 10);
  return {
    canonical: `91${suffix}`,
    frontend: FRONTEND_FORMAT(suffix)
  };
}

async function deleteAuthTestUser(mobile) {
  const variants = mobileNumberVariants(mobile);
  if (variants.length === 0) return;

  const { data: users } = await supabase
    .from('authorised_users')
    .select('id')
    .in('mobile_number', variants);

  const userIds = (users || []).map((user) => user.id);
  if (userIds.length > 0) {
    await supabase.from('sessions').delete().in('user_id', userIds);
  }

  await supabase.from('otp_requests').delete().in('mobile_number', variants);
  await supabase.from('authorised_users').delete().in('mobile_number', variants);
}

/**
 * Inserts a whitelisted user and completes OTP login (dev/test OTP 123456).
 * Returns cookies suitable for verifyJwt / refreshTokens controller tests.
 */
async function loginTestUser({
  mobile,
  displayName = 'Auth flow test user',
  role = 'je',
  telegramChatId = '4444444444'
} = {}) {
  const numbers = mobile || uniqueTestMobile();
  const canonical = numbers.canonical || numbers;
  const frontend = numbers.frontend || numbers;

  await deleteAuthTestUser(canonical);

  const { error: insertError } = await supabase.from('authorised_users').insert([{
    mobile_number: canonical,
    display_name: displayName,
    role,
    is_active: true,
    telegram_chat_id: telegramChatId
  }]);
  if (insertError) {
    throw new Error(`loginTestUser setup failed: ${insertError.message}`);
  }

  const requestRes = mockResWithCookies();
  await requestOtp(
    { body: { mobileNumber: frontend } },
    requestRes
  );
  if (requestRes.statusCode !== 200) {
    throw new Error(`requestOtp failed (${requestRes.statusCode}): ${JSON.stringify(requestRes.jsonData)}`);
  }

  const verifyRes = mockResWithCookies();
  await verifyOtpCode(
    {
      body: { mobileNumber: frontend, otp: DEV_OTP },
      headers: {}
    },
    verifyRes
  );
  if (verifyRes.statusCode !== 200) {
    throw new Error(`verifyOtpCode failed (${verifyRes.statusCode}): ${JSON.stringify(verifyRes.jsonData)}`);
  }

  return {
    mobile: { canonical, frontend },
    user: verifyRes.jsonData.user,
    cookies: verifyRes.cookies,
    verifyResponse: verifyRes.jsonData
  };
}

async function runVerifyJwt(req, res) {
  const verifyJwt = require('../../src/middleware/verifyJwt');

  return new Promise((resolve, reject) => {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      this.jsonData = data;
      resolve();
      return originalJson(data);
    };

    verifyJwt(req, res, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

module.exports = {
  DEV_OTP,
  uniqueTestMobile,
  deleteAuthTestUser,
  loginTestUser,
  runVerifyJwt,
  mockResWithCookies
};
