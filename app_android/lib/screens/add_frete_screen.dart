import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import 'dart:io';
import 'package:image_picker/image_picker.dart';

class AddFreteScreen extends StatefulWidget {
  const AddFreteScreen({super.key});

  @override
  State<AddFreteScreen> createState() => _AddFreteScreenState();
}

class _AddFreteScreenState extends State<AddFreteScreen> {
  final _origemCtrl = TextEditingController();
  final _destinoCtrl = TextEditingController();
  final _kmCtrl = TextEditingController();
  final _valorCtrl = TextEditingController();
  String _quemRecebeu = 'motorista';
  bool _loading = false;
  File? _fotoOdometroInicial;
  // Guarda o id de um frete já criado cuja foto inicial ainda não subiu. Enquanto
  // definido, tocar em Salvar REENVIA só a foto (não recria o frete) — evita duplicar.
  String? _fretePendenteId;

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'add_frete'});
  }

  Future<void> _salvar() async {
    if (_origemCtrl.text.isEmpty || _destinoCtrl.text.isEmpty || _valorCtrl.text.isEmpty) {
      AppLogger.action('frete_validation_error', params: {'motivo': 'campos_obrigatorios'});
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha os campos obrigatórios.')));
      return;
    }

    // Aceita vírgula decimal (padrão brasileiro) convertendo para ponto
    final valorStr = _valorCtrl.text.trim().replaceAll(',', '.');
    final valorFrete = double.tryParse(valorStr);
    if (valorFrete == null || valorFrete <= 0) {
      AppLogger.action('frete_validation_error', params: {'motivo': 'valor_invalido'});
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Valor do frete inválido. Use apenas números (ex: 1500 ou 1500,50).')),
      );
      return;
    }

    AppLogger.action('frete_save_attempt', params: {
      'origem': _origemCtrl.text,
      'destino': _destinoCtrl.text,
      'quem_recebeu': _quemRecebeu,
    });
    setState(() => _loading = true);

    // Novo fluxo: KM e foto inicial são obrigatórios. O backend cria o registro
    // pendente e só o ativa depois do upload privado da foto.
    final kmStr = _kmCtrl.text.trim();
    final kmInicial = int.tryParse(kmStr);
    if (kmInicial == null || kmInicial <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe um KM inicial válido, maior que zero.')),
      );
      setState(() => _loading = false);
      return;
    }
    if (_fotoOdometroInicial == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tire a foto do odômetro inicial para iniciar o frete.')),
      );
      setState(() => _loading = false);
      return;
    }

    final payload = <String, dynamic>{
      'origem': _origemCtrl.text.trim(),
      'destino': _destinoCtrl.text.trim(),
      'valor_frete': valorFrete,
      'quem_recebeu': _quemRecebeu,
      'odometro_obrigatorio': true,
    };
    payload['km_inicial'] = kmInicial;

    try {
      String freteId;
      if (_fretePendenteId != null) {
        // Retentativa: o frete já foi criado numa tentativa anterior cujo upload
        // falhou. Reenvia SÓ a foto para o mesmo id — nunca cria outro frete.
        freteId = _fretePendenteId!;
      } else {
        final resultado = await ApiService.createFrete(payload);
        if (!mounted) return;
        if (resultado['ok'] != true) {
          final msg = resultado['message'] as String? ?? 'Erro ao salvar frete.';
          AppLogger.warning('AddFrete', msg);
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
          return;
        }
        freteId = resultado['id']?.toString() ?? '';
        if (freteId.isEmpty) throw StateError('Backend não retornou o identificador do frete.');
      }

      final upload = await ApiService.uploadFotoOdometro(freteId, 'inicial', _fotoOdometroInicial!.path);
      if (!mounted) return;
      if (upload['ok'] != true) {
        // Frete persistiu, mas a foto não subiu. Guarda o id para a próxima tentativa
        // reenviar só a foto (sem recriar) e orienta o usuário a tocar em Salvar.
        _fretePendenteId = freteId;
        final msg = upload['message']?.toString()
            ?? 'Frete salvo como pendente, mas a foto inicial não foi enviada.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$msg Toque em Salvar novamente para reenviar a foto.')),
        );
        return;
      }
      AppLogger.action('frete_save_ok');
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Frete registrado com sucesso!')),
      );
    } catch (e) {
      AppLogger.error('AddFrete', 'erro_conexao', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro de conexão.')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _capturarFotoInicial() async {
    try {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.camera, imageQuality: 75, maxWidth: 1800, maxHeight: 1800,
      );
      if (picked != null && mounted) {
        setState(() => _fotoOdometroInicial = File(picked.path));
      }
    } catch (e) {
      AppLogger.error('AddFrete', 'erro_foto_odometro_inicial', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao acessar a câmera.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('NOVO FRETE')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(controller: _origemCtrl, decoration: const InputDecoration(labelText: 'Origem')),
            const SizedBox(height: 16),
            TextField(controller: _destinoCtrl, decoration: const InputDecoration(labelText: 'Destino')),
            const SizedBox(height: 16),
            TextField(controller: _kmCtrl, decoration: const InputDecoration(labelText: 'KM Inicial *'), keyboardType: TextInputType.number),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _loading ? null : _capturarFotoInicial,
              icon: const Icon(Icons.camera_alt),
              label: Text(_fotoOdometroInicial == null
                  ? 'TIRAR FOTO DO ODÔMETRO INICIAL *'
                  : 'TROCAR FOTO DO ODÔMETRO INICIAL'),
            ),
            if (_fotoOdometroInicial != null) ...[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.file(_fotoOdometroInicial!, height: 180, width: double.infinity, fit: BoxFit.cover),
              ),
            ],
            const SizedBox(height: 16),
            TextField(controller: _valorCtrl, decoration: const InputDecoration(labelText: 'Valor do Frete', prefixText: 'R\$ '), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _quemRecebeu,
              decoration: const InputDecoration(labelText: 'Quem Recebeu o Frete?'),
              items: const [
                DropdownMenuItem(value: 'motorista', child: Text('Motorista')),
                DropdownMenuItem(value: 'proprietario', child: Text('Proprietário')),
              ],
              onChanged: (v) => setState(() => _quemRecebeu = v!),
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _loading ? null : _salvar,
                child: _loading ? const CircularProgressIndicator() : const Text('SALVAR FRETE'),
              ),
            )
          ],
        ),
      ),
    );
  }
}

