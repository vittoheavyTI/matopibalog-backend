const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middlewares/auth');
const { criarEmpresaCompleta } = require('../services/empresaService');
const { plano_idValido, normalizarPlanoId } = require('../utils/plano');
const { conflitoUnico } = require('../utils/pgError');
const { montarPatchArquivamento, excluirPlano } = require('../services/planoAdminService');
const { aplicarFiltroArquivamento, montarPatchArquivamentoEmpresa } = require('../services/empresaArquivamentoService');
const {
  bodyTocaPreco,
  decidirEdicaoPreco,
  montarErroReprecificacao,
  resolverCriacaoPreco,
  montarImpactoPreco,
  paraCentavos,
} = require('../services/planoPrecoService');

// Campos comerciais que NÃO entram na fórmula de preço (planoPrecoService cuida de
// preco_mensal/modelo/limite). São passthrough validado: capacidade inclusa,
// valor por motorista extra, valor inicial/implantação e "sob negociação".
// Editar estes campos NÃO reescreve contratos já emitidos (o contrato congela o
// snapshot do modelo). Money: >=0 e <=2 casas; capacidade: inteiro >=0.
function montarPatchComercial(body) {
  const patch = {};
  if (body.capacidade_inclusa !== undefined && body.capacidade_inclusa !== null && body.capacidade_inclusa !== '') {
    const n = Number(body.capacidade_inclusa);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, status: 422, body: { message: 'Capacidade inclusa deve ser um inteiro maior ou igual a zero.' } };
    }
    patch.capacidade_inclusa = n;
  }
  for (const campo of ['preco_motorista_extra', 'valor_implantacao']) {
    if (body[campo] !== undefined) {
      if (body[campo] === null || body[campo] === '') {
        patch[campo] = null;
      } else {
        const c = paraCentavos(body[campo]);
        if (!c.ok) {
          return { ok: false, status: 422, body: { message: `Valor inválido em ${campo} (use no máximo 2 casas decimais).` } };
        }
        if (c.centavos < 0) {
          return { ok: false, status: 422, body: { message: `${campo} não pode ser negativo.` } };
        }
        patch[campo] = c.centavos / 100;
      }
    }
  }
  if (body.requer_negociacao !== undefined) {
    patch.requer_negociacao = body.requer_negociacao === true;
  }
  return { ok: true, patch };
}
const { categoriaCompativelComTipo, mensagemIncompatibilidade } = require('../utils/planoCategoria');
const { resumirBillingHealth } = require('../services/billingHealthService');
const { recomendarPlano, valorEfetivoEmpresa } = require('../services/calculadoraComercialService');
const asaasSync = require('../services/asaasSyncDomainService');
const {
  aceitarContrato,
  listarContratacaoEmpresa,
} = require('../services/contratacaoComercialService');
const {
  confirmarAssinatura,
  solicitarDesafioAssinatura,
  mascararEmail,
} = require('../services/assinaturaEletronicaInternaService');
const { enviarEmail } = require('../services/emailService');
const { STATUS_CONCLUIDOS } = require('../services/contratoGateService');
const {
  BUCKET_CONTRATOS,
  caminhoContratoAssinado,
  criarUrlAssinadaContrato,
  criarUrlAssinadaCertificado,
  validarPdfAssinado,
} = require('../services/contratacaoStorageService');
const { criarPromocaoSchema, editarPromocaoSchema, gerarCodigoSchema, validar: validarPromo } = require('../schemas/promocao');
const {
  TIPOS: PROMO_TIPOS,
  normalizarCodigo,
  avaliarResgate,
  aplicarPromocao,
  montarResgate,
} = require('../services/promocaoDomainService');

router.use(verifyToken, isAdmin, isSuperAdmin);

const uploadContrato = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      const err = new Error('Formato de arquivo nao permitido. Use PDF.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    return cb(null, true);
  },
});

// Valida/resolve o plano_id recebido do cliente ANTES de tocar o banco.
// Retorna { plano_id: string|null } em caso de sucesso, ou { status, message }
// para o handler responder direto. Nunca deixa texto não-UUID chegar ao Postgres
// (evita 22P02 → 500) e barra UUID válido porém inexistente com 400.
async function resolverPlanoId(valor) {
  const plano_id = normalizarPlanoId(valor);
  if (plano_id === null) return { plano_id: null };
  if (!plano_idValido(plano_id)) {
    return { status: 400, message: 'Plano informado é inválido.' };
  }
  const { data, error } = await supabase
    .from('planos')
    .select('id, categoria')
    .eq('id', plano_id)
    .maybeSingle();
  if (error) return { status: 500, message: 'Erro ao validar plano.' };
  if (!data) return { status: 400, message: 'Plano informado não foi encontrado.' };
  return { plano_id, categoria: data.categoria };
}

// Trava de compatibilidade categoria×tipo. Retorna { status, message } quando
// incompatível (o handler responde direto), ou null quando ok / não aplicável
// (sem plano ou categoria 'ambos'). tipoEmpresa 'autonomo' vs demais.
function checarCategoriaPlano(tipoEmpresa, categoriaPlano) {
  if (categoriaPlano == null) return null; // sem plano definido
  if (categoriaCompativelComTipo(tipoEmpresa, categoriaPlano)) return null;
  return { status: 400, message: mensagemIncompatibilidade(tipoEmpresa) };
}

// BILLING HEALTH (go-live — observabilidade read-only, super-admin).
// Lê faturas, empresas (com categoria do plano) e eventos de webhook e devolve
// o retrato de saúde do billing (reservas órfãs, vencidas, duplicidade,
// suspensas sem fatura / com fatura paga, webhooks com erro, categoria
// incompatível). NÃO escreve nada e NÃO chama o Asaas.
router.get('/billing-health', async (req, res) => {
  try {
    const [faturasR, empresasR, eventosR, promocoesR, resgatesR, planosR, motoristasR, syncEstadoR] = await Promise.all([
      supabase.from('faturas').select('id, empresa_id, status, valor, origem, periodo_referencia, asaas_id, invoice_url, bank_slip_url, due_date, pago_em'),
      // `planos(*)` (em vez de lista explícita) traz capacidade_inclusa/
      // requer_negociacao SÓ SE as colunas existirem — deploy-safe: antes da
      // migration 038 elas somem do retorno sem erro (idem `*` em empresas p/ 036).
      supabase.from('empresas').select('*, planos(*)'),
      supabase.from('asaas_webhook_events').select('event_type, status, last_error, asaas_payment_id').order('created_at', { ascending: false }).limit(500),
      // FASE 4 (comercial) — leituras OPCIONAIS. Se a tabela ainda não existe
      // (migration 040 pendente) ou dá erro, seguimos com [] (fail-closed).
      supabase.from('promocoes').select('id, nome, tipo, ativo, data_inicio, data_fim'),
      supabase.from('promocao_resgates').select('promocao_id, empresa_id, manual, criado_em'),
      supabase.from('planos').select('*'),
      supabase.from('motoristas').select('empresa_id, status_cadastro'),
      supabase.from('asaas_sync_estado').select('empresa_id, status, motivo, valor_alvo, valor_sincronizado, ultimo_erro, tentativas'),
    ]);
    if (faturasR.error) return res.status(500).json({ message: 'Erro ao ler faturas.' });
    if (empresasR.error) return res.status(500).json({ message: 'Erro ao ler empresas.' });
    // Eventos de webhook são opcionais: se a leitura falhar, seguimos sem eles.
    const webhookEvents = eventosR && !eventosR.error ? (eventosR.data || []) : [];
    const promocoes = promocoesR && !promocoesR.error ? (promocoesR.data || []) : [];
    const promocaoResgates = resgatesR && !resgatesR.error ? (resgatesR.data || []) : [];
    const planos = planosR && !planosR.error ? (planosR.data || []) : [];
    const asaasSyncEstado = syncEstadoR && !syncEstadoR.error ? (syncEstadoR.data || []) : [];
    // Contagem de motoristas APROVADOS por empresa (base de "acima da capacidade").
    const contagemMotoristasPorEmpresa = {};
    if (motoristasR && !motoristasR.error) {
      for (const m of motoristasR.data || []) {
        if (!m || !m.empresa_id) continue;
        if (m.status_cadastro && m.status_cadastro !== 'aprovado') continue;
        contagemMotoristasPorEmpresa[m.empresa_id] = (contagemMotoristasPorEmpresa[m.empresa_id] || 0) + 1;
      }
    }

    const resumo = resumirBillingHealth({
      faturas: faturasR.data || [],
      empresas: empresasR.data || [],
      webhookEvents,
      promocoes,
      promocaoResgates,
      planos,
      contagemMotoristasPorEmpresa,
      asaasSyncEstado,
    });
    if (eventosR && eventosR.error) resumo.aviso_webhook = 'nao_foi_possivel_ler_eventos_webhook';
    return res.json(resumo);
  } catch (err) {
    console.error('[painel-admin/billing-health] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao gerar billing health.' });
  }
});

// DASHBOARD
router.get('/dashboard', async (req, res) => {
  try {
    const { count: totalEmpresas } = await supabase.from('empresas').select('*', { count: 'exact', head: true });
    const { count: totalMotoristas } = await supabase.from('motoristas').select('*', { count: 'exact', head: true });
    const { count: totalFretes } = await supabase.from('fretes').select('*', { count: 'exact', head: true });
    const { data: empresas } = await supabase.from('empresas').select('status');
    const ativas = (empresas || []).filter(e => e.status === 'ativo').length;
    const trial = (empresas || []).filter(e => e.status === 'trial').length;
    res.json({ totalEmpresas: totalEmpresas || 0, totalMotoristas: totalMotoristas || 0, totalFretes: totalFretes || 0, empresasAtivas: ativas, empresasTrial: trial });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao carregar dashboard.' });
  }
});

// EMPRESAS
// Por padrão a listagem OCULTA empresas arquivadas (contas de teste tiradas da
// operação). `?includeArchived=true` (super-admin, herdado do router.use) traz
// todas — para a visão de "Arquivadas" no painel. O filtro é em nível de aplicação
// (empresaArquivamentoService): onde a coluna arquivada_em ainda não existe, nada
// é filtrado e o comportamento é idêntico ao de hoje.
router.get('/empresas', async (req, res) => {
  const { data, error } = await supabase.from('empresas').select('*, planos(id, nome, preco_mensal)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: 'Erro ao listar empresas.' });
  const includeArchived = req.query.includeArchived === 'true';
  res.json(aplicarFiltroArquivamento(data || [], { includeArchived }));
});

router.get('/empresas/:id/contratacao', async (req, res) => {
  try {
    const resultado = await listarContratacaoEmpresa({ supabase, empresaId: req.params.id });
    const contratoIds = [];
    for (const proposta of resultado.propostas || []) {
      const contratos = Array.isArray(proposta.contratos_comerciais)
        ? proposta.contratos_comerciais
        : (proposta.contratos_comerciais ? [proposta.contratos_comerciais] : []);
      for (const contrato of contratos) {
        if (contrato && contrato.id) contratoIds.push(contrato.id);
      }
    }

    let signatarios = [];
    let eventos = [];
    if (contratoIds.length > 0) {
      const [signR, eventosR] = await Promise.all([
        supabase.from('contrato_signatarios')
          .select('id, contrato_id, papel, status, assinado_em, criado_em')
          .eq('empresa_id', req.params.id)
          .in('contrato_id', contratoIds),
        supabase.from('contrato_eventos')
          .select('id, contrato_id, tipo, detalhe, criado_em')
          .eq('empresa_id', req.params.id)
          .in('contrato_id', contratoIds)
          .order('criado_em', { ascending: false }),
      ]);
      if (signR.error) return res.status(500).json({ message: 'Erro ao carregar signatarios.' });
      if (eventosR.error) return res.status(500).json({ message: 'Erro ao carregar eventos.' });
      signatarios = signR.data || [];
      eventos = eventosR.data || [];
    }

    return res.json({ ...resultado, signatarios, eventos });
  } catch (err) {
    console.error('[painel-admin/contratacao] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao carregar contratacao.' });
  }
});

router.post('/empresas/:empresaId/contratos/:contratoId/aceitar-manual', async (req, res) => {
  try {
    const r = await aceitarContrato({
      supabase,
      contratoId: req.params.contratoId,
      empresaId: req.params.empresaId,
      usuarioId: req.user.uid,
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[painel-admin/contratos/aceitar-manual] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao registrar aceite manual.' });
  }
});

router.post('/empresas/:empresaId/contratos/:contratoId/assinatura-matopiba/desafio', async (req, res) => {
  try {
    const r = await solicitarDesafioAssinatura({
      supabase,
      contratoId: req.params.contratoId,
      empresaId: req.params.empresaId,
      usuarioId: req.user.uid,
      papel: 'matopiba',
      senha: req.body?.senha,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[painel-admin/assinatura-matopiba/desafio] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao solicitar codigo de assinatura.' });
  }
});

router.post('/empresas/:empresaId/contratos/:contratoId/assinatura-matopiba/confirmar', async (req, res) => {
  try {
    const r = await confirmarAssinatura({
      supabase,
      contratoId: req.params.contratoId,
      empresaId: req.params.empresaId,
      usuarioId: req.user.uid,
      papel: 'matopiba',
      codigo: req.body?.codigo,
      consentimentoAceito: req.body?.consentimento_aceito === true,
      declaracaoPoderes: req.body?.declaracao_poderes === true,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[painel-admin/assinatura-matopiba/confirmar] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao confirmar assinatura.' });
  }
});

// Reenvia ao CLIENTE um e-mail lembrete para assinar o contrato (link /contratacao).
// NÃO assina pelo cliente, NÃO libera manualmente, NÃO toca contrato/plano/Asaas/faturas.
// Idempotente (só envia e registra evento de auditoria). Se o contrato já está
// concluído, não envia. Se o e-mail estiver desligado/falhar, devolve o link para o
// super-admin copiar e enviar manualmente. Fluxo normal continua automático.
router.post('/empresas/:empresaId/contratos/:contratoId/reenviar-assinatura', async (req, res) => {
  const { empresaId, contratoId } = req.params;
  const link = `${process.env.FRONTEND_URL || 'https://matopibalog.com.br'}/contratacao`;
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id, status')
      .eq('id', contratoId)
      .maybeSingle();
    if (error) throw error;
    if (!contrato || contrato.empresa_id !== empresaId) {
      return res.status(404).json({ message: 'Contrato nao encontrado.' });
    }
    if (STATUS_CONCLUIDOS.has(contrato.status)) {
      return res.status(200).json({ ja_concluido: true, enviado: false, status: contrato.status, link, message: 'Contrato ja concluido; nao ha assinatura pendente.' });
    }

    // Destinatário = admin da empresa (quem assina como cliente).
    const { data: adminUser } = await supabase
      .from('usuarios')
      .select('email, nome')
      .eq('empresa_id', empresaId)
      .eq('tipo', 'admin')
      .limit(1)
      .maybeSingle();
    const email = adminUser?.email || null;

    let envio = { enviado: false, motivo: 'sem_destinatario' };
    if (email) {
      envio = await enviarEmail({
        para: email,
        assunto: 'Assine seu contrato — Matopiba Log',
        html: [
          `<p>Olá ${adminUser?.nome || ''},</p>`,
          '<p>Para liberar o uso completo do sistema, é necessário assinar eletronicamente o contrato, com confirmação por código enviado ao seu e-mail.</p>',
          `<p><a href="${link}">Assinar contrato agora</a></p>`,
          '<p>Ao acessar, confirme sua senha, receba o código por e-mail e conclua a assinatura.</p>',
        ].join(''),
        texto: `Para liberar o uso do sistema, assine o contrato em ${link} (confirmação por código no seu e-mail).`,
      });
    }

    // Evento de auditoria (best-effort; não bifurca a trilha — sem event_hash).
    try {
      await supabase.from('contrato_eventos').insert({
        contrato_id: contrato.id,
        empresa_id: empresaId,
        tipo: 'lembrete_assinatura_enviado',
        detalhe: { enviado: envio.enviado === true, motivo: envio.motivo || null, canal: 'email' },
        criado_por: req.user.uid,
      });
    } catch { /* auditoria é best-effort */ }

    return res.status(200).json({
      enviado: envio.enviado === true,
      motivo: envio.enviado === true ? null : (envio.motivo || 'falha_envio'),
      email_mascarado: email ? mascararEmail(email) : null,
      status: contrato.status,
      link, // sempre devolvido: o painel mostra o link copiável se o e-mail não saiu.
    });
  } catch (err) {
    console.error('[painel-admin/reenviar-assinatura] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao reenviar assinatura.' });
  }
});

// Marca/desmarca um contrato como OBRIGATÓRIO (gate de contrato). Só super-admin
// (router.use(isSuperAdmin) no topo). Validação de tenant/contrato. Não toca em
// faturas/Asaas/planos. Registra evento de auditoria (best-effort).
router.patch('/empresas/:empresaId/contratos/:contratoId/obrigatorio', async (req, res) => {
  const obrigatorio = req.body?.obrigatorio === true;
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id')
      .eq('id', req.params.contratoId)
      .maybeSingle();
    if (error) throw error;
    if (!contrato || contrato.empresa_id !== req.params.empresaId) {
      return res.status(404).json({ message: 'Contrato nao encontrado.' });
    }
    const { error: updateError } = await supabase
      .from('contratos_comerciais')
      .update({ obrigatorio, atualizado_em: new Date().toISOString() })
      .eq('id', contrato.id)
      .eq('empresa_id', req.params.empresaId);
    if (updateError) throw updateError;
    await supabase.from('contrato_eventos').insert({
      contrato_id: contrato.id,
      empresa_id: req.params.empresaId,
      tipo: obrigatorio ? 'contrato_marcado_obrigatorio' : 'contrato_desmarcado_obrigatorio',
      detalhe: { obrigatorio },
      criado_por: req.user?.uid || null,
    }).then(() => {}, () => {}); // best-effort: auditoria não bloqueia a ação
    return res.status(200).json({ id: contrato.id, obrigatorio });
  } catch (err) {
    console.error('[painel-admin/contratos/obrigatorio] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao atualizar obrigatoriedade do contrato.' });
  }
});

router.post('/empresas/:empresaId/contratos/:contratoId/upload-assinado', uploadContrato.single('arquivo'), async (req, res) => {
  const arquivo = validarPdfAssinado(req.file);
  if (!arquivo.ok) return res.status(arquivo.status).json({ message: arquivo.message });
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id, status')
      .eq('id', req.params.contratoId)
      .maybeSingle();
    if (error) throw error;
    if (!contrato || contrato.empresa_id !== req.params.empresaId) {
      return res.status(404).json({ message: 'Contrato nao encontrado.' });
    }
    if (contrato.status === 'cancelado') {
      return res.status(409).json({ message: 'Contrato cancelado nao pode receber arquivo.' });
    }

    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const path = caminhoContratoAssinado({ empresaId: req.params.empresaId, contratoId: contrato.id });
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_CONTRATOS)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadError) throw uploadError;

    const agora = new Date().toISOString();
    const { error: updateError } = await supabase.from('contratos_comerciais')
      .update({ signed_storage_path: path, signed_file_hash: hash, status: 'assinado', atualizado_em: agora })
      .eq('id', contrato.id)
      .eq('empresa_id', req.params.empresaId);
    if (updateError) throw updateError;
    await supabase.from('contrato_signatarios')
      .update({ status: 'assinado', assinado_em: agora })
      .eq('contrato_id', contrato.id)
      .eq('empresa_id', req.params.empresaId)
      .eq('papel', 'cliente');
    await supabase.from('contrato_eventos').insert({
      contrato_id: contrato.id,
      empresa_id: req.params.empresaId,
      tipo: 'upload_manual_assinado',
      detalhe: { arquivo: 'pdf', hash },
      criado_por: req.user.uid,
    });

    return res.status(201).json({ id: contrato.id, status: 'assinado', arquivo: 'contrato assinado recebido' });
  } catch (err) {
    console.error('[painel-admin/contratos/upload-assinado] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao salvar contrato assinado.' });
  }
});

router.get('/empresas/:empresaId/contratos/:contratoId/assinado-url', async (req, res) => {
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id, signed_storage_path')
      .eq('id', req.params.contratoId)
      .maybeSingle();
    if (error) throw error;
    const r = await criarUrlAssinadaContrato({ supabase, contrato, empresaId: req.params.empresaId });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[painel-admin/contratos/assinado-url] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao abrir contrato assinado.' });
  }
});

router.get('/empresas/:empresaId/contratos/:contratoId/certificado-url', async (req, res) => {
  try {
    const { data: contrato, error } = await supabase
      .from('contratos_comerciais')
      .select('id, empresa_id, certificate_storage_path')
      .eq('id', req.params.contratoId)
      .maybeSingle();
    if (error) throw error;
    const r = await criarUrlAssinadaCertificado({ supabase, contrato, empresaId: req.params.empresaId });
    return res.status(r.status).json(r.body);
  } catch (err) {
    console.error('[painel-admin/contratos/certificado-url] Falha', { status: 500 });
    return res.status(500).json({ message: 'Erro ao abrir certificado do contrato.' });
  }
});

router.post('/empresas', async (req, res) => {
  try {
    // Só validamos plano_id quando o cliente informou algum. Se veio vazio, o
    // serviço aplica sua própria resolução (alias/default) e pode nascer sem plano.
    const tipoEmpresa = req.body.tipo || 'transportadora';
    let planoIdValidado;
    if (req.body.plano_id !== undefined && req.body.plano_id !== null && String(req.body.plano_id).trim() !== '') {
      const r = await resolverPlanoId(req.body.plano_id);
      if (r.status) return res.status(r.status).json({ message: r.message });
      // Trava categoria×tipo: autônomo não pode nascer em plano de empresa (e vice-versa).
      const incompat = checarCategoriaPlano(tipoEmpresa, r.categoria);
      if (incompat) return res.status(incompat.status).json({ message: incompat.message });
      planoIdValidado = r.plano_id;
    }
    const { empresa, error, status } = await criarEmpresaCompleta({
      nome: req.body.nome,
      cnpj: req.body.cnpj,
      email_contato: req.body.email,
      telefone: req.body.telefone,
      plano_id: planoIdValidado,
      planoAlias: req.body.plano,
      tipo: req.body.tipo || 'transportadora',
    });
    if (error || !empresa) {
      // Status vindo do serviço tem precedência (409 = documento duplicado).
      // Sem status: erros de plano saem como 400; o resto como 500.
      const httpStatus = status || (/plano/i.test(error || '') ? 400 : 500);
      return res.status(httpStatus).json({ message: error || 'Erro ao criar empresa.' });
    }
    res.status(201).json(empresa);
  } catch (err) {
    console.error('[painel-admin POST /empresas] Exceção:', err);
    res.status(500).json({ message: 'Erro ao criar empresa.' });
  }
});

router.put('/empresas/:id', async (req, res) => {
  const upd = {};
  if (req.body.nome !== undefined) upd.nome = req.body.nome;
  if (req.body.cnpj !== undefined) upd.cnpj = req.body.cnpj;
  if (req.body.email !== undefined) upd.email_contato = req.body.email;
  if (req.body.telefone !== undefined) upd.telefone_contato = req.body.telefone;
  if (req.body.plano_id !== undefined) {
    // Valida antes de gravar: '' → null (sem plano); não-UUID → 400;
    // UUID inexistente → 400. Nunca deixa 22P02 virar 500.
    const r = await resolverPlanoId(req.body.plano_id);
    if (r.status) return res.status(r.status).json({ message: r.message });
    // Trava categoria×tipo. O tipo vem do body (se enviado) ou do registro atual;
    // só consulta o banco quando há plano com categoria restritiva a checar.
    if (r.categoria != null) {
      let tipoEmpresa = req.body.tipo;
      if (tipoEmpresa === undefined) {
        const { data: atual, error: tipoErr } = await supabase
          .from('empresas').select('tipo').eq('id', req.params.id).maybeSingle();
        if (tipoErr) return res.status(500).json({ message: 'Erro ao validar plano.' });
        if (!atual) return res.status(404).json({ message: 'Empresa não encontrada.' });
        tipoEmpresa = atual.tipo;
      }
      const incompat = checarCategoriaPlano(tipoEmpresa, r.categoria);
      if (incompat) return res.status(incompat.status).json({ message: incompat.message });
    }
    upd.plano_id = r.plano_id;
  }
  if (req.body.status !== undefined) upd.status = req.body.status;
  // Arquivar/desarquivar (autoria vem do token, nunca do body). Ortogonal a
  // status — arquivar NÃO altera suspensão. Mesmo padrão dos planos (frente #6).
  Object.assign(upd, montarPatchArquivamentoEmpresa(req.body, req.user.uid));
  const { data, error } = await supabase.from('empresas').update(upd).eq('id', req.params.id).select().single();
  if (error) {
    // Trocar o documento para um já usado por outra conta → 409 amigável.
    // (Manter o próprio documento não gera 23505: o valor não muda.)
    const conflito = conflitoUnico(error);
    if (conflito) return res.status(conflito.status).json({ message: conflito.message });
    return res.status(500).json({ message: 'Erro ao atualizar empresa.' });
  }
  res.json(data);
});

router.delete('/empresas/:id', async (req, res) => {
  const contratosR = await supabase
    .from('contratos_comerciais')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', req.params.id);
  if (contratosR.error && !tabelaAusente(contratosR.error)) {
    return res.status(500).json({ message: 'Erro ao verificar contratos comerciais.' });
  }
  if ((contratosR.count || 0) > 0) {
    return res.status(409).json({ message: 'Esta conta possui contrato comercial. Arquive a conta para preservar a trilha probatoria.' });
  }
  const { error } = await supabase.from('empresas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao excluir empresa.' });
  res.json({ message: 'Empresa excluída.' });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUANTIDADE CONTRATADA (mega-frente extras por empresa) — super-admin.
// Cobranca e por CAPACIDADE CONTRATADA (nao uso real). Preview mostra base+extras
// + recomendacao de upgrade. Aplicar marca sync Asaas pendente. NAO toca fatura.
// ═══════════════════════════════════════════════════════════════════════════
const TETO_SELF_SERVICE = 40; // acima disso: negociacao (regra 8)

function colunaQuantidadeAusente(error) {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  return /quantidade_contratada/i.test(error.message || '') && /column|does not exist|schema cache/i.test(error.message || '');
}

// Carrega empresa (deploy-safe `*`) + plano + catalogo de planos de empresa (p/ recomendacao).
async function carregarParaValorEfetivo(empresaId) {
  const { data: empresa, error } = await supabase
    .from('empresas')
    .select('*, planos(id, nome, categoria, preco_mensal, capacidade_inclusa, preco_motorista_extra, requer_negociacao, ativo, limite_motoristas)')
    .eq('id', empresaId).maybeSingle();
  if (error || !empresa) return { erro: true };
  const plano = Array.isArray(empresa.planos) ? empresa.planos[0] : empresa.planos;
  const { data: catalogo } = await supabase
    .from('planos')
    .select('id, nome, categoria, preco_mensal, capacidade_inclusa, preco_motorista_extra, requer_negociacao, ativo')
    .eq('ativo', true).in('categoria', ['empresa', 'ambos']);
  const candidatos = (catalogo || []).filter((p) => p.requer_negociacao !== true);
  return { empresa, plano, candidatos };
}

function montarPreviewValorEfetivo({ empresa, plano, candidatos, quantidade }) {
  const atualQtd = empresa.quantidade_contratada != null ? Number(empresa.quantidade_contratada) : (plano && plano.capacidade_inclusa != null ? Number(plano.capacidade_inclusa) : null);
  const antes = atualQtd != null ? valorEfetivoEmpresa({ plano, quantidade_contratada: atualQtd, planos: candidatos }) : null;
  const depois = valorEfetivoEmpresa({ plano, quantidade_contratada: quantidade, planos: candidatos });
  return {
    plano_id: plano ? plano.id : null,
    plano_nome: plano ? plano.nome : null,
    capacidade_inclusa: plano ? plano.capacidade_inclusa : null,
    quantidade_atual: atualQtd,
    quantidade_desejada: quantidade,
    valor_antes: antes && antes.ok ? antes.valor_total : null,
    valor_depois: depois && depois.ok ? depois.valor_total : null,
    valor_base: depois && depois.ok ? depois.valor_base : null,
    quantidade_extra: depois && depois.ok ? depois.quantidade_extra : null,
    valor_extra: depois && depois.ok ? depois.valor_extra : null,
    requer_negociacao: quantidade > TETO_SELF_SERVICE || (depois && depois.requer_negociacao === true),
    recomendacao_upgrade: depois && depois.ok ? depois.recomendacao_upgrade : null,
    plano_recomendado_nome: depois && depois.ok ? depois.plano_recomendado_nome : null,
    economia_upgrade: depois && depois.ok ? depois.economia_upgrade : null,
    mensagem_upgrade: depois && depois.ok ? depois.mensagem : null,
  };
}

// GET /empresas/:id/valor-efetivo?quantidade=N — PREVIEW read-only (nao grava).
router.get('/empresas/:id/valor-efetivo', async (req, res) => {
  const ctx = await carregarParaValorEfetivo(req.params.id);
  if (ctx.erro) return res.status(404).json({ message: 'Empresa não encontrada.' });
  if (!ctx.plano) return res.status(422).json({ message: 'Empresa sem plano vinculado.' });
  const q = req.query.quantidade !== undefined ? Number(req.query.quantidade) : (ctx.empresa.quantidade_contratada != null ? Number(ctx.empresa.quantidade_contratada) : Number(ctx.plano.capacidade_inclusa));
  if (!Number.isInteger(q) || q < 1) return res.status(422).json({ message: 'Quantidade inválida.' });
  res.json(montarPreviewValorEfetivo({ ...ctx, quantidade: q }));
});

// PATCH /empresas/:id/quantidade-contratada — aplica (marca sync; nao toca fatura).
router.patch('/empresas/:id/quantidade-contratada', async (req, res) => {
  const q = Number(req.body && req.body.quantidade_contratada);
  const motivo = req.body && req.body.motivo != null ? String(req.body.motivo).slice(0, 200) : null;
  if (!Number.isInteger(q) || q < 1) return res.status(422).json({ message: 'quantidade_contratada deve ser um inteiro >= 1.' });

  const ctx = await carregarParaValorEfetivo(req.params.id);
  if (ctx.erro) return res.status(404).json({ message: 'Empresa não encontrada.' });
  if (!ctx.plano) return res.status(422).json({ message: 'Empresa sem plano vinculado.' });

  // Acima do teto self-service → negociacao (regra 8). Nao aplica.
  if (q > TETO_SELF_SERVICE) {
    return res.status(422).json({
      requer_negociacao: true,
      message: `Acima de ${TETO_SELF_SERVICE} a contratação é sob negociação. Fale com o comercial.`,
    });
  }
  // Autônomo/plano sem extra que não acomoda → orienta plano adequado (regra 10).
  const preview = montarPreviewValorEfetivo({ ...ctx, quantidade: q });
  if (preview.valor_depois == null) {
    return res.status(422).json({ message: 'Este plano não acomoda essa quantidade. Selecione um plano de empresa adequado.' });
  }

  const upd = {
    quantidade_contratada: q,
    quantidade_contratada_atualizada_em: new Date().toISOString(),
    quantidade_contratada_atualizada_por: req.user && req.user.uid ? req.user.uid : null,
    quantidade_contratada_motivo: motivo,
  };
  const { error } = await supabase.from('empresas').update(upd).eq('id', req.params.id);
  if (error) {
    if (colunaQuantidadeAusente(error)) return res.status(503).json({ message: 'Quantidade contratada ainda não provisionada (migration 044 pendente).' });
    return res.status(500).json({ message: 'Erro ao atualizar a quantidade contratada.' });
  }

  // Marca sync Asaas pendente (valor futuro) — best-effort/defensivo.
  try {
    await supabase.from('asaas_sync_estado').upsert(
      asaasSync.montarEstadoPendente({ empresaId: req.params.id, motivo: 'quantidade_contratada_alterada', valorAlvo: preview.valor_depois, asaasSubscriptionId: ctx.empresa.asaas_subscription_id || null }),
      { onConflict: 'empresa_id' });
  } catch (_) { /* migration 042 ausente / falha transitória — não bloqueia */ }

  res.json({ ok: true, ...preview });
});

// TRIAL — prorrogar/liberar trial de uma empresa (super-admin only, herda do router.use)
// Aceita { dias: 7|15 } (prorrogação relativa) OU { trial_ends_at: 'YYYY-MM-DD' } (data personalizada).
// Não altera plano_id, faturas, cobrança ou Asaas. Limite: no máximo hoje + 90 dias.
router.patch('/empresas/:id/trial', async (req, res) => {
  const MS_DIA = 24 * 60 * 60 * 1000;
  const { dias, trial_ends_at } = req.body || {};

  // Exatamente uma das opções deve vir preenchida
  const temDias = dias !== undefined && dias !== null && dias !== '';
  const temData = trial_ends_at !== undefined && trial_ends_at !== null && trial_ends_at !== '';
  if (temDias === temData) {
    return res.status(400).json({ message: 'Informe "dias" (7 ou 15) ou "trial_ends_at" (data), mas não ambos.' });
  }

  // Empresa precisa existir
  const { data: empresa, error: findErr } = await supabase
    .from('empresas')
    .select('id, status, trial_started_at, trial_ends_at')
    .eq('id', req.params.id)
    .maybeSingle();
  if (findErr) return res.status(500).json({ message: 'Erro ao buscar empresa.' });
  if (!empresa) return res.status(404).json({ message: 'Empresa não encontrada.' });

  const agora = new Date();
  // Teto: fim do 90º dia a partir de hoje (permite escolher exatamente o dia 90)
  const limiteMax = new Date(agora.getTime() + 90 * MS_DIA);
  limiteMax.setHours(23, 59, 59, 999);
  let novaData;

  if (temDias) {
    const n = Number(dias);
    if (n !== 7 && n !== 15) {
      return res.status(400).json({ message: 'O parâmetro "dias" deve ser 7 ou 15.' });
    }
    // Base = maior data entre hoje e o trial atual, se ainda futuro
    let base = agora;
    if (empresa.trial_ends_at) {
      const atual = new Date(empresa.trial_ends_at);
      if (!isNaN(atual.getTime()) && atual > agora) base = atual;
    }
    novaData = new Date(base.getTime() + n * MS_DIA);
  } else {
    // Data personalizada. 'YYYY-MM-DD' (input date) → fim daquele dia, para o trial
    // valer o dia inteiro e exibir a data correta no fuso local.
    let raw = String(trial_ends_at).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T23:59:59';
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ message: 'Data de trial inválida.' });
    }
    if (parsed <= agora) {
      return res.status(400).json({ message: 'A data de trial deve ser futura.' });
    }
    novaData = parsed;
  }

  // Teto de 90 dias a partir de hoje (vale para prorrogação relativa e data personalizada)
  if (novaData > limiteMax) {
    return res.status(400).json({ message: 'A data de trial não pode passar de 90 dias a partir de hoje.' });
  }

  const upd = {
    status: 'trial',
    trial_ends_at: novaData.toISOString(),
    trial_started_at: empresa.trial_started_at || agora.toISOString(),
  };

  const { data, error } = await supabase
    .from('empresas')
    .update(upd)
    .eq('id', req.params.id)
    .select('id, status, trial_started_at, trial_ends_at')
    .single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar trial.' });
  res.json(data);
});

// ── EXTENSÃO MANUAL DE PRAZO DE SUSPENSÃO (super-admin, herda do router.use) ──
// Concede um prazo adicional antes da suspensão automática por inadimplência.
// Empresa com `suspensao_prazo_ate` futuro NÃO é suspensa até o prazo vencer
// (respeitado no domínio avaliarElegibilidadeSuspensao). NÃO toca faturas, plano,
// preço nem Asaas. Depende da migration 047 (colunas suspensao_prazo_*).

// GET — consulta a extensão atual + faturas abertas/vencidas (para o painel).
router.get('/empresas/:id/prazo-suspensao', async (req, res) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const [{ data: empresa, error: empErr }, { data: faturas }] = await Promise.all([
      supabase.from('empresas').select('*').eq('id', req.params.id).maybeSingle(),
      supabase.from('faturas')
        .select('id, valor, status, due_date, invoice_url')
        .eq('empresa_id', req.params.id)
        .in('status', ['pendente', 'vencido'])
        .order('due_date', { ascending: true }),
    ]);
    if (empErr) return res.status(500).json({ message: 'Erro ao buscar empresa.' });
    if (!empresa) return res.status(404).json({ message: 'Empresa não encontrada.' });
    const prazo = empresa.suspensao_prazo_ate || null;
    res.json({
      empresa_id: empresa.id,
      status: empresa.status,
      suspensao_prazo_ate: prazo,
      suspensao_prazo_motivo: empresa.suspensao_prazo_motivo || null,
      suspensao_prazo_criado_em: empresa.suspensao_prazo_criado_em || null,
      suspensao_prazo_criado_por: empresa.suspensao_prazo_criado_por || null,
      extensao_ativa: Boolean(prazo && String(prazo).slice(0, 10) >= hoje),
      faturas_abertas: faturas || [],
    });
  } catch (_) {
    // Provável ausência das colunas antes da migration 047.
    res.status(503).json({ message: 'Recurso de extensão de prazo indisponível (aplique a migration 047).' });
  }
});

// PATCH — concede/atualiza a extensão. body: { prazo_ate: 'YYYY-MM-DD', motivo }.
// motivo OBRIGATÓRIO; prazo_ate deve ser futuro (>= amanhã) e no máximo hoje+90.
router.patch('/empresas/:id/prazo-suspensao', async (req, res) => {
  const { prazo_ate, motivo } = req.body || {};
  const motivoLimpo = typeof motivo === 'string' ? motivo.trim() : '';
  if (!motivoLimpo) return res.status(400).json({ message: 'Informe o motivo da extensão.' });
  if (!prazo_ate || !/^\d{4}-\d{2}-\d{2}$/.test(String(prazo_ate))) {
    return res.status(400).json({ message: 'Informe prazo_ate no formato YYYY-MM-DD.' });
  }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(String(prazo_ate) + 'T00:00:00');
  if (isNaN(alvo.getTime()) || alvo <= hoje) {
    return res.status(400).json({ message: 'O prazo deve ser uma data futura.' });
  }
  const limite = new Date(hoje.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (alvo > limite) {
    return res.status(400).json({ message: 'O prazo não pode passar de 90 dias a partir de hoje.' });
  }
  try {
    const { data, error } = await supabase.from('empresas').update({
      suspensao_prazo_ate: String(prazo_ate),
      suspensao_prazo_motivo: motivoLimpo,
      suspensao_prazo_criado_em: new Date().toISOString(),
      suspensao_prazo_criado_por: (req.user && req.user.uid) ? req.user.uid : null,
      suspensao_prazo_removido_em: null,
      suspensao_prazo_removido_por: null,
    }).eq('id', req.params.id).select('id, suspensao_prazo_ate, suspensao_prazo_motivo').maybeSingle();
    if (error) return res.status(500).json({ message: 'Erro ao conceder o prazo.' });
    if (!data) return res.status(404).json({ message: 'Empresa não encontrada.' });
    res.json(data);
  } catch (_) {
    res.status(503).json({ message: 'Recurso de extensão de prazo indisponível (aplique a migration 047).' });
  }
});

// DELETE — remove a extensão (mantém a trilha: criado_* preservado + removido_*).
router.delete('/empresas/:id/prazo-suspensao', async (req, res) => {
  try {
    const { data, error } = await supabase.from('empresas').update({
      suspensao_prazo_ate: null,
      suspensao_prazo_removido_em: new Date().toISOString(),
      suspensao_prazo_removido_por: (req.user && req.user.uid) ? req.user.uid : null,
    }).eq('id', req.params.id).select('id, suspensao_prazo_ate').maybeSingle();
    if (error) return res.status(500).json({ message: 'Erro ao remover o prazo.' });
    if (!data) return res.status(404).json({ message: 'Empresa não encontrada.' });
    res.json(data);
  } catch (_) {
    res.status(503).json({ message: 'Recurso de extensão de prazo indisponível (aplique a migration 047).' });
  }
});

// PLANOS
router.get('/planos', async (req, res) => {
  const { data, error } = await supabase.from('planos').select('*').order('preco_mensal', { ascending: true });
  if (error) return res.status(500).json({ message: 'Erro ao listar planos.' });
  // `excluivel` deriva de ja_utilizado (critério B): só é excluível quem nunca foi
  // usado. A UI usa isso para só mostrar o botão Excluir quando for seguro.
  const planos = (data || []).map((p) => ({ ...p, excluivel: p.ja_utilizado !== true }));
  res.json(planos);
});

// Categorias validas de plano (a quem ele se destina).
const CATEGORIAS_PLANO = ['empresa', 'autonomo', 'ambos'];

router.post('/planos', async (req, res) => {
  const categoria = req.body.categoria !== undefined ? String(req.body.categoria) : 'ambos';
  if (!CATEGORIAS_PLANO.includes(categoria)) {
    return res.status(400).json({ message: 'Categoria inválida. Use empresa, autonomo ou ambos.' });
  }
  // Precificação é do backend, não do cliente. Sem modelo_cobranca no body →
  // resolve 'fixo' (o payload atual do painel). Em por_motorista o preco_mensal
  // enviado é IGNORADO e recalculado como unitário × quantidade. O patch já traz
  // modelo_cobranca, preco_mensal, preco_por_motorista e limite_motoristas.
  const preco = resolverCriacaoPreco(req.body);
  if (!preco.ok) return res.status(preco.status).json(preco.body);

  const comercial = montarPatchComercial(req.body);
  if (!comercial.ok) return res.status(comercial.status).json(comercial.body);

  const { data, error } = await supabase.from('planos').insert({
    nome: req.body.nome,
    descricao: req.body.descricao || '',
    recursos: req.body.recursos || [],
    dias_trial: req.body.dias_trial !== undefined ? Number(req.body.dias_trial) : 7,
    ativo: req.body.ativo !== undefined ? req.body.ativo === true : true,
    categoria,
    ...preco.patch,
    ...comercial.patch
  }).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao criar plano.' });
  res.status(201).json(data);
});

router.put('/planos/:id', async (req, res) => {
  const upd = {};
  if (req.body.nome !== undefined) upd.nome = req.body.nome;
  if (req.body.descricao !== undefined) upd.descricao = req.body.descricao;
  if (req.body.recursos !== undefined) upd.recursos = req.body.recursos;
  if (req.body.limite_motoristas !== undefined) upd.limite_motoristas = Number(req.body.limite_motoristas);
  if (req.body.dias_trial !== undefined) upd.dias_trial = Number(req.body.dias_trial);
  if (req.body.ativo !== undefined) upd.ativo = req.body.ativo === true;
  else if (req.body.status !== undefined) upd.ativo = req.body.status === 'ativo';
  if (req.body.categoria !== undefined) {
    const categoria = String(req.body.categoria);
    if (!CATEGORIAS_PLANO.includes(categoria)) {
      return res.status(400).json({ message: 'Categoria inválida. Use empresa, autonomo ou ambos.' });
    }
    upd.categoria = categoria;
  }

  // Campos comerciais (passthrough validado; fora da fórmula de preço).
  const comercial = montarPatchComercial(req.body);
  if (!comercial.ok) return res.status(comercial.status).json(comercial.body);
  Object.assign(upd, comercial.patch);

  // ─── Precificação ──────────────────────────────────────────────────────────
  // O PUT é PARCIAL, mas a fórmula precisa do quadro completo: `PUT
  // { limite_motoristas: 20 }` num plano por_motorista traz a quantidade no body
  // e o unitário só no banco. Por isso carregamos a linha atual e mesclamos antes
  // de calcular — senão a quantidade mudaria e o preço não.
  //
  // Só carrega/recalcula quando o body toca preço/modelo/quantidade. Arquivar,
  // desarquivar, ativar e inativar mandam só { arquivar } ou { ativo }: não
  // pagam query nem recálculo, e seguem exatamente como na frente #6.
  if (bodyTocaPreco(req.body)) {
    const { data: planoAtual, error: loadErr } = await supabase
      .from('planos')
      .select('id, preco_mensal, preco_por_motorista, limite_motoristas, modelo_cobranca, ja_utilizado')
      .eq('id', req.params.id)
      .maybeSingle();
    if (loadErr) return res.status(500).json({ message: 'Erro ao carregar o plano.' });

    const decisao = decidirEdicaoPreco({ planoAtual, body: req.body });

    if (decisao.acao === 'erro') return res.status(decisao.status).json(decisao.body);

    // Plano já usado + preço efetivo mudando: 409 com o diff, e nada é aplicado.
    // A trava é aqui no backend, não no modal — um curl ou um painel
    // desatualizado não podem furar mudança de preço de plano em uso.
    if (decisao.acao === 'confirmar') {
      const { count } = await supabase
        .from('empresas')
        .select('id', { count: 'exact', head: true })
        .eq('plano_id', req.params.id);
      return res.status(409).json(montarErroReprecificacao({
        preco_atual: decisao.preco_atual,
        preco_novo: decisao.preco_novo,
        empresas_afetadas: count || 0,
      }));
    }

    if (decisao.acao === 'aplicar') Object.assign(upd, decisao.patch);
  }

  // Arquivar/desarquivar (autoria vem do token, nunca do body). Arquivar seta
  // ativo=false; desarquivar NÃO reativa (reativar no app é ação separada).
  Object.assign(upd, montarPatchArquivamento(req.body, req.user.uid));
  const { data, error } = await supabase.from('planos').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ message: 'Erro ao atualizar plano.' });

  // Sync Asaas (mega-frente comercial, FASE 4): se o PREÇO mudou, marca as
  // empresas cobráveis deste plano como pendentes de sync (valor futuro da
  // assinatura). Best-effort e DEFENSIVO: se a migration 042 não foi aplicada,
  // apenas ignora — jamais quebra a edição de plano.
  if (upd.preco_mensal !== undefined) {
    try {
      const { data: empresas } = await supabase
        .from('empresas')
        .select('id, plano_id, status, arquivada_em, asaas_subscription_id')
        .eq('plano_id', req.params.id);
      const afetadas = asaasSync.empresasAfetadasPorPlano({ empresas: empresas || [], planoId: req.params.id });
      if (afetadas.length > 0) {
        const subById = new Map((empresas || []).map((e) => [e.id, e.asaas_subscription_id || null]));
        const valorAlvo = Number(upd.preco_mensal);
        const linhas = afetadas.map((id) => asaasSync.montarEstadoPendente({ empresaId: id, motivo: 'plano_reprecificado', valorAlvo: Number.isFinite(valorAlvo) ? valorAlvo : null, asaasSubscriptionId: subById.get(id) }));
        await supabase.from('asaas_sync_estado').upsert(linhas, { onConflict: 'empresa_id' });
      }
    } catch (_) { /* migration 042 ausente ou falha transitória — não bloqueia a edição */ }
  }

  res.json(data);
});

// Exclusão FÍSICA segura (super-admin, herdado do router.use acima). Só remove
// planos que nunca foram usados; qualquer vínculo → 409 amigável (nunca 500).
router.delete('/planos/:id', async (req, res) => {
  const resultado = await excluirPlano({ supabase, planoId: req.params.id });
  res.status(resultado.status).json(resultado.body);
});

// PREVIEW de impacto de reprecificação (FASE 5 / mega-frente go-live). READ-ONLY:
// não grava nada, só simula o preço novo e mede o alcance para o super-admin
// decidir antes de aplicar o PUT. Query params (todos opcionais; ausentes = sem
// mudança, impacto zero):
//   novo_preco               → preco_mensal (planos fixos);
//   novo_modelo              → modelo_cobranca ('fixo' | 'por_motorista');
//   novo_preco_por_motorista → preco_por_motorista (planos por motorista);
//   novo_limite_motoristas   → limite_motoristas (planos por motorista).
router.get('/planos/:id/impacto-preco', async (req, res) => {
  const { data: planoAtual, error: planoErr } = await supabase
    .from('planos')
    .select('id, nome, preco_mensal, preco_por_motorista, limite_motoristas, modelo_cobranca')
    .eq('id', req.params.id)
    .maybeSingle();
  if (planoErr) return res.status(500).json({ message: 'Erro ao carregar o plano.' });
  if (!planoAtual) return res.status(404).json({ message: 'Plano não encontrado.' });

  // Traduz a query (só o que veio) para os campos que o serviço puro entende.
  const q = req.query || {};
  const novo = {};
  if (q.novo_preco !== undefined) novo.preco_mensal = q.novo_preco;
  if (q.novo_modelo !== undefined) novo.modelo_cobranca = q.novo_modelo;
  if (q.novo_preco_por_motorista !== undefined) novo.preco_por_motorista = q.novo_preco_por_motorista;
  if (q.novo_limite_motoristas !== undefined) novo.limite_motoristas = q.novo_limite_motoristas;

  // Alcance: empresas no plano, faturas abertas dessas empresas (não mudam), e
  // quantas receberiam o novo valor na próxima recorrência (ativas, sem assinatura).
  const [afetadasR, recorrentesR] = await Promise.all([
    supabase.from('empresas').select('id', { count: 'exact', head: true }).eq('plano_id', req.params.id),
    supabase.from('empresas')
      .select('id', { count: 'exact', head: true })
      .eq('plano_id', req.params.id)
      .eq('status', 'ativo')
      .is('asaas_subscription_id', null),
  ]);
  if (afetadasR.error) return res.status(500).json({ message: 'Erro ao contar empresas afetadas.' });

  const empresas_afetadas = afetadasR.count || 0;
  const proximas_recorrencias = recorrentesR && !recorrentesR.error ? (recorrentesR.count || 0) : 0;

  // Faturas abertas das empresas afetadas (só conta; não são alteradas).
  let faturas_abertas = 0;
  if (empresas_afetadas > 0) {
    const { data: empIds } = await supabase.from('empresas').select('id').eq('plano_id', req.params.id);
    const ids = (empIds || []).map((e) => e.id);
    if (ids.length) {
      const fatR = await supabase
        .from('faturas')
        .select('id', { count: 'exact', head: true })
        .in('empresa_id', ids)
        .in('status', ['pendente', 'vencido']);
      faturas_abertas = fatR && !fatR.error ? (fatR.count || 0) : 0;
    }
  }

  const r = montarImpactoPreco({ planoAtual, novo, empresas_afetadas, faturas_abertas, proximas_recorrencias });
  if (!r.ok) return res.status(r.status).json(r.body);
  return res.json(r.impacto);
});

// ASSINATURAS (virtuais - derivadas de empresas + planos)
router.get('/assinaturas', async (req, res) => {
  const { data: empresas, error } = await supabase.from('empresas').select('*, planos(id, nome, preco_mensal)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ message: 'Erro ao listar assinaturas.' });
  const assinaturas = (empresas || []).map(e => ({
    id: e.id,
    empresa_id: e.id,
    plano_id: e.plano_id,
    empresa_nome: e.nome,
    plano_nome: e.planos?.nome || null,
    valor: e.planos?.preco_mensal || 0,
    status: e.status || 'pendente',
    created_at: e.created_at
  }));
  res.json(assinaturas);
});

// MOTORISTAS GLOBAL
router.get('/motoristas', async (req, res) => {
  const { data, error } = await supabase.from('motoristas').select('*, usuarios(nome, email), empresas(nome, tipo)');
  if (error) return res.status(500).json({ message: 'Erro ao listar motoristas.' });
  res.json(data || []);
});

router.patch('/motoristas/:id/aprovar', async (req, res) => {
  const { error } = await supabase.from('motoristas').update({ status_cadastro: 'aprovado' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao aprovar.' });
  res.json({ message: 'Motorista aprovado.' });
});

router.patch('/motoristas/:id/reprovar', async (req, res) => {
  const { error } = await supabase.from('motoristas').update({ status_cadastro: 'reprovado' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ message: 'Erro ao reprovar.' });
  res.json({ message: 'Motorista reprovado.' });
});

// ═══════════════════════════════════════════════════════════════════════════
// MEGA-FRENTE Billing Comercial Avançado — endpoints (FASE 3 + FASE 5)
//
// Adaptadores FINOS sobre serviços PUROS já testados
// (calculadoraComercialService, promocaoDomainService). A decisão/dinheiro mora
// nos serviços; aqui só há leitura/escrita no banco. As tabelas de promoção
// (migration 040) podem ainda NÃO estar aplicadas — por isso todo acesso trata
// "tabela ausente" como 503 amigável, sem quebrar o painel.
// ═══════════════════════════════════════════════════════════════════════════

// Detecta relação inexistente (migration ainda não aplicada) para responder 503
// em vez de 500 genérico.
function tabelaAusente(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table|does not exist/i.test(error.message || '');
}
function erroPromocao(res, error, contexto) {
  if (tabelaAusente(error)) {
    return res.status(503).json({ message: 'Recurso de promoções ainda não provisionado (migration 040 pendente).' });
  }
  return res.status(500).json({ message: contexto || 'Erro ao processar promoção.' });
}

// ── FASE 3: recomendação de plano (read-only) ────────────────────────────────
// GET /painel-admin/planos/recomendar?quantidade=10&planoAtualId=<uuid>
// Compara o custo real (base + extras) entre os planos de empresa ativos e
// devolve o mais barato + economia. 41+ → sob negociação.
router.get('/planos/recomendar', async (req, res) => {
  const quantidade = Number(req.query.quantidade);
  const planoAtualId = req.query.planoAtualId ? String(req.query.planoAtualId) : null;
  const { data, error } = await supabase
    .from('planos')
    .select('*')
    .eq('ativo', true)
    .is('arquivado_em', null);
  if (error) return res.status(500).json({ message: 'Erro ao carregar planos.' });
  // Recomendação é para empresa: só planos de empresa/ambos, e nunca os marcados
  // como sob negociação (não têm preço de tabela).
  const candidatos = (data || []).filter(
    (p) => (p.categoria === 'empresa' || p.categoria === 'ambos') && p.requer_negociacao !== true,
  );
  const r = recomendarPlano({ planos: candidatos, quantidade, planoAtualId });
  if (!r.ok) return res.status(400).json({ message: r.message || 'Parâmetros inválidos.' });
  res.json(r);
});

// ── FASE 5: promoções / tickets (super-admin) ────────────────────────────────

// POST /painel-admin/promocoes — criar campanha.
router.post('/promocoes', async (req, res) => {
  const v = validarPromo(criarPromocaoSchema, req.body);
  if (!v.ok) return res.status(v.status).json(v.body);
  const b = v.data;

  const linha = {
    nome: b.nome,
    descricao: b.descricao != null ? String(b.descricao) : null,
    tipo: b.tipo,
    percentual: b.percentual != null ? b.percentual : null,
    valor: b.valor != null ? b.valor : null,
    duracao_meses: b.duracao_meses != null ? b.duracao_meses : null,
    dias_trial_extra: b.dias_trial_extra != null ? b.dias_trial_extra : null,
    data_inicio: b.data_inicio,
    data_fim: b.data_fim,
    ativo: b.ativo !== undefined ? b.ativo === true : true,
    limite_usos_total: b.limite_usos_total != null ? b.limite_usos_total : null,
    uso_unico_por_empresa: b.uso_unico_por_empresa !== undefined ? b.uso_unico_por_empresa === true : true,
    plano_alvo_id: b.plano_alvo_id || null,
    criado_por: req.user && req.user.uid ? req.user.uid : null,
  };
  const { data, error } = await supabase.from('promocoes').insert(linha).select().single();
  if (error) return erroPromocao(res, error, 'Erro ao criar promoção.');
  res.status(201).json(data);
});

// GET /painel-admin/promocoes — listar campanhas (com códigos).
router.get('/promocoes', async (req, res) => {
  const { data, error } = await supabase
    .from('promocoes')
    .select('*, promocao_codigos(*)')
    .order('criado_em', { ascending: false });
  if (error) return erroPromocao(res, error, 'Erro ao listar promoções.');
  res.json(data || []);
});

// PATCH /painel-admin/promocoes/:id — ativar/desativar, editar datas/limites.
router.patch('/promocoes/:id', async (req, res) => {
  const v = validarPromo(editarPromocaoSchema, req.body);
  if (!v.ok) return res.status(v.status).json(v.body);
  const b = v.data;
  const upd = { atualizado_em: new Date().toISOString() };
  if (b.ativo !== undefined) upd.ativo = b.ativo === true;
  if (b.data_inicio !== undefined) upd.data_inicio = b.data_inicio;
  if (b.data_fim !== undefined) upd.data_fim = b.data_fim;
  if (b.limite_usos_total !== undefined) upd.limite_usos_total = b.limite_usos_total != null ? b.limite_usos_total : null;
  if (b.nome !== undefined) upd.nome = b.nome;
  if (b.descricao !== undefined) upd.descricao = b.descricao != null ? String(b.descricao) : null;
  const { data, error } = await supabase.from('promocoes').update(upd).eq('id', req.params.id).select().single();
  if (error) return erroPromocao(res, error, 'Erro ao atualizar promoção.');
  if (!data) return res.status(404).json({ message: 'Promoção não encontrada.' });
  res.json(data);
});

// POST /painel-admin/promocoes/:id/codigos — gerar código/ticket.
router.post('/promocoes/:id/codigos', async (req, res) => {
  const v = validarPromo(gerarCodigoSchema, req.body);
  if (!v.ok) return res.status(v.status).json(v.body);
  const linha = {
    promocao_id: req.params.id,
    codigo: normalizarCodigo(v.data.codigo),
    limite_usos: v.data.limite_usos != null ? v.data.limite_usos : null,
    ativo: v.data.ativo !== undefined ? v.data.ativo === true : true,
    criado_por: req.user && req.user.uid ? req.user.uid : null, // auditoria: quem gerou (migration 043)
  };
  let { data, error } = await supabase.from('promocao_codigos').insert(linha).select().single();
  // Deploy-safe: enquanto a migration 043 não for aplicada, a coluna criado_por
  // não existe — reinsere sem ela (o código continua funcionando; só a auditoria
  // do autor fica pendente até aplicar a 043).
  if (error && /criado_por/i.test(error.message || '') && (error.code === 'PGRST204' || /column|does not exist|schema cache/i.test(error.message || ''))) {
    const { criado_por, ...semAutor } = linha;
    ({ data, error } = await supabase.from('promocao_codigos').insert(semAutor).select().single());
  }
  if (error) {
    if (conflitoUnico(error)) return res.status(409).json({ message: 'Já existe um código com esse nome.' });
    return erroPromocao(res, error, 'Erro ao gerar código.');
  }
  res.status(201).json(data);
});

// POST /painel-admin/promocoes/validar — validar um código (preview, read-only).
// Body: { codigo, empresa_id?, planoEscolhidoId?, precoMensalidade?, valorImplantacao?, trialDiasBase? }
router.post('/promocoes/validar', async (req, res) => {
  const codigo = normalizarCodigo(req.body && req.body.codigo);
  if (!codigo) return res.status(400).json({ message: 'Informe o código.' });
  const { data: cod, error: e1 } = await supabase
    .from('promocao_codigos')
    .select('*, promocoes(*)')
    .ilike('codigo', codigo)
    .maybeSingle();
  if (e1) return erroPromocao(res, e1, 'Erro ao validar código.');
  if (!cod || !cod.promocoes) return res.status(404).json({ codigoInvalido: true, message: 'Código não encontrado.' });

  const promocao = cod.promocoes;
  const empresa = req.body.empresa_id ? { id: req.body.empresa_id } : { id: '__preview__' };
  let resgatesDaEmpresa = [];
  if (req.body.empresa_id && promocao.uso_unico_por_empresa) {
    const { data: rs } = await supabase
      .from('promocao_resgates')
      .select('id')
      .eq('promocao_id', promocao.id)
      .eq('empresa_id', req.body.empresa_id);
    resgatesDaEmpresa = rs || [];
  }
  const aval = avaliarResgate({
    promocao,
    codigoRegistro: cod,
    empresa,
    planoEscolhidoId: req.body.planoEscolhidoId || null,
    resgatesDaEmpresa,
    agora: new Date(),
    manual: false,
  });
  if (!aval.ok) return res.status(422).json({ codigoInvalido: true, motivo: aval.motivo, message: aval.message });

  const efeito = aplicarPromocao({
    promocao,
    precoMensalidade: req.body.precoMensalidade != null ? Number(req.body.precoMensalidade) : null,
    valorImplantacao: req.body.valorImplantacao != null ? Number(req.body.valorImplantacao) : null,
    trialDiasBase: req.body.trialDiasBase != null ? Number(req.body.trialDiasBase) : null,
  });
  if (!efeito.ok) return res.status(422).json({ codigoInvalido: true, motivo: efeito.motivo, message: efeito.message });
  res.json({ ok: true, promocao_id: promocao.id, tipo: promocao.tipo, efeito });
});

// POST /painel-admin/promocoes/:id/aplicar — aplicar MANUALMENTE a uma empresa
// (super-admin), inclusive após o fim da campanha. Registra o resgate (auditoria).
// Body: { empresa_id, motivo?, precoMensalidade?, valorImplantacao?, trialDiasBase?, planoEscolhidoId?, fatura_id? }
router.post('/promocoes/:id/aplicar', async (req, res) => {
  const empresa_id = req.body && req.body.empresa_id;
  if (!empresa_id) return res.status(400).json({ message: 'Informe a empresa.' });

  const { data: promocao, error: e1 } = await supabase.from('promocoes').select('*').eq('id', req.params.id).maybeSingle();
  if (e1) return erroPromocao(res, e1, 'Erro ao carregar promoção.');
  if (!promocao) return res.status(404).json({ message: 'Promoção não encontrada.' });

  let resgatesDaEmpresa = [];
  if (promocao.uso_unico_por_empresa) {
    const { data: rs } = await supabase.from('promocao_resgates').select('id').eq('promocao_id', promocao.id).eq('empresa_id', empresa_id);
    resgatesDaEmpresa = rs || [];
  }
  const aval = avaliarResgate({
    promocao,
    empresa: { id: empresa_id },
    planoEscolhidoId: req.body.planoEscolhidoId || null,
    resgatesDaEmpresa,
    agora: new Date(),
    manual: true, // super-admin fura janela/ativo, não os limites
  });
  if (!aval.ok) return res.status(422).json({ motivo: aval.motivo, message: aval.message });

  const efeito = aplicarPromocao({
    promocao,
    precoMensalidade: req.body.precoMensalidade != null ? Number(req.body.precoMensalidade) : null,
    valorImplantacao: req.body.valorImplantacao != null ? Number(req.body.valorImplantacao) : null,
    trialDiasBase: req.body.trialDiasBase != null ? Number(req.body.trialDiasBase) : null,
  });
  if (!efeito.ok) return res.status(422).json({ motivo: efeito.motivo, message: efeito.message });

  const resgate = montarResgate({
    promocao,
    empresa: { id: empresa_id },
    aplicadoPor: req.user && req.user.uid ? req.user.uid : null,
    manual: true,
    efeito,
    motivo: req.body.motivo || null,
    faturaId: req.body.fatura_id || null,
    precoOriginal: req.body.precoMensalidade != null ? Number(req.body.precoMensalidade) : (req.body.valorImplantacao != null ? Number(req.body.valorImplantacao) : null),
  });
  const { data: inserido, error: e2 } = await supabase.from('promocao_resgates').insert(resgate).select().single();
  if (e2) return erroPromocao(res, e2, 'Erro ao registrar aplicação.');

  // Incrementa contadores (best-effort; não desfaz o resgate se falhar).
  await supabase.from('promocoes').update({ usos_total: (Number(promocao.usos_total) || 0) + 1 }).eq('id', promocao.id);

  res.status(201).json({ ok: true, resgate: inserido, efeito });
});

module.exports = router;
