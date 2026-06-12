const express = require('express');
const { requestOtp, linkTelegram, verifyOtpCode, logout, refreshTokens, getMe } = require('../controllers/auth.controller');
const verifyJwt = require('../middleware/verifyJwt');
const { otpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Public routes
router.post('/request-otp', otpRequestLimiter, requestOtp);
router.post('/link-telegram', otpRequestLimiter, linkTelegram);
router.post('/verify-otp', otpVerifyLimiter, verifyOtpCode);
router.post('/refresh', refreshTokens);

// Authenticated routes
router.post('/logout', verifyJwt, logout);
router.get('/me', verifyJwt, getMe);

module.exports = router;
