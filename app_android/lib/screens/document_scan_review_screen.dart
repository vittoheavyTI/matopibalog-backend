import 'dart:io';

import 'package:flutter/material.dart';

import '../services/document_pdf_service.dart';
import '../services/document_scan_draft.dart';
import '../services/document_scanner_service.dart';

class DocumentScanReviewResult {
  final String pdfPath;
  final int pageCount;
  final int originalSizeBytes;
  final int uploadSizeBytes;

  const DocumentScanReviewResult({
    required this.pdfPath,
    required this.pageCount,
    required this.originalSizeBytes,
    required this.uploadSizeBytes,
  });
}

class DocumentScanReviewScreen extends StatefulWidget {
  final List<String> initialPages;
  final String fileName;

  const DocumentScanReviewScreen({
    super.key,
    required this.initialPages,
    required this.fileName,
  });

  @override
  State<DocumentScanReviewScreen> createState() =>
      _DocumentScanReviewScreenState();
}

class _DocumentScanReviewScreenState extends State<DocumentScanReviewScreen> {
  late DocumentScanDraft _draft;
  bool _processing = false;

  @override
  void initState() {
    super.initState();
    _draft = DocumentScanDraft(
      pages: widget.initialPages
          .map((path) => DocumentScanPage(path: path))
          .toList(),
    );
  }

  Future<void> _retake(int index) async {
    final result = await DocumentScannerService.escanearDocumento(
      maxPaginas: 1,
      comoPdf: false,
    );
    if (!mounted || result.cancelado) return;
    if (!result.ok || result.caminhos.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content:
              Text(result.mensagem ?? 'Não foi possível refazer a página.'),
        ),
      );
      return;
    }
    setState(() {
      _draft = _draft.replaceAt(
          index, DocumentScanPage(path: result.caminhos.first));
    });
  }

  Future<void> _confirm() async {
    if (!_draft.canUpload || _processing) return;
    setState(() => _processing = true);
    try {
      final result = await const DocumentPdfService().generateFromImages(
        _draft.pages.map((page) => page.path).toList(),
        fileName: widget.fileName,
      );
      if (!mounted) return;
      Navigator.pop(
        context,
        DocumentScanReviewResult(
          pdfPath: result.path,
          pageCount: result.pageCount,
          originalSizeBytes: result.originalSizeBytes,
          uploadSizeBytes: result.uploadSizeBytes,
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível gerar o PDF.')),
      );
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = _draft.pages;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Revisar documento'),
        actions: [
          TextButton(
            onPressed: _processing || pages.isEmpty ? null : _confirm,
            child: _processing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Enviar'),
          ),
        ],
      ),
      body: pages.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.document_scanner_outlined, size: 40),
                    const SizedBox(height: 12),
                    const Text('Nenhuma página selecionada.'),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancelar'),
                    ),
                  ],
                ),
              ),
            )
          : ReorderableListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: pages.length,
              onReorderItem: (oldIndex, newIndex) {
                setState(
                  () => _draft = _draft.reorderAdjusted(oldIndex, newIndex),
                );
              },
              itemBuilder: (context, index) {
                final page = pages[index];
                return Card(
                  key: ValueKey('${page.path}-$index'),
                  child: ListTile(
                    leading: ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: Image.file(
                        File(page.path),
                        width: 52,
                        height: 68,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const SizedBox(
                          width: 52,
                          height: 68,
                          child: Icon(Icons.description_outlined),
                        ),
                      ),
                    ),
                    title: Text('Página ${index + 1}'),
                    subtitle: const Text('Arraste para reordenar'),
                    trailing: Wrap(
                      spacing: 2,
                      children: [
                        IconButton(
                          tooltip: 'Refazer página',
                          icon: const Icon(Icons.camera_alt_outlined),
                          onPressed: _processing ? null : () => _retake(index),
                        ),
                        IconButton(
                          tooltip: 'Remover página',
                          icon: const Icon(Icons.delete_outline),
                          onPressed: _processing
                              ? null
                              : () => setState(
                                  () => _draft = _draft.removeAt(index)),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _processing ? null : () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                  label: const Text('Cancelar'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _processing || pages.isEmpty ? null : _confirm,
                  icon: const Icon(Icons.picture_as_pdf_outlined),
                  label: const Text('Gerar PDF'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
