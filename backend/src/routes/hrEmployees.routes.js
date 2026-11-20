const router = require('express').Router();
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const schema = require('../validation/hrEmployees.schema');
const controller = require('../controllers/hrEmployees.controller');
const { supabase } = require('../db/supabase');

async function requireCurrentAdmin(req, res, next) {
  const { data, error } = await supabase.from('authorised_users')
    .select('role,is_active').eq('id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Unable to verify HR access.' });
  if (!data || !data.is_active || data.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Administrator privileges required.' });
  }
  return next();
}

router.use(verifyJwt, requireRole(['admin']), requireCurrentAdmin);
router.get('/erp-users', validateRequest(schema.users), controller.listErpUsers);
router.get('/', validateRequest(schema.list), controller.listEmployees);
router.post('/', validateRequest(schema.create), controller.createEmployee);
router.get('/:id', validateRequest(schema.id), controller.getEmployee);
router.patch('/:id', validateRequest(schema.update), controller.updateEmployee);
router.patch('/:id/status', validateRequest(schema.status), controller.changeStatus);

module.exports = router;
module.exports.requireCurrentAdmin = requireCurrentAdmin;
