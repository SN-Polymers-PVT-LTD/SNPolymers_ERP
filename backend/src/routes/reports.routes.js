const express = require('express');
const {
  getReports,
  getSoftDeletedReports,
  getReportById,
  createReport,
  updateReport,
  deleteReport,
  restoreReport
} = require('../controllers/reports.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Guard all report routes with JWT verification
router.use(verifyJwt);

// General staff and admin CRUD access (both can create/edit reports)
router.get('/', getReports);
router.get('/:fund_report_id', getReportById);
router.post('/', createReport);
router.put('/:fund_report_id', updateReport);

// Soft delete (Project Managers can create/edit but ONLY Admin can delete, restore or view deleted)
router.delete('/:fund_report_id', requireAdmin, deleteReport);
router.get('/admin/deleted', requireAdmin, getSoftDeletedReports);
router.patch('/:fund_report_id/restore', requireAdmin, restoreReport);

module.exports = router;
