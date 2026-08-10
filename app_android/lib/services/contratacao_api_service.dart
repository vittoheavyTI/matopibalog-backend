import 'dart:convert';
import 'package:http/http.dart' as http;

import 'api_service.dart';
import '../models/situacao_comercial.dart';

/// Serviço comercial/contratual do app (macrofrente 3A-1).
///
/// COMPÕE sobre o ApiService de autenticação (SEC-1) em vez de duplicá-lo:
///   - token: ApiService.currentSessionToken()  (autoridade única de sessão)
///   - baseUrl: ApiService.baseUrl
/// Assim NÃO tocamos api_service.dart (arquivo compartilhado com o SEC-1) e não
/// replicamos refresh/armazenamento de token. Quando o SEC-1 evoluir o transporte
/// de sessão, este serviço continua correto porque usa o contrato público.
class ContratacaoApiService {
  static Map<String, String> _headers(String? token) => {
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  static Uri _uri(String path) => Uri.parse('${ApiService.baseUrl}$path');

  /// Situação comercial canônica do tenant. A autoridade de bloqueio é o backend
  /// (campo pode_operar / acoes.operar_escrita). Fail-open p/ consulta: em erro
  /// devolve `SituacaoComercial.desconhecida()` (não bloqueia por falha de rede).
  static Future<SituacaoComercial> getSituacaoComercial() async {
    try {
      final token = await ApiService.currentSessionToken();
      final resp = await http
          .get(_uri('/contratacao/situacao'), headers: _headers(token))
          .timeout(const Duration(seconds: 15));
      if (resp.statusCode == 200) {
        final body = jsonDecode(resp.body);
        if (body is Map<String, dynamic>) {
          return SituacaoComercial.fromJson(body);
        }
      }
      return SituacaoComercial.desconhecida();
    } catch (_) {
      return SituacaoComercial.desconhecida();
    }
  }

  /// Resumo de contratação (há pendência obrigatória? tem contrato? concluído?).
  /// Sempre devolve mapa; fail-open.
  static Future<Map<String, dynamic>> getStatusContratacao() async {
    try {
      final token = await ApiService.currentSessionToken();
      final resp = await http
          .get(_uri('/contratacao/status'), headers: _headers(token))
          .timeout(const Duration(seconds: 15));
      if (resp.statusCode == 200) {
        final body = jsonDecode(resp.body);
        if (body is Map<String, dynamic>) return body;
      }
    } catch (_) {/* fail-open */}
    return const {
      'pendencia_obrigatoria': false,
      'tem_contrato': false,
      'concluido': false,
    };
  }
}
