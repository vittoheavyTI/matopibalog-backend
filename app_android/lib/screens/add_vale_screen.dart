import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/api_service.dart';
import '../services/offline_sync.dart';

class AddValeScreen extends StatefulWidget {
  const AddValeScreen({super.key});

  @override
  State<AddValeScreen> createState() => _AddValeScreenState();
}

class _AddValeScreenState extends State<AddValeScreen> {
  final _valorCtrl = TextEditingController();
  final _postoCtrl = TextEditingController();
  final _litrosCtrl = TextEditingController();
  String _quemPagou = 'proprietario';
  File? _image;
  bool _loading = false;

  Future<void> _takePhoto() async {
    final picker = ImagePicker();
    final pickedFile = await picker.pickImage(source: ImageSource.camera, imageQuality: 70);
    if (pickedFile != null) setState(() => _image = File(pickedFile.path));
  }

  Future<void> _save() async {
    if (_image == null) return;
    setState(() => _loading = true);

    final fields = {
      'valor': _valorCtrl.text.replaceAll(',', '.'),
      'posto': _postoCtrl.text,
      'litros': _litrosCtrl.text.replaceAll(',', '.'),
      'quem_pagou': _quemPagou,
    };

    try {
      final connectivity = await Connectivity().checkConnectivity();
      if (connectivity != ConnectivityResult.none) {
        final success = await ApiService.createMovementWithPhoto('vales', fields, _image!.path);
        if (success) { if (mounted) Navigator.pop(context); return; }
      }

      await OfflineSync.addPendingTask(
        id: const Uuid().v4(),
        taskType: 'CREATE_VALE',
        fields: fields,
        localPath: _image!.path,
      );

      Workmanager().registerOneOffTask(const Uuid().v4(), 'sync_offline_data', constraints: Constraints(networkType: NetworkType.connected));
      if (mounted) Navigator.pop(context);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Adicionar Vale')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(controller: _valorCtrl, decoration: const InputDecoration(labelText: 'Valor do Vale', border: OutlineInputBorder()), keyboardType: TextInputType.number),
            const SizedBox(height: 16),
            TextField(controller: _postoCtrl, decoration: const InputDecoration(labelText: 'Posto (Opcional)', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            TextField(controller: _litrosCtrl, decoration: const InputDecoration(labelText: 'Litros (Opcional)', border: OutlineInputBorder()), keyboardType: TextInputType.number),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _quemPagou,
              items: const [
                DropdownMenuItem(value: 'proprietario', child: Text('Proprietário')),
                DropdownMenuItem(value: 'motorista', child: Text('Motorista')),
              ],
              onChanged: (v) => setState(() => _quemPagou = v!),
              decoration: const InputDecoration(labelText: 'Quem Pagou?', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(onPressed: _takePhoto, icon: const Icon(Icons.camera_alt), label: const Text('FOTO DO COMPROVANTE')),
            if (_image != null) Image.file(_image!, height: 100),
            const SizedBox(height: 32),
            SizedBox(width: double.infinity, height: 48, child: ElevatedButton(onPressed: (_image == null || _loading) ? null : _save, child: const Text('SALVAR'))),
          ],
        ),
      ),
    );
  }
}
