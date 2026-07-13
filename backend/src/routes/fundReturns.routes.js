const express = require('express');
const {
  createReturnRequest,
  acceptReturnRequest,
  rejectReturnRequest,
  modifyReturnRequest,
  hoActionOnReturn,
  getReturnRequests
} = require('../controllers/fundReturns.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// Route registration
router.post(
  '/',
  requireRole(['admin', 'ho']),
  createReturnRequest
);

router.post(
  '/:id/accept',
  requireRole(['zo']),
  acceptReturnRequest
);

router.patch(
  '/:id/reject',
  requireRole(['zo']),
  rejectReturnRequest
);

router.patch(
  '/:id/modify',
  requireRole(['zo']),
  modifyReturnRequest
);

router.patch(
  '/:id/ho-action',
  requireRole(['admin', 'ho']),
  hoActionOnReturn
);

router.get(
  '/',
  requireRole(['admin', 'ho', 'zo']),
  getReturnRequests
);

module.exports = router;
