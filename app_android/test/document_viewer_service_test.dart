import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/document_viewer_service.dart';

void main() {
  test('signed URL expirada dispara refresh antes da previa', () async {
    var signedUrlCalls = 0;
    final downloads = <String>[];

    final result = await const DocumentViewerService().preparePreview(
      fileName: 'documento.pdf',
      mime: 'application/pdf',
      signedUrlProvider: () async {
        signedUrlCalls++;
        return 'https://signed-url-$signedUrlCalls';
      },
      downloader: (url, _) async {
        downloads.add(url);
        if (downloads.length == 1) {
          return const DocumentDownloadResult(statusCode: 403);
        }
        return const DocumentDownloadResult(
            path: '/tmp/documento.pdf', statusCode: 200);
      },
    );

    expect(result?.path, '/tmp/documento.pdf');
    expect(signedUrlCalls, 2);
    expect(downloads, ['https://signed-url-1', 'https://signed-url-2']);
  });

  test('falha nao expiravel nao fica renovando signed URL', () async {
    var signedUrlCalls = 0;

    final result = await const DocumentViewerService().preparePreview(
      fileName: 'documento.pdf',
      signedUrlProvider: () async {
        signedUrlCalls++;
        return 'https://signed-url';
      },
      downloader: (_, __) async =>
          const DocumentDownloadResult(statusCode: 500),
    );

    expect(result, isNull);
    expect(signedUrlCalls, 1);
  });
}
