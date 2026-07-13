const express = require('express');
const {
  getZonalBalances,
  getZonalLedger,
  reconcileZonalBalances
} = require('../controllers/zoBalances.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// Route registration
router.get(
  '/',
  requireRole(['admin', 'ho', 'zo']),
  getZonalBalances
);

router.get(
  '/ledger',
  requireRole(['admin', 'ho', 'zo']),
  getZonalLedger
);

router.post(
  '/reconcile',
  requireRole(['admin', 'ho']),
  reconcileZonalBalances
);

module.exports = router;
