// backend/services/auth/trackingCredentialService.js — serviço da credencial de
// rastreamento (SEC-1 / Opção C). Orquestra crypto + domínio + tabela 064.
//
// INDEPENDENTE de Express. Recebe supabase (service_role) + cfg + crypto injetáveis.
// O token ABERTO só sai dentro de um TrackingDelivery (não serializável). Só o HASH vai
// ao banco. A validação re-consulta o banco (autoridade) — o token é opaco.
//
// BINDING CANÔNICO (pós-revisão): a credencial é vinculada a sessão SEC-1 (sid), device
// e VIAGEM (frete). A validação exige tudo canônico + viagem ATIVA (não depende de hook).
// A renovação ROTACIONA o segredo (CAS) e nunca ultrapassa o teto absoluto.

const util = require('util');
const defaultCrypto = require('./trackingCredentialCrypto');
const domain = require('./trackingCredentialDomain');
const { erroDeCode, TrackingError } = require('./trackingCredentialErrors');

const TABELA = 'frete_tracking_credenciais';
const TABELA_FRETES = 'frete_tracking_credencial_fretes'; // escopo imutável (snapshot)
const LAST_USED_THROTTLE_MS = 60 * 1000;
// Mesma definição canônica de "viagem apta ao rastreamento" da telemetria/emissão
// (freteLocalizacaoController.listarFretesAtivosDoMotorista). MULTI-VIAGEM: a
// credencial vale enquanto houver >=1 destas.
const STATUS_FRETE_ATIVO = ['ativo', 'em_viagem', 'em_andamento'];

function unavailable(causa) { return new TrackingError('tracking_unavailable', causa); }

/** Envelope do token aberto: valor NÃO-enumerável; toJSON/inspect redigem. */
class TrackingDelivery {
  constructor(token, expiresAt, maxExpiresAt) {
    Object.defineProperty(this, '_token', { value: token, enumerable: false, writable: false });
    this.expiresAt = expiresAt;
    this.maxExpiresAt = maxExpiresAt;
  }
  reveal() { return this._token; }
  toJSON() { return { token: '[REDACTED]', expiresAt: this.expiresAt, maxExpiresAt: this.maxExpiresAt }; }
  toString() { return '[TrackingDelivery REDACTED]'; }
  [util.inspect.custom]() { return '[TrackingDelivery REDACTED]'; }
}

function criarTrackingCredentialService({ supabase, cfg, crypto = defaultCrypto, agora = () => Date.now() }) {
  if (!supabase) throw new Error('supabase obrigatório');
  if (!cfg) throw new Error('cfg obrigatório');

  function pepperOuFalha() {
    const p = cfg.getPepper && cfg.getPepper();
    if (!p) throw unavailable('pepper ausente');
    return p;
  }

  // Resolve, SERVER-SIDE, as viagens ATIVAS do motorista NO MOMENTO da emissão (snapshot).
  // Nunca confia em IDs do cliente. Limite = regra existente da localização (até 4).
  async function carregarFretesAtivos(empresaId, motoristaId, limite = 4) {
    const { data, error } = await supabase
      .from('fretes')
      .select('id')
      .eq('empresa_id', empresaId)
      .eq('motorista_id', motoristaId)
      .in('status', STATUS_FRETE_ATIVO)
      .limit(limite);
    if (error) throw unavailable(error.message);
    return (data || []).map((f) => f.id);
  }

  /**
   * Emite credencial ancorada em (empresa, motorista, sessão SEC-1, device) com ESCOPO
   * IMUTÁVEL = snapshot das viagens ATIVAS do motorista agora. Grava só o HASH + o vínculo
   * (tabela de escopo). Sem viagem ativa → tracking_trip_inactive.
   */
  async function emitir({ empresa_id, motorista_id, session_id, device_id }) {
    if (!empresa_id || !motorista_id) throw erroDeCode('tracking_tenant_mismatch', 'empresa/motorista ausentes');
    if (!session_id) throw erroDeCode('tracking_session_revoked', 'sessão (sid) obrigatória para emitir');
    if (!device_id) throw erroDeCode('tracking_device_mismatch', 'device obrigatório para emitir');

    const escopo = await carregarFretesAtivos(empresa_id, motorista_id);
    if (escopo.length === 0) throw erroDeCode('tracking_trip_inactive', 'sem viagem ativa para escopar');

    const pepper = pepperOuFalha();
    const token = crypto.gerarTrackingToken();
    const hash = crypto.hashTrackingToken(token, pepper);
    const agoraMs = agora();
    const maxExpiresAt = domain.calcularMaxExpiracao(agoraMs, cfg.trackingCredentialMaxLifetimeSeconds);
    const expiresAt = domain.calcularExpiracao(agoraMs, cfg.trackingCredentialTtlSeconds, Date.parse(maxExpiresAt));

    const issuedIso = new Date(agoraMs).toISOString();
    const { data: inserida, error } = await supabase.from(TABELA).insert({
      empresa_id, motorista_id, session_id, device_id,
      credential_hash: hash,
      issued_at: issuedIso,
      expires_at: expiresAt,
      max_expires_at: maxExpiresAt,
    }).select('id').single();
    if (error || !inserida) throw unavailable((error && error.message) || 'erro ao emitir credencial');

    const vinculos = escopo.map((freteId) => ({ credencial_id: inserida.id, frete_id: freteId }));
    const { error: erroVinculo } = await supabase.from(TABELA_FRETES).insert(vinculos);
    if (erroVinculo) throw unavailable(erroVinculo.message || 'erro ao gravar escopo da credencial');

    // BLOCKER-1 (single_native_tracking_credential): UMA credencial operacional corrente por
    // (session_id, device_id). O app re-chamava a emissão em cada reconcile/resume/timer de
    // foreground e acumulava N credenciais VÁLIDAS simultâneas (superfície ampliada). Ao emitir
    // a nova, revogamos atomicamente as ANTERIORES ATIVAS da MESMA sessão+device — mantendo só a
    // mais nova (issued_at < a recém-emitida). Race-safe: a recém-emitida (issued_at = issuedIso)
    // NUNCA é alvo (nada é mais novo que ela); sob emissões concorrentes a mais nova sempre
    // sobrevive → converge para 1 ativa. Uma emissão LEGÍTIMA de novo escopo (nova viagem) também
    // passa por aqui e substitui/revoga a anterior — nova viagem futura continua exigindo emissão
    // SEC-1 autenticada (não reativa credencial antiga). Best-effort: falha aqui não invalida a
    // credencial recém-emitida (apenas deixaria históricas ativas, corrigidas na próxima emissão).
    try {
      await supabase.from(TABELA)
        .update({ revoked_at: issuedIso, revoked_reason: 'reemitida_substituida', updated_at: issuedIso })
        .eq('session_id', session_id)
        .eq('device_id', device_id)
        .is('revoked_at', null)
        .lt('issued_at', issuedIso);
    } catch (_) { /* best-effort: cleanup nunca derruba a emissão corrente */ }

    return { delivery: new TrackingDelivery(token, expiresAt, maxExpiresAt), expiresAt, maxExpiresAt, fretes_escopo: escopo };
  }

  async function carregarPorHash(hash) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('id, empresa_id, motorista_id, session_id, device_id, expires_at, max_expires_at, revoked_at, last_used_at')
      .eq('credential_hash', hash)
      .maybeSingle();
    if (error) throw unavailable(error.message);
    return data || null;
  }

  async function carregarUsuario(uid) {
    const { data, error } = await supabase.from('usuarios').select('id, status, empresa_id').eq('id', uid).maybeSingle();
    if (error) throw unavailable(error.message);
    return data || null;
  }
  async function carregarSessao(sid) {
    if (!sid) return null;
    const { data, error } = await supabase.from('auth_sessions').select('id, revoked_at').eq('id', sid).maybeSingle();
    if (error) throw unavailable(error.message);
    return data || null;
  }

  // INTERSEÇÃO: das viagens do ESCOPO (snapshot) da credencial, quais CONTINUAM ativas e
  // pertencem ao motorista/empresa. É o único conjunto para o qual a telemetria faz
  // fan-out. Vazio → escopo exaurido (nenhuma viagem do snapshot segue ativa).
  async function carregarEscopoAtivo(credencialId, empresaId, motoristaId) {
    const { data: vinc, error: e1 } = await supabase
      .from(TABELA_FRETES).select('frete_id').eq('credencial_id', credencialId);
    if (e1) throw unavailable(e1.message);
    const ids = (vinc || []).map((v) => v.frete_id);
    if (ids.length === 0) return [];
    const { data, error } = await supabase
      .from('fretes')
      .select('id, empresa_id, motorista_id, status, data')
      .in('id', ids)
      .eq('empresa_id', empresaId)
      .eq('motorista_id', motoristaId)
      .in('status', STATUS_FRETE_ATIVO);
    if (error) throw unavailable(error.message);
    return data || [];
  }

  /**
   * Valida o token. `deviceId` do header; `permitirExpirada` = fluxo de renovação.
   * Lança erro tipado se inválido. Em sucesso retorna identidade + a linha da credencial
   * (para rotação) + `fretesEscopoAtivos` (interseção escopo∩ativos, para fan-out).
   */
  async function validarInterno({ token, deviceId, permitirExpirada = false }) {
    if (!crypto.pareceTrackingToken(token)) throw erroDeCode('tracking_credential_invalid', 'formato');
    const pepper = pepperOuFalha();
    const hash = crypto.hashTrackingToken(token, pepper);
    const credencial = await carregarPorHash(hash);
    if (!credencial) throw erroDeCode('tracking_credential_invalid', 'não encontrada');

    const [usuario, sessao, fretesEscopoAtivos] = await Promise.all([
      carregarUsuario(credencial.motorista_id),
      carregarSessao(credencial.session_id),
      carregarEscopoAtivo(credencial.id, credencial.empresa_id, credencial.motorista_id),
    ]);

    const veredito = domain.avaliarCredencial({
      credencial, usuario, sessao, temEscopoAtivo: fretesEscopoAtivos.length > 0,
      deviceId, agoraMs: agora(), permitirExpirada,
    });
    if (!veredito.ok) throw erroDeCode(veredito.code);
    return { identidade: { ...veredito.identidade, credential_id: credencial.id }, credencial, hash, fretesEscopoAtivos };
  }

  async function validar({ token, deviceId }) {
    const { identidade, credencial, fretesEscopoAtivos } = await validarInterno({ token, deviceId, permitirExpirada: false });
    await tocarUso(credencial).catch(() => {});
    return { ...identidade, fretesAutorizados: fretesEscopoAtivos };
  }

  async function tocarUso(credencial) {
    const agoraMs = agora();
    const ultimo = credencial.last_used_at ? new Date(credencial.last_used_at).getTime() : 0;
    if (agoraMs - ultimo < LAST_USED_THROTTLE_MS) return { atualizado: false };
    const iso = new Date(agoraMs).toISOString();
    await supabase.from(TABELA).update({ last_used_at: iso, updated_at: iso }).eq('id', credencial.id).is('revoked_at', null);
    return { atualizado: true };
  }

  /**
   * ROTACIONA a credencial (tracking-only). Aceita credencial expirada (renovação),
   * desde que dentro do teto absoluto e com todos os vínculos canônicos válidos
   * (sessão/motorista/empresa/device/viagem ativa). Gera token B e troca o hash via
   * CAS (impede duas credenciais válidas concorrentes). NUNCA ultrapassa max_expires_at.
   * Retorna { delivery, expiresAt, maxExpiresAt } com o NOVO token.
   */
  async function renovar({ token, deviceId }) {
    const { credencial, hash: hashAntigo } = await validarInterno({ token, deviceId, permitirExpirada: true });
    const pepper = pepperOuFalha();
    const agoraMs = agora();
    const maxMs = Date.parse(credencial.max_expires_at);
    const novoToken = crypto.gerarTrackingToken();
    const novoHash = crypto.hashTrackingToken(novoToken, pepper);
    const novoExpires = domain.calcularExpiracao(agoraMs, cfg.trackingCredentialTtlSeconds, maxMs);
    const iso = new Date(agoraMs).toISOString();

    // CAS: só rotaciona se o hash ainda é o apresentado, não revogada e dentro do teto.
    const { data, error } = await supabase.from(TABELA)
      .update({ credential_hash: novoHash, expires_at: novoExpires, last_used_at: iso, updated_at: iso })
      .eq('id', credencial.id)
      .eq('credential_hash', hashAntigo)
      .is('revoked_at', null)
      .gte('max_expires_at', iso)
      .select('id');
    if (error) throw unavailable(error.message);
    const afetadas = Array.isArray(data) ? data.length : 0;
    if (afetadas !== 1) {
      // Perdeu a corrida (outra rotação) ou foi revogada/estourou o teto entre a
      // validação e o CAS. Não emite token novo — o cliente reobtém estado.
      throw erroDeCode('tracking_credential_rotated', 'CAS não aplicou (revogada/rotacionada/teto)');
    }
    return { delivery: new TrackingDelivery(novoToken, novoExpires, credencial.max_expires_at), expiresAt: novoExpires, maxExpiresAt: credencial.max_expires_at };
  }

  async function _revogarPor(coluna, valor, motivo) {
    const iso = new Date(agora()).toISOString();
    const { data, error } = await supabase.from(TABELA)
      .update({ revoked_at: iso, revoked_reason: String(motivo || 'revogacao').slice(0, 200), updated_at: iso })
      .eq(coluna, valor).is('revoked_at', null)
      .select('id');
    if (error) throw unavailable(error.message);
    return { revogadas: Array.isArray(data) ? data.length : 0 };
  }

  const revogarDoMotorista = (motoristaId, motivo = 'logout') => _revogarPor('motorista_id', motoristaId, motivo);
  const revogarDaSessao = (sessionId, motivo = 'logout') => _revogarPor('session_id', sessionId, motivo);
  // NOTA (SEC-1 fechamento): NÃO existe revogação por `frete_id`. A tabela 064
  // `frete_tracking_credenciais` NÃO tem coluna frete_id (o escopo de viagens é o SNAPSHOT
  // imutável em `frete_tracking_credencial_fretes`). A revogação ao fim/cancelamento de viagem
  // é feita por `revogarDoMotorista` via `trackingRevocacaoHook.revogarTrackingSeSemViagemAtiva`
  // (só quando o motorista NÃO tem mais viagem ativa). Um revogador por `frete_id` filtraria uma
  // coluna inexistente (erro em runtime) — por isso foi removido.

  return {
    emitir, validar, renovar,
    revogarDoMotorista, revogarDaSessao,
    STATUS_FRETE_ATIVO,
    TrackingDelivery,
  };
}

module.exports = { criarTrackingCredentialService, TrackingDelivery };
