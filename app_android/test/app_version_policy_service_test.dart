import 'dart:convert';

import 'package:chofer_log/services/app_version_policy_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response _json(int status, Object body) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

Map<String, dynamic> _policyBody({
  String minimum = '1.2.0',
  String recommended = '1.5.0',
  String latest = '1.8.0',
  String? severity,
}) =>
    {
      'platform': 'android',
      'minimum_supported_version': minimum,
      'recommended_version': recommended,
      'latest_version': latest,
      'store_url': 'https://play.google.com/store/apps/details?id=x',
      'release_notes': 'melhorias',
      'update_severity': severity,
    };

AppVersionPolicyService _service({
  required String currentVersion,
  required MockClient client,
}) =>
    AppVersionPolicyService(
      client: client,
      currentVersion: currentVersion,
      baseUrl: 'https://backend.test',
    );

void main() {
  group('AppVersionPolicyService.fetchPolicy — severidade local', () {
    test('required quando abaixo do mínimo', () async {
      final s = _service(
        currentVersion: '1.1.0',
        client: MockClient((_) async => _json(200, _policyBody())),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.required);
      expect(p.precisaAtualizarObrigatorio, isTrue);
    });

    test('recommended quando >= mínimo e < recomendado', () async {
      final s = _service(
        currentVersion: '1.3.0',
        client: MockClient((_) async => _json(200, _policyBody())),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.recommended);
    });

    test('optional quando >= recomendado e < latest', () async {
      final s = _service(
        currentVersion: '1.6.0',
        client: MockClient((_) async => _json(200, _policyBody())),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.optional);
    });

    test('none quando >= latest', () async {
      final s = _service(
        currentVersion: '1.8.0',
        client: MockClient((_) async => _json(200, _policyBody())),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.none);
    });

    test('recomputa localmente e ignora update_severity divergente do servidor',
        () async {
      // Servidor diz "none", mas 1.1.0 < mínimo 1.2.0 → app decide required.
      final s = _service(
        currentVersion: '1.1.0',
        client: MockClient(
          (_) async => _json(200, _policyBody(severity: 'none')),
        ),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.required);
    });
  });

  group('AppVersionPolicyService.fetchPolicy — fallback seguro', () {
    test('falha de rede → unknown (não bloqueia)', () async {
      final s = _service(
        currentVersion: '1.0.0',
        client: MockClient((_) async => throw Exception('offline')),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.unknown);
      expect(p.precisaAtualizarObrigatorio, isFalse);
    });

    test('status != 200 → unknown', () async {
      final s = _service(
        currentVersion: '1.0.0',
        client: MockClient((_) async => _json(500, {'error': 'x'})),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.unknown);
    });

    test('versão local não parseável (dev) → unknown sem chamar rede', () async {
      var chamou = false;
      final s = _service(
        currentVersion: 'dev',
        client: MockClient((_) async {
          chamou = true;
          return _json(200, _policyBody());
        }),
      );
      final p = await s.fetchPolicy();
      expect(p.severity, AppUpdateSeverity.unknown);
      expect(chamou, isFalse);
    });
  });

  group('severityFromServer', () {
    test('mapeia string do servidor', () {
      expect(
        AppVersionPolicyService.severityFromServer({'update_severity': 'required'}),
        AppUpdateSeverity.required,
      );
      expect(
        AppVersionPolicyService.severityFromServer({'update_severity': null}),
        AppUpdateSeverity.unknown,
      );
    });
  });
}
