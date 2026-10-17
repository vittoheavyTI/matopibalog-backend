import 'dart:convert';
import 'dart:io';

import 'package:chofer_log/services/api_service.dart';
import 'package:chofer_log/services/freight_creation_intent_memory.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  setUp(() {
    ApiService.resetForTesting();
    ApiService.setSessionToken('test-token');
    FreightCreationIntentMemory.clear();
  });

  tearDown(() {
    ApiService.resetForTesting();
    FreightCreationIntentMemory.clear();
  });

  test('criacao reutiliza a chave depois de reconstruir a tela', () {
    var sequence = 0;
    final payload = <String, dynamic>{
      'origem': 'Origem sintética',
      'destino': 'Destino sintético',
      'valor_frete': 100,
    };

    final first = FreightCreationIntentMemory.obtain(
      payload,
      newId: () => 'request-${++sequence}',
    );
    final remounted = FreightCreationIntentMemory.obtain(
      Map<String, dynamic>.from(payload),
      newId: () => 'request-${++sequence}',
    );

    expect(first, 'request-1');
    expect(remounted, first);
    expect(sequence, 1);
  });

  test('sucesso permite que a próxima intenção receba outra chave', () {
    var sequence = 0;
    final payload = <String, dynamic>{'origem': 'A'};
    final first = FreightCreationIntentMemory.obtain(
      payload,
      newId: () => 'request-${++sequence}',
    );
    FreightCreationIntentMemory.clear();
    final next = FreightCreationIntentMemory.obtain(
      payload,
      newId: () => 'request-${++sequence}',
    );
    expect(first, 'request-1');
    expect(next, 'request-2');
  });

  test('ApiService preserva status de rejeições e conflitos HTTP', () async {
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
      expect(result['ambiguous'], isNot(true));
    }
  });

  test('falha de transporte é classificada como resultado ambíguo', () async {
    ApiService.setHttpClientForTesting(
      MockClient((_) async {
        throw const SocketException('offline');
      }),
    );

    final result = await ApiService.createFrete(<String, dynamic>{
      'client_request_id': '00000000-0000-4000-8000-000000000001',
    });

    expect(result['ok'], isFalse);
    expect(result['status'], 0);
    expect(result['ambiguous'], isTrue);
    expect(result['message'], contains('Verifique sua internet'));
  });

  test('tela orienta a reconciliar criação ambígua sem duplicar', () {
    final source = File('lib/screens/add_frete_screen.dart').readAsStringSync();
    expect(source, contains("resultado['ambiguous'] == true"));
    expect(source, contains('reconciliar sem duplicar'));
  });

  test('menu Novo Frete respeita plano e permissão efetiva', () {
    final src = _read('lib/screens/app_shell.dart');
    expect(
      src.contains(
        "enabled: !finance.planoBloqueado && auth.can('freight.create')",
      ),
      isTrue,
    );
    expect(
      src.contains("finance.planoBloqueado || !auth.can('freight.create')"),
      isTrue,
    );
  });
}
