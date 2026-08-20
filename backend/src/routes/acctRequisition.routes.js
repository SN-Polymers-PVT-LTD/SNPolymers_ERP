const express = require('express');
const {
  createSheet, getSheets, getSheetById, addLineItem, updateLineItem,
  deleteLineItem, submitSheet, actOnLineItem, actOnLineItemsBatch, resubmitLineItem, reopenLineItem,
  getBankBalances, upsertBankBalance, getBankBalanceLedger, lookupBeneficiary, upsertBeneficiary,
  getBeneficiaries, getAccountSubTitles, upsertAccountSubTitle,
  getIndianBanks, upsertIndianBank, exportBulkNeft
} = require('../controllers/acctRequisition.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema, actOnLineItemsBatchSchema,
  resubmitLineItemSchema, reopenLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
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
router.get('/beneficiary', requireRole(accountsRoles), lookupBeneficiary);
router.put('/beneficiary', requireRole(accountsRoles), validateRequest(upsertBeneficiarySchema), upsertBeneficiary);
router.get('/beneficiary-master', requireRole(readerRoles), getBeneficiaries);
router.get('/indian-banks', requireRole(readerRoles), getIndianBanks);
router.put('/indian-banks', requireRole(accountsRoles), validateRequest(upsertIndianBankSchema), upsertIndianBank);
router.get('/sheets', requireRole(readerRoles), getSheets);
router.get('/sheets/:sheetId', requireRole(readerRoles), getSheetById);
router.post('/sheets', requireRole(accountsRoles), createSheet);
router.post('/sheets/:sheetId/submit', requireRole(accountsRoles), submitSheet);
router.post('/sheets/:sheetId/export-neft', requireRole(accountsRoles), validateRequest(exportNeftSchema), exportBulkNeft);
router.post('/sheets/:sheetId/items', requireRole(accountsRoles), validateRequest(addLineItemSchema), addLineItem);
router.patch('/sheets/:sheetId/items/:itemId', requireRole(accountsRoles), validateRequest(updateLineItemSchema), updateLineItem);
router.delete('/sheets/:sheetId/items/:itemId', requireRole(accountsRoles), deleteLineItem);
router.patch('/items/:itemId/action', requireRole(hoRoles), validateRequest(actOnLineItemSchema), actOnLineItem);
router.post('/sheets/:sheetId/items/batch-action', requireRole(hoRoles), validateRequest(actOnLineItemsBatchSchema), actOnLineItemsBatch);
router.post('/items/:itemId/resubmit', requireRole(accountsRoles), validateRequest(resubmitLineItemSchema), resubmitLineItem);
router.post('/items/:itemId/reopen', requireRole(hoRoles), validateRequest(reopenLineItemSchema), reopenLineItem);

module.exports = router;
