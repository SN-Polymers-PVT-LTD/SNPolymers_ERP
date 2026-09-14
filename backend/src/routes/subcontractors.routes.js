const express = require('express');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const schemas = require('../validation/subcontractMasters.schema');
const controller = require('../controllers/subcontractors.controller');

const router = express.Router();
router.use(verifyJwt);
router.get('/', validateRequest(schemas.subcontractorListSchema), controller.getSubcontractors);
router.get('/:id', validateRequest(schemas.subcontractorIdSchema), controller.getSubcontractorById);
router.post('/', requireRole(['je', 'admin']), validateRequest(schemas.subcontractorCreateSchema), controller.createSubcontractor);
router.put('/:id', requireRole(['admin']), validateRequest(schemas.subcontractorUpdateSchema), controller.updateSubcontractor);
router.patch('/:id/status', requireRole(['admin']), validateRequest(schemas.subcontractorStatusSchema), controller.updateSubcontractorStatus);
module.exports = router;
