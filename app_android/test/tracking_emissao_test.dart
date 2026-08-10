import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:chofer_log/services/api_service.dart';

/// §B-1 (contrato) — emissão TRI-STATE da credencial de rastreamento:
///   404            → disabled (feature OFF: fallback legacy PERMITIDO)
///   201            → credential (com device binding no header)
///   5xx/409/403/…  → failed (fail-closed: NUNCA cair para o access token)
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const emissaoPath = '/fretes/localizacao/credencial';

  http.Client clienteQue(int status, {String? body, List<http.Request>? seen}) {
    return MockClient((request) async {
      seen?.add(request);
      if (request.url.path == emissaoPath) {
        return http.Response(body ?? '', status, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 200);
    });
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    ApiService.resetForTesting();
    ApiService.setDeviceIdForTesting('device-fixo-teste');
  });

  test('404 → disabled (feature OFF)', () async {
    ApiService.setHttpClientForTesting(clienteQue(404, body: '{"error":"tracking_disabled"}'));
    final r = await ApiService.issueTrackingCredential();
    expect(r.outcome, TrackingIssueOutcome.disabled);
    expect(r.credential, isNull);
  });

  test('201 → credential + envia X-Tracking-Device', () async {
    final seen = <http.Request>[];
    final body = jsonEncode({
      'credential': 'mtk1.abc',
      'expires_at': '2026-08-11T12:00:00.000Z',
      'max_expires_at': '2026-08-17T12:00:00.000Z',
    });
    ApiService.setHttpClientForTesting(clienteQue(201, body: body, seen: seen));
    final r = await ApiService.issueTrackingCredential();
    expect(r.outcome, TrackingIssueOutcome.credential);
    expect(r.credential!.credential, 'mtk1.abc');
    expect(r.credential!.expiresAtMs, greaterThan(0));
    expect(r.credential!.maxExpiresAtMs, greaterThan(r.credential!.expiresAtMs));
    final emissao = seen.firstWhere((req) => req.url.path == emissaoPath);
    expect(emissao.headers['X-Tracking-Device'], 'device-fixo-teste');
  });

  test('201 com credential vazio → failed (defensivo)', () async {
    ApiService.setHttpClientForTesting(clienteQue(201, body: jsonEncode({'credential': ''})));
    final r = await ApiService.issueTrackingCredential();
    expect(r.outcome, TrackingIssueOutcome.failed);
  });

  test('fail-closed: 500/409/403 → failed (nunca access token)', () async {
    for (final status in const [500, 502, 409, 403, 400]) {
      ApiService.setHttpClientForTesting(clienteQue(status, body: '{"error":"x"}'));
      final r = await ApiService.issueTrackingCredential();
      expect(r.outcome, TrackingIssueOutcome.failed, reason: 'status $status');
    }
  });
}
