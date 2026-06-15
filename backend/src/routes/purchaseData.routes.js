const express = require('express');
const {
  getPurchaseOptions,
  createPurchaseOption,
  updatePurchaseOption,
  togglePurchaseOptionStatus
} = require('../controllers/purchaseData.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Guard all purchase data routes with JWT verification
router.use(verifyJwt);

// Read-only access for all authenticated users
router.get('/', getPurchaseOptions);

// Admin-only write operations
router.post('/', requireAdmin, createPurchaseOption);
router.put('/:id', requireAdmin, updatePurchaseOption);
router.patch('/:id/status', requireAdmin, togglePurchaseOptionStatus);

module.exports = router;
