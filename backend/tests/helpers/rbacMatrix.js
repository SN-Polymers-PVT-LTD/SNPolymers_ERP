const { userForRole } = require('./rbacUsers');
const { getFundRequests } = require('../../src/controllers/fundRequests.controller');
const { createProject } = require('../../src/controllers/projects.controller');

/**
 * Declarative RBAC regression matrix — update when route allowedRoles change.
 * Source of truth: route files under backend/src/routes/.
 */
const RBAC_MATRIX = [
  // --- Core requireRole smoke ---
  {
    id: 'core.requireRole.deny',
    module: 'core',
    endpoint: 'requireRole smoke',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'zo',
    expectAllowed: false
  },
  {
    id: 'core.requireRole.allow',
    module: 'core',
    endpoint: 'requireRole smoke',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'je',
    expectAllowed: true
  },

  // --- Fund requests (fundRequests.routes.js) ---
  {
    id: 'fund_requests.list.je_denied',
    module: 'fund_requests',
    endpoint: 'GET /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'ho', 'admin'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'fund_requests.create.zo_allowed',
    module: 'fund_requests',
    endpoint: 'POST /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'admin'],
    role: 'zo',
    expectAllowed: true
  },
  {
    id: 'fund_requests.create.ho_denied',
    module: 'fund_requests',
    endpoint: 'POST /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'admin'],
    role: 'ho',
    expectAllowed: false
  },
  {
    id: 'fund_requests.ho_approve.je_denied',
    module: 'fund_requests',
    endpoint: 'PATCH /:id/action',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['ho', 'admin'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'fund_requests.ho_approve.zo_denied',
    module: 'fund_requests',
    endpoint: 'PATCH /:id/action',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['ho', 'admin'],
    role: 'zo',
    expectAllowed: false
  },

  // --- Requisitions (requisitions.routes.js) ---
  {
    id: 'requisitions.create.zo_denied',
    module: 'requisitions',
    endpoint: 'POST /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'zo',
    expectAllowed: false
  },
  {
    id: 'requisitions.create.je_allowed',
    module: 'requisitions',
    endpoint: 'POST /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'je',
    expectAllowed: true
  },
  {
    id: 'requisitions.cancel.ho_denied',
    module: 'requisitions',
    endpoint: 'PATCH /:id/cancel',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'ho',
    expectAllowed: false
  },
  {
    id: 'requisitions.action.zo_allowed',
    module: 'requisitions',
    endpoint: 'PATCH /:id/action',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'ho', 'admin'],
    role: 'zo',
    expectAllowed: true
  },
  {
    id: 'requisitions.action.je_denied',
    module: 'requisitions',
    endpoint: 'PATCH /:id/action',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'ho', 'admin'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'requisitions.read.ho_allowed',
    module: 'requisitions',
    endpoint: 'GET /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'zo', 'ho', 'admin'],
    role: 'ho',
    expectAllowed: true
  },

  // --- Analytics (analytics.routes.js) ---
  {
    id: 'analytics.ho_kpis.je_denied',
    module: 'analytics',
    endpoint: 'GET /ho/kpis',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['ho', 'admin'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'analytics.ho_chart_data.je_denied',
    module: 'analytics',
    endpoint: 'GET /ho/chart-data',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'ho', 'admin'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'analytics.audit_log.zo_denied',
    module: 'analytics',
    endpoint: 'GET /audit-log',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['ho', 'admin'],
    role: 'zo',
    expectAllowed: false
  },
  {
    id: 'analytics.refresh.je_denied',
    module: 'analytics',
    endpoint: 'POST /refresh',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'ho', 'admin'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'analytics.projects.je_allowed',
    module: 'analytics',
    endpoint: 'GET /projects',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'zo', 'ho', 'admin'],
    role: 'je',
    expectAllowed: true
  },

  // --- ZO balances (zoBalances.routes.js) ---
  {
    id: 'zo_balances.list.je_denied',
    module: 'zo_balances',
    endpoint: 'GET /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['admin', 'ho', 'zo'],
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'zo_balances.list.zo_allowed',
    module: 'zo_balances',
    endpoint: 'GET /',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['admin', 'ho', 'zo'],
    role: 'zo',
    expectAllowed: true
  },
  {
    id: 'zo_balances.reconcile.zo_denied',
    module: 'zo_balances',
    endpoint: 'POST /reconcile',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['admin', 'ho'],
    role: 'zo',
    expectAllowed: false
  },

  // --- Projects admin writes (projects.routes.js) ---
  {
    id: 'projects.create.je_denied',
    module: 'projects',
    endpoint: 'POST /',
    layer: 'middleware',
    guard: 'requireAdmin',
    role: 'je',
    expectAllowed: false
  },
  {
    id: 'projects.create.admin_allowed',
    module: 'projects',
    endpoint: 'POST /',
    layer: 'middleware',
    guard: 'requireAdmin',
    role: 'admin',
    expectAllowed: true
  },

  // --- Admin (admin.routes.js) ---
  {
    id: 'admin.users.zo_denied',
    module: 'admin',
    endpoint: 'GET /users',
    layer: 'middleware',
    guard: 'requireAdmin',
    role: 'zo',
    expectAllowed: false
  },
  {
    id: 'admin.users.admin_allowed',
    module: 'admin',
    endpoint: 'GET /users',
    layer: 'middleware',
    guard: 'requireAdmin',
    role: 'admin',
    expectAllowed: true
  },

  // --- Controller defense-in-depth ---
  {
    id: 'fund_requests.list.controller_je_denied',
    module: 'fund_requests',
    endpoint: 'GET / (controller)',
    layer: 'controller',
    role: 'je',
    expectStatus: 403,
    handler: getFundRequests,
    buildReq: (ctx) => ({
      user: userForRole(ctx, 'je'),
      query: {}
    })
  },
  {
    id: 'projects.create.controller_je_denied',
    module: 'projects',
    endpoint: 'POST / (controller)',
    layer: 'controller',
    role: 'je',
    expectStatus: 403,
    handler: createProject,
    buildReq: (ctx) => ({
      user: userForRole(ctx, 'je'),
      body: {}
    })
  },
  // --- Estimate Quotations (estimates.routes.js) ---
  {
    id: 'estimates.quotations_upload.zo_denied',
    module: 'estimates',
    endpoint: 'POST /:id/quotations',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'zo',
    expectAllowed: false
  },
  {
    id: 'estimates.quotations_upload.ho_denied',
    module: 'estimates',
    endpoint: 'POST /:id/quotations',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'ho',
    expectAllowed: false
  },
  {
    id: 'estimates.quotations_delete.zo_denied',
    module: 'estimates',
    endpoint: 'DELETE /:id/quotations/:quotationId',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['je', 'admin'],
    role: 'zo',
    expectAllowed: false
  },
  {
    id: 'estimates.quotations_flag.je_denied',
    module: 'estimates',
    endpoint: 'PATCH /:id/quotations/:quotationId/flag',
    layer: 'middleware',
    guard: 'requireRole',
    allowedRoles: ['zo', 'ho', 'admin'],
    role: 'je',
    expectAllowed: false
  }
];

module.exports = { RBAC_MATRIX };
