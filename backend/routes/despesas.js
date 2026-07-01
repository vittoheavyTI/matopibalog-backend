const express = require('express');
const router = express.Router();
const despesasController = require('../controllers/despesasController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { createDespesaSchema } = require('../schemas/despesas');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', despesasController.getAll);
router.post('/', upload.single('foto'), validate(createDespesaSchema), despesasController.create);
router.get('/:id', despesasController.getById);
router.patch('/:id', despesasController.update);

module.exports = router;
