import 'dart:convert';
import 'dart:io';

import 'package:chofer_log/config.dart';
import 'package:chofer_log/services/api_service.dart';
import 'package:chofer_log/services/freight_creation_intent_memory.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  late Map<String, String> secureValues;

  setUp(() {
    secureValues = {};
    FreightCreationIntentMemory.setStorageForTesting(
      read: (key) async => secureValues[key],
      write: (key, value) async => secureValues[key] = value,
      delete: (key) async => secureValues.remove(key),
    );
    ApiService.resetForTesting();
    ApiService.setSessionToken('test-token');
  });

  tearDown(() {
    ApiService.resetForTesting();
    FreightCreationIntentMemory.resetStorageAdapterForTesting();
  });

  test('configuracao ausente e endpoint Railway falham fechado', () {
    expect(
      Config.validateValues(
        environment: '',
        endpoint: '',
        isolationVerified: false,
      ).valid,
      isFalse,
    );
    final railway = Config.validateValues(
      environment: 'homologation',
      endpoint: 'https://example-production.up.railway.app',
      isolationVerified: true,
    );
    expect(railway.valid, isFalse);
    expect(railway.writesAllowed, isFalse);
  });

  test('homologacao sem atestacao compila somente em modo sem escrita', () {
    final safe = Config.validateValues(
      environment: 'homologation',
      endpoint: 'https://homologacao.invalid',
      isolationVerified: false,
    );
    expect(safe.valid, isTrue);
    expect(safe.writesAllowed, isFalse);

    final operational = Config.validateValues(
      environment: 'homologation',
      endpoint: 'https://api.homologacao.example',
      isolationVerified: true,
    );
    expect(operational.valid, isTrue);
    expect(operational.writesAllowed, isTrue);
  });

  test('reinicio do processo recupera a mesma chave no secure storage',
      () async {
    var sequence = 0;
    final payload = <String, dynamic>{
      'origem': 'Origem sintetica',
      'destino': 'Destino sintetico',
      'valor_frete': 100,
    };
    final first = await FreightCreationIntentMemory.obtain(
      payload,
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    final restarted = await FreightCreationIntentMemory.obtain(
      Map<String, dynamic>.from(payload),
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    expect(restarted.clientRequestId, first.clientRequestId);
    expect(sequence, 1);
  });

  test('duas intencoes pendentes coexistem e concluir B preserva A', () async {
    var sequence = 0;
    final a = await FreightCreationIntentMemory.obtain(
      {'origem': 'A'},
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    await FreightCreationIntentMemory.markAmbiguous(a);
    final b = await FreightCreationIntentMemory.obtain(
      {'origem': 'B'},
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    await FreightCreationIntentMemory.complete(b);
    final recoveredA = await FreightCreationIntentMemory.obtain(
      {'origem': 'A'},
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    expect(recoveredA.clientRequestId, 'request-1');
    expect(sequence, 2);
  });

  test('usuario e tenant diferentes nao herdam a intencao anterior', () async {
    var sequence = 0;
    final payload = <String, dynamic>{'origem': 'A'};
    final a = await FreightCreationIntentMemory.obtain(
      payload,
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    final userB = await FreightCreationIntentMemory.obtain(
      payload,
      tenantId: 'tenant-a',
      userId: 'user-b',
      newId: () => 'request-${++sequence}',
    );
    final tenantB = await FreightCreationIntentMemory.obtain(
      payload,
      tenantId: 'tenant-b',
      userId: 'user-a',
      newId: () => 'request-${++sequence}',
    );
    expect({a.clientRequestId, userB.clientRequestId, tenantB.clientRequestId},
        hasLength(3));
  });

  test('frete confirmado sobrevive ao restart para retry apenas do upload',
      () async {
    final intent = await FreightCreationIntentMemory.obtain(
      {'origem': 'A'},
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'request-1',
    );
    await FreightCreationIntentMemory.markCreated(intent, 'freight-1');
    final recovered = await FreightCreationIntentMemory.obtain(
      {'origem': 'A'},
      tenantId: 'tenant-a',
      userId: 'user-a',
      newId: () => 'never',
    );
    expect(recovered.confirmedFreightId, 'freight-1');
    final serialized = secureValues.values.join();
    expect(serialized, isNot(contains('origem')));
    expect(serialized, isNot(contains('tenant-a')));
    expect(serialized, isNot(contains('user-a')));
  });

  test('ApiService preserva 401/403/409 e classifica 500 como ambiguo',
      () async {
    for (final status in <int>[401, 403, 409, 500]) {
      ApiService.setHttpClientForTesting(
        MockClient((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, endsWith('/fretes'));
          return http.Response(
            jsonEncode({'message': 'status-$status'}),
            status,
            headers: {'content-type': 'application/json'},
          );
        }),
      );
      final result = await ApiService.createFrete(<String, dynamic>{
        'client_request_id': '00000000-0000-4000-8000-000000000001',
      });
      expect(result['ok'], isFalse);
      expect(result['status'], status);
      expect(result['ambiguous'], status >= 500);
    }
  });

  test('falha de transporte e classificada como resultado ambiguo', () async {
    ApiService.setHttpClientForTesting(
      MockClient((_) async {
        throw const SocketException('offline');
      }),
    );
    final result = await ApiService.createFrete(<String, dynamic>{
      'client_request_id': '00000000-0000-4000-8000-000000000001',
    });
    expect(result['status'], 0);
    expect(result['ambiguous'], isTrue);
  });

  test('tela retoma frete confirmado e ambiente bloqueia criacao', () {
    final source = _read('lib/screens/add_frete_screen.dart');
    expect(source, contains('creationIntent.confirmedFreightId'));
    expect(source, contains('FreightCreationIntentMemory.markCreated'));
    expect(source, contains('FreightCreationIntentMemory.markAmbiguous'));
    expect(source, contains('Config.canCreateFreight'));
  });

  test('APK de homologacao tem identidade e marcador distintos', () {
    final gradle = _read('android/app/build.gradle.kts');
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    final main = _read('lib/main.dart');
    expect(gradle, contains('br.com.matopibalog.app.homologation'));
    expect(gradle, contains('Matopiba Log Homologacao'));
    expect(manifest, contains(r'android:label="${appLabel}"'));
    expect(main, contains('Config.environmentLabel'));
    expect(
        _read('lib/config.dart'),
        isNot(contains(
          'matopibalog-backend-production.up.railway.app',
        )));
  });

  test('menu Novo Frete respeita ambiente, plano e permissao efetiva', () {
    final src = _read('lib/screens/app_shell.dart');
    expect(src, contains('Config.canCreateFreight'));
    expect(src, contains("auth.can('freight.create')"));
  });
}
