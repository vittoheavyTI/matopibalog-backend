const express = require('express');
const router = express.Router();
const fretesController = require('../controllers/fretesController');
const freteDocumentosController = require('../controllers/freteDocumentosController');
const freteEpodController = require('../controllers/freteEpodController');
const freteOcorrenciasController = require('../controllers/freteOcorrenciasController');
const freteLocalizacaoController = require('../controllers/freteLocalizacaoController');
const trackingCredentialController = require('../controllers/trackingCredentialController');
const { verifyToken } = require('../middlewares/auth');
const { verificarEmpresa } = require('../middlewares/tenant');
const { requirePermission } = require('../middlewares/requirePermission');
const { verificarPlano } = require('../middlewares/verificarPlano');
const { criarGuardTelemetria, exigirTracking } = require('../middlewares/trackingCredential');
const validate = require('../middlewares/validate');
const upload = require('../middlewares/upload');
const uploadDocumento = require('../middlewares/uploadDocumento');
const { createFreteSchema, updateFreteSchema, correcaoFinanceiraFreteSchema } = require('../schemas/fretes');
const { registrarEpodSchema, atualizarEpodSchema, validarEvidenciaSchema, rejeitarComprovacaoSchema } = require('../schemas/freteEpod');
const { criarOcorrenciaSchema, atualizarOcorrenciaSchema } = require('../schemas/freteOcorrencias');
const { localizacaoSchema, localizacaoEstadoSchema } = require('../schemas/freteLocalizacao');

// ─────────────────────────────────────────────────────────────────────────────
// TELEMETRIA de localização — sub-router com guard PRÓPRIO, montado ANTES do
// router.use(verifyToken) global. Aceita EITHER a credencial de rastreamento
// escopada (flag ON) OU a sessão SEC-1 normal (fluxo atual). Preserva as URLs
// existentes (/fretes/localizacao/sessao[...]) e NÃO passa pelo verifyToken global
// (uma credencial opaca não é JWT e seria rejeitada por ele). Ver §9 do mandato.
const guardTelemetria = criarGuardTelemetria();
const telemetriaSessao = express.Router();
telemetriaSessao.use(guardTelemetria);
telemetriaSessao.get('/', freteLocalizacaoController.obterSessao);
telemetriaSessao.post('/', validate(localizacaoSchema), freteLocalizacaoController.registrarSessao);
telemetriaSessao.post('/estado', validate(localizacaoEstadoSchema), freteLocalizacaoController.registrarEstadoSessao);
// Renovação TRACKING-ONLY (viagens longas): estende a validade da própria credencial.
telemetriaSessao.post('/renovar-credencial', exigirTracking, trackingCredentialController.renovar);
router.use('/localizacao/sessao', telemetriaSessao);

router.use(verifyToken, verificarEmpresa, verificarPlano);

// P2.10 — leitura de fretes por PERMISSÃO EFETIVA (freight.view). Motorista tem a key
// por template e o controller restringe ao PRÓPRIO contexto (acesso contextual); admin/
// operador/gerente veem o tenant dentro do scope. Permissão NÃO amplia scope.
router.get('/', requirePermission('freight.view'), fretesController.getAll);
// P2 — criar frete exige freight.create (admin/operador têm por padrão; motorista
// = false por padrão → fecha o gap de auto-criação por motorista). requirePermission
// libera super-admin e não altera o comportamento de quem já podia (admin).
router.post('/', requirePermission('freight.create'), validate(createFreteSchema), fretesController.create);
// Emissão da credencial de rastreamento — SEMPRE sob sessão SEC-1 (guard global acima).
router.post('/localizacao/credencial', trackingCredentialController.emitir);
// P2 — correção FINANCEIRA do frete é uma MUTAÇÃO de financeiro operacional →
// exige finance.operational.manage (não só ler). Admin tem por padrão via template
// administrador/financeiro; super-admin é authority separada. O controller mantém a
// checagem isAdmin/ownership por dentro (defesa em profundidade).
router.post('/:id/correcao-financeira', requirePermission('finance.operational.manage'), validate(correcaoFinanceiraFreteSchema), fretesController.corrigirFinanceiro);
router.get('/:id', requirePermission('freight.view'), fretesController.getById);
router.post('/:id/odometro/inicial', upload.single('foto'), fretesController.uploadOdometroInicial);
router.post('/:id/odometro/final', upload.single('foto'), fretesController.uploadOdometroFinal);
router.get('/:id/odometro/:tipo/url', fretesController.getOdometroSignedUrl);
router.post('/:id/finalizar', fretesController.finalizar);
// Documentos fiscais do frete (CTe/MDF-e/NF-e e outros). Bucket privado,
// acesso por empresa/frete. Sem DELETE no piloto.
// P2.10 — leitura de documentos por documents.view (motorista tem por template e o
// controller restringe ao próprio frete). O UPLOAD é ação CONTEXTUAL do dono do frete
// (motorista) OU gerência empresarial: documents.manage é exigido no controller SÓ para
// o caller empresarial (admin/operador/gerente), preservando o comprovante do motorista.
router.get('/:id/documentos', requirePermission('documents.view'), freteDocumentosController.listar);
router.post('/:id/documentos', uploadDocumento.single('documento'), freteDocumentosController.upload);
router.get('/:id/documentos/:docId/url', requirePermission('documents.view'), freteDocumentosController.getSignedUrl);

// ePOD — comprovacao de entrega digital (1 por frete). Bucket privado
// `fretes-evidencias`. Motorista/admin registram e anexam; so admin valida.
// Rastreamento leve: somente observacao operacional, sem alterar status.
router.get('/:id/localizacao', freteLocalizacaoController.obter);
router.post('/:id/localizacao', validate(localizacaoSchema), freteLocalizacaoController.registrar);
router.post('/localizacoes/limpar-vencidas', requirePermission('freight.manage'), freteLocalizacaoController.limparVencidas);

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

// P2.10 — edição/gestão administrativa do frete por freight.manage (não isAdmin).
// create=freight.create, finish=freight.finish, correção=finance.operational.manage
// (authorities distintas). O app do motorista NÃO chama PATCH/DELETE (usa odometro/
// finalizar dedicados); o controller mantém tenant/scope/ownership.
router.patch('/:id', requirePermission('freight.manage'), validate(updateFreteSchema), fretesController.update);
router.delete('/:id', requirePermission('freight.manage'), fretesController.delete);

module.exports = router;
