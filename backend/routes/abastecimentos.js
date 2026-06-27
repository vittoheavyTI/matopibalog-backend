const express = require('express');
const router = express.Router();
const abastecimentosController = require('../controllers/abastecimentosController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { createAbastecimentoSchema } = require('../schemas/abastecimentos');

router.use(verifyToken, verificarEmpresa);

router.get('/', abastecimentosController.getAll);
router.post('/', upload.single('foto'), validate(createAbastecimentoSchema), abastecimentosController.create);
router.get('/:id', abastecimentosController.getById);
router.patch('/:id', abastecimentosController.update);

module.exports = router;
