const express = require('express');
const {
  createSheet, getSheets, getSheetById, getLineItems, deleteSheetIfEmpty, addLineItem, updateLineItem,
  deleteLineItem, submitSheet, actOnLineItem, actOnLineItemsBatch, closeSheetReview, resubmitLineItem,
  getImportEligibleItems, importLineItem, dismissImportEligibleItem,
  getBankBalances, upsertBankBalance, getBankBalanceLedger, lookupBeneficiary, searchBeneficiariesByAcNo, upsertBeneficiary,
  getBeneficiaries, getAccountSubTitles, upsertAccountSubTitle,
  getParticulars, upsertParticular,
  getIndianBanks, upsertIndianBank, exportBulkNeft,
  getRequisitionLogs
} = require('../controllers/acctRequisition.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema, actOnLineItemsBatchSchema,
  resubmitLineItemSchema,
  importLineItemSchema, dismissLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  upsertParticularsSchema,
  upsertIndianBankSchema,
  exportNeftSchema
} = require('../validation/acctRequisition.schema');

const router = express.Router();
router.use(verifyJwt);

const accountsRoles = ['accounts', 'admin'];
const hoRoles = ['ho', 'admin'];
const readerRoles = ['accounts', 'ho', 'admin'];

router.get('/bank-balances', requireRole(readerRoles), getBankBalances);
router.get('/bank-ledger', requireRole(readerRoles), getBankBalanceLedger);
router.put('/bank-balances', requireRole(accountsRoles), validateRequest(upsertBankBalanceSchema), upsertBankBalance);
router.get('/account-sub-titles', requireRole(readerRoles), getAccountSubTitles);
router.put('/account-sub-titles', requireRole(accountsRoles), validateRequest(upsertAccountSubTitleSchema), upsertAccountSubTitle);
router.get('/particulars', requireRole(readerRoles), getParticulars);
router.put('/particulars', requireRole(accountsRoles), validateRequest(upsertParticularsSchema), upsertParticular);
router.get('/beneficiary', requireRole(accountsRoles), lookupBeneficiary);
router.get('/beneficiary-suggestions', requireRole(accountsRoles), searchBeneficiariesByAcNo);
router.put('/beneficiary', requireRole(accountsRoles), validateRequest(upsertBeneficiarySchema), upsertBeneficiary);
router.get('/beneficiary-master', requireRole(readerRoles), getBeneficiaries);
router.get('/indian-banks', requireRole(readerRoles), getIndianBanks);
router.put('/indian-banks', requireRole(accountsRoles), validateRequest(upsertIndianBankSchema), upsertIndianBank);
router.get('/line-items', requireRole(readerRoles), getLineItems);
router.get('/logs', requireRole(readerRoles), getRequisitionLogs);
router.get('/sheets', requireRole(readerRoles), getSheets);
router.get('/sheets/:sheetId', requireRole(readerRoles), getSheetById);
router.post('/sheets', requireRole(accountsRoles), createSheet);
router.delete('/sheets/:sheetId', requireRole(accountsRoles), deleteSheetIfEmpty);
router.post('/sheets/:sheetId/submit', requireRole(accountsRoles), submitSheet);
router.post('/sheets/:sheetId/export-neft', requireRole(accountsRoles), validateRequest(exportNeftSchema), exportBulkNeft);
router.post('/sheets/:sheetId/items', requireRole(accountsRoles), validateRequest(addLineItemSchema), addLineItem);
router.patch('/sheets/:sheetId/items/:itemId', requireRole(accountsRoles), validateRequest(updateLineItemSchema), updateLineItem);
router.delete('/sheets/:sheetId/items/:itemId', requireRole(accountsRoles), deleteLineItem);
router.patch('/items/:itemId/action', requireRole(hoRoles), validateRequest(actOnLineItemSchema), actOnLineItem);
router.post('/sheets/:sheetId/items/batch-action', requireRole(hoRoles), validateRequest(actOnLineItemsBatchSchema), actOnLineItemsBatch);
router.post('/sheets/:sheetId/close-review', requireRole(hoRoles), closeSheetReview);
router.post('/items/:itemId/resubmit', requireRole(accountsRoles), validateRequest(resubmitLineItemSchema), resubmitLineItem);

router.get('/import-eligible-items', requireRole(accountsRoles), getImportEligibleItems);
router.post('/import-eligible-items/:itemId/import', requireRole(accountsRoles), validateRequest(importLineItemSchema), importLineItem);
router.post('/import-eligible-items/:itemId/dismiss', requireRole(accountsRoles), validateRequest(dismissLineItemSchema), dismissImportEligibleItem);

module.exports = router;
