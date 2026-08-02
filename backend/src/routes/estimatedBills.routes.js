'use strict';

const express = require('express');
const {
  listEstimatedBills,
  getEstimatedBill,
  listWorkOrderOptions,
  upsertEstimatedBill
} = require('../controllers/estimatedBills.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  upsertEstimatedBillSchema,
  getEstimatedBillSchema
} = require('../validation/estimatedBills.schema');

const router = express.Router();
const allowedRoles = ['zo', 'ho', 'admin'];

// Apply JWT authentication and role authorization for all routes
router.use(verifyJwt, requireRole(allowedRoles));

// CRITICAL: /work-orders static route MUST come before /:work_order_no param route
router.get('/work-orders', listWorkOrderOptions);
router.get('/', listEstimatedBills);
router.get('/:work_order_no', validateRequest(getEstimatedBillSchema), getEstimatedBill);
router.post('/', validateRequest(upsertEstimatedBillSchema), upsertEstimatedBill);

module.exports = router;
