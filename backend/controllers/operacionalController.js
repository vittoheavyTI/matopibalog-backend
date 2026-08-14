const supabase = require('../config/supabase');
const {
  resolverEscopoOperacional,
  canAccessUnit,
  canDelegateScope,
  escopoTemSelecaoInvalida,
} = require('../services/operationalScopeService');

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

function actorId(req) {
  return req.user?.uid || null;
}

function isSuper(req) {
  return req.user?.is_super_admin === true;
}

function sanitizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function targetEmpresaId(req) {
  return isSuper(req)
    ? (req.body?.empresa_id || req.query?.empresa_id || req.empresa_id || null)
    : req.empresa_id;
}

function rpcErrorResponse(res, error, fallback) {
  const msg = String(error?.message || error || '');
  if (msg.includes('not_found')) return res.status(404).json({ message: 'Registro nao encontrado.' });
  if (msg.includes('cross_company') || msg.includes('outside') || msg.includes('archived')) return res.status(422).json({ message: msg });
  if (msg.includes('admins_without_operational_membership')) return res.status(409).json({ message: msg });
  if (msg.includes('cannot_archive_only_default_unit')) return res.status(409).json({ message: 'Nao e possivel arquivar a unica unidade default ativa.' });
  return res.status(500).json({ message: fallback });
}

async function callRpc(name, payload) {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) throw error;
  return data;
}

async function ensureCanManage(req, empresaId, { requireCompanyAdmin = false } = {}) {
  if (!empresaId) return { ok: false, status: 400, message: 'Informe a empresa.' };
  if (!isSuper(req) && empresaId !== req.empresa_id) {
    return { ok: false, status: 403, message: 'Empresa fora do seu escopo.' };
  }
  const scope = await resolverEscopoOperacional(req, { empresaId });
  if (escopoTemSelecaoInvalida(scope)) {
    return { ok: false, status: 403, message: 'Unidade operacional selecionada fora do seu escopo.' };
  }
  if (isSuper(req)) return { ok: true, scope };
  if (!scope.can_manage_operational_structure) {
    return { ok: false, status: 403, message: 'Voce nao pode administrar escopos operacionais.' };
  }
  if (requireCompanyAdmin && !scope.can_enforce_operational_scope && scope.rollout_mode === 'enforced') {
    return { ok: false, status: 403, message: 'Acao restrita ao administrador global da empresa.' };
  }
  return { ok: true, scope };
}

async function fetchRegiao(regiaoId) {
  const query = supabase
    .from('regioes_operacionais')
    .select('id, empresa_id, grupo_id, status')
    .eq('id', regiaoId);
  const { data, error } = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single();
  if (error) throw error;
  return data || null;
}

async function fetchUnidade(unidadeId) {
  const query = supabase
    .from('unidades_operacionais')
    .select('id, empresa_id, grupo_id, status, is_default')
    .eq('id', unidadeId);
  const { data, error } = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single();
  if (error) throw error;
  return data || null;
}

async function fetchMembership(id) {
  const query = supabase
    .from('usuario_operacional_memberships')
    .select('*')
    .eq('id', id);
  const { data, error } = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single();
  if (error) throw error;
  return data || null;
}

async function loadRegionUnits(regiaoId) {
  if (!regiaoId) return [];
  const { data, error } = await supabase
    .from('regiao_operacional_unidades')
    .select('regiao_id, regiao_operacional_id:regiao_id, empresa_id, unidade_operacional_id, status')
    .eq('regiao_id', regiaoId);
  if (error) throw error;
  return data || [];
}

exports.getContexto = async (req, res) => {
  try {
    const scope = await resolverEscopoOperacional(req);
    if (escopoTemSelecaoInvalida(scope)) {
      return res.status(403).json({ message: 'Unidade operacional selecionada fora do seu escopo.', scope });
    }
    const empresaIds = scope.authorized_empresa_ids || [];
    const unidades = empresaIds.length
      ? await supabase
        .from('unidades_operacionais')
        .select('id, empresa_id, grupo_id, nome, codigo, tipo, cidade, uf, timezone, status, is_default')
        .in('empresa_id', empresaIds)
        .order('is_default', { ascending: false })
        .order('nome', { ascending: true })
      : { data: [], error: null };
    if (unidades.error) throw unidades.error;
    return res.json({
      scope,
      unidades: (unidades.data || []).filter((u) => isSuper(req) || canAccessUnit(scope, u.id)),
    });
  } catch (error) {
    console.error('[operacional:getContexto]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao carregar contexto operacional.' });
  }
};

exports.listarGrupos = async (req, res) => {
  try {
    if (!isSuper(req)) return res.status(403).json({ message: 'Acesso restrito ao super-admin.' });
    const { data, error } = await supabase
      .from('grupos_empresariais')
      .select('id, nome, status, created_at, updated_at')
      .order('nome', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[operacional:listarGrupos]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao listar grupos empresariais.' });
  }
};

exports.criarGrupo = async (req, res) => {
  try {
    if (!isSuper(req)) return res.status(403).json({ message: 'Acesso restrito ao super-admin.' });
    const nome = sanitizeText(req.body?.nome);
    if (!nome) return res.status(400).json({ message: 'Informe o nome do grupo.' });
    const data = await callRpc('p1_criar_grupo', {
      p_nome: nome,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarGrupo]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao criar grupo empresarial.');
  }
};

exports.atualizarGrupo = async (req, res) => {
  try {
    if (!isSuper(req)) return res.status(403).json({ message: 'Acesso restrito ao super-admin.' });
    const status = sanitizeText(req.body?.status);
    if (status && !['ativo', 'arquivado'].includes(status)) return res.status(400).json({ message: 'Status invalido.' });
    const data = await callRpc('p1_atualizar_grupo', {
      p_grupo_id: req.params.id,
      p_nome: sanitizeText(req.body?.nome),
      p_status: status,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:atualizarGrupo]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao atualizar grupo empresarial.');
  }
};

exports.vincularEmpresaGrupo = async (req, res) => {
  try {
    if (!isSuper(req)) return res.status(403).json({ message: 'Acesso restrito ao super-admin.' });
    const empresaId = sanitizeText(req.body?.empresa_id);
    const status = sanitizeText(req.body?.status) || 'ativo';
    if (!empresaId) return res.status(400).json({ message: 'Informe a empresa.' });
    if (!['ativo', 'arquivado'].includes(status)) return res.status(400).json({ message: 'Status invalido.' });
    const data = await callRpc('p1_vincular_empresa_grupo', {
      p_grupo_id: req.params.id,
      p_empresa_id: empresaId,
      p_status: status,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[operacional:vincularEmpresaGrupo]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao vincular empresa ao grupo.');
  }
};

exports.listarUnidades = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const { data, error } = await supabase
      .from('unidades_operacionais')
      .select('id, empresa_id, grupo_id, nome, codigo, tipo, documento, cidade, uf, timezone, status, is_default, created_at, updated_at')
      .eq('empresa_id', empresaId)
      .order('is_default', { ascending: false })
      .order('nome', { ascending: true });
    if (error) throw error;
    return res.json((data || []).filter((u) => isSuper(req) || canAccessUnit(check.scope, u.id)));
  } catch (error) {
    console.error('[operacional:listarUnidades]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao listar unidades.' });
  }
};

exports.criarUnidade = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const check = await ensureCanManage(req, empresaId, { requireCompanyAdmin: true });
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const nome = sanitizeText(req.body?.nome);
    if (!nome) return res.status(400).json({ message: 'Informe o nome da unidade.' });
    const data = await callRpc('p1_criar_unidade', {
      p_empresa_id: empresaId,
      p_grupo_id: req.body?.grupo_id || null,
      p_nome: nome,
      p_codigo: sanitizeText(req.body?.codigo),
      p_tipo: sanitizeText(req.body?.tipo) || 'operacional',
      p_documento: sanitizeText(req.body?.documento),
      p_cidade: sanitizeText(req.body?.cidade),
      p_uf: sanitizeText(req.body?.uf),
      p_timezone: sanitizeText(req.body?.timezone) || 'America/Sao_Paulo',
      p_is_default: req.body?.is_default === true,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarUnidade]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao criar unidade operacional.');
  }
};

exports.atualizarUnidade = async (req, res) => {
  try {
    const unidade = await fetchUnidade(req.params.id);
    if (!unidade) return res.status(404).json({ message: 'Unidade nao encontrada.' });
    const check = await ensureCanManage(req, unidade.empresa_id, { requireCompanyAdmin: req.body?.is_default === true });
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    if (!isSuper(req) && !canAccessUnit(check.scope, unidade.id)) return res.status(403).json({ message: 'Unidade fora do seu escopo.' });
    const status = sanitizeText(req.body?.status);
    if (status && !['ativo', 'arquivado'].includes(status)) return res.status(400).json({ message: 'Status invalido.' });
    const data = await callRpc('p1_atualizar_unidade', {
      p_unidade_id: unidade.id,
      p_nome: sanitizeText(req.body?.nome),
      p_codigo: sanitizeText(req.body?.codigo),
      p_tipo: sanitizeText(req.body?.tipo),
      p_status: status,
      p_is_default: req.body?.is_default === true ? true : null,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:atualizarUnidade]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao atualizar unidade operacional.');
  }
};

exports.listarRegioes = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const { data, error } = await supabase
      .from('regioes_operacionais')
      .select('id, empresa_id, grupo_id, nome, codigo, status, created_at, updated_at')
      .eq('empresa_id', empresaId)
      .order('nome', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[operacional:listarRegioes]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao listar regioes.' });
  }
};

exports.criarRegiao = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const nome = sanitizeText(req.body?.nome);
    if (!nome) return res.status(400).json({ message: 'Informe o nome da regiao.' });
    const data = await callRpc('p1_criar_regiao', {
      p_empresa_id: empresaId,
      p_grupo_id: req.body?.grupo_id || null,
      p_nome: nome,
      p_codigo: sanitizeText(req.body?.codigo),
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarRegiao]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao criar regiao operacional.');
  }
};

exports.atualizarRegiao = async (req, res) => {
  try {
    const regiao = await fetchRegiao(req.params.id);
    if (!regiao) return res.status(404).json({ message: 'Regiao nao encontrada.' });
    const check = await ensureCanManage(req, regiao.empresa_id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const status = sanitizeText(req.body?.status);
    if (status && !['ativo', 'arquivado'].includes(status)) return res.status(400).json({ message: 'Status invalido.' });
    const data = await callRpc('p1_atualizar_regiao', {
      p_regiao_id: regiao.id,
      p_nome: sanitizeText(req.body?.nome),
      p_codigo: sanitizeText(req.body?.codigo),
      p_status: status,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:atualizarRegiao]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao atualizar regiao operacional.');
  }
};

exports.definirUnidadesRegiao = async (req, res) => {
  try {
    const regiao = await fetchRegiao(req.params.id);
    if (!regiao) return res.status(404).json({ message: 'Regiao nao encontrada.' });
    const check = await ensureCanManage(req, regiao.empresa_id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const ids = Array.isArray(req.body?.unidades) ? req.body.unidades.map(String) : [];
    if (!isSuper(req) && !ids.every((id) => canAccessUnit(check.scope, id))) {
      return res.status(403).json({ message: 'Uma ou mais unidades estao fora do seu escopo delegavel.' });
    }
    const data = await callRpc('p1_definir_unidades_regiao', {
      p_regiao_id: regiao.id,
      p_unidade_ids: ids,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:definirUnidadesRegiao]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao atualizar unidades da regiao.');
  }
};

exports.listarMemberships = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    let query = supabase
      .from('usuario_operacional_memberships')
      .select('id, usuario_id, empresa_id, grupo_id, unidade_operacional_id, regiao_operacional_id, scope_level, papel, status, is_primary, created_at, updated_at')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });
    if (req.query.usuario_id) query = query.eq('usuario_id', req.query.usuario_id);
    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[operacional:listarMemberships]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao listar memberships.' });
  }
};

async function validateDelegation(req, empresaId, payload, currentMembershipId = null) {
  const check = await ensureCanManage(req, empresaId);
  if (!check.ok) return check;
  if (!isSuper(req) && payload.usuario_id === actorId(req) && currentMembershipId == null) {
    return { ok: false, status: 403, message: 'Autoelevacao de escopo nao permitida.' };
  }
  let regionRows = [];
  if (payload.scope_level === 'REGIONAL') regionRows = await loadRegionUnits(payload.regiao_operacional_id);
  const decision = canDelegateScope(check.scope, payload, regionRows);
  if (!decision.ok) return { ok: false, status: 403, message: decision.reason };
  return { ok: true, scope: check.scope };
}

exports.criarMembership = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const usuarioId = sanitizeText(req.body?.usuario_id);
    const scopeLevel = sanitizeText(req.body?.scope_level)?.toUpperCase();
    if (!usuarioId || !['LOCAL', 'REGIONAL', 'GLOBAL'].includes(scopeLevel)) {
      return res.status(400).json({ message: 'Informe usuario e escopo validos.' });
    }
    const payload = {
      usuario_id: usuarioId,
      scope_level: scopeLevel,
      unidade_operacional_id: scopeLevel === 'LOCAL' ? req.body?.unidade_operacional_id || null : null,
      regiao_operacional_id: scopeLevel === 'REGIONAL' ? req.body?.regiao_operacional_id || null : null,
    };
    if (scopeLevel === 'LOCAL' && !payload.unidade_operacional_id) return res.status(400).json({ message: 'Informe a unidade do escopo local.' });
    if (scopeLevel === 'REGIONAL' && !payload.regiao_operacional_id) return res.status(400).json({ message: 'Informe a regiao do escopo regional.' });
    const check = await validateDelegation(req, empresaId, payload);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const data = await callRpc('p1_criar_membership', {
      p_usuario_id: usuarioId,
      p_empresa_id: empresaId,
      p_grupo_id: null,
      p_scope_level: scopeLevel,
      p_unidade_id: payload.unidade_operacional_id,
      p_regiao_id: payload.regiao_operacional_id,
      p_papel: sanitizeText(req.body?.papel) || 'operador',
      p_is_primary: req.body?.is_primary === true,
      p_actor_user_id: actorId(req),
      p_motivo: req.body?.motivo || req.body?.reason || null,
    });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarMembership]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao criar membership.');
  }
};

exports.atualizarMembership = async (req, res) => {
  try {
    const atual = await fetchMembership(req.params.id);
    if (!atual) return res.status(404).json({ message: 'Membership nao encontrado.' });
    if (!isSuper(req) && atual.usuario_id === actorId(req)) return res.status(403).json({ message: 'Autoelevacao de escopo nao permitida.' });
    const scopeLevel = sanitizeText(req.body?.scope_level)?.toUpperCase() || atual.scope_level;
    const payload = {
      usuario_id: atual.usuario_id,
      scope_level: scopeLevel,
      unidade_operacional_id: scopeLevel === 'LOCAL' ? req.body?.unidade_operacional_id || atual.unidade_operacional_id : null,
      regiao_operacional_id: scopeLevel === 'REGIONAL' ? req.body?.regiao_operacional_id || atual.regiao_operacional_id : null,
    };
    const check = await validateDelegation(req, atual.empresa_id, payload, atual.id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const status = sanitizeText(req.body?.status);
    if (status && !['ativo', 'revogado', 'arquivado'].includes(status)) return res.status(400).json({ message: 'Status invalido.' });
    const data = await callRpc('p1_atualizar_membership', {
      p_membership_id: atual.id,
      p_scope_level: scopeLevel,
      p_unidade_id: payload.unidade_operacional_id,
      p_regiao_id: payload.regiao_operacional_id,
      p_papel: sanitizeText(req.body?.papel),
      p_status: status,
      p_actor_user_id: actorId(req),
      p_motivo: req.body?.motivo || req.body?.reason || null,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:atualizarMembership]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao atualizar membership.');
  }
};

exports.revogarMembership = async (req, res) => {
  try {
    const atual = await fetchMembership(req.params.id);
    if (!atual) return res.status(404).json({ message: 'Membership nao encontrado.' });
    if (!isSuper(req) && atual.usuario_id === actorId(req)) return res.status(403).json({ message: 'Voce nao pode revogar o proprio escopo.' });
    const check = await ensureCanManage(req, atual.empresa_id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const data = await callRpc('p1_atualizar_membership', {
      p_membership_id: atual.id,
      p_scope_level: atual.scope_level,
      p_unidade_id: atual.unidade_operacional_id,
      p_regiao_id: atual.regiao_operacional_id,
      p_papel: atual.papel,
      p_status: 'revogado',
      p_actor_user_id: actorId(req),
      p_motivo: req.body?.motivo || req.body?.reason || 'Revogado pelo painel operacional.',
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:revogarMembership]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao revogar membership.');
  }
};

exports.ativarEnforcement = async (req, res) => {
  try {
    const empresaId = targetEmpresaId(req);
    const check = await ensureCanManage(req, empresaId, { requireCompanyAdmin: true });
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    if (!isSuper(req) && !check.scope.can_enforce_operational_scope) {
      return res.status(403).json({ message: 'Ativacao restrita ao administrador global da empresa.' });
    }
    const data = await callRpc('p1_ativar_enforcement', {
      p_empresa_id: empresaId,
      p_actor_user_id: actorId(req),
      p_reason: req.body?.reason || null,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:ativarEnforcement]', error?.message || error);
    return rpcErrorResponse(res, error, 'Erro ao ativar enforcement operacional.');
  }
};
