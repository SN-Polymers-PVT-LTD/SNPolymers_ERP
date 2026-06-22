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

const router = express.Router();

router.use(verifyJwt);

const readerRoles = ['zo', 'staff', 'ho', 'admin'];
const zoRoles = ['zo', 'staff', 'admin'];
const hoRoles = ['ho', 'admin'];

// Read endpoints
router.get('/', requireRole(readerRoles), getFundRequests);
router.get('/:id', requireRole(readerRoles), getFundRequestById);

// Create endpoint
router.post('/', requireRole(zoRoles), createFundRequest);

// Workflow transitions
router.patch('/:id/action', requireRole(hoRoles), actOnFundRequest);
router.patch('/:id/cancel', requireRole(zoRoles), cancelFundRequest);

module.exports = router;
