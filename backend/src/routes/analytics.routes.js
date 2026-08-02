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
  getProjectsHealth,
  getHoActionableInsights,
  getHoChartData,
  getJeLeaderboard,
  getHoBillingForecastAccuracy
} = require('../controllers/analytics.controller');
const verifyJwt  = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// All analytics routes require authentication
router.use(verifyJwt);

// JE Leaderboard Route (accessible by all authenticated roles)
router.get('/je-leaderboard', requireRole(['je', 'zo', 'ho', 'admin']), getJeLeaderboard);

// HO / ZO Shared Executive Routes
const execRoles = ['zo', 'ho', 'admin'];
const hoRoles = ['ho', 'admin'];
router.get('/ho/kpis',                     requireRole(hoRoles), getHoKpis);
router.get('/ho/resource-utilization',     requireRole(hoRoles), getHoResourceUtilization);
router.get('/ho/approval-sla',             requireRole(hoRoles), getHoApprovalSla);
router.get('/ho/zone-benchmarking',        requireRole(hoRoles), getHoZoneBenchmarking);
router.get('/ho/budget-leakage',           requireRole(hoRoles), getHoBudgetLeakage);
router.get('/ho/billing-forecast-accuracy', requireRole(hoRoles), getHoBillingForecastAccuracy);
router.get('/ho/actionable-insights',      requireRole(execRoles), getHoActionableInsights);
router.get('/ho/chart-data',               requireRole(execRoles), getHoChartData);


// ZO + HO Routes
router.get('/zo/productivity',         requireRole(['zo', 'ho', 'admin']), getZoProductivity);
router.get('/recent-activity',         requireRole(['zo', 'ho', 'admin']), getRecentActivity);

// Audit Center Route
router.get('/audit-log',               requireRole(hoRoles), getAuditLog);

// Project digital twin (controller enforces custom mapping checks based on role/WO)
router.get('/project/:work_order_no/digital-twin', getProjectDigitalTwin);
router.get('/projects', requireRole(['je', 'zo', 'ho', 'admin']), getProjectsHealth);

// Trigger for manual refresh
router.post('/refresh',                requireRole(execRoles), triggerRefresh);

module.exports = router;
