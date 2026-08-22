import 'dart:io';
import 'dart:math';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class DocumentDownloadResult {
  final String? path;
  final int? statusCode;

  const DocumentDownloadResult({this.path, this.statusCode});

  bool get ok => path != null && path!.isNotEmpty;
  bool get shouldRefreshSignedUrl =>
      statusCode == null ||
      statusCode == 401 ||
      statusCode == 403 ||
      statusCode == 404 ||
      statusCode == 408 ||
      statusCode == 410;
}

class DocumentPreviewFile {
  final String path;
  final String name;
  final String? mime;

  const DocumentPreviewFile({
    required this.path,
    required this.name,
    this.mime,
  });
}

typedef SignedUrlProvider = Future<String?> Function();
typedef SignedUrlDownloader = Future<DocumentDownloadResult> Function(
    String signedUrl, String fileName);

class DocumentViewerService {
  const DocumentViewerService();

  Future<DocumentPreviewFile?> preparePreview({
    required SignedUrlProvider signedUrlProvider,
    required SignedUrlDownloader downloader,
    required String fileName,
    String? mime,
  }) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      final signedUrl = await signedUrlProvider();
      if (signedUrl == null || signedUrl.isEmpty) return null;
      final result = await downloader(signedUrl, fileName);
      if (result.ok) {
        return DocumentPreviewFile(
          path: result.path!,
          name: fileName,
          mime: mime,
        );
      }
      if (!result.shouldRefreshSignedUrl) return null;
    }
    return null;
  }
}

class DocumentTempFileManager {
  const DocumentTempFileManager();

  Future<Directory> scopedTempDirectory(String scope) async {
    final root = await getTemporaryDirectory();
    final safeScope = scope.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final dir = Directory(p.join(root.path, 'matopiba_docs', safeScope));
    await dir.create(recursive: true);
    return dir;
  }

  Future<File> writeBytes({
    required List<int> bytes,
    required String fileName,
    required String scope,
  }) async {
    final dir = await scopedTempDirectory(scope);
    final random = Random.secure().nextInt(1 << 32).toRadixString(16);
    final safeName = fileName.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    final file = File(
      p.join(
        dir.path,
        '${DateTime.now().microsecondsSinceEpoch}_${random}_$safeName',
      ),
    );
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Future<int> cleanupOld({
    required String scope,
    Duration olderThan = const Duration(hours: 24),
  }) async {
    final dir = await scopedTempDirectory(scope);
    if (!await dir.exists()) return 0;
    final cutoff = DateTime.now().subtract(olderThan);
    var deleted = 0;
    await for (final entity in dir.list(followLinks: false)) {
      if (entity is! File) continue;
      final stat = await entity.stat();
      if (stat.modified.isAfter(cutoff)) continue;
      try {
        await entity.delete();
        deleted++;
      } catch (_) {}
    }
    return deleted;
  }
}
