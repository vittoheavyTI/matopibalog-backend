const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
const supabase = require('../config/supabase');
const { verifyToken } = require('../middlewares/auth');
const { ensureEffective } = require('../middlewares/requirePermission');
const { verificarEmpresa } = require('../middlewares/tenant');
const { resolveAsaasApiKey } = require('../utils/asaasConfig');
const {
  aceitarContrato,
  carregarPlanoComercial,
  criarCobrancaImplantacaoContrato,
  listarContratacaoEmpresa,
  resumoContratacaoEmpresa,
} = require('../services/contratacaoComercialService');
const {
  BUCKET_CONTRATOS,
  caminhoContratoAssinado,
  criarUrlAssinadaContrato,
  criarUrlAssinadaCertificado,
  validarPdfAssinado,
} = require('../services/contratacaoStorageService');
const {
  montarSnapshotProposta,
} = require('../services/contratacaoComercialDomainService');
const {
  iniciarAquisicaoComercial,
  registrarNaoContinuar,
} = require('../services/aquisicaoComercialService');
const { carregarPreviewUpgrade } = require('../services/previewUpgradeService');
const { solicitarAddons } = require('../services/solicitacoesComerciaisService');
const {
  confirmarAssinatura,
  solicitarDesafioAssinatura,
  verificarContratoPublico,
} = require('../services/assinaturaEletronicaInternaService');
const {
  MSG_SANDBOX_OBRIGATORIO,
  criarCobrancaImplantacaoPositiva,
  validarSandboxImplantacao,
} = require('../services/implantacaoCobrancaService');
const { carregarSituacaoComercial } = require('../services/situacaoComercialService');
const { emitirEventoBilling } = require('../services/billing/billingTriggers');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitidos = new Set(['application/pdf']);
    if (!permitidos.has(file.mimetype)) {
      const err = new Error('Formato de arquivo nao permitido. Use PDF.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    return cb(null, true);
  },
});

// Quem pode agir sobre o CONTRATO do próprio tenant. Duas autoridades distintas,
// e a segunda não é redundante com a primeira:
//
//  1) capacidade delegável `company.settings.manage` — ato contratual da empresa.
//     Era `role==='admin'` (RBV9-INV-110), que não distinguia ninguém interno: um
//     Operador aceitava contrato e assinava em nome da empresa.
//  2) o DONO de uma empresa AUTÔNOMA. O cadastro autônomo self-service cria o
//     usuário como tipo 'motorista' e o template Motorista não concede — nem deve
//     conceder — capacidade administrativa. Ele é o dono e precisa assinar o
//     próprio contrato, então a exceção continua explícita.
//
// Motorista VINCULADO a uma transportadora não passa por nenhuma das duas
// (empresa tipo != autonomo). Roda após verificarEmpresa. Fail-closed.
async function permitirAssinaturaCliente(req, res, next) {
  if (req.user && req.user.is_super_admin === true) return next();
  try {
    const efetivo = await ensureEffective(req);
    if (efetivo && efetivo.permissions && efetivo.permissions['company.settings.manage'] === true) return next();
  } catch { /* fail-closed: cai na exceção do autônomo abaixo */ }
  try {
    if (!req.empresa_id) return res.status(403).json({ message: 'Acesso restrito.' });
    const { data: emp, error } = await supabase
      .from('empresas')
      .select('tipo')
      .eq('id', req.empresa_id)
      .maybeSingle();
    if (!error && emp && emp.tipo === 'autonomo') return next();
  } catch { /* fail-closed */ }
  return res.status(403).json({ message: 'Acesso restrito para administradores.' });
}

async function carregarIntegracaoAsaas() {
  const { data } = await supabase
    .from('configuracoes')
    .select('dados')
    .eq('id', 1)
    .single();
  return data?.dados?.['integracao_asaas'] || {};
}

function montarConfigAsaas(integracoes) {
  const environment = integracoes.environment || 'sandbox';
  return {
    apiKey: resolveAsaasApiKey(integracoes),
    environment,
    baseURL: environment === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://sandbox.asaas.com/api/v3',
  };
}

router.post('/propostas/preview', async (req, res) => {
  const { plano_id, quantidade_contratada } = req.body || {};
  const { plano, error } = await carregarPlanoComercial(supabase, plano_id);
  if (error) return res.status(500).json({ message: 'Erro ao carregar plano.' });
  if (!plano || plano.ativo !== true) return res.status(404).json({ message: 'Plano nao encontrado.' });

  const snapshot = montarSnapshotProposta({
    plano,
    quantidadeContratada: quantidade_contratada,
    trialDias: plano.dias_trial || 0,
  });
  if (!snapshot.ok) {
    return res.status(422).json({ message: 'Nao foi possivel montar a proposta.', motivo: snapshot.motivo });
  }
  return res.json({ proposta: snapshot.proposta });
});

router.get('/verificar/:token', async (req, res) => {
  try {
    const r = await verificarContratoPublico({ supabase, token: req.params.token });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/verificar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao verificar contrato.' });
  }
});

router.get('/minha', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const resultado = await listarContratacaoEmpresa({ supabase, empresaId: req.empresa_id });
    return res.json(resultado);
  } catch (err) {
    console.error('[contratacao/minha] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao carregar contratacao.' });
  }
});

// Resumo enxuto para a navegação do cliente (sidebar): há pendência obrigatória?
// contrato concluído? Sempre 200 (fail-open) para nunca quebrar o menu.
router.get('/status', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.json({ pendencia_obrigatoria: false, tem_contrato: false, concluido: false });
  try {
    const resumo = await resumoContratacaoEmpresa({ supabase, empresaId: req.empresa_id });
    const situacao = await carregarSituacaoComercial(supabase, req.empresa_id);
    const trialSemContratoObrigatorio = ['trial_ativo', 'trial_expirando'].includes(situacao?.situacao);
    return res.json({
      ...resumo,
      pendencia_obrigatoria: trialSemContratoObrigatorio ? false : resumo.pendencia_obrigatoria,
      assinatura_pendente: situacao?.acoes?.assinar_contrato === true,
      situacao: situacao?.situacao || null,
      trial_ativo: ['trial_ativo', 'trial_expirando'].includes(situacao?.situacao),
      trial_expirado: ['trial_expirado_aguardando_decisao', 'trial_encerrado_sem_contratacao'].includes(situacao?.situacao),
      trial_ends_at: situacao?.trial_ends_at || null,
      dias_restantes: situacao?.dias_restantes ?? null,
      plano_id: situacao?.plano_id || null,
      quantidade_contratada: situacao?.quantidade_contratada ?? null,
      aquisicao_explicita: situacao?.aquisicao_explicita === true,
      pode_declinar: situacao?.situacao === 'trial_expirado_aguardando_decisao',
      pode_contratar: situacao?.acoes?.assinar_contrato === true
        ? false
        : (situacao?.acoes?.converter === true || ['trial_ativo', 'trial_expirando'].includes(situacao?.situacao)),
    });
  } catch (err) {
    console.error('[contratacao/status] Falha', { status: 500 });
    return res.json({ pendencia_obrigatoria: false, tem_contrato: false, concluido: false });
  }
});

// Situação comercial canônica do tenant (fonte única para painel e app):
// trial gratuito, dias restantes, decisão pós-trial, pagamentos iniciais, ações
// permitidas. Backend é a autoridade — NUNCA cria cobrança (efeito colateral de GET).
router.get('/situacao', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  try {
    const situ = await carregarSituacaoComercial(supabase, req.empresa_id);
    return res.json(situ);
  } catch (err) {
    console.error('[contratacao/situacao] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao carregar situacao comercial.' });
  }
});

router.post('/iniciar', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await iniciarAquisicaoComercial({
      supabase,
      empresaId: req.empresa_id,
      usuarioId: req.user.uid,
      planoId: req.body?.plano_id,
      quantidadeContratada: req.body?.quantidade_contratada,
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/iniciar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao iniciar contratacao.' });
  }
});

// Preview READ-ONLY do snapshot de upgrade/add-ons (Fatia 1). Não escreve, não
// cobra, não muda plano. Só admin/owner (permitirAssinaturaCliente). Calcula
// plano atual × alvo + add-ons (R$149,90) + diferença + recomendação.
router.post('/plano-preview', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await carregarPreviewUpgrade(supabase, {
      empresaId: req.empresa_id,
      planoAlvoId: req.body?.plano_alvo_id || null,
      quantidade: Number(req.body?.quantidade) || null,
      addonsSelecionados: Array.isArray(req.body?.addons_selecionados) ? req.body.addons_selecionados : [],
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/plano-preview] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao calcular o preview de plano.' });
  }
});

// Cliente (admin/owner) solicita serviços adicionais (add-ons). Cria registro
// PENDENTE (empresa_funcionalidades) para o super-admin analisar — SEM cobrança,
// SEM ativar entitlement, SEM tocar Asaas. Idempotente.
router.post('/solicitar-addons', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await solicitarAddons({
      supabase,
      empresaId: req.empresa_id,
      usuarioId: req.user?.uid,
      codigos: Array.isArray(req.body?.addons) ? req.body.addons : [],
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/solicitar-addons] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao registrar solicitacao de servicos adicionais.' });
  }
});

router.post('/nao-continuar', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await registrarNaoContinuar({
      supabase,
      empresaId: req.empresa_id,
      usuarioId: req.user.uid,
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/nao-continuar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao registrar decisao.' });
  }
});

router.post('/contratos/:id/aceitar', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await aceitarContrato({
      supabase,
      contratoId: req.params.id,
      empresaId: req.empresa_id,
      usuarioId: req.user.uid,
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/contratos/aceitar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao aceitar contrato.' });
  }
});

router.post('/contratos/:id/cobranca-implantacao', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    let integracoesAsaas = null;
    const cobrancaImplantacao = {
      validar: async () => {
        integracoesAsaas = integracoesAsaas || await carregarIntegracaoAsaas();
        validarSandboxImplantacao({ environment: integracoesAsaas.environment || 'sandbox' });
      },
      executar: async ({ proposta }) => {
        integracoesAsaas = integracoesAsaas || await carregarIntegracaoAsaas();
        const config = montarConfigAsaas(integracoesAsaas);
        return criarCobrancaImplantacaoPositiva({
          supabase,
          http: axios,
          config,
          empresaId: req.empresa_id,
          proposta,
        });
      },
    };
    const r = await criarCobrancaImplantacaoContrato({
      supabase,
      contratoId: req.params.id,
      empresaId: req.empresa_id,
      usuarioId: req.user.uid,
      cobrancaImplantacao,
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    if (err.status === 403 && err.motivo === 'sandbox_obrigatorio') {
      return res.status(403).json({ message: MSG_SANDBOX_OBRIGATORIO });
    }
    console.error('[contratacao/contratos/cobranca-implantacao] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao gerar cobranca de implantacao.' });
  }
});

router.post('/contratos/:id/assinatura/desafio', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await solicitarDesafioAssinatura({
      supabase,
      contratoId: req.params.id,
      empresaId: req.empresa_id,
      usuarioId: req.user.uid,
      papel: 'cliente',
      senha: req.body?.senha,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/assinatura/desafio] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao solicitar codigo de assinatura.' });
  }
});

router.post('/contratos/:id/assinatura/confirmar', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const r = await confirmarAssinatura({
      supabase,
      contratoId: req.params.id,
      empresaId: req.empresa_id,
      usuarioId: req.user.uid,
      papel: 'cliente',
      codigo: req.body?.codigo,
      consentimentoAceito: req.body?.consentimento_aceito === true,
      declaracaoPoderes: req.body?.declaracao_poderes === true,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    // 3A-2: assinatura concluída → gatilho de billing (fail-open, idempotente).
    // O worker do outbox garante customer/assinatura respeitando o trial.
    if (r.status >= 200 && r.status < 300) {
      try { await emitirEventoBilling(supabase, { empresaId: req.empresa_id, tipo: 'contrato_assinado' }); }
      catch { /* fail-open: reconcile recupera */ }
    }
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/assinatura/confirmar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao confirmar assinatura.' });
  }
});

router.post('/contratos/:id/upload-assinado', verifyToken, verificarEmpresa, permitirAssinaturaCliente, upload.single('arquivo'), async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  const arquivo = validarPdfAssinado(req.file);
  if (!arquivo.ok) return res.status(arquivo.status).json({ message: arquivo.message });
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!contrato || contrato.empresa_id !== req.empresa_id) {
      return res.status(404).json({ message: 'Contrato nao encontrado.' });
    }

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const path = caminhoContratoAssinado({ empresaId: req.empresa_id, contratoId: contrato.id });
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_CONTRATOS)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;

    const agora = new Date().toISOString();
    await supabase.from('contratos_comerciais')
      .update({ signed_storage_path: path, signed_file_hash: hash, status: 'assinado', atualizado_em: agora })
      .eq('id', contrato.id)
      .eq('empresa_id', req.empresa_id);
    await supabase.from('contrato_eventos').insert({
      contrato_id: contrato.id,
      empresa_id: req.empresa_id,
      tipo: 'upload_manual_assinado',
      detalhe: { arquivo: 'pdf', hash },
      criado_por: req.user.uid,
    });

    return res.status(201).json({ id: contrato.id, status: 'assinado', arquivo: 'contrato assinado recebido' });
  } catch (err) {
    console.error('[contratacao/upload-assinado] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao salvar contrato assinado.' });
  }
});

router.get('/contratos/:id/assinado-url', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id, signed_storage_path')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;

    const r = await criarUrlAssinadaContrato({ supabase, contrato, empresaId: req.empresa_id });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/assinado-url] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao abrir contrato assinado.' });
  }
});

router.get('/contratos/:id/certificado-url', verifyToken, verificarEmpresa, permitirAssinaturaCliente, async (req, res) => {
  if (!req.empresa_id) return res.status(400).json({ message: 'Empresa nao identificada.' });
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id, certificate_storage_path')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;

    const r = await criarUrlAssinadaCertificado({ supabase, contrato, empresaId: req.empresa_id });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[contratacao/certificado-url] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao abrir certificado do contrato.' });
  }
});

module.exports = router;
