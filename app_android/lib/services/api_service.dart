import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../models/plano_publico.dart';
import '../models/fatura.dart';
import 'app_logger.dart';

/// Erro de carregamento (GET) com mensagem já pronta para o usuário. Serve para
/// o caminho da Home distinguir "erro real" (403/500/rede/timeout) de "lista
/// vazia legítima" (200 com []). Não substitui o retorno [] dos GETs de listas
/// que devem degradar silenciosamente — só é lançado onde a Home precisa saber.
class ApiException implements Exception {
  final String message;
  final int? statusCode;
  const ApiException(this.message, {this.statusCode});
  @override
  String toString() => message;
}

enum SessionPersistence { persistent, memoryOnly }

enum RefreshFailureKind {
  none,
  noRefreshToken,
  definitive,
  transient,
  invalidResponse,
}

class AuthRefreshResult {
  final bool refreshed;
  final Map<String, dynamic>? data;
  final int status;
  final RefreshFailureKind failureKind;

  const AuthRefreshResult._({
    required this.refreshed,
    required this.data,
    required this.status,
    required this.failureKind,
  });

  const AuthRefreshResult.refreshed(Map<String, dynamic> data)
    : this._(
        refreshed: true,
        data: data,
        status: 200,
        failureKind: RefreshFailureKind.none,
      );

  const AuthRefreshResult.failed({
    required int status,
    required RefreshFailureKind failureKind,
  }) : this._(
         refreshed: false,
         data: null,
         status: status,
         failureKind: failureKind,
       );

  bool get shouldEndSession => failureKind == RefreshFailureKind.definitive;
  bool get isTransient => failureKind == RefreshFailureKind.transient;
}

class LogoutRemotoResult {
  final bool confirmado;
  final int status;
  final bool transitorio;

  const LogoutRemotoResult({
    required this.confirmado,
    required this.status,
    required this.transitorio,
  });
}

class ApiService {
  static const String _baseUrl = Config.apiBaseUrl;

  /// Detecta o Content-Type da imagem pela extensão do arquivo. O backend só
  /// aceita JPEG, PNG e WebP; retorna null para qualquer outra extensão (ou
  /// caminho sem extensão), permitindo abortar o envio antes do POST.
  /// Sem isto, http.MultipartFile.fromPath usa application/octet-stream por
  /// padrão (o pacote http NÃO infere o MIME), e o backend rejeita com
  /// "Formato de arquivo não permitido".
  static MediaType? _contentTypeImagem(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return MediaType('image', 'jpeg');
    }
    if (lower.endsWith('.png')) return MediaType('image', 'png');
    if (lower.endsWith('.webp')) return MediaType('image', 'webp');
    return null;
  }

  /// Content-Type para DOCUMENTOS de frete (PDF, XML ou imagem). O backend
  /// aceita application/pdf, application/xml, e imagens JPEG/PNG/WebP. Retorna
  /// null para extensão fora da allowlist (aborta antes do POST). O pacote http
  /// NÃO infere o MIME, então definimos aqui pela extensão.
  static MediaType? _contentTypeDocumento(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.pdf')) return MediaType('application', 'pdf');
    if (lower.endsWith('.xml')) return MediaType('application', 'xml');
    return _contentTypeImagem(path);
  }

  /// Chave do token no secure storage — deve casar com AuthProvider._tokenKey.
  static const _tokenKey = 'token';
  static const _refreshTokenKey = 'refresh_token';
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();

  /// Token JWT da sessão atual, mantido em memória.
  /// A persistência segura (quando o usuário marca "Manter conectado neste
  /// aparelho") é responsabilidade do AuthProvider, via flutter_secure_storage.
  static String? _sessionToken;
  static String? _refreshToken;
  static SessionPersistence _sessionPersistence = SessionPersistence.memoryOnly;
  static Future<AuthRefreshResult>? _refreshInFlight;
  static http.Client _httpClient = http.Client();

  // Timeouts de rede. Sem eles, requisições em conexões lentas (4G/5G fraco) ou
  // com o backend "frio" (cold start do Railway) ficavam penduradas
  // indefinidamente — spinner infinito e lançamentos sem retorno. Valores
  // generosos para absorver cold start, mas finitos para sempre dar feedback.
  static const Duration _timeoutGet = Duration(seconds: 30);
  static const Duration _timeoutPostJson = Duration(seconds: 35);
  static const Duration _timeoutUpload = Duration(seconds: 60);
  static const Duration _planosCacheTtl = Duration(hours: 6);
  static const Duration _planosCacheMaxAge = Duration(days: 7);
  static const String _planosCacheKey = 'planos_publicos_cache';
  static const String _planosCacheAtKey = 'planos_publicos_cache_at';

  /// Converte exceções de rede em mensagem amigável ao usuário (sem vazar stack).
  /// TimeoutException → servidor lento; demais (SocketException, ClientException,
  /// HandshakeException) → falha de conexão.
  static String _mensagemErroRede(Object e) {
    if (e is TimeoutException) {
      // Todos os call sites deste helper são POST/upload (envios). No timeout, a
      // escrita PODE ter chegado ao servidor — sugerir "tente novamente" levaria a
      // reenvio cego e duplicata. Orientamos a conferir a lista antes de repetir.
      return 'O envio demorou mais que o esperado. Ele pode ter sido concluído — '
          'verifique a lista antes de tentar novamente.';
    }
    return 'Não foi possível conectar ao servidor. Verifique sua internet.';
  }

  /// Mensagem amigável para falha HTTP num GET de carregamento. Quando o backend
  /// envia mensagem clara (ex.: plano vencido/bloqueio em 403), ela é exibida;
  /// caso contrário, mensagem genérica de "tente novamente".
  static String _mensagemErroHttpGet(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) {
        final msg = decoded['message'] ?? decoded['error'];
        if (msg is String && msg.trim().isNotEmpty) return msg.trim();
      }
    } catch (_) {
      /* body não-JSON: usa mensagem genérica */
    }
    return 'Não foi possível carregar seus dados agora. Tente novamente em instantes.';
  }

  /// Define o token usado nas requisições autenticadas da sessão atual.
  static void setSessionToken(String token) => _sessionToken = token;
  static void setRefreshToken(String token) => _refreshToken = token;

  static void setSessionPersistence(SessionPersistence persistence) {
    _sessionPersistence = persistence;
  }

  static Future<void> setSessionTokens({
    required String accessToken,
    String? refreshToken,
    required SessionPersistence persistence,
  }) async {
    _sessionToken = accessToken;
    _refreshToken = refreshToken;
    _sessionPersistence = persistence;

    if (persistence == SessionPersistence.persistent) {
      await _secureStorage.write(key: _tokenKey, value: accessToken);
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _secureStorage.write(key: _refreshTokenKey, value: refreshToken);
      }
    } else {
      await _secureStorage.delete(key: _tokenKey);
      await _secureStorage.delete(key: _refreshTokenKey);
    }
  }

  static Future<void> clearPersistedSession() async {
    clearSessionToken();
    await _secureStorage.delete(key: _tokenKey);
    await _secureStorage.delete(key: _refreshTokenKey);
  }

  @visibleForTesting
  static void setHttpClientForTesting(http.Client client) {
    _httpClient = client;
  }

  @visibleForTesting
  static void resetForTesting() {
    _sessionToken = null;
    _refreshToken = null;
    _refreshInFlight = null;
    _sessionPersistence = SessionPersistence.memoryOnly;
    _httpClient = http.Client();
  }

  static String get baseUrl => _baseUrl;

  static Future<String?> currentSessionToken() async {
    var token = _sessionToken;
    if (token == null || token.isEmpty) {
      token = await _secureStorage.read(key: _tokenKey);
      if (token != null && token.isNotEmpty) {
        _sessionToken = token;
        _sessionPersistence = SessionPersistence.persistent;
      }
    }
    return token;
  }

  /// Limpa o token em memória (logout ou falha de auto-login).
  static void clearSessionToken() {
    _sessionToken = null;
    _refreshToken = null;
    _refreshInFlight = null;
    _sessionPersistence = SessionPersistence.memoryOnly;
  }

  static Future<String?> currentRefreshToken() async {
    var token = _refreshToken;
    if (token == null || token.isEmpty) {
      token = await _secureStorage.read(key: _refreshTokenKey);
      if (token != null && token.isNotEmpty) {
        _refreshToken = token;
        _sessionPersistence = SessionPersistence.persistent;
      }
    }
    return token;
  }

  // Mantido como Future para não alterar os ~15 call sites que fazem
  // `await _getHeaders()`.
  //
  // Fonte do token, em ordem:
  // 1. _sessionToken em memória (foreground / sessão já autenticada);
  // 2. fallback no secure storage quando a memória está vazia.
  //
  // O fallback é essencial para o sync offline: o callbackDispatcher do
  // Workmanager roda em OUTRO isolate, onde os estáticos (_sessionToken)
  // nascem null. Sem isso, as requisições de OfflineSync iriam sem
  // Authorization e tomariam 401. O secure storage é acessível entre
  // isolates (backed por Keystore/EncryptedSharedPreferences no Android),
  // então recuperamos o token persistido quando "Manter conectado" está
  // marcado. Se o usuário não persistiu a sessão, não há token e a
  // requisição segue sem Authorization (comportamento aceitável). Sessões
  // memoryOnly não viram persistentes para sustentar tarefas em background.
  static Future<Map<String, String>> _getHeaders() async {
    final token = await currentSessionToken();
    return {
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  static bool _isAuthResponse(int status) => status == 401 || status == 403;
  static bool _isDefinitiveRefreshFailure(int status) =>
      status == 400 || status == 401 || status == 403 || status == 409;
  static bool _isTransientRefreshFailure(int status) =>
      status == 0 || status == 408 || status == 429 || status >= 500;

  static Future<http.Response> _sendJsonRequest(
    String method,
    Uri uri,
    Map<String, String> headers, {
    Object? body,
    Duration timeout = _timeoutGet,
  }) {
    final upperMethod = method.toUpperCase();
    final encodedBody = body == null ? null : jsonEncode(body);
    Future<http.Response> request;
    switch (upperMethod) {
      case 'GET':
        request = _httpClient.get(uri, headers: headers);
        break;
      case 'POST':
        request = _httpClient.post(uri, headers: headers, body: encodedBody);
        break;
      case 'PATCH':
        request = _httpClient.patch(uri, headers: headers, body: encodedBody);
        break;
      case 'DELETE':
        request = _httpClient.delete(uri, headers: headers, body: encodedBody);
        break;
      default:
        final fallback = http.Request(upperMethod, uri)
          ..headers.addAll(headers);
        request = _httpClient.send(fallback).then(http.Response.fromStream);
    }
    return request.timeout(timeout);
  }

  static Future<http.Response> _authenticatedJsonRequest(
    String method,
    Uri uri, {
    Object? body,
    Duration timeout = _timeoutGet,
    bool retryAfterAuthResponse = false,
  }) async {
    final upperMethod = method.toUpperCase();
    final safeReadRetry =
        upperMethod == 'GET' ||
        upperMethod == 'HEAD' ||
        upperMethod == 'OPTIONS';
    final canRetryAfterAuthResponse = safeReadRetry || retryAfterAuthResponse;

    final response = await _sendJsonRequest(
      upperMethod,
      uri,
      await _getHeaders(),
      body: body,
      timeout: timeout,
    );
    if (!_isAuthResponse(response.statusCode) || !canRetryAfterAuthResponse) {
      return response;
    }

    final refresh = await refreshAccessTokenResult();
    if (!refresh.refreshed) return response;

    return _sendJsonRequest(
      upperMethod,
      uri,
      await _getHeaders(),
      body: body,
      timeout: timeout,
    );
  }

  static Future<http.Response> _getAutenticado(
    Uri uri, {
    Duration timeout = _timeoutGet,
  }) => _authenticatedJsonRequest('GET', uri, timeout: timeout);

  static Future<http.Response> _postJsonAutenticado(
    Uri uri, {
    Object? body,
    Duration timeout = _timeoutPostJson,
    bool retryAfterAuthResponse = false,
  }) => _authenticatedJsonRequest(
    'POST',
    uri,
    body: body,
    timeout: timeout,
    retryAfterAuthResponse: retryAfterAuthResponse,
  );

  static Future<http.Response> _patchJsonAutenticado(
    Uri uri, {
    Object? body,
    Duration timeout = _timeoutPostJson,
    bool retryAfterAuthResponse = false,
  }) => _authenticatedJsonRequest(
    'PATCH',
    uri,
    body: body,
    timeout: timeout,
    retryAfterAuthResponse: retryAfterAuthResponse,
  );

  static Future<http.Response> _deleteJsonAutenticado(
    Uri uri, {
    Object? body,
    Duration timeout = _timeoutPostJson,
    bool retryAfterAuthResponse = false,
  }) => _authenticatedJsonRequest(
    'DELETE',
    uri,
    body: body,
    timeout: timeout,
    retryAfterAuthResponse: retryAfterAuthResponse,
  );

  // AUTH
  static Future<Map<String, dynamic>?> login(String email, String senha) async {
    AppLogger.action('login_attempt', params: {'email': email});
    try {
      final response = await _httpClient
          .post(
            Uri.parse('$_baseUrl/auth/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'email': email,
              'senha': senha,
              'client_type': Platform.isIOS ? 'ios' : 'android',
            }),
          )
          .timeout(const Duration(seconds: 20));

      // NÃO logar response.body: em sucesso ele contém o token JWT.
      // Só o body de erro (statusCode != 200) é logado, para diagnóstico.
      if (response.statusCode != 200) {
        debugPrint(
          '[ApiService.login] status=${response.statusCode} body=${response.body}',
        );
      } else {
        debugPrint('[ApiService.login] status=${response.statusCode} (ok)');
      }

      if (response.statusCode == 200) {
        AppLogger.action('login_success', params: {'email': email});
        return jsonDecode(response.body);
      }
      AppLogger.action(
        'login_error',
        params: {'email': email, 'status': response.statusCode},
      );
      // Retorna o body para o provider poder extrair a mensagem de erro
      return {
        '_error': true,
        '_status': response.statusCode,
        '_body': response.body,
      };
    } catch (e) {
      debugPrint('[ApiService.login] exception type: ${e.runtimeType}');
      debugPrint('[ApiService.login] exception: $e');
      AppLogger.action(
        'login_error',
        params: {
          'email': email,
          'tipo': e.runtimeType.toString(),
          'error': e.toString(),
        },
      );
      return {'_error': true, '_status': 0, '_body': e.toString()};
    }
  }

  static Future<List<PlanoPublico>> getPlanosPublicos({
    String? categoria,
  }) async {
    final filtro = (categoria != null && categoria.trim().isNotEmpty)
        ? categoria.trim()
        : '';
    // Cache segmentado por categoria: o catálogo do autônomo difere do geral.
    final cacheKey = filtro.isEmpty
        ? _planosCacheKey
        : '${_planosCacheKey}_$filtro';
    final cacheAtKey = filtro.isEmpty
        ? _planosCacheAtKey
        : '${_planosCacheAtKey}_$filtro';
    final prefs = await SharedPreferences.getInstance();
    final agora = DateTime.now();
    final cacheRaw = prefs.getString(cacheKey);
    final cacheAtRaw = prefs.getInt(cacheAtKey);
    List<PlanoPublico>? cache;
    Duration? cacheAge;

    if (cacheRaw != null && cacheAtRaw != null) {
      try {
        final decoded = jsonDecode(cacheRaw);
        if (decoded is List) {
          cache = decoded
              .whereType<Map>()
              .map(
                (item) =>
                    PlanoPublico.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((plano) => plano.id.isNotEmpty)
              .toList();
          cacheAge = agora.difference(
            DateTime.fromMillisecondsSinceEpoch(cacheAtRaw),
          );
        }
      } catch (_) {
        cache = null;
        cacheAge = null;
      }
    }

    if (cache != null &&
        cacheAge != null &&
        !cacheAge.isNegative &&
        cacheAge <= _planosCacheTtl) {
      return cache;
    }

    try {
      final response = await http
          .get(
            Uri.parse(
              '$_baseUrl/planos/publicos${filtro.isEmpty ? '' : '?categoria=$filtro'}',
            ),
            headers: {'Content-Type': 'application/json'},
          )
          .timeout(_timeoutGet);

      if (response.statusCode != 200) {
        throw Exception('Catálogo indisponível (${response.statusCode}).');
      }

      final decoded = jsonDecode(response.body);
      final planosRaw = decoded is Map<String, dynamic>
          ? decoded['planos']
          : null;
      if (planosRaw is! List) {
        throw Exception('Resposta inválida do catálogo de planos.');
      }

      final planos = planosRaw
          .whereType<Map>()
          .map((item) => PlanoPublico.fromJson(Map<String, dynamic>.from(item)))
          .where((plano) => plano.id.isNotEmpty)
          .toList();

      await prefs.setString(
        cacheKey,
        jsonEncode(planos.map((plano) => plano.toJson()).toList()),
      );
      await prefs.setInt(cacheAtKey, agora.millisecondsSinceEpoch);
      return planos;
    } catch (_) {
      if (cache != null &&
          cacheAge != null &&
          !cacheAge.isNegative &&
          cacheAge <= _planosCacheMaxAge) {
        return cache;
      }
      throw Exception(
        'Não foi possível carregar os planos. Verifique sua internet.',
      );
    }
  }

  /// Cadastra o motorista. Retorna { 'ok': bool, 'message': String? }.
  /// Em erro (400/409/500), 'message' traz a mensagem específica do backend
  /// (e-mail/CPF já cadastrado, código inválido, etc.) para a tela exibir; em
  /// falha de rede, uma mensagem amigável genérica.
  static Future<Map<String, dynamic>> register(
    Map<String, dynamic> data, {
    String? planoId,
  }) async {
    try {
      final payload = Map<String, dynamic>.from(data);
      final codigoConvite = payload['codigo_convite']?.toString().trim() ?? '';
      final planoSelecionado = planoId?.trim() ?? '';

      if (codigoConvite.isEmpty && planoSelecionado.isNotEmpty) {
        payload['plano_id'] = planoSelecionado;
      } else {
        // Defesa adicional: motorista vinculado sempre usa o plano da empresa.
        payload.remove('plano_id');
      }

      final response = await http
          .post(
            Uri.parse('$_baseUrl/auth/register'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(payload),
          )
          .timeout(_timeoutPostJson);

      if (response.statusCode == 201) {
        // 'administrador' vem só no fluxo "autônomo com administrador":
        // { criado: bool, email?, senha_temporaria?, motivo? }. A tela de
        // boas-vindas usa esse objeto para exibir a senha uma vez ou o motivo.
        Map<String, dynamic>? administrador;
        try {
          final decoded = jsonDecode(response.body);
          if (decoded is Map && decoded['administrador'] is Map) {
            administrador = Map<String, dynamic>.from(
              decoded['administrador'] as Map,
            );
          }
        } catch (_) {
          /* body não-JSON ou sem admin */
        }
        return {
          'ok': true,
          if (administrador != null) 'administrador': administrador,
        };
      }

      String? mensagem;
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map && decoded['message'] is String) {
          mensagem = (decoded['message'] as String).trim();
        }
      } catch (_) {
        /* body não-JSON */
      }
      return {
        'ok': false,
        'message': (mensagem != null && mensagem.isNotEmpty)
            ? mensagem
            : 'Não foi possível concluir o cadastro. Tente novamente em instantes.',
      };
    } catch (e) {
      return {
        'ok': false,
        'message':
            'Não foi possível concluir o cadastro. Tente novamente em instantes.',
      };
    }
  }

  static Future<bool> esqueceuSenha(String email) async {
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/auth/esqueceu-senha'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email}),
          )
          .timeout(_timeoutPostJson);
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  /// Reenvia o e-mail de confirmação de cadastro. O backend responde sempre de
  /// forma genérica (não revela se o e-mail existe / há cadastro pendente).
  /// Retorna true em 200.
  static Future<bool> reenviarConfirmacao(String email) async {
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/auth/reenviar-confirmacao'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email}),
          )
          .timeout(_timeoutPostJson);
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  static Future<AuthRefreshResult> refreshAccessTokenResult() {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight;

    final future = _refreshAccessTokenOnce();
    _refreshInFlight = future;
    return future.whenComplete(() {
      if (identical(_refreshInFlight, future)) {
        _refreshInFlight = null;
      }
    });
  }

  static Future<AuthRefreshResult> _refreshAccessTokenOnce() async {
    final refresh = await currentRefreshToken();
    if (refresh == null || refresh.isEmpty) {
      return const AuthRefreshResult.failed(
        status: 0,
        failureKind: RefreshFailureKind.noRefreshToken,
      );
    }

    try {
      final response = await _httpClient
          .post(
            Uri.parse('$_baseUrl/auth/mobile/refresh'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'refresh_token': refresh}),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api(
        'ApiService',
        'POST /auth/mobile/refresh',
        response.statusCode,
      );

      if (response.statusCode == 200) {
        final decoded = Map<String, dynamic>.from(
          jsonDecode(response.body) as Map,
        );
        final token = decoded['token'] as String?;
        final novoRefresh = decoded['refresh_token'] as String?;
        if (token != null &&
            token.isNotEmpty &&
            novoRefresh != null &&
            novoRefresh.isNotEmpty) {
          await setSessionTokens(
            accessToken: token,
            refreshToken: novoRefresh,
            persistence: _sessionPersistence,
          );
          return AuthRefreshResult.refreshed(decoded);
        }
        return const AuthRefreshResult.failed(
          status: 200,
          failureKind: RefreshFailureKind.invalidResponse,
        );
      }

      if (_isDefinitiveRefreshFailure(response.statusCode)) {
        await clearPersistedSession();
        return AuthRefreshResult.failed(
          status: response.statusCode,
          failureKind: RefreshFailureKind.definitive,
        );
      }

      return AuthRefreshResult.failed(
        status: response.statusCode,
        failureKind: _isTransientRefreshFailure(response.statusCode)
            ? RefreshFailureKind.transient
            : RefreshFailureKind.invalidResponse,
      );
    } catch (e) {
      AppLogger.error('ApiService', 'POST /auth/mobile/refresh exception', e);
      return const AuthRefreshResult.failed(
        status: 0,
        failureKind: RefreshFailureKind.transient,
      );
    }
  }

  static Future<Map<String, dynamic>?> refreshAccessToken() async {
    final result = await refreshAccessTokenResult();
    return result.refreshed ? result.data : null;
  }

  static Future<LogoutRemotoResult> logoutRemoto() async {
    final token = await currentSessionToken();
    if (token == null || token.isEmpty) {
      return const LogoutRemotoResult(
        confirmado: false,
        status: 0,
        transitorio: false,
      );
    }

    try {
      final response = await _httpClient
          .post(
            Uri.parse('$_baseUrl/auth/logout'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(_timeoutPostJson);
      AppLogger.api('ApiService', 'POST /auth/logout', response.statusCode);
      return LogoutRemotoResult(
        confirmado: response.statusCode == 200,
        status: response.statusCode,
        transitorio:
            response.statusCode == 408 ||
            response.statusCode == 429 ||
            response.statusCode >= 500,
      );
    } catch (e) {
      AppLogger.error('ApiService', 'POST /auth/logout exception', e);
      return const LogoutRemotoResult(
        confirmado: false,
        status: 0,
        transitorio: true,
      );
    }
  }

  static Future<Map<String, dynamic>> trocarSenha(String novaSenha) async {
    try {
      final response = await _postJsonAutenticado(
        Uri.parse('$_baseUrl/auth/trocar-senha'),
        body: {'nova_senha': novaSenha},
        timeout: const Duration(seconds: 20),
        retryAfterAuthResponse: true,
      );

      AppLogger.api(
        'ApiService',
        'POST /auth/trocar-senha',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        return {'ok': true};
      }
      final body = jsonDecode(response.body);
      return {
        'ok': false,
        'message': body['message'] ?? 'Erro ao trocar senha.',
      };
    } catch (e) {
      AppLogger.error('ApiService', 'POST /auth/trocar-senha exception', e);
      return {'ok': false, 'message': 'Erro de conexão.'};
    }
  }

  /// Como [getMe], mas devolve também o status HTTP para o chamador decidir se a
  /// falha é TRANSITÓRIA (429/5xx/rede) — caso em que a sessão NÃO deve ser
  /// descartada — ou definitiva (401/403 = token inválido/expirado).
  /// `status`: 200 sucesso · 0 exceção de rede/timeout · demais = HTTP recebido.
  static Future<({Map<String, dynamic>? profile, int status})>
  getMeDetalhado() async {
    try {
      final response = await _getAutenticado(Uri.parse('$_baseUrl/auth/me'));
      AppLogger.api('ApiService', 'GET /auth/me', response.statusCode);
      if (response.statusCode == 200) {
        return (
          profile: jsonDecode(response.body) as Map<String, dynamic>,
          status: 200,
        );
      }
      return (profile: null, status: response.statusCode);
    } catch (e) {
      AppLogger.error('ApiService', 'GET /auth/me exception', e);
      return (profile: null, status: 0);
    }
  }

  /// Perfil do usuário logado, ou null em qualquer falha (contrato preservado
  /// para os chamadores que só precisam do perfil). Quem precisa distinguir a
  /// causa da falha (ex.: auto-login) deve usar [getMeDetalhado].
  static Future<Map<String, dynamic>?> getMe() async =>
      (await getMeDetalhado()).profile;

  /// Estado read-only do plano para orientar o app. Não retorna faturas,
  /// dados Asaas ou credenciais; somente status e responsável.
  static Future<Map<String, dynamic>?> getPlanoStatus() async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/pagamentos/me/plano-status'),
      );
      if (response.statusCode == 200) return jsonDecode(response.body);
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Faturas da PRÓPRIA empresa (read-only), para o app do autônomo. Consome
  /// GET /pagamentos/me/faturas (tenant-scoped no backend; liberado só a
  /// empresa.tipo='autonomo' — vinculado recebe 403 com mensagem clara). NÃO
  /// cria/sincroniza nada. Em falha (403/500/rede/timeout) LANÇA ApiException
  /// para a tela distinguir erro de lista vazia; 200 com [] retorna [].
  static Future<List<Fatura>> getMinhasFaturas() async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/pagamentos/me/faturas'),
      );
      AppLogger.api(
        'ApiService',
        'GET /pagamentos/me/faturas',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        final decoded = jsonDecode(response.body);
        if (decoded is List) {
          return decoded
              .whereType<Map>()
              .map((item) => Fatura.fromJson(Map<String, dynamic>.from(item)))
              .toList();
        }
        return [];
      }
      throw ApiException(
        _mensagemErroHttpGet(response),
        statusCode: response.statusCode,
      );
    } on ApiException {
      rethrow;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /pagamentos/me/faturas exception', e);
      throw const ApiException(
        'Não foi possível carregar suas faturas agora. Tente novamente em instantes.',
      );
    }
  }

  /// Gera (idempotente) a fatura de regularização da PRÓPRIA conta. Consome
  /// POST /pagamentos/me/regularizacao (só autônomo; gate sandbox no backend).
  /// Se já existir fatura aberta, o backend devolve-a sem criar outra.
  /// Retorna {'ok': true, 'resultado': ...} em 200/201, ou
  /// {'ok': false, 'message': ...} nas recusas de negócio (422/403/...).
  static Future<Map<String, dynamic>> gerarFaturaRegularizacao() async {
    try {
      final response = await _postJsonAutenticado(
        Uri.parse('$_baseUrl/pagamentos/me/regularizacao'),
        retryAfterAuthResponse: true,
      );
      AppLogger.api(
        'ApiService',
        'POST /pagamentos/me/regularizacao',
        response.statusCode,
      );
      final decoded = response.body.isNotEmpty
          ? jsonDecode(response.body)
          : <String, dynamic>{};
      final body = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
      if (response.statusCode == 200 || response.statusCode == 201) {
        return {'ok': true, 'resultado': body['resultado'] ?? 'gerada'};
      }
      return {
        'ok': false,
        'message':
            body['message'] ??
            'Não foi possível gerar a fatura agora. Tente novamente em instantes.',
      };
    } catch (e) {
      AppLogger.error(
        'ApiService',
        'POST /pagamentos/me/regularizacao exception',
        e,
      );
      return {
        'ok': false,
        'message':
            'Não foi possível gerar a fatura agora. Verifique sua conexão.',
      };
    }
  }

  /// Código Pix (copia-e-cola) de uma fatura, SOB DEMANDA. Consome
  /// GET /pagamentos/faturas/:id/pix (read-only; isolado por tenant no backend,
  /// e gated a sandbox). Retorna o `payload` (EMV) ou LANÇA ApiException. NÃO
  /// persiste nada, NÃO cria cobrança.
  static Future<String> getFaturaPix(String faturaId) async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/pagamentos/faturas/$faturaId/pix'),
      );
      AppLogger.api(
        'ApiService',
        'GET /pagamentos/faturas/:id/pix',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        final decoded = jsonDecode(response.body);
        final payload = decoded is Map ? decoded['payload'] : null;
        if (payload is String && payload.trim().isNotEmpty)
          return payload.trim();
        throw const ApiException(
          'Pix indisponível para esta fatura no momento.',
        );
      }
      throw ApiException(
        _mensagemErroHttpGet(response),
        statusCode: response.statusCode,
      );
    } on ApiException {
      rethrow;
    } catch (e) {
      AppLogger.error(
        'ApiService',
        'GET /pagamentos/faturas/:id/pix exception',
        e,
      );
      throw const ApiException(
        'Não foi possível obter o Pix agora. Tente novamente em instantes.',
      );
    }
  }

  static Future<Map<String, dynamic>?> updateMe(
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await _patchJsonAutenticado(
        Uri.parse('$_baseUrl/auth/me'),
        body: data,
        retryAfterAuthResponse: true,
      );
      AppLogger.api('ApiService', 'PATCH /auth/me', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'PATCH /auth/me exception', e);
      return null;
    }
  }

  /// Retorna {ok: true, foto_url: String} em sucesso, {ok: false, message: String} em erro.
  static Future<Map<String, dynamic>> uploadFotoPerfil(String filePath) async {
    try {
      // Valida e resolve o MIME antes de montar o multipart. Extensão não
      // suportada → aborta sem POST, com mensagem amigável (mesma do backend).
      final contentType = _contentTypeImagem(filePath);
      if (contentType == null) {
        AppLogger.warning(
          'ApiService',
          'upload de foto abortado: extensão não suportada ($filePath)',
        );
        return {
          'ok': false,
          'message': 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.',
        };
      }
      final headers = await _getHeaders();
      var request = http.MultipartRequest(
        'POST',
        Uri.parse('$_baseUrl/auth/me/foto'),
      );
      request.headers.addAll(headers);
      request.headers.remove('Content-Type');
      request.files.add(
        await http.MultipartFile.fromPath(
          'foto',
          filePath,
          contentType: contentType,
        ),
      );
      final response = await request.send().timeout(_timeoutUpload);
      AppLogger.api('ApiService', 'POST /auth/me/foto', response.statusCode);
      if (response.statusCode == 200) {
        final body = await response.stream.bytesToString();
        final json = jsonDecode(body);
        return {'ok': true, 'foto_url': json['foto_url'] as String?};
      }
      String msg = 'Erro ao enviar foto (HTTP ${response.statusCode}).';
      try {
        final body = await response.stream.bytesToString();
        final json = jsonDecode(body);
        msg = json['message'] ?? json['error'] ?? msg;
      } catch (_) {}
      AppLogger.warning('ApiService', 'POST /auth/me/foto falhou: $msg');
      return {'ok': false, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /auth/me/foto exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  // TERMOS LGPD
  /// GET /termos/pendentes — retorna o corpo {pendentes, count} ou null em erro.
  /// Cada termo traz id, tipo, versao, titulo, conteudo, resumo, conteudo_hash,
  /// obrigatorio_para, publicado_em.
  static Future<Map<String, dynamic>?> buscarTermosPendentes() async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/termos/pendentes'),
      );
      AppLogger.api('ApiService', 'GET /termos/pendentes', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /termos/pendentes exception', e);
      return null;
    }
  }

  /// POST /termos/:id/aceitar com { origem: "app" }. Retorna {ok, status, message}.
  /// 201 (novo) e 200 (idempotente / já aceito) são tratados como sucesso.
  static Future<Map<String, dynamic>> aceitarTermo(String termoId) async {
    try {
      final response = await _postJsonAutenticado(
        Uri.parse('$_baseUrl/termos/$termoId/aceitar'),
        body: {'origem': 'app'},
        retryAfterAuthResponse: true,
      );
      AppLogger.api(
        'ApiService',
        'POST /termos/$termoId/aceitar',
        response.statusCode,
      );
      if (response.statusCode == 200 || response.statusCode == 201) {
        return {'ok': true, 'status': response.statusCode};
      }
      String msg = 'Erro ao registrar aceite.';
      try {
        final body = jsonDecode(response.body);
        msg = body['message'] ?? body['error'] ?? msg;
      } catch (_) {}
      return {'ok': false, 'status': response.statusCode, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /termos/aceitar exception', e);
      return {'ok': false, 'status': 0, 'message': _mensagemErroRede(e)};
    }
  }

  // FRETES
  // Diferente dos GETs silenciosos: em falha, LANÇA ApiException para o chamador
  // (Home/loadData) distinguir erro real de lista vazia. 200 com [] retorna [].
  static Future<List<dynamic>> getFretes() async {
    try {
      final response = await _getAutenticado(Uri.parse('$_baseUrl/fretes'));
      AppLogger.api('ApiService', 'GET /fretes', response.statusCode);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      throw ApiException(
        _mensagemErroHttpGet(response),
        statusCode: response.statusCode,
      );
    } on ApiException {
      rethrow;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /fretes exception', e);
      throw const ApiException(
        'Não foi possível carregar seus dados agora. Tente novamente em instantes.',
      );
    }
  }

  static Future<bool> reportLocationTrackingState(
    String estado, {
    String? detalhe,
  }) async {
    try {
      final payload = <String, dynamic>{'estado': estado};
      if (detalhe != null && detalhe.trim().isNotEmpty) {
        payload['detalhe'] = detalhe.trim();
      }
      final response = await _postJsonAutenticado(
        Uri.parse('$_baseUrl/fretes/localizacao/sessao/estado'),
        body: payload,
        retryAfterAuthResponse: true,
      );
      AppLogger.api(
        'ApiService',
        'POST /fretes/localizacao/sessao/estado',
        response.statusCode,
      );
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (e) {
      AppLogger.warning('ApiService', 'estado de localizacao nao enviado');
      return false;
    }
  }

  static Future<List<dynamic>> getFretesComFiltro(
    String dataInicio,
    String dataFim,
  ) async {
    try {
      final uri = Uri.parse('$_baseUrl/fretes').replace(
        queryParameters: {'data_inicio': dataInicio, 'data_fim': dataFim},
      );
      final response = await _getAutenticado(uri);
      AppLogger.api(
        'ApiService',
        'GET /fretes?data_inicio=$dataInicio&data_fim=$dataFim',
        response.statusCode,
      );
      if (response.statusCode == 200) return jsonDecode(response.body);
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET /fretes com filtro exception', e);
      // Único caller é o Histórico, que tem UI de "tentar novamente" + tela de
      // erro. Propaga a falha de rede para diferenciar "sem fretes no mês" de
      // "não consegui carregar" (antes engolia e mostrava lista vazia).
      rethrow;
    }
  }

  static Future<List<dynamic>> getNotificacoes({
    bool? lida,
    int limite = 50,
  }) async {
    try {
      final params = <String, String>{
        'limite': limite.clamp(1, 100).toString(),
      };
      if (lida != null) params['lida'] = lida.toString();
      final uri = Uri.parse(
        '$_baseUrl/notificacoes',
      ).replace(queryParameters: params);
      final response = await _getAutenticado(uri);
      AppLogger.api('ApiService', 'GET /notificacoes', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      throw ApiException(
        _mensagemErroHttpGet(response),
        statusCode: response.statusCode,
      );
    } catch (e) {
      AppLogger.error('ApiService', 'GET /notificacoes exception', e);
      rethrow;
    }
  }

  static Future<bool> marcarNotificacaoLida(String id) async {
    try {
      final response = await _patchJsonAutenticado(
        Uri.parse('$_baseUrl/notificacoes/$id/lida'),
        timeout: _timeoutGet,
        retryAfterAuthResponse: true,
      );
      AppLogger.api(
        'ApiService',
        'PATCH /notificacoes/$id/lida',
        response.statusCode,
      );
      return response.statusCode == 200;
    } catch (e) {
      AppLogger.error(
        'ApiService',
        'PATCH /notificacoes/$id/lida exception',
        e,
      );
      return false;
    }
  }

  static Future<bool> marcarTodasNotificacoesLidas() async {
    try {
      final response = await _patchJsonAutenticado(
        Uri.parse('$_baseUrl/notificacoes/lidas'),
        timeout: _timeoutGet,
        retryAfterAuthResponse: true,
      );
      AppLogger.api(
        'ApiService',
        'PATCH /notificacoes/lidas',
        response.statusCode,
      );
      return response.statusCode == 200;
    } catch (e) {
      AppLogger.error('ApiService', 'PATCH /notificacoes/lidas exception', e);
      return false;
    }
  }

  /// Contador de não lidas para o badge do topo. Retorna 0 em qualquer falha,
  /// para nunca exibir um badge falso quando o backend estiver indisponível.
  static Future<int> contarNotificacoesNaoLidas() async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/notificacoes/nao-lidas/count'),
      );
      AppLogger.api(
        'ApiService',
        'GET /notificacoes/nao-lidas/count',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        final body = jsonDecode(response.body);
        final valor = body is Map ? body['count'] : null;
        if (valor is int) return valor;
        return int.tryParse('$valor') ?? 0;
      }
      return 0;
    } catch (e) {
      AppLogger.error(
        'ApiService',
        'GET /notificacoes/nao-lidas/count exception',
        e,
      );
      return 0;
    }
  }

  // PUSH (FCM)
  /// Registra/atualiza o token FCM do aparelho no backend (após login / refresh).
  /// Best-effort: retorna false em qualquer falha, sem lançar.
  static Future<bool> registrarPushToken(
    String token, {
    String platform = 'android',
  }) async {
    try {
      final response = await _postJsonAutenticado(
        Uri.parse('$_baseUrl/push/tokens'),
        body: {'token': token, 'platform': platform},
        retryAfterAuthResponse: true,
      );
      AppLogger.api('ApiService', 'POST /push/tokens', response.statusCode);
      return response.statusCode == 201 || response.statusCode == 200;
    } catch (e) {
      AppLogger.error('ApiService', 'POST /push/tokens exception', e);
      return false;
    }
  }

  /// Desativa o token FCM no backend (logout). Best-effort.
  static Future<bool> removerPushToken(String token) async {
    try {
      final response = await _deleteJsonAutenticado(
        Uri.parse('$_baseUrl/push/tokens'),
        body: {'token': token},
        retryAfterAuthResponse: true,
      );
      AppLogger.api('ApiService', 'DELETE /push/tokens', response.statusCode);
      return response.statusCode == 200;
    } catch (e) {
      AppLogger.error('ApiService', 'DELETE /push/tokens exception', e);
      return false;
    }
  }

  static Future<Map<String, dynamic>?> finalizarViagem(
    String freteId, {
    int? kmInicial,
    int? kmFinal,
  }) async {
    try {
      // Série 1.5 (145B): envia KM como body JSON quando o app coletou.
      // Sem KM no body → backend finaliza como antes (compatível com app antigo).
      final payload = <String, dynamic>{};
      if (kmInicial != null) payload['km_inicial'] = kmInicial;
      if (kmFinal != null) payload['km_final'] = kmFinal;
      final response = await http
          .post(
            Uri.parse('$_baseUrl/fretes/$freteId/finalizar'),
            headers: await _getHeaders(),
            body: jsonEncode(payload),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api(
        'ApiService',
        'POST /fretes/$freteId/finalizar',
        response.statusCode,
      );
      if (response.statusCode == 200) return jsonDecode(response.body);
      final body = jsonDecode(response.body);
      return {
        '_error': true,
        'message': body['message'] ?? 'Erro ao finalizar.',
      };
    } catch (e) {
      AppLogger.error('ApiService', 'POST /fretes/finalizar exception', e);
      return {'_error': true, 'message': _mensagemErroRede(e)};
    }
  }

  static Future<Map<String, dynamic>> createFrete(
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/fretes'),
            headers: await _getHeaders(),
            body: jsonEncode(data),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api('ApiService', 'POST /fretes', response.statusCode);
      if (response.statusCode == 201) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        return {'ok': true, 'id': body['id'], 'frete': body};
      }
      final body = jsonDecode(response.body);
      // Zod retorna { message: 'Dados inválidos.', errors: [{campo, mensagem}] }
      // Prefere mostrar o primeiro erro específico ao invés da mensagem genérica
      String msg = body['message'] as String? ?? 'Erro ao salvar frete.';
      final errors = body['errors'];
      if (errors is List && errors.isNotEmpty) {
        final primeiro = errors.first;
        if (primeiro is Map && primeiro['mensagem'] != null) {
          msg = '${primeiro['mensagem']} (campo: ${primeiro['campo'] ?? '?'})';
        }
      }
      return {'ok': false, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /fretes exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  /// Envia foto privada de odômetro. O backend valida ownership/tenant e
  /// persiste somente o path no bucket privado.
  static Future<Map<String, dynamic>> uploadFotoOdometro(
    String freteId,
    String tipo,
    String filePath,
  ) async {
    try {
      if (tipo != 'inicial' && tipo != 'final') {
        return {'ok': false, 'message': 'Tipo de foto do odômetro inválido.'};
      }
      final contentType = _contentTypeImagem(filePath);
      if (contentType == null) {
        return {
          'ok': false,
          'message': 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.',
        };
      }
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('$_baseUrl/fretes/$freteId/odometro/$tipo'),
      );
      request.headers.addAll(await _getHeaders());
      request.headers.remove('Content-Type');
      request.files.add(
        await http.MultipartFile.fromPath(
          'foto',
          filePath,
          contentType: contentType,
        ),
      );
      final response = await request.send().timeout(_timeoutUpload);
      final bodyText = await response.stream.bytesToString();
      AppLogger.api(
        'ApiService',
        'POST /fretes/$freteId/odometro/$tipo',
        response.statusCode,
      );
      Map<String, dynamic> body = {};
      try {
        body = jsonDecode(bodyText) as Map<String, dynamic>;
      } catch (_) {}
      if (response.statusCode == 200) return {'ok': true, ...body};
      return {
        'ok': false,
        'message': body['message'] ?? 'Erro ao enviar foto do odômetro.',
      };
    } catch (e) {
      AppLogger.error('ApiService', 'upload foto odometro exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  // DOCUMENTOS DE FRETE (CTe/MDF-e/NF-e e outros)

  /// Lista os documentos de um frete (metadados, sem URLs). Retorna [] em falha
  /// (a tela trata lista vazia). Cada item: {id, tipo, nome_arquivo, mime,
  /// tamanho_bytes, created_at}.
  static Future<List<dynamic>> getDocumentosFrete(String freteId) async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/fretes/$freteId/documentos'),
      );
      AppLogger.api(
        'ApiService',
        'GET /fretes/$freteId/documentos',
        response.statusCode,
      );
      if (response.statusCode == 200)
        return jsonDecode(response.body) as List<dynamic>;
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET documentos frete exception', e);
      return [];
    }
  }

  /// Anexa um documento (PDF/XML/imagem) a um frete. `tipo` ∈ cte|mdfe|nfe|outro.
  /// Retorna {ok, message?}. Valida a extensão antes do POST (mesma allowlist do
  /// backend). Bucket privado — o download é feito pelo painel via signed URL.
  static Future<Map<String, dynamic>> uploadDocumentoFrete(
    String freteId,
    String tipo,
    String filePath,
  ) async {
    try {
      final contentType = _contentTypeDocumento(filePath);
      if (contentType == null) {
        return {
          'ok': false,
          'message':
              'Formato não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).',
        };
      }
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('$_baseUrl/fretes/$freteId/documentos'),
      );
      request.headers.addAll(await _getHeaders());
      request.headers.remove('Content-Type');
      request.fields['tipo'] = tipo;
      request.files.add(
        await http.MultipartFile.fromPath(
          'documento',
          filePath,
          contentType: contentType,
        ),
      );
      final response = await request.send().timeout(_timeoutUpload);
      final bodyText = await response.stream.bytesToString();
      AppLogger.api(
        'ApiService',
        'POST /fretes/$freteId/documentos',
        response.statusCode,
      );
      if (response.statusCode == 201) {
        Map<String, dynamic> body = {};
        try {
          body = jsonDecode(bodyText) as Map<String, dynamic>;
        } catch (_) {}
        return {'ok': true, ...body};
      }
      String msg = 'Erro ao enviar o documento.';
      try {
        final json = jsonDecode(bodyText);
        msg = json['message'] ?? json['error'] ?? msg;
      } catch (_) {}
      return {'ok': false, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST documento frete exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  /// Busca a signed URL (TTL curto) de um documento do frete no bucket privado.
  /// Reaproveita GET /fretes/:id/documentos/:docId/url. Retorna a URL ou null.
  static Future<String?> getDocumentoUrl(String freteId, String docId) async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/fretes/$freteId/documentos/$docId/url'),
      );
      AppLogger.api(
        'ApiService',
        'GET /fretes/$freteId/documentos/$docId/url',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        return body['url']?.toString();
      }
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'GET documento url exception', e);
      return null;
    }
  }

  /// Baixa o conteúdo de uma signed URL para um arquivo temporário e retorna o
  /// caminho local (usado para abrir/compartilhar o documento). A signed URL já
  /// carrega a autenticação no próprio link, então o GET vai SEM headers de auth.
  /// Retorna null em falha.
  static Future<String?> baixarDocumentoParaTemp(
    String url,
    String nomeArquivo,
  ) async {
    try {
      final response = await http.get(Uri.parse(url)).timeout(_timeoutUpload);
      if (response.statusCode != 200) {
        AppLogger.warning(
          'ApiService',
          'download documento status ${response.statusCode}',
        );
        return null;
      }
      final dir = await getTemporaryDirectory();
      // Sanitiza o nome para não escapar da pasta temp nem quebrar o path.
      final nomeSeguro = nomeArquivo.replaceAll(
        RegExp(r'[^A-Za-z0-9._-]'),
        '_',
      );
      final file = File('${dir.path}/$nomeSeguro');
      await file.writeAsBytes(response.bodyBytes);
      return file.path;
    } catch (e) {
      AppLogger.error('ApiService', 'download documento temp exception', e);
      return null;
    }
  }

  // ── Comprovação de entrega (ePOD) ──────────────────────────────────────────
  // O motorista comprova a entrega no campo (foto/canhoto + observação). O painel
  // valida. GPS/assinatura ficam para uma próxima frente (o backend já aceita os
  // campos como opcionais).

  /// GET /fretes/:id/epod → {epod, evidencias}. Retorna {epod: null, evidencias: []}
  /// em falha/ausência (a tela trata "sem comprovação"). `epod` traz status,
  /// comprovado_em, recebido_por, observacao, motivo_rejeicao etc.
  static Future<Map<String, dynamic>> getEpodFrete(String freteId) async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/fretes/$freteId/epod'),
      );
      AppLogger.api(
        'ApiService',
        'GET /fretes/$freteId/epod',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        return {'epod': body['epod'], 'evidencias': body['evidencias'] ?? []};
      }
      return {'epod': null, 'evidencias': []};
    } catch (e) {
      AppLogger.error('ApiService', 'GET epod frete exception', e);
      return {'epod': null, 'evidencias': []};
    }
  }

  /// POST /fretes/:id/epod → registra a comprovação (1 por frete). Envia só os
  /// campos preenchidos. Retorna {ok, message?}. 409 (já existe) vira ok:false
  /// com a mensagem do backend — a tela então parte direto para anexar evidência.
  static Future<Map<String, dynamic>> registrarEpod(
    String freteId, {
    String? recebidoPor,
    String? observacao,
  }) async {
    try {
      final headers = await _getHeaders();
      headers['Content-Type'] = 'application/json';
      final corpo = <String, dynamic>{};
      if (recebidoPor != null && recebidoPor.trim().isNotEmpty)
        corpo['recebido_por'] = recebidoPor.trim();
      if (observacao != null && observacao.trim().isNotEmpty)
        corpo['observacao'] = observacao.trim();
      final response = await http
          .post(
            Uri.parse('$_baseUrl/fretes/$freteId/epod'),
            headers: headers,
            body: jsonEncode(corpo),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api(
        'ApiService',
        'POST /fretes/$freteId/epod',
        response.statusCode,
      );
      if (response.statusCode == 201) {
        Map<String, dynamic> body = {};
        try {
          body = jsonDecode(response.body) as Map<String, dynamic>;
        } catch (_) {}
        return {'ok': true, ...body};
      }
      String msg = 'Erro ao registrar a comprovação.';
      try {
        final json = jsonDecode(response.body);
        msg = json['message'] ?? json['error'] ?? msg;
      } catch (_) {}
      return {'ok': false, 'status': response.statusCode, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST epod frete exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  /// POST /fretes/:id/epod/evidencias → anexa foto/canhoto/PDF à comprovação.
  /// Mesmo padrão de multipart dos documentos (campo 'evidencia'). Retorna {ok, message?}.
  static Future<Map<String, dynamic>> uploadEvidenciaEpod(
    String freteId,
    String filePath,
  ) async {
    try {
      final contentType = _contentTypeDocumento(filePath);
      if (contentType == null) {
        return {
          'ok': false,
          'message':
              'Formato não permitido. Use PDF, XML ou imagem (JPEG, PNG, WebP).',
        };
      }
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('$_baseUrl/fretes/$freteId/epod/evidencias'),
      );
      request.headers.addAll(await _getHeaders());
      request.headers.remove('Content-Type');
      request.files.add(
        await http.MultipartFile.fromPath(
          'evidencia',
          filePath,
          contentType: contentType,
        ),
      );
      final response = await request.send().timeout(_timeoutUpload);
      final bodyText = await response.stream.bytesToString();
      AppLogger.api(
        'ApiService',
        'POST /fretes/$freteId/epod/evidencias',
        response.statusCode,
      );
      if (response.statusCode == 201) {
        Map<String, dynamic> body = {};
        try {
          body = jsonDecode(bodyText) as Map<String, dynamic>;
        } catch (_) {}
        return {'ok': true, ...body};
      }
      String msg = 'Erro ao enviar a evidência.';
      try {
        final json = jsonDecode(bodyText);
        msg = json['message'] ?? json['error'] ?? msg;
      } catch (_) {}
      return {'ok': false, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST evidencia epod exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  /// GET /fretes/:id/epod/evidencias/:evidId/url → signed URL (TTL curto) da
  /// evidência no bucket privado. Retorna a URL ou null.
  static Future<String?> getEvidenciaEpodUrl(
    String freteId,
    String evidId,
  ) async {
    try {
      final response = await _getAutenticado(
        Uri.parse('$_baseUrl/fretes/$freteId/epod/evidencias/$evidId/url'),
      );
      AppLogger.api(
        'ApiService',
        'GET /fretes/$freteId/epod/evidencias/$evidId/url',
        response.statusCode,
      );
      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        return body['url']?.toString();
      }
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'GET evidencia epod url exception', e);
      return null;
    }
  }

  // DESPESAS / ABASTECIMENTOS / VALES

  // Envia com foto (multipart). Retorna {ok, message}.
  static Future<Map<String, dynamic>> createMovementWithPhoto(
    String endpoint,
    Map<String, String> fields,
    String filePath,
  ) async {
    try {
      // Valida e resolve o MIME antes de montar o multipart. Extensão não
      // suportada → aborta sem POST, com mensagem amigável (mesma do backend).
      final contentType = _contentTypeImagem(filePath);
      if (contentType == null) {
        AppLogger.warning(
          'ApiService',
          'upload abortado: extensão não suportada ($filePath)',
        );
        return {
          'ok': false,
          'message': 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.',
        };
      }
      var request = http.MultipartRequest(
        'POST',
        Uri.parse('$_baseUrl/$endpoint'),
      );
      request.headers.addAll(await _getHeaders());
      request.headers.remove('Content-Type');
      fields.forEach((key, value) => request.fields[key] = value);
      request.files.add(
        await http.MultipartFile.fromPath(
          'foto',
          filePath,
          contentType: contentType,
        ),
      );
      var response = await request.send().timeout(_timeoutUpload);
      AppLogger.api(
        'ApiService',
        'POST /$endpoint (foto)',
        response.statusCode,
      );
      if (response.statusCode == 201) return {'ok': true};
      String msg = 'Erro ao salvar.';
      try {
        final body = await response.stream.bytesToString();
        final json = jsonDecode(body);
        msg = json['message'] ?? json['error'] ?? msg;
      } catch (_) {}
      return {'ok': false, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /$endpoint (foto) exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  // Envia sem foto (JSON). Retorna {ok, message}.
  static Future<Map<String, dynamic>> createMovementJson(
    String endpoint,
    Map<String, dynamic> fields,
  ) async {
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/$endpoint'),
            headers: await _getHeaders(),
            body: jsonEncode(fields),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api(
        'ApiService',
        'POST /$endpoint (json)',
        response.statusCode,
      );
      if (response.statusCode == 201) return {'ok': true};
      String msg = 'Erro ao salvar.';
      try {
        final json = jsonDecode(response.body);
        msg = json['message'] ?? json['error'] ?? msg;
      } catch (_) {}
      return {'ok': false, 'message': msg};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /$endpoint (json) exception', e);
      return {'ok': false, 'message': _mensagemErroRede(e)};
    }
  }

  // LISTAGENS GENÉRICAS
  static Future<List<dynamic>> getListComFiltro(
    String endpoint,
    Map<String, String> params,
  ) async {
    try {
      final uri = Uri.parse(
        '$_baseUrl/$endpoint',
      ).replace(queryParameters: params);
      final response = await _getAutenticado(uri);
      AppLogger.api('ApiService', 'GET /$endpoint?...', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET /$endpoint filtrado exception', e);
      return [];
    }
  }

  // Diferente do getListComFiltro (silencioso): em falha, LANÇA ApiException para
  // o chamador (Home/loadData) distinguir erro real de lista vazia. Único uso é
  // no loadData; telas com filtro usam getListComFiltro. 200 com [] retorna [].
  static Future<List<dynamic>> getList(String endpoint) async {
    try {
      final response = await _getAutenticado(Uri.parse('$_baseUrl/$endpoint'));
      AppLogger.api('ApiService', 'GET /$endpoint', response.statusCode);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      throw ApiException(
        _mensagemErroHttpGet(response),
        statusCode: response.statusCode,
      );
    } on ApiException {
      rethrow;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /$endpoint exception', e);
      throw const ApiException(
        'Não foi possível carregar seus dados agora. Tente novamente em instantes.',
      );
    }
  }
}
