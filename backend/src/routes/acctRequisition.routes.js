const express = require('express');
const {
  createSheet, getSheets, getSheetById, addLineItem, updateLineItem,
  deleteLineItem, submitSheet, actOnLineItem, resubmitLineItem, reopenLineItem,
  getBankBalances, upsertBankBalance, lookupBeneficiary, upsertBeneficiary,
  getAccountSubTitles, upsertAccountSubTitle, exportBulkNeft
} = require('../controllers/acctRequisition.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema,
  resubmitLineItemSchema, reopenLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  exportNeftSchema
} = require('../validation/acctRequisition.schema');

const router = express.Router();
router.use(verifyJwt);

const accountsRoles = ['accounts', 'admin'];
const hoRoles = ['ho', 'admin'];
const readerRoles = ['accounts', 'ho', 'admin'];

router.get('/bank-balances', requireRole(readerRoles), getBankBalances);
router.put('/bank-balances', requireRole(accountsRoles), validateRequest(upsertBankBalanceSchema), upsertBankBalance);
router.get('/account-sub-titles', requireRole(readerRoles), getAccountSubTitles);
router.put('/account-sub-titles', requireRole(accountsRoles), validateRequest(upsertAccountSubTitleSchema), upsertAccountSubTitle);
router.get('/beneficiary', requireRole(accountsRoles), lookupBeneficiary);
router.put('/beneficiary', requireRole(accountsRoles), validateRequest(upsertBeneficiarySchema), upsertBeneficiary);
router.get('/sheets', requireRole(readerRoles), getSheets);
router.get('/sheets/:sheetId', requireRole(readerRoles), getSheetById);
router.post('/sheets', requireRole(accountsRoles), createSheet);
router.post('/sheets/:sheetId/submit', requireRole(accountsRoles), submitSheet);
router.post('/sheets/:sheetId/export-neft', requireRole(accountsRoles), validateRequest(exportNeftSchema), exportBulkNeft);
router.post('/sheets/:sheetId/items', requireRole(accountsRoles), validateRequest(addLineItemSchema), addLineItem);
router.patch('/sheets/:sheetId/items/:itemId', requireRole(accountsRoles), validateRequest(updateLineItemSchema), updateLineItem);
router.delete('/sheets/:sheetId/items/:itemId', requireRole(accountsRoles), deleteLineItem);
router.patch('/items/:itemId/action', requireRole(hoRoles), validateRequest(actOnLineItemSchema), actOnLineItem);
router.post('/items/:itemId/resubmit', requireRole(accountsRoles), validateRequest(resubmitLineItemSchema), resubmitLineItem);
router.post('/items/:itemId/reopen', requireRole(hoRoles), validateRequest(reopenLineItemSchema), reopenLineItem);

module.exports = router;
