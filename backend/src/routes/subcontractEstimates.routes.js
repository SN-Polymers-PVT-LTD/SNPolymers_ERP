const express = require('express');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const controller = require('../controllers/subcontractEstimates.controller');
const schemas = require('../validation/subcontractEstimates.schema');

const router = express.Router();
router.use(verifyJwt);
router.get('/summary', requireRole(controller.readerRoles), controller.getSubcontractEstimateSummary);
router.get('/init', requireRole(['je', 'admin']), controller.getInit);
router.get('/', requireRole(controller.readerRoles), validateRequest(schemas.listSchema), controller.getSubcontractEstimates);
router.post('/', requireRole(['je', 'admin']), validateRequest(schemas.createSchema), controller.createSubcontractEstimate);
router.get('/:id', requireRole(controller.readerRoles), validateRequest(schemas.idSchema), controller.getSubcontractEstimate);
router.put('/:id/lines', requireRole(['je', 'admin']), validateRequest(schemas.saveLinesSchema), controller.saveDraftLines);
module.exports = router;
