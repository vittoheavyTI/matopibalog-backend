const express = require('express');
const router = express.Router();
const fretesController = require('../controllers/fretesController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { createFreteSchema, updateFreteSchema } = require('../schemas/fretes');

router.use(verifyToken);

router.get('/', fretesController.getAll);
router.post('/', validate(createFreteSchema), fretesController.create);
router.get('/:id', fretesController.getById);
router.patch('/:id', validate(updateFreteSchema), fretesController.update);
router.delete('/:id', isAdmin, fretesController.delete);

module.exports = router;
