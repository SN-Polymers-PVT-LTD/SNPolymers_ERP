const rateLimit = require('express-rate-limit');

/**
 * OTP Request rate limiter:
 * Limits requesting OTP to maximum 3 times per 15-minute window for a specific IP/route.
 */
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 OTP requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many OTP requests from this connection. Please try again after 15 minutes.'
  },
  // In a real proxy environment (e.g., Vercel, Heroku, Nginx), trust proxy headers:
  // app.set('trust proxy', 1) needs to be configured in app.js
  keyGenerator: (req) => {
    // Rate limit by mobile number if available in body, otherwise fallback to IP
    return req.body.mobileNumber || req.ip;
  }
});

module.exports = {
  otpRequestLimiter
};
