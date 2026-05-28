import 'package:flutter/material.dart';
import '../services/api_service.dart';

class CadastroScreen extends StatefulWidget {
  const CadastroScreen({super.key});

  @override
  State<CadastroScreen> createState() => _CadastroScreenState();
}

class _CadastroScreenState extends State<CadastroScreen> {
  final _nomeCtrl = TextEditingController();
  final _placaCtrl = TextEditingController();
  final _cpfCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _loading = false;
  String _error = '';

  Future<void> _cadastrar() async {
    if (_nomeCtrl.text.isEmpty || _placaCtrl.text.isEmpty || _cpfCtrl.text.isEmpty || _emailCtrl.text.isEmpty || _passCtrl.text.isEmpty) {
      setState(() => _error = 'Preencha todos os campos obrigatórios.');
      return;
    }

    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final success = await ApiService.register({
        'nome': _nomeCtrl.text,
        'placa_veiculo': _placaCtrl.text,
        'cpf': _cpfCtrl.text,
        'email': _emailCtrl.text,
        'senha': _passCtrl.text,
      });

      if (success && mounted) {
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: const Text('Sucesso'),
            content: const Text('Cadastro realizado com sucesso. Sua conta passará por análise para aprovação.'),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(context); // close dialog
                  Navigator.pop(context); // close cadastro screen
                },
                child: const Text('OK'),
              )
            ],
          )
        );
      } else {
        setState(() => _error = 'Erro ao realizar cadastro. Verifique os dados ou tente novamente mais tarde.');
      }
    } catch (e) {
      setState(() => _error = 'Erro de conexão com o servidor.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('CADASTRO DE MOTORISTA')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            if (_error.isNotEmpty) ...[
              Text(_error, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
              const SizedBox(height: 16),
            ],
            TextField(controller: _nomeCtrl, decoration: const InputDecoration(labelText: 'Nome Completo', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            TextField(controller: _placaCtrl, decoration: const InputDecoration(labelText: 'Placa do Veículo (AAA-0A00)', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            TextField(controller: _cpfCtrl, decoration: const InputDecoration(labelText: 'CPF (Apenas números)', border: OutlineInputBorder()), keyboardType: TextInputType.number),
            const SizedBox(height: 16),
            TextField(controller: _emailCtrl, decoration: const InputDecoration(labelText: 'E-mail', border: OutlineInputBorder()), keyboardType: TextInputType.emailAddress),
            const SizedBox(height: 16),
            TextField(controller: _passCtrl, decoration: const InputDecoration(labelText: 'Senha', border: OutlineInputBorder()), obscureText: true),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _loading ? null : _cadastrar,
                child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('CADASTRAR'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
