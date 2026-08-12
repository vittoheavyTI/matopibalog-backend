import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';
import 'app_logger.dart';

enum LocationTrackingStartResult {
  started,
  unsupported,
  serviceDisabled,
  denied,
  deniedForever,
  approximateOnly,
  missingSession,
  failed,
}

enum LocationTrackingStatus {
  inactive,
  active,
  awaitingPermission,
  permissionDenied,
  deniedForever,
  approximateOnly,
  gpsDisabled,
  missingSession,
  unsupported,
  failed,
}

/// SEC-1 (credential storm hardening) — estado EXPLÍCITO do serviço nativo, espelhando a
/// máquina de estados Kotlin (LocationQueueLogic.NativeTrackingState). `starting` e `running`
/// são VIVOS: o serviço está inicializando legitimamente ou operando → o guard NÃO reemite.
/// `stopped`/`terminal` são não-vivos → recuperação controlada (reemissão pela reconciliação).
enum NativeTrackingState { stopped, starting, running, terminal }

/// Motivo ENUMERADO (diagnóstico, nunca autorização) de uma tentativa de emissão/decisão de
/// tracking. Permite provar a ORIGEM de uma emissão no próximo Checkpoint A sem depender de
/// inferência temporal/ADB. Registrado sanitizado (sem token/credential/hash sensível).
enum TrackingEmissionReason {
  loginReconcile,   // 1º reconcile pós-login
  financeReconcile, // FinanceProvider.loadData / refresh / pós-ação
  tripStarted,      // criação/início de viagem → snapshot precisa incluir a nova viagem
  manualEnable,     // usuário tocou "Ativar" (Home/Detalhe)
  nativeRecovery,   // serviço nativo morto/terminal → recuperação controlada
}

class LocationTrackingSnapshot {
  final LocationTrackingStatus status;
  final int activeTrips;
  final String message;

  const LocationTrackingSnapshot({
    required this.status,
    required this.activeTrips,
    required this.message,
  });

  bool get isActive => status == LocationTrackingStatus.active;
}

class LocationTrackingService {
  static const MethodChannel _channel =
      MethodChannel('br.com.matopibalog/location_tracking');
  static const _statusKey = 'location_tracking_status';
  static const _activeTripsKey = 'location_tracking_active_trips';
  static const _onboardingShownKey = 'location_tracking_onboarding_shown';
  static const _activeStatuses = {'ativo', 'em_viagem', 'em_andamento'};

  static final ValueNotifier<LocationTrackingSnapshot> snapshot =
      ValueNotifier<LocationTrackingSnapshot>(
    const LocationTrackingSnapshot(
      status: LocationTrackingStatus.inactive,
      activeTrips: 0,
      message: 'Nao ha viagem em andamento.',
    ),
  );

  // BLOCKER-1 (single_native_tracking_credential): estado da credencial de rastreamento
  // CORRENTE, para NÃO re-emitir em cada reconcile/resume/timer de foreground. Antes,
  // `_startSession` chamava `issueTrackingCredential()` incondicionalmente e o app
  // acumulava dezenas de credenciais numa mesma sessão/device após um único start.
  // Agora reusamos a credencial vigente enquanto: (a) o serviço nativo está ativo em modo
  // credencial; (b) o ESCOPO (conjunto de viagens ativas) não mudou; (c) a credencial não
  // está perto do vencimento nominal. Uma mudança legítima de escopo (nova viagem) tem
  // assinatura diferente → nova emissão SEC-1 (que, no backend, substitui a anterior).
  static bool _trackingActive = false;          // serviço nativo rodando
  static bool _trackingModeCredential = false;  // último start foi em modo credencial (não legacy)
  static String? _trackingScopeSig;             // assinatura do escopo (IDs de viagens ativas, ordenados)
  // Reuso baseado no TETO ABSOLUTO (max_expires_at, ~7d), NÃO no vencimento nominal (~24h):
  // o serviço nativo AUTO-RENOVA (rotação CAS) a credencial até o teto, mantendo a MESMA linha
  // ativa. Basear o reuso no nominal fazia o Flutter re-emitir a cada ~24h e revogar a credencial
  // renovada que o nativo estava usando (ponto 7 do reassessment). Após o teto → re-emite.
  static int _trackingCredentialMaxExpiresAtMs = 0;
  static const int _reuseMarginMs = 2 * 60 * 1000; // reusar só se faltar > 2 min p/ o teto

  // Single-flight: serializa chamadas concorrentes de _startSession (reconcile + resume + timer
  // podem coincidir). Com a serialização, a 2ª chamada roda APÓS a 1ª já ter marcado o estado →
  // o guard de reuso evita a emissão duplicada (mesmo escopo). Camada client-side do BLOCKER-1.
  static Future<void> _startLock = Future<void>.value();

  // Correlação diagnóstica (observabilidade): últimos device/session vistos, guardados só para
  // logar HASH CURTO não sensível. Nunca usados como autorização; nunca logados em claro.
  static String? _lastDeviceIdForLog;
  static String? _lastSessionTokenForLog;

  @visibleForTesting
  static void resetTrackingStateForTesting() {
    _trackingActive = false;
    _trackingModeCredential = false;
    _trackingScopeSig = null;
    _trackingCredentialMaxExpiresAtMs = 0;
    _lastDeviceIdForLog = null;
    _lastSessionTokenForLog = null;
    _startLock = Future<void>.value();
  }

  // Predicado PURO (testável sem plataforma): reusar a credencial vigente em vez de
  // re-emitir? Só quando o nativo está ativo em modo credencial, o escopo pedido é o
  // MESMO e a credencial ainda está longe do vencimento nominal.
  @visibleForTesting
  static bool shouldReuseCredential({
    required bool active,
    required bool credentialMode,
    required String? currentSig,
    required String? requestedSig,
    required int maxExpiresAtMs,
    required int nowMs,
  }) {
    return active &&
        credentialMode &&
        requestedSig != null &&
        requestedSig == currentSig &&
        maxExpiresAtMs > 0 &&
        nowMs < maxExpiresAtMs - _reuseMarginMs;
  }

  // Assinatura estável do escopo a partir da lista de fretes (exposta p/ teste).
  @visibleForTesting
  static String scopeSignatureForTesting(List<dynamic> fretes) =>
      _activeTripIds(fretes).join(',');

  // Estado nativo tri-state (autoridade da liveness). Fail-safe: fora do Android ou em qualquer
  // incerteza (exceção/plataforma/desconhecido) → `stopped` → NÃO reusa (re-emite/recupera).
  @visibleForTesting
  static Future<NativeTrackingState> nativeTrackingState() async {
    if (!Platform.isAndroid) return NativeTrackingState.stopped;
    try {
      return parseNativeState(await _channel.invokeMethod('trackingState'));
    } catch (_) {
      return NativeTrackingState.stopped;
    }
  }

  // Parsing PURO da resposta do canal 'trackingState' (testável). Só os nomes conhecidos são
  // aceitos; null/qualquer outro → `stopped` (fail-safe → não reusa às cegas).
  @visibleForTesting
  static NativeTrackingState parseNativeState(dynamic r) {
    switch (r) {
      case 'running':
        return NativeTrackingState.running;
      case 'starting':
        return NativeTrackingState.starting;
      case 'terminal':
        return NativeTrackingState.terminal;
      default:
        return NativeTrackingState.stopped;
    }
  }

  // STARTING e RUNNING são "vivos": o serviço está em inicialização legítima (janela da ack-race)
  // ou operando → NÃO reemitir. Espelha LocationQueueLogic.nativeStateIsAlive no nativo.
  @visibleForTesting
  static bool nativeStateIsAlive(NativeTrackingState s) =>
      s == NativeTrackingState.running || s == NativeTrackingState.starting;

  // Decisão PURA de emissão (a MESMA usada pelo fluxo real — sem drift). Modela a máquina de
  // reconciliação para o teste da aceitação (emit#1 → STARTING → reconcile → reconcile ⇒ 1
  // emissão), já que o fluxo completo (_startSessionInner) só roda no Android (Platform.isAndroid).
  //   'reuse'   → nativo VIVO (starting/running) + mesmo escopo + credencial longe do teto.
  //   'recover' → havia estado marcado mas o nativo NÃO está vivo (morto/terminal).
  //   'issue'   → 1ª emissão ou mudança legítima de escopo.
  @visibleForTesting
  static String classifyStartDecision({
    required bool trackingActive,
    required bool nativeAlive,
    required bool credentialMode,
    required String? currentSig,
    required String? requestedSig,
    required int maxExpiresAtMs,
    required int nowMs,
  }) {
    if (shouldReuseCredential(
      active: trackingActive && nativeAlive,
      credentialMode: credentialMode,
      currentSig: currentSig,
      requestedSig: requestedSig,
      maxExpiresAtMs: maxExpiresAtMs,
      nowMs: nowMs,
    )) {
      return 'reuse';
    }
    if (trackingActive && !nativeAlive) return 'recover';
    return 'issue';
  }

  static Future<void> restoreSnapshot() async {
    final prefs = await SharedPreferences.getInstance();
    final statusName = prefs.getString(_statusKey);
    final activeTrips = prefs.getInt(_activeTripsKey) ?? 0;
    final status = LocationTrackingStatus.values.firstWhere(
      (s) => s.name == statusName,
      orElse: () => LocationTrackingStatus.inactive,
    );
    _setSnapshot(status, activeTrips);
  }

  // MÁQUINA DE RECONCILIAÇÃO CANÔNICA (Fase 4): a ÚNICA via que decide emitir/reusar/recuperar,
  // sempre a partir do conjunto CANÔNICO de IDs de viagens ativas. Todos os fluxos que têm (ou
  // podem obter) a lista de fretes passam por aqui — evita dois caminhos concorrentes disputando
  // a mesma credencial. Escopo vazio → stop() (encerra tracking). O snapshot REAL do escopo é
  // server-side na emissão; os IDs client-side são a assinatura de mudança de escopo.
  static Future<LocationTrackingStartResult> reconcileWithFretes(
    List<dynamic> fretes, {
    bool requestPermission = false,
    TrackingEmissionReason reason = TrackingEmissionReason.financeReconcile,
  }) async {
    final activeIds = _activeTripIds(fretes);
    if (activeIds.isEmpty) {
      await stop();
      return LocationTrackingStartResult.started;
    }

    final result = await _startSession(
      activeTrips: activeIds.length.clamp(1, 4),
      requestPermission: requestPermission,
      scopeSignature: activeIds.join(','),
      reason: reason,
    );
    return result;
  }

  // IDs (ordenados) das viagens ATIVAS — assinatura estável do escopo. Reconcile com o
  // MESMO conjunto de viagens não deve gerar nova credencial (BLOCKER-1). Só a lista de
  // fretes (reconcile) conhece os IDs; chamadas por contagem passam scopeSignature=null.
  static List<String> _activeTripIds(List<dynamic> fretes) {
    final ids = <String>{};
    for (final frete in fretes) {
      if (frete is! Map) continue;
      final status = (frete['status'] ?? '').toString();
      final id = frete['id']?.toString();
      if (id != null && id.isNotEmpty && _activeStatuses.contains(status)) {
        ids.add(id);
      }
    }
    final list = ids.toList()..sort();
    return list;
  }

  // ENSURE-LIVENESS (Fase 4): caminho SEM conhecimento de escopo. NÃO decide emitir/reescopar
  // credencial — isso é exclusivo da reconciliação por IDs (reconcileWithFretes). Se o serviço
  // nativo está VIVO (starting/running) → nada a fazer ('started'). Se não está, NÃO fabrica
  // escopo nem emite: a reconciliação canônica (Home refresh/loadData) fará a emissão/recuperação
  // legítima. Mantido só por compatibilidade de API (startForTrip); os call-sites de UI passaram
  // a usar reconcileWithFretes(ids). `activeTrips`/`requestPermission` preservados por assinatura.
  static Future<LocationTrackingStartResult> startForActiveTrips({
    int activeTrips = 1,
    bool requestPermission = false,
  }) async {
    if (!Platform.isAndroid) {
      await _persist(LocationTrackingStatus.unsupported, activeTrips);
      return LocationTrackingStartResult.unsupported;
    }
    final estado = await nativeTrackingState();
    if (nativeStateIsAlive(estado)) {
      await _persist(LocationTrackingStatus.active, activeTrips.clamp(1, 4));
      _logTrackingDecision(
        reason: TrackingEmissionReason.manualEnable,
        state: estado,
        scopeSig: _trackingScopeSig,
        result: 'reuse',
      );
      return LocationTrackingStartResult.started;
    }
    // Nativo não-vivo e sem escopo conhecido aqui: não emitir (evita storm/escopo fabricado).
    _logTrackingDecision(
      reason: TrackingEmissionReason.manualEnable,
      state: estado,
      scopeSig: null,
      result: 'ensure_noop',
    );
    return LocationTrackingStartResult.failed;
  }

  static Future<LocationTrackingStartResult> prepareForTripStart({
    bool requestPermission = false,
  }) async {
    const activeTrips = 1;
    if (!Platform.isAndroid) {
      await _persist(LocationTrackingStatus.unsupported, activeTrips);
      return LocationTrackingStartResult.unsupported;
    }
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await _persist(LocationTrackingStatus.gpsDisabled, activeTrips);
      return LocationTrackingStartResult.serviceDisabled;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied && requestPermission) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      await _persist(LocationTrackingStatus.permissionDenied, activeTrips);
      return LocationTrackingStartResult.denied;
    }
    if (permission == LocationPermission.deniedForever) {
      await _persist(LocationTrackingStatus.deniedForever, activeTrips);
      return LocationTrackingStartResult.deniedForever;
    }
    if (await _hasApproximateOnly()) {
      await _persist(LocationTrackingStatus.approximateOnly, activeTrips);
      return LocationTrackingStartResult.approximateOnly;
    }
    final token = await ApiService.currentSessionToken();
    if (token == null || token.isEmpty) {
      await _persist(LocationTrackingStatus.missingSession, activeTrips);
      return LocationTrackingStartResult.missingSession;
    }
    return LocationTrackingStartResult.started;
  }

  static Future<LocationTrackingStartResult> startForTrip(String freteId) {
    if (freteId.isEmpty) {
      return Future.value(LocationTrackingStartResult.failed);
    }
    return startForActiveTrips(requestPermission: false);
  }

  static Future<bool> shouldShowPermissionOnboarding() async {
    if (!Platform.isAndroid) return false;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_onboardingShownKey) == true) return false;
    final permission = await Geolocator.checkPermission();
    return permission == LocationPermission.denied ||
        permission == LocationPermission.unableToDetermine;
  }

  static Future<void> markPermissionOnboardingShown() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_onboardingShownKey, true);
  }

  static Future<LocationTrackingStartResult> requestPermissionFromOnboarding() async {
    await markPermissionOnboardingShown();
    if (!Platform.isAndroid) return LocationTrackingStartResult.unsupported;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.unableToDetermine) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      await _persist(LocationTrackingStatus.permissionDenied, 0);
      return LocationTrackingStartResult.denied;
    }
    if (permission == LocationPermission.deniedForever) {
      await _persist(LocationTrackingStatus.deniedForever, 0);
      return LocationTrackingStartResult.deniedForever;
    }
    if (await _hasApproximateOnly()) {
      await _persist(LocationTrackingStatus.approximateOnly, 0);
      return LocationTrackingStartResult.approximateOnly;
    }
    await _persist(LocationTrackingStatus.inactive, 0);
    return LocationTrackingStartResult.started;
  }

  static Future<void> openOperationalSettings(LocationTrackingStartResult result) async {
    if (!Platform.isAndroid) return;
    if (result == LocationTrackingStartResult.serviceDisabled) {
      await Geolocator.openLocationSettings();
      return;
    }
    if (result == LocationTrackingStartResult.deniedForever ||
        result == LocationTrackingStartResult.approximateOnly) {
      await Geolocator.openAppSettings();
    }
  }

  // BLOCKER-1 (single-flight): serializa as chamadas de _startSession. Duas chamadas
  // concorrentes (reconcile + resume + timer) não emitem em paralelo — a 2ª só roda depois
  // que a 1ª marcou o estado, permitindo o guard de reuso agir. Combina com a orquestração
  // do backend e (futuramente) a garantia transacional do Postgres.
  static Future<LocationTrackingStartResult> _startSession({
    required int activeTrips,
    required bool requestPermission,
    String? scopeSignature,
    required TrackingEmissionReason reason,
  }) {
    final prior = _startLock;
    final gate = Completer<void>();
    _startLock = gate.future;
    return prior.then((_) => _startSessionInner(
          activeTrips: activeTrips,
          requestPermission: requestPermission,
          scopeSignature: scopeSignature,
          reason: reason,
        )).whenComplete(gate.complete);
  }

  static Future<LocationTrackingStartResult> _startSessionInner({
    required int activeTrips,
    required bool requestPermission,
    String? scopeSignature,
    required TrackingEmissionReason reason,
  }) async {
    if (!Platform.isAndroid) {
      await _persist(LocationTrackingStatus.unsupported, activeTrips);
      return LocationTrackingStartResult.unsupported;
    }

    // Estado nativo é a AUTORIDADE da liveness. STARTING (serviço em inicialização legítima —
    // janela em que 'start' já deu ACK mas onStartCommand ainda não rodou) conta como VIVO:
    // fecha a native_start_ack_race que revogava a credencial recém-emitida.
    final nativeState = await nativeTrackingState();
    final alive = nativeStateIsAlive(nativeState);

    // Decisão de emissão (classificador PURO, mesma lógica testada). Reuso NÃO reemite nem em
    // STARTING nem em RUNNING. scopeSignature=null NÃO reusa e NÃO deve chegar aqui: a decisão de
    // emissão é exclusiva da reconciliação por IDs (Fase 4). O backend NÃO deduplica — cada POST
    // cria uma credencial nova e revoga a anterior; por isso o guard client-side é essencial.
    final decision = classifyStartDecision(
      trackingActive: _trackingActive,
      nativeAlive: alive,
      credentialMode: _trackingModeCredential,
      currentSig: _trackingScopeSig,
      requestedSig: scopeSignature,
      maxExpiresAtMs: _trackingCredentialMaxExpiresAtMs,
      nowMs: DateTime.now().millisecondsSinceEpoch,
    );
    if (decision == 'reuse') {
      await _persist(LocationTrackingStatus.active, activeTrips);
      _logTrackingDecision(
        reason: reason, state: nativeState, scopeSig: scopeSignature, result: 'reuse',
      );
      return LocationTrackingStartResult.started;
    }
    // Não reusou. 'recover' = havia estado marcado mas o nativo NÃO está vivo (morto/terminal):
    // esquece o estado e segue para nova emissão legítima.
    final isRecovery = decision == 'recover';
    if (!alive) {
      _trackingActive = false;
      _trackingModeCredential = false;
      _trackingScopeSig = null;
      _trackingCredentialMaxExpiresAtMs = 0;
    }

    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await ApiService.reportLocationTrackingState('gps_desativado');
      await _persist(LocationTrackingStatus.gpsDisabled, activeTrips);
      return LocationTrackingStartResult.serviceDisabled;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied && requestPermission) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      await ApiService.reportLocationTrackingState('permissao_nao_concedida');
      await _persist(LocationTrackingStatus.permissionDenied, activeTrips);
      return LocationTrackingStartResult.denied;
    }
    if (permission == LocationPermission.deniedForever) {
      await ApiService.reportLocationTrackingState('permissao_nao_concedida');
      await _persist(LocationTrackingStatus.deniedForever, activeTrips);
      return LocationTrackingStartResult.deniedForever;
    }
    if (permission == LocationPermission.unableToDetermine) {
      await _persist(LocationTrackingStatus.awaitingPermission, activeTrips);
      return LocationTrackingStartResult.denied;
    }
    if (await _hasApproximateOnly()) {
      await ApiService.reportLocationTrackingState('permissao_nao_concedida');
      await _persist(LocationTrackingStatus.approximateOnly, activeTrips);
      return LocationTrackingStartResult.approximateOnly;
    }

    final token = await ApiService.currentSessionToken();
    if (token == null || token.isEmpty) {
      await _persist(LocationTrackingStatus.missingSession, activeTrips);
      return LocationTrackingStartResult.missingSession;
    }
    _lastSessionTokenForLog = token; // correlação diagnóstica (hash curto no log)

    // SEC-1 (Opção C) — §B-1: emissão TRI-STATE da credencial escopada.
    final result = await ApiService.issueTrackingCredential();

    // FAIL-CLOSED: feature ON mas a emissão falhou → NÃO iniciar com o access token
    // (isso reintroduziria o bug: rastreamento morre quando o access expira). Marca
    // estado observável e permite retry (o reconcile tenta de novo no próximo ciclo).
    if (result.outcome == TrackingIssueOutcome.failed) {
      await _persist(LocationTrackingStatus.failed, activeTrips);
      _logTrackingDecision(
        reason: reason, state: nativeState, scopeSig: scopeSignature, result: 'failed',
      );
      return LocationTrackingStartResult.failed;
    }

    late final Map<String, dynamic> args;
    var startedInCredentialMode = false;
    var credentialMaxExpiresAtMs = 0;
    if (result.outcome == TrackingIssueOutcome.credential && result.credential != null) {
      final c = result.credential!;
      final deviceId = await ApiService.currentDeviceId();
      _lastDeviceIdForLog = deviceId; // correlação diagnóstica (hash curto no log)
      startedInCredentialMode = true;
      credentialMaxExpiresAtMs = c.maxExpiresAtMs;
      args = <String, dynamic>{
        'token': c.credential,
        'baseUrl': ApiService.baseUrl,
        'mode': 'tracking',
        'deviceId': deviceId,
        'expiresAt': c.expiresAtMs,
        'maxExpiresAt': c.maxExpiresAtMs,
      };
    } else {
      // disabled: o backend PROVOU flag OFF (404) → fluxo compatível (access token).
      args = <String, dynamic>{
        'token': token,
        'baseUrl': ApiService.baseUrl,
        'mode': 'session',
        'expiresAt': 0,
        'maxExpiresAt': 0,
      };
    }

    try {
      await _channel.invokeMethod('start', args);
      // BLOCKER-1: registra a credencial/escopo CORRENTE para o guard de reuso. Em modo
      // legacy (flag OFF) não há credencial vigente → não reusar (o access token rotaciona
      // e precisa ser re-empurrado ao nativo).
      _trackingActive = true;
      _trackingModeCredential = startedInCredentialMode;
      _trackingScopeSig = startedInCredentialMode ? scopeSignature : null;
      _trackingCredentialMaxExpiresAtMs = credentialMaxExpiresAtMs;
      await _persist(LocationTrackingStatus.active, activeTrips);
      _logTrackingDecision(
        reason: isRecovery ? TrackingEmissionReason.nativeRecovery : reason,
        state: nativeState,
        scopeSig: scopeSignature,
        result: isRecovery ? 'recover' : 'issue',
      );
      return LocationTrackingStartResult.started;
    } catch (_) {
      await ApiService.reportLocationTrackingState('interrompida');
      await _persist(LocationTrackingStatus.failed, activeTrips);
      _logTrackingDecision(
        reason: reason, state: nativeState, scopeSig: scopeSignature, result: 'stop',
      );
      return LocationTrackingStartResult.failed;
    }
  }

  // Observabilidade SANITIZADA (Fase 3) — prova a ORIGEM de qualquer emissão no próximo
  // Checkpoint A sem ADB/inferência temporal. NUNCA loga token/credential/hash sensível: só
  // reason enumerado, estado nativo, resultado e IDENTIFICADORES CURTOS não sensíveis do
  // escopo/sessão/device (hashes curtos). Diagnóstico apenas — nunca autorização/security input.
  static void _logTrackingDecision({
    required TrackingEmissionReason reason,
    required NativeTrackingState state,
    required String? scopeSig,
    required String result,
  }) {
    final scopeCount =
        (scopeSig == null || scopeSig.isEmpty) ? 0 : scopeSig.split(',').length;
    AppLogger.action('tracking_emission', params: {
      'reason': reason.name,
      'native_state': state.name,
      'result': result, // reuse | issue | recover | failed | stop | ensure_noop
      'scope_count': scopeCount,
      'scope_sig': _shortHash(scopeSig),
      'device': _shortHash(_lastDeviceIdForLog),
      'sid': _shortHash(_lastSessionTokenForLog),
    });
  }

  // Hash curto NÃO reversível (correlação diagnóstica, não sigilo). Entrada nula → '-'.
  static String _shortHash(String? value) {
    if (value == null || value.isEmpty) return '-';
    var h = 0x811c9dc5; // FNV-1a 32-bit
    for (final code in value.codeUnits) {
      h ^= code;
      h = (h * 0x01000193) & 0xffffffff;
    }
    return h.toRadixString(16).padLeft(8, '0');
  }

  static Future<void> stop() async {
    if (Platform.isAndroid) {
      try {
        await _channel.invokeMethod('stop');
      } catch (_) {
        // Best-effort: o backend tambem rejeita viagem encerrada e o servico para.
      }
    }
    // BLOCKER-1: encerrou o rastreamento → esquece a credencial corrente (novo start
    // fará nova emissão legítima; logout/fim de viagem revogam no backend).
    _trackingActive = false;
    _trackingModeCredential = false;
    _trackingScopeSig = null;
    _trackingCredentialMaxExpiresAtMs = 0;
    await _persist(LocationTrackingStatus.inactive, 0);
  }

  static Future<bool> _hasApproximateOnly() async {
    if (!Platform.isAndroid) return false;
    try {
      final accuracy = await Geolocator.getLocationAccuracy();
      return accuracy == LocationAccuracyStatus.reduced;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _persist(LocationTrackingStatus status, int activeTrips) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_statusKey, status.name);
    await prefs.setInt(_activeTripsKey, activeTrips);
    _setSnapshot(status, activeTrips);
  }

  static void _setSnapshot(LocationTrackingStatus status, int activeTrips) {
    snapshot.value = LocationTrackingSnapshot(
      status: status,
      activeTrips: activeTrips,
      message: _messageFor(status, activeTrips),
    );
  }

  static String _messageFor(LocationTrackingStatus status, int activeTrips) {
    switch (status) {
      case LocationTrackingStatus.active:
        return activeTrips > 1
            ? 'Compartilhamento ativo para $activeTrips viagens em andamento.'
            : 'Compartilhamento ativo durante a viagem em andamento.';
      case LocationTrackingStatus.awaitingPermission:
        return 'Permissao de localizacao aguardando confirmacao.';
      case LocationTrackingStatus.permissionDenied:
        return 'Permissao negada. O app segue utilizavel, mas o compartilhamento nao esta ativo.';
      case LocationTrackingStatus.deniedForever:
        return 'Permissao bloqueada nas configuracoes do Android.';
      case LocationTrackingStatus.approximateOnly:
        return 'A operacao exige localizacao precisa. Ajuste a permissao nas configuracoes do Android.';
      case LocationTrackingStatus.gpsDisabled:
        return 'Ative a localizacao do aparelho para compartilhar a viagem.';
      case LocationTrackingStatus.missingSession:
        return 'Sessao nao encontrada para iniciar o compartilhamento.';
      case LocationTrackingStatus.unsupported:
        return 'Compartilhamento disponivel apenas no app Android.';
      case LocationTrackingStatus.failed:
        return 'Localizacao interrompida. Tente ativar novamente.';
      case LocationTrackingStatus.inactive:
        return activeTrips > 0
            ? 'Compartilhamento nao esta ativo.'
            : 'Nao ha viagem em andamento.';
    }
  }
}
