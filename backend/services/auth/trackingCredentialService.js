// backend/services/auth/trackingCredentialService.js — serviço da credencial de
// rastreamento (SEC-1 / Opção C). Orquestra crypto + domínio + tabela 064.
//
// INDEPENDENTE de Express. Recebe supabase (service_role) + cfg + crypto/domain
// injetáveis. O token ABERTO só sai dentro de um TrackingDelivery (não serializável)
// — nunca em logs/JSON. Só o HASH vai ao banco.
//
// Escopo: telemetria de localização do PRÓPRIO motorista/empresa. A validação
// re-consulta o banco (autoridade), nunca confia em claims embutidos (o token é opaco).

const util = require('util');
const defaultCrypto = require('./trackingCredentialCrypto');
const domain = require('./trackingCredentialDomain');
const E = require('./trackingCredentialErrors');

const TABELA = 'frete_tracking_credenciais';
const LAST_USED_THROTTLE_MS = 60 * 1000; // evita 1 write por ponto (pontos são ~5min)

/** Envelope do token aberto: valor NÃO-enumerável; toJSON/inspect redigem. */
class TrackingDelivery {
  constructor(token, expiresAt) {
    Object.defineProperty(this, '_token', { value: token, enumerable: false, writable: false });
    this.expiresAt = expiresAt;
  }
  reveal() { return this._token; }
  toJSON() { return { token: '[REDACTED]', expiresAt: this.expiresAt }; }
  toString() { return '[TrackingDelivery REDACTED]'; }
  [util.inspect.custom]() { return '[TrackingDelivery REDACTED]'; }
}

function criarTrackingCredentialService({ supabase, cfg, crypto = defaultCrypto, agora = () => Date.now() }) {
  if (!supabase) throw new Error('supabase obrigatório');
  if (!cfg) throw new Error('cfg obrigatório');

  function pepperOuFalha() {
    const p = cfg.getPepper && cfg.getPepper();
    if (!p) throw new E.TrackingDependencyUnavailable('pepper ausente');
    return p;
  }

  /**
   * Emite uma credencial de tracking para um motorista com viagem apta. Grava só o
   * HASH. Retorna { delivery, expiresAt }. `session_id`/`frete_id`/`device_id` são
   * contexto (nullable).
   */
  async function emitir({ empresa_id, motorista_id, session_id = null, frete_id = null, device_id = null }) {
    if (!empresa_id || !motorista_id) throw new E.TrackingScopeForbidden('empresa/motorista ausentes');
    const pepper = pepperOuFalha();
    const token = crypto.gerarTrackingToken();
    const hash = crypto.hashTrackingToken(token, pepper);
    const agoraMs = agora();
    const expiresAt = domain.calcularExpiracao(agoraMs, cfg.trackingCredentialTtlSeconds);

    const { error } = await supabase.from(TABELA).insert({
      empresa_id, motorista_id, session_id, frete_id, device_id,
      credential_hash: hash,
      issued_at: new Date(agoraMs).toISOString(),
      expires_at: expiresAt,
    });
    if (error) throw new E.TrackingDependencyUnavailable(error.message || 'erro ao emitir credencial');

    return { delivery: new TrackingDelivery(token, expiresAt), expiresAt };
  }

  async function carregarPorHash(hash) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('id, empresa_id, motorista_id, session_id, frete_id, expires_at, revoked_at, last_used_at')
      .eq('credential_hash', hash)
      .maybeSingle();
    if (error) throw new E.TrackingDependencyUnavailable(error.message);
    return data || null;
  }

  async function carregarUsuario(uid) {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, status, empresa_id')
      .eq('id', uid)
      .maybeSingle();
    if (error) throw new E.TrackingDependencyUnavailable(error.message);
    return data || null;
  }

  async function carregarSessao(sid) {
    if (!sid) return null;
    const { data, error } = await supabase
      .from('auth_sessions')
      .select('id, revoked_at')
      .eq('id', sid)
      .maybeSingle();
    if (error) throw new E.TrackingDependencyUnavailable(error.message);
    return data || null;
  }

  function erroDeCode(code, causa) {
    switch (code) {
      case 'credential_revoked': return new E.TrackingCredentialRevoked(causa);
      case 'credential_expired': return new E.TrackingCredentialExpired(causa);
      case 'driver_blocked': return new E.TrackingDriverBlocked(causa);
      case 'tracking_scope_forbidden': return new E.TrackingScopeForbidden(causa);
      case 'credential_invalid':
      default: return new E.TrackingCredentialInvalid(causa);
    }
  }

  /**
   * Valida o token apresentado. Lança erro tipado se inválido. Em sucesso retorna a
   * identidade operacional { uid, empresa_id, role, is_super_admin, credential_id }.
   * Atualiza last_used_at com throttle (best-effort; não bloqueia).
   */
  async function validar({ token }) {
    if (!crypto.pareceTrackingToken(token)) throw new E.TrackingCredentialInvalid('formato');
    const pepper = pepperOuFalha();
    const hash = crypto.hashTrackingToken(token, pepper);
    const credencial = await carregarPorHash(hash);
    if (!credencial) throw new E.TrackingCredentialInvalid('não encontrada');

    const [usuario, sessao] = await Promise.all([
      carregarUsuario(credencial.motorista_id),
      carregarSessao(credencial.session_id),
    ]);

    const veredito = domain.avaliarCredencial({ credencial, usuario, sessao, agoraMs: agora() });
    if (!veredito.ok) throw erroDeCode(veredito.code);

    await tocarUso(credencial).catch(() => {}); // best-effort

    return { ...veredito.identidade, credential_id: credencial.id };
  }

  async function tocarUso(credencial) {
    const agoraMs = agora();
    const ultimo = credencial.last_used_at ? new Date(credencial.last_used_at).getTime() : 0;
    if (agoraMs - ultimo < LAST_USED_THROTTLE_MS) return { atualizado: false };
    const iso = new Date(agoraMs).toISOString();
    await supabase.from(TABELA)
      .update({ last_used_at: iso, updated_at: iso })
      .eq('id', credencial.id).is('revoked_at', null);
    return { atualizado: true };
  }

  /**
   * Renova (ESTENDE) a validade da credencial apresentada — TRACKING-ONLY, sem tocar
   * SEC-1. Re-valida (não revogada, não expirada, motorista/sessão válidos) e empurra
   * expires_at para agora + TTL. Mantém o MESMO token (extend-only) para o intent
   * nativo permanecer estável (START_REDELIVER_INTENT sobrevive à morte do processo).
   */
  async function renovar({ token }) {
    const identidade = await validar({ token }); // aplica todas as regras de revogação/escopo
    const agoraMs = agora();
    const novoExpires = domain.calcularExpiracao(agoraMs, cfg.trackingCredentialTtlSeconds);
    const iso = new Date(agoraMs).toISOString();
    const { error } = await supabase.from(TABELA)
      .update({ expires_at: novoExpires, last_used_at: iso, updated_at: iso })
      .eq('id', identidade.credential_id).is('revoked_at', null);
    if (error) throw new E.TrackingDependencyUnavailable(error.message);
    return { expiresAt: novoExpires };
  }

  async function _revogarPor(coluna, valor, motivo) {
    const iso = new Date(agora()).toISOString();
    const { data, error } = await supabase.from(TABELA)
      .update({ revoked_at: iso, revoked_reason: String(motivo || 'revogacao').slice(0, 200), updated_at: iso })
      .eq(coluna, valor).is('revoked_at', null)
      .select('id');
    if (error) throw new E.TrackingDependencyUnavailable(error.message);
    return { revogadas: Array.isArray(data) ? data.length : 0 };
  }

  /** Revoga TODAS as credenciais ativas do motorista (logout / desvinculação). */
  function revogarDoMotorista(motoristaId, motivo = 'logout') {
    return _revogarPor('motorista_id', motoristaId, motivo);
  }

  /** Revoga as credenciais ativas emitidas por uma sessão (logout daquela sessão). */
  function revogarDaSessao(sessionId, motivo = 'logout') {
    return _revogarPor('session_id', sessionId, motivo);
  }

  return {
    emitir, validar, renovar,
    revogarDoMotorista, revogarDaSessao,
    TrackingDelivery,
  };
}

module.exports = { criarTrackingCredentialService, TrackingDelivery };
