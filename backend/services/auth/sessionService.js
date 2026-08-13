// backend/services/auth/sessionService.js — serviço de sessões (SEC-1).
//
// INDEPENDENTE de Express e de transporte. Recebe supabase (service_role) + cfg
// validada + auditor injetados. Orquestra crypto + RPCs 062 + erros de domínio.
// O refresh ABERTO só sai dentro de um RefreshDelivery (não serializável/logável),
// entregue ao ADAPTER de transporte — nunca em objetos genéricos/logs.

const util = require('util');
const crypto = require('./authCrypto');
const E = require('./authErrors');

// Envelope do refresh aberto: valor NÃO-enumerável; toJSON/inspect redigem.
class RefreshDelivery {
  constructor(token, expiresAt) {
    Object.defineProperty(this, '_token', { value: token, enumerable: false, writable: false });
    this.expiresAt = expiresAt;
  }
  reveal() { return this._token; }            // o adapter chama para setar cookie/body móvel
  toJSON() { return { refresh: '[REDACTED]', expiresAt: this.expiresAt }; }
  toString() { return '[RefreshDelivery REDACTED]'; }
  [util.inspect.custom]() { return '[RefreshDelivery REDACTED]'; }
}

function segundosDepois(n) { return new Date(Date.now() + n * 1000); }
function menorDataIso(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return new Date(Math.min(ta, tb)).toISOString();
}

const STATUS_USUARIO_AUTENTICAVEL = new Set(['ativo']);

/**
 * Factory. deps: { supabase (service_role), cfg (authConfig validada), auditar(evento) }.
 * `auditar` é opcional (login/logout auditados fora da RPC); rotação/reuse já são
 * auditados atomicamente pela RPC 062.
 */
function criarSessionService({ supabase, cfg, auditar = async () => {} }) {
  if (!supabase) throw new Error('supabase obrigatório');
  if (!cfg) throw new Error('cfg obrigatório');

  function assinarAccessDaSessao({ session_id, usuario_id, role, is_super_admin }) {
    return crypto.assinarAccessToken({ uid: usuario_id, sid: session_id, role: role ?? null, isSuperAdmin: !!is_super_admin }, cfg);
  }

  /**
   * Cria sessão + 1º refresh (atômico via RPC). Retorna { accessToken, refreshDelivery,
   * session }. `role/is_super_admin` vêm do login (autoridade do banco), só para
   * assinar o access; a validação por request re-consulta o banco.
   */
  async function criarSessao({ usuario_id, empresa_id = null, client_type, device_id = null, device_label = null, role = null, is_super_admin = false, ip_hash = null, user_agent = null, created_by = null }) {
    const pepper = cfg.getPepper();
    if (!pepper) throw new E.SessionDependencyUnavailable('pepper ausente (sessões habilitadas sem pepper)');
    const refreshToken = crypto.gerarRefreshToken();
    const refreshHash = crypto.hashRefreshToken(refreshToken, pepper);
    const familyId = crypto.gerarJti();
    const absoluteExpires = segundosDepois(cfg.refreshAbsoluteTtlSeconds);
    const idleExpiresIso = menorDataIso(segundosDepois(cfg.refreshIdleTtlSeconds), absoluteExpires);
    // O refresh expira junto com o teto absoluto; o idle é aplicado na sessão.
    const refreshExpires = absoluteExpires;

    const { data, error } = await supabase.rpc('criar_sessao_auth', {
      p_usuario_id: usuario_id, p_empresa_id: empresa_id, p_client_type: client_type,
      p_device_id: device_id, p_device_label: device_label, p_refresh_family_id: familyId,
      p_refresh_token_hash: refreshHash, p_refresh_expires_at: refreshExpires.toISOString(),
      p_idle_expires_at: idleExpiresIso, p_absolute_expires_at: absoluteExpires.toISOString(),
      p_ip_hash: ip_hash, p_user_agent: user_agent, p_created_by: created_by,
    });
    if (error) throw new E.SessionDependencyUnavailable(error.message || 'erro ao criar sessão');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.session_id) throw new E.SessionDependencyUnavailable('RPC não retornou sessão');

    const accessToken = assinarAccessDaSessao({ session_id: row.session_id, usuario_id, role, is_super_admin });
    return {
      accessToken,
      refreshDelivery: new RefreshDelivery(refreshToken, absoluteExpires.toISOString()),
      session: { id: row.session_id, family_id: row.refresh_family_id },
    };
  }

  /**
   * Rotaciona o refresh apresentado. Mapeia o resultado estruturado da RPC:
   *   ok → { accessToken, refreshDelivery }; demais → lança erro de domínio.
   */
  async function rotacionarRefresh({ refreshToken, request_id = null, origin = null }) {
    const pepper = cfg.getPepper();
    if (!pepper) throw new E.SessionDependencyUnavailable('pepper ausente');
    const apresentadoHash = crypto.hashRefreshToken(refreshToken, pepper);
    const novoToken = crypto.gerarRefreshToken();
    const novoHash = crypto.hashRefreshToken(novoToken, pepper);
    const absoluteExpires = segundosDepois(cfg.refreshAbsoluteTtlSeconds);
    const novoIdle = segundosDepois(cfg.refreshIdleTtlSeconds);

    let data, error;
    try {
      ({ data, error } = await supabase.rpc('rotacionar_refresh_token', {
        p_apresentado_hash: apresentadoHash, p_novo_token_hash: novoHash,
        p_novo_expires_at: absoluteExpires.toISOString(), p_novo_idle_expires_at: novoIdle.toISOString(),
        p_request_id: request_id, p_origin: origin, p_grace_seconds: cfg.refreshReuseGraceSeconds,
      }));
    } catch (e) {
      throw new E.SessionDependencyUnavailable(e.message || 'erro de infraestrutura na rotação');
    }
    if (error) throw new E.SessionDependencyUnavailable(error.message || 'erro na rotação');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new E.SessionDependencyUnavailable('RPC de rotação não retornou linha');

    const erro = E.erroDeResultadoRotacao(row.resultado, `rotacao ${row.resultado}`);
    if (erro) throw erro;

    const expiresAtEfetivo = row.novo_expires_at || absoluteExpires.toISOString();
    const accessToken = assinarAccessDaSessao({ session_id: row.session_id, usuario_id: row.usuario_id, role: row.role, is_super_admin: row.is_super_admin });
    return {
      accessToken,
      refreshDelivery: new RefreshDelivery(novoToken, expiresAtEfetivo),
      session: { id: row.session_id },
    };
  }

  /**
   * Valida a sessão de um ACCESS token (para o middleware). Fail-CLOSED: qualquer
   * indisponibilidade de infraestrutura → SessionDependencyUnavailable (503), nunca
   * fallback legado nem "válido". Atualiza atividade com throttle (server-side).
   * Retorna dados atuais do banco (fonte de autoridade), NÃO os claims do token.
   */
  async function validarSessaoParaAcesso({ sid, uid }) {
    if (!sid) throw new E.SessionInvalid('sid ausente');
    let sess, erroSess;
    try {
      ({ data: sess, error: erroSess } = await supabase
        .from('auth_sessions')
        .select('id, usuario_id, empresa_id, client_type, revoked_at, idle_expires_at, absolute_expires_at, last_activity_at')
        .eq('id', sid).maybeSingle());
    } catch (e) {
      throw new E.SessionDependencyUnavailable(e.message);
    }
    if (erroSess) throw new E.SessionDependencyUnavailable(erroSess.message);
    if (!sess) throw new E.SessionNotFound(`sid ${sid}`);
    if (uid && String(sess.usuario_id) !== String(uid)) throw new E.SessionInvalid('uid do token difere da sessão');
    const agora = Date.now();
    if (sess.revoked_at) throw new E.SessionRevoked();
    if (new Date(sess.idle_expires_at).getTime() <= agora) throw new E.SessionIdleExpired();
    if (new Date(sess.absolute_expires_at).getTime() <= agora) throw new E.SessionAbsoluteExpired();

    // Usuário ATUAL do banco (autoridade de papel/tenant), não os claims do token.
    let user, erroUser;
    try {
      ({ data: user, error: erroUser } = await supabase
        .from('usuarios')
        .select('id, tipo, status, is_super_admin, empresa_id')
        .eq('id', sess.usuario_id).maybeSingle());
    } catch (e) {
      throw new E.SessionDependencyUnavailable(e.message);
    }
    if (erroUser) throw new E.SessionDependencyUnavailable(erroUser.message);
    if (!user) throw new E.SessionInvalid('usuário da sessão inexistente');
    if (!STATUS_USUARIO_AUTENTICAVEL.has(String(user.status || '').toLowerCase())) {
      throw new E.SessionRevoked(`usuario_status_${user.status || 'ausente'}`);
    }

    await atualizarAtividadeThrottled(sess).catch(() => {}); // best-effort; não bloqueia

    return {
      uid: user.id,
      sid: sess.id,
      role: user.tipo,
      is_super_admin: user.is_super_admin === true,
      empresa_id: user.empresa_id,        // autoridade do banco (tenant.js segue no legado)
      client_type: sess.client_type,
    };
  }

  /** Atualiza last_activity só se passou do throttle; desliza idle; nunca prorroga absoluto. */
  async function atualizarAtividadeThrottled(sess) {
    const throttle = cfg.sessionActivityThrottleSeconds;
    const ultima = new Date(sess.last_activity_at).getTime();
    if (Date.now() - ultima < throttle * 1000) return { atualizado: false };
    const agoraIso = new Date().toISOString();
    const novoIdleIso = menorDataIso(segundosDepois(cfg.refreshIdleTtlSeconds), sess.absolute_expires_at);
    // Update condicional atômico: só vence uma escrita concorrente; não reativa
    // sessão revogada/expirada (WHERE revoked_at IS NULL e last_activity antiga).
    const corteIso = new Date(Date.now() - throttle * 1000).toISOString();
    const { data } = await supabase
      .from('auth_sessions')
      .update({ last_activity_at: agoraIso, idle_expires_at: novoIdleIso, updated_at: agoraIso })
      .eq('id', sess.id).is('revoked_at', null).lt('last_activity_at', corteIso)
      .select('id');
    return { atualizado: Array.isArray(data) && data.length > 0 };
  }

  async function revogarSessao(sid, motivo = 'logout') {
    const { data, error } = await supabase.rpc('revogar_sessao_auth', {
      p_session_id: sid,
      p_motivo: motivo,
      p_actor_usuario_id: null,
      p_request_id: null,
      p_origin: null,
    });
    if (error) throw new E.SessionDependencyUnavailable(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, revogou: !!(row && row.revogada) };
  }

  async function revogarTodasDoUsuario(uid, motivo = 'logout_global') {
    const { data, error } = await supabase.rpc('revogar_sessoes_usuario', {
      p_usuario_id: uid,
      p_motivo: motivo,
      p_actor_usuario_id: uid,
      p_request_id: null,
      p_origin: null,
    });
    if (error) throw new E.SessionDependencyUnavailable(error.message);
    return { ok: true, revogadas: Number(data || 0) };
  }

  /** Revoga UMA sessão do PRÓPRIO usuário (impede tenant/usuário alheio). */
  async function revogarUmaDoUsuario(uid, sid, motivo = 'revogacao_usuario') {
    const { data: existente, error: erroBusca } = await supabase.from('auth_sessions')
      .select('id, usuario_id, revoked_at').eq('id', sid).maybeSingle();
    if (erroBusca) throw new E.SessionDependencyUnavailable(erroBusca.message);
    if (!existente) return { ok: false, revogou: false, motivo: 'not_found' };
    if (String(existente.usuario_id) !== String(uid)) throw new E.SessionForbidden('sessao de outro usuario');
    if (existente.revoked_at) return { ok: true, revogou: false, motivo: 'already_revoked' };

    const { data, error } = await supabase.rpc('revogar_sessao_auth', {
      p_session_id: sid,
      p_motivo: motivo,
      p_actor_usuario_id: uid,
      p_request_id: null,
      p_origin: null,
    });
    if (error) throw new E.SessionDependencyUnavailable(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, revogou: !!(row && row.revogada) };
  }

  async function listarSessoesDoUsuario(uid) {
    const { data, error } = await supabase.from('auth_sessions')
      .select('id, client_type, device_label, created_at, last_activity_at, idle_expires_at, absolute_expires_at, revoked_at')
      .eq('usuario_id', uid).order('last_activity_at', { ascending: false });
    if (error) throw new E.SessionDependencyUnavailable(error.message);
    // Sanitizado: nunca token/hash/ip_hash completo. (ip_hash já é mascarado; ainda assim omitido.)
    return (data || []).map((s) => ({
      id: s.id, client_type: s.client_type, device_label: s.device_label,
      created_at: s.created_at, last_activity_at: s.last_activity_at,
      expira_em: s.idle_expires_at, revogada: !!s.revoked_at,
    }));
  }

  return {
    criarSessao, rotacionarRefresh, validarSessaoParaAcesso, atualizarAtividadeThrottled,
    revogarSessao, revogarTodasDoUsuario, revogarUmaDoUsuario, listarSessoesDoUsuario,
    RefreshDelivery,
  };
}

module.exports = { criarSessionService, RefreshDelivery };
