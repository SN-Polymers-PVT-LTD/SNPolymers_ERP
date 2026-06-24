const express = require('express');
const {
  getProjects,
  getProjectByWorkOrder,
  createProject,
  updateProject,
  updateProjectStatus,
  getDashboardOverview
} = require('../controllers/projects.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireAdmin = require('../middleware/requireAdmin');
const validateRequest = require('../middleware/validateRequest');
const {
  createProjectSchema,
  updateProjectSchema,
  updateProjectStatusSchema
} = require('../validation/project.schema');

const router = express.Router();

// Guard all project routes with JWT Verification
router.use(verifyJwt);

// General staff and admin read-only access (for list select & auto-fill)
router.get('/dashboard/overview', getDashboardOverview);
router.get('/', getProjects);
router.get('/:work_order_no', getProjectByWorkOrder);

// Admin-only write and status change routes
router.post('/', requireAdmin, validateRequest(createProjectSchema), createProject);
router.put('/:work_order_no', requireAdmin, validateRequest(updateProjectSchema), updateProject);
router.patch('/:work_order_no/status', requireAdmin, validateRequest(updateProjectStatusSchema), updateProjectStatus);

module.exports = router;
