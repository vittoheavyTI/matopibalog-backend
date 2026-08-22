import 'package:flutter_test/flutter_test.dart';
import 'package:chofer_log/services/document_scan_draft.dart';

void main() {
  test('multipage permite reorder e remove sem perder ordem das demais paginas',
      () {
    var draft = const DocumentScanDraft(
      pages: [
        DocumentScanPage(path: 'pagina_1.jpg'),
        DocumentScanPage(path: 'pagina_2.jpg'),
        DocumentScanPage(path: 'pagina_3.jpg'),
      ],
    );

    draft = draft.reorder(0, 3);
    expect(draft.pages.map((p) => p.path), [
      'pagina_2.jpg',
      'pagina_3.jpg',
      'pagina_1.jpg',
    ]);

    draft = draft.removeAt(1);
    expect(draft.pages.map((p) => p.path), ['pagina_2.jpg', 'pagina_1.jpg']);
    expect(draft.canUpload, isTrue);
  });

  test('retake substitui somente a pagina escolhida', () {
    final draft = const DocumentScanDraft(
      pages: [
        DocumentScanPage(path: 'pagina_1.jpg'),
        DocumentScanPage(path: 'pagina_2.jpg'),
      ],
    ).replaceAt(1, const DocumentScanPage(path: 'pagina_2_refeita.jpg'));

    expect(draft.pages.map((p) => p.path), [
      'pagina_1.jpg',
      'pagina_2_refeita.jpg',
    ]);
  });

  test('reorderAdjusted usa indice novo ja ajustado pelo Flutter', () {
    final draft = const DocumentScanDraft(
      pages: [
        DocumentScanPage(path: 'pagina_1.jpg'),
        DocumentScanPage(path: 'pagina_2.jpg'),
        DocumentScanPage(path: 'pagina_3.jpg'),
      ],
    ).reorderAdjusted(0, 2);

    expect(draft.pages.map((p) => p.path), [
      'pagina_2.jpg',
      'pagina_3.jpg',
      'pagina_1.jpg',
    ]);
  });

  test('cancel before upload bloqueia envio', () {
    final draft = const DocumentScanDraft(
      pages: [DocumentScanPage(path: 'pagina_1.jpg')],
    ).cancel();

    expect(draft.isCancelled, isTrue);
    expect(draft.canUpload, isFalse);
  });
}
