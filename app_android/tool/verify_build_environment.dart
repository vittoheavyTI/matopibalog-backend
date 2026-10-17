import 'dart:io';

import 'package:chofer_log/config.dart';

void main(List<String> args) {
  final values = <String, String>{};
  for (final arg in args) {
    final separator = arg.indexOf('=');
    if (separator > 0) {
      values[arg.substring(0, separator)] = arg.substring(separator + 1);
    }
  }
  final environment = values['APP_ENV'] ?? '';
  final endpoint = values['API_BASE_URL'] ?? '';
  final isolationVerified =
      (values['HOMOLOGATION_BACKEND_VERIFIED'] ?? '').toLowerCase() == 'true';
  final requireWrites =
      (values['REQUIRE_WRITES'] ?? '').toLowerCase() == 'true';
  final validation = Config.validateValues(
    environment: environment,
    endpoint: endpoint,
    isolationVerified: isolationVerified,
  );
  if (!validation.valid) {
    stderr.writeln('BUILD_ENV_REJECTED: ${validation.error}');
    exitCode = 2;
    return;
  }
  if (environment == 'homologation' && !validation.writesAllowed) {
    if (requireWrites) {
      stderr.writeln('BUILD_ENV_REJECTED: ${validation.error}');
      exitCode = 2;
      return;
    }
    stdout.writeln(
      'BUILD_ENV_SAFE_READONLY: homologation artifact will block writes; '
      '${validation.error}',
    );
    return;
  }
  stdout.writeln(
      'BUILD_ENV_VERIFIED: $environment ${Uri.parse(endpoint).origin}');
}
