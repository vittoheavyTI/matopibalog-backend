import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';
import 'api_service.dart';
import 'app_logger.dart';

/// Cliente SSE do app (Onda 1): escuta GET /realtime/stream do backend com Bearer
/// (EventSource não permite header Authorization → usamos http streaming), com
/// reconnect + backoff. Emite eventos MÍNIMOS; a tela, ao receber, REFAZ o fetch
/// canônico — o SSE nunca é a única fonte de verdade.
///
/// Eventos sintéticos emitidos localmente: '__reconnect__' (conectou/reconectou) e
/// '__resume__' (app voltou do background) — ambos devem disparar refetch.
class RealtimeService {
  RealtimeService._();
  static final RealtimeService instance = RealtimeService._();

  final StreamController<Map<String, dynamic>> _controller =
      StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get eventos => _controller.stream;

  http.Client? _client;
  bool _running = false;
  bool _stopped = false;
  int _tentativa = 0;
  String? _freteId;

  /// Inicia (idempotente) o stream. Opcionalmente filtra por frete.
  void start({String? freteId}) {
    if (_running) return;
    _running = true;
    _stopped = false;
    _tentativa = 0;
    _freteId = freteId;
    unawaited(_conectar());
  }

  Future<void> stop() async {
    _stopped = true;
    _running = false;
    try {
      _client?.close();
    } catch (_) {/* noop */}
    _client = null;
  }

  /// Sinaliza "refetch agora" sem depender do stream (ex.: app resumido do
  /// background). Não abre conexão; só emite o evento sintético para os ouvintes.
  void pingRefetch() {
    if (!_controller.isClosed) _controller.add(const {'type': '__resume__'});
  }

  Future<void> _conectar() async {
    if (_stopped) return;
    final token = await ApiService.currentSessionToken();
    if (token == null || token.isEmpty) {
      await _aguardarBackoff();
      if (!_stopped) unawaited(_conectar());
      return;
    }
    final base = Config.apiBaseUrl;
    final filtro = (_freteId != null && _freteId!.isNotEmpty) ? '?frete_id=$_freteId' : '';
    final uri = Uri.parse('$base/realtime/stream$filtro');
    _client = http.Client();
    try {
      final req = http.Request('GET', uri);
      req.headers['Authorization'] = 'Bearer $token';
      req.headers['Accept'] = 'text/event-stream';
      final resp = await _client!.send(req);
      if (resp.statusCode != 200) {
        throw http.ClientException('sse_${resp.statusCode}', uri);
      }
      _tentativa = 0;
      if (!_controller.isClosed) _controller.add(const {'type': '__reconnect__'});
      var buffer = '';
      await for (final chunk in resp.stream.transform(utf8.decoder)) {
        if (_stopped) break;
        buffer += chunk;
        int sep;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          final frame = buffer.substring(0, sep);
          buffer = buffer.substring(sep + 2);
          final dados = frame
              .split('\n')
              .where((l) => l.startsWith('data:'))
              .map((l) => l.substring(5).trim())
              .join('\n');
          if (dados.isEmpty) continue; // heartbeat/comentário
          try {
            final ev = jsonDecode(dados);
            if (ev is Map<String, dynamic> && !_controller.isClosed) _controller.add(ev);
          } catch (_) {/* frame inválido */}
        }
      }
    } catch (_) {
      AppLogger.warning('RealtimeService', 'stream indisponível; reconectando');
    } finally {
      try {
        _client?.close();
      } catch (_) {/* noop */}
      _client = null;
    }
    if (_stopped) return;
    await _aguardarBackoff();
    if (!_stopped) unawaited(_conectar());
  }

  Future<void> _aguardarBackoff() async {
    _tentativa = (_tentativa + 1).clamp(1, 6);
    final ms = (1000 * (1 << _tentativa)).clamp(1000, 15000);
    await Future<void>.delayed(Duration(milliseconds: ms));
  }
}
