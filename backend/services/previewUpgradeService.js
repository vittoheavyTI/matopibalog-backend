// Loader (I/O) do preview de upgrade/add-ons — Fatia 1. READ-ONLY: só lê planos,
// plano atual e a matriz de disponibilidade; NÃO escreve, NÃO cobra, NÃO altera
// plano/entitlement. Delega o cálculo ao serviço PURO montarSnapshotUpgrade.

const { montarSnapshotUpgrade, estadoCapacidade } = require('./snapshotUpgradeService');
const { avaliarLimiteMotoristas } = require('./planoLimiteService');

// Add-ons do catálogo desta fatia (as 3 funcionalidades do portal do cliente).
const CODIGOS_ADDON = ['estrutura_operacional', 'integracoes_erp', 'acesso_corporativo_sso'];

// Carrega disponibilidade E preço específico do plano por funcionalidade.
// Retorna { disp: Map(funcId->disponibilidade), preco: Map(funcId->centavos|null) }.
async function carregarDisponibilidade(supabase, planoId, funcIds) {
  const disp = new Map();
  const preco = new Map();
  if (!planoId || !funcIds.length) return { disp, preco };
  const { data, error } = await supabase
    .from('plano_funcionalidades')
    .select('funcionalidade_id, disponibilidade, preco_especifico_centavos')
    .eq('plano_id', planoId)
    .in('funcionalidade_id', funcIds);
  if (error || !data) return { disp, preco };
  for (const pf of data) {
    disp.set(pf.funcionalidade_id, pf.disponibilidade);
    preco.set(pf.funcionalidade_id, Number.isFinite(pf.preco_especifico_centavos) ? pf.preco_especifico_centavos : null);
  }
  return { disp, preco };
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

  // Funcionalidades add-on (id, nome, status técnico, preço padrão APROVADO).
  const { data: funcs } = await supabase
    .from('funcionalidades')
    .select('id, codigo, nome, status_ciclo_vida, preco_padrao_centavos')
    .in('codigo', CODIGOS_ADDON);
  const funcionalidades = funcs || [];
  const funcIds = funcionalidades.map((f) => f.id);
  const idPorCodigo = new Map(funcionalidades.map((f) => [f.codigo, f.id]));

  const atualPorId = await carregarDisponibilidade(supabase, planoAtual.id, funcIds);
  const alvoPorId = planoAlvo ? await carregarDisponibilidade(supabase, planoAlvo.id, funcIds) : { disp: new Map(), preco: new Map() };

  // Converte para Map(codigo -> ...).
  const dispAtual = new Map();
  const dispAlvo = new Map();
  const precoEspecificoAtual = new Map();
  const precoEspecificoAlvo = new Map();
  for (const f of funcionalidades) {
    dispAtual.set(f.codigo, atualPorId.disp.get(f.id) || 'indisponivel');
    precoEspecificoAtual.set(f.codigo, atualPorId.preco.get(f.id) ?? null);
    if (planoAlvo) {
      dispAlvo.set(f.codigo, alvoPorId.disp.get(f.id) || 'indisponivel');
      precoEspecificoAlvo.set(f.codigo, alvoPorId.preco.get(f.id) ?? null);
    }
  }

  const addons = funcionalidades.map((f) => ({
    codigo: f.codigo,
    nome: f.nome,
    em_breve: f.status_ciclo_vida !== 'disponivel',
    preco_padrao_centavos: Number.isFinite(f.preco_padrao_centavos) ? f.preco_padrao_centavos : null,
  }));

  const selecionados = (Array.isArray(addonsSelecionados) ? addonsSelecionados : [])
    .filter((c) => idPorCodigo.has(c));

  const q = Number.isFinite(quantidade) && quantidade > 0
    ? quantidade
    : (planoAtual.capacidade_inclusa || planoAtual.limite_motoristas || 1);

  const r = montarSnapshotUpgrade({
    planoAtual, planoAlvo, quantidade: q, addons, selecionados,
    dispAtual, dispAlvo, precoEspecificoAtual, precoEspecificoAlvo,
  });
  if (!r.ok) return { status: 422, body: { message: 'Não foi possível montar o snapshot.', motivo: r.motivo } };

  // Planos disponíveis para comparar (id/nome/preço) — sem expor dados sensíveis.
  const planosComparaveis = lista
    .map((p) => ({ id: p.id, nome: p.nome, preco_mensal: Number(p.preco_mensal) || 0, requer_negociacao: p.requer_negociacao === true }));

  // Uso atual (§11/§12): motoristas ativos × limite do plano, via autoridade
  // canônica (planoLimiteService). READ-ONLY, fail-open: erro não quebra o preview.
  let uso_atual = null;
  try {
    const lim = await avaliarLimiteMotoristas(supabase, empresaId);
    uso_atual = {
      motoristas_ativos: lim.totalAtual,
      limite: lim.limite,
      ilimitado: lim.ilimitado === true,
      capacidade_inclusa: planoAtual.capacidade_inclusa ?? planoAtual.limite_motoristas ?? null,
      estado: estadoCapacidade(lim.totalAtual, lim.limite),
    };
  } catch { /* fail-open: sem uso não bloqueia a comparação */ }

  return { status: 200, body: { ...r.snapshot, planos: planosComparaveis, uso_atual } };
}

module.exports = { carregarPreviewUpgrade, CODIGOS_ADDON };
