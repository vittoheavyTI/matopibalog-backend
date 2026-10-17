import 'dart:convert';

import 'package:uuid/uuid.dart';

/// Continuidade, somente em memória, de uma intenção de criação de frete.
///
/// A tela pode ser reconstruída depois de timeout ou perda de resposta. Para o
/// mesmo payload canônico, o app reutiliza o UUID anterior durante a execução do
/// processo. Nenhum dado operacional é persistido no aparelho.
class FreightCreationIntentMemory {
  static String? _clientRequestId;
  static String? _fingerprint;

  static String obtain(
    Map<String, dynamic> payload, {
    String Function()? newId,
  }) {
    final fingerprint = _canonicalJson(payload);
    if (_clientRequestId != null && _fingerprint == fingerprint) {
      return _clientRequestId!;
    }
    _clientRequestId = (newId ?? const Uuid().v4)();
    _fingerprint = fingerprint;
    return _clientRequestId!;
  }

  static void clear() {
    _clientRequestId = null;
    _fingerprint = null;
  }

  static String _canonicalJson(Map<String, dynamic> payload) {
    final keys = payload.keys.toList()..sort();
    return jsonEncode(<String, dynamic>{
      for (final key in keys) key: payload[key],
    });
  }
}
