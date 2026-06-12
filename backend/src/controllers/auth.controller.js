const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../db/supabase');
const { generateOtp, hashOtp, storeOtp, verifyOtp } = require('../services/otp.service');
const { sendOtp } = require('../services/whatsapp.service');
const { generateTokens, createSession, closeSession, formatDuration } = require('../services/session.service');
const { notifyAdminLogin, notifyAdminLogout } = require('../services/email.service');

const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax'
};

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

    // 3. Issue Tokens & Create DB Session
    const refreshJti = uuidv4();
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];

    const session = await createSession({
      userId: user.id,
      jti: refreshJti,
      ipAddress,
      userAgent
    });

    const { accessToken, refreshToken } = generateTokens(user, session.id, refreshJti);

    // 4. Store Tokens in httpOnly Cookies
    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
    const sessionId = req.sessionId;
    const user = req.user;

    // 1. Close Session in DB
    const closedSession = await closeSession(sessionId);
    const durationFormatted = formatDuration(closedSession.duration_seconds);

    // 2. Clear Token Cookies
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('token', cookieOptions);

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
 * POST /api/v1/auth/refresh
 * Refreshes access token and rotates refresh token (RTR)
 */
async function refreshTokens(req, res) {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'Authentication required. No refresh token provided.' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';
    const decoded = jwt.verify(refreshToken, JWT_SECRET);

    // 1. Fetch active session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', decoded.session_id)
      .limit(1)
      .single();

    if (sessionError || !session || !session.is_active) {
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(401).json({ success: false, message: 'Session is inactive or has been logged out.' });
    }

    // 2. Replay Attack Detection (RTR)
    if (session.jwt_jti !== decoded.jti) {
      // Invalidate the session immediately
      await supabase
        .from('sessions')
        .update({ is_active: false, logout_at: new Date().toISOString() })
        .eq('id', session.id);

      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(401).json({ success: false, message: 'Replay attack detected. Session revoked.' });
    }

    // 3. User Whitelist status check
    const { data: user, error: userError } = await supabase
      .from('authorised_users')
      .select('*')
      .eq('id', decoded.user_id)
      .limit(1)
      .single();

    if (userError || !user || !user.is_active) {
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(403).json({ success: false, message: 'Access denied. Account is deactivated or removed.' });
    }

    // 4. Rotate tokens
    const newRefreshJti = uuidv4();
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({ jwt_jti: newRefreshJti })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update session: ${updateError.message}`);
    }

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user, session.id, newRefreshJti);

    // 5. Send updated cookies
    res.cookie('accessToken', newAccessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 mins
    });

    res.cookie('refreshToken', newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully.',
      user: {
        id: user.id,
        mobile_number: user.mobile_number,
        display_name: user.display_name,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    console.error(`Token Refresh failed: ${error.message}`);
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('token', cookieOptions);
    return res.status(401).json({ success: false, message: 'Failed to refresh authentication token.' });
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
  refreshTokens,
  getMe
};
