const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * OTP Request rate limiter:
 * Production: max 3 requests per 15-minute window per mobile/IP.
 * Development: relaxed to 100 requests so testing is never blocked.
 */
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 100 : 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many OTP requests from this connection. Please try again after 15 minutes.'
  },
  keyGenerator: (req) => {
    return req.body.mobileNumber || req.ip;
  }
});

/**
 * OTP Verification rate limiter:
 * Production: max 5 attempts per 5-minute window per mobile/IP.
 * Development: relaxed to 500 so testing is never blocked.
 */
const otpVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: isDev ? 500 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again after 5 minutes.'
  },
  keyGenerator: (req) => {
    return req.body.mobileNumber || req.ip;
  }
});

module.exports = {
  otpRequestLimiter,
  otpVerifyLimiter
};
