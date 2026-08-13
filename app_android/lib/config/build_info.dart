/// Identidade de build do APK (SEC-1 hardening).
///
/// Os valores são injetados em tempo de build via `--dart-define` no workflow da CI
/// (`.github/workflows/app-ci.yml`). Em build local sem os defines, caem em 'dev'.
///
/// Objetivo: exibir NA TELA (Perfil → Sobre/Diagnóstico) qual binário está rodando,
/// eliminando a dúvida "qual APK está no device?" que travou o recheck físico do
/// SEC-1 (ver docs/sec-1 — laudo forense da sessão client_type=web).
class BuildInfo {
  static const String gitSha =
      String.fromEnvironment('GIT_SHA', defaultValue: 'dev');
  static const String appVersion =
      String.fromEnvironment('APP_VERSION', defaultValue: 'dev');
  static const String appBuildNumber =
      String.fromEnvironment('APP_BUILD_NUMBER', defaultValue: '0');

  /// SHA curto (7 chars) para exibição compacta.
  static String get gitShaShort =>
      gitSha.length >= 7 ? gitSha.substring(0, 7) : gitSha;

  /// Linha única para diagnóstico/log (sem segredo).
  static String get resumo => 'v$appVersion+$appBuildNumber · $gitShaShort';
}
