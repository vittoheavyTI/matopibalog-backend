import 'package:flutter/foundation.dart';

enum LogLevel { info, warning, error, api, action }

class AppLogger {
  static const _sanitizedFields = {
    'senha', 'password', 'token', 'authorization',
    'local_path', 'foto_url', 'path', 'foto',
  };

  static void info(String tag, String message) =>
      _log(LogLevel.info, tag, message);

  static void warning(String tag, String message) =>
      _log(LogLevel.warning, tag, message);

  static void error(String tag, String message, [dynamic error]) {
    _log(LogLevel.error, tag, message, error);
  }

  static void api(String tag, String endpoint, int statusCode) {
    _log(LogLevel.api, tag, '$endpoint -> $statusCode');
  }

  static void action(String action, {Map<String, dynamic>? params}) {
    final sanitized = _sanitize(params ?? {});
    final paramsStr = sanitized.isNotEmpty ? ' | $sanitized' : '';
    _log(LogLevel.action, 'ACTION', '$action$paramsStr');
  }

  static Map<String, dynamic> _sanitize(Map<String, dynamic> params) {
    final safe = <String, dynamic>{};
    for (final entry in params.entries) {
      final keyLower = entry.key.toLowerCase();
      if (_sanitizedFields.contains(keyLower)) {
        safe[entry.key] = '***';
      } else if (keyLower == 'cpf' && entry.value is String && (entry.value as String).length >= 3) {
        final s = entry.value as String;
        safe[entry.key] = '***.***.***-${s.substring(s.length - 3)}';
      } else {
        safe[entry.key] = entry.value;
      }
    }
    return safe;
  }

  static void _log(LogLevel level, String tag, String message, [dynamic error]) {
    final prefix = level.name.toUpperCase().padRight(7);
    debugPrint('[$prefix][$tag] $message');
    if (error != null) {
      debugPrint('[$prefix][$tag] ERROR: $error');
    }
  }
}
