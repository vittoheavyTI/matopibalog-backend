const express = require('express');
const router = express.Router();
const multer = require('multer');
const valesController = require('../controllers/valesController');
const { verifyToken } = require('../middlewares/auth');

const upload = multer({ storage: multer.memoryStorage() });
router.use(verifyToken);

router.get('/', valesController.getAll);
router.post('/', upload.single('foto'), valesController.create);
router.get('/:id', valesController.getById);
router.patch('/:id', valesController.update);

module.exports = router;
