import 'package:flutter/foundation.dart';
import 'package:cunning_document_scanner/cunning_document_scanner.dart';

import 'app_logger.dart';

/// Wrapper isolado do scanner de documentos (ML Kit Document Scanner via
/// cunning_document_scanner).
///
/// POC: este serviço concentra o plugin num único ponto e AINDA NÃO está ligado
/// a nenhuma tela. Ele existe para validar o build (dependência resolve, analyze
/// passa, e depois o Codemagic Android) sem tocar no fluxo atual de anexo de
/// documentos por câmera/galeria/arquivo — que permanece como fluxo principal e
/// fallback. A integração na UI virá numa etapa posterior, com autorização.
class DocumentScannerService {
  const DocumentScannerService._();

  /// Indica se a plataforma pode oferecer o scanner (ML Kit é Android). A UI
  /// futura usa isto para decidir se mostra a opção "Escanear"; em falha real de
  /// execução, [escanear] devolve null e o chamador cai no fluxo atual.
  static bool get suportado =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// Abre a UI nativa de digitalização (detecção de borda, crop e realce) e
  /// retorna os caminhos das páginas escaneadas — ou o caminho de um único PDF
  /// quando [comoPdf] for true. Retorna null se o usuário cancelar ou se o
  /// scanner não estiver disponível/der erro no aparelho (nesse caso a tela deve
  /// usar o fluxo atual de câmera/galeria/arquivo).
  static Future<List<String>?> escanear({
    int maxPaginas = 10,
    bool comoPdf = false,
  }) async {
    try {
      return await CunningDocumentScanner.getPictures(
        noOfPages: maxPaginas,
        androidScannerMode: AndroidScannerMode.full,
        asPdf: comoPdf,
      );
    } catch (e) {
      AppLogger.error('DocumentScannerService', 'falha ao escanear documento', e);
      return null;
    }
  }
}
