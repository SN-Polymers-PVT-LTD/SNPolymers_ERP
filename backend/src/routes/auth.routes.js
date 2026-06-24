const express = require('express');
const { requestOtp, linkTelegram, verifyOtpCode, logout, refreshTokens, getMe } = require('../controllers/auth.controller');
const verifyJwt = require('../middleware/verifyJwt');
const { otpRequestLimiter, otpVerifyLimiter, refreshTokenLimiter } = require('../middleware/rateLimiter');
const validateRequest = require('../middleware/validateRequest');
const { requestOtpSchema, linkTelegramSchema, verifyOtpSchema } = require('../validation/auth.schema');

const router = express.Router();

// Public routes
router.post('/request-otp', otpRequestLimiter, validateRequest(requestOtpSchema), requestOtp);
router.post('/link-telegram', otpRequestLimiter, validateRequest(linkTelegramSchema), linkTelegram);
router.post('/verify-otp', otpVerifyLimiter, validateRequest(verifyOtpSchema), verifyOtpCode);
router.post('/refresh', refreshTokenLimiter, refreshTokens);

// Authenticated routes
router.post('/logout', verifyJwt, logout);
router.get('/me', verifyJwt, getMe);

module.exports = router;
