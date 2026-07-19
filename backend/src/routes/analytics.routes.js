const express = require('express');
const {
  getHoKpis,
  getHoResourceUtilization,
  getHoApprovalSla,
  getHoZoneBenchmarking,
  getHoBudgetLeakage,
  getZoProductivity,
  getRecentActivity,
  getAuditLog,
  getProjectDigitalTwin,
  triggerRefresh,
  getProjectsHealth
} = require('../controllers/analytics.controller');
const verifyJwt  = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// All analytics routes require authentication
router.use(verifyJwt);

// HO Executive Routes
const hoRoles = ['ho', 'admin'];
router.get('/ho/kpis',                 requireRole(hoRoles), getHoKpis);
router.get('/ho/resource-utilization', requireRole(hoRoles), getHoResourceUtilization);
router.get('/ho/approval-sla',         requireRole(hoRoles), getHoApprovalSla);
router.get('/ho/zone-benchmarking',    requireRole(hoRoles), getHoZoneBenchmarking);
router.get('/ho/budget-leakage',       requireRole(hoRoles), getHoBudgetLeakage);

// ZO + HO Routes
router.get('/zo/productivity',         requireRole(['zo', 'ho', 'admin']), getZoProductivity);
router.get('/recent-activity',         requireRole(['zo', 'ho', 'admin']), getRecentActivity);

// Audit Center Route
router.get('/audit-log',               requireRole(hoRoles), getAuditLog);

// Project digital twin (controller enforces custom mapping checks based on role/WO)
router.get('/project/:work_order_no/digital-twin', getProjectDigitalTwin);
router.get('/projects', requireRole(['je', 'zo', 'ho', 'admin']), getProjectsHealth);

// Admin/HO trigger for manual refresh
router.post('/refresh',                requireRole(hoRoles), triggerRefresh);

module.exports = router;
