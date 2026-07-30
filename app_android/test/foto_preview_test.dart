import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Trava anti-regressão do fallback manual com preview (foto manual antes de
/// enviar). Testes ESTÁTICOS: leem os fontes e falham se o widget de preview, as
/// ações (Usar/Refazer/Cancelar) ou o wiring no fluxo de upload imediato do ePOD
/// sumirem. O plugin de câmera em si só se valida em device — aqui garantimos
/// que o preview existe e continua ligado.
String _ler(String caminho) {
  final f = File(caminho);
  expect(f.existsSync(), isTrue, reason: 'Arquivo esperado não existe: $caminho');
  return f.readAsStringSync();
}

void main() {
  group('Foto manual — widget de preview', () {
    test('foto_preview.dart existe com a função e as 3 ações', () {
      final src = _ler('lib/widgets/foto_preview.dart');
      expect(src.contains('capturarFotoManualComPreview'), isTrue,
          reason: 'A função de captura com preview sumiu.');
      expect(src.contains('Usar imagem'), isTrue, reason: 'Ação "Usar imagem" sumiu.');
      expect(src.contains('Refazer'), isTrue, reason: 'Ação "Refazer" sumiu.');
      expect(src.contains('Cancelar'), isTrue, reason: 'Ação "Cancelar" sumiu.');
      expect(src.contains('ImageSource.camera'), isTrue,
          reason: 'O preview deve capturar pela câmera.');
      expect(src.contains('image_picker'), isTrue,
          reason: 'Deve reusar image_picker (sem nova dependência).');
    });

    test('detalhe_viagem usa o preview no caminho de câmera (upload imediato)', () {
      final src = _ler('lib/screens/detalhe_viagem_screen.dart');
      expect(src.contains("widgets/foto_preview.dart"), isTrue,
          reason: 'A tela deixou de importar o preview de foto manual.');
      expect(src.contains('capturarFotoManualComPreview'), isTrue,
          reason: 'O caminho de câmera não usa mais o preview antes de enviar.');
    });
  });

  group('Scanner automático preservado (não quebrar o fluxo principal)', () {
    test('detalhe_viagem mantém scanner + demais origens', () {
      final src = _ler('lib/screens/detalhe_viagem_screen.dart');
      expect(src.contains('DocumentScannerService'), isTrue);
      expect(src.contains('Escanear documento'), isTrue);
      expect(src.contains('Tirar foto agora'), isTrue);
      expect(src.contains('Escolher da galeria'), isTrue);
      expect(src.contains('Anexar arquivo'), isTrue);
    });
  });
}
