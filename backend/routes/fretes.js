const express = require('express');
const router = express.Router();
const fretesController = require('../controllers/fretesController');
const freteDocumentosController = require('../controllers/freteDocumentosController');
const freteEpodController = require('../controllers/freteEpodController');
const freteOcorrenciasController = require('../controllers/freteOcorrenciasController');
const freteLocalizacaoController = require('../controllers/freteLocalizacaoController');
const { verifyToken, isAdmin } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { verificarPlano } = require('../middlewares/verificarPlano');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const uploadDocumento = require('../middlewares/uploadDocumento');
const { createFreteSchema, updateFreteSchema } = require('../schemas/fretes');
const { registrarEpodSchema, atualizarEpodSchema, validarEvidenciaSchema, rejeitarComprovacaoSchema } = require('../schemas/freteEpod');
const { criarOcorrenciaSchema, atualizarOcorrenciaSchema } = require('../schemas/freteOcorrencias');
const { localizacaoSchema, localizacaoEstadoSchema } = require('../schemas/freteLocalizacao');

router.use(verifyToken, verificarEmpresa, verificarPlano);

router.get('/', fretesController.getAll);
router.post('/', validate(createFreteSchema), fretesController.create);
router.get('/localizacao/sessao', freteLocalizacaoController.obterSessao);
router.post('/localizacao/sessao', validate(localizacaoSchema), freteLocalizacaoController.registrarSessao);
router.post('/localizacao/sessao/estado', validate(localizacaoEstadoSchema), freteLocalizacaoController.registrarEstadoSessao);
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

// ePOD — comprovacao de entrega digital (1 por frete). Bucket privado
// `fretes-evidencias`. Motorista/admin registram e anexam; so admin valida.
// Rastreamento leve: somente observacao operacional, sem alterar status.
router.get('/:id/localizacao', freteLocalizacaoController.obter);
router.post('/:id/localizacao', validate(localizacaoSchema), freteLocalizacaoController.registrar);
router.post('/localizacoes/limpar-vencidas', isAdmin, freteLocalizacaoController.limparVencidas);

router.get('/:id/epod', freteEpodController.obter);
router.post('/:id/epod', validate(registrarEpodSchema), freteEpodController.registrar);
router.patch('/:id/epod', validate(atualizarEpodSchema), freteEpodController.atualizar);
router.post('/:id/epod/evidencias', uploadDocumento.single('evidencia'), freteEpodController.uploadEvidencia);
router.get('/:id/epod/evidencias/:evidId/url', freteEpodController.getEvidenciaUrl);
// Validação POR EVIDÊNCIA (admin) + overrides no ePOD inteiro.
router.post('/:id/epod/evidencias/:evidId/validacao', validate(validarEvidenciaSchema), freteEpodController.validarEvidencia);
router.post('/:id/epod/rejeitar', validate(rejeitarComprovacaoSchema), freteEpodController.rejeitarComprovacao);
router.post('/:id/epod/aprovar-pendentes', freteEpodController.aprovarPendentes);

// Ocorrencias logisticas (N por frete). So admin muda o status.
router.get('/:id/ocorrencias', freteOcorrenciasController.listar);
router.post('/:id/ocorrencias', validate(criarOcorrenciaSchema), freteOcorrenciasController.criar);
router.patch('/:id/ocorrencias/:ocorrenciaId', validate(atualizarOcorrenciaSchema), freteOcorrenciasController.atualizar);
router.post('/:id/ocorrencias/:ocorrenciaId/evidencias', uploadDocumento.single('evidencia'), freteOcorrenciasController.uploadEvidencia);
router.get('/:id/ocorrencias/:ocorrenciaId/evidencias/:evidId/url', freteOcorrenciasController.getEvidenciaUrl);

router.patch('/:id', validate(updateFreteSchema), fretesController.update);
router.delete('/:id', isAdmin, fretesController.delete);

module.exports = router;
