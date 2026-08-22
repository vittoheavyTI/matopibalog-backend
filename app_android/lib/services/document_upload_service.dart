import 'dart:async';
import 'dart:io';

import 'package:uuid/uuid.dart';

enum DocumentUploadState {
  localReady,
  uploading,
  success,
  retryableError,
  nonRetryableError,
  authRequired,
  cancelled,
}

enum DocumentUploadFailureKind {
  none,
  offline,
  timeout,
  server,
  unauthorized,
  forbidden,
  payloadTooLarge,
  invalidMime,
  validation,
  unknown,
}

class DocumentUploadClassification {
  final DocumentUploadFailureKind kind;
  final bool retryable;
  final bool authRequired;
  final String message;

  const DocumentUploadClassification({
    required this.kind,
    required this.retryable,
    required this.authRequired,
    required this.message,
  });

  static const success = DocumentUploadClassification(
    kind: DocumentUploadFailureKind.none,
    retryable: false,
    authRequired: false,
    message: '',
  );

  static DocumentUploadClassification fromStatus(int status,
      {String? message}) {
    if (status == 401) {
      return const DocumentUploadClassification(
        kind: DocumentUploadFailureKind.unauthorized,
        retryable: false,
        authRequired: true,
        message: 'Sessao expirada. Entre novamente.',
      );
    }
    if (status == 403) {
      return const DocumentUploadClassification(
        kind: DocumentUploadFailureKind.forbidden,
        retryable: false,
        authRequired: false,
        message: 'Sem permissao para enviar este documento.',
      );
    }
    if (status == 413) {
      return const DocumentUploadClassification(
        kind: DocumentUploadFailureKind.payloadTooLarge,
        retryable: false,
        authRequired: false,
        message: 'Arquivo grande demais para envio.',
      );
    }
    if (status == 415) {
      return const DocumentUploadClassification(
        kind: DocumentUploadFailureKind.invalidMime,
        retryable: false,
        authRequired: false,
        message: 'Tipo de arquivo nao permitido.',
      );
    }
    if (status == 400 || status == 422) {
      return DocumentUploadClassification(
        kind: DocumentUploadFailureKind.validation,
        retryable: false,
        authRequired: false,
        message: message ?? 'Revise os dados do documento.',
      );
    }
    if (status == 0 || status == 408 || status == 429 || status >= 500) {
      return DocumentUploadClassification(
        kind: status == 0
            ? DocumentUploadFailureKind.offline
            : DocumentUploadFailureKind.server,
        retryable: true,
        authRequired: false,
        message: message ?? 'Falha temporaria. Tente novamente.',
      );
    }
    return DocumentUploadClassification(
      kind: DocumentUploadFailureKind.unknown,
      retryable: false,
      authRequired: false,
      message: message ?? 'Nao foi possivel enviar o documento.',
    );
  }

  static DocumentUploadClassification fromException(Object error) {
    if (error is TimeoutException) {
      return const DocumentUploadClassification(
        kind: DocumentUploadFailureKind.timeout,
        retryable: true,
        authRequired: false,
        message: 'Tempo esgotado. Tente novamente.',
      );
    }
    if (error is SocketException) {
      return const DocumentUploadClassification(
        kind: DocumentUploadFailureKind.offline,
        retryable: true,
        authRequired: false,
        message: 'Sem conexao. Tente novamente quando a internet voltar.',
      );
    }
    return const DocumentUploadClassification(
      kind: DocumentUploadFailureKind.unknown,
      retryable: true,
      authRequired: false,
      message: 'Falha temporaria. Tente novamente.',
    );
  }

  static DocumentUploadClassification fromApiResult(
      Map<String, dynamic> result) {
    if (result['ok'] == true) return success;
    final status = result['status'];
    final msg = result['message']?.toString();
    if (status is int) return fromStatus(status, message: msg);
    return fromStatus(0, message: msg);
  }
}

class DocumentUploadOperation {
  final String clientRequestId;
  final String filePath;
  final DocumentUploadState state;
  final DocumentUploadClassification? lastFailure;

  const DocumentUploadOperation({
    required this.clientRequestId,
    required this.filePath,
    this.state = DocumentUploadState.localReady,
    this.lastFailure,
  });

  factory DocumentUploadOperation.create(String filePath,
      {String? clientRequestId}) {
    return DocumentUploadOperation(
      clientRequestId: clientRequestId ?? const Uuid().v4(),
      filePath: filePath,
    );
  }

  DocumentUploadOperation copyWith({
    DocumentUploadState? state,
    DocumentUploadClassification? lastFailure,
  }) {
    return DocumentUploadOperation(
      clientRequestId: clientRequestId,
      filePath: filePath,
      state: state ?? this.state,
      lastFailure: lastFailure,
    );
  }
}

typedef DocumentUploader = Future<Map<String, dynamic>> Function(
  String filePath,
  String clientRequestId,
);

typedef DocumentListRefetcher = Future<void> Function();

class DocumentUploadController {
  DocumentUploadOperation operation;

  DocumentUploadController(this.operation);

  Future<DocumentUploadOperation> upload({
    required DocumentUploader uploader,
    DocumentListRefetcher? refetch,
  }) async {
    operation = operation.copyWith(state: DocumentUploadState.uploading);
    try {
      final result =
          await uploader(operation.filePath, operation.clientRequestId);
      final classification = DocumentUploadClassification.fromApiResult(result);
      if (classification.kind == DocumentUploadFailureKind.none) {
        operation = operation.copyWith(state: DocumentUploadState.success);
        if (refetch != null) await refetch();
        return operation;
      }
      operation = operation.copyWith(
        state: classification.authRequired
            ? DocumentUploadState.authRequired
            : classification.retryable
                ? DocumentUploadState.retryableError
                : DocumentUploadState.nonRetryableError,
        lastFailure: classification,
      );
      return operation;
    } catch (e) {
      final classification = DocumentUploadClassification.fromException(e);
      operation = operation.copyWith(
        state: classification.retryable
            ? DocumentUploadState.retryableError
            : DocumentUploadState.nonRetryableError,
        lastFailure: classification,
      );
      return operation;
    }
  }

  DocumentUploadOperation cancel() {
    operation = operation.copyWith(state: DocumentUploadState.cancelled);
    return operation;
  }
}
