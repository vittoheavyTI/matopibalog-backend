import 'dart:io';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/document_viewer_service.dart';

class DocumentPreviewScreen extends StatefulWidget {
  final String title;
  final String fileName;
  final String? mime;
  final String? localPath;
  final Future<String?> Function()? signedUrlProvider;
  final String tempScope;
  final bool allowExternalActions;

  const DocumentPreviewScreen.local({
    super.key,
    required this.title,
    required this.fileName,
    required this.localPath,
    this.mime,
    this.allowExternalActions = false,
  })  : signedUrlProvider = null,
        tempScope = 'local_preview';

  const DocumentPreviewScreen.remote({
    super.key,
    required this.title,
    required this.fileName,
    required this.signedUrlProvider,
    required this.tempScope,
    this.mime,
    this.allowExternalActions = true,
  }) : localPath = null;

  @override
  State<DocumentPreviewScreen> createState() => _DocumentPreviewScreenState();
}

class _DocumentPreviewScreenState extends State<DocumentPreviewScreen> {
  DocumentPreviewFile? _file;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (widget.localPath != null) {
        _file = DocumentPreviewFile(
          path: widget.localPath!,
          name: widget.fileName,
          mime: widget.mime,
        );
      } else {
        _file = await const DocumentViewerService().preparePreview(
          signedUrlProvider: widget.signedUrlProvider!,
          fileName: widget.fileName,
          mime: widget.mime,
          downloader: (signedUrl, fileName) =>
              ApiService.baixarDocumentoParaTempResult(
            signedUrl,
            fileName,
            scope: widget.tempScope,
          ),
        );
      }
      if (_file == null) {
        _error = 'Não foi possível carregar a prévia.';
      }
    } catch (e) {
      AppLogger.error('DocumentPreviewScreen', 'load preview', e);
      _error = 'Não foi possível carregar a prévia.';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _isPdf {
    final mime = widget.mime?.toLowerCase() ?? '';
    final name = widget.fileName.toLowerCase();
    return mime.contains('pdf') || name.endsWith('.pdf');
  }

  bool get _isImage {
    final mime = widget.mime?.toLowerCase() ?? '';
    final name = widget.fileName.toLowerCase();
    return mime.startsWith('image/') ||
        name.endsWith('.jpg') ||
        name.endsWith('.jpeg') ||
        name.endsWith('.png') ||
        name.endsWith('.webp');
  }

  Future<void> _share({bool saveIntent = false}) async {
    final file = _file;
    if (file == null) return;
    await Share.shareXFiles(
      [XFile(file.path, mimeType: widget.mime, name: widget.fileName)],
      subject: saveIntent ? 'Salvar ${widget.fileName}' : widget.fileName,
      text: saveIntent ? 'Salvar documento' : null,
    );
  }

  Future<void> _openExternal() async {
    final file = _file;
    if (file == null) return;
    final uri = Uri.file(file.path);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir em outro app.')),
      );
    }
  }

  Widget _buildPreview() {
    final file = _file;
    if (file == null) {
      return Center(
          child: Text(_error ?? 'Não foi possível carregar a prévia.'));
    }
    if (_isPdf) {
      return PdfPreview(
        build: (_) => File(file.path).readAsBytes(),
        allowPrinting: false,
        allowSharing: false,
        canChangeOrientation: false,
        canChangePageFormat: false,
        canDebug: false,
      );
    }
    if (_isImage) {
      return InteractiveViewer(
        child: Center(
          child: Image.file(
            File(file.path),
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) =>
                const Text('Não foi possível exibir a imagem.'),
          ),
        ),
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.insert_drive_file_outlined, size: 42),
            const SizedBox(height: 12),
            Text(widget.fileName, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            const Text(
              'Prévia interna disponível para PDF e imagem.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final actionsEnabled =
        widget.allowExternalActions && _file != null && !_loading;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title, overflow: TextOverflow.ellipsis),
        actions: [
          if (widget.signedUrlProvider != null)
            IconButton(
              tooltip: 'Atualizar',
              icon: const Icon(Icons.refresh),
              onPressed: _loading ? null : _load,
            ),
          IconButton(
            tooltip: 'Salvar',
            icon: const Icon(Icons.save_alt_outlined),
            onPressed: actionsEnabled ? () => _share(saveIntent: true) : null,
          ),
          IconButton(
            tooltip: 'Compartilhar',
            icon: const Icon(Icons.ios_share),
            onPressed: actionsEnabled ? _share : null,
          ),
          IconButton(
            tooltip: 'Abrir externamente',
            icon: const Icon(Icons.open_in_new),
            onPressed: actionsEnabled ? _openExternal : null,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _buildPreview(),
    );
  }
}
