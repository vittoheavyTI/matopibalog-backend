const express = require('express');
const router = express.Router();
const fretesController = require('../controllers/fretesController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const { createFreteSchema, updateFreteSchema } = require('../schemas/fretes');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', fretesController.getAll);
router.post('/', validate(createFreteSchema), fretesController.create);
router.get('/:id', fretesController.getById);
router.post('/:id/finalizar', fretesController.finalizar);
router.patch('/:id', validate(updateFreteSchema), fretesController.update);
router.delete('/:id', isAdmin, fretesController.delete);

module.exports = router;
