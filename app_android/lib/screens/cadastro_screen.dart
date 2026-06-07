import 'package:flutter/material.dart';
import '../services/api_service.dart';

class CadastroScreen extends StatefulWidget {
  const CadastroScreen({super.key});

  @override
  State<CadastroScreen> createState() => _CadastroScreenState();
}

class _CadastroScreenState extends State<CadastroScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nomeCtrl = TextEditingController();
  final _placaCtrl = TextEditingController();
  final _cpfCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();
  final _codigoConviteCtrl = TextEditingController();
  bool _loading = false;
  String _error = '';
  bool _showPass = false;
  bool _showConfirmPass = false;

  @override
  void dispose() {
    _nomeCtrl.dispose();
    _placaCtrl.dispose();
    _cpfCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    _confirmPassCtrl.dispose();
    _codigoConviteCtrl.dispose();
    super.dispose();
  }

  String? _validateNome(String? v) {
    if (v == null || v.trim().isEmpty) return 'Nome é obrigatório';
    if (v.trim().length < 3) return 'Nome deve ter pelo menos 3 caracteres';
    return null;
  }

  String? _validatePlaca(String? v) {
    if (v == null || v.trim().isEmpty) return 'Placa é obrigatória';
    final placa = v.trim().toUpperCase();
    final padraoAntigo = RegExp(r'^[A-Z]{3}-\d{4}$');
    final padraoMercosul = RegExp(r'^[A-Z]{3}\d[A-Z]\d{2}$');
    if (!padraoAntigo.hasMatch(placa) && !padraoMercosul.hasMatch(placa)) {
      return 'Formato: AAA-0A00 ou AAA0A00 (Mercosul)';
    }
    return null;
  }

  String? _validateCpf(String? v) {
    if (v == null || v.trim().isEmpty) return 'CPF é obrigatório';
    final cpf = v.trim().replaceAll(RegExp(r'\D'), '');
    if (cpf.length != 11) return 'CPF deve ter 11 números';
    if (RegExp(r'^(\d)\1{10}$').hasMatch(cpf)) return 'CPF inválido';

    int sum = 0;
    for (int i = 0; i < 9; i++) sum += int.parse(cpf[i]) * (10 - i);
    int rest = (sum * 10) % 11;
    if (rest == 10) rest = 0;
    if (rest != int.parse(cpf[9])) return 'CPF inválido';

    sum = 0;
    for (int i = 0; i < 10; i++) sum += int.parse(cpf[i]) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest == 10) rest = 0;
    if (rest != int.parse(cpf[10])) return 'CPF inválido';

    return null;
  }

  String? _validateEmail(String? v) {
    if (v == null || v.trim().isEmpty) return 'E-mail é obrigatório';
    final email = v.trim();
    if (!RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
        .hasMatch(email)) {
      return 'E-mail inválido';
    }
    return null;
  }

  String? _validateSenha(String? v) {
    if (v == null || v.isEmpty) return 'Senha é obrigatória';
    if (v.length < 6) return 'Senha deve ter pelo menos 6 caracteres';
    return null;
  }

  String? _validateConfirmSenha(String? v) {
    if (v == null || v.isEmpty) return 'Confirme a senha';
    if (v != _passCtrl.text) return 'Senhas não conferem';
    return null;
  }

  Future<void> _cadastrar() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final codigo = _codigoConviteCtrl.text.trim().toUpperCase();
      final success = await ApiService.register({
        'nome': _nomeCtrl.text.trim(),
        'placa_veiculo': _placaCtrl.text.trim().toUpperCase(),
        'cpf': _cpfCtrl.text.trim().replaceAll(RegExp(r'\D'), ''),
        'email': _emailCtrl.text.trim(),
        'senha': _passCtrl.text,
        if (codigo.isNotEmpty) 'codigo_convite': codigo,
      });

      if (success && mounted) {
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: const Text('Sucesso'),
            content: const Text(
              'Cadastro realizado com sucesso. Sua conta passará por análise para aprovação.',
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(context);
                  Navigator.pop(context);
                },
                child: const Text('OK'),
              ),
            ],
          ),
        );
      } else {
        setState(() {
          _error = 'Erro ao realizar cadastro. Verifique os dados ou tente novamente.';
        });
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
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              if (_error.isNotEmpty) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    _error,
                    style: const TextStyle(color: Colors.red),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 16),
              ],
              TextFormField(
                controller: _nomeCtrl,
                decoration: const InputDecoration(
                  labelText: 'Nome Completo',
                  prefixIcon: Icon(Icons.person),
                ),
                validator: _validateNome,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _placaCtrl,
                decoration: const InputDecoration(
                  labelText: 'Placa do Veículo (AAA-0A00)',
                  prefixIcon: Icon(Icons.directions_car),
                ),
                validator: _validatePlaca,
                textInputAction: TextInputAction.next,
                textCapitalization: TextCapitalization.characters,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _cpfCtrl,
                decoration: const InputDecoration(
                  labelText: 'CPF (Apenas números)',
                  prefixIcon: Icon(Icons.badge),
                ),
                keyboardType: TextInputType.number,
                validator: _validateCpf,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _codigoConviteCtrl,
                decoration: const InputDecoration(
                  labelText: 'Código da empresa (opcional)',
                  hintText: 'Ex: MATO-AB1234 — deixe vazio se autônomo',
                  prefixIcon: Icon(Icons.business_outlined),
                ),
                textCapitalization: TextCapitalization.characters,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 4),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 4),
                child: Text(
                  'Motorista autônomo? Deixe este campo em branco.',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _emailCtrl,
                decoration: const InputDecoration(
                  labelText: 'E-mail',
                  prefixIcon: Icon(Icons.email_outlined),
                ),
                keyboardType: TextInputType.emailAddress,
                validator: _validateEmail,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passCtrl,
                decoration: InputDecoration(
                  labelText: 'Senha',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(_showPass ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _showPass = !_showPass),
                  ),
                ),
                obscureText: !_showPass,
                validator: _validateSenha,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _confirmPassCtrl,
                decoration: InputDecoration(
                  labelText: 'Confirmar Senha',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(_showConfirmPass ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _showConfirmPass = !_showConfirmPass),
                  ),
                ),
                obscureText: !_showConfirmPass,
                validator: _validateConfirmSenha,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _cadastrar(),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _cadastrar,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('CADASTRAR', style: TextStyle(fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}