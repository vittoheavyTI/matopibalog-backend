import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/document_pdf_service.dart';

const _onePixelPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

Future<File> _png(Directory dir, String name) async {
  final file = File('${dir.path}/$name.png');
  await file.writeAsBytes(base64Decode(_onePixelPng));
  return file;
}

void main() {
  test('gera PDF de uma pagina', () async {
    final dir = await Directory.systemTemp.createTemp('doc_pdf_single_');
    final page = await _png(dir, 'page_1');

    final result = await const DocumentPdfService().generateFromImages(
      [page.path],
      outputDirectory: dir,
      fileName: 'single.pdf',
    );

    expect(result.pageCount, 1);
    expect(result.originalSizeBytes, greaterThan(0));
    expect(result.uploadSizeBytes, greaterThan(0));
    expect(File(result.path).existsSync(), isTrue);
  });

  test('gera PDF multipagina na ordem recebida', () async {
    final dir = await Directory.systemTemp.createTemp('doc_pdf_multi_');
    final page1 = await _png(dir, 'page_1');
    final page2 = await _png(dir, 'page_2');

    final result = await const DocumentPdfService().generateFromImages(
      [page2.path, page1.path],
      outputDirectory: dir,
      fileName: 'multi.pdf',
    );

    expect(result.pageCount, 2);
    expect(result.uploadSizeBytes, greaterThan(0));
  });

  test('falha explicitamente quando nao ha paginas', () async {
    expect(
      () => const DocumentPdfService().generateFromImages([]),
      throwsArgumentError,
    );
  });
}
