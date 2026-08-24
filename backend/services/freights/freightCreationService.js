'use strict';

const { calcularComissao } = require('../../utils/comissao');
const { normalizarModalidade, calcularValorToneladaKm } = require('../../utils/calculoFrete');
const { validarLimitesFrete } = require('../../utils/limitesFrete');

class FreightCreationError extends Error {
  constructor(message, { status = 400, code = 'freight_creation_error', details = null, dbError = null } = {}) {
    super(message);
    this.name = 'FreightCreationError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.dbError = dbError;
  }
}

const respostaLimiteFrete = (limite, message = limite?.message) => ({
  error: 'frete_operational_limit',
  field: limite?.campo,
  current_value: limite?.valorAtual,
  max_value: limite?.limiteValor,
  limit: limite?.limite,
  message: message || 'Valor fora dos limites operacionais. Confira os dados do frete.',
});

async function checkMotoristaStatus(supabase, uid) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('status')
    .eq('id', uid)
    .single();

  if (error || !data) return false;
  return data.status === 'ativo';
}

async function loadMotoristaFreightContext(supabase, motoristaId) {
  const { data: motorista, error: motoristaError } = await supabase
    .from('motoristas')
    .select('placa_veiculo, percentual_comissao, empresa_id, unidade_operacional_id')
    .eq('id', motoristaId)
    .single();

  if (motoristaError || !motorista) {
    throw new FreightCreationError('Dados do motorista não encontrados.', {
      status: 500,
      code: 'driver_context_not_found',
      dbError: motoristaError || null,
    });
  }

  const { data: empresa, error: empresaError } = await supabase
    .from('empresas')
    .select('tipo')
    .eq('id', motorista.empresa_id)
    .single();

  if (empresaError || !empresa) {
    console.warn('[freightCreationService] lookup tipo empresa falhou; fallback leniente:', empresaError?.message);
  }

  return { motorista, empresa };
}

function resolveQuemRecebeu({ requestedQuemRecebeu, empresaTipo }) {
  if (empresaTipo === 'autonomo') return 'motorista';
  return requestedQuemRecebeu || 'proprietario';
}

function buildFreightInsertPayload({
  body = {},
  motoristaId,
  motorista,
  empresa,
  unidadeOperacionalId,
  forcedId = null,
}) {
  const modalidade = normalizarModalidade(body.modalidade_calculo) || 'valor_fixo';
  let valorFreteFinal = body.valor_frete !== undefined ? Number(body.valor_frete) : null;

  if (modalidade === 'tonelada_km') {
    const calc = calcularValorToneladaKm({
      toneladas: body.toneladas,
      valorToneladaKm: body.valor_tonelada_km,
      kmInicial: body.km_inicial,
      kmFinal: body.km_final,
    });
    valorFreteFinal = calc !== null ? calc : 0;
  }

  const limite = validarLimitesFrete({
    modalidade,
    valorFrete: valorFreteFinal,
    toneladas: body.toneladas,
    valorToneladaKm: body.valor_tonelada_km,
    kmInicial: body.km_inicial,
    kmFinal: body.km_final,
  });
  if (!limite.ok) {
    throw new FreightCreationError('Valor fora dos limites operacionais. Confira os dados do frete.', {
      status: 422,
      code: 'frete_operational_limit',
      details: respostaLimiteFrete(limite),
    });
  }

  const payload = {
    motorista_id: motoristaId,
    empresa_id: motorista.empresa_id,
    unidade_operacional_id: unidadeOperacionalId,
    origem: body.origem,
    destino: body.destino,
    km_inicial: body.km_inicial,
    valor_frete: valorFreteFinal,
    modalidade_calculo: modalidade,
    toneladas: modalidade === 'tonelada_km' && body.toneladas !== undefined ? Number(body.toneladas) : null,
    valor_tonelada_km: modalidade === 'tonelada_km' && body.valor_tonelada_km !== undefined ? Number(body.valor_tonelada_km) : null,
    quem_recebeu: resolveQuemRecebeu({ requestedQuemRecebeu: body.quem_recebeu, empresaTipo: empresa?.tipo }),
    placa: motorista.placa_veiculo,
    status: body.odometro_obrigatorio === true ? 'pendente' : 'ativo',
  };

  if (forcedId) payload.id = forcedId;

  return {
    payload,
    comissao: calcularComissao(valorFreteFinal, motorista.percentual_comissao, empresa?.tipo),
  };
}

async function createFreight(supabase, {
  user,
  body = {},
  motoristaId,
  resolveOperationalUnit,
  forcedId = null,
} = {}) {
  const effectiveMotoristaId = motoristaId || (user?.role === 'admin' ? (body.motorista_id || user?.uid) : user?.uid);
  const isAtivo = await checkMotoristaStatus(supabase, effectiveMotoristaId);
  if (!isAtivo) {
    throw new FreightCreationError('Motorista não aprovado ou bloqueado.', {
      status: 403,
      code: 'driver_inactive',
    });
  }

  const { motorista, empresa } = await loadMotoristaFreightContext(supabase, effectiveMotoristaId);
  const unidadeOperacionalId = resolveOperationalUnit
    ? await resolveOperationalUnit({ motorista, empresa })
    : motorista.unidade_operacional_id || null;

  const { payload, comissao } = buildFreightInsertPayload({
    body,
    motoristaId: effectiveMotoristaId,
    motorista,
    empresa,
    unidadeOperacionalId,
    forcedId,
  });

  const { data, error } = await supabase
    .from('fretes')
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (forcedId && error.code === '23505') {
      const { data: existing, error: existingError } = await supabase
        .from('fretes')
        .select('*')
        .eq('id', forcedId)
        .eq('empresa_id', payload.empresa_id)
        .maybeSingle();
      if (!existingError && existing) return { data: existing, comissao, replay: true, payload };
    }
    throw new FreightCreationError('Erro ao inserir frete.', {
      status: 500,
      code: 'freight_insert_failed',
      dbError: error,
    });
  }

  return { data, comissao, replay: false, payload };
}

module.exports = {
  FreightCreationError,
  buildFreightInsertPayload,
  createFreight,
  respostaLimiteFrete,
};
