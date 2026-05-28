const express = require('express');
const router = express.Router();
const fretesController = require('../controllers/fretesController');
const { verifyToken, isAdmin } = require('../middlewares/auth');

router.use(verifyToken);

router.get('/', fretesController.getAll);
router.post('/', fretesController.create);
router.get('/:id', fretesController.getById);
router.patch('/:id', fretesController.update);
router.delete('/:id', isAdmin, fretesController.delete);

module.exports = router;
