import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/api_service.dart';
import '../services/offline_sync.dart';

class AddDespesaScreen extends StatefulWidget {
  const AddDespesaScreen({super.key});

  @override
  State<AddDespesaScreen> createState() => _AddDespesaScreenState();
}

class _AddDespesaScreenState extends State<AddDespesaScreen> {
  final _descCtrl = TextEditingController();
  final _valorCtrl = TextEditingController();
  String _tipo = 'Alimentação';
  String _quemPagou = 'proprietario';
  File? _image;
  bool _loading = false;
  bool _photoRequired = true;

  @override
  void dispose() {
    _descCtrl.dispose();
    _valorCtrl.dispose();
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
            if (!_photoRequired)
              ListTile(
                leading: const Icon(Icons.close),
                title: const Text('Pular (sem foto)'),
                onTap: () {
                  Navigator.pop(ctx);
                  setState(() => _photoRequired = false);
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    if (_image == null && _photoRequired) {
      _showPhotoOptions();
      return;
    }

    setState(() => _loading = true);

    final fields = {
      'tipo': _tipo,
      'descricao': _descCtrl.text,
      'valor': _valorCtrl.text.replaceAll(',', '.'),
      'quem_pagou': _quemPagou,
    };

    try {
      final connectivity = await Connectivity().checkConnectivity();
      if (connectivity != ConnectivityResult.none && _image != null) {
        final success = await ApiService.createMovementWithPhoto(
          'despesas',
          fields,
          _image!.path,
        );
        if (success) {
          if (mounted) Navigator.pop(context);
          return;
        }
      }

      if (_image != null) {
        final queueId = const Uuid().v4();
        await OfflineSync.addPendingTask(
          id: queueId,
          taskType: 'CREATE_DESPESA',
          fields: fields,
          localPath: _image!.path,
        );
        Workmanager().registerOneOffTask(
          queueId,
          'sync_offline_data',
          constraints: Constraints(networkType: NetworkType.connected),
        );
      }

      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Dados salvos localmente. Serão sincronizados quando houver conexão.',
            ),
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao salvar: $e')),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Adicionar Despesa')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              value: _tipo,
              items: ['Alimentação', 'Pedágio', 'Manutenção', 'Outros']
                  .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                  .toList(),
              onChanged: (val) => setState(() => _tipo = val!),
              decoration: const InputDecoration(
                labelText: 'Tipo',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Descrição',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _valorCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor (R\$)',
                border: OutlineInputBorder(),
                prefixText: 'R\$ ',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            const Text('Quem pagou?'),
            Row(
              children: [
                Radio(
                  value: 'proprietario',
                  groupValue: _quemPagou,
                  onChanged: (val) => setState(() => _quemPagou = val.toString()),
                ),
                const Text('Proprietário'),
                Radio(
                  value: 'motorista',
                  groupValue: _quemPagou,
                  onChanged: (val) => setState(() => _quemPagou = val.toString()),
                ),
                const Text('Motorista'),
              ],
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _showPhotoOptions,
              icon: const Icon(Icons.camera_alt),
              label: Text(
                _photoRequired && _image == null
                    ? 'ADICIONAR FOTO (OBRIGATÓRIO)'
                    : 'TROCAR FOTO',
              ),
            ),
            if (_image != null) ...[
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(_image!, height: 150, fit: BoxFit.cover),
              ),
            ],
            const SizedBox(height: 32),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _loading ? null : _save,
                child: _loading
                    ? const CircularProgressIndicator()
                    : const Text('SALVAR'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}