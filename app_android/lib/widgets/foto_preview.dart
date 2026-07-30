import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/app_logger.dart';

/// Fallback manual ao scanner: captura uma foto pela CÂMERA e mostra um PREVIEW
/// no app antes de enviar — "Usar imagem" / "Refazer" / "Cancelar". Retorna o
/// caminho confirmado, ou null se o usuário cancelar (nada é enviado). Usado nos
/// fluxos de UPLOAD IMEDIATO (ePOD/documento no detalhe do frete), onde não há
/// formulário para revisar a imagem antes do envio.
///
/// Reusa `image_picker` (já instalado) — SEM nova dependência e SEM nova
/// permissão (a câmera é aberta por intent do sistema). A qualidade/limites
/// espelham os demais fluxos de foto do app (legibilidade preservada).
Future<String?> capturarFotoManualComPreview(
  BuildContext context, {
  int imageQuality = 75,
  double maxLado = 1800,
}) async {
  final picker = ImagePicker();

  while (true) {
    XFile? capturada;
    try {
      capturada = await picker.pickImage(
        source: ImageSource.camera,
        imageQuality: imageQuality,
        maxWidth: maxLado,
        maxHeight: maxLado,
      );
    } catch (e) {
      AppLogger.error('FotoPreview', 'falha ao acessar a câmera', e);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao acessar a câmera.')),
        );
      }
      return null;
    }

    if (capturada == null) return null; // fechou a câmera do sistema
    if (!context.mounted) return null;

    final acao = await Navigator.of(context).push<_AcaoPreview>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _FotoPreviewScreen(caminho: capturada!.path),
      ),
    );

    switch (acao) {
      case _AcaoPreview.usar:
        return capturada.path;
      case _AcaoPreview.refazer:
        continue; // volta a capturar
      case _AcaoPreview.cancelar:
      case null:
        return null;
    }
  }
}

enum _AcaoPreview { usar, refazer, cancelar }

class _FotoPreviewScreen extends StatelessWidget {
  final String caminho;
  const _FotoPreviewScreen({required this.caminho});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Revisar foto'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: 'Cancelar',
          onPressed: () => Navigator.pop(context, _AcaoPreview.cancelar),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: InteractiveViewer(
                child: Image.file(File(caminho), fit: BoxFit.contain),
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.white54),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Refazer'),
                      onPressed: () => Navigator.pop(context, _AcaoPreview.refazer),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      icon: const Icon(Icons.check),
                      label: const Text('Usar imagem'),
                      onPressed: () => Navigator.pop(context, _AcaoPreview.usar),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
