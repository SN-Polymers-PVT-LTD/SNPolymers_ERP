const express = require('express');
const {
  createOrUpdateUserMapping,
  deactivateUserMapping,
  getUserMappings,
  getEligibleJEs,
  getEligibleZOs
} = require('../controllers/userMappings.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// Route registration
router.post(
  '/',
  requireRole(['admin', 'ho']),
  createOrUpdateUserMapping
);

router.patch(
  '/:id/deactivate',
  requireRole(['admin', 'ho']),
  deactivateUserMapping
);

router.get(
  '/eligible-jes',
  requireRole(['admin', 'ho', 'zo']),
  getEligibleJEs
);

router.get(
  '/eligible-zos',
  requireRole(['admin', 'ho', 'zo']),
  getEligibleZOs
);

router.get(
  '/',
  requireRole(['admin', 'ho', 'zo', 'je']),
  getUserMappings
);

module.exports = router;
