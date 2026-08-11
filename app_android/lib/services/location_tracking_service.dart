import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';

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

  @visibleForTesting
  static void resetTrackingStateForTesting() {
    _trackingActive = false;
    _trackingModeCredential = false;
    _trackingScopeSig = null;
    _trackingCredentialMaxExpiresAtMs = 0;
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

  static Future<LocationTrackingStartResult> reconcileWithFretes(
    List<dynamic> fretes, {
    bool requestPermission = false,
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

  static Future<LocationTrackingStartResult> startForActiveTrips({
    int activeTrips = 1,
    bool requestPermission = false,
  }) async {
    return _startSession(
      activeTrips: activeTrips.clamp(1, 4),
      requestPermission: requestPermission,
    );
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
  }) {
    final prior = _startLock;
    final gate = Completer<void>();
    _startLock = gate.future;
    return prior.then((_) => _startSessionInner(
          activeTrips: activeTrips,
          requestPermission: requestPermission,
          scopeSignature: scopeSignature,
        )).whenComplete(gate.complete);
  }

  static Future<LocationTrackingStartResult> _startSessionInner({
    required int activeTrips,
    required bool requestPermission,
    String? scopeSignature,
  }) async {
    if (!Platform.isAndroid) {
      await _persist(LocationTrackingStatus.unsupported, activeTrips);
      return LocationTrackingStartResult.unsupported;
    }

    // BLOCKER-1: se o serviço nativo já está ativo em modo credencial, com o MESMO escopo
    // (mesmo conjunto de viagens) e a credencial vigente ainda longe do vencimento nominal,
    // NÃO re-emitir. O nativo já roda e se auto-renova (rotação CAS). Evita a enxurrada de
    // emissões por reconcile/resume/timer. scopeSignature=null (chamadas por contagem, sem
    // IDs) não reusa — mas o backend deduplica para 1 credencial ativa por session+device.
    if (shouldReuseCredential(
      active: _trackingActive,
      credentialMode: _trackingModeCredential,
      currentSig: _trackingScopeSig,
      requestedSig: scopeSignature,
      maxExpiresAtMs: _trackingCredentialMaxExpiresAtMs,
      nowMs: DateTime.now().millisecondsSinceEpoch,
    )) {
      await _persist(LocationTrackingStatus.active, activeTrips);
      return LocationTrackingStartResult.started;
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

    // SEC-1 (Opção C) — §B-1: emissão TRI-STATE da credencial escopada.
    final result = await ApiService.issueTrackingCredential();

    // FAIL-CLOSED: feature ON mas a emissão falhou → NÃO iniciar com o access token
    // (isso reintroduziria o bug: rastreamento morre quando o access expira). Marca
    // estado observável e permite retry (o reconcile tenta de novo no próximo ciclo).
    if (result.outcome == TrackingIssueOutcome.failed) {
      await _persist(LocationTrackingStatus.failed, activeTrips);
      return LocationTrackingStartResult.failed;
    }

    late final Map<String, dynamic> args;
    var startedInCredentialMode = false;
    var credentialMaxExpiresAtMs = 0;
    if (result.outcome == TrackingIssueOutcome.credential && result.credential != null) {
      final c = result.credential!;
      final deviceId = await ApiService.currentDeviceId();
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
      return LocationTrackingStartResult.started;
    } catch (_) {
      await ApiService.reportLocationTrackingState('interrompida');
      await _persist(LocationTrackingStatus.failed, activeTrips);
      return LocationTrackingStartResult.failed;
    }
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
