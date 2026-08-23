import 'package:chofer_log/utils/version_compare.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('compareVersions', () {
    test('NÃO é lexicográfico: 1.10.0 > 1.9.0', () {
      expect(compareVersions('1.10.0', '1.9.0'), 1);
      expect(compareVersions('1.9.0', '1.10.0'), -1);
      expect(compareVersions('2.0.0', '1.99.99'), 1);
    });

    test('igualdade', () {
      expect(compareVersions('1.0.0', '1.0.0'), 0);
      expect(compareVersions('1.2', '1.2.0'), 0);
    });

    test('ignora build metadata e pré-release', () {
      expect(compareVersions('1.2.0+45', '1.2.0+9'), 0);
      expect(compareVersions('1.2.0-rc1', '1.2.0'), 0);
      expect(compareVersions('1.2.1', '1.2'), 1);
    });

    test('retorna null quando não parseável', () {
      expect(compareVersions('abc', '1.0.0'), isNull);
      expect(compareVersions('1.0.0', ''), isNull);
      expect(compareVersions(null, '1.0.0'), isNull);
      expect(compareVersions('1.x.0', '1.0.0'), isNull);
    });
  });

  group('parseVersion', () {
    test('segmentos numéricos', () {
      expect(parseVersion('1.2.3'), [1, 2, 3]);
      expect(parseVersion('1.2.3+45'), [1, 2, 3]);
      expect(parseVersion('10.0'), [10, 0]);
    });

    test('inválido → null', () {
      expect(parseVersion(''), isNull);
      expect(parseVersion(null), isNull);
      expect(parseVersion('dev'), isNull);
      expect(parseVersion('v1.2'), isNull);
    });
  });
}
