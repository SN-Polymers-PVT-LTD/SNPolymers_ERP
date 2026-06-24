const express = require('express');
const {
  getEstimates,
  getEstimateById,
  getEstimateInitData,
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview,
  requestRevision,
  getRevisionLog,
  reopenEstimate
} = require('../controllers/estimates.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createEstimateSchema,
  saveDraftItemsSchema,
  submitRowApprovalsSchema
} = require('../validation/estimate.schema');

const router = express.Router();

router.use(verifyJwt);

// Read endpoints
router.get('/', getEstimates);
router.get('/init', getEstimateInitData);
router.get('/:id', getEstimateById);
router.get('/:id/revisions', getRevisionLog);

// Write endpoints for JE / Staff / Admin
const jeRoles = ['je', 'staff', 'admin'];
router.post('/', requireRole(jeRoles), validateRequest(createEstimateSchema), createEstimate);
router.put('/:id/items', requireRole(jeRoles), validateRequest(saveDraftItemsSchema), saveDraftItems);
router.post('/:id/submit', requireRole(jeRoles), submitEstimate);

// Review endpoints
const reviewRoles = ['zo', 'ho', 'admin'];
const zoRoles = ['zo', 'admin'];
router.patch('/:id/review', requireRole(reviewRoles), reviewEstimate);
router.post('/:id/row-approvals', requireRole(reviewRoles), validateRequest(submitRowApprovalsSchema), submitRowApprovals);
router.post('/:id/submit-review', requireRole(reviewRoles), submitReview);
router.post('/:id/request-revision', requireRole(reviewRoles), requestRevision);
router.post('/:id/reopen', requireRole(['ho', 'admin']), reopenEstimate);

module.exports = router;

