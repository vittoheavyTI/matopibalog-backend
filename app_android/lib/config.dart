enum AppEnvironment { production, homologation, automatedTest, invalid }

class BuildEnvironmentValidation {
  final bool valid;
  final bool writesAllowed;
  final String? error;

  const BuildEnvironmentValidation({
    required this.valid,
    required this.writesAllowed,
    this.error,
  });
}

/// Configuracao compilada do aplicativo, sem fallback de endpoint.
class Config {
  static const String environmentValue =
      String.fromEnvironment('APP_ENV', defaultValue: 'invalid');
  static const String apiBaseUrl =
      String.fromEnvironment('API_BASE_URL', defaultValue: '');
  static const bool backendIsolationVerified = bool.fromEnvironment(
    'HOMOLOGATION_BACKEND_VERIFIED',
    defaultValue: false,
  );

  static AppEnvironment get environment => switch (environmentValue) {
        'production' => AppEnvironment.production,
        'homologation' => AppEnvironment.homologation,
        'test' => AppEnvironment.automatedTest,
        _ => AppEnvironment.invalid,
      };

  static BuildEnvironmentValidation validateValues({
    required String environment,
    required String endpoint,
    required bool isolationVerified,
  }) {
    if (!const {'production', 'homologation', 'test'}.contains(environment)) {
      return const BuildEnvironmentValidation(
        valid: false,
        writesAllowed: false,
        error: 'Ambiente do aplicativo ausente ou invalido.',
      );
    }
    final uri = Uri.tryParse(endpoint);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      return const BuildEnvironmentValidation(
        valid: false,
        writesAllowed: false,
        error: 'Endpoint HTTPS obrigatorio nao configurado.',
      );
    }
    if (uri.hasQuery ||
        uri.hasFragment ||
        (uri.path.isNotEmpty && uri.path != '/')) {
      return const BuildEnvironmentValidation(
        valid: false,
        writesAllowed: false,
        error: 'Endpoint deve conter somente origem HTTPS, sem path ou query.',
      );
    }
    if (environment == 'homologation' &&
        uri.host.toLowerCase().endsWith('.up.railway.app')) {
      return const BuildEnvironmentValidation(
        valid: false,
        writesAllowed: false,
        error: 'Homologacao recusa endpoints Railway de producao.',
      );
    }
    if (environment == 'homologation' && !isolationVerified) {
      return const BuildEnvironmentValidation(
        valid: true,
        writesAllowed: false,
        error: 'Backend de homologacao isolado ainda nao foi atestado.',
      );
    }
    return const BuildEnvironmentValidation(valid: true, writesAllowed: true);
  }

  static BuildEnvironmentValidation get validation => validateValues(
        environment: environmentValue,
        endpoint: apiBaseUrl,
        isolationVerified: backendIsolationVerified,
      );

  static bool get canCreateFreight => validation.writesAllowed;
  static bool get showNonProductionMarker =>
      environment != AppEnvironment.production;
  static String get environmentLabel => switch (environment) {
        AppEnvironment.homologation => 'HOMOLOGACAO',
        AppEnvironment.automatedTest => 'TESTE',
        AppEnvironment.production => 'PRODUCAO',
        AppEnvironment.invalid => 'CONFIGURACAO INVALIDA',
      };
}
