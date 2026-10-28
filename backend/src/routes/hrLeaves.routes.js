const router = require('express').Router();
const verifyJwt = require('../middleware/verifyJwt');
const requireCurrentHrRole = require('../middleware/requireCurrentHrRole');
const validateRequest = require('../middleware/validateRequest');
const schema = require('../validation/hrLeaves.schema');
const controller = require('../controllers/hrLeaves.controller');

// Self-service employee routes (accessible by any linked active employee regardless of ERP role)
router.get('/context', verifyJwt, controller.context);
router.get('/my-requests', verifyJwt, controller.myRequests);
router.post('/self-service', verifyJwt, validateRequest(schema.create), controller.create);
router.put('/self-service/:id', verifyJwt, validateRequest(schema.update), controller.update);

// HO / Admin review and decision routes
router.get('/review-queue', verifyJwt, requireCurrentHrRole(['admin', 'ho']), validateRequest(schema.queue), controller.queue);
router.post('/:id/decision', verifyJwt, requireCurrentHrRole(['admin', 'ho']), validateRequest(schema.decision), controller.decide);

module.exports = router;
