const express = require('express');
const router = express.Router();
const multer = require('multer');
const valesController = require('../controllers/valesController');
const { verifyToken } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { createValeSchema } = require('../schemas/vales');

const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);

router.get('/', valesController.getAll);
router.post('/', upload.single('foto'), validate(createValeSchema), valesController.create);
router.get('/:id', valesController.getById);
router.patch('/:id', valesController.update);

module.exports = router;
