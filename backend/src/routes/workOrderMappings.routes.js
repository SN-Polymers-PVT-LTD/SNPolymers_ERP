const express = require('express');
const {
  createWorkOrderMapping,
  deactivateWorkOrderMapping,
  getWorkOrderMappings
} = require('../controllers/workOrderMappings.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// Route registration
router.post(
  '/',
  requireRole(['admin', 'ho']),
  createWorkOrderMapping
);

router.patch(
  '/:id/deactivate',
  requireRole(['admin', 'ho']),
  deactivateWorkOrderMapping
);

router.get(
  '/',
  requireRole(['admin', 'ho', 'zo']),
  getWorkOrderMappings
);

module.exports = router;
