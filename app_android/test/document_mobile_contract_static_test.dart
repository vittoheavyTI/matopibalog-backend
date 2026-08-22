import 'dart:io';

import 'package:chofer_log/screens/detalhe_viagem_screen.dart';
import 'package:chofer_log/screens/document_preview_screen.dart';
import 'package:chofer_log/screens/document_scan_review_screen.dart';
import 'package:flutter_test/flutter_test.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  test('detalhe do frete usa preview interno antes das acoes externas', () {
    final src = _read('lib/screens/detalhe_viagem_screen.dart');
    expect(src.contains('DocumentPreviewScreen.remote'), isTrue);
    expect(src.contains('DocumentScanReviewScreen'), isTrue);
    expect(src.contains('DocumentUploadOperation.create'), isTrue);
  });

  test('ApiService envia contrato v2 e client_request_id para documentos/ePOD',
      () {
    final src = _read('lib/services/api_service.dart');
    expect(src.contains("request.fields['client_request_id']"), isTrue);
    expect(src.contains("request.fields['document_contract_version']"), isTrue);
    expect(
        src.contains(
            'response.statusCode == 200 || response.statusCode == 201'),
        isTrue);
  });

  test('pubspec declara PDF_PACKAGE e viewer interno', () {
    final pubspec = _read('pubspec.yaml');
    expect(pubspec.contains('pdf:'), isTrue);
    expect(pubspec.contains('printing:'), isTrue);
  });

  test('telas mobile de documentos compilam', () {
    expect(DetalheViagemScreen, isNotNull);
    expect(DocumentPreviewScreen, isNotNull);
    expect(DocumentScanReviewScreen, isNotNull);
  });
}
