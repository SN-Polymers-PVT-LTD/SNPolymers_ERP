const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// Structured logging rate limit handler
const logRateLimitExceeded = (req, res, options) => {
  console.warn(JSON.stringify({
    type: 'RATE_LIMIT_EXCEEDED',
    ip: req.ip,
    path: req.originalUrl,
    method: req.method
  }));
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.'
  });
};

const logOtpRequestLimitExceeded = (req, res, options) => {
  console.warn(JSON.stringify({
    type: 'RATE_LIMIT_EXCEEDED',
    ip: req.ip,
    path: req.originalUrl,
    method: req.method,
    limiter: 'otpRequest'
  }));
  res.status(429).json({
    success: false,
    message: 'Too many OTP requests from this connection. Please try again after 15 minutes.'
  });
};

const logOtpVerifyLimitExceeded = (req, res, options) => {
  console.warn(JSON.stringify({
    type: 'RATE_LIMIT_EXCEEDED',
    ip: req.ip,
    path: req.originalUrl,
    method: req.method,
    limiter: 'otpVerify'
  }));
  res.status(429).json({
    success: false,
    message: 'Too many login attempts. Please try again after 5 minutes.'
  });
};

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
  keyGenerator: (req) => {
    return req.body.mobileNumber || req.ip;
  },
  handler: logOtpRequestLimitExceeded
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
  keyGenerator: (req) => {
    return req.body.mobileNumber || req.ip;
  },
  handler: logOtpVerifyLimitExceeded
});

/**
 * Global general-purpose rate limiter:
 * 1,000 requests per 1-minute window.
 *
 * INTENTIONALLY PERMISSIVE: This is an internal ERP application used by a small
 * set of known users. The limit is set high to avoid blocking legitimate bulk
 * operations (e.g. saving estimate items). (CQ-8).
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: logRateLimitExceeded
});

/**
 * Refresh Token rate limiter:
 * 60 requests per 1-minute window.
 */
const refreshTokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: logRateLimitExceeded
});

/**
 * Admin API endpoints rate limiter:
 * 100 requests per 1-minute window.
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: logRateLimitExceeded
});

module.exports = {
  otpRequestLimiter,
  otpVerifyLimiter,
  globalLimiter,
  refreshTokenLimiter,
  adminLimiter
};
