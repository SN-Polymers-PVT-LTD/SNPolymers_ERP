const jwt = require('jsonwebtoken');
const { supabase } = require('../db/supabase');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';

const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax'
};

/**
 * Middleware: Verify JWT stored in httpOnly cookie
 */
async function verifyJwt(req, res, next) {
  const accessToken = req.cookies.accessToken;

  if (!accessToken) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(accessToken, JWT_SECRET);

    // Verify token's session ID is active and not blacklisted/logged out in sessions table
    const { data: session, error } = await supabase
      .from('sessions')
      .select('is_active')
      .eq('id', decoded.session_id)
      .limit(1)
      .single();

    if (error || !session || !session.is_active) {
      // Clear cookies immediately if token session has been invalidated
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(401).json({ success: false, message: 'Session is inactive or has been logged out.' });
    }

    // Check if the user is still active in authorised_users whitelist
    const { data: user, error: userError } = await supabase
      .from('authorised_users')
      .select('is_active, display_name')
      .eq('id', decoded.user_id)
      .limit(1)
      .single();

    if (userError || !user || !user.is_active) {
      return res.status(403).json({ success: false, message: 'Access denied. Account is deactivated or removed.' });
    }

    // Attach decoded user information and session ID to the request object
    req.user = {
      id: decoded.user_id,
      mobile_number: decoded.mobile_number,
      role: decoded.role,
      permissions: decoded.permissions,
      displayName: user.display_name
    };
    req.sessionId = decoded.session_id;

    next();
  } catch (error) {
    console.error(`JWT Validation Error: ${error.message}`);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'ACCESS_TOKEN_EXPIRED',
        message: 'Authentication failed. Access token expired.'
      });
    }
    return res.status(401).json({ success: false, message: 'Authentication failed. Invalid or expired token.' });
  }
}

module.exports = verifyJwt;
