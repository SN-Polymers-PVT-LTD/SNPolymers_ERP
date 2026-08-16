'use strict';

const express = require('express');
const {
  createBreakRequest,
  getBreakRequests,
  getBreakRequestById,
  actOnBreakRequest
} = require('../controllers/activityBreaks.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createBreakRequestSchema,
  actOnBreakRequestSchema
} = require('../validation/activityBreaks.schema');

const router = express.Router();

router.use(verifyJwt);

router.post('/', requireRole(['je']), validateRequest(createBreakRequestSchema), createBreakRequest);
router.get('/', requireRole(['je', 'zo', 'ho', 'admin']), getBreakRequests);
router.get('/:id', requireRole(['je', 'zo', 'ho', 'admin']), getBreakRequestById);
// Cancel is a JE action — route is open to all roles; controller enforces actor match
router.patch(
  '/:id/action',
  requireRole(['je', 'zo', 'ho', 'admin']),
  validateRequest(actOnBreakRequestSchema),
  actOnBreakRequest
);

module.exports = router;
