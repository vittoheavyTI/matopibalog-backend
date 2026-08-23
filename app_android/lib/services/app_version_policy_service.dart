import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/build_info.dart';
import '../utils/version_compare.dart';
import 'api_service.dart';

/// Severidade de atualização (contrato com o backend).
enum AppUpdateSeverity {
  /// App em dia — nenhuma ação.
  none,

  /// Abaixo do latest, mas >= recommended: aviso discreto, não interrompe.
  optional,

  /// Abaixo do recommended, mas >= minimum: aviso visível, ainda pode continuar.
  recommended,

  /// Abaixo do minimum suportado: bloqueio controlado (nome 'forced' evita
  /// o identificador reservado 'required').
  forced,

  /// Não foi possível decidir (versão local/política inválida ou falha de rede):
  /// fallback SEGURO = não bloquear.
  unknown,
}

AppUpdateSeverity _severityFromString(String? value) {
  switch (value) {
    case 'none':
      return AppUpdateSeverity.none;
    case 'optional':
      return AppUpdateSeverity.optional;
    case 'recommended':
      return AppUpdateSeverity.recommended;
    case 'required':
      return AppUpdateSeverity.forced;
    default:
      return AppUpdateSeverity.unknown;
  }
}

/// Política de versão + severidade resolvida para a versão atual do cliente.
class AppVersionPolicy {
  final String platform;
  final String latestVersion;
  final String recommendedVersion;
  final String minimumSupportedVersion;
  final String storeUrl;
  final String releaseNotes;
  final AppUpdateSeverity severity;

  const AppVersionPolicy({
    required this.platform,
    required this.latestVersion,
    required this.recommendedVersion,
    required this.minimumSupportedVersion,
    required this.storeUrl,
    required this.releaseNotes,
    required this.severity,
  });

  /// Política desconhecida: fallback seguro (nunca bloqueia).
  factory AppVersionPolicy.unknown() => const AppVersionPolicy(
        platform: 'android',
        latestVersion: '',
        recommendedVersion: '',
        minimumSupportedVersion: '',
        storeUrl:
            'https://play.google.com/store/apps/details?id=br.com.matopibalog.app',
        releaseNotes: '',
        severity: AppUpdateSeverity.unknown,
      );

  bool get precisaAtualizarObrigatorio =>
      severity == AppUpdateSeverity.forced;
  bool get precisaAtualizarRecomendado =>
      severity == AppUpdateSeverity.recommended;
  bool get atualizacaoOpcional => severity == AppUpdateSeverity.optional;

  /// Resolve a severidade LOCALMENTE a partir da versão atual (autoridade
  /// defensiva do bloqueio): mesmo que o servidor tenha respondido, o app
  /// recomputa para não depender só do campo `update_severity`.
  factory AppVersionPolicy.fromJson(
    Map<String, dynamic> json, {
    required String currentVersion,
  }) {
    final minimum = (json['minimum_supported_version'] ?? '').toString();
    final recommended = (json['recommended_version'] ?? '').toString();
    final latest = (json['latest_version'] ?? '').toString();

    final severity = _resolveSeverity(
      currentVersion: currentVersion,
      minimum: minimum,
      recommended: recommended,
      latest: latest,
    );

    return AppVersionPolicy(
      platform: (json['platform'] ?? 'android').toString(),
      latestVersion: latest,
      recommendedVersion: recommended,
      minimumSupportedVersion: minimum,
      storeUrl: (json['store_url'] ?? AppVersionPolicy.unknown().storeUrl)
          .toString(),
      releaseNotes: (json['release_notes'] ?? '').toString(),
      severity: severity,
    );
  }

  static AppUpdateSeverity _resolveSeverity({
    required String currentVersion,
    required String minimum,
    required String recommended,
    required String latest,
  }) {
    final cmpMin = compareVersions(currentVersion, minimum);
    if (cmpMin == null) return AppUpdateSeverity.unknown;
    if (cmpMin < 0) return AppUpdateSeverity.forced;
    final cmpRec = compareVersions(currentVersion, recommended);
    if (cmpRec != null && cmpRec < 0) return AppUpdateSeverity.recommended;
    final cmpLatest = compareVersions(currentVersion, latest);
    if (cmpLatest != null && cmpLatest < 0) return AppUpdateSeverity.optional;
    return AppUpdateSeverity.none;
  }
}

/// Cliente da política de versão (MOBILE-M1-008 / D-053).
///
/// Consome `GET /app/version-policy` (rota PÚBLICA — funciona antes do login e na
/// tela de update obrigatório). Fail-safe: qualquer falha devolve `unknown`, que
/// nunca bloqueia o motorista por causa de rede instável (§36 fallback seguro).
class AppVersionPolicyService {
  static const Duration _timeout = Duration(seconds: 8);

  /// Injetável para teste; em produção usa a versão do build (`BuildInfo`).
  final String currentVersion;
  final http.Client _client;
  final String _baseUrl;

  AppVersionPolicyService({
    http.Client? client,
    String? currentVersion,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        currentVersion = currentVersion ?? BuildInfo.appVersion,
        _baseUrl = baseUrl ?? ApiService.baseUrl;

  Future<AppVersionPolicy> fetchPolicy() async {
    // Versão local desconhecida (ex.: build 'dev'): não há como decidir bloqueio.
    if (parseVersion(currentVersion) == null) {
      return AppVersionPolicy.unknown();
    }
    try {
      final uri = Uri.parse(
        '$_baseUrl/app/version-policy'
        '?platform=android'
        '&current_version=${Uri.encodeQueryComponent(currentVersion)}',
      );
      final resp = await _client.get(uri).timeout(_timeout);
      if (resp.statusCode == 200) {
        final body = jsonDecode(resp.body);
        if (body is Map<String, dynamic>) {
          return AppVersionPolicy.fromJson(body, currentVersion: currentVersion);
        }
      }
      return AppVersionPolicy.unknown();
    } catch (_) {
      return AppVersionPolicy.unknown();
    }
  }

  /// Exposto p/ teste do contrato do servidor (não usado na decisão de bloqueio).
  static AppUpdateSeverity severityFromServer(Map<String, dynamic> json) =>
      _severityFromString(json['update_severity']?.toString());
}
