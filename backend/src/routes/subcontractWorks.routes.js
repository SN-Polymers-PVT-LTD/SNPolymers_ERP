const express = require('express');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const schemas = require('../validation/subcontractMasters.schema');
const controller = require('../controllers/subcontractWorks.controller');

const router = express.Router();
router.use(verifyJwt);
router.get('/', validateRequest(schemas.workListSchema), controller.getSubcontractWorks);
router.get('/:id', validateRequest(schemas.workIdSchema), controller.getSubcontractWorkById);
router.post('/', requireRole(['je', 'admin']), validateRequest(schemas.workCreateSchema), controller.createSubcontractWork);
router.put('/:id', requireRole(['admin']), validateRequest(schemas.workUpdateSchema), controller.updateSubcontractWork);
router.patch('/:id/status', requireRole(['admin']), validateRequest(schemas.workStatusSchema), controller.updateSubcontractWorkStatus);
module.exports = router;
