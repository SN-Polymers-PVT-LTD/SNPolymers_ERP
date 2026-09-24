const router = require('express').Router();
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const { requireCurrentAdmin } = require('./hrEmployees.routes');
const schema = require('../validation/hrPayStructures.schema');
const controller = require('../controllers/hrPayStructures.controller');

router.use(verifyJwt, requireRole(['admin']), requireCurrentAdmin);

router.get('/employees/:employeeId', validateRequest(schema.employeeParam), controller.getEmployeePayStructures);
router.post('/', validateRequest(schema.create), controller.createPayStructure);
router.post('/:id/activate', validateRequest(schema.idParam), controller.activatePayStructure);
router.post('/:id/suspend', validateRequest(schema.idParam), controller.suspendPayStructure);
router.patch('/:id', validateRequest(schema.update), controller.updateDraftPayStructure);

module.exports = router;
