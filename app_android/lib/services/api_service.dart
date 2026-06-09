import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import 'app_logger.dart';

class ApiService {
  static final String _baseUrl = Config.apiBaseUrl;

  static Future<Map<String, String>> _getHeaders() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token');
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
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

      debugPrint('[ApiService.login] status=${response.statusCode} body=${response.body}');

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

  static Future<bool> register(Map<String, dynamic> data) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(data),
      );
      return response.statusCode == 201;
    } catch (e) {
      return false;
    }
  }

  static Future<bool> esqueceuSenha(String email) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/auth/esqueceu-senha'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email}),
      );
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
      final response = await http.get(
        Uri.parse('$_baseUrl/auth/me'),
        headers: await _getHeaders(),
      );
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
      final response = await http.patch(
        Uri.parse('$_baseUrl/auth/me'),
        headers: await _getHeaders(),
        body: jsonEncode(data),
      );
      AppLogger.api('ApiService', 'PATCH /auth/me', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'PATCH /auth/me exception', e);
      return null;
    }
  }

  static Future<String?> uploadFotoPerfil(String filePath) async {
    try {
      final headers = await _getHeaders();
      var request = http.MultipartRequest('POST', Uri.parse('$_baseUrl/auth/me/foto'));
      request.headers.addAll(headers);
      request.headers.remove('Content-Type');
      request.files.add(await http.MultipartFile.fromPath('foto', filePath));
      final response = await request.send();
      AppLogger.api('ApiService', 'POST /auth/me/foto', response.statusCode);
      if (response.statusCode == 200) {
        final body = await response.stream.bytesToString();
        final json = jsonDecode(body);
        return json['foto_url'] as String?;
      }
      return null;
    } catch (e) {
      AppLogger.error('ApiService', 'POST /auth/me/foto exception', e);
      return null;
    }
  }

  // FRETES
  static Future<List<dynamic>> getFretes() async {
    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/fretes'),
        headers: await _getHeaders(),
      );
      if (response.statusCode == 200) {
        AppLogger.api('ApiService', 'GET /fretes', response.statusCode);
        return jsonDecode(response.body);
      }
      AppLogger.api('ApiService', 'GET /fretes', response.statusCode);
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET /fretes exception', e);
      return [];
    }
  }

  static Future<List<dynamic>> getNotificacoes() async {
    try {
      final response = await http.get(Uri.parse('$_baseUrl/notificacoes'), headers: await _getHeaders());
      AppLogger.api('ApiService', 'GET /notificacoes', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET /notificacoes exception', e);
      return [];
    }
  }

  static Future<void> marcarNotificacaoLida(String id) async {
    try {
      await http.patch(Uri.parse('$_baseUrl/notificacoes/$id/lida'), headers: await _getHeaders());
    } catch (_) {}
  }

  static Future<Map<String, dynamic>?> finalizarViagem(String freteId) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/fretes/$freteId/finalizar'),
        headers: await _getHeaders(),
      );
      AppLogger.api('ApiService', 'POST /fretes/$freteId/finalizar', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      final body = jsonDecode(response.body);
      return {'_error': true, 'message': body['message'] ?? 'Erro ao finalizar.'};
    } catch (e) {
      AppLogger.error('ApiService', 'POST /fretes/finalizar exception', e);
      return {'_error': true, 'message': 'Erro de conexão.'};
    }
  }

  static Future<Map<String, dynamic>> createFrete(Map<String, dynamic> data) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/fretes'),
        headers: await _getHeaders(),
        body: jsonEncode(data),
      );
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
      return {'ok': false, 'message': 'Erro de conexão.'};
    }
  }

  // DESPESAS / ABASTECIMENTOS / VALES

  // Envia com foto (multipart). Retorna {ok, message}.
  static Future<Map<String, dynamic>> createMovementWithPhoto(
      String endpoint, Map<String, String> fields, String filePath) async {
    try {
      var request = http.MultipartRequest('POST', Uri.parse('$_baseUrl/$endpoint'));
      request.headers.addAll(await _getHeaders());
      request.headers.remove('Content-Type');
      fields.forEach((key, value) => request.fields[key] = value);
      request.files.add(await http.MultipartFile.fromPath('foto', filePath));
      var response = await request.send();
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
      return {'ok': false, 'message': 'Erro de conexão.'};
    }
  }

  // Envia sem foto (JSON). Retorna {ok, message}.
  static Future<Map<String, dynamic>> createMovementJson(
      String endpoint, Map<String, dynamic> fields) async {
    try {
      final response = await http.post(
        Uri.parse('$_baseUrl/$endpoint'),
        headers: await _getHeaders(),
        body: jsonEncode(fields),
      );
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
      return {'ok': false, 'message': 'Erro de conexão.'};
    }
  }

  // LISTAGENS GENÉRICAS
  static Future<List<dynamic>> getListComFiltro(String endpoint, Map<String, String> params) async {
    try {
      final uri = Uri.parse('$_baseUrl/$endpoint').replace(queryParameters: params);
      final response = await http.get(uri, headers: await _getHeaders());
      AppLogger.api('ApiService', 'GET /$endpoint?...', response.statusCode);
      if (response.statusCode == 200) return jsonDecode(response.body);
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET /$endpoint filtrado exception', e);
      return [];
    }
  }

  static Future<List<dynamic>> getList(String endpoint) async {
    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/$endpoint'),
        headers: await _getHeaders(),
      );
      if (response.statusCode == 200) {
        AppLogger.api('ApiService', 'GET /$endpoint', response.statusCode);
        return jsonDecode(response.body);
      }
      AppLogger.api('ApiService', 'GET /$endpoint', response.statusCode);
      return [];
    } catch (e) {
      AppLogger.error('ApiService', 'GET /$endpoint exception', e);
      return [];
    }
  }
}
