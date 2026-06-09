import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/offline_sync.dart';

class AddAbastecimentoScreen extends StatefulWidget {
  const AddAbastecimentoScreen({super.key});

  @override
  State<AddAbastecimentoScreen> createState() => _AddAbastecimentoScreenState();
}

class _AddAbastecimentoScreenState extends State<AddAbastecimentoScreen> {
  final _litrosCtrl = TextEditingController();
  final _valorTotalCtrl = TextEditingController();
  final _arlaLitrosCtrl = TextEditingController();
  final _arlaValorCtrl = TextEditingController();
  final _postoCtrl = TextEditingController();
  String _quemPagou = 'proprietario';
  File? _image;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'add_abastecimento'});
  }

  @override
  void dispose() {
    _litrosCtrl.dispose();
    _valorTotalCtrl.dispose();
    _arlaLitrosCtrl.dispose();
    _arlaValorCtrl.dispose();
    _postoCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final pickedFile = await picker.pickImage(source: source, imageQuality: 70);
      if (pickedFile != null) setState(() => _image = File(pickedFile.path));
    } catch (e) {
      AppLogger.error('AddAbastecimento', 'erro_foto', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao acessar câmera/galeria.')),
        );
      }
    }
  }

  void _showPhotoOptions() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: const Text('Tirar Foto'),
              onTap: () { Navigator.pop(ctx); _pickPhoto(ImageSource.camera); },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('Escolher da Galeria'),
              onTap: () { Navigator.pop(ctx); _pickPhoto(ImageSource.gallery); },
            ),
            if (_image != null)
              ListTile(
                leading: const Icon(Icons.close, color: Colors.red),
                title: const Text('Remover foto'),
                onTap: () { Navigator.pop(ctx); setState(() => _image = null); },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    final litrosText = _litrosCtrl.text.replaceAll(',', '.');
    final valorText = _valorTotalCtrl.text.replaceAll(',', '.');

    if (litrosText.isEmpty || double.tryParse(litrosText) == null || double.parse(litrosText) <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe a quantidade de litros.')),
      );
      return;
    }
    if (valorText.isEmpty || double.tryParse(valorText) == null || double.parse(valorText) <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe o valor total.')),
      );
      return;
    }

    AppLogger.action('abastecimento_save_attempt', params: {'posto': _postoCtrl.text, 'quem_pagou': _quemPagou});
    setState(() => _loading = true);

    final fieldsStr = {
      'litros': litrosText,
      'valor_total': valorText,
      'arla_litros': _arlaLitrosCtrl.text.replaceAll(',', '.'),
      'arla_valor': _arlaValorCtrl.text.replaceAll(',', '.'),
      'posto': _postoCtrl.text,
      'quem_pagou': _quemPagou,
    };

    try {
      final connectivity = await Connectivity().checkConnectivity();

      if (connectivity != ConnectivityResult.none) {
        Map<String, dynamic> result;
        if (_image != null) {
          result = await ApiService.createMovementWithPhoto('abastecimentos', fieldsStr, _image!.path);
        } else {
          result = await ApiService.createMovementJson('abastecimentos', <String, dynamic>{
            'litros': litrosText,
            'valor_total': valorText,
            'quem_pagou': _quemPagou,
            if (_arlaLitrosCtrl.text.isNotEmpty) 'arla_litros': _arlaLitrosCtrl.text.replaceAll(',', '.'),
            if (_arlaValorCtrl.text.isNotEmpty) 'arla_valor': _arlaValorCtrl.text.replaceAll(',', '.'),
            if (_postoCtrl.text.isNotEmpty) 'posto': _postoCtrl.text,
          });
        }

        if (result['ok'] == true) {
          AppLogger.action('abastecimento_save_ok');
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Abastecimento salvo com sucesso.'),
                backgroundColor: Colors.green,
              ),
            );
            Navigator.pop(context, true);
          }
          return;
        }

        final msg = result['message'] as String? ?? 'Erro ao salvar abastecimento.';
        AppLogger.warning('AddAbastecimento', 'save falhou: $msg');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
        }
        return;
      }

      // Sem conexão
      if (_image != null) {
        AppLogger.action('abastecimento_offline_queued');
        final queueId = const Uuid().v4();
        await OfflineSync.addPendingTask(
          id: queueId,
          taskType: 'CREATE_ABASTECIMENTO',
          fields: fieldsStr,
          localPath: _image!.path,
        );
        Workmanager().registerOneOffTask(
          queueId,
          'sync_offline_data',
          constraints: Constraints(networkType: NetworkType.connected),
        );
      }
      if (mounted) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Salvo localmente. Será sincronizado quando houver conexão.')),
        );
      }
    } catch (e) {
      AppLogger.error('AddAbastecimento', 'erro_conexao', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao salvar abastecimento.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Adicionar Abastecimento')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(
              controller: _postoCtrl,
              decoration: const InputDecoration(labelText: 'Posto (opcional)'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _litrosCtrl,
              decoration: const InputDecoration(labelText: 'Litros *'),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _valorTotalCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor Total (Diesel) *',
                prefixText: 'R\$ ',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _arlaLitrosCtrl,
              decoration: const InputDecoration(labelText: 'Litros Arla (opcional)'),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _arlaValorCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor Arla (opcional)',
                prefixText: 'R\$ ',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _quemPagou,
              items: const [
                DropdownMenuItem(value: 'proprietario', child: Text('Proprietário')),
                DropdownMenuItem(value: 'motorista', child: Text('Motorista')),
              ],
              onChanged: (v) => setState(() => _quemPagou = v!),
              decoration: const InputDecoration(labelText: 'Quem Pagou?'),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _showPhotoOptions,
              icon: const Icon(Icons.camera_alt_outlined),
              label: Text(_image == null ? 'Adicionar foto (opcional)' : 'Trocar foto'),
            ),
            if (_image != null) ...[
              const SizedBox(height: 8),
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.file(_image!, height: 100, fit: BoxFit.cover, width: double.infinity),
                  ),
                  Positioned(
                    top: 4, right: 4,
                    child: GestureDetector(
                      onTap: () => setState(() => _image = null),
                      child: Container(
                        decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                        padding: const EdgeInsets.all(4),
                        child: const Icon(Icons.close, color: Colors.white, size: 16),
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _loading ? null : _save,
                child: _loading
                    ? const SizedBox(
                        height: 20, width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('SALVAR'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
