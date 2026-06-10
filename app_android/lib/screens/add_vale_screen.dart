import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/offline_sync.dart';

class AddValeScreen extends StatefulWidget {
  /// Quando lançado a partir do detalhe de um frete, passar o id do frete
  /// para que o vale fique vinculado automaticamente.
  final String? freteId;

  const AddValeScreen({super.key, this.freteId});

  @override
  State<AddValeScreen> createState() => _AddValeScreenState();
}

class _AddValeScreenState extends State<AddValeScreen> {
  // Vale é dinheiro solicitado/adiantamento: tem valor e descrição/motivo.
  // Não tem posto, não tem litros e não exige foto/comprovante.
  // Não há campo "Quem Pagou?" na UI — enviamos 'proprietario' fixo no payload
  // para preservar a regra financeira (vale do vinculado entra como dedução).
  final _valorCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'add_vale'});
  }

  @override
  void dispose() {
    _valorCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final valorText = _valorCtrl.text.replaceAll(',', '.');
    final descricao = _descCtrl.text.trim();

    if (valorText.isEmpty || double.tryParse(valorText) == null || double.parse(valorText) <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe um valor válido maior que zero.')),
      );
      return;
    }
    if (descricao.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe a descrição/motivo do vale.')),
      );
      return;
    }

    AppLogger.action('vale_save_attempt');
    setState(() => _loading = true);

    final fieldsStr = <String, String>{
      'valor': valorText,
      'descricao': descricao,
      'quem_pagou': 'proprietario', // fixo: sem campo visual (regra financeira)
      if (widget.freteId != null && widget.freteId!.isNotEmpty) 'frete_id': widget.freteId!,
    };

    try {
      final connectivity = await Connectivity().checkConnectivity();

      if (connectivity != ConnectivityResult.none) {
        final result = await ApiService.createMovementJson('vales', fieldsStr);

        if (result['ok'] == true) {
          AppLogger.action('vale_save_ok');
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Vale solicitado com sucesso.'),
                backgroundColor: Colors.green,
              ),
            );
            Navigator.pop(context, true);
          }
          return;
        }

        final msg = result['message'] as String? ?? 'Erro ao salvar vale.';
        AppLogger.warning('AddVale', 'save falhou: $msg');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
        }
        return;
      }

      // Sem conexão — enfileira sem foto (Vale não tem comprovante)
      AppLogger.action('vale_offline_queued');
      final queueId = const Uuid().v4();
      await OfflineSync.addPendingTask(
        id: queueId,
        taskType: 'CREATE_VALE',
        fields: fieldsStr,
      );
      Workmanager().registerOneOffTask(
        queueId,
        'sync_offline_data',
        constraints: Constraints(networkType: NetworkType.connected),
      );
      if (mounted) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Salvo localmente. Será sincronizado quando houver conexão.')),
        );
      }
    } catch (e) {
      AppLogger.error('AddVale', 'erro_conexao', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao salvar vale.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Solicitar Vale')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _valorCtrl,
              decoration: const InputDecoration(
                labelText: 'Valor do Vale *',
                prefixText: 'R\$ ',
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Descrição / Motivo *',
                alignLabelWithHint: true,
                hintText: 'Ex: adiantamento para alimentação',
                border: OutlineInputBorder(),
              ),
              minLines: 2,
              maxLines: 4,
            ),
            const SizedBox(height: 32),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _loading ? null : _save,
                child: _loading
                    ? const SizedBox(
                        height: 20, width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('SOLICITAR VALE'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
