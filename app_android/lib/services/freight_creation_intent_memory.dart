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
  final String? retentionState;

  const FreightCreationIntent({
    required this.clientRequestId,
    required this.fingerprint,
    required this.scopeHash,
    required this.createdAtMs,
    required this.expiresAtMs,
    required this.status,
    this.confirmedFreightId,
    this.retentionState,
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
        if (retentionState != null) 'retentionState': retentionState,
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
        retentionState: json['retentionState'] as String?,
      );

  FreightCreationIntent copyWith({
    String? status,
    String? confirmedFreightId,
    String? retentionState,
  }) =>
      FreightCreationIntent(
        clientRequestId: clientRequestId,
        fingerprint: fingerprint,
        scopeHash: scopeHash,
        createdAtMs: createdAtMs,
        expiresAtMs: expiresAtMs,
        status: status ?? this.status,
        confirmedFreightId: confirmedFreightId ?? this.confirmedFreightId,
        retentionState: retentionState ?? this.retentionState,
      );
}

class FreightCreationIntentSafetyException implements Exception {
  final String code;
  final String message;

  const FreightCreationIntentSafetyException(this.code, this.message);

  @override
  String toString() => message;
}

/// Registro minimo de intencoes pendentes no armazenamento seguro do aparelho.
///
/// Persiste somente UUID, hashes opacos, timestamps, estado e a referencia do
/// frete confirmado. Payload, rota, valores, documentos e tokens nunca entram
/// no registro. A chave e escopada a tenant+usuario. Apos 72 horas a entrada
/// permanece retida e passa a exigir reconciliacao; nunca e descartada em silencio.
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

  static Future<List<FreightCreationIntent>> _load() async {
    String? raw;
    try {
      raw = await _read(_storageKey);
    } catch (_) {
      throw const FreightCreationIntentSafetyException(
        'storage_unavailable',
        'Nao foi possivel acessar o registro seguro das tentativas. Nenhum novo frete foi enviado. Restaure o armazenamento e tente novamente.',
      );
    }
    try {
      if (raw == null || raw.isEmpty) return [];
      final decoded = jsonDecode(raw);
      if (decoded is! List || decoded.any((item) => item is! Map)) {
        throw const FormatException('invalid intent ledger');
      }
      return decoded
          .map((item) => FreightCreationIntent.fromJson(
                Map<String, dynamic>.from(item as Map),
              ))
          .toList();
    } catch (_) {
      throw const FreightCreationIntentSafetyException(
        'storage_corrupted',
        'O registro das tentativas anteriores esta indisponivel ou corrompido. Nenhum novo frete foi enviado; reconcilie as pendencias antes de continuar.',
      );
    }
  }

  static Future<void> _save(List<FreightCreationIntent> records) async {
    if (records.length > _maxPending) {
      throw const FreightCreationIntentSafetyException(
        'capacity_requires_reconciliation',
        'Existem oito tentativas pendentes. Reconcilie ou conclua uma delas antes de criar outro frete; nenhuma pendencia foi descartada.',
      );
    }
    try {
      if (records.isEmpty) {
        await _delete(_storageKey);
        return;
      }
      await _write(
        _storageKey,
        jsonEncode(records.map((intent) => intent.toJson()).toList()),
      );
    } catch (error) {
      if (error is FreightCreationIntentSafetyException) rethrow;
      throw const FreightCreationIntentSafetyException(
        'storage_write_failed',
        'Nao foi possivel preservar a identidade desta tentativa. Nenhum novo frete foi enviado. Libere o armazenamento e tente novamente.',
      );
    }
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
    final records = await _load();
    for (final intent in records) {
      if (intent.fingerprint == fingerprint && intent.scopeHash == scope) {
        if (intent.expiresAtMs > now) return intent;
        final retained = intent.copyWith(
          retentionState: 'expired_requires_reconciliation',
        );
        await _save(records
            .map((record) => record.clientRequestId == intent.clientRequestId &&
                    record.scopeHash == intent.scopeHash
                ? retained
                : record)
            .toList());
        return retained;
      }
    }
    if (records.length >= _maxPending) {
      throw const FreightCreationIntentSafetyException(
        'capacity_requires_reconciliation',
        'Existem oito tentativas pendentes. Reconcilie ou conclua uma delas antes de criar outro frete; nenhuma pendencia foi descartada.',
      );
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
    final records = await _load();
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
    final records = await _load();
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
