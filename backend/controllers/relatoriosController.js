const supabase = require('../config/supabase');
const { calcularComissao } = require('../utils/comissao');
const {
  freteEstaCancelado,
  STATUS_FRETE_RECEITA_REALIZADA,
  STATUS_FRETE_EXCLUIDOS,
  STATUS_LANCAMENTO_NAO_COMPOE,
} = require('../utils/agregacaoFinanceiraFretes');
const { calcularRentabilidadeFrete, resumirRentabilidade } = require('../utils/rentabilidadeFrete');
const { calcularAcertoMotoristas } = require('../utils/acertoMotorista');
const { montarTorreControle, resumirItensTorre } = require('../utils/torreControle');
const { carregarCommandCenter } = require('../services/commandCenterService');
const { ensureEffective } = require('../middlewares/requirePermission');
const {
  resolverEscopoOperacional,
  aplicarEscopoOperacionalQuery,
  escopoTemSelecaoInvalida,
  canAccessUnit,
} = require('../services/operationalScopeService');

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function getGrupoAlvo(req) {
  const header = req.headers?.['x-operational-group-id'];
  return req.query?.grupo_id
    || (Array.isArray(header) ? header[0] : header)
    || null;
}

function aplicarEmpresasAutorizadasQuery(query, operationalScope, fallbackEmpresaId = null) {
  const empresaIds = operationalScope?.authorized_empresa_ids || [];
  if (empresaIds.length > 1) return query.in('empresa_id', empresaIds);
  if (empresaIds.length === 1) return query.eq('empresa_id', empresaIds[0]);
  if (fallbackEmpresaId) return query.eq('empresa_id', fallbackEmpresaId);
  return query.in('empresa_id', [ZERO_UUID]);
}

exports.getFichaViagem = async (req, res) => {
  const { motorista_id, fretes_ids } = req.query;

  if (!motorista_id || !fretes_ids) {
    return res.status(400).json({ message: 'motorista_id e fretes_ids são obrigatórios.' });
  }

  const idsArray = fretes_ids.split(',').filter(Boolean);

  try {
    // Validar que o motorista pertence à empresa do admin (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    const grupoAlvo = getGrupoAlvo(req);
    const operationalScope = isSuperAdmin
      ? await resolverEscopoOperacional(req, { empresaId: req.query.empresa_id || null, grupoId: grupoAlvo })
      : await resolverEscopoOperacional(req, { empresaId: req.empresa_id, grupoId: grupoAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (escopoTemSelecaoInvalida(operationalScope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.' });
    }
    if (!isSuperAdmin && !grupoAlvo) {
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id')
        .eq('id', motorista_id)
        .eq('empresa_id', req.empresa_id)
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista não pertence a esta empresa.' });
      }
    } else if (grupoAlvo) {
      const empresaIds = operationalScope.authorized_empresa_ids || [];
      const { data: pertence, error: pertenceError } = await supabase
        .from('usuarios')
        .select('id, empresa_id')
        .eq('id', motorista_id)
        .in('empresa_id', empresaIds.length ? empresaIds : [ZERO_UUID])
        .eq('tipo', 'motorista')
        .single();

      if (pertenceError || !pertence) {
        return res.status(403).json({ message: 'Acesso negado: motorista fora do escopo corporativo.' });
      }
    }

    // 1. Dados do Motorista
    const { data: motorista, error: motError } = await supabase
      .from('motoristas')
      .select('*, usuarios(nome), empresas!left(tipo)')
      .eq('id', motorista_id)
      .single();

    if (motError || !motorista) {
      return res.status(404).json({ message: 'Motorista não encontrado.' });
    }

    // 2. Fretes Selecionados
    let fretesFichaQuery = supabase
      .from('fretes')
      .select('*')
      .in('id', idsArray)
      .eq('motorista_id', motorista_id);
    fretesFichaQuery = aplicarEmpresasAutorizadasQuery(fretesFichaQuery, operationalScope, req.empresa_id || req.query?.empresa_id || null);
    const { data: fretesRaw, error: fretesError } = await fretesFichaQuery;

    if (fretesError) throw fretesError;

    // Status guard (regra oficial — decisão A): uma ficha de viagem é documento
    // financeiro; um frete CANCELADO não pode compor o consolidado como se fosse
    // válido. Se algum id solicitado estiver cancelado, recusa com 422 e NÃO soma
    // nada (nem os fretes, nem despesas/abastecimentos/vales vinculados). Fretes
    // ativos/pendentes seguem permitidos aqui (a ficha é por seleção explícita);
    // a regra de RECEITA REALIZADA por finalizado é aplicada no dashboard.
    if ((fretesRaw || []).some(freteEstaCancelado)) {
      return res.status(422).json({
        message: 'Não é possível gerar a ficha: há frete cancelado na seleção. Remova-o e tente novamente.',
      });
    }

    // 3. Movimentações vinculadas
    let abastecimentosFichaQuery = supabase
      .from('abastecimentos')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);
    abastecimentosFichaQuery = aplicarEmpresasAutorizadasQuery(abastecimentosFichaQuery, operationalScope, req.empresa_id || req.query?.empresa_id || null);
    const { data: abastecimentosRaw, error: eAbast } = await abastecimentosFichaQuery;

    if (eAbast) throw eAbast;

    let despesasFichaQuery = supabase
      .from('despesas')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);
    despesasFichaQuery = aplicarEmpresasAutorizadasQuery(despesasFichaQuery, operationalScope, req.empresa_id || req.query?.empresa_id || null);
    const { data: despesasRaw, error: eDespesas } = await despesasFichaQuery;

    if (eDespesas) throw eDespesas;

    let valesFichaQuery = supabase
      .from('vales')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);
    valesFichaQuery = aplicarEmpresasAutorizadasQuery(valesFichaQuery, operationalScope, req.empresa_id || req.query?.empresa_id || null);
    const { data: valesRaw, error: eVales } = await valesFichaQuery;

    if (eVales) throw eVales;

    // Garantir arrays nunca nulos
    const fretes = fretesRaw || [];
    if (fretes.some((frete) => !canAccessUnit(operationalScope, frete.unidade_operacional_id || null))) {
      return res.status(403).json({ message: 'Ha frete fora do seu escopo operacional.' });
    }
    const abastecimentos = abastecimentosRaw || [];
    const despesas = despesasRaw || [];
    const vales = valesRaw || [];

    // Totais
    let freteBruto = 0;
    let deducoes = 0;

    fretes.forEach(f => {
      freteBruto += parseFloat(f.valor_frete) || 0;
    });

    // Comissão só para vinculado (empresa.tipo conhecido e ≠ 'autonomo'). Autônomo e
    // tipo desconhecido → 0 (nunca assume percentual). `percentual` no retorno mantém o
    // valor cadastral; apenas o cálculo (comissao/saldo_liquido) respeita a regra.
    const empresaTipo = Array.isArray(motorista.empresas)
      ? motorista.empresas[0]?.tipo
      : motorista.empresas?.tipo;
    const comissao = calcularComissao(freteBruto, motorista.percentual_comissao, empresaTipo);

    // Onda 1 (§15): lançamento CANCELADO nunca compõe o consolidado; REJEITADO nunca
    // conta como válido. PENDENTE mantém a regra atual (compõe a ficha por seleção).
    const ESTADO_NAO_COMPOE = new Set(STATUS_LANCAMENTO_NAO_COMPOE);
    [...abastecimentos, ...despesas, ...vales].forEach(d => {
      if (ESTADO_NAO_COMPOE.has(String(d.status || ''))) return;
      if (d.quem_pagou === 'proprietario') {
        deducoes += parseFloat(d.valor || d.valor_total || 0);
      }
    });

    res.status(200).json({
      motorista: {
        nome: motorista.usuarios?.nome || 'Não informado',
        placa: motorista.placa_veiculo,
        percentual: motorista.percentual_comissao
      },
      fretes,
      abastecimentos,
      despesas,
      vales,
      resumo: {
        frete_bruto: freteBruto,
        comissao,
        deducoes,
        saldo_liquido: comissao - deducoes
      }
    });
  } catch (error) {
    console.error('Erro ao consolidar ficha de viagem:', error);
    res.status(500).json({ message: 'Erro ao consolidar ficha de viagem.' });
  }
};

// GET /relatorios/rentabilidade — rentabilidade OPERACIONAL DIRETA por viagem no
// período. Backend é a AUTORIDADE do cálculo (painel só apresenta). Tenant-safe
// (empresa_id do token; super-admin pode passar ?empresa_id=). Agregação em BATCH
// (2 queries de lançamentos, sem N+1). NÃO altera dado algum (read-only).
exports.getRentabilidade = async (req, res) => {
  const LIMITE_FRETES = 1000;
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const grupoAlvo = getGrupoAlvo(req);
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;
    if (!empresaAlvo && !grupoAlvo) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const operationalScope = await resolverEscopoOperacional(req, { empresaId: empresaAlvo, grupoId: grupoAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (escopoTemSelecaoInvalida(operationalScope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.' });
    }

    const { inicio, fim, motorista_id, status, resultado } = req.query;

    let fretesQuery = supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome), percentual_comissao, empresas!left(tipo))');
    fretesQuery = aplicarEscopoOperacionalQuery(fretesQuery, operationalScope);
    fretesQuery = fretesQuery.neq('status', STATUS_FRETE_EXCLUIDOS[0]);
    if (inicio) fretesQuery = fretesQuery.gte('data', inicio);
    if (fim) fretesQuery = fretesQuery.lte('data', fim);
    if (motorista_id) fretesQuery = fretesQuery.eq('motorista_id', motorista_id);
    fretesQuery = fretesQuery.order('data', { ascending: false }).limit(LIMITE_FRETES);

    const { data: fretesRaw, error: fretesErr } = await fretesQuery;
    if (fretesErr) throw fretesErr;

    // Cancelados NUNCA entram (canônico) — nem eles, nem seus lançamentos.
    const fretes = (fretesRaw || []).filter((f) => !freteEstaCancelado(f));
    const ids = fretes.map((f) => f.id);

    let abastecimentos = [];
    let despesas = [];
    if (ids.length) {
      const [abRes, dpRes] = await Promise.all([
        aplicarEmpresasAutorizadasQuery(
          supabase.from('abastecimentos').select('frete_id, valor_total, status'),
          operationalScope,
          empresaAlvo,
        ).in('frete_id', ids),
        aplicarEmpresasAutorizadasQuery(
          supabase.from('despesas').select('frete_id, valor, tipo, status'),
          operationalScope,
          empresaAlvo,
        ).in('frete_id', ids),
      ]);
      if (abRes.error) throw abRes.error;
      if (dpRes.error) throw dpRes.error;
      abastecimentos = abRes.data || [];
      despesas = dpRes.data || [];
    }

    const porFrete = (linhas) => {
      const mapa = new Map();
      for (const l of linhas) {
        if (!mapa.has(l.frete_id)) mapa.set(l.frete_id, []);
        mapa.get(l.frete_id).push(l);
      }
      return mapa;
    };
    const abastPorFrete = porFrete(abastecimentos);
    const despPorFrete = porFrete(despesas);

    let itens = fretes.map((f) => {
      const mot = f.motoristas || {};
      const empresaTipo = Array.isArray(mot.empresas) ? mot.empresas[0]?.tipo : mot.empresas?.tipo;
      const base = calcularRentabilidadeFrete(
        f,
        { abastecimentos: abastPorFrete.get(f.id) || [], despesas: despPorFrete.get(f.id) || [] },
        empresaTipo,
        mot.percentual_comissao,
      );
      return {
        ...base,
        data: f.data ?? null,
        origem: f.origem ?? null,
        destino: f.destino ?? null,
        motorista_id: f.motorista_id ?? null,
        motorista_nome: mot.usuarios?.nome ?? null,
      };
    });

    // Filtros adicionais (aplicados no BACKEND; painel só apresenta).
    if (status) itens = itens.filter((i) => i.status === status);
    if (resultado === 'rentavel') itens = itens.filter((i) => i.realizada && i.resultado_operacional > 0);
    if (resultado === 'prejuizo') itens = itens.filter((i) => i.realizada && i.resultado_operacional < 0);

    const resumo = resumirRentabilidade(itens);

    res.status(200).json({
      resumo,
      itens,
      periodo: { inicio: inicio || null, fim: fim || null },
      limite_aplicado: fretes.length >= LIMITE_FRETES,
    });
  } catch (error) {
    console.error('Erro ao calcular rentabilidade por viagem:', error?.message || error);
    res.status(500).json({ message: 'Erro ao calcular a rentabilidade por viagem.' });
  }
};

// GET /relatorios/acerto-motoristas — apuração read-only do acerto financeiro
// entre empresa e motorista. Backend é a autoridade: o painel só apresenta.
exports.getAcertoMotoristas = async (req, res) => {
  const LIMITE_FRETES = 1500;
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const grupoAlvo = getGrupoAlvo(req);
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;
    if (!empresaAlvo && !grupoAlvo) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const operationalScope = await resolverEscopoOperacional(req, { empresaId: empresaAlvo, grupoId: grupoAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (escopoTemSelecaoInvalida(operationalScope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.' });
    }

    const { inicio, fim, motorista_id } = req.query;

    let fretesQuery = supabase
      .from('fretes')
      .select('id, empresa_id, motorista_id, data, origem, destino, status, valor_frete, motoristas(usuarios(nome), percentual_comissao, empresas!left(tipo, nome))');
    fretesQuery = aplicarEscopoOperacionalQuery(fretesQuery, operationalScope);
    fretesQuery = fretesQuery.eq('status', STATUS_FRETE_RECEITA_REALIZADA);
    if (inicio) fretesQuery = fretesQuery.gte('data', inicio);
    if (fim) fretesQuery = fretesQuery.lte('data', fim);
    if (motorista_id) fretesQuery = fretesQuery.eq('motorista_id', motorista_id);
    fretesQuery = fretesQuery.order('data', { ascending: true }).limit(LIMITE_FRETES);

    const { data: fretesRaw, error: fretesErr } = await fretesQuery;
    if (fretesErr) throw fretesErr;

    const fretes = (fretesRaw || []).filter((f) => !freteEstaCancelado(f));
    const ids = fretes.map((f) => f.id);
    let despesas = [];
    let abastecimentos = [];
    let vales = [];

    if (ids.length) {
      let despesasQuery = supabase
        .from('despesas')
        .select('id, empresa_id, motorista_id, frete_id, data, tipo, descricao, valor, quem_pagou, status');
      despesasQuery = aplicarEmpresasAutorizadasQuery(despesasQuery, operationalScope, empresaAlvo).in('frete_id', ids);
      let abastecimentosQuery = supabase
        .from('abastecimentos')
        .select('id, empresa_id, motorista_id, frete_id, data, posto, valor_total, quem_pagou, status');
      abastecimentosQuery = aplicarEmpresasAutorizadasQuery(abastecimentosQuery, operationalScope, empresaAlvo).in('frete_id', ids);
      let valesQuery = supabase
        .from('vales')
        .select('id, empresa_id, motorista_id, frete_id, data, descricao, posto, valor, quem_pagou, status');
      valesQuery = aplicarEmpresasAutorizadasQuery(valesQuery, operationalScope, empresaAlvo).in('frete_id', ids);
      if (inicio) {
        despesasQuery = despesasQuery.gte('data', inicio);
        abastecimentosQuery = abastecimentosQuery.gte('data', inicio);
        valesQuery = valesQuery.gte('data', inicio);
      }
      if (fim) {
        despesasQuery = despesasQuery.lte('data', fim);
        abastecimentosQuery = abastecimentosQuery.lte('data', fim);
        valesQuery = valesQuery.lte('data', fim);
      }
      const [dpRes, abRes, vlRes] = await Promise.all([
        despesasQuery,
        abastecimentosQuery,
        valesQuery,
      ]);
      if (dpRes.error) throw dpRes.error;
      if (abRes.error) throw abRes.error;
      if (vlRes.error) throw vlRes.error;
      despesas = dpRes.data || [];
      abastecimentos = abRes.data || [];
      vales = vlRes.data || [];
    }

    const acerto = calcularAcertoMotoristas({ fretes, despesas, abastecimentos, vales });

    res.status(200).json({
      ...acerto,
      periodo: { inicio: inicio || null, fim: fim || null },
      limite_aplicado: fretes.length >= LIMITE_FRETES,
    });
  } catch (error) {
    console.error('Erro ao calcular acerto de motoristas:', error?.message || error);
    res.status(500).json({ message: 'Erro ao calcular o acerto de motoristas.' });
  }
};

// GET /relatorios/torre-controle - visao operacional read-only por empresa.
// Backend e a autoridade das prioridades; o painel apenas apresenta.
exports.getTorreControle = async (req, res) => {
  const LIMITE_FRETES = 1000;
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const grupoAlvo = getGrupoAlvo(req);
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;
    if (!empresaAlvo && !grupoAlvo) {
      return res.status(400).json({ message: 'Empresa nao identificada.' });
    }
    const operationalScope = await resolverEscopoOperacional(req, { empresaId: empresaAlvo, grupoId: grupoAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (escopoTemSelecaoInvalida(operationalScope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.' });
    }

    const { inicio, fim, motorista_id, status, nivel } = req.query;
    const niveisValidos = new Set(['critico', 'atencao', 'ok', 'informativo']);
    if (nivel && !niveisValidos.has(nivel)) {
      return res.status(400).json({ message: 'Prioridade invalida.' });
    }

    if (empresaAlvo) {
      const { data: empresaExiste, error: empresaErr } = await supabase
        .from('empresas')
        .select('id')
        .eq('id', empresaAlvo)
        .maybeSingle();
      if (empresaErr) throw empresaErr;
      if (!empresaExiste) {
        return res.status(404).json({ message: 'Empresa nao encontrada.' });
      }
    }

    // Visibilidade financeira (§26/§27): valor do frete só com permissão operacional
    // financeira efetiva (ou super-admin). freight.view/reports.operational.view NÃO
    // concedem financeiro por si.
    let financialVisibility = isSuperAdmin;
    if (!financialVisibility) {
      try {
        const eff = await ensureEffective(req);
        financialVisibility = Boolean(eff?.permissions?.['finance.operational.view']);
      } catch { financialVisibility = false; }
    }

    // Capacidades para o cliente decidir o que renderizar (§30) — sem role hardcode.
    let permissions = {};
    try { permissions = (await ensureEffective(req))?.permissions || {}; } catch { permissions = {}; }
    const capabilities = {
      can_view_freight: isSuperAdmin || permissions['freight.view'] === true || permissions['reports.operational.view'] === true,
      can_view_fleet: isSuperAdmin || permissions['fleet.view'] === true,
      can_view_operational_finance: financialVisibility,
      can_view_documents: isSuperAdmin || permissions['documents.view'] === true,
    };

    const cc = await carregarCommandCenter(supabase, {
      empresaAlvo,
      operationalScope,
      filtros: { inicio, fim, motorista_id, status, nivel },
      financialVisibility,
      limite: LIMITE_FRETES,
    });

    res.status(200).json({
      generated_at: new Date().toISOString(),
      capabilities,
      financial_visibility: financialVisibility,
      resumo: cc.resumo,
      attention_summary: cc.attention_summary,
      itens: cc.itens,
      periodo: { inicio: inicio || null, fim: fim || null },
      limite_aplicado: cc.limite_aplicado,
    });
  } catch (error) {
    console.error('Erro ao carregar torre de controle:', error?.message || error);
    res.status(500).json({ message: 'Erro ao carregar a torre de controle.' });
  }
};
