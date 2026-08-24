const supabase = require('../config/supabase');
const notificacaoService = require('../services/notificacaoService');
const { calcularComissao } = require('../utils/comissao');
const { normalizarModalidade, calcularValorToneladaKm } = require('../utils/calculoFrete');
const { validarLimitesFrete } = require('../utils/limitesFrete');
const { createFreight, FreightCreationError } = require('../services/freights/freightCreationService');
const {
  prepararCorrecaoFinanceira,
  contemCampoFinanceiro,
} = require('../services/freteFinanceiroCorrecaoService');
const { revogarTrackingSeSemViagemAtiva } = require('../services/auth/trackingRevocacaoHook');
const { publicarStatusFrete } = require('../services/campaign/freightRealtimeSignal');
const {
  resolverEscopoOperacional,
  aplicarEscopoOperacionalQuery,
  escopoTemSelecaoInvalida,
  canAccessUnit,
  deriveUnitForWrite,
} = require('../services/operationalScopeService');

const BUCKET_ODOMETRO = 'fretes-odometro';
const SIGNED_URL_TTL_SECONDS = 300;
const EXTENSAO_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const acessoPermitidoAoFrete = (req, frete) => {
  if (req.user.is_super_admin === true) return true;
  if (req.user.role === 'admin') {
    if (frete.empresa_id !== req.empresa_id) return false;
    if (req.operationalScope) return canAccessUnit(req.operationalScope, frete.unidade_operacional_id || null);
    return true;
  }
  return frete.motorista_id === req.user.uid;
};

const campoPathOdometro = (tipo) => tipo === 'inicial'
  ? 'foto_odometro_inicial_path'
  : tipo === 'final'
    ? 'foto_odometro_final_path'
    : null;

const criarSignedUrlOdometro = async (path) => {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET_ODOMETRO)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data?.signedUrl || data?.signedURL || null;
};

const uploadOdometro = async (req, res, tipo) => {
  const campoPath = campoPathOdometro(tipo);
  if (!campoPath) return res.status(400).json({ message: 'Tipo de foto de odômetro inválido.' });
  if (!req.file) return res.status(400).json({ message: 'Foto do odômetro não enviada.' });

  try {
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, unidade_operacional_id, status, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', req.params.id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });
    if (!acessoPermitidoAoFrete(req, frete)) return res.status(403).json({ message: 'Acesso negado.' });
    if (frete.status === 'finalizado' || frete.status === 'cancelado') {
      return res.status(409).json({ message: 'Não é possível alterar fotos de um frete finalizado ou cancelado.' });
    }

    const extensao = EXTENSAO_POR_MIME[req.file.mimetype];
    if (!extensao) return res.status(400).json({ message: 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.' });

    const pathPrivado = `${frete.empresa_id}/fretes/${frete.id}/odometro-${tipo}.${extensao}`;
    const pathAnterior = frete[campoPath] || null;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_ODOMETRO)
      .upload(pathPrivado, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
    if (uploadError) {
      console.error('[fretesController:uploadOdometro] Falha no upload privado', {
        frete_id: frete.id,
        empresa_id: frete.empresa_id,
        tipo,
        mimetype: req.file.mimetype,
        size: req.file.size,
        erro: uploadError.message || String(uploadError),
      });
      return res.status(502).json({ message: 'Erro ao salvar foto do odômetro.' });
    }

    const updatePayload = { [campoPath]: pathPrivado };
    if (tipo === 'inicial' && frete.status === 'pendente') updatePayload.status = 'ativo';
    const { data: atualizado, error: updateError } = await supabase
      .from('fretes')
      .update(updatePayload)
      .eq('id', frete.id)
      .select()
      .single();
    if (updateError) {
      await supabase.storage.from(BUCKET_ODOMETRO).remove([pathPrivado]).catch(() => {});
      throw updateError;
    }

    if (pathAnterior && pathAnterior !== pathPrivado) {
      supabase.storage.from(BUCKET_ODOMETRO).remove([pathAnterior]).catch(() => {});
    }

    return res.status(200).json({
      path: pathPrivado,
      status: atualizado.status,
    });
  } catch (error) {
    console.error('[fretesController:uploadOdometro] Erro inesperado:', error?.message || error);
    return res.status(500).json({ message: 'Erro ao enviar foto do odômetro.' });
  }
};

// Helper para validar status do motorista
const checkMotoristaStatus = async (uid) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('status')
    .eq('id', uid)
    .single();
  
  if (error || !data) return false;
  return data.status === 'ativo';
};

// Mensagem única da trava de pendências (reuso nas duas travas)
const MSG_PENDENCIAS = 'Não é possível finalizar: há lançamentos pendentes desta viagem. Aprove ou rejeite todos antes de finalizar.';

const mensagemFinalizacaoLimite = (limite) => (
  `Não foi possível finalizar a viagem. ${limite?.message || 'Revise os dados do frete antes de continuar.'}`
);

// Datas simples representam o último dia incluído pelo cliente. Converte esse
// dia no limite exclusivo seguinte; datetimes já expressam o limite desejado.
const respostaLimiteFrete = (limite, message = limite?.message) => ({
  error: 'frete_operational_limit',
  field: limite?.campo,
  current_value: limite?.valorAtual,
  max_value: limite?.limiteValor,
  limit: limite?.limite,
  message: message || 'Valor fora dos limites operacionais. Confira os dados do frete.',
});

const respostaErroCorrecaoFinanceira = (erro, frete) => {
  if (erro?.error === 'frete_operational_limit') return respostaLimiteFrete({
    campo: erro.field,
    valorAtual: erro.current_value,
    limiteValor: erro.max_value,
    limite: erro.limit,
    message: erro.message,
  });

  const field = erro?.field || (erro?.error?.includes('status') ? 'status' : undefined);
  return {
    error: erro?.error || 'frete_financial_correction_invalid',
    field,
    current_value: field === 'status' ? frete?.status : undefined,
    message: erro?.message || 'Correcao financeira invalida.',
  };
};

const erroRpcCorrecaoFinanceira = (error) => {
  const msg = error?.message || '';
  if (msg.includes('frete_financial_correction_concurrent_change')) return 'frete_financial_correction_concurrent_change';
  if (msg.includes('frete_financial_correction_status_locked')) return 'frete_financial_correction_status_locked';
  if (msg.includes('frete_financial_correction_status_unknown')) return 'frete_financial_correction_status_unknown';
  if (msg.includes('frete_financial_correction_not_found')) return 'frete_financial_correction_not_found';
  if (msg.includes('frete_financial_correction_reason_required')) return 'frete_financial_correction_reason_required';
  if (msg.includes('frete_financial_correction_request_id_required')) return 'frete_financial_correction_request_id_required';
  if (msg.includes('frete_financial_correction_request_id_conflict')) return 'frete_financial_correction_request_id_conflict';
  if (msg.includes('frete_financial_correction_source_not_allowed')) return 'frete_financial_correction_source_not_allowed';
  if (msg.includes('frete_financial_correction_type_not_allowed')) return 'frete_financial_correction_type_not_allowed';
  if (msg.includes('frete_financial_correction_expected_snapshot_required')) return 'frete_financial_correction_expected_snapshot_required';
  if (msg.includes('frete_financial_correction_empty')) return 'frete_financial_correction_empty';
  if (msg.includes('frete_financial_correction_field_not_allowed')) return 'frete_financial_correction_field_not_allowed';
  if (msg.includes('frete_operational_limit')) return 'frete_operational_limit';
  return null;
};

const resolverActorUserIdAuditoria = async (uid) => {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
};

const normalizarDataFimExclusiva = (dataFim) => {
  if (typeof dataFim !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) return dataFim;

  const [ano, mes, dia] = dataFim.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dataValida = data.getUTCFullYear() === ano
    && data.getUTCMonth() === mes - 1
    && data.getUTCDate() === dia;

  if (!dataValida) return dataFim;

  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
};

// Retorna true se o FRETE tem algum lançamento pendente (despesa/abast/vale).
// Escopo por frete_id: bloqueia só a viagem atual, não outras viagens do motorista.
const freteTemPendencias = async (freteId) => {
  for (const tabela of ['despesas', 'abastecimentos', 'vales']) {
    const { count, error } = await supabase
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('frete_id', freteId)
      .eq('status', 'pendente');
    if (error) throw error;
    if ((count || 0) > 0) return true;
  }
  return false;
};

// Retorna true se o motorista pertence a uma empresa do tipo 'autonomo'.
// Fonte confiável: motoristas.empresa_id → empresas.tipo. NUNCA detecta por nome.
// Retorna null quando o lookup falha (indeterminado), para o chamador aplicar fallback leniente.
const isMotoristaAutonomo = async (motoristaId) => {
  const { data: mot, error: motErr } = await supabase
    .from('motoristas')
    .select('empresa_id')
    .eq('id', motoristaId)
    .single();
  if (motErr || !mot) return null;
  const { data: emp, error: empErr } = await supabase
    .from('empresas')
    .select('tipo')
    .eq('id', mot.empresa_id)
    .single();
  if (empErr || !emp) return null;
  return emp.tipo === 'autonomo';
};

exports.getAll = async (req, res) => {
  const { data_inicio, data_fim, status, motorista_id } = req.query;
  const isAdmin = req.user.role === 'admin';

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const empresaAlvo = isSuperAdmin
      ? (req.query.empresa_id || null)
      : req.empresa_id;
    const operationalScope = isAdmin
      ? await resolverEscopoOperacional(req, { empresaId: empresaAlvo })
      : null;
    if (isAdmin && operationalScope.mode === 'NO_ACCESS') {
      return res.status(403).json({ message: 'Escopo operacional nao autorizado.' });
    }
    if (isAdmin && escopoTemSelecaoInvalida(operationalScope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.' });
    }

    let idsPermitidos = null;

    if (!isAdmin) {
      idsPermitidos = [req.user.uid];
    } else {
      const empresasPermitidas = operationalScope?.authorized_empresa_ids || [];
      const { data: uids, error: uidsError } = await supabase
        .from('usuarios')
        .select('id')
        .in('empresa_id', empresasPermitidas.length ? empresasPermitidas : [empresaAlvo || '00000000-0000-0000-0000-000000000000'])
        .eq('tipo', 'motorista');

      if (uidsError) throw uidsError;
      idsPermitidos = uids.map(u => u.id);
    }

    let query = supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome))');

    if (isAdmin) {
      query = aplicarEscopoOperacionalQuery(query, operationalScope);
    }

    if (idsPermitidos !== null) {
      query = query.in('motorista_id', idsPermitidos.length ? idsPermitidos : ['']);
    }

    if (isAdmin && motorista_id) {
      query = query.eq('motorista_id', motorista_id);
    }

    if (data_inicio) query = query.gte('data', data_inicio);
    if (data_fim) query = query.lt('data', normalizarDataFimExclusiva(data_fim));
    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('data', { ascending: false });
    if (error) throw error;

    // P2 — redação financeira para motorista (visibility policy). Admin/super: sem redação.
    let payload = data;
    if (!isAdmin && req.user?.is_super_admin !== true && Array.isArray(data) && data.length) {
      const { loadEffectivePermissions } = require('../services/permissions/permissionResolver');
      const { redactFretesForDriver } = require('../services/permissions/driverFinancialRedaction');
      const eff = await loadEffectivePermissions(supabase, {
        uid: req.user.uid, tipo: 'motorista', empresa_id: req.empresa_id, empresa_tipo: req.user.empresa_tipo,
      });
      const { data: mot } = await supabase.from('motoristas').select('percentual_comissao').eq('id', req.user.uid).maybeSingle();
      payload = redactFretesForDriver(data, eff.driverFinancialVisibility, mot?.percentual_comissao ?? null);
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error('Erro ao listar fretes:', error);
    res.status(500).json({ message: 'Erro ao listar fretes.' });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await createFreight(supabase, {
      user: req.user,
      body: req.body,
      resolveOperationalUnit: async ({ motorista }) => {
        if (req.user.role !== 'admin') return motorista.unidade_operacional_id || null;
        const scope = await resolverEscopoOperacional(req, { empresaId: motorista.empresa_id });
        if (escopoTemSelecaoInvalida(scope)) {
          throw new FreightCreationError('Unidade operacional selecionada fora do seu escopo.', {
            status: 403,
            code: 'operational_unit_selection_invalid',
          });
        }
        const unitDecision = deriveUnitForWrite({
          scope,
          requestedUnitId: req.body.unidade_operacional_id,
          motoristaUnitId: motorista.unidade_operacional_id,
        });
        if (!unitDecision.ok) {
          throw new FreightCreationError('Unidade operacional nao autorizada para este frete.', {
            status: 403,
            code: unitDecision.reason,
            details: { error: unitDecision.reason, message: 'Unidade operacional nao autorizada para este frete.' },
          });
        }
        return unitDecision.unidade_operacional_id;
      },
    });

    const { data, comissao } = result;
    notificacaoService.notificarFreteCriado(data, { actorId: req.user?.uid })
      .catch((e) => console.warn('[fretesController:create] notificarFreteCriado falhou:', e?.message || e));
    res.status(201).json({ ...data, comissao_calculada: comissao });
  } catch (error) {
    if (error instanceof FreightCreationError) {
      if (error.details?.error === 'frete_operational_limit') return res.status(error.status).json(error.details);
      if (error.details?.message) return res.status(error.status).json(error.details);
      return res.status(error.status).json({ message: error.message });
    }
    console.error(error);
    // Violação de restrição do banco (NOT NULL / CHECK) → 400 com mensagem em
    // português, em vez do genérico "Erro ao criar frete." que escondia a causa.
    // Não expõe detalhe interno do Postgres ao cliente.
    if (error?.code === '23502' || error?.code === '23514') {
      return res.status(400).json({
        message: 'Não foi possível salvar o frete. Verifique os campos: no tonelada/km informe toneladas, valor por tonelada/km e KM inicial; no valor fixo informe o valor do frete.'
      });
    }
    res.status(500).json({ message: 'Erro ao criar frete.' });
  }
};

exports.getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('fretes')
      .select('*, motoristas(usuarios(nome))')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    // Isolamento por tenant: super-admin acessa tudo; admin só a própria
    // empresa; motorista só os próprios fretes.
    const isSuperAdmin = req.user.is_super_admin === true;
    if (!isSuperAdmin) {
      if (req.user.role === 'admin') {
        req.operationalScope = await resolverEscopoOperacional(req, { empresaId: data.empresa_id });
        if (data.empresa_id !== req.empresa_id || !canAccessUnit(req.operationalScope, data.unidade_operacional_id || null)) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (data.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    const payload = await redigirFreteParaMotoristaSeAplicavel(req, data);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar frete.' });
  }
};

// P2 — VISIBILITY POLICY: se o solicitante é motorista, redige os campos
// financeiros do frete conforme driver_financial_visibility_mode (segurança de
// dados no backend, não só no app). Admin/super-admin recebem sem redação.
async function redigirFreteParaMotoristaSeAplicavel(req, frete) {
  try {
    if (!frete) return frete;
    if (req.user?.is_super_admin === true || req.user?.role === 'admin') return frete;
    const { loadEffectivePermissions } = require('../services/permissions/permissionResolver');
    const { redactFreteForDriver } = require('../services/permissions/driverFinancialRedaction');
    const eff = await loadEffectivePermissions(supabase, {
      uid: req.user.uid, tipo: 'motorista', empresa_id: frete.empresa_id, empresa_tipo: req.user.empresa_tipo,
    });
    const { data: mot } = await supabase.from('motoristas').select('percentual_comissao').eq('id', req.user.uid).maybeSingle();
    return redactFreteForDriver(frete, eff.driverFinancialVisibility, mot?.percentual_comissao ?? null);
  } catch (_) {
    // fail-closed conservador: na dúvida, redige como commission_only.
    try {
      const { redactFreteForDriver } = require('../services/permissions/driverFinancialRedaction');
      return redactFreteForDriver(frete, 'commission_only', null);
    } catch { return frete; }
  }
}

exports.uploadOdometroInicial = (req, res) => uploadOdometro(req, res, 'inicial');
exports.uploadOdometroFinal = (req, res) => uploadOdometro(req, res, 'final');

exports.getOdometroSignedUrl = async (req, res) => {
  const campoPath = campoPathOdometro(req.params.tipo);
  if (!campoPath) return res.status(400).json({ message: 'Tipo de foto de odômetro inválido.' });

  try {
    const { data: frete, error } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, unidade_operacional_id, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', req.params.id)
      .single();
    if (error || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });
    if (!acessoPermitidoAoFrete(req, frete)) return res.status(403).json({ message: 'Acesso negado.' });

    const pathPrivado = frete[campoPath];
    if (!pathPrivado) return res.status(404).json({ message: 'Foto do odômetro não enviada.' });
    const signedUrl = await criarSignedUrlOdometro(pathPrivado);
    return res.status(200).json({ signed_url: signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    console.error('[fretesController:getOdometroSignedUrl] Erro:', error?.message || error);
    return res.status(500).json({ message: 'Erro ao gerar acesso temporário à foto.' });
  }
};

exports.corrigirFinanceiro = async (req, res) => {
  const { id } = req.params;

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && !isSuperAdmin) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, unidade_operacional_id, status, modalidade_calculo, toneladas, valor_tonelada_km, valor_frete, km_inicial, km_final')
      .eq('id', id)
      .single();

    if (freteError || !frete) {
      return res.status(404).json({ message: 'Frete nao encontrado.' });
    }
    if (!isSuperAdmin) {
      req.operationalScope = await resolverEscopoOperacional(req, { empresaId: frete.empresa_id });
    }
    if (!isSuperAdmin && (frete.empresa_id !== req.empresa_id || !canAccessUnit(req.operationalScope, frete.unidade_operacional_id || null))) {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const preparo = prepararCorrecaoFinanceira({
      freteAtual: frete,
      campos: req.body.fields,
    });
    if (!preparo.ok) {
      return res.status(422).json(respostaErroCorrecaoFinanceira(preparo, frete));
    }

    const actorUserId = await resolverActorUserIdAuditoria(req.user.uid);
    const { data, error } = await supabase.rpc('corrigir_frete_financeiro_legacy', {
      p_frete_id: id,
      p_empresa_id: frete.empresa_id,
      p_actor_user_id: actorUserId,
      p_actor_auth_uid: req.user.uid || null,
      p_reason: req.body.reason,
      p_source: 'painel_admin',
      p_request_id: req.body.request_id,
      p_correction_type: 'manual_legacy_financial_correction',
      p_expected_before_snapshot: preparo.before_snapshot,
      p_patch: preparo.patch,
    });

    if (error) {
      const codigo = erroRpcCorrecaoFinanceira(error);
      if (codigo === 'frete_financial_correction_not_found') {
        return res.status(404).json({ error: codigo, message: 'Frete nao encontrado.' });
      }
      if (codigo === 'frete_financial_correction_concurrent_change') {
        return res.status(409).json({
          error: codigo,
          message: 'Este frete foi alterado por outra operacao. Atualize os dados e tente novamente.',
        });
      }
      if (codigo) {
        return res.status(422).json({
          error: codigo,
          message: codigo === 'frete_operational_limit'
            ? 'Valor fora dos limites operacionais. Confira os dados do frete.'
            : 'Correcao financeira invalida.',
        });
      }
      throw error;
    }

    return res.status(200).json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error('Erro ao corrigir financeiro do frete:', error);
    return res.status(500).json({ message: 'Erro ao corrigir dados financeiros do frete.' });
  }
};

exports.update = async (req, res) => {
  const { id } = req.params;

  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';

    const { data: checkData, error: checkError } = await supabase
      .from('fretes')
      .select('motorista_id, empresa_id, unidade_operacional_id, status, modalidade_calculo, toneladas, valor_tonelada_km, km_inicial, km_final, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', id)
      .single();

    if (checkError || !checkData) {
      return res.status(404).json({ message: 'Frete não encontrado.' });
    }

    // Ownership por perfil (espelha exports.finalizar):
    //  - super-admin: sempre pode
    //  - admin de empresa: só fretes da própria empresa (isolamento multi-tenant)
    //  - motorista: só o próprio frete
    if (!isSuperAdmin) {
      if (isAdmin) {
        req.operationalScope = await resolverEscopoOperacional(req, { empresaId: checkData.empresa_id });
        if (checkData.empresa_id !== req.empresa_id || !canAccessUnit(req.operationalScope, checkData.unidade_operacional_id || null)) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (checkData.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    if (contemCampoFinanceiro(req.body || {})) {
      return res.status(422).json({
        error: 'frete_financial_correction_endpoint_required',
        message: 'Use a correcao financeira auditada para alterar modalidade, valores, toneladas ou KM do frete.',
      });
    }

    // Extrair APENAS campos permitidos (previne mass assignment)
    // data com alias (dataFrete) para não colidir com o const { data } do Supabase abaixo
    const { origem, destino, km_inicial, km_final, valor_frete, status, quem_recebeu, data: dataFrete, modalidade_calculo, toneladas, valor_tonelada_km } = req.body;
    const allowedUpdate = {};
    if (origem !== undefined) allowedUpdate.origem = origem;
    if (destino !== undefined) allowedUpdate.destino = destino;
    if (km_inicial !== undefined) allowedUpdate.km_inicial = Number(km_inicial);
    if (km_final !== undefined) allowedUpdate.km_final = Number(km_final);
    if (valor_frete !== undefined) allowedUpdate.valor_frete = parseFloat(valor_frete);
    if (status !== undefined) allowedUpdate.status = status;
    if (quem_recebeu !== undefined) allowedUpdate.quem_recebeu = quem_recebeu;
    if (dataFrete !== undefined) allowedUpdate.data = dataFrete;
    if (modalidade_calculo !== undefined) allowedUpdate.modalidade_calculo = modalidade_calculo;
    if (toneladas !== undefined) allowedUpdate.toneladas = Number(toneladas);
    if (valor_tonelada_km !== undefined) allowedUpdate.valor_tonelada_km = Number(valor_tonelada_km);

    if (Object.keys(allowedUpdate).length === 0) {
      return res.status(400).json({ message: 'Nenhum campo válido para atualizar.' });
    }

    // Cálculo por modalidade (merge do que veio no body sobre o já gravado):
    //  - tonelada_km: valor_frete é SEMPRE derivado; ignora valor manual. Se ainda
    //    não dá para calcular (ex.: falta km_final), não deixa passar valor
    //    inconsistente — remove valor_frete do update, preservando o valor atual.
    //  - voltar para valor_fixo: limpa os campos de tonelada para não deixar resíduo.
    const modalidadeEfetiva = allowedUpdate.modalidade_calculo ?? checkData.modalidade_calculo ?? 'valor_fixo';
    if (modalidadeEfetiva === 'tonelada_km') {
      const calc = calcularValorToneladaKm({
        toneladas: allowedUpdate.toneladas ?? checkData.toneladas,
        valorToneladaKm: allowedUpdate.valor_tonelada_km ?? checkData.valor_tonelada_km,
        kmInicial: allowedUpdate.km_inicial ?? checkData.km_inicial,
        kmFinal: allowedUpdate.km_final ?? checkData.km_final,
      });
      if (calc !== null) {
        allowedUpdate.valor_frete = calc;
      } else {
        delete allowedUpdate.valor_frete;
      }
    } else if (allowedUpdate.modalidade_calculo === 'valor_fixo') {
      allowedUpdate.toneladas = null;
      allowedUpdate.valor_tonelada_km = null;
    }

    // Defense-in-depth: autônomo SEMPRE recebe via 'motorista'. Força o valor independentemente
    // do body (espelha a trava do frontend). Vinculado preserva o valor enviado. Lookup pelo tipo
    // real da empresa (motoristas → empresas.tipo), nunca por nome; falha → fallback leniente + log.
    if (allowedUpdate.quem_recebeu !== undefined) {
      const autonomo = await isMotoristaAutonomo(checkData.motorista_id);
      if (autonomo === true) {
        allowedUpdate.quem_recebeu = 'motorista';
      } else if (autonomo === null) {
        console.warn('[fretesController:update] lookup tipo empresa falhou; mantendo quem_recebeu do body (fallback leniente).');
      }
    }

    // Trava de finalização: bloqueia se o motorista tiver lançamentos pendentes (vale p/ todos)
    if (allowedUpdate.status === 'finalizado' && await freteTemPendencias(id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
    }
    if (allowedUpdate.status === 'ativo' && checkData.status === 'pendente' && !checkData.foto_odometro_inicial_path) {
      return res.status(422).json({ message: 'Envie a foto do odômetro inicial para ativar o frete.' });
    }
    // Novo fluxo de odômetro: espelha exports.finalizar TAMBÉM neste PATCH, para que
    // uma finalização via update (status → 'finalizado') não contorne a trava de foto
    // (defense-in-depth: a regra vale no backend, não só no painel). Fonte de verdade =
    // foto_odometro_inicial_path. Fretes legados (sem foto inicial) seguem finalizáveis.
    if (allowedUpdate.status === 'finalizado') {
      if (checkData.status === 'pendente' && !checkData.foto_odometro_inicial_path) {
        return res.status(422).json({ message: 'Envie a foto do odômetro inicial para ativar o frete.' });
      }
      if (checkData.foto_odometro_inicial_path && !checkData.foto_odometro_final_path) {
        return res.status(422).json({ message: 'Envie a foto do odômetro final para concluir o frete.' });
      }
    }

    // Trava de sanidade operacional (espelha o create): valida os valores EFETIVOS
    // após o merge (o que veio no body sobre o já gravado) antes de persistir.
    // Reprova → 422, sem update.
    const limite = validarLimitesFrete({
      modalidade: modalidadeEfetiva,
      valorFrete: 'valor_frete' in allowedUpdate ? allowedUpdate.valor_frete : undefined,
      toneladas: allowedUpdate.toneladas ?? checkData.toneladas,
      valorToneladaKm: allowedUpdate.valor_tonelada_km ?? checkData.valor_tonelada_km,
      kmInicial: allowedUpdate.km_inicial ?? checkData.km_inicial,
      kmFinal: allowedUpdate.km_final ?? checkData.km_final,
    });
    if (!limite.ok) return res.status(422).json(respostaLimiteFrete(limite));

    const { data, error } = await supabase
      .from('fretes')
      .update(allowedUpdate)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao atualizar frete:', error);
    res.status(500).json({ message: 'Erro ao atualizar frete.' });
  }
};

exports.finalizar = async (req, res) => {
  const { id } = req.params;
  const isSuperAdmin = req.user.is_super_admin === true;
  const isAdmin = req.user.role === 'admin';

  try {
    // Busca o frete e verifica ownership
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, unidade_operacional_id, status, km_inicial, km_final, modalidade_calculo, toneladas, valor_tonelada_km, foto_odometro_inicial_path, foto_odometro_final_path')
      .eq('id', id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });

    // super-admin: sempre pode
    if (!isSuperAdmin) {
      // admin empresa: verifica se o frete é da empresa
      if (isAdmin) {
        req.operationalScope = await resolverEscopoOperacional(req, { empresaId: frete.empresa_id });
        if (frete.empresa_id !== req.empresa_id || !canAccessUnit(req.operationalScope, frete.unidade_operacional_id || null)) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else {
        // motorista: verifica ownership + permissão
        if (frete.motorista_id !== req.user.uid) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }

        // P2 — freight.finish agora resolvido pelo modelo V9 (templates+overrides),
        // com dual-read do legado (pode_finalizar_viagem) e bypass do autônomo
        // preservados no resolver → EFFECTIVE_BEFORE = EFFECTIVE_AFTER.
        const { data: motData } = await supabase
          .from('motoristas')
          .select('empresas(tipo)')
          .eq('id', req.user.uid)
          .single();
        const { loadEffectivePermissions, hasPermission } = require('../services/permissions/permissionResolver');
        const effFinish = await loadEffectivePermissions(supabase, {
          uid: req.user.uid, tipo: 'motorista',
          empresa_id: frete.empresa_id, empresa_tipo: motData?.empresas?.tipo ?? null,
        });
        if (!hasPermission(effFinish, 'freight.finish')) {
          return res.status(403).json({
            message: 'Sua empresa não autorizou a finalização de viagens pelo app. Contate o administrador.'
          });
        }
      }
    }

    if (frete.status === 'finalizado') {
      return res.status(400).json({ message: 'Esta viagem já está finalizada.' });
    }
    if (frete.status === 'pendente' && !frete.foto_odometro_inicial_path) {
      return res.status(422).json({ message: 'Envie a foto do odômetro inicial para ativar o frete.' });
    }

    // Trava de finalização: bloqueia se a viagem tiver lançamentos pendentes (vale p/ todos, inclusive super-admin)
    if (await freteTemPendencias(frete.id)) {
      return res.status(409).json({ message: MSG_PENDENCIAS });
    }

    // Compatibilidade: a obrigação vale para o novo fluxo, identificado pela
    // foto inicial. Fretes antigos sem path continuam finalizáveis.
    if (frete.foto_odometro_inicial_path && !frete.foto_odometro_final_path) {
      return res.status(422).json({ message: 'Envie a foto do odômetro final para concluir o frete.' });
    }

    // Série 1.5 (KM na finalização): o app NOVO envia km_inicial/km_final no corpo;
    // quando vierem, validamos (positivos, km_final > km_inicial) e persistimos junto da
    // finalização. App/cliente ANTIGO não manda KM → finaliza como antes (compatibilidade;
    // a trava obrigatória rígida fica para um PR posterior, após o APK novo validado).
    const updatePayload = { status: 'finalizado' };
    const { km_inicial: kmIniBody, km_final: kmFinBody } = req.body || {};
    const temKmIni = kmIniBody !== undefined && kmIniBody !== null && kmIniBody !== '';
    const temKmFin = kmFinBody !== undefined && kmFinBody !== null && kmFinBody !== '';

    if (frete.foto_odometro_inicial_path && !temKmFin
      && (frete.km_final === null || frete.km_final === undefined || frete.km_final === '')) {
      return res.status(422).json({ message: 'Informe o KM final para finalizar o frete.' });
    }

    if (temKmFin) {
      const kmFinal = Number(kmFinBody);
      if (!Number.isFinite(kmFinal) || kmFinal <= 0) {
        return res.status(422).json({ message: 'KM final inválido.' });
      }
      // KM inicial efetivo: o enviado agora (se houver) ou o já gravado no frete.
      let kmInicialEfetivo = frete.km_inicial;
      if (temKmIni) {
        const kmIni = Number(kmIniBody);
        if (!Number.isFinite(kmIni) || kmIni <= 0) {
          return res.status(422).json({ message: 'KM inicial inválido.' });
        }
        kmInicialEfetivo = kmIni;
        updatePayload.km_inicial = kmIni;
      }
      if (kmInicialEfetivo === null || kmInicialEfetivo === undefined) {
        return res.status(422).json({ message: 'Informe o KM inicial para finalizar.' });
      }
      if (kmFinal <= Number(kmInicialEfetivo)) {
        return res.status(422).json({ message: 'KM final deve ser maior que o KM inicial.' });
      }
      updatePayload.km_final = kmFinal;
    } else if (temKmIni) {
      // KM inicial enviado isolado (sem km_final): valida e salva, mas não finaliza com média.
      const kmIni = Number(kmIniBody);
      if (!Number.isFinite(kmIni) || kmIni <= 0) {
        return res.status(422).json({ message: 'KM inicial inválido.' });
      }
      updatePayload.km_inicial = kmIni;
    }

    // Frete por tonelada/km: NÃO pode ser finalizado sem KM final — senão ficaria
    // "finalizado" com valor 0 provisório e distância ausente (bug corrigido aqui).
    // O km_final efetivo é o enviado nesta finalização (updatePayload.km_final) ou o
    // já gravado no frete. Regras (retorna 422 e NÃO altera status quando falham):
    //  - km_final obrigatório;
    //  - km_inicial obrigatório (sem ele não há distância);
    //  - km_final > km_inicial (calcularValorToneladaKm devolve null caso contrário).
    // Só quando tudo é válido calculamos o valor definitivo e prosseguimos com a
    // finalização = toneladas * (km_final - km_inicial) * valor_tonelada_km.
    if (frete.modalidade_calculo === 'tonelada_km') {
      const kmFinalEfetivo = updatePayload.km_final ?? frete.km_final;
      const kmInicialEfetivo = updatePayload.km_inicial ?? frete.km_inicial;
      if (kmFinalEfetivo === null || kmFinalEfetivo === undefined || kmFinalEfetivo === '') {
        return res.status(422).json({ message: 'Informe o KM final para finalizar um frete por tonelada/km.' });
      }
      if (kmInicialEfetivo === null || kmInicialEfetivo === undefined || kmInicialEfetivo === '') {
        return res.status(422).json({ message: 'Informe o KM inicial para finalizar um frete por tonelada/km.' });
      }
      const calc = calcularValorToneladaKm({
        toneladas: frete.toneladas,
        valorToneladaKm: frete.valor_tonelada_km,
        kmInicial: kmInicialEfetivo,
        kmFinal: kmFinalEfetivo,
      });
      if (calc === null) {
        return res.status(422).json({ message: 'O KM final deve ser maior que o KM inicial.' });
      }
      // Trava de sanidade operacional: o valor derivado na finalização também respeita
      // os tetos (toneladas, valor por tonelada/km e valor final). Reprova → 422, sem
      // finalizar (impede que um frete legado com insumos absurdos vire valor final).
      const limite = validarLimitesFrete({
        modalidade: 'tonelada_km',
        valorFrete: calc,
        toneladas: frete.toneladas,
        valorToneladaKm: frete.valor_tonelada_km,
        kmInicial: kmInicialEfetivo,
        kmFinal: kmFinalEfetivo,
      });
      if (!limite.ok) return res.status(422).json(respostaLimiteFrete(limite, mensagemFinalizacaoLimite(limite)));
      updatePayload.valor_frete = calc;
    }

    const { data, error } = await supabase
      .from('fretes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    notificacaoService.notificarViagemFinalizada(data, { actorId: req.user?.uid }).catch(() => {});
    // SEC-1: fim de viagem → se o motorista não tem mais viagem ativa, revoga suas
    // credenciais de tracking (best-effort; a validação já rejeita canonicamente).
    revogarTrackingSeSemViagemAtiva({ empresaId: frete.empresa_id, motoristaId: frete.motorista_id, motivo: 'viagem_finalizada' });
    // Sinal realtime para refresh direcionado (Torre/Campaign). Best-effort.
    publicarStatusFrete(data);
    res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao finalizar frete:', error);
    res.status(500).json({ message: 'Erro ao finalizar viagem.' });
  }
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  try {
    const isSuperAdmin = req.user.is_super_admin === true;
    const isAdmin = req.user.role === 'admin';

    // Cancelar = marcar status 'cancelado' (nunca delete físico). Antes, verifica ownership
    // por perfil (espelha exports.finalizar):
    //  - super-admin: sempre pode
    //  - admin de empresa: só fretes da própria empresa (isolamento multi-tenant)
    //  - motorista: só o próprio frete
    const { data: frete, error: freteError } = await supabase
      .from('fretes')
      .select('id, motorista_id, empresa_id, unidade_operacional_id')
      .eq('id', id)
      .single();

    if (freteError || !frete) return res.status(404).json({ message: 'Frete não encontrado.' });

    if (!isSuperAdmin) {
      if (isAdmin) {
        req.operationalScope = await resolverEscopoOperacional(req, { empresaId: frete.empresa_id });
        if (frete.empresa_id !== req.empresa_id || !canAccessUnit(req.operationalScope, frete.unidade_operacional_id || null)) {
          return res.status(403).json({ message: 'Acesso negado.' });
        }
      } else if (frete.motorista_id !== req.user.uid) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
    }

    const { error } = await supabase
      .from('fretes')
      .update({ status: 'cancelado' })
      .eq('id', id);

    if (error) throw error;
    // SEC-1: cancelamento de viagem → revoga se o motorista não tem mais viagem ativa.
    revogarTrackingSeSemViagemAtiva({ empresaId: frete.empresa_id, motoristaId: frete.motorista_id, motivo: 'viagem_cancelada' });
    // Sinal realtime para refresh direcionado (Torre/Campaign). Best-effort.
    publicarStatusFrete({ id, empresa_id: frete.empresa_id, status: 'cancelado' });
    res.status(200).json({ message: 'Frete cancelado com sucesso.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cancelar frete.' });
  }
};
