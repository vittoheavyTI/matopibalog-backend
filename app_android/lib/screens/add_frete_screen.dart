import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

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

    // Validação do KM inicial (campo opcional):
    // - em branco → permitido, não envia
    // - texto não-numérico → bloqueia com mensagem
    // - zero ou negativo → bloqueia com mensagem
    // - positivo → envia
    final kmStr = _kmCtrl.text.trim();
    int? kmInicial;
    if (kmStr.isNotEmpty) {
      kmInicial = int.tryParse(kmStr);
      if (kmInicial == null) {
        AppLogger.action('frete_validation_error', params: {'motivo': 'km_invalido'});
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('KM inicial inválido. Use apenas números.')),
        );
        setState(() => _loading = false);
        return;
      }
      if (kmInicial <= 0) {
        AppLogger.action('frete_validation_error', params: {'motivo': 'km_nao_positivo'});
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('KM inicial deve ser maior que zero.')),
        );
        setState(() => _loading = false);
        return;
      }
    }

    final payload = <String, dynamic>{
      'origem': _origemCtrl.text.trim(),
      'destino': _destinoCtrl.text.trim(),
      'valor_frete': valorFrete,
      'quem_recebeu': _quemRecebeu,
    };
    if (kmInicial != null) payload['km_inicial'] = kmInicial;

    try {
      final resultado = await ApiService.createFrete(payload);

      if (!mounted) return;

      if (resultado['ok'] == true) {
        AppLogger.action('frete_save_ok');
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Frete registrado com sucesso!')),
        );
      } else {
        final msg = resultado['message'] as String? ?? 'Erro ao salvar frete.';
        AppLogger.warning('AddFrete', msg);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      }
    } catch (e) {
      AppLogger.error('AddFrete', 'erro_conexao', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro de conexão.')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
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
            TextField(controller: _kmCtrl, decoration: const InputDecoration(labelText: 'KM Inicial (Opcional)'), keyboardType: TextInputType.number),
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

