import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:chofer_log/providers/auth_provider.dart';
import 'package:chofer_log/services/api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _storage = FlutterSecureStorage();

Map<String, dynamic> _loginBody({
  String access = 'access-login',
  String refresh = 'refresh-login',
}) => {
  'token': access,
  'refresh_token': refresh,
  'user': {
    'uid': 'motorista-1',
    'nome': 'Motorista Teste',
    'role': 'motorista',
    'status': 'ativo',
    'foto_url': null,
    'empresa_tipo': 'autonomo',
    'senha_temporaria': false,
  },
};

Map<String, dynamic> _profileBody() => {
  'uid': 'motorista-1',
  'nome': 'Motorista Teste',
  'foto_url': null,
  'senha_temporaria': false,
  'termos_pendentes': false,
  'termos_pendentes_count': 0,
  'empresas': {'tipo': 'autonomo'},
};

http.Response _json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
);

MockClient _authClient({
  FutureOr<http.Response?> Function(http.Request request)? extra,
  List<http.Request>? seen,
}) {
  return MockClient((request) async {
    seen?.add(request);
    final extraResponse = await extra?.call(request);
    if (extraResponse != null) return extraResponse;

    if (request.method == 'POST' && request.url.path == '/auth/login') {
      return _json(200, _loginBody());
    }
    if (request.method == 'GET' && request.url.path == '/auth/me') {
      return _json(200, _profileBody());
    }
    if (request.method == 'POST' && request.url.path == '/auth/logout') {
      return _json(200, {'ok': true});
    }
    return _json(404, {'message': 'not found'});
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    ApiService.resetForTesting();
    AuthProvider.skipExternalSideEffectsForTesting = true;
  });

  tearDown(() {
    ApiService.resetForTesting();
    AuthProvider.skipExternalSideEffectsForTesting = false;
  });

  test('login persistente salva access e refresh no secure storage', () async {
    ApiService.setHttpClientForTesting(_authClient());

    final provider = AuthProvider();
    final ok = await provider.login(
      'm@test.local',
      'senha',
      manterConectado: true,
    );

    expect(ok, isTrue);
    expect(await _storage.read(key: 'token'), 'access-login');
    expect(await _storage.read(key: 'refresh_token'), 'refresh-login');
  });

  test('login memoryOnly nao persiste access nem refresh', () async {
    ApiService.setHttpClientForTesting(_authClient());

    final provider = AuthProvider();
    final ok = await provider.login(
      'm@test.local',
      'senha',
      manterConectado: false,
    );

    expect(ok, isTrue);
    expect(await ApiService.currentSessionToken(), 'access-login');
    expect(await ApiService.currentRefreshToken(), 'refresh-login');
    expect(await _storage.read(key: 'token'), isNull);
    expect(await _storage.read(key: 'refresh_token'), isNull);
  });

  test('refresh persistente salva os novos tokens', () async {
    ApiService.setHttpClientForTesting(
      _authClient(
        extra: (request) {
          if (request.method == 'POST' &&
              request.url.path == '/auth/mobile/refresh') {
            return _json(200, {
              'token': 'access-new',
              'refresh_token': 'refresh-new',
            });
          }
          return null;
        },
      ),
    );
    await ApiService.setSessionTokens(
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      persistence: SessionPersistence.persistent,
    );

    final result = await ApiService.refreshAccessTokenResult();

    expect(result.refreshed, isTrue);
    expect(await ApiService.currentSessionToken(), 'access-new');
    expect(await ApiService.currentRefreshToken(), 'refresh-new');
    expect(await _storage.read(key: 'token'), 'access-new');
    expect(await _storage.read(key: 'refresh_token'), 'refresh-new');
  });

  test('refresh memoryOnly atualiza memoria e mantem storage vazio', () async {
    ApiService.setHttpClientForTesting(
      _authClient(
        extra: (request) {
          if (request.method == 'POST' &&
              request.url.path == '/auth/mobile/refresh') {
            return _json(200, {
              'token': 'access-new',
              'refresh_token': 'refresh-new',
            });
          }
          return null;
        },
      ),
    );
    await ApiService.setSessionTokens(
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      persistence: SessionPersistence.memoryOnly,
    );

    final result = await ApiService.refreshAccessTokenResult();

    expect(result.refreshed, isTrue);
    expect(await ApiService.currentSessionToken(), 'access-new');
    expect(await ApiService.currentRefreshToken(), 'refresh-new');
    expect(await _storage.read(key: 'token'), isNull);
    expect(await _storage.read(key: 'refresh_token'), isNull);
  });

  test('restart apos memoryOnly nao faz auto-login', () async {
    ApiService.setHttpClientForTesting(_authClient());
    final provider = AuthProvider();
    expect(
      await provider.login('m@test.local', 'senha', manterConectado: false),
      isTrue,
    );

    ApiService.resetForTesting();
    final reaberto = AuthProvider();
    await reaberto.tryAutoLogin();

    expect(reaberto.status, AuthStatus.unauthenticated);
  });

  test('restart apos persistente restaura sessao', () async {
    ApiService.setHttpClientForTesting(_authClient());
    final provider = AuthProvider();
    expect(
      await provider.login('m@test.local', 'senha', manterConectado: true),
      isTrue,
    );

    ApiService.resetForTesting();
    ApiService.setHttpClientForTesting(_authClient());
    final reaberto = AuthProvider();
    await reaberto.tryAutoLogin();

    expect(reaberto.status, AuthStatus.authenticated);
    expect(reaberto.token, 'access-login');
  });

  test('logout tenta POST /auth/logout e limpa access/refresh', () async {
    final seen = <http.Request>[];
    ApiService.setHttpClientForTesting(_authClient(seen: seen));
    await ApiService.setSessionTokens(
      accessToken: 'access-logout',
      refreshToken: 'refresh-logout',
      persistence: SessionPersistence.persistent,
    );

    final provider = AuthProvider();
    await provider.logout();

    expect(
      seen.where((r) => r.method == 'POST' && r.url.path == '/auth/logout'),
      hasLength(1),
    );
    expect(
      seen
          .singleWhere(
            (r) => r.method == 'POST' && r.url.path == '/auth/logout',
          )
          .headers['authorization'],
      'Bearer access-logout',
    );
    expect(provider.ultimoLogoutRemoto?.confirmado, isTrue);
    expect(await ApiService.currentSessionToken(), isNull);
    expect(await ApiService.currentRefreshToken(), isNull);
    expect(await _storage.read(key: 'token'), isNull);
    expect(await _storage.read(key: 'refresh_token'), isNull);
  });

  test('logout offline limpa local sem crash', () async {
    ApiService.setHttpClientForTesting(
      MockClient((request) async {
        if (request.method == 'POST' && request.url.path == '/auth/logout') {
          throw TimeoutException('offline');
        }
        return _json(404, {});
      }),
    );
    await ApiService.setSessionTokens(
      accessToken: 'access-logout',
      refreshToken: 'refresh-logout',
      persistence: SessionPersistence.persistent,
    );

    final provider = AuthProvider();
    await provider.logout();

    expect(provider.ultimoLogoutRemoto?.confirmado, isFalse);
    expect(provider.ultimoLogoutRemoto?.transitorio, isTrue);
    expect(provider.status, AuthStatus.unauthenticated);
    expect(await _storage.read(key: 'token'), isNull);
    expect(await _storage.read(key: 'refresh_token'), isNull);
  });

  test(
    'refresh single-flight concorrente faz um POST /auth/mobile/refresh',
    () async {
      var refreshCalls = 0;
      ApiService.setHttpClientForTesting(
        _authClient(
          extra: (request) async {
            if (request.method == 'POST' &&
                request.url.path == '/auth/mobile/refresh') {
              refreshCalls++;
              await Future<void>.delayed(const Duration(milliseconds: 20));
              return _json(200, {
                'token': 'access-new',
                'refresh_token': 'refresh-new',
              });
            }
            return null;
          },
        ),
      );
      await ApiService.setSessionTokens(
        accessToken: 'access-old',
        refreshToken: 'refresh-old',
        persistence: SessionPersistence.persistent,
      );

      final results = await Future.wait(
        List.generate(5, (_) => ApiService.refreshAccessTokenResult()),
      );

      expect(results.every((result) => result.refreshed), isTrue);
      expect(refreshCalls, 1);
    },
  );

  test('refresh invalido definitivo encerra sessao sem loop', () async {
    var refreshCalls = 0;
    ApiService.setHttpClientForTesting(
      _authClient(
        extra: (request) {
          if (request.method == 'POST' &&
              request.url.path == '/auth/mobile/refresh') {
            refreshCalls++;
            return _json(401, {'message': 'refresh invalid'});
          }
          return null;
        },
      ),
    );
    await ApiService.setSessionTokens(
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      persistence: SessionPersistence.persistent,
    );

    final result = await ApiService.refreshAccessTokenResult();

    expect(result.shouldEndSession, isTrue);
    expect(refreshCalls, 1);
    expect(await ApiService.currentSessionToken(), isNull);
    expect(await ApiService.currentRefreshToken(), isNull);
    expect(await _storage.read(key: 'token'), isNull);
    expect(await _storage.read(key: 'refresh_token'), isNull);
  });

  test('refresh transitorio nao encerra sessao nem regrava tokens', () async {
    var refreshCalls = 0;
    ApiService.setHttpClientForTesting(
      _authClient(
        extra: (request) {
          if (request.method == 'POST' &&
              request.url.path == '/auth/mobile/refresh') {
            refreshCalls++;
            return _json(503, {'message': 'temporarily unavailable'});
          }
          return null;
        },
      ),
    );
    await ApiService.setSessionTokens(
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      persistence: SessionPersistence.persistent,
    );

    final result = await ApiService.refreshAccessTokenResult();

    expect(result.isTransient, isTrue);
    expect(refreshCalls, 1);
    expect(await ApiService.currentSessionToken(), 'access-old');
    expect(await ApiService.currentRefreshToken(), 'refresh-old');
    expect(await _storage.read(key: 'token'), 'access-old');
    expect(await _storage.read(key: 'refresh_token'), 'refresh-old');
  });
}
