const supabase = require('../config/supabase');
const { resolverEscopoOperacional } = require('../services/operationalScopeService');
const { canAccessUnit } = require('../services/operationalScopeDomainService');

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

async function audit(action, payload) {
  await supabase.from('operational_scope_auditoria').insert({
    action,
    empresa_id: payload.empresa_id || null,
    grupo_id: payload.grupo_id || null,
    unidade_operacional_id: payload.unidade_operacional_id || null,
    membership_id: payload.membership_id || null,
    actor_user_id: payload.actor_user_id || null,
    before_snapshot: payload.before_snapshot || null,
    after_snapshot: payload.after_snapshot || null,
    reason: payload.reason || null,
    request_id: payload.request_id || null,
  });
}

async function ensureCanManage(req, empresaId) {
  if (isSuper(req)) return { ok: true, scope: await resolverEscopoOperacional(req, { empresaId }) };
  if (empresaId !== req.empresa_id) return { ok: false, status: 403, message: 'Empresa fora do seu escopo.' };
  const scope = await resolverEscopoOperacional(req, { empresaId });
  if (!scope.can_manage_operational_structure) {
    return { ok: false, status: 403, message: 'Voce nao pode administrar escopos operacionais.' };
  }
  return { ok: true, scope };
}

exports.getContexto = async (req, res) => {
  try {
    const scope = await resolverEscopoOperacional(req);
    const unidades = scope.empresa_id
      ? await supabase
        .from('unidades_operacionais')
        .select('id, empresa_id, grupo_id, nome, codigo, tipo, cidade, uf, timezone, status, is_default')
        .eq('empresa_id', scope.empresa_id)
        .order('is_default', { ascending: false })
        .order('nome', { ascending: true })
      : { data: [], error: null };
    if (unidades.error) throw unidades.error;
    return res.json({
      scope,
      unidades: (unidades.data || []).filter((u) => scope.mode === 'SUPER_ADMIN' || canAccessUnit(scope, u.id)),
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
    const { data, error } = await supabase
      .from('grupos_empresariais')
      .insert({ nome, created_by: actorId(req), updated_by: actorId(req) })
      .select()
      .single();
    if (error) throw error;
    await audit('grupo_criado', { grupo_id: data.id, actor_user_id: actorId(req), after_snapshot: data, reason: req.body?.reason });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarGrupo]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao criar grupo empresarial.' });
  }
};

exports.vincularEmpresaGrupo = async (req, res) => {
  try {
    if (!isSuper(req)) return res.status(403).json({ message: 'Acesso restrito ao super-admin.' });
    const grupoId = req.params.id;
    const empresaId = sanitizeText(req.body?.empresa_id);
    if (!empresaId) return res.status(400).json({ message: 'Informe a empresa.' });
    const { data, error } = await supabase
      .from('grupo_empresarial_empresas')
      .upsert({
        grupo_id: grupoId,
        empresa_id: empresaId,
        status: 'ativo',
        created_by: actorId(req),
        updated_by: actorId(req),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'grupo_id,empresa_id' })
      .select()
      .single();
    if (error) throw error;
    await audit('grupo_empresa_vinculada', {
      grupo_id: grupoId,
      empresa_id: empresaId,
      actor_user_id: actorId(req),
      after_snapshot: data,
      reason: req.body?.reason,
    });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[operacional:vincularEmpresaGrupo]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao vincular empresa ao grupo.' });
  }
};

exports.listarUnidades = async (req, res) => {
  try {
    const empresaId = req.query.empresa_id || req.empresa_id;
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const { data, error } = await supabase
      .from('unidades_operacionais')
      .select('id, empresa_id, grupo_id, nome, codigo, tipo, documento, cidade, uf, timezone, status, is_default, created_at, updated_at')
      .eq('empresa_id', empresaId)
      .order('is_default', { ascending: false })
      .order('nome', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[operacional:listarUnidades]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao listar unidades.' });
  }
};

exports.criarUnidade = async (req, res) => {
  try {
    const empresaId = req.body?.empresa_id || req.query.empresa_id || req.empresa_id;
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const nome = sanitizeText(req.body?.nome);
    if (!nome) return res.status(400).json({ message: 'Informe o nome da unidade.' });

    const { count, error: countError } = await supabase
      .from('unidades_operacionais')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('status', 'ativo');
    if (countError) throw countError;
    const primeiraUnidade = (count || 0) === 0;
    const isDefault = primeiraUnidade ? true : req.body?.is_default === true;

    if (isDefault && !primeiraUnidade) {
      await supabase
        .from('unidades_operacionais')
        .update({ is_default: false, updated_by: actorId(req), updated_at: new Date().toISOString() })
        .eq('empresa_id', empresaId)
        .eq('is_default', true);
    }

    const payload = {
      empresa_id: empresaId,
      grupo_id: req.body?.grupo_id || null,
      nome,
      codigo: sanitizeText(req.body?.codigo),
      tipo: sanitizeText(req.body?.tipo) || 'operacional',
      documento: sanitizeText(req.body?.documento),
      cidade: sanitizeText(req.body?.cidade),
      uf: sanitizeText(req.body?.uf),
      timezone: sanitizeText(req.body?.timezone) || 'America/Sao_Paulo',
      is_default: isDefault,
      created_by: actorId(req),
      updated_by: actorId(req),
    };
    const { data, error } = await supabase
      .from('unidades_operacionais')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    if (primeiraUnidade && !isSuper(req)) {
      const { error: membershipError } = await supabase.from('usuario_operacional_memberships').insert({
        usuario_id: actorId(req),
        empresa_id: empresaId,
        grupo_id: data.grupo_id || null,
        scope_level: 'GLOBAL',
        papel: 'admin',
        status: 'ativo',
        is_primary: true,
        created_by: actorId(req),
        updated_by: actorId(req),
        updated_at: new Date().toISOString(),
      });
      if (membershipError && membershipError.code !== '23505') throw membershipError;
    }

    await audit('unidade_criada', {
      empresa_id: empresaId,
      grupo_id: data.grupo_id,
      unidade_operacional_id: data.id,
      actor_user_id: actorId(req),
      after_snapshot: data,
      reason: req.body?.reason,
    });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarUnidade]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao criar unidade operacional.' });
  }
};

exports.listarRegioes = async (req, res) => {
  try {
    const empresaId = req.query.empresa_id || req.empresa_id;
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
    const empresaId = req.body?.empresa_id || req.query.empresa_id || req.empresa_id;
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const nome = sanitizeText(req.body?.nome);
    if (!nome) return res.status(400).json({ message: 'Informe o nome da regiao.' });
    const { data, error } = await supabase
      .from('regioes_operacionais')
      .insert({
        empresa_id: empresaId,
        grupo_id: req.body?.grupo_id || null,
        nome,
        codigo: sanitizeText(req.body?.codigo),
        created_by: actorId(req),
        updated_by: actorId(req),
      })
      .select()
      .single();
    if (error) throw error;
    await audit('regiao_criada', { empresa_id: empresaId, grupo_id: data.grupo_id, actor_user_id: actorId(req), after_snapshot: data });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarRegiao]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao criar regiao operacional.' });
  }
};

exports.definirUnidadesRegiao = async (req, res) => {
  try {
    const regiaoId = req.params.id;
    const { data: regiao, error: regiaoError } = await supabase
      .from('regioes_operacionais')
      .select('id, empresa_id, grupo_id')
      .eq('id', regiaoId)
      .maybeSingle();
    if (regiaoError) throw regiaoError;
    if (!regiao) return res.status(404).json({ message: 'Regiao nao encontrada.' });
    const check = await ensureCanManage(req, regiao.empresa_id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const ids = Array.isArray(req.body?.unidades) ? req.body.unidades.map(String) : [];
    const { data: unidades, error: unidadesError } = await supabase
      .from('unidades_operacionais')
      .select('id')
      .eq('empresa_id', regiao.empresa_id)
      .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    if (unidadesError) throw unidadesError;
    if ((unidades || []).length !== ids.length) {
      return res.status(422).json({ message: 'Uma ou mais unidades nao pertencem a empresa.' });
    }

    await supabase
      .from('regiao_operacional_unidades')
      .update({ status: 'arquivado' })
      .eq('regiao_id', regiaoId)
      .eq('status', 'ativo');
    if (ids.length) {
      const linhas = ids.map((id) => ({
        empresa_id: regiao.empresa_id,
        regiao_id: regiaoId,
        unidade_operacional_id: id,
        status: 'ativo',
        created_by: actorId(req),
      }));
      const { error } = await supabase
        .from('regiao_operacional_unidades')
        .upsert(linhas, { onConflict: 'regiao_id,unidade_operacional_id' });
      if (error) throw error;
    }
    await audit('regiao_unidade_alterada', {
      empresa_id: regiao.empresa_id,
      grupo_id: regiao.grupo_id,
      actor_user_id: actorId(req),
      after_snapshot: { regiao_id: regiaoId, unidades: ids },
      reason: req.body?.reason,
    });
    return res.json({ ok: true, unidades: ids });
  } catch (error) {
    console.error('[operacional:definirUnidadesRegiao]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao atualizar unidades da regiao.' });
  }
};

exports.listarMemberships = async (req, res) => {
  try {
    const empresaId = req.query.empresa_id || req.empresa_id;
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

exports.criarMembership = async (req, res) => {
  try {
    const empresaId = req.body?.empresa_id || req.query.empresa_id || req.empresa_id;
    const check = await ensureCanManage(req, empresaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const scope = check.scope;
    const usuarioId = sanitizeText(req.body?.usuario_id);
    const scopeLevel = sanitizeText(req.body?.scope_level)?.toUpperCase();
    if (!usuarioId || !['LOCAL', 'REGIONAL', 'GLOBAL'].includes(scopeLevel)) {
      return res.status(400).json({ message: 'Informe usuario e escopo validos.' });
    }
    if (!isSuper(req) && scopeLevel === 'GLOBAL' && scope.mode !== 'GLOBAL' && scope.mode !== 'LEGACY_COMPANY') {
      return res.status(403).json({ message: 'Voce nao pode conceder escopo global.' });
    }
    const unidadeId = req.body?.unidade_operacional_id || null;
    const regiaoId = req.body?.regiao_operacional_id || null;
    if (scopeLevel === 'LOCAL' && !unidadeId) {
      return res.status(400).json({ message: 'Informe a unidade do escopo local.' });
    }
    if (scopeLevel === 'REGIONAL' && !regiaoId) {
      return res.status(400).json({ message: 'Informe a regiao do escopo regional.' });
    }
    if (!isSuper(req) && unidadeId && !canAccessUnit(scope, unidadeId)) {
      return res.status(403).json({ message: 'Unidade fora do seu escopo.' });
    }
    if (scopeLevel === 'REGIONAL') {
      const { data: regiao, error: regiaoError } = await supabase
        .from('regioes_operacionais')
        .select('id')
        .eq('id', regiaoId)
        .eq('empresa_id', empresaId)
        .maybeSingle();
      if (regiaoError) throw regiaoError;
      if (!regiao) return res.status(422).json({ message: 'Regiao fora da empresa.' });
    }
    const payload = {
      usuario_id: usuarioId,
      empresa_id: empresaId,
      grupo_id: req.body?.grupo_id || null,
      unidade_operacional_id: scopeLevel === 'LOCAL' ? unidadeId : null,
      regiao_operacional_id: scopeLevel === 'REGIONAL' ? regiaoId : null,
      scope_level: scopeLevel,
      papel: sanitizeText(req.body?.papel) || 'operador',
      status: 'ativo',
      is_primary: req.body?.is_primary === true,
      motivo: sanitizeText(req.body?.motivo),
      created_by: actorId(req),
      updated_by: actorId(req),
    };
    const { data, error } = await supabase
      .from('usuario_operacional_memberships')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    await audit('membership_criado', {
      empresa_id: empresaId,
      grupo_id: data.grupo_id,
      unidade_operacional_id: data.unidade_operacional_id,
      membership_id: data.id,
      actor_user_id: actorId(req),
      after_snapshot: data,
      reason: req.body?.reason || req.body?.motivo,
    });
    return res.status(201).json(data);
  } catch (error) {
    console.error('[operacional:criarMembership]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao criar membership.' });
  }
};

exports.revogarMembership = async (req, res) => {
  try {
    const { data: atual, error: atualError } = await supabase
      .from('usuario_operacional_memberships')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (atualError) throw atualError;
    if (!atual) return res.status(404).json({ message: 'Membership nao encontrado.' });
    const check = await ensureCanManage(req, atual.empresa_id);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const { data, error } = await supabase
      .from('usuario_operacional_memberships')
      .update({
        status: 'revogado',
        motivo: sanitizeText(req.body?.motivo),
        updated_by: actorId(req),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    await audit('membership_revogado', {
      empresa_id: atual.empresa_id,
      grupo_id: atual.grupo_id,
      unidade_operacional_id: atual.unidade_operacional_id,
      membership_id: atual.id,
      actor_user_id: actorId(req),
      before_snapshot: atual,
      after_snapshot: data,
      reason: req.body?.reason || req.body?.motivo,
    });
    return res.json(data);
  } catch (error) {
    console.error('[operacional:revogarMembership]', error?.message || error);
    return res.status(500).json({ message: 'Erro ao revogar membership.' });
  }
};
