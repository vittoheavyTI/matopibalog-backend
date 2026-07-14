import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // TextInputFormatter
import '../models/plano_publico.dart';
import '../services/api_service.dart';
import '../utils/mascaras.dart';
import 'selecao_plano_screen.dart';
import 'boas_vindas_screen.dart';

/// Tipo de cadastro escolhido na tela anterior (EscolhaCadastroScreen).
/// Dirige a visibilidade dos campos e as regras de validação/payload.
///  - vinculado         → motorista com código de empresa;
///  - autonomo          → conta própria;
///  - autonomoComAdmin  → conta própria + administrador (painel web).
enum TipoCadastro { vinculado, autonomo, autonomoComAdmin }

class CadastroScreen extends StatefulWidget {
  const CadastroScreen({super.key, required this.tipo});

  /// Fluxo selecionado: motorista vinculado (com código da empresa) ou autônomo.
  final TipoCadastro tipo;

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
  // CPF do motorista/responsável — só usado no autônomo quando o documento é CNPJ.
  final _cpfResponsavelCtrl = TextEditingController();
  // Dados do administrador — só no fluxo "autônomo com administrador".
  final _adminNomeCtrl = TextEditingController();
  final _adminEmailCtrl = TextEditingController();
  bool _loading = false;
  String _error = '';
  bool _showPass = false;
  bool _showConfirmPass = false;
  // Documento (autônomo) tem 14 dígitos → é CNPJ/MEI e exige CPF do responsável.
  bool _docEhCnpj = false;
  // Plano escolhido na etapa seguinte (SelecaoPlanoScreen), só no fluxo autônomo.
  PlanoPublico? _planoSelecionado;

  bool get _vinculado => widget.tipo == TipoCadastro.vinculado;
  bool get _comAdministrador => widget.tipo == TipoCadastro.autonomoComAdmin;

  @override
  void dispose() {
    _nomeCtrl.dispose();
    _placaCtrl.dispose();
    _cpfCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    _confirmPassCtrl.dispose();
    _codigoConviteCtrl.dispose();
    _cpfResponsavelCtrl.dispose();
    _adminNomeCtrl.dispose();
    _adminEmailCtrl.dispose();
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

  String? _validateCodigoEmpresa(String? v) {
    if (v == null || v.trim().isEmpty) return 'Código da empresa é obrigatório';
    return null;
  }

  String? _validarCpfDigitos(String cpf) {
    if (cpf.length != 11) return 'CPF deve ter 11 números';
    if (RegExp(r'^(\d)\1{10}$').hasMatch(cpf)) return 'CPF inválido';

    int sum = 0;
    for (int i = 0; i < 9; i++) {
      sum += int.parse(cpf[i]) * (10 - i);
    }
    int rest = (sum * 10) % 11;
    if (rest == 10) rest = 0;
    if (rest != int.parse(cpf[9])) return 'CPF inválido';

    sum = 0;
    for (int i = 0; i < 10; i++) {
      sum += int.parse(cpf[i]) * (11 - i);
    }
    rest = (sum * 10) % 11;
    if (rest == 10) rest = 0;
    if (rest != int.parse(cpf[10])) return 'CPF inválido';

    return null;
  }

  String? _validarCnpjDigitos(String cnpj) {
    if (cnpj.length != 14) return 'CNPJ deve ter 14 números';
    if (RegExp(r'^(\d)\1{13}$').hasMatch(cnpj)) return 'CNPJ inválido';

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
    if (calcularDigito(cnpj, pesos1) != int.parse(cnpj[12])) return 'CNPJ inválido';
    if (calcularDigito(cnpj, pesos2) != int.parse(cnpj[13])) return 'CNPJ inválido';
    return null;
  }

  String? _validateDocumento(String? v) {
    if (v == null || v.trim().isEmpty) {
      return _vinculado ? 'CPF é obrigatório' : 'Documento é obrigatório';
    }
    final documento = v.trim().replaceAll(RegExp(r'\D'), '');
    if (_vinculado || documento.length == 11) return _validarCpfDigitos(documento);
    if (documento.length == 14) return _validarCnpjDigitos(documento);
    return 'Documento deve ter 11 ou 14 números';
  }

  String? _validateCpfResponsavel(String? v) {
    if (v == null || v.trim().isEmpty) return 'CPF do responsável é obrigatório';
    return _validarCpfDigitos(v.trim().replaceAll(RegExp(r'\D'), ''));
  }

  String? _validateAdminNome(String? v) {
    if (v == null || v.trim().isEmpty) return 'Nome do administrador é obrigatório';
    if (v.trim().length < 2) return 'Nome deve ter pelo menos 2 caracteres';
    return null;
  }

  String? _validateAdminEmail(String? v) {
    if (v == null || v.trim().isEmpty) return 'E-mail do administrador é obrigatório';
    final email = v.trim();
    if (!RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$').hasMatch(email)) {
      return 'E-mail do administrador inválido';
    }
    // O admin acessa o painel; deve ser uma pessoa diferente do autônomo.
    if (email.toLowerCase() == _emailCtrl.text.trim().toLowerCase()) {
      return 'Use um e-mail diferente do seu';
    }
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
      // Normaliza o código antes de enviar (uppercase, sem espaços). O traço é
      // mantido como digitado — o backend aceita com ou sem. Reduz erro do motorista.
      final comConvite = _vinculado;
      final codigo = _codigoConviteCtrl.text.toUpperCase().replaceAll(RegExp(r'\s'), '');
      final documento = _cpfCtrl.text.trim().replaceAll(RegExp(r'\D'), '');
      final cpfResponsavel = _cpfResponsavelCtrl.text.replaceAll(RegExp(r'\D'), '');
      // CPF enviado: vinculado e autônomo-CPF usam o próprio documento; o
      // autônomo-CNPJ usa o CPF do responsável (o CNPJ nunca vira cpf).
      final cpfEnviar = (comConvite || documento.length == 11) ? documento : cpfResponsavel;
      final resultado = await ApiService.register({
        'nome': _nomeCtrl.text.trim(),
        'placa_veiculo': normalizarPlaca(_placaCtrl.text),
        if (cpfEnviar.isNotEmpty) 'cpf': cpfEnviar,
        if (!comConvite) 'documento_billing': documento,
        'email': _emailCtrl.text.trim().toLowerCase(),
        'senha': _passCtrl.text,
        if (comConvite) 'codigo_convite': codigo,
        // Fluxo "autônomo com administrador": envia os dados do admin. O backend
        // cria o admin vinculado (não-fatal) e devolve o status/senha temporária.
        if (_comAdministrador)
          'administrador': {
            'nome': _adminNomeCtrl.text.trim(),
            'email': _adminEmailCtrl.text.trim().toLowerCase(),
          },
      }, planoId: comConvite ? null : _planoSelecionado?.id);

      if (resultado['ok'] == true && mounted) {
        // Boas-vindas por fluxo. O admin (autônomo com administrador) vem como
        // Map em resultado['administrador'] (criado + senha temporária, ou motivo).
        final fluxo = comConvite
            ? 'vinculado'
            : (_comAdministrador ? 'autonomo_admin' : 'autonomo');
        final adminResultado = resultado['administrador'] is Map
            ? Map<String, dynamic>.from(resultado['administrador'] as Map)
            : null;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => BoasVindasScreen(fluxo: fluxo, adminResultado: adminResultado),
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

  /// Fluxo autônomo: valida os dados e navega para a etapa de seleção de plano.
  /// Ao voltar com um plano confirmado, dispara o cadastro. O payload é o mesmo
  /// de _cadastrar — apenas o momento da escolha do plano mudou de tela.
  Future<void> _irParaPlanos() async {
    if (!_formKey.currentState!.validate()) return;
    final resultado = await Navigator.push<ResultadoSelecaoPlano>(
      context,
      MaterialPageRoute(builder: (_) => const SelecaoPlanoScreen()),
    );
    // resultado == null → usuário voltou sem confirmar; não cadastra.
    if (resultado == null || !mounted) return;
    _planoSelecionado = resultado.plano;
    await _cadastrar();
  }

  /// Despacha a ação do botão principal conforme o tipo de cadastro:
  /// vinculado cadastra direto; autônomo segue para a escolha de plano.
  void _submeter() {
    if (_vinculado) {
      _cadastrar();
    } else {
      _irParaPlanos();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_vinculado
            ? 'Cadastro — Motorista vinculado'
            : (_comAdministrador ? 'Cadastro — Autônomo com administrador' : 'Cadastro — Autônomo')),
      ),
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
              // Fluxo vinculado: o código da empresa vem em destaque, antes dos
              // dados pessoais, porque é o que autoriza o vínculo.
              if (_vinculado) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.blue.shade100),
                  ),
                  child: const Text(
                    'Você vai se vincular a uma empresa. Informe o código recebido para concluir o cadastro.',
                    style: TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _codigoConviteCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Código da empresa',
                    hintText: 'Ex.: MATO-AB1234 ou MATOAB1234',
                    helperText: 'Informe o código recebido da empresa. Digite com ou sem traço.',
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
                  validator: _validateCodigoEmpresa,
                  textInputAction: TextInputAction.next,
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
                  labelText: 'Placa do Veículo (AAA-0A00 ou AAA0A00)',
                  prefixIcon: Icon(Icons.directions_car),
                ),
                validator: _validatePlaca,
                textInputAction: TextInputAction.next,
                textCapitalization: TextCapitalization.characters,
                inputFormatters: const [Mascaras.placa],
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _cpfCtrl,
                decoration: InputDecoration(
                  labelText: _vinculado ? 'CPF (apenas números)' : 'Documento CPF/CNPJ (apenas números)',
                  prefixIcon: const Icon(Icons.badge),
                  helperText: _vinculado ? null : 'Autônomo pode usar CPF ou CNPJ/MEI para cobrança.',
                ),
                keyboardType: TextInputType.number,
                inputFormatters: [_vinculado ? Mascaras.cpf : Mascaras.documento],
                validator: _validateDocumento,
                textInputAction: TextInputAction.next,
                onChanged: (v) {
                  // Autônomo com CNPJ (14 dígitos) precisa informar o CPF do
                  // responsável. Vinculado usa CPF (nunca 14) → nunca aparece.
                  final ehCnpj = !_vinculado &&
                      v.replaceAll(RegExp(r'\D'), '').length == 14;
                  if (ehCnpj != _docEhCnpj) setState(() => _docEhCnpj = ehCnpj);
                },
              ),
              const SizedBox(height: 16),
              // CNPJ/MEI: o documento é a conta de cobrança; ainda precisamos do
              // CPF da pessoa que dirige (nunca enviamos o CNPJ como CPF).
              if (_docEhCnpj) ...[
                TextFormField(
                  controller: _cpfResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'CPF do motorista responsável (apenas números)',
                    prefixIcon: Icon(Icons.person_outline),
                    helperText: 'O CNPJ é usado para cobrança; informe o CPF de quem dirige.',
                  ),
                  keyboardType: TextInputType.number,
                  inputFormatters: const [Mascaras.cpf],
                  validator: _validateCpfResponsavel,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 16),
              ],
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
                textInputAction: _comAdministrador ? TextInputAction.next : TextInputAction.done,
                onFieldSubmitted: _comAdministrador ? null : (_) => _submeter(),
              ),
              // Seção do administrador — só no fluxo "autônomo com administrador".
              // O admin acessa o PAINEL (web) e recebe uma senha temporária.
              // Seção do administrador, destacada num card separado dos dados do
              // autônomo: cabeçalho com ícone + título, texto curto e os campos
              // dentro. Só muda o visual — controllers/validators inalterados.
              if (_comAdministrador) ...[
                const SizedBox(height: 24),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1B5E20).withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF1B5E20).withValues(alpha: 0.25)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.admin_panel_settings_outlined, color: Color(0xFF1B5E20)),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Administrador do painel',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1B5E20),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Essa pessoa acessará o painel web para acompanhar a conta.',
                        style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _adminNomeCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Nome do administrador',
                          prefixIcon: Icon(Icons.person_outline),
                        ),
                        validator: _validateAdminNome,
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _adminEmailCtrl,
                        decoration: const InputDecoration(
                          labelText: 'E-mail do administrador',
                          prefixIcon: Icon(Icons.alternate_email),
                          helperText: 'Diferente do seu e-mail. É o login dele no painel.',
                        ),
                        keyboardType: TextInputType.emailAddress,
                        validator: _validateAdminEmail,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submeter(),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _submeter,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(_vinculado ? 'CADASTRAR' : 'CONTINUAR',
                          style: const TextStyle(fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
