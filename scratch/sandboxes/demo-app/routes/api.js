const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const dataController = require('../controllers/dataController');

// User Routes
router.get('/users', userController.getAllUsers);
router.post('/users', userController.createUser);
router.get('/users/:id', userController.getUserById);
router.put('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);

// Data Routes
router.get('/data', dataController.getAllData);
router.post('/data', dataController.createData);
router.get('/data/:id', dataController.getDataById);
router.put('/data/:id', dataController.updateData);
router.delete('/data/:id', dataController.deleteData);

module.exports = router;