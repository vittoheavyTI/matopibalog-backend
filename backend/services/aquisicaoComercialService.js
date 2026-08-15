const { criarPropostaEContrato, tabelaAusente } = require('./contratacaoComercialService');
const { STATUS_CONTRATO, STATUS_PROPOSTA } = require('./contratacaoComercialDomainService');
const { valorEfetivoEmpresa } = require('./calculadoraComercialService');

const ORIGEM_AQUISICAO = 'aquisicao_explicita';
const ORIGEM_POS_TRIAL_CONTINUAR = 'pos_trial_continuar';
const ORIGENS_EXPLICITAS = new Set([ORIGEM_AQUISICAO, ORIGEM_POS_TRIAL_CONTINUAR]);
const STATUS_PROPOSTA_PENDENTE = new Set([STATUS_PROPOSTA.ENVIADA, STATUS_PROPOSTA.ACEITA, STATUS_PROPOSTA.RASCUNHO]);
const STATUS_CONTRATO_PENDENTE = new Set([
  STATUS_CONTRATO.AGUARDANDO_ASSINATURA,
  STATUS_CONTRATO.PRONTO_ASSINATURA,
  STATUS_CONTRATO.AGUARDANDO_ASSINATURA_CLIENTE,
  STATUS_CONTRATO.AGUARDANDO_ASSINATURA_MATOPIBA,
]);

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function quantidadeEscolhida({ quantidadeContratada, empresa, plano }) {
  const bruto = quantidadeContratada ?? empresa?.quantidade_contratada ?? plano?.capacidade_inclusa ?? plano?.limite_motoristas ?? 1;
  const n = Number(bruto);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function planoComValorEfetivo(plano, quantidade) {
  const calculo = valorEfetivoEmpresa({ plano, quantidade_contratada: quantidade });
  if (!calculo.ok) return { ok: false, motivo: calculo.motivo || 'composicao_invalida' };
  if (calculo.requer_negociacao) return { ok: false, motivo: 'requer_negociacao' };
  if (calculo.acomoda !== true || calculo.valor_total == null) return { ok: false, motivo: calculo.motivo || 'plano_nao_acomoda' };
  return {
    ok: true,
    plano: { ...plano, preco_mensal: calculo.valor_total },
    composicao: calculo,
  };
}

function enriquecerSnapshot(snapshot, composicao) {
  if (!snapshot || !composicao) return snapshot;
  return {
    ...snapshot,
    valor_base: composicao.valor_base,
    quantidade_extra: composicao.quantidade_extra,
    valor_extra: composicao.valor_extra,
    valor_total_centavos: composicao.valor_total_centavos,
    requer_negociacao: composicao.requer_negociacao === true,
    composicao_origem: 'backend_catalogo',
  };
}

function contratoPrincipal(proposta) {
  const c = proposta && proposta.contratos_comerciais;
  if (!c) return null;
  return Array.isArray(c) ? (c[0] || null) : c;
}

function snapshotEquivalente(snapshot, { planoId, quantidade, valorMensal }) {
  if (!snapshot) return false;
  return String(snapshot.plano_id || '') === String(planoId || '')
    && Number(snapshot.quantidade_contratada) === Number(quantidade)
    && Number(snapshot.valor_mensal) === Number(valorMensal);
}

function propostaPendente(proposta) {
  if (!proposta || !STATUS_PROPOSTA_PENDENTE.has(proposta.status)) return false;
  const contrato = contratoPrincipal(proposta);
  if (!contrato) return true;
  return contrato.status !== STATUS_CONTRATO.CANCELADO && contrato.status !== STATUS_CONTRATO.SUBSTITUIDO;
}

async function carregarEmpresa(supabase, empresaId) {
  const { data, error } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function carregarPlano(supabase, planoId) {
  const { data, error } = await supabase
    .from('planos')
    .select('id, nome, descricao, categoria, preco_mensal, dias_trial, limite_motoristas, capacidade_inclusa, preco_motorista_extra, valor_implantacao, requer_negociacao, ativo')
    .eq('id', planoId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function carregarResponsavel(supabase, usuarioId, empresa) {
  if (!usuarioId) return { nome: empresa?.nome || 'Responsavel', email: empresa?.email_contato || null };
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nome, email')
      .eq('id', usuarioId)
      .maybeSingle();
    if (!error && data) return { nome: data.nome || empresa?.nome || 'Responsavel', email: data.email || empresa?.email_contato || null };
  } catch { /* best-effort */ }
  return { nome: empresa?.nome || 'Responsavel', email: empresa?.email_contato || null };
}

async function listarPropostas(supabase, empresaId) {
  try {
    const { data, error } = await supabase
      .from('propostas_comerciais')
      .select('id, empresa_id, plano_id, status, origem, snapshot, valor_mensal, contratos_comerciais(id, status, obrigatorio)')
      .eq('empresa_id', empresaId)
      .order('criado_em', { ascending: false })
      .limit(20);
    if (error) {
      if (tabelaAusente(error)) return [];
      throw error;
    }
    return data || [];
  } catch (error) {
    if (tabelaAusente(error)) return [];
    throw error;
  }
}

async function supersederPendenciasDivergentes({ supabase, empresaId, propostas, usuarioId }) {
  const divergentes = (propostas || []).filter((p) => propostaPendente(p));
  for (const proposta of divergentes) {
    const contrato = contratoPrincipal(proposta);
    if (ORIGENS_EXPLICITAS.has(proposta.origem)) {
      await supabase.from('propostas_comerciais')
        .update({ status: STATUS_PROPOSTA.CANCELADA, atualizado_em: new Date().toISOString() })
        .eq('id', proposta.id)
        .eq('empresa_id', empresaId);
    }
    if (contrato && STATUS_CONTRATO_PENDENTE.has(contrato.status)) {
      await supabase.from('contratos_comerciais')
        .update({ status: STATUS_CONTRATO.SUBSTITUIDO, atualizado_em: new Date().toISOString() })
        .eq('id', contrato.id)
        .eq('empresa_id', empresaId);
      await supabase.from('contrato_eventos').insert({
        contrato_id: contrato.id,
        empresa_id: empresaId,
        tipo: 'contrato_substituido_por_aquisicao_explicita',
        detalhe: {
          proposta_id: proposta.id,
          origem_anterior: proposta.origem || null,
          politica: 'contrato_automatico_cadastro_nao_prova_intencao_compra',
        },
        criado_por: usuarioId || null,
      });
    }
  }
}

async function iniciarAquisicaoComercial({
  supabase,
  empresaId,
  usuarioId,
  planoId,
  quantidadeContratada,
  agora = new Date(),
} = {}) {
  if (!supabase || !empresaId) return { status: 400, body: { message: 'Empresa nao identificada.' } };
  if (!planoId) return { status: 400, body: { message: 'plano_id e obrigatorio.' } };

  const empresa = await carregarEmpresa(supabase, empresaId);
  if (!empresa) return { status: 404, body: { message: 'Empresa nao encontrada.' } };
  if (empresa.commercial_flow_version !== 'v2') {
    return { status: 409, body: { message: 'Aquisicao explicita disponivel apenas para contas v2.', motivo: 'nao_v2' } };
  }

  const plano = await carregarPlano(supabase, planoId);
  if (!plano || plano.ativo !== true) return { status: 404, body: { message: 'Plano nao encontrado.' } };
  if (plano.requer_negociacao === true) return { status: 422, body: { message: 'Este plano exige negociacao comercial.', motivo: 'requer_negociacao' } };

  const quantidade = quantidadeEscolhida({ quantidadeContratada, empresa, plano });
  if (!quantidade) return { status: 422, body: { message: 'Quantidade contratada invalida.', motivo: 'quantidade_invalida' } };

  const efetivo = planoComValorEfetivo(plano, quantidade);
  if (!efetivo.ok) return { status: 422, body: { message: 'Nao foi possivel calcular a composicao comercial.', motivo: efetivo.motivo } };

  const trialEnds = toDate(empresa.trial_ends_at);
  const dataAgora = toDate(agora);
  const posTrial = Boolean(trialEnds && dataAgora && dataAgora >= trialEnds);
  const origem = posTrial ? ORIGEM_POS_TRIAL_CONTINUAR : ORIGEM_AQUISICAO;

  const propostas = await listarPropostas(supabase, empresaId);
  const equivalente = propostas.find((p) =>
    ORIGENS_EXPLICITAS.has(p.origem)
    && propostaPendente(p)
    && snapshotEquivalente(p.snapshot, { planoId, quantidade, valorMensal: efetivo.composicao.valor_total })
  );
  if (equivalente) {
    if (posTrial && empresa.decisao_pos_trial !== 'continuar') {
      await supabase.from('empresas')
        .update({ decisao_pos_trial: 'continuar' })
        .eq('id', empresaId);
    }
    const contrato = contratoPrincipal(equivalente);
    return {
      status: 200,
      body: {
        idempotente: true,
        proposta_id: equivalente.id,
        contrato_id: contrato?.id || null,
        contrato_status: contrato?.status || null,
        origem: equivalente.origem,
        redirect: '/contratacao',
      },
    };
  }

  await supersederPendenciasDivergentes({ supabase, empresaId, propostas, usuarioId });

  const responsavel = await carregarResponsavel(supabase, usuarioId, empresa);
  const r = await criarPropostaEContrato({
    supabase,
    empresa,
    responsavel,
    plano: efetivo.plano,
    quantidadeContratada: quantidade,
    origem,
    criadoPor: usuarioId || null,
    obrigatorio: true,
  });
  if (r.skipped) return { status: 503, body: { message: 'Contratacao comercial indisponivel.', motivo: r.motivo } };

  const snapshot = enriquecerSnapshot(r.snapshot, efetivo.composicao);
  if (JSON.stringify(snapshot) !== JSON.stringify(r.snapshot)) {
    await supabase.from('propostas_comerciais')
      .update({
        snapshot,
        valor_mensal: snapshot.valor_mensal,
        valor_implantacao: snapshot.valor_implantacao,
        total_inicial: snapshot.total_inicial,
      })
      .eq('id', r.proposta_id)
      .eq('empresa_id', empresaId);
  }

  if (origem === ORIGEM_POS_TRIAL_CONTINUAR) {
    await supabase.from('empresas')
      .update({ decisao_pos_trial: 'continuar' })
      .eq('id', empresaId);
  }

  return {
    status: 201,
    body: {
      idempotente: false,
      proposta_id: r.proposta_id,
      contrato_id: r.contrato_id,
      contrato_status: STATUS_CONTRATO.AGUARDANDO_ASSINATURA,
      origem,
      snapshot,
      redirect: '/contratacao',
    },
  };
}

async function registrarNaoContinuar({ supabase, empresaId, usuarioId } = {}) {
  if (!supabase || !empresaId) return { status: 400, body: { message: 'Empresa nao identificada.' } };
  const empresa = await carregarEmpresa(supabase, empresaId);
  if (!empresa) return { status: 404, body: { message: 'Empresa nao encontrada.' } };
  if (empresa.commercial_flow_version !== 'v2') {
    return { status: 409, body: { message: 'Decisao pos-trial disponivel apenas para contas v2.', motivo: 'nao_v2' } };
  }

  const propostas = await listarPropostas(supabase, empresaId);
  const pendentesExplicitas = propostas.filter((p) => ORIGENS_EXPLICITAS.has(p.origem) && propostaPendente(p));
  await supersederPendenciasDivergentes({ supabase, empresaId, propostas: pendentesExplicitas, usuarioId });

  await supabase.from('empresas')
    .update({ decisao_pos_trial: 'nao_continuar' })
    .eq('id', empresaId);

  return {
    status: 200,
    body: {
      resultado: 'trial_encerrado_sem_contratacao',
      decisao_pos_trial: 'nao_continuar',
      fatura: null,
      asaas: null,
    },
  };
}

module.exports = {
  ORIGEM_AQUISICAO,
  ORIGEM_POS_TRIAL_CONTINUAR,
  ORIGENS_EXPLICITAS,
  iniciarAquisicaoComercial,
  registrarNaoContinuar,
  snapshotEquivalente,
};
