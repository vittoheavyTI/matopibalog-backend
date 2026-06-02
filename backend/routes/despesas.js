const express = require('express');
const router = express.Router();
const multer = require('multer');
const despesasController = require('../controllers/despesasController');
const { verifyToken } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { createDespesaSchema } = require('../schemas/despesas');

const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);

router.get('/', despesasController.getAll);
router.post('/', upload.single('foto'), validate(createDespesaSchema), despesasController.create);
router.get('/:id', despesasController.getById);
router.patch('/:id', despesasController.update);

module.exports = router;
