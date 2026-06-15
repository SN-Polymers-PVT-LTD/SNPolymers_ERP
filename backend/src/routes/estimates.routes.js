const express = require('express');
const {
  getEstimates,
  getEstimateById,
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../controllers/estimates.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// Read endpoints
router.get('/', getEstimates);
router.get('/:id', getEstimateById);

// Write endpoints for JE / Staff / Admin
const jeRoles = ['je', 'staff', 'admin'];
router.post('/', requireRole(jeRoles), createEstimate);
router.put('/:id/items', requireRole(jeRoles), saveDraftItems);
router.post('/:id/submit', requireRole(jeRoles), submitEstimate);

// Review endpoints
const reviewRoles = ['zo', 'ho', 'admin'];
const zoRoles = ['zo', 'admin'];
router.patch('/:id/review', requireRole(reviewRoles), reviewEstimate);
router.post('/:id/row-approvals', requireRole(zoRoles), submitRowApprovals);
router.post('/:id/submit-review', requireRole(zoRoles), submitReview);

module.exports = router;

