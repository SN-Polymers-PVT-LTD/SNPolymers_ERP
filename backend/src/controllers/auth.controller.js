const { supabase } = require('../db/supabase');
const { generateOtp, hashOtp, storeOtp, verifyOtp } = require('../services/otp.service');
const { sendOtp } = require('../services/whatsapp.service');
const { generateToken, createSession, closeSession, formatDuration } = require('../services/session.service');
const { notifyAdminLogin, notifyAdminLogout } = require('../services/email.service');

/**
 * POST /api/v1/auth/request-otp
 * Validates mobile number against whitelist and triggers WhatsApp OTP
 */
async function requestOtp(req, res) {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number is required.' });
  }

  // Validate format (basic check)
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(mobileNumber)) {
    return res.status(400).json({ success: false, message: 'Invalid mobile number format. Must be in E.164 format (+[country][number]).' });
  }

  try {
    // 1. Check if user is whitelisted & active
    const { data: user, error } = await supabase
      .from('authorised_users')
      .select('*')
      .eq('mobile_number', mobileNumber)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (error || !user) {
      // For security, do not leak whether user exists or not, but the spec says:
      // If not found → 'Access denied' error returned.
      return res.status(403).json({ success: false, message: 'Access denied. This number is not whitelisted or is inactive.' });
    }

    // 2. Generate OTP & Hash
    const rawOtp = generateOtp();
    const hashed = await hashOtp(rawOtp);

    // 3. Store OTP in DB
    await storeOtp(mobileNumber, hashed);

    // 4. Send OTP via WhatsApp
    await sendOtp(mobileNumber, rawOtp);

    return res.status(200).json({
      success: true,
      message: 'OTP has been generated and sent to your registered WhatsApp number.'
    });
  } catch (error) {
    console.error(`Request OTP failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to process OTP request.' });
  }
}

/**
 * POST /api/v1/auth/verify-otp
 * Verifies OTP and generates Session / JWT
 */
async function verifyOtpCode(req, res) {
  const { mobileNumber, otp } = req.body;

  if (!mobileNumber || !otp) {
    return res.status(400).json({ success: false, message: 'Mobile number and OTP are required.' });
  }

  try {
    // 1. Verify OTP
    const verificationResult = await verifyOtp(mobileNumber, otp);

    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        message: verificationResult.reason,
        attemptsLeft: verificationResult.attemptsLeft
      });
    }

    // 2. Fetch User to populate payload details
    const { data: user, error } = await supabase
      .from('authorised_users')
      .select('*')
      .eq('mobile_number', mobileNumber)
      .limit(1)
      .single();

    if (error || !user) {
      return res.status(403).json({ success: false, message: 'User verification failed.' });
    }

    // 3. Issue Token & Create DB Session
    const { token, jti } = generateToken(user);
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];

    await createSession({
      userId: user.id,
      jti,
      ipAddress,
      userAgent
    });

    // 4. Store Token in httpOnly Cookie
    // Cookie parameters matches specifications
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // 5. Send parallel async Admin Notification Email
    // Runs in the background, does not block the response
    notifyAdminLogin({
      mobileNumber: user.mobile_number,
      displayName: user.display_name,
      role: user.role,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      user: {
        id: user.id,
        mobile_number: user.mobile_number,
        display_name: user.display_name,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    console.error(`Verify OTP Code failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Server error during OTP verification.' });
  }
}

/**
 * POST /api/v1/auth/logout
 * Logs out user, invalidates JWT jti in sessions and notifies admin
 */
async function logout(req, res) {
  try {
    const jti = req.jti;
    const user = req.user;

    // 1. Close Session in DB
    const closedSession = await closeSession(jti);
    const durationFormatted = formatDuration(closedSession.duration_seconds);

    // 2. Clear Token Cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    // 3. Trigger Admin Notification (async)
    notifyAdminLogout({
      mobileNumber: user.mobile_number,
      displayName: user.displayName,
      durationFormatted,
      logoutTime: closedSession.logout_at
    });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    console.error(`Logout failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Server error during logout process.' });
  }
}

/**
 * GET /api/v1/auth/me
 * Returns current authenticated user
 */
async function getMe(req, res) {
  return res.status(200).json({
    success: true,
    user: req.user
  });
}

module.exports = {
  requestOtp,
  verifyOtpCode,
  logout,
  getMe
};
