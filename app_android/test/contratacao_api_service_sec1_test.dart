import 'dart:convert';

import 'package:chofer_log/models/situacao_comercial.dart';
import 'package:chofer_log/services/api_service.dart';
import 'package:chofer_log/services/contratacao_api_service.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response _json(int status, Object body) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

MockClient _clientComRefresh({
  required String path,
  required Object successBody,
  required List<http.Request> seen,
  int authFailureStatus = 401,
}) {
  var endpointCalls = 0;

  return MockClient((request) async {
    seen.add(request);

    if (request.method == 'POST' &&
        request.url.path == '/auth/mobile/refresh') {
      return _json(200, {
        'token': 'access-new',
        'refresh_token': 'refresh-new',
      });
    }

    if (request.method == 'GET' && request.url.path == path) {
      endpointCalls += 1;
      if (endpointCalls == 1) {
        return _json(authFailureStatus, {'error': 'AccessExpired'});
      }
      return _json(200, successBody);
    }

    return _json(404, {'error': 'not_found'});
  });
}

Iterable<http.Request> _requestsTo(List<http.Request> seen, String path) =>
    seen.where((request) => request.url.path == path);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    ApiService.resetForTesting();
  });

  tearDown(ApiService.resetForTesting);

  test(
    'situacao comercial usa refresh SEC-1 e reexecuta GET uma vez',
    () async {
      final seen = <http.Request>[];
      ApiService.setHttpClientForTesting(
        _clientComRefresh(
          path: '/contratacao/situacao',
          seen: seen,
          successBody: {
            'aplicavel': true,
            'situacao': 'trial_ativo',
            'pode_operar': true,
            'pode_consultar': true,
            'acoes': {
              'operar_escrita': true,
              'consultar': true,
              'converter': false,
              'assinar_contrato': false,
              'regularizar': false,
            },
            'trial_ativo': true,
            'trial_expirado': false,
            'mensalidade': 299.9,
            'implantacao': 0,
            'implantacao_gratis': true,
            'contrato_obrigatorio': false,
          },
        ),
      );
      await ApiService.setSessionTokens(
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        persistence: SessionPersistence.persistent,
      );

      final situacao = await ContratacaoApiService.getSituacaoComercial();

      expect(situacao, isA<SituacaoComercial>());
      expect(situacao.situacao, 'trial_ativo');
      expect(situacao.podeOperar, isTrue);

      final comercialGets = _requestsTo(seen, '/contratacao/situacao').toList();
      final refreshes = _requestsTo(seen, '/auth/mobile/refresh').toList();
      expect(comercialGets, hasLength(2));
      expect(refreshes, hasLength(1));
      expect(comercialGets.first.headers['authorization'], 'Bearer access-old');
      expect(comercialGets.last.headers['authorization'], 'Bearer access-new');
      expect(jsonDecode(refreshes.single.body)['refresh_token'], 'refresh-old');
    },
  );

  test('status contratacao usa refresh SEC-1 e nao duplica refresh', () async {
    final seen = <http.Request>[];
    ApiService.setHttpClientForTesting(
      _clientComRefresh(
        path: '/contratacao/status',
        seen: seen,
        authFailureStatus: 403,
        successBody: {
          'pendencia_obrigatoria': true,
          'tem_contrato': true,
          'concluido': false,
        },
      ),
    );
    await ApiService.setSessionTokens(
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      persistence: SessionPersistence.persistent,
    );

    final status = await ContratacaoApiService.getStatusContratacao();

    expect(status['pendencia_obrigatoria'], isTrue);
    expect(status['tem_contrato'], isTrue);
    expect(status['concluido'], isFalse);

    final statusGets = _requestsTo(seen, '/contratacao/status').toList();
    final refreshes = _requestsTo(seen, '/auth/mobile/refresh').toList();
    expect(statusGets, hasLength(2));
    expect(refreshes, hasLength(1));
    expect(statusGets.first.headers['authorization'], 'Bearer access-old');
    expect(statusGets.last.headers['authorization'], 'Bearer access-new');
  });
}
