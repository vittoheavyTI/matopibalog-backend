import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/api_service.dart';

/// SEC-1 hardening do contrato de login mobile. Predicados PUROS (sem plataforma
/// nem HTTP), derivados do laudo forense da sessão client_type=web em UA Dart:
///  - o app só aceita sessão mobile com resolved_client_type esperado + refresh não vazio;
///  - o login carrega device binding (device_id/device_label);
///  - sem refresh novo, o refresh persistido antigo deve ser apagado (não ressuscitado).
void main() {
  group('isHealthyMobileLoginResponse (fail-closed)', () {
    test('android-shaped (resolved=android + refresh não vazio) → aceita', () {
      final resp = {
        'token': 'access',
        'refresh_token': 'r-mobile',
        'resolved_client_type': 'android',
        'user': {'role': 'motorista'},
      };
      expect(
        ApiService.isHealthyMobileLoginResponse(resp, expectedClientType: 'android'),
        isTrue,
      );
    });

    test('web-shaped (sem refresh_token) → rejeita', () {
      final resp = {'token': 'access', 'resolved_client_type': 'web'};
      expect(
        ApiService.isHealthyMobileLoginResponse(resp, expectedClientType: 'android'),
        isFalse,
      );
    });

    test('resolved_client_type=web mesmo com refresh → rejeita', () {
      final resp = {
        'token': 'access',
        'refresh_token': 'r',
        'resolved_client_type': 'web',
      };
      expect(
        ApiService.isHealthyMobileLoginResponse(resp, expectedClientType: 'android'),
        isFalse,
      );
    });

    test('resolved_client_type ausente (backend antigo) → rejeita (fail-closed)', () {
      final resp = {'token': 'access', 'refresh_token': 'r'};
      expect(
        ApiService.isHealthyMobileLoginResponse(resp, expectedClientType: 'android'),
        isFalse,
      );
    });

    test('refresh_token vazio/whitespace → rejeita', () {
      for (final r in ['', '   ']) {
        final resp = {
          'token': 'access',
          'refresh_token': r,
          'resolved_client_type': 'android',
        };
        expect(
          ApiService.isHealthyMobileLoginResponse(resp, expectedClientType: 'android'),
          isFalse,
        );
      }
    });
  });

  group('montarLoginBody (device binding)', () {
    test('inclui client_type, device_id e device_label', () {
      final body = ApiService.montarLoginBody(
        email: 'a@b.com',
        senha: 'segredo',
        clientType: 'android',
        deviceId: 'dev-abc',
        deviceLabel: 'android 14',
      );
      expect(body['client_type'], 'android');
      expect(body['device_id'], 'dev-abc');
      expect(body['device_label'], 'android 14');
      expect(body['email'], 'a@b.com');
      // binding sempre presente (o achado forense mostrou device_id ausente).
      expect(body.containsKey('device_id'), isTrue);
    });
  });

  group('deveApagarRefreshPersistido (stale refresh)', () {
    test('persistente + refresh novo null → apaga o antigo', () {
      expect(
        ApiService.deveApagarRefreshPersistido(persistent: true, novoRefresh: null),
        isTrue,
      );
    });

    test('persistente + refresh novo vazio → apaga o antigo', () {
      expect(
        ApiService.deveApagarRefreshPersistido(persistent: true, novoRefresh: ''),
        isTrue,
      );
    });

    test('persistente + refresh novo válido → mantém (grava o novo)', () {
      expect(
        ApiService.deveApagarRefreshPersistido(persistent: true, novoRefresh: 'r-novo'),
        isFalse,
      );
    });

    test('não persistente → predicado do ramo persistente não dispara', () {
      expect(
        ApiService.deveApagarRefreshPersistido(persistent: false, novoRefresh: null),
        isFalse,
      );
    });
  });
}
