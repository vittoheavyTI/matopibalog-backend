enum DocumentScanDraftStatus { active, cancelled }

class DocumentScanPage {
  final String path;

  const DocumentScanPage({required this.path});
}

class DocumentScanDraft {
  final List<DocumentScanPage> pages;
  final DocumentScanDraftStatus status;

  const DocumentScanDraft({
    required this.pages,
    this.status = DocumentScanDraftStatus.active,
  });

  bool get isCancelled => status == DocumentScanDraftStatus.cancelled;
  bool get canUpload =>
      status == DocumentScanDraftStatus.active && pages.isNotEmpty;

  DocumentScanDraft cancel() => const DocumentScanDraft(
        pages: [],
        status: DocumentScanDraftStatus.cancelled,
      );

  DocumentScanDraft removeAt(int index) {
    if (index < 0 || index >= pages.length) return this;
    final next = List<DocumentScanPage>.from(pages)..removeAt(index);
    return DocumentScanDraft(pages: next, status: status);
  }

  DocumentScanDraft replaceAt(int index, DocumentScanPage page) {
    if (index < 0 || index >= pages.length) return this;
    final next = List<DocumentScanPage>.from(pages)..[index] = page;
    return DocumentScanDraft(pages: next, status: status);
  }

  DocumentScanDraft appendAll(Iterable<DocumentScanPage> novasPaginas) {
    return DocumentScanDraft(
      pages: [...pages, ...novasPaginas],
      status: status,
    );
  }

  DocumentScanDraft reorder(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= pages.length) return this;
    if (newIndex < 0 || newIndex > pages.length) return this;
    final next = List<DocumentScanPage>.from(pages);
    if (newIndex > oldIndex) newIndex -= 1;
    final item = next.removeAt(oldIndex);
    next.insert(newIndex, item);
    return DocumentScanDraft(pages: next, status: status);
  }

  DocumentScanDraft reorderAdjusted(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= pages.length) return this;
    if (newIndex < 0 || newIndex >= pages.length) return this;
    final next = List<DocumentScanPage>.from(pages);
    final item = next.removeAt(oldIndex);
    next.insert(newIndex, item);
    return DocumentScanDraft(pages: next, status: status);
  }
}
