const express = require('express');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const schemas = require('../validation/subcontractMasters.schema');
const controller = require('../controllers/subcontractors.controller');

const router = express.Router();
router.use(verifyJwt);
const readerRoles = ['je', 'zo', 'ho', 'admin'];
router.get('/', requireRole(readerRoles), validateRequest(schemas.subcontractorListSchema), controller.getSubcontractors);
router.get('/:id', requireRole(readerRoles), validateRequest(schemas.subcontractorIdSchema), controller.getSubcontractorById);
router.post('/', requireRole(['je', 'admin']), validateRequest(schemas.subcontractorCreateSchema), controller.createSubcontractor);
router.put('/:id', requireRole(['admin']), validateRequest(schemas.subcontractorUpdateSchema), controller.updateSubcontractor);
router.patch('/:id/status', requireRole(['admin']), validateRequest(schemas.subcontractorStatusSchema), controller.updateSubcontractorStatus);
module.exports = router;
