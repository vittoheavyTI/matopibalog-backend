import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/api_service.dart';
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
      final pickedFile = await picker.pickImage(
        source: source,
        imageQuality: 70,
      );
      if (pickedFile != null) {
        setState(() => _image = File(pickedFile.path));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao acessar $source: $e')),
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
              onTap: () {
                Navigator.pop(ctx);
                _pickPhoto(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('Escolher da Galeria'),
              onTap: () {
                Navigator.pop(ctx);
                _pickPhoto(ImageSource.gallery);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    if (_image == null) {
      _showPhotoOptions();
      return;
    }

    setState(() => _loading = true);

    final fields = {
      'litros': _litrosCtrl.text.replaceAll(',', '.'),
      'valor_total': _valorTotalCtrl.text.replaceAll(',', '.'),
      'arla_litros': _arlaLitrosCtrl.text.replaceAll(',', '.'),
      'arla_valor': _arlaValorCtrl.text.replaceAll(',', '.'),
      'posto': _postoCtrl.text,
      'quem_pagou': _quemPagou,
    };

    try {
      final connectivity = await Connectivity().checkConnectivity();
      if (connectivity != ConnectivityResult.none) {
        final success = await ApiService.createMovementWithPhoto(
          'abastecimentos',
          fields,
          _image!.path,
        );
        if (success) {
          if (mounted) Navigator.pop(context);
          return;
        }
      }

      final queueId = const Uuid().v4();
      await OfflineSync.addPendingTask(
        id: queueId,
        taskType: 'CREATE_ABASTECIMENTO',
        fields: fields,
        localPath: _image!.path,
      );
      Workmanager().registerOneOffTask(
        queueId,
        'sync_offline_data',
        constraints: Constraints(networkType: NetworkType.connected),
      );

      if (mounted) Navigator.pop(context);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro: $e')),
      );
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
              decoration: const InputDecoration(
                labelText: 'Posto',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _litrosCtrl,
              decoration: const InputDecoration(
                labelText: 'Litros',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _valorTotalCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor Total (Diesel)',
                border: OutlineInputBorder(),
                prefixText: 'R\$ ',
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _arlaLitrosCtrl,
              decoration: const InputDecoration(
                labelText: 'Litros Arla (Opcional)',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _arlaValorCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor Arla (Opcional)',
                border: OutlineInputBorder(),
                prefixText: 'R\$ ',
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _quemPagou,
              items: const [
                DropdownMenuItem(value: 'proprietario', child: Text('Proprietário')),
                DropdownMenuItem(value: 'motorista', child: Text('Motorista')),
              ],
              onChanged: (v) => setState(() => _quemPagou = v!),
              decoration: const InputDecoration(
                labelText: 'Quem Pagou?',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _showPhotoOptions,
              icon: const Icon(Icons.camera_alt),
              label: Text(_image == null ? 'ADICIONAR FOTO' : 'TROCAR FOTO'),
            ),
            if (_image != null) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(_image!, height: 100, fit: BoxFit.cover),
              ),
            ],
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: (_image == null || _loading) ? null : _save,
                child: const Text('SALVAR'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}