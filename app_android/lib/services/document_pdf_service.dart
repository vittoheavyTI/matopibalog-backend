import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

class DocumentPdfResult {
  final String path;
  final int originalSizeBytes;
  final int uploadSizeBytes;
  final int pageCount;

  const DocumentPdfResult({
    required this.path,
    required this.originalSizeBytes,
    required this.uploadSizeBytes,
    required this.pageCount,
  });
}

class DocumentPdfService {
  const DocumentPdfService();

  Future<DocumentPdfResult> generateFromImages(
    List<String> imagePaths, {
    Directory? outputDirectory,
    String? fileName,
  }) async {
    if (imagePaths.isEmpty) {
      throw ArgumentError.value(
          imagePaths, 'imagePaths', 'Informe ao menos uma pagina.');
    }

    final pdf = pw.Document(compress: true);
    var originalSizeBytes = 0;

    for (final imagePath in imagePaths) {
      final file = File(imagePath);
      final bytes = await file.readAsBytes();
      originalSizeBytes += bytes.length;
      final image = pw.MemoryImage(bytes);
      pdf.addPage(
        pw.Page(
          pageFormat: PdfPageFormat.a4,
          margin: const pw.EdgeInsets.all(24),
          build: (_) => pw.Center(
            child: pw.Image(image, fit: pw.BoxFit.contain),
          ),
        ),
      );
    }

    final dir = outputDirectory ?? await getTemporaryDirectory();
    await dir.create(recursive: true);
    final safeFileName = _safePdfName(fileName);
    final output = File(p.join(dir.path, safeFileName));
    final pdfBytes = await pdf.save();
    await output.writeAsBytes(pdfBytes, flush: true);
    return DocumentPdfResult(
      path: output.path,
      originalSizeBytes: originalSizeBytes,
      uploadSizeBytes: pdfBytes.length,
      pageCount: imagePaths.length,
    );
  }

  String _safePdfName(String? fileName) {
    final raw = (fileName == null || fileName.trim().isEmpty)
        ? 'documento_${DateTime.now().microsecondsSinceEpoch}.pdf'
        : fileName.trim();
    final withExt = raw.toLowerCase().endsWith('.pdf') ? raw : '$raw.pdf';
    return withExt.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  }
}
