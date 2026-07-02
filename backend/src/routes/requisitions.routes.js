const express = require('express');
const multer = require('multer');
const {
  createRequisition,
  getRequisitions,
  getRequisitionById,
  actOnRequisition,
  cancelRequisition
} = require('../controllers/requisitions.controller');
const {
  uploadRequisitionPdf,
  uploadGstBillPdf,
  deleteRequisitionPdf,
  deleteGstBillPdf
} = require('../controllers/requisitions.uploads.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createRequisitionSchema,
  actOnRequisitionSchema,
  cancelRequisitionSchema
} = require('../validation/requisition.schema');

const router = express.Router();

// Multer memory storage configuration with 5MB file size limit
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.use(verifyJwt);

const readerRoles = ['je', 'zo', 'ho', 'admin'];
const requesterRoles = ['je', 'admin'];
const approverRoles = ['zo', 'ho', 'admin'];
const uploadRoles = ['je', 'admin'];

// Read endpoints
router.get('/', requireRole(readerRoles), getRequisitions);
router.get('/:id', requireRole(readerRoles), getRequisitionById);

// Create endpoint
router.post('/', requireRole(requesterRoles), validateRequest(createRequisitionSchema), createRequisition);

// Workflow endpoints
router.patch('/:id/action', requireRole(approverRoles), validateRequest(actOnRequisitionSchema), actOnRequisition);
router.patch('/:id/cancel', requireRole(requesterRoles), validateRequest(cancelRequisitionSchema), cancelRequisition);

// Upload endpoints (JE only)
router.post('/upload/requisition-pdf', requireRole(uploadRoles), upload.single('file'), uploadRequisitionPdf);
router.post('/upload/gst-bill', requireRole(uploadRoles), upload.single('file'), uploadGstBillPdf);
router.delete('/upload/requisition-pdf', requireRole(uploadRoles), deleteRequisitionPdf);
router.delete('/upload/gst-bill', requireRole(uploadRoles), deleteGstBillPdf);

module.exports = router;
