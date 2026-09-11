const express = require('express');
const {
  createFundRequest,
  getFundRequests,
  getFundRequestById,
  actOnFundRequest,
  cancelFundRequest
} = require('../controllers/fundRequests.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createFundRequestSchema,
  actOnFundRequestSchema,
  cancelFundRequestSchema
} = require('../validation/fundRequest.schema');

const router = express.Router();

router.use(verifyJwt);

const readerRoles = ['zo', 'ho', 'accounts', 'admin'];
const zoRoles = ['zo', 'admin'];
const accountsRoles = ['accounts', 'admin'];

// Read endpoints
router.get('/', requireRole(readerRoles), getFundRequests);
router.get('/:id', requireRole(readerRoles), getFundRequestById);

// Create endpoint
router.post('/', requireRole(zoRoles), validateRequest(createFundRequestSchema), createFundRequest);

// Workflow transitions — Accounts approves/holds directly; HO is read-only (no HO approval stage).
router.patch('/:id/action', requireRole(accountsRoles), validateRequest(actOnFundRequestSchema), actOnFundRequest);
router.patch('/:id/cancel', requireRole(zoRoles), validateRequest(cancelFundRequestSchema), cancelFundRequest);

module.exports = router;
