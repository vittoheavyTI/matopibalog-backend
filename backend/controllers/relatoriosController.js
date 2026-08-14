const supabase = require('../config/supabase');
const { calcularComissao } = require('../utils/comissao');
const { freteEstaCancelado } = require('../utils/agregacaoFinanceiraFretes');
const { calcularRentabilidadeFrete, resumirRentabilidade } = require('../utils/rentabilidadeFrete');
const { calcularAcertoMotoristas } = require('../utils/acertoMotorista');
const { montarTorreControle, resumirItensTorre } = require('../utils/torreControle');
const {
  resolverEscopoOperacional,
  aplicarEscopoOperacionalQuery,
  canAccessUnit,
} = require('../services/operationalScopeService');

exports.getFichaViagem = async (req, res) => {
  const { motorista_id, fretes_ids } = req.query;

  if (!motorista_id || !fretes_ids) {
    return res.status(400).json({ message: 'motorista_id e fretes_ids são obrigatórios.' });
  }

  const idsArray = fretes_ids.split(',').filter(Boolean);

  try {
    // Validar que o motorista pertence à empresa do admin (super-admin pula)
    const isSuperAdmin = req.user.is_super_admin === true;
    const operationalScope = isSuperAdmin
      ? await resolverEscopoOperacional(req, { empresaId: req.query.empresa_id || null })
      : await resolverEscopoOperacional(req, { empresaId: req.empresa_id });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (!isSuperAdmin) {
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
    const { data: fretesRaw, error: fretesError } = await supabase
      .from('fretes')
      .select('*')
      .in('id', idsArray)
      .eq('motorista_id', motorista_id);

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
    const { data: abastecimentosRaw, error: eAbast } = await supabase
      .from('abastecimentos')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);

    if (eAbast) throw eAbast;

    const { data: despesasRaw, error: eDespesas } = await supabase
      .from('despesas')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);

    if (eDespesas) throw eDespesas;

    const { data: valesRaw, error: eVales } = await supabase
      .from('vales')
      .select('*')
      .in('frete_id', idsArray)
      .eq('motorista_id', motorista_id);

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

    [...abastecimentos, ...despesas, ...vales].forEach(d => {
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
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;
    if (!empresaAlvo) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const operationalScope = await resolverEscopoOperacional(req, { empresaId: empresaAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }

    const { inicio, fim, motorista_id, status, resultado } = req.query;

    let fretesQuery = supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome), percentual_comissao, empresas!left(tipo))')
      .eq('empresa_id', empresaAlvo);
    fretesQuery = aplicarEscopoOperacionalQuery(fretesQuery, operationalScope);
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
        supabase.from('abastecimentos').select('frete_id, valor_total, status').eq('empresa_id', empresaAlvo).in('frete_id', ids),
        supabase.from('despesas').select('frete_id, valor, tipo, status').eq('empresa_id', empresaAlvo).in('frete_id', ids),
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
    const empresaAlvo = isSuperAdmin ? (req.query.empresa_id || null) : req.empresa_id;
    if (!empresaAlvo) {
      return res.status(400).json({ message: 'Empresa não identificada.' });
    }
    const operationalScope = await resolverEscopoOperacional(req, { empresaId: empresaAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }

    const { inicio, fim, motorista_id } = req.query;

    let fretesQuery = supabase
      .from('fretes')
      .select('id, empresa_id, motorista_id, data, origem, destino, status, valor_frete, motoristas(usuarios(nome), percentual_comissao, empresas!left(tipo, nome))')
      .eq('empresa_id', empresaAlvo);
    fretesQuery = aplicarEscopoOperacionalQuery(fretesQuery, operationalScope);
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
        .select('id, empresa_id, motorista_id, frete_id, data, tipo, descricao, valor, quem_pagou, status')
        .eq('empresa_id', empresaAlvo)
        .in('frete_id', ids);
      let abastecimentosQuery = supabase
        .from('abastecimentos')
        .select('id, empresa_id, motorista_id, frete_id, data, posto, valor_total, quem_pagou, status')
        .eq('empresa_id', empresaAlvo)
        .in('frete_id', ids);
      let valesQuery = supabase
        .from('vales')
        .select('id, empresa_id, motorista_id, frete_id, data, descricao, posto, valor, quem_pagou, status')
        .eq('empresa_id', empresaAlvo)
        .in('frete_id', ids);
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
    const empresaAlvo = req.empresa_id;
    if (!empresaAlvo) {
      return res.status(400).json({ message: 'Empresa nao identificada.' });
    }
    const operationalScope = await resolverEscopoOperacional(req, { empresaId: empresaAlvo });
    if (operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }

    const { inicio, fim, motorista_id, status, nivel } = req.query;
    const niveisValidos = new Set(['critico', 'atencao', 'ok', 'informativo']);
    if (nivel && !niveisValidos.has(nivel)) {
      return res.status(400).json({ message: 'Prioridade invalida.' });
    }

    const { data: empresaExiste, error: empresaErr } = await supabase
      .from('empresas')
      .select('id')
      .eq('id', empresaAlvo)
      .maybeSingle();
    if (empresaErr) throw empresaErr;
    if (!empresaExiste) {
      return res.status(404).json({ message: 'Empresa nao encontrada.' });
    }

    let fretesQuery = supabase
      .from('fretes')
      .select('id, empresa_id, motorista_id, data, origem, destino, placa, status, valor_frete')
      .eq('empresa_id', empresaAlvo);
    fretesQuery = aplicarEscopoOperacionalQuery(fretesQuery, operationalScope);
    if (inicio) fretesQuery = fretesQuery.gte('data', inicio);
    if (fim) fretesQuery = fretesQuery.lte('data', fim);
    if (motorista_id) fretesQuery = fretesQuery.eq('motorista_id', motorista_id);
    if (status === 'em_andamento') {
      fretesQuery = fretesQuery.in('status', ['ativo', 'pendente', 'em_viagem', 'em_andamento']);
    } else if (status) {
      fretesQuery = fretesQuery.eq('status', status);
    }
    fretesQuery = fretesQuery.order('data', { ascending: false }).limit(LIMITE_FRETES);

    const { data: fretesRaw, error: fretesErr } = await fretesQuery;
    if (fretesErr) throw fretesErr;

    const fretesBase = fretesRaw || [];
    const motoristasIds = [...new Set(fretesBase.map((f) => f.motorista_id).filter(Boolean))];
    let motoristasPorId = new Map();
    if (motoristasIds.length) {
      const { data: motoristasRaw, error: motoristasErr } = await supabase
        .from('motoristas')
        .select('id, empresa_id, usuarios(nome)')
        .eq('empresa_id', empresaAlvo)
        .in('id', motoristasIds);
      if (motoristasErr) throw motoristasErr;
      motoristasPorId = new Map((motoristasRaw || []).map((m) => [m.id, m]));
    }

    const fretes = fretesBase.map((frete) => ({
      ...frete,
      motoristas: motoristasPorId.get(frete.motorista_id) || null,
    }));
    const ids = fretes.map((f) => f.id).filter(Boolean);
    let ocorrencias = [];
    let epods = [];
    let evidencias = [];
    let localizacoes = [];
    let localizacaoEstados = [];

    if (ids.length) {
      const [ocRes, epodRes, evidRes, locRes, locEstadoRes] = await Promise.all([
        supabase
          .from('frete_ocorrencias')
          .select('id, frete_id, empresa_id, tipo, status, impacto, ocorrido_em, created_at')
          .eq('empresa_id', empresaAlvo)
          .in('frete_id', ids),
        supabase
          .from('frete_epod')
          .select('id, frete_id, empresa_id, status, comprovado_em, validado_em')
          .eq('empresa_id', empresaAlvo)
          .in('frete_id', ids),
        supabase
          .from('frete_epod_evidencias')
          .select('id, frete_id, empresa_id, status, created_at')
          .eq('empresa_id', empresaAlvo)
          .in('frete_id', ids),
        supabase
          .from('frete_ultima_localizacao')
          .select('frete_id, empresa_id, motorista_id, accuracy_m, captured_at, received_at')
          .eq('empresa_id', empresaAlvo)
          .in('frete_id', ids),
        supabase
          .from('frete_localizacao_estado')
          .select('frete_id, empresa_id, motorista_id, estado, detalhe, atualizado_em, ultima_localizacao_em')
          .eq('empresa_id', empresaAlvo)
          .in('frete_id', ids),
      ]);
      if (ocRes.error) throw ocRes.error;
      if (epodRes.error) throw epodRes.error;
      if (evidRes.error) throw evidRes.error;
      if (locRes.error) throw locRes.error;
      if (locEstadoRes.error) throw locEstadoRes.error;
      ocorrencias = ocRes.data || [];
      epods = epodRes.data || [];
      evidencias = evidRes.data || [];
      localizacoes = locRes.data || [];
      localizacaoEstados = locEstadoRes.data || [];
    }

    let torre = montarTorreControle({ fretes, ocorrencias, epods, evidencias, localizacoes, localizacaoEstados });
    if (nivel) {
      const itensFiltrados = torre.itens.filter((item) => item.nivel === nivel);
      torre = {
        ...torre,
        resumo: resumirItensTorre(itensFiltrados),
        itens: itensFiltrados,
      };
    }

    res.status(200).json({
      ...torre,
      periodo: { inicio: inicio || null, fim: fim || null },
      limite_aplicado: fretes.length >= LIMITE_FRETES,
    });
  } catch (error) {
    console.error('Erro ao carregar torre de controle:', error?.message || error);
    res.status(500).json({ message: 'Erro ao carregar a torre de controle.' });
  }
};
