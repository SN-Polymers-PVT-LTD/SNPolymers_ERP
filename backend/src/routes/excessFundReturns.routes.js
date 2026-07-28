const express = require('express');
const {
  createExcessFundReturn,
  actionExcessFundReturn,
  getExcessFundReturns,
  getTargetZOs
} = require('../controllers/excessFundReturns.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// Route registration
router.get(
  '/target-zos',
  requireRole(['admin', 'ho', 'zo']),
  getTargetZOs
);

router.post(
  '/',
  requireRole(['zo']),
  createExcessFundReturn
);

router.patch(
  '/:id/action',
  requireRole(['admin', 'ho']),
  actionExcessFundReturn
);

router.get(
  '/',
  requireRole(['admin', 'ho', 'zo']),
  getExcessFundReturns
);

module.exports = router;
