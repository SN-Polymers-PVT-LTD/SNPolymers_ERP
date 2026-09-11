const express = require('express');
const {
  createFundRequest,
  getFundRequests,
  getFundRequestById,
  updateFundRequestDraft,
  submitFundRequest,
  cancelFundRequest
} = require('../controllers/fundRequests.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createFundRequestSchema,
  updateFundRequestDraftSchema,
  submitFundRequestSchema,
  cancelFundRequestSchema
} = require('../validation/fundRequest.schema');

const router = express.Router();

router.use(verifyJwt);

const readerRoles = ['zo', 'ho', 'accounts', 'admin'];
const zoRoles = ['zo', 'admin'];

// Read endpoints
router.get('/', requireRole(readerRoles), getFundRequests);
router.get('/:id', requireRole(readerRoles), getFundRequestById);

// Create endpoint
router.post('/', requireRole(zoRoles), validateRequest(createFundRequestSchema), createFundRequest);
router.patch('/:id', requireRole(zoRoles), validateRequest(updateFundRequestDraftSchema), updateFundRequestDraft);
router.post('/:id/submit', requireRole(zoRoles), validateRequest(submitFundRequestSchema), submitFundRequest);

router.patch('/:id/cancel', requireRole(zoRoles), validateRequest(cancelFundRequestSchema), cancelFundRequest);

module.exports = router;
