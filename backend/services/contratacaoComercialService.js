const crypto = require('crypto');
const {
  STATUS_CONTRATO,
  STATUS_PROPOSTA,
  deveCriarFaturaImplantacao,
  montarContratoTecnico,
  montarSnapshotProposta,
} = require('./contratacaoComercialDomainService');

const { BUCKET_CONTRATOS } = require('./contratacaoStorageService');
const { snapshotVigenteParaContrato } = require('./contratoModeloService');

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
  // Contratação inicial nasce OBRIGATÓRIA: o contrato precisa ser assinado para
  // liberar o uso operacional (gate). Aditivos/contratos opcionais podem passar
  // obrigatorio=false explicitamente.
  obrigatorio = true,
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
    status: STATUS_PROPOSTA.ENVIADA,
    origem,
    snapshot: snapshot.proposta,
    valor_mensal: snapshot.proposta.valor_mensal,
    valor_implantacao: snapshot.proposta.valor_implantacao,
    total_inicial: snapshot.proposta.total_inicial,
    trial_dias: snapshot.proposta.trial_dias,
    implantacao_override_motivo: snapshot.proposta.implantacao_override_motivo,
    criado_por: criadoPor,
    aceito_por: null,
    aceito_em: null,
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

  // Congela o modelo vigente do plano no contrato emitido (se houver). Fail-open:
  // sem modelo publicado (ou migration 057 pendente), o snapshot é null e o
  // contrato usa o texto técnico padrão — o cadastro nunca é bloqueado.
  const { snapshot: modeloSnapshot } = await snapshotVigenteParaContrato({ supabase, planoId: plano.id });

  const { data: contratoRow, error: contratoError } = await supabase
    .from('contratos_comerciais')
    .insert({
      proposta_id: proposta.id,
      empresa_id: empresa.id,
      status: STATUS_CONTRATO.AGUARDANDO_ASSINATURA,
      obrigatorio: obrigatorio === true,
      template_version: contrato.template_version,
      provider: contrato.provider,
      content_hash: contrato.content_hash,
      ...(modeloSnapshot || {}),
      metadata: {
        aviso_juridico: 'conteudo_tecnico_pendente_revisao_juridica',
        implantacao_gratis: snapshot.proposta.implantacao_gratis,
        modelo_vigente: modeloSnapshot ? 'congelado' : 'ausente_fallback_texto_tecnico',
      },
      aceito_por: null,
      aceito_em: null,
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
    status: 'pendente',
    assinado_em: null,
  });

  // Lançamento inicial (sem provedor pago de assinatura): o contrato nasce
  // EMITIDO e PRÉ-ASSINADO institucionalmente pela Matopiba Log. Assim a única
  // parte que precisa executar assinatura manual é o CLIENTE (senha + código por
  // e-mail). Quando o cliente confirma, `confirmarAssinatura` vê cliente+matopiba
  // assinados e finaliza o contrato automaticamente (plenamente_assinado),
  // liberando o gate — sem exigir ação manual do super-admin. O fluxo manual da
  // Matopiba (painel-admin) fica só como contingência (retorna idempotente sobre
  // uma parte já assinada). NÃO é assinatura ICP-Brasil/qualificada.
  const matopibaAssinadoEm = new Date().toISOString();
  const matopibaAssinaturaHash = crypto.createHash('sha256').update(JSON.stringify({
    contrato_id: contratoRow.id,
    empresa_id: empresa.id,
    papel: 'matopiba',
    emissao: 'institucional',
    content_hash: contrato.content_hash,
    assinado_em: matopibaAssinadoEm,
  }), 'utf8').digest('hex');
  await supabase.from('contrato_signatarios').insert({
    contrato_id: contratoRow.id,
    empresa_id: empresa.id,
    nome: 'Matopiba Log',
    papel: 'matopiba',
    email_hash: null,
    status: 'assinado',
    assinado_em: matopibaAssinadoEm,
    metodo_assinatura: 'manual',
    assinatura_hash: matopibaAssinaturaHash,
    document_hash_assinado: contrato.content_hash,
    consent_text_version: 'emissao-institucional-v1',
    consent_text: 'Contrato emitido e pré-assinado institucionalmente pela Matopiba Log no lançamento inicial, sem provedor pago de assinatura. A parte cliente assina eletronicamente com confirmação por e-mail e registro técnico.',
  });

  await supabase.from('contrato_eventos').insert({
    contrato_id: contratoRow.id,
    empresa_id: empresa.id,
    tipo: 'cadastro_aceito',
    detalhe: {
      origem,
      implantacao: snapshot.proposta.implantacao_gratis ? 'gratis' : 'positiva',
      fatura_implantacao: snapshot.proposta.implantacao_gratis ? 'nao_criada' : 'aguarda_acao_financeira',
    },
    criado_por: criadoPor,
  });

  // Evento técnico da emissão/pré-assinatura institucional da Matopiba (trilha).
  await supabase.from('contrato_eventos').insert({
    contrato_id: contratoRow.id,
    empresa_id: empresa.id,
    tipo: 'assinatura_matopiba_institucional',
    detalhe: {
      emissao: 'institucional',
      metodo: 'manual',
      representante: 'Matopiba Log',
      observacao: 'pre_assinatura_institucional_sem_otp',
      assinado_em: matopibaAssinadoEm,
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
    .select('id, status, snapshot, valor_mensal, valor_implantacao, total_inicial, trial_dias, aceito_em, contratos_comerciais(id, status, obrigatorio, template_version, provider, signature_method, storage_path, signed_storage_path, certificate_storage_path, signed_file_hash, certificate_file_hash, aceito_em, contrato_signatarios(papel, status, assinado_em))')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(10);
  if (error) {
    if (tabelaAusente(error)) return { propostas: [], migration_pendente: true };
    throw error;
  }
  const propostas = (data || []).map((proposta) => {
    const contratos = Array.isArray(proposta.contratos_comerciais)
      ? proposta.contratos_comerciais
      : (proposta.contratos_comerciais ? [proposta.contratos_comerciais] : []);
    const resumo = proposta.snapshot || {};
    return {
      id: proposta.id,
      status: proposta.status,
      resumo,
      valor_mensal: proposta.valor_mensal,
      valor_implantacao: proposta.valor_implantacao,
      total_inicial: proposta.total_inicial,
      trial_dias: proposta.trial_dias,
      aceito_em: proposta.aceito_em,
      contratos_comerciais: contratos.map((contrato) => {
        const signatarios = Array.isArray(contrato.contrato_signatarios) ? contrato.contrato_signatarios : [];
        const dataAssinatura = (papel) => {
          const s = signatarios.find((x) => x && x.papel === papel && x.status === 'assinado');
          return s ? s.assinado_em : null;
        };
        return {
          id: contrato.id,
          status: contrato.status,
          obrigatorio: contrato.obrigatorio === true,
          versao: contrato.template_version,
          metodo_assinatura: contrato.signature_method || contrato.provider || 'manual',
          documento_pronto: Boolean(contrato.storage_path),
          contrato_assinado_disponivel: Boolean(contrato.signed_storage_path),
          certificado_disponivel: Boolean(contrato.certificate_storage_path),
          signed_storage_path: contrato.signed_storage_path,
          certificate_storage_path: contrato.certificate_storage_path,
          signed_file_hash: contrato.signed_file_hash,
          certificate_file_hash: contrato.certificate_file_hash,
          assinatura_cliente_em: dataAssinatura('cliente'),
          assinatura_matopiba_em: dataAssinatura('matopiba'),
          aceito_em: contrato.aceito_em,
        };
      }),
    };
  });
  return { propostas, migration_pendente: false };
}

// Resumo enxuto para a navegação do cliente (sidebar) e redirecionamentos:
// existe pendência OBRIGATÓRIA? existe contrato? algum concluído? Fail-open.
async function resumoContratacaoEmpresa({ supabase, empresaId }) {
  try {
    const { data, error } = await supabase
      .from('contratos_comerciais')
      .select('status, obrigatorio')
      .eq('empresa_id', empresaId);
    if (error) {
      if (tabelaAusente(error)) return { pendencia_obrigatoria: false, tem_contrato: false, concluido: false, migration_pendente: true };
      return { pendencia_obrigatoria: false, tem_contrato: false, concluido: false, migration_pendente: false };
    }
    const { pendenciaObrigatoria, STATUS_CONCLUIDOS } = require('./contratoGateService');
    const contratos = data || [];
    return {
      pendencia_obrigatoria: pendenciaObrigatoria(contratos),
      tem_contrato: contratos.length > 0,
      concluido: contratos.some((c) => c && STATUS_CONCLUIDOS.has(c.status)),
      migration_pendente: false,
    };
  } catch {
    return { pendencia_obrigatoria: false, tem_contrato: false, concluido: false, migration_pendente: false };
  }
}

function propostaDoContrato(contrato) {
  const p = contrato && contrato.propostas_comerciais;
  return Array.isArray(p) ? (p[0] || null) : (p || null);
}

async function aceitarContrato({ supabase, contratoId, empresaId, usuarioId, cobrancaImplantacao = null }) {
  const { data: contrato, error } = await supabase
    .from('contratos_comerciais')
    .select('id, proposta_id, empresa_id, status, propostas_comerciais(id, status, snapshot)')
    .eq('id', contratoId)
    .maybeSingle();
  if (error) throw error;
  if (!contrato || contrato.empresa_id !== empresaId) return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  if (contrato.status === STATUS_CONTRATO.CANCELADO) {
    return { status: 409, body: { message: 'Contrato cancelado nao pode ser aceito.' } };
  }

  const proposta = propostaDoContrato(contrato);
  if ([STATUS_PROPOSTA.CANCELADA, STATUS_PROPOSTA.EXPIRADA].includes(proposta?.status)) {
    return { status: 409, body: { message: 'Proposta cancelada ou expirada nao pode ser aceita.' } };
  }

  if (contrato.status === STATUS_CONTRATO.ACEITO_MANUALMENTE) {
    return { status: 200, body: { id: contrato.id, status: contrato.status, idempotente: true, fatura_implantacao: null } };
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

  return {
    status: 200,
    body: {
      id: contrato.id,
      status: STATUS_CONTRATO.ACEITO_MANUALMENTE,
      idempotente: false,
      fatura_implantacao: null,
    },
  };
}

async function criarCobrancaImplantacaoContrato({ supabase, contratoId, empresaId, usuarioId, cobrancaImplantacao }) {
  const { data: contrato, error } = await supabase
    .from('contratos_comerciais')
    .select('id, proposta_id, empresa_id, status, propostas_comerciais(id, status, snapshot)')
    .eq('id', contratoId)
    .maybeSingle();
  if (error) throw error;
  if (!contrato || contrato.empresa_id !== empresaId) return { status: 404, body: { message: 'Contrato nao encontrado.' } };
  if (contrato.status === STATUS_CONTRATO.CANCELADO) return { status: 409, body: { message: 'Contrato cancelado nao pode gerar cobranca.' } };

  const proposta = propostaDoContrato(contrato);
  if (proposta?.status !== STATUS_PROPOSTA.ACEITA) {
    return { status: 409, body: { message: 'Aceite o contrato antes de gerar a cobranca de implantacao.' } };
  }

  const decisao = deveCriarFaturaImplantacao(proposta?.snapshot);
  if (!decisao.criar) {
    return { status: 200, body: { resultado: 'pulada', motivo: decisao.motivo, fatura_implantacao: null } };
  }
  if (!cobrancaImplantacao?.validar || !cobrancaImplantacao?.executar) {
    return { status: 503, body: { message: 'Cobranca de implantacao ainda nao configurada.' } };
  }

  await cobrancaImplantacao.validar({ contrato, proposta });
  const faturaImplantacao = await cobrancaImplantacao.executar({ contrato, proposta });
  await supabase.from('contrato_eventos').insert({
    contrato_id: contrato.id,
    empresa_id: empresaId,
    tipo: 'cobranca_implantacao_solicitada',
    detalhe: { origem: 'acao_financeira_explicita' },
    criado_por: usuarioId,
  });
  return { status: 200, body: { resultado: 'ok', fatura_implantacao: faturaImplantacao } };
}

module.exports = {
  BUCKET_CONTRATOS,
  emailHash,
  tabelaAusente,
  carregarPlanoComercial,
  criarPropostaEContrato,
  listarContratacaoEmpresa,
  resumoContratacaoEmpresa,
  propostaDoContrato,
  aceitarContrato,
  criarCobrancaImplantacaoContrato,
};
