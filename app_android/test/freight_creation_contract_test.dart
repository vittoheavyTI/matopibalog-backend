import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  test('criacao de frete envia chave estavel por tela', () {
    final src = _read('lib/screens/add_frete_screen.dart');
    expect(src.contains("final String _clientRequestId = const Uuid().v4()"), isTrue);
    expect(src.contains("'client_request_id': _clientRequestId"), isTrue);
  });

  test('menu Novo Frete respeita plano e permissao efetiva', () {
    final src = _read('lib/screens/app_shell.dart');
    expect(
      src.contains("enabled: !finance.planoBloqueado && auth.can('freight.create')"),
      isTrue,
    );
    expect(
      src.contains("finance.planoBloqueado || !auth.can('freight.create')"),
      isTrue,
    );
  });

  test('ApiService aceita resposta idempotente no contrato HTTP 201', () {
    final src = _read('lib/services/api_service.dart');
    expect(src.contains('response.statusCode == 201'), isTrue);
  });
}
