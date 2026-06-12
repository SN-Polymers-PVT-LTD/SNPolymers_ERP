const express = require('express');
const {
  getProjects,
  getProjectByWorkOrder,
  createProject,
  updateProject,
  updateProjectStatus
} = require('../controllers/projects.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Guard all project routes with JWT Verification
router.use(verifyJwt);

// General staff and admin read-only access (for list select & auto-fill)
router.get('/', getProjects);
router.get('/:work_order_no', getProjectByWorkOrder);

// Admin-only write and status change routes
router.post('/', requireAdmin, createProject);
router.put('/:work_order_no', requireAdmin, updateProject);
router.patch('/:work_order_no/status', requireAdmin, updateProjectStatus);

module.exports = router;
