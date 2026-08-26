const { supabase } = require('../db/supabase');
const { logError } = require('../utils/logger');
const { generateOtp, hashOtp, storeOtp, verifyOtp } = require('../services/otp.service');
const { sendOtp } = require('../services/telegram.service');
const { enrollDescriptor } = require('../services/faceVerification.service');
const { normalizeMobileNumber } = require('../utils/mobile');

/**
 * POST /api/v1/auth/face-verification/enroll/request-otp
 * Authenticated endpoint: generates and dispatches a Telegram OTP
 * to the user's linked Telegram account for face enrollment authorization.
 */
async function requestEnrollOtp(req, res) {
  try {
    // 1. Fetch minimal user record — telegram_chat_id is not in JWT payload
    const { data: user, error: userError } = await supabase
      .from('authorised_users')
      .select('telegram_chat_id, mobile_number, is_active')
      .eq('id', req.user.id)
      .maybeSingle();

    if (userError || !user) {
      return res.status(403).json({ success: false, message: 'Access denied. User not found.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Access denied. Account is deactivated.' });
    }

    // 2. Telegram must be linked before an OTP can be delivered
    if (!user.telegram_chat_id) {
      return res.status(400).json({
        success: false,
        code: 'TELEGRAM_NOT_LINKED',
        message: 'Telegram setup required before OTP can be delivered.'
      });
    }

    // 3. Generate, hash, and store OTP under canonical mobile number
    const mobileNumber = normalizeMobileNumber(user.mobile_number);
    const rawOtp = generateOtp();
    const hashed = await hashOtp(rawOtp);
    await storeOtp(mobileNumber, hashed);

    // 4. Dispatch via Telegram bot
    await sendOtp(user.telegram_chat_id, rawOtp);

    return res.status(200).json({
      success: true,
      message: 'OTP has been generated and sent to your Telegram account.'
    });
  } catch (error) {
    logError('requestEnrollOtp', error);
    return res.status(500).json({ success: false, message: 'Failed to request enrollment OTP.' });
  }
}

/**
 * POST /api/v1/auth/face-verification/enroll
 * Authenticated endpoint: verifies OTP and persists the 128-d face descriptor vector.
 */
async function enrollFace(req, res) {
  const { descriptor, otp, consented_at } = req.body;

  try {
    // 1. Verify OTP against the user's canonical mobile number from JWT
    const mobileNumber = normalizeMobileNumber(req.user.mobile_number);
    const verificationResult = await verifyOtp(mobileNumber, otp);

    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_OTP',
        message: verificationResult.reason,
        attemptsLeft: verificationResult.attemptsLeft
      });
    }

    // 2. OTP valid — persist/upsert descriptor using verified JWT user ID
    const consentedAt = consented_at || new Date().toISOString();
    const record = await enrollDescriptor(req.user.id, descriptor, consentedAt);

    return res.status(200).json({
      success: true,
      message: 'Face descriptor enrolled successfully.',
      enrolled_at: record.enrolled_at,
      updated_at: record.updated_at
    });
  } catch (error) {
    logError('enrollFace', error);
    return res.status(500).json({ success: false, message: 'Failed to enroll face descriptor.' });
  }
}

module.exports = {
  requestEnrollOtp,
  enrollFace
};
