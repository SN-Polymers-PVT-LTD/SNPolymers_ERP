const express = require('express');
const {
  createOrUpdateUserMapping,
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

router.get(
  '/eligible-jes',
  requireRole(['admin', 'ho']),
  getEligibleJEs
);

router.get(
  '/eligible-zos',
  requireRole(['admin', 'ho']),
  getEligibleZOs
);

router.get(
  '/',
  requireRole(['admin', 'ho', 'zo']),
  getUserMappings
);

module.exports = router;
