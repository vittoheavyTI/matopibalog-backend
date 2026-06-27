const express = require('express');
const router = express.Router();
const valesController = require('../controllers/valesController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const { createValeSchema } = require('../schemas/vales');

router.use(verifyToken, verificarEmpresa);

router.get('/', valesController.getAll);
router.post('/', upload.single('foto'), validate(createValeSchema), valesController.create);
router.get('/:id', valesController.getById);
router.patch('/:id', valesController.update);

module.exports = router;
