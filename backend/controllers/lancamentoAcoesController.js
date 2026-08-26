// lancamentoAcoesController — ações de estado audit-safe dos lançamentos, reutilizadas
// pelos 3 routers (despesas/abastecimentos/vales) via factory por entityType, e também
// pelo PATCH /:id de cada controller (delegação de mudança de status).
//
// Backend é a autoridade (§18/§20): approve/reject/cancel exigem a PERMISSÃO EFETIVA
// correspondente ao status alvo — `launch.approve`, `launch.reject`, `launch.cancel` —,
// nunca a classe de conta legada. Isto fecha `RBV9-INV-110` aqui: as rotas dedicadas já
// exigiam essas chaves, mas o `PATCH /:id` (protegido só por `launch.create`) delegava
// para cá e caía num gate `role==='admin'` — e como todo usuário interno carrega essa
// classe (D-069), um Operador aprovava lançamento sem ter `launch.approve`. A checagem
// agora vive na transição, que é o ponto por onde os dois caminhos passam.
//
// A transição atômica + auditoria + CAS acontece na RPC (workflow). A UI só reflete.
// Cancelar NUNCA deleta (a RPC apenas muda o status e registra o evento).

const supabase = require('../config/supabase');
const workflow = require('../services/lancamentoWorkflow');
const { ensureEffective } = require('../middlewares/requirePermission');

const TABELA = { despesa: 'despesas', abastecimento: 'abastecimentos', vale: 'vales' };

// Permissão canônica exigida por transição. Sem entrada = transição desconhecida,
// que é negada por construção em vez de cair num default permissivo.
const PERMISSAO_POR_STATUS = Object.freeze({
  aprovado: 'launch.approve',
  rejeitado: 'launch.reject',
  cancelado: 'launch.cancel',
});

// Autoridade da transição: super-admin passa (plataforma); qualquer outro precisa da
// permissão efetiva do status alvo. Não há fallback por classe de conta.
async function podeTransicionar(req, novoStatus) {
  const permissao = PERMISSAO_POR_STATUS[novoStatus];
  if (!permissao) return { ok: false, status: 400, message: 'Transição de status inválida.' };
  if (req.user && req.user.is_super_admin === true) return { ok: true };
  const efetivo = await ensureEffective(req);
  if (efetivo && efetivo.permissions && efetivo.permissions[permissao] === true) return { ok: true };
  return {
    ok: false,
    status: 403,
    message: 'Permissão insuficiente para esta ação.',
    permission: permissao,
  };
}

function papelDe(req) {
  if (req.user && req.user.is_super_admin === true) return 'super_admin';
  return (req.user && req.user.role) || 'usuario';
}

// Resolve a empresa ALVO da transição sem confiar no cliente:
//  - admin comum → a própria empresa (req.empresa_id) → a RPC bloqueia cross-tenant;
//  - super-admin → a empresa REAL do lançamento (autoridade global) → busca no banco.
async function resolverEmpresaAlvo(req, tabela, id) {
  if (req.user && req.user.is_super_admin === true) {
    const { data } = await supabase.from(tabela).select('empresa_id').eq('id', id).maybeSingle();
    return data ? data.empresa_id : null;
  }
  return req.empresa_id || null;
}

// Executa uma transição de estado (aprovado/rejeitado/cancelado). Usada tanto pelas
// rotas explícitas quanto pela delegação do PATCH /:id. Motivo aceito por `motivo`,
// `reason` ou `obs_resolucao` (compat com o fluxo atual do painel).
async function executarTransicao(req, res, entityType, novoStatus) {
  const tabela = TABELA[entityType];
  if (!tabela) return res.status(400).json({ message: 'Tipo de lançamento inválido.' });
  const autorizacao = await podeTransicionar(req, novoStatus);
  if (!autorizacao.ok) {
    const corpo = { message: autorizacao.message };
    if (autorizacao.permission) corpo.permission = autorizacao.permission;
    return res.status(autorizacao.status).json(corpo);
  }
  const { id } = req.params;
  const body = req.body || {};
  const motivo = body.motivo != null ? body.motivo : (body.reason != null ? body.reason : body.obs_resolucao);
  const expectedVersion = body.expected_version != null ? Number(body.expected_version) : null;
  const expectedStatus = body.expected_status != null ? String(body.expected_status) : null;

  const empresaAlvo = await resolverEmpresaAlvo(req, tabela, id);
  if (!empresaAlvo) return res.status(404).json({ message: 'Lançamento não encontrado.' });

  const resultado = await workflow.transicionar({
    entityType,
    entityId: id,
    empresaId: empresaAlvo,
    novoStatus,
    actorId: req.user.uid,
    actorRole: papelDe(req),
    source: workflow.detectarOrigem(req),
    motivo: motivo != null ? String(motivo) : null,
    expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : null,
    expectedStatus,
  });

  if (!resultado.ok) {
    return res.status(resultado.http).json({ message: resultado.message, code: resultado.code });
  }
  return res.status(200).json(resultado.data);
}

// Histórico append-only do lançamento (quem criou/aprovou/rejeitou/cancelou, motivo,
// origem, quando) — tenant-scoped, enriquecido com o nome do ator.
async function historicoLancamento(req, res, entityType) {
  const tabela = TABELA[entityType];
  const { id } = req.params;
  try {
    const empresaAlvo = await resolverEmpresaAlvo(req, tabela, id);
    if (!empresaAlvo) return res.status(404).json({ message: 'Lançamento não encontrado.' });
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin && empresaAlvo !== req.empresa_id) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }
    const { data: eventos, error } = await supabase
      .from('lancamento_eventos')
      .select('id, action, from_status, to_status, actor_user_id, actor_role, source, reason, occurred_at')
      .eq('entity_type', entityType)
      .eq('entity_id', id)
      .eq('empresa_id', empresaAlvo)
      .order('occurred_at', { ascending: true });
    if (error) throw error;

    const ids = [...new Set((eventos || []).map((e) => e.actor_user_id).filter(Boolean))];
    let nomes = {};
    if (ids.length) {
      const { data: usuarios } = await supabase.from('usuarios').select('id, nome').in('id', ids);
      nomes = Object.fromEntries((usuarios || []).map((u) => [u.id, u.nome]));
    }
    const enriquecidos = (eventos || []).map((e) => ({ ...e, actor_nome: nomes[e.actor_user_id] || null }));
    return res.status(200).json(enriquecidos);
  } catch (error) {
    console.error(`[lancamentoAcoes:${entityType}:historico] falha`, { id: req.params.id, erro: error?.message || error });
    return res.status(500).json({ message: 'Erro ao carregar o histórico do lançamento.' });
  }
}

// Factory por entityType para os routers.
function criarAcoesLancamento(entityType) {
  return {
    aprovar: (req, res) => executarTransicao(req, res, entityType, 'aprovado'),
    rejeitar: (req, res) => executarTransicao(req, res, entityType, 'rejeitado'),
    cancelar: (req, res) => executarTransicao(req, res, entityType, 'cancelado'),
    historico: (req, res) => historicoLancamento(req, res, entityType),
  };
}

module.exports = { criarAcoesLancamento, executarTransicao, historicoLancamento, TABELA };
