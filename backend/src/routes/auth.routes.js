const express = require('express');
const { requestOtp, checkLinkStatus, verifyOtpCode, logout, refreshTokens, getMe, getProfileData } = require('../controllers/auth.controller');
const verifyJwt = require('../middleware/verifyJwt');
const { otpRequestLimiter, otpVerifyLimiter, refreshTokenLimiter } = require('../middleware/rateLimiter');
const validateRequest = require('../middleware/validateRequest');
const { requestOtpSchema, linkTelegramSchema, verifyOtpSchema } = require('../validation/auth.schema');

const router = express.Router();

// Public routes
router.post('/request-otp', otpRequestLimiter, validateRequest(requestOtpSchema), requestOtp);
router.get('/link-status', checkLinkStatus);
router.post('/verify-otp', otpVerifyLimiter, validateRequest(verifyOtpSchema), verifyOtpCode);
router.post('/refresh', refreshTokenLimiter, refreshTokens);

// Authenticated routes
router.post('/logout', verifyJwt, logout);
router.get('/me', verifyJwt, getMe);
router.get('/profile', verifyJwt, getProfileData);

module.exports = router;
