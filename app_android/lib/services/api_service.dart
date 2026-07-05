import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../models/plano_publico.dart';
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

class ApiService {
  static final String _baseUrl = Config.apiBaseUrl;

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

  /// Chave do token no secure storage — deve casar com AuthProvider._tokenKey.
  static const _tokenKey = 'token';
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();

  /// Token JWT da sessão atual, mantido em memória.
  /// A persistência segura (quando o usuário marca "Manter conectado neste
  /// aparelho") é responsabilidade do AuthProvider, via flutter_secure_storage.
  static String? _sessionToken;

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
    } catch (_) {/* body não-JSON: usa mensagem genérica */}
    return 'Não foi possível carregar seus dados agora. Tente novamente em instantes.';
  }

  /// Define o token usado nas requisições autenticadas da sessão atual.
  static void setSessionToken(String token) => _sessionToken = token;

  /// Limpa o token em memória (logout ou falha de auto-login).
  static void clearSessionToken() => _sessionToken = null;

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
  // requisição segue sem Authorization (comportamento aceitável).
  static Future<Map<String, String>> _getHeaders() async {
    var token = _sessionToken;
    if (token == null || token.isEmpty) {
      token = await _secureStorage.read(key: _tokenKey);
      // Aproveita para popular a memória deste isolate, evitando reler o
      // secure storage a cada requisição subsequente.
      if (token != null && token.isNotEmpty) {
        _sessionToken = token;
      }
    }
    return {
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  // AUTH
  static Future<Map<String, dynamic>?> login(String email, String senha) async {
    AppLogger.action('login_attempt', params: {'email': email});
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/auth/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email, 'senha': senha}),
          )
          .timeout(const Duration(seconds: 20));

      // NÃO logar response.body: em sucesso ele contém o token JWT.
      // Só o body de erro (statusCode != 200) é logado, para diagnóstico.
      if (response.statusCode != 200) {
        debugPrint('[ApiService.login] status=${response.statusCode} body=${response.body}');
      } else {
        debugPrint('[ApiService.login] status=${response.statusCode} (ok)');
      }

      if (response.statusCode == 200) {
        AppLogger.action('login_success', params: {'email': email});
        return jsonDecode(response.body);
      }
      AppLogger.action('login_error', params: {'email': email, 'status': response.statusCode});
      // Retorna o body para o provider poder extrair a mensagem de erro
      return {'_error': true, '_status': response.statusCode, '_body': response.body};
    } catch (e) {
      debugPrint('[ApiService.login] exception type: ${e.runtimeType}');
      debugPrint('[ApiService.login] exception: $e');
      AppLogger.action('login_error', params: {'email': email, 'tipo': e.runtimeType.toString(), 'error': e.toString()});
      return {'_error': true, '_status': 0, '_body': e.toString()};
    }
  }

  static Future<List<PlanoPublico>> getPlanosPublicos() async {
    final prefs = await SharedPreferences.getInstance();
    final agora = DateTime.now();
    final cacheRaw = prefs.getString(_planosCacheKey);
    final cacheAtRaw = prefs.getInt(_planosCacheAtKey);
    List<PlanoPublico>? cache;
    Duration? cacheAge;

    if (cacheRaw != null && cacheAtRaw != null) {
      try {
        final decoded = jsonDecode(cacheRaw);
        if (decoded is List) {
          cache = decoded
              .whereType<Map>()
              .map((item) => PlanoPublico.fromJson(Map<String, dynamic>.from(item)))
              .where((plano) => plano.id.isNotEmpty)
              .toList();
          cacheAge = agora.difference(DateTime.fromMillisecondsSinceEpoch(cacheAtRaw));
        }
      } catch (_) {
        cache = null;
        cacheAge = null;
      }
    }

    if (cache != null && cacheAge != null && !cacheAge.isNegative && cacheAge <= _planosCacheTtl) {
      return cache;
    }

    try {
      final response = await http
          .get(
            Uri.parse('$_baseUrl/planos/publicos'),
            headers: {'Content-Type': 'application/json'},
          )
          .timeout(_timeoutGet);

      if (response.statusCode != 200) {
        throw Exception('Catálogo indisponível (${response.statusCode}).');
      }

      final decoded = jsonDecode(response.body);
      final planosRaw = decoded is Map<String, dynamic> ? decoded['planos'] : null;
      if (planosRaw is! List) {
        throw Exception('Resposta inválida do catálogo de planos.');
      }

      final planos = planosRaw
          .whereType<Map>()
          .map((item) => PlanoPublico.fromJson(Map<String, dynamic>.from(item)))
          .where((plano) => plano.id.isNotEmpty)
          .toList();

      await prefs.setString(
        _planosCacheKey,
        jsonEncode(planos.map((plano) => plano.toJson()).toList()),
      );
      await prefs.setInt(_planosCacheAtKey, agora.millisecondsSinceEpoch);
      return planos;
    } catch (_) {
      if (cache != null && cacheAge != null && !cacheAge.isNegative && cacheAge <= _planosCacheMaxAge) {
        return cache;
      }
      throw Exception('Não foi possível carregar os planos. Verifique sua internet.');
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

      if (response.statusCode == 201) return {'ok': true};

      String? mensagem;
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map && decoded['message'] is String) {
          mensagem = (decoded['message'] as String).trim();
        }
      } catch (_) {/* body não-JSON */}
      return {
        'ok': false,
        'message': (mensagem != null && mensagem.isNotEmpty)
            ? mensagem
            : 'Não foi possível concluir o cadastro. Tente novamente em instantes.',
      };
    } catch (e) {
      return {
        'ok': false,
        'message': 'Não foi possível concluir o cadastro. Tente novamente em instantes.',
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

  static Future<Map<String, dynamic>> trocarSenha(String novaSenha) async {
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/auth/trocar-senha'),
            headers: await _getHeaders(),
            body: jsonEncode({'nova_senha': novaSenha}),
          )
          .timeout(const Duration(seconds: 20));

      AppLogger.api('ApiService', 'POST /auth/trocar-senha', response.statusCode);
      if (response.statusCode == 200) {
        return {'ok': true};
      }
      final body = jsonDecode(response.body);
      return {'ok': false, 'message': body['message'] ?? 'Erro ao trocar senha.'};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /auth/trocar-senha exception', e);
      return {'ok': false, 'message': 'Erro de conexão.'};
    }
  }

  static Future<Map<String, dynamic>?> getMe() async {
    try {
      final response = await http
          .get(
            Uri.parse('$_baseUrl/auth/me'),
            headers: await _getHeaders(),
          )
          .timeout(_timeoutGet);
      if (response.statusCode == 200) {
        AppLogger.api('ApiService', 'GET /auth/me', response.statusCode);
        return jsonDecode(response.body);
      }
      AppLogger.api('ApiService', 'GET /auth/me', response.statusCode);
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /auth/me exception', e);
      return null;
    }
  }

  static Future<Map<String, dynamic>?> updateMe(Map<String, dynamic> data) async {
    try {
      final response = await http
          .patch(
            Uri.parse('$_baseUrl/auth/me'),
            headers: await _getHeaders(),
            body: jsonEncode(data),
          )
          .timeout(_timeoutPostJson);
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
        AppLogger.warning('ApiService', 'upload de foto abortado: extensão não suportada ($filePath)');
        return {'ok': false, 'message': 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.'};
      }
      final headers = await _getHeaders();
      var request = http.MultipartRequest('POST', Uri.parse('$_baseUrl/auth/me/foto'));
      request.headers.addAll(headers);
      request.headers.remove('Content-Type');
      request.files.add(await http.MultipartFile.fromPath('foto', filePath, contentType: contentType));
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
      final response = await http
          .get(
            Uri.parse('$_baseUrl/termos/pendentes'),
            headers: await _getHeaders(),
          )
          .timeout(_timeoutGet);
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
      final response = await http
          .post(
            Uri.parse('$_baseUrl/termos/$termoId/aceitar'),
            headers: await _getHeaders(),
            body: jsonEncode({'origem': 'app'}),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api('ApiService', 'POST /termos/$termoId/aceitar', response.statusCode);
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
      final response = await http
          .get(
            Uri.parse('$_baseUrl/fretes'),
            headers: await _getHeaders(),
          )
          .timeout(_timeoutGet);
      AppLogger.api('ApiService', 'GET /fretes', response.statusCode);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      throw ApiException(_mensagemErroHttpGet(response), statusCode: response.statusCode);
    } on ApiException {
      rethrow;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /fretes exception', e);
      throw const ApiException('Não foi possível carregar seus dados agora. Tente novamente em instantes.');
    }
  }

  static Future<List<dynamic>> getFretesComFiltro(String dataInicio, String dataFim) async {
    try {
      final uri = Uri.parse('$_baseUrl/fretes').replace(queryParameters: {
        'data_inicio': dataInicio,
        'data_fim': dataFim,
      });
      final response = await http.get(uri, headers: await _getHeaders()).timeout(_timeoutGet);
      AppLogger.api('ApiService', 'GET /fretes?data_inicio=$dataInicio&data_fim=$dataFim', response.statusCode);
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

  static Future<List<dynamic>> getNotificacoes({bool? lida, int limite = 50}) async {
    try {
      final params = <String, String>{'limite': limite.clamp(1, 100).toString()};
      if (lida != null) params['lida'] = lida.toString();
      final uri = Uri.parse('$_baseUrl/notificacoes').replace(queryParameters: params);
      final response = await http.get(uri, headers: await _getHeaders()).timeout(_timeoutGet);
      AppLogger.api('ApiService', 'GET /notificacoes', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      throw ApiException(_mensagemErroHttpGet(response), statusCode: response.statusCode);
    } catch (e) {
      AppLogger.error('ApiService', 'GET /notificacoes exception', e);
      rethrow;
    }
  }

  static Future<bool> marcarNotificacaoLida(String id) async {
    try {
      final response = await http.patch(Uri.parse('$_baseUrl/notificacoes/$id/lida'), headers: await _getHeaders()).timeout(_timeoutGet);
      AppLogger.api('ApiService', 'PATCH /notificacoes/$id/lida', response.statusCode);
      return response.statusCode == 200;
    } catch (e) {
      AppLogger.error('ApiService', 'PATCH /notificacoes/$id/lida exception', e);
      return false;
    }
  }

  static Future<bool> marcarTodasNotificacoesLidas() async {
    try {
      final response = await http.patch(Uri.parse('$_baseUrl/notificacoes/lidas'), headers: await _getHeaders()).timeout(_timeoutGet);
      AppLogger.api('ApiService', 'PATCH /notificacoes/lidas', response.statusCode);
      return response.statusCode == 200;
    } catch (e) {
      AppLogger.error('ApiService', 'PATCH /notificacoes/lidas exception', e);
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
      AppLogger.api('ApiService', 'POST /fretes/$freteId/finalizar', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      final body = jsonDecode(response.body);
      return {'_error': true, 'message': body['message'] ?? 'Erro ao finalizar.'};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /fretes/finalizar exception', e);
      return {'_error': true, 'message': _mensagemErroRede(e)};
    }
  }

  static Future<Map<String, dynamic>> createFrete(Map<String, dynamic> data) async {
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
        return {'ok': true};
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

  // DESPESAS / ABASTECIMENTOS / VALES

  // Envia com foto (multipart). Retorna {ok, message}.
  static Future<Map<String, dynamic>> createMovementWithPhoto(
      String endpoint, Map<String, String> fields, String filePath) async {
    try {
      // Valida e resolve o MIME antes de montar o multipart. Extensão não
      // suportada → aborta sem POST, com mensagem amigável (mesma do backend).
      final contentType = _contentTypeImagem(filePath);
      if (contentType == null) {
        AppLogger.warning('ApiService', 'upload abortado: extensão não suportada ($filePath)');
        return {'ok': false, 'message': 'Formato de arquivo não permitido. Use JPEG, PNG ou WebP.'};
      }
      var request = http.MultipartRequest('POST', Uri.parse('$_baseUrl/$endpoint'));
      request.headers.addAll(await _getHeaders());
      request.headers.remove('Content-Type');
      fields.forEach((key, value) => request.fields[key] = value);
      request.files.add(await http.MultipartFile.fromPath('foto', filePath, contentType: contentType));
      var response = await request.send().timeout(_timeoutUpload);
      AppLogger.api('ApiService', 'POST /$endpoint (foto)', response.statusCode);
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
      String endpoint, Map<String, dynamic> fields) async {
    try {
      final response = await http
          .post(
            Uri.parse('$_baseUrl/$endpoint'),
            headers: await _getHeaders(),
            body: jsonEncode(fields),
          )
          .timeout(_timeoutPostJson);
      AppLogger.api('ApiService', 'POST /$endpoint (json)', response.statusCode);
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
  static Future<List<dynamic>> getListComFiltro(String endpoint, Map<String, String> params) async {
    try {
      final uri = Uri.parse('$_baseUrl/$endpoint').replace(queryParameters: params);
      final response = await http.get(uri, headers: await _getHeaders()).timeout(_timeoutGet);
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
      final response = await http
          .get(
            Uri.parse('$_baseUrl/$endpoint'),
            headers: await _getHeaders(),
          )
          .timeout(_timeoutGet);
      AppLogger.api('ApiService', 'GET /$endpoint', response.statusCode);
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      throw ApiException(_mensagemErroHttpGet(response), statusCode: response.statusCode);
    } on ApiException {
      rethrow;
    } catch (e) {
      AppLogger.error('ApiService', 'GET /$endpoint exception', e);
      throw const ApiException('Não foi possível carregar seus dados agora. Tente novamente em instantes.');
    }
  }
}
