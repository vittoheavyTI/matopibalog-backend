const express = require('express');
const router = express.Router();
const fretesController = require('../controllers/fretesController');
const freteDocumentosController = require('../controllers/freteDocumentosController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const uploadDocumento = require('../middlewares/uploadDocumento');
const { createFreteSchema, updateFreteSchema } = require('../schemas/fretes');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', fretesController.getAll);
router.post('/', validate(createFreteSchema), fretesController.create);
router.get('/:id', fretesController.getById);
router.post('/:id/odometro/inicial', upload.single('foto'), fretesController.uploadOdometroInicial);
router.post('/:id/odometro/final', upload.single('foto'), fretesController.uploadOdometroFinal);
router.get('/:id/odometro/:tipo/url', fretesController.getOdometroSignedUrl);
router.post('/:id/finalizar', fretesController.finalizar);
// Documentos fiscais do frete (CTe/MDF-e/NF-e e outros). Bucket privado,
// acesso por empresa/frete. Sem DELETE no piloto.
router.get('/:id/documentos', freteDocumentosController.listar);
router.post('/:id/documentos', uploadDocumento.single('documento'), freteDocumentosController.upload);
router.get('/:id/documentos/:docId/url', freteDocumentosController.getSignedUrl);
router.patch('/:id', validate(updateFreteSchema), fretesController.update);
router.delete('/:id', isAdmin, fretesController.delete);

module.exports = router;
