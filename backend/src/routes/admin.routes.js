const express = require('express');
const { getUsers, addUser, updateUser, removeUser, getSessions } = require('../controllers/admin.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Guard all endpoints under /admin with JWT Verification and Admin access role enforcement
router.use(verifyJwt);
router.use(requireAdmin);

// User Whitelist CRUD Endpoints
router.get('/users', getUsers);
router.post('/users', addUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', removeUser);

// Audit Logging Endpoint
router.get('/sessions', getSessions);

module.exports = router;
