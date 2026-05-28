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

  Future<void> _takePhoto() async {
    final picker = ImagePicker();
    final pickedFile = await picker.pickImage(source: ImageSource.camera, imageQuality: 70);
    if (pickedFile != null) {
      setState(() => _image = File(pickedFile.path));
    }
  }

  Future<void> _save() async {
    if (_image == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Foto do comprovante é obrigatória.')));
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
      
      if (connectivity != ConnectivityResult.none) {
        // ONLINE: Tenta enviar direto
        final success = await ApiService.createMovementWithPhoto('despesas', fields, _image!.path);
        if (success) {
          if (mounted) Navigator.pop(context);
          return;
        }
      }

      // OFFLINE ou Erro na API: Salva na fila local
      final queueId = const Uuid().v4();
      await OfflineSync.addPendingTask(
        id: queueId,
        taskType: 'CREATE_DESPESA',
        fields: fields,
        localPath: _image!.path,
      );

      // Registra tarefa no WorkManager para quando a rede voltar
      Workmanager().registerOneOffTask(
        queueId,
        'sync_offline_data',
        constraints: Constraints(networkType: NetworkType.connected),
      );

      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Dados salvos localmente. Serão sincronizados quando houver conexão.')));
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar: $e')));
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
              decoration: const InputDecoration(labelText: 'Tipo', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            TextField(controller: _descCtrl, decoration: const InputDecoration(labelText: 'Descrição', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            TextField(
              controller: _valorCtrl,
              decoration: const InputDecoration(labelText: 'Valor (R\$)', border: OutlineInputBorder()),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            const Text('Quem pagou?'),
            Row(
              children: [
                Radio(value: 'proprietario', groupValue: _quemPagou, onChanged: (val) => setState(() => _quemPagou = val.toString())),
                const Text('Proprietário'),
                Radio(value: 'motorista', groupValue: _quemPagou, onChanged: (val) => setState(() => _quemPagou = val.toString())),
                const Text('Motorista'),
              ],
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _takePhoto,
              icon: const Icon(Icons.camera_alt),
              label: const Text('TIRAR FOTO DO COMPROVANTE (Obrigatório)'),
            ),
            if (_image != null) ...[
              const SizedBox(height: 8),
              Image.file(_image!, height: 150),
            ],
            const SizedBox(height: 32),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: (_image == null || _loading) ? null : _save,
                child: _loading ? const CircularProgressIndicator() : const Text('SALVAR'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
