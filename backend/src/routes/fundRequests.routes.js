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

const readerRoles = ['zo', 'ho', 'admin'];
const zoRoles = ['zo', 'admin'];
const hoRoles = ['ho', 'admin'];

// Read endpoints
router.get('/', requireRole(readerRoles), getFundRequests);
router.get('/:id', requireRole(readerRoles), getFundRequestById);

// Create endpoint
router.post('/', requireRole(zoRoles), validateRequest(createFundRequestSchema), createFundRequest);

// Workflow transitions
router.patch('/:id/action', requireRole(hoRoles), validateRequest(actOnFundRequestSchema), actOnFundRequest);
router.patch('/:id/cancel', requireRole(zoRoles), validateRequest(cancelFundRequestSchema), cancelFundRequest);

module.exports = router;
