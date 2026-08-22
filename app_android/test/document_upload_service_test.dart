import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/document_upload_service.dart';

void main() {
  test('retry da mesma operacao reutiliza client_request_id', () async {
    final seen = <String>[];
    final controller = DocumentUploadController(
      DocumentUploadOperation.create('doc.pdf',
          clientRequestId: 'op-estavel-123'),
    );

    await controller.upload(
      uploader: (_, clientRequestId) async {
        seen.add(clientRequestId);
        return {'ok': false, 'status': 0, 'message': 'timeout'};
      },
    );
    await controller.upload(
      uploader: (_, clientRequestId) async {
        seen.add(clientRequestId);
        return {'ok': true, 'idempotent': true};
      },
    );

    expect(seen, ['op-estavel-123', 'op-estavel-123']);
    expect(controller.operation.state, DocumentUploadState.success);
  });

  test('nova operacao deliberada recebe novo client_request_id', () {
    final a = DocumentUploadOperation.create('doc.pdf');
    final b = DocumentUploadOperation.create('doc.pdf');

    expect(a.clientRequestId, isNot(b.clientRequestId));
  });

  test(
      'timeout apos sucesso do servidor converge via replay idempotente e refetch',
      () async {
    var calls = 0;
    var refetches = 0;
    final controller = DocumentUploadController(
      DocumentUploadOperation.create('doc.pdf',
          clientRequestId: 'upload-timeout-123'),
    );

    await controller.upload(
      uploader: (_, __) async {
        calls++;
        throw TimeoutException('lost response');
      },
    );
    expect(controller.operation.state, DocumentUploadState.retryableError);

    await controller.upload(
      uploader: (_, clientRequestId) async {
        calls++;
        expect(clientRequestId, 'upload-timeout-123');
        return {'ok': true, 'idempotent': true};
      },
      refetch: () async => refetches++,
    );

    expect(calls, 2);
    expect(refetches, 1);
    expect(controller.operation.state, DocumentUploadState.success);
  });

  test('classifica offline, 401, 403, 413 e MIME invalido', () {
    expect(
      DocumentUploadClassification.fromException(
              const SocketException('offline'))
          .kind,
      DocumentUploadFailureKind.offline,
    );
    expect(DocumentUploadClassification.fromStatus(401).authRequired, isTrue);
    expect(DocumentUploadClassification.fromStatus(403).retryable, isFalse);
    expect(
      DocumentUploadClassification.fromStatus(413).kind,
      DocumentUploadFailureKind.payloadTooLarge,
    );
    expect(
      DocumentUploadClassification.fromStatus(415).kind,
      DocumentUploadFailureKind.invalidMime,
    );
  });
}
