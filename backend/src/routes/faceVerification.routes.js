'use strict';

const express = require('express');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const { enrollOtpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimiter');
const { enrollFaceSchema } = require('../validation/faceVerification.schema');
const { requestEnrollOtp, enrollFace } = require('../controllers/faceVerification.controller');

const router = express.Router();

// All face-verification endpoints require a valid JWT session
router.use(verifyJwt);

// POST /api/v1/auth/face-verification/enroll/request-otp
// No body to validate — identity is resolved from JWT (req.user.id / req.user.mobile_number)
router.post(
  '/enroll/request-otp',
  requireRole(['accounts', 'admin']),
  enrollOtpRequestLimiter,
  requestEnrollOtp
);

// POST /api/v1/auth/face-verification/enroll
router.post(
  '/enroll',
  requireRole(['accounts', 'admin']),
  otpVerifyLimiter,
  validateRequest(enrollFaceSchema),
  enrollFace
);

module.exports = router;
