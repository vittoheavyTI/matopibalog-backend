import 'dart:io';

import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

import 'api_service.dart';

enum LocationTrackingStartResult {
  started,
  unsupported,
  serviceDisabled,
  denied,
  deniedForever,
  missingSession,
  failed,
}

class LocationTrackingService {
  static const MethodChannel _channel =
      MethodChannel('br.com.matopibalog/location_tracking');

  static Future<LocationTrackingStartResult> startForTrip(
      String freteId) async {
    if (!Platform.isAndroid) {
      return LocationTrackingStartResult.unsupported;
    }

    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return LocationTrackingStartResult.serviceDisabled;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      return LocationTrackingStartResult.denied;
    }
    if (permission == LocationPermission.deniedForever) {
      return LocationTrackingStartResult.deniedForever;
    }

    final token = await ApiService.currentSessionToken();
    if (token == null || token.isEmpty) {
      return LocationTrackingStartResult.missingSession;
    }

    try {
      await _channel.invokeMethod('start', {
        'freteId': freteId,
        'token': token,
        'baseUrl': ApiService.baseUrl,
      });
      return LocationTrackingStartResult.started;
    } catch (_) {
      return LocationTrackingStartResult.failed;
    }
  }

  static Future<void> stop() async {
    if (!Platform.isAndroid) {
      return;
    }
    try {
      await _channel.invokeMethod('stop');
    } catch (_) {
      // Best-effort: o backend tambem rejeita viagem encerrada e o servico para.
    }
  }
}
