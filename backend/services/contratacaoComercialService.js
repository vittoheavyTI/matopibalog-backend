const crypto = require('crypto');
const {
  STATUS_CONTRATO,
  STATUS_PROPOSTA,
  deveCriarFaturaImplantacao,
  montarContratoTecnico,
  montarSnapshotProposta,
} = require('./contratacaoComercialDomainService');

const BUCKET_CONTRATOS = 'contratos-comerciais';

function emailHash(email) {
  if (!email) return null;
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

function tabelaAusente(error) {
  return error && (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|could not find the table|schema cache/i.test(error.message || '')
  );
}

async function carregarPlanoComercial(supabase, planoId) {
  if (!planoId) return { plano: null, error: null };
  const { data, error } = await supabase
    .from('planos')
    .select('id, nome, descricao, preco_mensal, dias_trial, limite_motoristas, capacidade_inclusa, preco_motorista_extra, valor_implantacao, requer_negociacao, ativo')
    .eq('id', planoId)
    .maybeSingle();
  return { plano: data || null, error };
}

async function criarPropostaEContrato({
  supabase,
  empresa,
  responsavel,
  plano,
  origem = 'cadastro_publico',
  criadoPor = null,
  overrideImplantacaoValor,
  overrideImplantacaoMotivo,
} = {}) {
  const snapshot = montarSnapshotProposta({
    plano,
    quantidadeContratada: empresa?.quantidade_contratada || plano?.capacidade_inclusa || plano?.limite_motoristas || 1,
    trialDias: plano?.dias_trial || 0,
    origem,
    overrideImplantacaoValor,
    overrideImplantacaoMotivo,
    overridePor: criadoPor,
  });
  if (!snapshot.ok) {
    const err = new Error('Nao foi possivel montar a proposta comercial.');
    err.motivo = snapshot.motivo;
    throw err;
  }

  const propostaPayload = {
    empresa_id: empresa.id,
    plano_id: plano.id,
    status: STATUS_PROPOSTA.ACEITA,
    origem,
    snapshot: snapshot.proposta,
    valor_mensal: snapshot.proposta.valor_mensal,
    valor_implantacao: snapshot.proposta.valor_implantacao,
    total_inicial: snapshot.proposta.total_inicial,
    trial_dias: snapshot.proposta.trial_dias,
    implantacao_override_motivo: snapshot.proposta.implantacao_override_motivo,
    criado_por: criadoPor,
    aceito_por: criadoPor,
    aceito_em: new Date().toISOString(),
  };

  const { data: proposta, error: propostaError } = await supabase
    .from('propostas_comerciais')
    .insert(propostaPayload)
    .select()
    .single();
  if (propostaError) {
    if (tabelaAusente(propostaError)) return { skipped: true, motivo: 'migration_pendente' };
    throw propostaError;
  }

  const contrato = montarContratoTecnico({ empresa, responsavel, proposta: snapshot.proposta });
  const { data: contratoRow, error: contratoError } = await supabase
    .from('contratos_comerciais')
    .insert({
      proposta_id: proposta.id,
      empresa_id: empresa.id,
      status: STATUS_CONTRATO.ACEITO_MANUALMENTE,
      template_version: contrato.template_version,
      provider: contrato.provider,
      content_hash: contrato.content_hash,
      metadata: {
        aviso_juridico: 'conteudo_tecnico_pendente_revisao_juridica',
        implantacao_gratis: snapshot.proposta.implantacao_gratis,
      },
      aceito_por: criadoPor,
      aceito_em: propostaPayload.aceito_em,
    })
    .select()
    .single();
  if (contratoError) throw contratoError;

  await supabase.from('contrato_signatarios').insert({
    contrato_id: contratoRow.id,
    empresa_id: empresa.id,
    nome: responsavel?.nome || 'Responsavel',
    papel: 'cliente',
    email_hash: emailHash(responsavel?.email),
    status: 'assinado',
    assinado_em: propostaPayload.aceito_em,
  });

  await supabase.from('contrato_eventos').insert({
    contrato_id: contratoRow.id,
    empresa_id: empresa.id,
    tipo: 'cadastro_aceito',
    detalhe: {
      origem,
      implantacao: snapshot.proposta.implantacao_gratis ? 'gratis' : 'positiva',
      fatura_implantacao: snapshot.proposta.implantacao_gratis ? 'nao_criada' : 'pendente_fluxo_autorizado',
    },
    criado_por: criadoPor,
  });

  return {
    proposta_id: proposta.id,
    contrato_id: contratoRow.id,
    snapshot: snapshot.proposta,
  };
}

async function listarContratacaoEmpresa({ supabase, empresaId }) {
  const { data, error } = await supabase
    .from('propostas_comerciais')
    .select('id, status, snapshot, valor_mensal, valor_implantacao, total_inicial, trial_dias, aceito_em, contratos_comerciais(id, status, template_version, provider, content_hash, signed_storage_path, aceito_em)')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(10);
  if (error) {
    if (tabelaAusente(error)) return { propostas: [], migration_pendente: true };
    throw error;
  }
  return { propostas: data || [], migration_pendente: false };
}

function propostaDoContrato(contrato) {
  const p = contrato && contrato.propostas_comerciais;
  return Array.isArray(p) ? (p[0] || null) : (p || null);
}

async function aceitarContrato({ supabase, contratoId, empresaId, usuarioId, cobrancaImplantacao = null }) {
  const { data: contrato, error } = await supabase
    .from('contratos_comerciais')
    .select('id, proposta_id, empresa_id, status, propostas_comerciais(id, snapshot)')
    .eq('id', contratoId)
    .maybeSingle();
  if (error) throw error;
  if (!contrato || contrato.empresa_id !== empresaId) return { status: 404, body: { message: 'Contrato nao encontrado.' } };

  const proposta = propostaDoContrato(contrato);
  const deveCobrarImplantacao = deveCriarFaturaImplantacao(proposta?.snapshot).criar;

  if ([STATUS_CONTRATO.ASSINADO, STATUS_CONTRATO.ACEITO_MANUALMENTE].includes(contrato.status)) {
    let faturaImplantacao = null;
    if (deveCobrarImplantacao && cobrancaImplantacao?.executar) {
      faturaImplantacao = await cobrancaImplantacao.executar({ contrato, proposta });
    }
    return { status: 200, body: { id: contrato.id, status: contrato.status, idempotente: true, fatura_implantacao: faturaImplantacao } };
  }

  if (deveCobrarImplantacao && cobrancaImplantacao?.validar) {
    await cobrancaImplantacao.validar({ contrato, proposta });
  }

  const agora = new Date().toISOString();
  await supabase.from('contratos_comerciais')
    .update({ status: STATUS_CONTRATO.ACEITO_MANUALMENTE, aceito_por: usuarioId, aceito_em: agora, atualizado_em: agora })
    .eq('id', contrato.id)
    .eq('empresa_id', empresaId);
  await supabase.from('propostas_comerciais')
    .update({ status: STATUS_PROPOSTA.ACEITA, aceito_por: usuarioId, aceito_em: agora, atualizado_em: agora })
    .eq('id', contrato.proposta_id)
    .eq('empresa_id', empresaId);
  await supabase.from('contrato_eventos').insert({
    contrato_id: contrato.id,
    empresa_id: empresaId,
    tipo: 'aceite_manual',
    detalhe: {},
    criado_por: usuarioId,
  });

  let faturaImplantacao = null;
  if (deveCobrarImplantacao && cobrancaImplantacao?.executar) {
    faturaImplantacao = await cobrancaImplantacao.executar({ contrato, proposta });
  }

  return {
    status: 200,
    body: {
      id: contrato.id,
      status: STATUS_CONTRATO.ACEITO_MANUALMENTE,
      idempotente: false,
      fatura_implantacao: faturaImplantacao,
    },
  };
}

module.exports = {
  BUCKET_CONTRATOS,
  emailHash,
  tabelaAusente,
  carregarPlanoComercial,
  criarPropostaEContrato,
  listarContratacaoEmpresa,
  propostaDoContrato,
  aceitarContrato,
};
