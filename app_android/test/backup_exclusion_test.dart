import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// SEC-1 hardening — trava ESTÁTICA da política de backup Android.
///
/// Garante que TODO o domínio SharedPreferences está excluído de backup nos dois
/// regimes (Android <=11 fullBackupContent e Android 12+ dataExtractionRules). Motivo:
/// AuthProvider.tryAutoLogin() migra SharedPreferences['token'] (token legado) para o
/// secure storage; excluir só o arquivo do flutter_secure_storage deixaria o token
/// legado restaurável via backup e re-migrado. Ver docs/sec-1/12.
void main() {
  // flutter test roda com CWD = app_android/.
  final backupRules =
      File('android/app/src/main/res/xml/backup_rules.xml');
  final dataExtraction =
      File('android/app/src/main/res/xml/data_extraction_rules.xml');
  final manifest =
      File('android/app/src/main/AndroidManifest.xml');

  // Exclusão do domínio inteiro: <exclude domain="sharedpref" path="." /> (tolerante a
  // espaços e à ordem dos atributos).
  final excludeSharedprefRoot = RegExp(
    r'<exclude\b(?=[^>]*domain\s*=\s*"sharedpref")(?=[^>]*path\s*=\s*"\.")[^>]*/?>',
  );

  test('backup_rules.xml (API<=31) exclui todo o domínio sharedpref', () {
    expect(backupRules.existsSync(), isTrue, reason: 'backup_rules.xml ausente');
    final xml = backupRules.readAsStringSync();
    expect(xml.contains('<full-backup-content>'), isTrue);
    expect(excludeSharedprefRoot.hasMatch(xml), isTrue,
        reason: 'falta <exclude domain="sharedpref" path="."/> no fullBackupContent');
    // Defesa: não voltar a excluir só o arquivo do plugin.
    expect(xml.contains('FlutterSecureStorage.xml'), isFalse,
        reason: 'não depender do nome físico do arquivo do plugin');
  });

  test('data_extraction_rules.xml (API 31+) exclui sharedpref em cloud-backup E device-transfer',
      () {
    expect(dataExtraction.existsSync(), isTrue,
        reason: 'data_extraction_rules.xml ausente');
    final xml = dataExtraction.readAsStringSync();

    Match sectionOf(String tag) {
      final m = RegExp('<$tag>(.*?)</$tag>', dotAll: true).firstMatch(xml);
      expect(m, isNotNull, reason: 'seção <$tag> ausente');
      return m!;
    }

    for (final tag in ['cloud-backup', 'device-transfer']) {
      final corpo = sectionOf(tag).group(1)!;
      expect(excludeSharedprefRoot.hasMatch(corpo), isTrue,
          reason: 'falta exclusão sharedpref path="." em <$tag>');
    }
    expect(xml.contains('FlutterSecureStorage.xml'), isFalse,
        reason: 'não depender do nome físico do arquivo do plugin');
  });

  test('AndroidManifest referencia as duas regras e mantém allowBackup', () {
    expect(manifest.existsSync(), isTrue);
    final xml = manifest.readAsStringSync();
    expect(xml.contains('android:fullBackupContent="@xml/backup_rules"'), isTrue);
    expect(
        xml.contains('android:dataExtractionRules="@xml/data_extraction_rules"'),
        isTrue);
    expect(RegExp(r'android:allowBackup\s*=').hasMatch(xml), isTrue);
  });
}
