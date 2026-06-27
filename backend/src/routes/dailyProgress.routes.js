'use strict';

const express = require('express');
const multer = require('multer');
const {
  createProgressReport,
  getProgressReports,
  getProgressReportById,
  addAuthorityRemarks
} = require('../controllers/dailyProgress.controller');
const { uploadSitePhoto } = require('../controllers/dailyProgress.uploads.controller');

const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createProgressReportSchema,
  addRemarksSchema,
  getReportByIdSchema
} = require('../validation/dailyProgress.schema');

const router = express.Router();

// Multer memory storage with 10MB limit
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Apply JWT verification middleware to all daily progress endpoints
router.use(verifyJwt);

const creatorRoles = ['je'];
const viewerRoles  = ['je', 'zo', 'ho', 'admin'];
const remarksRoles = ['zo', 'ho', 'admin'];

// Upload Endpoint
router.post(
  '/upload/photo',
  requireRole(creatorRoles),
  upload.single('file'),
  uploadSitePhoto
);

// Core CRUD Endpoints
router.post(
  '/',
  requireRole(creatorRoles),
  validateRequest(createProgressReportSchema),
  createProgressReport
);

router.get(
  '/',
  requireRole(viewerRoles),
  getProgressReports
);

router.get(
  '/:id',
  requireRole(viewerRoles),
  validateRequest(getReportByIdSchema),
  getProgressReportById
);

// Authority Remarks Endpoint
router.patch(
  '/:id/remarks',
  requireRole(remarksRoles),
  validateRequest(addRemarksSchema),
  addAuthorityRemarks
);

module.exports = router;

