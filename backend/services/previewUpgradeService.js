// Loader (I/O) do preview de upgrade/add-ons — Fatia 1. READ-ONLY: só lê planos,
// plano atual e a matriz de disponibilidade; NÃO escreve, NÃO cobra, NÃO altera
// plano/entitlement. Delega o cálculo ao serviço PURO montarSnapshotUpgrade.

const { montarSnapshotUpgrade } = require('./snapshotUpgradeService');

// Add-ons do catálogo desta fatia (as 3 funcionalidades do portal do cliente).
const CODIGOS_ADDON = ['estrutura_operacional', 'integracoes_erp', 'acesso_corporativo_sso'];

async function carregarDisponibilidade(supabase, planoId, funcIds) {
  const mapa = new Map();
  if (!planoId || !funcIds.length) return mapa;
  const { data, error } = await supabase
    .from('plano_funcionalidades')
    .select('funcionalidade_id, disponibilidade')
    .eq('plano_id', planoId)
    .in('funcionalidade_id', funcIds);
  if (error || !data) return mapa;
  return new Map(data.map((pf) => [pf.funcionalidade_id, pf.disponibilidade]));
}

async function carregarPreviewUpgrade(supabase, { empresaId, planoAlvoId = null, quantidade = null, addonsSelecionados = [] } = {}) {
  if (!empresaId) return { status: 400, body: { message: 'Empresa não identificada.' } };

  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, plano_id, tipo')
    .eq('id', empresaId)
    .maybeSingle();
  if (!empresa) return { status: 404, body: { message: 'Empresa não encontrada.' } };

  // Catálogo de planos compatível com o tipo da empresa (empresa/ambos ou autonomo/ambos).
  const categorias = empresa.tipo === 'autonomo' ? ['autonomo', 'ambos'] : ['empresa', 'ambos'];
  const { data: planos } = await supabase
    .from('planos')
    .select('id, nome, preco_mensal, capacidade_inclusa, limite_motoristas, preco_motorista_extra, requer_negociacao, categoria, ativo')
    .eq('ativo', true)
    .in('categoria', categorias);
  const lista = planos || [];

  const planoAtual = lista.find((p) => p.id === empresa.plano_id)
    || (empresa.plano_id ? (await supabase.from('planos').select('id, nome, preco_mensal, capacidade_inclusa, limite_motoristas, preco_motorista_extra, requer_negociacao').eq('id', empresa.plano_id).maybeSingle()).data : null);
  if (!planoAtual) return { status: 409, body: { message: 'Plano atual não configurado.', motivo: 'sem_plano_atual' } };

  const planoAlvo = planoAlvoId ? lista.find((p) => p.id === planoAlvoId) || null : null;

  // Funcionalidades add-on (id, nome, status técnico).
  const { data: funcs } = await supabase
    .from('funcionalidades')
    .select('id, codigo, nome, status_ciclo_vida')
    .in('codigo', CODIGOS_ADDON);
  const funcionalidades = funcs || [];
  const funcIds = funcionalidades.map((f) => f.id);
  const idPorCodigo = new Map(funcionalidades.map((f) => [f.codigo, f.id]));

  const dispAtualPorId = await carregarDisponibilidade(supabase, planoAtual.id, funcIds);
  const dispAlvoPorId = planoAlvo ? await carregarDisponibilidade(supabase, planoAlvo.id, funcIds) : new Map();

  // Converte para Map(codigo -> disponibilidade).
  const dispAtual = new Map();
  const dispAlvo = new Map();
  for (const f of funcionalidades) {
    dispAtual.set(f.codigo, dispAtualPorId.get(f.id) || 'indisponivel');
    if (planoAlvo) dispAlvo.set(f.codigo, dispAlvoPorId.get(f.id) || 'indisponivel');
  }

  const addons = funcionalidades.map((f) => ({
    codigo: f.codigo,
    nome: f.nome,
    em_breve: f.status_ciclo_vida !== 'disponivel',
  }));

  const selecionados = (Array.isArray(addonsSelecionados) ? addonsSelecionados : [])
    .filter((c) => idPorCodigo.has(c));

  const q = Number.isFinite(quantidade) && quantidade > 0
    ? quantidade
    : (planoAtual.capacidade_inclusa || planoAtual.limite_motoristas || 1);

  const r = montarSnapshotUpgrade({
    planoAtual, planoAlvo, quantidade: q, addons, selecionados, dispAtual, dispAlvo,
  });
  if (!r.ok) return { status: 422, body: { message: 'Não foi possível montar o snapshot.', motivo: r.motivo } };

  // Planos disponíveis para comparar (id/nome/preço) — sem expor dados sensíveis.
  const planosComparaveis = lista
    .map((p) => ({ id: p.id, nome: p.nome, preco_mensal: Number(p.preco_mensal) || 0, requer_negociacao: p.requer_negociacao === true }));

  return { status: 200, body: { ...r.snapshot, planos: planosComparaveis } };
}

module.exports = { carregarPreviewUpgrade, CODIGOS_ADDON };
