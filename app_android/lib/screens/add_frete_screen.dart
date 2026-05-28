import 'package:flutter/material.dart';
import '../services/api_service.dart';

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

  Future<void> _salvar() async {
    if (_origemCtrl.text.isEmpty || _destinoCtrl.text.isEmpty || _valorCtrl.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preencha os campos obrigatórios.')));
      return;
    }

    setState(() => _loading = true);

    try {
      final success = await ApiService.createFrete({
        'origem': _origemCtrl.text,
        'destino': _destinoCtrl.text,
        'km_inicial': int.tryParse(_kmCtrl.text),
        'valor_frete': double.tryParse(_valorCtrl.text),
        'quem_recebeu': _quemRecebeu,
      });

      if (success && mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Frete registrado com sucesso!')));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao salvar frete.')));
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro de conexão.')));
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
            TextField(controller: _origemCtrl, decoration: const InputDecoration(labelText: 'Origem', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            TextField(controller: _destinoCtrl, decoration: const InputDecoration(labelText: 'Destino', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            TextField(controller: _kmCtrl, decoration: const InputDecoration(labelText: 'KM Inicial (Opcional)', border: OutlineInputBorder()), keyboardType: TextInputType.number),
            const SizedBox(height: 16),
            TextField(controller: _valorCtrl, decoration: const InputDecoration(labelText: 'Valor do Frete', prefixText: 'R\$ ', border: OutlineInputBorder()), keyboardType: const TextInputType.numberWithOptions(decimal: true)),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _quemRecebeu,
              decoration: const InputDecoration(labelText: 'Quem Recebeu o Frete?', border: OutlineInputBorder()),
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
