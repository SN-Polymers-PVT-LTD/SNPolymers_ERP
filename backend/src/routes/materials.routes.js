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
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Guard all material routes with JWT Verification
router.use(verifyJwt);

// General staff and admin access for reading
router.get('/categories', getMaterialCategories);
router.get('/subheads', getSubHeadsByMainHead);
router.get('/', getMaterials);
router.get('/:id', getMaterialById);

// Admin-only write and status change routes
router.post('/', requireAdmin, createMaterial);
router.put('/:id', requireAdmin, updateMaterial);
router.patch('/:id/status', requireAdmin, updateMaterialStatus);

module.exports = router;
