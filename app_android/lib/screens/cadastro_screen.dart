import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // TextInputFormatter
import '../models/plano_publico.dart';
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
  bool _carregandoPlanos = true;
  String _error = '';
  String _erroPlanos = '';
  bool _showPass = false;
  bool _showConfirmPass = false;
  List<PlanoPublico> _planos = const [];
  PlanoPublico? _planoSelecionado;

  bool get _temCodigoConvite => _codigoConviteCtrl.text.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _codigoConviteCtrl.addListener(_aoAlterarCodigoConvite);
    _carregarPlanos();
  }

  void _aoAlterarCodigoConvite() {
    if (mounted) setState(() {});
  }

  Future<void> _carregarPlanos() async {
    try {
      final planos = await ApiService.getPlanosPublicos();
      PlanoPublico? padrao;
      for (final plano in planos) {
        if (plano.nome.trim().toLowerCase() == 'plano básico') {
          padrao = plano;
          break;
        }
      }
      padrao ??= planos.isNotEmpty ? planos.first : null;

      if (!mounted) return;
      setState(() {
        _planos = planos;
        _planoSelecionado = padrao;
        _carregandoPlanos = false;
        _erroPlanos = planos.isEmpty
            ? 'Nenhum plano disponível agora. O Plano Básico será usado no cadastro.'
            : '';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _carregandoPlanos = false;
        _erroPlanos = 'Não foi possível carregar os planos. Você pode continuar; '
            'o Plano Básico será usado.';
      });
    }
  }

  @override
  void dispose() {
    _codigoConviteCtrl.removeListener(_aoAlterarCodigoConvite);
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

  String? _validarCpfDigitos(String cpf) {
    if (cpf.length != 11) return 'CPF deve ter 11 numeros';
    if (RegExp(r'^(\d)\1{10}$').hasMatch(cpf)) return 'CPF invalido';

    int sum = 0;
    for (int i = 0; i < 9; i++) sum += int.parse(cpf[i]) * (10 - i);
    int rest = (sum * 10) % 11;
    if (rest == 10) rest = 0;
    if (rest != int.parse(cpf[9])) return 'CPF invalido';

    sum = 0;
    for (int i = 0; i < 10; i++) sum += int.parse(cpf[i]) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest == 10) rest = 0;
    if (rest != int.parse(cpf[10])) return 'CPF invalido';

    return null;
  }

  String? _validarCnpjDigitos(String cnpj) {
    if (cnpj.length != 14) return 'CNPJ deve ter 14 numeros';
    if (RegExp(r'^(\d)\1{13}$').hasMatch(cnpj)) return 'CNPJ invalido';

    int calcularDigito(String base, List<int> pesos) {
      var soma = 0;
      for (var i = 0; i < pesos.length; i++) {
        soma += int.parse(base[i]) * pesos[i];
      }
      final resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    }

    const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    if (calcularDigito(cnpj, pesos1) != int.parse(cnpj[12])) return 'CNPJ invalido';
    if (calcularDigito(cnpj, pesos2) != int.parse(cnpj[13])) return 'CNPJ invalido';
    return null;
  }

  String? _validateDocumento(String? v) {
    if (v == null || v.trim().isEmpty) {
      return _temCodigoConvite ? 'CPF e obrigatorio' : 'Documento e obrigatorio';
    }
    final documento = v.trim().replaceAll(RegExp(r'\D'), '');
    if (_temCodigoConvite || documento.length == 11) return _validarCpfDigitos(documento);
    if (documento.length == 14) return _validarCnpjDigitos(documento);
    return 'Documento deve ter 11 ou 14 numeros';
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
      // Normaliza o código antes de enviar (uppercase, sem espaços). O traço é
      // mantido como digitado — o backend aceita com ou sem. Reduz erro do motorista.
      final codigo = _codigoConviteCtrl.text.toUpperCase().replaceAll(RegExp(r'\s'), '');
      final comConvite = codigo.isNotEmpty;
      final documento = _cpfCtrl.text.trim().replaceAll(RegExp(r'\D'), '');
      final resultado = await ApiService.register({
        'nome': _nomeCtrl.text.trim(),
        'placa_veiculo': _placaCtrl.text.trim().toUpperCase(),
        if (comConvite || documento.length == 11) 'cpf': documento,
        if (!comConvite) 'documento_billing': documento,
        'email': _emailCtrl.text.trim(),
        'senha': _passCtrl.text,
        if (comConvite) 'codigo_convite': codigo,
      }, planoId: comConvite ? null : _planoSelecionado?.id);

      if (resultado['ok'] == true && mounted) {
        // Mensagem específica por fluxo (nenhum passa por análise manual):
        //  - com convite: motorista autoaprovado, vinculado à empresa;
        //  - sem convite: autônomo em trial com acesso imediato.
        final mensagemSucesso = comConvite
            ? 'Cadastro realizado com sucesso. Você já pode acessar sua conta vinculada à empresa.'
            : 'Cadastro realizado com sucesso. Seu período de teste foi iniciado e você já pode usar o app.';
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: const Text('Cadastro concluído'),
            content: Text(mensagemSucesso, style: const TextStyle(fontSize: 15)),
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
          // Mensagem real do backend (e-mail/CPF já cadastrado, código inválido, etc.)
          _error = (resultado['message'] as String?) ??
              'Não foi possível concluir o cadastro. Tente novamente em instantes.';
        });
      }
    } catch (e) {
      setState(() => _error = 'Não foi possível concluir o cadastro. Tente novamente em instantes.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatarPreco(double valor) {
    return 'R\$ ${valor.toStringAsFixed(2).replaceAll('.', ',')}/mês';
  }

  Widget _buildSelecaoPlanos() {
    if (_temCodigoConvite) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.blue.shade50,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.blue.shade100),
        ),
        child: const Text(
          'Motorista vinculado usa o plano da empresa do convite.',
          style: TextStyle(fontSize: 13),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Escolha seu plano', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        if (_carregandoPlanos)
          const Center(
            child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()),
          )
        else if (_erroPlanos.isNotEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.orange.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.orange.shade200),
            ),
            child: Text(_erroPlanos, style: const TextStyle(fontSize: 13)),
          )
        else
          ..._planos.map(_buildPlanoCard),
      ],
    );
  }

  Widget _buildPlanoCard(PlanoPublico plano) {
    final selecionado = _planoSelecionado?.id == plano.id;
    final detalhes = <String>[
      if (plano.diasTrial != null) '${plano.diasTrial} dias de teste grátis',
      if (plano.limiteMotoristas != null) 'Até ${plano.limiteMotoristas} motorista(s)',
      ...plano.recursos.take(3),
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => setState(() => _planoSelecionado = plano),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selecionado ? Theme.of(context).colorScheme.primary : Colors.grey.shade300,
              width: selecionado ? 2 : 1,
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                selecionado ? Icons.radio_button_checked : Icons.radio_button_off,
                color: selecionado ? Theme.of(context).colorScheme.primary : Colors.grey,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(plano.nome, style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(
                      _formatarPreco(plano.precoMensal),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (plano.descricao.isNotEmpty)
                      Text(plano.descricao, style: const TextStyle(fontSize: 12)),
                    for (final detalhe in detalhes)
                      Text('• $detalhe', style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
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
                decoration: InputDecoration(
                  labelText: _temCodigoConvite ? 'CPF (Apenas numeros)' : 'Documento CPF/CNPJ (Apenas numeros)',
                  prefixIcon: const Icon(Icons.badge),
                  helperText: _temCodigoConvite ? null : 'Autonomo pode usar CPF ou CNPJ/MEI para cobranca.',
                ),
                keyboardType: TextInputType.number,
                validator: _validateDocumento,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _codigoConviteCtrl,
                decoration: const InputDecoration(
                  labelText: 'Código da empresa (opcional)',
                  hintText: 'Ex.: MATO-AB1234 ou MATOAB1234',
                  helperText: 'Digite com ou sem traço. Deixe vazio se autônomo.',
                  prefixIcon: Icon(Icons.business_outlined),
                ),
                textCapitalization: TextCapitalization.characters,
                // Uppercase enquanto digita (o traço não é obrigatório; o backend
                // normaliza de qualquer forma). Não bloqueia nem exige formato.
                inputFormatters: [
                  TextInputFormatter.withFunction(
                    (oldValue, newValue) =>
                        newValue.copyWith(text: newValue.text.toUpperCase()),
                  ),
                ],
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
              _buildSelecaoPlanos(),
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
