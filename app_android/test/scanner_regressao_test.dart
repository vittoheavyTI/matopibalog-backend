import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Trava anti-regressão do Scanner de documentos.
///
/// O scanner (ML Kit Document Scanner via `cunning_document_scanner`) já
/// desapareceu uma vez por nunca ter sido integrado à main. Estes testes são
/// ESTÁTICOS: leem os fontes e falham se a opção de escanear, o serviço, a
/// dependência ou os fluxos de fallback forem removidos — pegando a regressão
/// no CI/`flutter test`, sem precisar de device.
///
/// Rodam a partir da raiz do pacote (app_android), então os caminhos são
/// relativos a ela.
String _ler(String caminho) {
  final f = File(caminho);
  expect(f.existsSync(), isTrue, reason: 'Arquivo esperado não existe: $caminho');
  return f.readAsStringSync();
}

void main() {
  group('Scanner — dependência e serviço', () {
    test('pubspec declara cunning_document_scanner', () {
      final pubspec = _ler('pubspec.yaml');
      expect(
        pubspec.contains('cunning_document_scanner'),
        isTrue,
        reason: 'A dependência do scanner sumiu do pubspec.yaml.',
      );
    });

    test('DocumentScannerService existe com API e guard de plataforma', () {
      final svc = _ler('lib/services/document_scanner_service.dart');
      expect(svc.contains('class DocumentScannerService'), isTrue);
      expect(svc.contains('escanearDocumento'), isTrue,
          reason: 'O método público escanearDocumento sumiu.');
      // Guard: scanner é Android-only e não pode quebrar outras plataformas.
      expect(svc.contains('TargetPlatform.android'), isTrue,
          reason: 'O guard de plataforma (Android) do scanner sumiu.');
      expect(svc.contains('cunning_document_scanner'), isTrue);
    });
  });

  group('Scanner — acesso na UI (as 4 telas que anexam documento)', () {
    const telas = <String, String>{
      'lib/screens/detalhe_viagem_screen.dart': 'Escanear documento',
      'lib/screens/add_frete_screen.dart': 'Escanear documento',
      'lib/screens/add_despesa_screen.dart': 'Escanear comprovante',
      'lib/screens/add_abastecimento_screen.dart': 'Escanear comprovante',
    };

    for (final entry in telas.entries) {
      final tela = entry.key;
      final textoScanner = entry.value;
      test('$tela importa o serviço e oferece "$textoScanner"', () {
        final src = _ler(tela);
        expect(
          src.contains("services/document_scanner_service.dart"),
          isTrue,
          reason: 'A tela deixou de importar o DocumentScannerService.',
        );
        expect(
          src.contains(textoScanner),
          isTrue,
          reason: 'O item de menu "$textoScanner" sumiu de $tela.',
        );
      });
    }
  });

  group('Scanner — fallback preservado (não remover o que já funcionava)', () {
    test('detalhe_viagem mantém câmera, galeria e arquivo', () {
      final src = _ler('lib/screens/detalhe_viagem_screen.dart');
      expect(src.contains('Tirar foto agora'), isTrue);
      expect(src.contains('Escolher da galeria'), isTrue);
      expect(src.contains('Anexar arquivo'), isTrue);
    });

    test('add_frete mantém anexo por arquivo', () {
      final src = _ler('lib/screens/add_frete_screen.dart');
      expect(src.contains('Anexar arquivo'), isTrue);
      expect(src.contains('FilePicker'), isTrue);
    });

    test('add_despesa e add_abastecimento mantêm câmera/galeria', () {
      for (final tela in const [
        'lib/screens/add_despesa_screen.dart',
        'lib/screens/add_abastecimento_screen.dart',
      ]) {
        final src = _ler(tela);
        expect(src.contains('Tirar Foto'), isTrue, reason: '$tela perdeu a câmera.');
        expect(src.contains('Escolher da Galeria'), isTrue,
            reason: '$tela perdeu a galeria.');
      }
    });
  });

  group('Scanner — permissões Android', () {
    // Nuance documentada: o ML Kit Document Scanner roda numa Activity do Google
    // Play Services (play-services-mlkit-document-scanner), então o APP não
    // precisa declarar android.permission.CAMERA — a captura é do GMS. O
    // image_picker (câmera do fallback) também usa intent do app de câmera, sem
    // exigir a permissão declarada. O que precisa existir é INTERNET (upload).
    test('AndroidManifest mantém INTERNET (upload dos documentos)', () {
      final manifest = _ler('android/app/src/main/AndroidManifest.xml');
      expect(manifest.contains('android.permission.INTERNET'), isTrue,
          reason: 'A permissão INTERNET (upload) sumiu do AndroidManifest.');
    });
  });
}
