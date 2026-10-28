const router = require('express').Router();
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const { requireCurrentAdmin } = require('./hrEmployees.routes');
const schema = require('../validation/hrPayStructures.schema');
const controller = require('../controllers/hrPayStructures.controller');

router.use(verifyJwt, requireRole(['admin']), requireCurrentAdmin);

router.get('/', controller.listPayStructures);
router.get('/employees/:employeeId', validateRequest(schema.employeeParam), controller.getEmployeePayStructures);
router.get('/employees/:employeeId/payroll-context', validateRequest(schema.payrollContext), controller.payrollContext);
router.post('/payroll-salary', validateRequest(schema.payrollSalary), controller.savePayrollSalary);
router.post('/initial-assignment', validateRequest(schema.initialAssignment), controller.initialAssignment);
router.post('/:id/suspend', validateRequest(schema.idParam), controller.suspendPayStructure);

module.exports = router;
