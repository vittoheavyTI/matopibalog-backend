import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class FreightCreationIntent {
  final String clientRequestId;
  final String fingerprint;
  final String scopeHash;
  final int createdAtMs;
  final int expiresAtMs;
  final String status;
  final String? confirmedFreightId;

  const FreightCreationIntent({
    required this.clientRequestId,
    required this.fingerprint,
    required this.scopeHash,
    required this.createdAtMs,
    required this.expiresAtMs,
    required this.status,
    this.confirmedFreightId,
  });

  Map<String, dynamic> toJson() => {
        'clientRequestId': clientRequestId,
        'fingerprint': fingerprint,
        'scopeHash': scopeHash,
        'createdAtMs': createdAtMs,
        'expiresAtMs': expiresAtMs,
        'status': status,
        if (confirmedFreightId != null)
          'confirmedFreightId': confirmedFreightId,
      };

  factory FreightCreationIntent.fromJson(Map<String, dynamic> json) =>
      FreightCreationIntent(
        clientRequestId: json['clientRequestId'] as String,
        fingerprint: json['fingerprint'] as String,
        scopeHash: json['scopeHash'] as String,
        createdAtMs: json['createdAtMs'] as int,
        expiresAtMs: json['expiresAtMs'] as int,
        status: json['status'] as String,
        confirmedFreightId: json['confirmedFreightId'] as String?,
      );

  FreightCreationIntent copyWith({
    String? status,
    String? confirmedFreightId,
  }) =>
      FreightCreationIntent(
        clientRequestId: clientRequestId,
        fingerprint: fingerprint,
        scopeHash: scopeHash,
        createdAtMs: createdAtMs,
        expiresAtMs: expiresAtMs,
        status: status ?? this.status,
        confirmedFreightId: confirmedFreightId ?? this.confirmedFreightId,
      );
}

/// Registro minimo de intencoes pendentes no armazenamento seguro do aparelho.
///
/// Persiste somente UUID, hashes opacos, timestamps, estado e a referencia do
/// frete confirmado. Payload, rota, valores, documentos e tokens nunca entram
/// no registro. A chave e escopada a tenant+usuario e expira em 72 horas.
class FreightCreationIntentMemory {
  static const _storageKey = 'pending_freight_creation_intents_v1';
  static const _ttl = Duration(hours: 72);
  static const _maxPending = 8;
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();

  static Future<String?> Function(String key) _read =
      (key) => _secureStorage.read(key: key);
  static Future<void> Function(String key, String value) _write =
      (key, value) => _secureStorage.write(key: key, value: value);
  static Future<void> Function(String key) _delete =
      (key) => _secureStorage.delete(key: key);

  static dynamic _canonicalize(dynamic value) {
    if (value is List) return value.map(_canonicalize).toList();
    if (value is Map) {
      final keys = value.keys.map((key) => key.toString()).toList()..sort();
      return <String, dynamic>{
        for (final key in keys) key: _canonicalize(value[key]),
      };
    }
    return value;
  }

  static String _hash(String value) =>
      sha256.convert(utf8.encode(value)).toString();

  static String _scopeHash({
    required String tenantId,
    required String userId,
  }) {
    if (tenantId.trim().isEmpty || userId.trim().isEmpty) {
      throw StateError('Contexto autorizado incompleto para criar frete.');
    }
    return _hash('$tenantId:$userId');
  }

  static String _payloadFingerprint(Map<String, dynamic> payload) =>
      _hash(jsonEncode(_canonicalize(payload)));

  static Future<List<FreightCreationIntent>> _load(int nowMs) async {
    try {
      final raw = await _read(_storageKey);
      if (raw == null || raw.isEmpty) return [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return decoded
          .whereType<Map>()
          .map((item) => FreightCreationIntent.fromJson(
                Map<String, dynamic>.from(item),
              ))
          .where((intent) => intent.expiresAtMs > nowMs)
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _save(List<FreightCreationIntent> records) async {
    final retained = records.length <= _maxPending
        ? records
        : records.sublist(records.length - _maxPending);
    if (retained.isEmpty) {
      await _delete(_storageKey);
      return;
    }
    await _write(
      _storageKey,
      jsonEncode(retained.map((intent) => intent.toJson()).toList()),
    );
  }

  static Future<FreightCreationIntent> obtain(
    Map<String, dynamic> payload, {
    required String tenantId,
    required String userId,
    String Function()? newId,
    int? nowMs,
  }) async {
    final now = nowMs ?? DateTime.now().millisecondsSinceEpoch;
    final fingerprint = _payloadFingerprint(payload);
    final scope = _scopeHash(tenantId: tenantId, userId: userId);
    final records = await _load(now);
    for (final intent in records) {
      if (intent.fingerprint == fingerprint && intent.scopeHash == scope) {
        return intent;
      }
    }
    final intent = FreightCreationIntent(
      clientRequestId: (newId ?? const Uuid().v4)(),
      fingerprint: fingerprint,
      scopeHash: scope,
      createdAtMs: now,
      expiresAtMs: now + _ttl.inMilliseconds,
      status: 'prepared',
    );
    await _save([...records, intent]);
    return intent;
  }

  static Future<FreightCreationIntent> _update(
    FreightCreationIntent intent, {
    required String status,
    String? confirmedFreightId,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final records = await _load(now);
    final updated = intent.copyWith(
      status: status,
      confirmedFreightId: confirmedFreightId,
    );
    await _save(records
        .map((record) => record.clientRequestId == intent.clientRequestId &&
                record.scopeHash == intent.scopeHash
            ? updated
            : record)
        .toList());
    return updated;
  }

  static Future<FreightCreationIntent> markAmbiguous(
    FreightCreationIntent intent,
  ) =>
      _update(intent, status: 'ambiguous');

  static Future<FreightCreationIntent> markCreated(
    FreightCreationIntent intent,
    String freightId,
  ) =>
      _update(intent, status: 'created', confirmedFreightId: freightId);

  static Future<void> complete(FreightCreationIntent intent) async {
    final records = await _load(DateTime.now().millisecondsSinceEpoch);
    await _save(records
        .where((record) =>
            record.clientRequestId != intent.clientRequestId ||
            record.scopeHash != intent.scopeHash)
        .toList());
  }

  @visibleForTesting
  static void setStorageForTesting({
    required Future<String?> Function(String key) read,
    required Future<void> Function(String key, String value) write,
    required Future<void> Function(String key) delete,
  }) {
    _read = read;
    _write = write;
    _delete = delete;
  }

  @visibleForTesting
  static void resetStorageAdapterForTesting() {
    _read = (key) => _secureStorage.read(key: key);
    _write = (key, value) => _secureStorage.write(key: key, value: value);
    _delete = (key) => _secureStorage.delete(key: key);
  }
}
