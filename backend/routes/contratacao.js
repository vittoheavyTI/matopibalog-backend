const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin } = require('../middlewares/auth');
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

// Quem pode agir sobre o CONTRATO do próprio tenant: admin/super-admin OU o DONO
// de uma empresa AUTÔNOMA (cadastro autônomo self-service cria o usuário como
// tipo 'motorista', que não é admin — mas é o dono e precisa assinar o próprio
// contrato). Roda após verificarEmpresa (usa req.empresa_id). Motorista vinculado
// a uma transportadora NÃO passa (empresa tipo != autonomo). Fail-closed.
async function permitirAssinaturaCliente(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.is_super_admin === true)) return next();
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
    return res.json(resumo);
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
