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
    final activeTrips = _countActiveTrips(fretes);
    if (activeTrips == 0) {
      await stop();
      return LocationTrackingStartResult.started;
    }

    final result = await _startSession(
      activeTrips: activeTrips,
      requestPermission: requestPermission,
    );
    return result;
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

  static Future<LocationTrackingStartResult> _startSession({
    required int activeTrips,
    required bool requestPermission,
  }) async {
    if (!Platform.isAndroid) {
      await _persist(LocationTrackingStatus.unsupported, activeTrips);
      return LocationTrackingStartResult.unsupported;
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

    try {
      await _channel.invokeMethod('start', {
        'token': token,
        'baseUrl': ApiService.baseUrl,
      });
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

  static int _countActiveTrips(List<dynamic> fretes) {
    final ids = <String>{};
    for (final frete in fretes) {
      if (frete is! Map) continue;
      final status = (frete['status'] ?? '').toString();
      final id = frete['id']?.toString();
      if (id != null && id.isNotEmpty && _activeStatuses.contains(status)) {
        ids.add(id);
      }
    }
    return ids.length.clamp(0, 4);
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
