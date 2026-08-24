'use strict';

// Serviço canônico da Torre de Controle / Command Center V2.
//
// Fonte ÚNICA de carregamento + classificação de atenção (reusa o engine
// determinístico utils/torreControle). Usado pelo endpoint web E pela tool de IA,
// para NÃO duplicar regras (§12/§72). READ-ONLY: nunca escreve.
//
// Autoridade (tenant/escopo) é aplicada no boundary de query pelo chamador via
// operationalScope já resolvido. financialVisibility controla exposição de valor.

const {
  aplicarEscopoOperacionalQuery,
} = require('./operationalScopeService');
const { montarTorreControle, resumirItensTorre } = require('../utils/torreControle');

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const LIMITE_FRETES_PADRAO = 1000;
const STATUS_ATIVOS_FILTRO = ['ativo', 'pendente', 'em_viagem', 'em_andamento'];

function aplicarEmpresasAutorizadasQuery(query, operationalScope, fallbackEmpresaId = null) {
  const empresaIds = operationalScope?.authorized_empresa_ids || [];
  if (empresaIds.length > 1) return query.in('empresa_id', empresaIds);
  if (empresaIds.length === 1) return query.eq('empresa_id', empresaIds[0]);
  if (fallbackEmpresaId) return query.eq('empresa_id', fallbackEmpresaId);
  return query.in('empresa_id', [ZERO_UUID]);
}

// Resumo por categoria estruturada de atenção (§40) — ajuda filtros e IA.
function resumirPorCodigo(itens = []) {
  const mapa = {};
  for (const i of itens) {
    if (i.nivel === 'ok' || i.nivel === 'informativo') continue;
    const c = i.attention_code || 'INFORMATIVO';
    mapa[c] = (mapa[c] || 0) + 1;
  }
  return mapa;
}

// Carrega e classifica. `filtros`: { inicio, fim, motorista_id, status, nivel }.
// `operationalScope` já resolvido; `financialVisibility` já decidido pelo chamador.
async function carregarCommandCenter(supabase, {
  empresaAlvo = null,
  operationalScope,
  filtros = {},
  financialVisibility = false,
  limite = LIMITE_FRETES_PADRAO,
} = {}) {
  const { inicio, fim, motorista_id, status, nivel } = filtros;

  let fretesQuery = supabase
    .from('fretes')
    .select('id, empresa_id, motorista_id, data, origem, destino, placa, status, valor_frete');
  fretesQuery = aplicarEscopoOperacionalQuery(fretesQuery, operationalScope);
  if (inicio) fretesQuery = fretesQuery.gte('data', inicio);
  if (fim) fretesQuery = fretesQuery.lte('data', fim);
  if (motorista_id) fretesQuery = fretesQuery.eq('motorista_id', motorista_id);
  if (status === 'em_andamento') fretesQuery = fretesQuery.in('status', STATUS_ATIVOS_FILTRO);
  else if (status) fretesQuery = fretesQuery.eq('status', status);
  fretesQuery = fretesQuery.order('data', { ascending: false }).limit(limite);

  const { data: fretesRaw, error: fretesErr } = await fretesQuery;
  if (fretesErr) throw fretesErr;
  const fretesBase = fretesRaw || [];

  const motoristasIds = [...new Set(fretesBase.map((f) => f.motorista_id).filter(Boolean))];
  let motoristasPorId = new Map();
  if (motoristasIds.length) {
    let mq = supabase.from('motoristas').select('id, empresa_id, usuarios(nome)').in('id', motoristasIds);
    mq = aplicarEmpresasAutorizadasQuery(mq, operationalScope, empresaAlvo);
    const { data: motoristasRaw, error: motoristasErr } = await mq;
    if (motoristasErr) throw motoristasErr;
    motoristasPorId = new Map((motoristasRaw || []).map((m) => [m.id, m]));
  }

  const fretes = fretesBase.map((f) => ({ ...f, motoristas: motoristasPorId.get(f.motorista_id) || null }));
  const ids = fretes.map((f) => f.id).filter(Boolean);

  let ocorrencias = []; let epods = []; let evidencias = []; let localizacoes = []; let localizacaoEstados = [];
  if (ids.length) {
    const [ocRes, epodRes, evidRes, locRes, locEstadoRes] = await Promise.all([
      aplicarEmpresasAutorizadasQuery(supabase.from('frete_ocorrencias').select('id, frete_id, empresa_id, tipo, status, impacto, ocorrido_em, created_at'), operationalScope, empresaAlvo).in('frete_id', ids),
      aplicarEmpresasAutorizadasQuery(supabase.from('frete_epod').select('id, frete_id, empresa_id, status, comprovado_em, validado_em'), operationalScope, empresaAlvo).in('frete_id', ids),
      aplicarEmpresasAutorizadasQuery(supabase.from('frete_epod_evidencias').select('id, frete_id, empresa_id, status, created_at'), operationalScope, empresaAlvo).in('frete_id', ids),
      aplicarEmpresasAutorizadasQuery(supabase.from('frete_ultima_localizacao').select('frete_id, empresa_id, motorista_id, accuracy_m, captured_at, received_at'), operationalScope, empresaAlvo).in('frete_id', ids),
      aplicarEmpresasAutorizadasQuery(supabase.from('frete_localizacao_estado').select('frete_id, empresa_id, motorista_id, estado, detalhe, atualizado_em, ultima_localizacao_em'), operationalScope, empresaAlvo).in('frete_id', ids),
    ]);
    for (const r of [ocRes, epodRes, evidRes, locRes, locEstadoRes]) { if (r.error) throw r.error; }
    ocorrencias = ocRes.data || []; epods = epodRes.data || []; evidencias = evidRes.data || [];
    localizacoes = locRes.data || []; localizacaoEstados = locEstadoRes.data || [];
  }

  let torre = montarTorreControle({ fretes, ocorrencias, epods, evidencias, localizacoes, localizacaoEstados, financialVisibility });
  if (nivel) {
    const itensFiltrados = torre.itens.filter((item) => item.nivel === nivel);
    torre = { ...torre, resumo: resumirItensTorre(itensFiltrados), itens: itensFiltrados };
  }

  return {
    resumo: torre.resumo,
    attention_summary: resumirPorCodigo(torre.itens),
    itens: torre.itens,
    limite_aplicado: fretesBase.length >= limite,
  };
}

module.exports = { carregarCommandCenter, resumirPorCodigo, LIMITE_FRETES_PADRAO };
