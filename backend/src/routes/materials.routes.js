const express = require('express');
const {
  getMaterials,
  getMaterialById,
  createMaterial,
  updateMaterial,
  updateMaterialStatus,
  getMaterialCategories,
  getSubHeadsByMainHead
} = require('../controllers/materials.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// Guard all material routes with JWT Verification
router.use(verifyJwt);

// General staff and admin access for reading
router.get('/categories', getMaterialCategories);
router.get('/subheads', getSubHeadsByMainHead);
router.get('/', getMaterials);
router.get('/:id', getMaterialById);

// Admin and JE may add/deactivate materials; editing existing details remains admin-only.
router.post('/', requireRole(['admin', 'je']), createMaterial);
router.put('/:id', requireRole(['admin']), updateMaterial);
router.patch('/:id/status', requireRole(['admin', 'je']), updateMaterialStatus);

module.exports = router;
