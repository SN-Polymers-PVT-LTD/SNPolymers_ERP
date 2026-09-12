const express = require('express');
const multer = require('multer');
const {
  createRequisition,
  getRequisitions,
  getRequisitionById,
  actOnRequisition,
  payFromZoBalance,
  sendToAccounts,
  cancelRequisition,
  retryCancelledRequisitionAttachmentCleanup,
  getMainHeadCapacity,
  getSubcontractorCapacity,
  getSubcontractorLedger,
  getSubcontractorLedgerEntries,
  getSubcontractorRequisitions,
  adjustSubcontractorBalance,
  searchProjectsBeneficiaries,
  getProjectsBeneficiaries,
  upsertProjectsBeneficiary,
  upsertIndianBank,
  getIndianBanks
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
  cancelRequisitionSchema,
  adjustSubcontractorBalanceSchema,
  payFromZoBalanceSchema,
  sendToAccountsSchema,
  upsertProjectsBeneficiarySchema,
  upsertIndianBankSchema
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
const routingRoles = ['zo', 'admin'];
const uploadRoles = ['je', 'admin'];
const adjusterRoles = ['ho', 'admin'];
const adminRoles = ['admin'];

// Read endpoints
router.get('/', requireRole(readerRoles), getRequisitions);
router.get('/capacity', requireRole(readerRoles), getMainHeadCapacity);
router.get('/subcontractor-capacity', requireRole(readerRoles), getSubcontractorCapacity);
router.get('/subcontractor-ledger/entries', requireRole(readerRoles), getSubcontractorLedgerEntries);
router.get('/subcontractor-ledger/requisitions', requireRole(readerRoles), getSubcontractorRequisitions);
router.get('/subcontractor-ledger', requireRole(readerRoles), getSubcontractorLedger);
router.get('/beneficiary-suggestions', requireRole(readerRoles), searchProjectsBeneficiaries);
router.get('/beneficiary-master', requireRole(readerRoles), getProjectsBeneficiaries);
router.get('/indian-banks', requireRole(readerRoles), getIndianBanks);
router.get('/:id', requireRole(readerRoles), getRequisitionById);

// Create endpoint
router.post('/', requireRole(requesterRoles), validateRequest(createRequisitionSchema), createRequisition);

// Master data endpoints (Beneficiary & Indian Bank)
router.put('/beneficiary-master', requireRole(readerRoles), validateRequest(upsertProjectsBeneficiarySchema), upsertProjectsBeneficiary);
router.put('/indian-banks', requireRole(adminRoles), validateRequest(upsertIndianBankSchema), upsertIndianBank);

// Admin balance adjustment endpoint (HO or Admin only)
router.post('/subcontractor-ledger/adjust', requireRole(adjusterRoles), validateRequest(adjustSubcontractorBalanceSchema), adjustSubcontractorBalance);

// Workflow endpoints
router.patch('/:id/action', requireRole(approverRoles), validateRequest(actOnRequisitionSchema), actOnRequisition);
router.post('/:id/pay-from-zo-balance', requireRole(routingRoles), validateRequest(payFromZoBalanceSchema), payFromZoBalance);
router.post('/:id/send-to-accounts', requireRole(routingRoles), validateRequest(sendToAccountsSchema), sendToAccounts);
router.patch('/:id/cancel', requireRole(requesterRoles), validateRequest(cancelRequisitionSchema), cancelRequisition);
router.post('/:id/retry-attachment-cleanup', requireRole(requesterRoles), retryCancelledRequisitionAttachmentCleanup);

// Upload endpoints (JE only)
router.post('/upload/requisition-pdf', requireRole(uploadRoles), upload.single('file'), uploadRequisitionPdf);
router.post('/upload/gst-bill', requireRole(uploadRoles), upload.single('file'), uploadGstBillPdf);
router.delete('/upload/requisition-pdf', requireRole(uploadRoles), deleteRequisitionPdf);
router.delete('/upload/gst-bill', requireRole(uploadRoles), deleteGstBillPdf);

module.exports = router;
