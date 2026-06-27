'use strict';

const express = require('express');
const {
  createBill,
  getBills,
  getBillById,
  getBillSummaryByWorkOrder
} = require('../controllers/raFinalBill.controller');
const { uploadBillCopy } = require('../controllers/raFinalBill.uploads.controller');
const verifyJwt   = require('../middleware/verifyJwt'); // Corrected middleware name
const requireRole = require('../middleware/requireRole');
const validate    = require('../validation/validate');
const { createBillSchema, getBillByIdSchema } = require('../validation/raFinalBill.schema');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }  // 5MB hard limit at multer layer
});

router.use(verifyJwt);

const authorisedRoles = ['ho', 'zo', 'admin'];

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: /upload/bill-copy and /summary/:work_order_no MUST be registered
// BEFORE /:id to prevent Express from matching "upload" or "summary" as a UUID.
// ─────────────────────────────────────────────────────────────────────────────

// File upload
router.post('/upload/bill-copy',
  requireRole(authorisedRoles),
  upload.single('file'),
  uploadBillCopy);

// Summary endpoint (dynamic dropdown driver)
router.get('/summary/:work_order_no',
  requireRole(authorisedRoles),
  getBillSummaryByWorkOrder);

// Core CRUD
router.post('/',
  requireRole(authorisedRoles),
  (req, res, next) => { if (!validate(req, res, createBillSchema)) return; next(); },
  createBill);

router.get('/',
  requireRole(authorisedRoles),
  getBills);

router.get('/:id',
  requireRole(authorisedRoles),
  (req, res, next) => { if (!validate(req, res, getBillByIdSchema)) return; next(); },
  getBillById);

module.exports = router;
