const express = require('express');
const router = express.Router();
const multer = require('multer');
const abastecimentosController = require('../controllers/abastecimentosController');
const { verifyToken } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { createAbastecimentoSchema } = require('../schemas/abastecimentos');

const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);

router.get('/', abastecimentosController.getAll);
router.post('/', upload.single('foto'), validate(createAbastecimentoSchema), abastecimentosController.create);
router.get('/:id', abastecimentosController.getById);
router.patch('/:id', abastecimentosController.update);

module.exports = router;
