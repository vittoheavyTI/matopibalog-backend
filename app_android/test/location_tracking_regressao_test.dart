import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

String _ler(String caminho) {
  final f = File(caminho);
  expect(f.existsSync(), isTrue, reason: 'Arquivo esperado nao existe: $caminho');
  return f.readAsStringSync();
}

void main() {
  group('Rastreamento - permissao unica e cards passivos', () {
    test('Home e detalhe nao exibem card passivo de ultima localizacao enviada', () {
      final home = _ler('lib/screens/home_screen.dart');
      final detalhe = _ler('lib/screens/detalhe_viagem_screen.dart');

      expect(home.contains("Text('Ultima localizacao enviada'"), isFalse);
      expect(detalhe.contains("Text('Ultima localizacao enviada'"), isFalse);
      expect(home.contains('Localizacao precisa de atencao'), isTrue);
      expect(detalhe.contains('Localizacao precisa de atencao'), isTrue);
    });

    test('criacao de frete nao solicita permissao Android por frete', () {
      final addFrete = _ler('lib/screens/add_frete_screen.dart');

      expect(addFrete.contains('Compartilhar localizacao da viagem?'), isFalse);
      expect(addFrete.contains('prepareForTripStart(requestPermission: false)'), isTrue);
    });

    test('servico central inicia sem pedir permissao automaticamente', () {
      final service = _ler('lib/services/location_tracking_service.dart');

      expect(service.contains('bool requestPermission = false'), isTrue);
      expect(service.contains('shouldShowPermissionOnboarding'), isTrue);
      expect(service.contains('requestPermissionFromOnboarding'), isTrue);
      expect(service.contains('LocationAccuracyStatus.reduced'), isTrue);
    });

    test('onboarding de localizacao fica no shell depois do login', () {
      final shell = _ler('lib/screens/app_shell.dart');

      expect(shell.contains('_onboardLocationPermissionIfNeeded'), isTrue);
      expect(shell.contains('nao sera necessario autorizar de novo para cada frete'), isTrue);
      expect(shell.contains('requestPermissionFromOnboarding'), isTrue);
    });
  });

  group('Comprovante de entrega - vocabulario do motorista', () {
    test('detalhe usa comprovante/arquivos e nao mostra Evidencias no titulo ou botao', () {
      final detalhe = _ler('lib/screens/detalhe_viagem_screen.dart');

      expect(detalhe.contains('Arquivos enviados'), isTrue);
      expect(detalhe.contains('Adicionar comprovante'), isTrue);
      expect(detalhe.contains("Text('Evidências"), isFalse);
      expect(detalhe.contains("'Adicionar evidência'"), isFalse);
      expect(detalhe.contains('Limite de 10 arquivos'), isTrue);
    });
  });
}
