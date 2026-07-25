import 'package:flutter/foundation.dart';
import 'package:cunning_document_scanner/cunning_document_scanner.dart';

import 'app_logger.dart';

enum DocumentScannerStatus { sucesso, cancelado, indisponivel, erro }

class DocumentScannerResult {
  final DocumentScannerStatus status;
  final List<String> caminhos;
  final String? mensagem;

  const DocumentScannerResult._({
    required this.status,
    this.caminhos = const [],
    this.mensagem,
  });

  const DocumentScannerResult.sucesso(List<String> caminhos)
      : this._(status: DocumentScannerStatus.sucesso, caminhos: caminhos);

  const DocumentScannerResult.cancelado()
      : this._(status: DocumentScannerStatus.cancelado);

  const DocumentScannerResult.indisponivel(String mensagem)
      : this._(
          status: DocumentScannerStatus.indisponivel,
          mensagem: mensagem,
        );

  const DocumentScannerResult.erro(String mensagem)
      : this._(status: DocumentScannerStatus.erro, mensagem: mensagem);

  bool get ok => status == DocumentScannerStatus.sucesso;
  bool get cancelado => status == DocumentScannerStatus.cancelado;
}

/// Wrapper isolado do scanner de documentos (ML Kit Document Scanner via
/// cunning_document_scanner).
///
/// Mantem o plugin concentrado num unico ponto e deixa as telas preservarem os
/// fluxos de fallback por camera, galeria e arquivo.
class DocumentScannerService {
  const DocumentScannerService._();

  /// Indica se a plataforma pode oferecer o scanner (ML Kit é Android). A UI
  /// futura usa isto para decidir se mostra a opção "Escanear"; em falha real de
  /// execução, [escanear] devolve null e o chamador cai no fluxo atual.
  static bool get suportado =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Future<DocumentScannerResult> escanearDocumento({
    int maxPaginas = 10,
    bool comoPdf = true,
  }) async {
    if (!suportado) {
      return const DocumentScannerResult.indisponivel(
        'Scanner disponível apenas no Android. Use câmera, galeria ou arquivo.',
      );
    }

    try {
      final caminhos = await CunningDocumentScanner.getPictures(
        noOfPages: maxPaginas,
        androidScannerMode: AndroidScannerMode.full,
        asPdf: comoPdf,
      );
      if (caminhos == null || caminhos.isEmpty) {
        return const DocumentScannerResult.cancelado();
      }
      return DocumentScannerResult.sucesso(caminhos);
    } on CunningDocumentScannerException catch (e) {
      AppLogger.error(
        'DocumentScannerService',
        'scanner indisponivel: ${e.code ?? e.message}',
        e,
      );
      return const DocumentScannerResult.indisponivel(
        'Não foi possível abrir o scanner. Use câmera, galeria ou arquivo.',
      );
    } catch (e) {
      AppLogger.error(
          'DocumentScannerService', 'falha ao escanear documento', e);
      return const DocumentScannerResult.erro(
        'Não foi possível escanear o documento. Use câmera, galeria ou arquivo.',
      );
    }
  }

  /// Abre a UI nativa de digitalização (detecção de borda, crop e realce) e
  /// retorna os caminhos das páginas escaneadas — ou o caminho de um único PDF
  /// quando [comoPdf] for true. Retorna null se o usuário cancelar ou se o
  /// scanner não estiver disponível/der erro no aparelho (nesse caso a tela deve
  /// usar o fluxo atual de câmera/galeria/arquivo).
  static Future<List<String>?> escanear({
    int maxPaginas = 10,
    bool comoPdf = false,
  }) async {
    final resultado = await escanearDocumento(
      maxPaginas: maxPaginas,
      comoPdf: comoPdf,
    );
    return resultado.ok ? resultado.caminhos : null;
  }
}
