import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/offline_sync.dart';

class AddDespesaScreen extends StatefulWidget {
  /// Quando lançado a partir do detalhe de um frete, passar o id do frete
  /// para que a despesa fique vinculada automaticamente.
  final String? freteId;
  /// Quando aberto por um atalho (Manutenção/Outro), pré-seleciona o tipo.
  final String? tipoInicial;

  const AddDespesaScreen({super.key, this.freteId, this.tipoInicial});

  @override
  State<AddDespesaScreen> createState() => _AddDespesaScreenState();
}

class _AddDespesaScreenState extends State<AddDespesaScreen> {
  final _descCtrl = TextEditingController();
  final _valorCtrl = TextEditingController();
  late String _tipo;
  String _quemPagou = 'proprietario';
  File? _image;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    const tipos = ['Alimentação', 'Pedágio', 'Manutenção', 'Outros'];
    _tipo = (widget.tipoInicial != null && tipos.contains(widget.tipoInicial))
        ? widget.tipoInicial!
        : 'Alimentação';
    AppLogger.action('screen_open', params: {'tela': 'add_despesa'});
  }

  /// Converte o label visual do dropdown no valor técnico salvo no backend
  /// (sem acento/maiúscula). O painel usa 'manutencao' para o selo/tratamento.
  String _tipoTecnico(String visual) {
    switch (visual) {
      case 'Manutenção':
        return 'manutencao';
      case 'Alimentação':
        return 'alimentacao';
      case 'Pedágio':
        return 'pedagio';
      case 'Outros':
        return 'outros';
      default:
        return 'geral';
    }
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    _valorCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final pickedFile = await picker.pickImage(source: source, imageQuality: 70);
      if (pickedFile != null) setState(() => _image = File(pickedFile.path));
    } catch (e) {
      AppLogger.error('AddDespesa', 'erro_foto', e);
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

  Future<void> _save(bool isAutonomo) async {
    final descricao = _descCtrl.text.trim();
    final valorText = _valorCtrl.text.replaceAll(',', '.');

    if (descricao.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe a descrição.')),
      );
      return;
    }
    if (valorText.isEmpty || double.tryParse(valorText) == null || double.parse(valorText) <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe um valor válido maior que zero.')),
      );
      return;
    }
    // Vinculado precisa de foto obrigatória
    if (!isAutonomo && _image == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Anexe uma foto do comprovante para continuar.')),
      );
      return;
    }

    // Para autônomo: quem_pagou é sempre 'motorista' (ele é o proprietário)
    final quemPagou = isAutonomo ? 'motorista' : _quemPagou;

    // Valor técnico (sem acento/maiúscula) — mantém consistência com o painel
    // (ex.: 'manutencao' é o que o Dashboard espera para exibir o selo).
    final tipoTecnico = _tipoTecnico(_tipo);

    AppLogger.action('despesa_save_attempt', params: {'tipo': tipoTecnico, 'quem_pagou': quemPagou});
    setState(() => _loading = true);

    final fieldsStr = <String, String>{
      'tipo': tipoTecnico,
      'descricao': descricao,
      'valor': valorText,
      'quem_pagou': quemPagou,
      if (widget.freteId != null && widget.freteId!.isNotEmpty) 'frete_id': widget.freteId!,
    };

    try {
      final connectivity = await Connectivity().checkConnectivity();

      if (connectivity != ConnectivityResult.none) {
        Map<String, dynamic> result;
        if (_image != null) {
          result = await ApiService.createMovementWithPhoto('despesas', fieldsStr, _image!.path);
        } else {
          result = await ApiService.createMovementJson('despesas', fieldsStr);
        }

        if (result['ok'] == true) {
          AppLogger.action('despesa_save_ok');
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Despesa salva com sucesso.'),
                backgroundColor: Colors.green,
              ),
            );
            Navigator.pop(context, true);
          }
          return;
        }

        final msg = result['message'] as String? ?? 'Erro ao salvar despesa.';
        AppLogger.warning('AddDespesa', 'save falhou: $msg');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
        }
        return;
      }

      // Sem conexão — enfileirar com foto se disponível
      if (_image != null) {
        AppLogger.action('despesa_offline_queued', params: {'tipo': _tipo});
        final queueId = const Uuid().v4();
        await OfflineSync.addPendingTask(
          id: queueId,
          taskType: 'CREATE_DESPESA',
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
          const SnackBar(
            content: Text('Salvo localmente. Será sincronizado quando houver conexão.'),
          ),
        );
      }
    } catch (e) {
      AppLogger.error('AddDespesa', 'erro_conexao', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao salvar despesa.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAutonomo = context.read<AuthProvider>().isAutonomo;
    final fotoObrigatoria = !isAutonomo;

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
              decoration: const InputDecoration(labelText: 'Tipo'),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Descrição',
                alignLabelWithHint: true,
              ),
              minLines: 2,
              maxLines: 4,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _valorCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor (R\$)',
                prefixText: 'R\$ ',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            // "Quem pagou" só aparece para motorista vinculado
            if (!isAutonomo) ...[
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
            ],
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _showPhotoOptions,
              icon: const Icon(Icons.camera_alt_outlined),
              label: Text(_image == null
                  ? (fotoObrigatoria ? 'Foto do comprovante *' : 'Adicionar foto (opcional)')
                  : 'Trocar foto'),
            ),
            if (fotoObrigatoria && _image == null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Obrigatório para motorista vinculado.',
                  style: TextStyle(color: Colors.orange.shade700, fontSize: 12),
                ),
              ),
            if (_image != null) ...[
              const SizedBox(height: 8),
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.file(_image!, height: 150, fit: BoxFit.cover, width: double.infinity),
                  ),
                  Positioned(
                    top: 4, right: 4,
                    child: GestureDetector(
                      onTap: () => setState(() => _image = null),
                      child: Container(
                        decoration: const BoxDecoration(
                          color: Colors.black54,
                          shape: BoxShape.circle,
                        ),
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
              height: 48,
              child: ElevatedButton(
                onPressed: _loading ? null : () => _save(isAutonomo),
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
