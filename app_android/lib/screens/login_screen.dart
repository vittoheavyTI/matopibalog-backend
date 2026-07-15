import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import 'escolha_cadastro_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _showPass = false;
  // Pré-marcado: preserva o comportamento atual de manter a sessão salva.
  bool _manterConectado = true;
  String _lastShownError = '';
  bool _reenviando = false;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (_emailCtrl.text.isEmpty || _passCtrl.text.isEmpty) {
      AppLogger.action('login_validation_error', params: {'motivo': 'campos_vazios'});
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preencha todos os campos.')),
      );
      return;
    }
    await context.read<AuthProvider>().login(
      _emailCtrl.text.trim().toLowerCase(),
      _passCtrl.text,
      manterConectado: _manterConectado,
    );
  }

  Future<void> _esqueceuSenha() async {
    final emailCtrl = TextEditingController(text: _emailCtrl.text.trim());
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Recuperar senha'),
        content: TextField(
          controller: emailCtrl,
          decoration: const InputDecoration(
            labelText: 'Seu e-mail',
            prefixIcon: Icon(Icons.email_outlined),
          ),
          keyboardType: TextInputType.emailAddress,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('CANCELAR'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('ENVIAR'),
          ),
        ],
      ),
    );

    if (confirmed != true || emailCtrl.text.trim().isEmpty) return;

    try {
      final ok = await ApiService.esqueceuSenha(emailCtrl.text.trim().toLowerCase());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ok
              ? 'E-mail de recuperação enviado!'
              : 'Não foi possível enviar. Verifique o endereço.'),
          backgroundColor: ok ? Colors.green.shade700 : Colors.red.shade700,
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Erro ao enviar e-mail.')),
      );
    }
  }

  Future<void> _reenviarConfirmacao() async {
    final email = _emailCtrl.text.trim().toLowerCase();
    if (email.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Informe seu e-mail para reenviar a confirmação.')),
      );
      return;
    }
    setState(() => _reenviando = true);
    final ok = await ApiService.reenviarConfirmacao(email);
    if (!mounted) return;
    setState(() => _reenviando = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? 'Se houver um cadastro pendente, reenviamos o link de confirmação.'
            : 'Não foi possível reenviar agora. Tente novamente.'),
        backgroundColor: ok ? Colors.green.shade700 : Colors.red.shade700,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          final loading = auth.status == AuthStatus.loading;
          final error = auth.error;

          // Mostra erro do auth como SnackBar uma única vez por erro. Exceção:
          // e-mail não confirmado tem tratamento inline (banner + reenvio), então
          // não vira SnackBar para não duplicar a orientação.
          if (error.isNotEmpty && auth.status == AuthStatus.error && error != _lastShownError && !auth.naoConfirmado) {
            _lastShownError = error;
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(error),
                  backgroundColor: theme.colorScheme.error,
                  behavior: SnackBarBehavior.floating,
                ),
              );
            });
          }

          // Controle de tema fica no Drawer (AppShell), não na tela de login.
          return Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 80),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Logomarca — case exato do arquivo
                      Image.asset(
                        'assets/LOGOMARCA.png',
                        height: 110,
                        fit: BoxFit.contain,
                      ),
                      const SizedBox(height: 40),

                      // Card do formulário
                      Card(
                        elevation: 4,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              // E-mail não confirmado: orienta e oferece o reenvio
                              // do link (não é senha errada).
                              if (auth.naoConfirmado) ...[
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: Colors.blue.shade50,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: Colors.blue.shade100),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Icon(Icons.mark_email_unread_outlined,
                                              color: Colors.blue.shade700, size: 20),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Text(
                                              'Confirme seu e-mail antes de entrar. Não recebeu o link?',
                                              style: TextStyle(fontSize: 13, color: Colors.blue.shade900),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      SizedBox(
                                        width: double.infinity,
                                        child: OutlinedButton(
                                          onPressed: _reenviando ? null : _reenviarConfirmacao,
                                          child: _reenviando
                                              ? const SizedBox(
                                                  height: 16,
                                                  width: 16,
                                                  child: CircularProgressIndicator(strokeWidth: 2),
                                                )
                                              : const Text('Reenviar confirmação'),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 16),
                              ],
                              TextField(
                                controller: _emailCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'E-mail',
                                  prefixIcon: Icon(Icons.email_outlined),
                                ),
                                keyboardType: TextInputType.emailAddress,
                                textInputAction: TextInputAction.next,
                              ),
                              const SizedBox(height: 16),
                              TextField(
                                controller: _passCtrl,
                                decoration: InputDecoration(
                                  labelText: 'Senha',
                                  prefixIcon: const Icon(Icons.lock_outline),
                                  suffixIcon: IconButton(
                                    icon: Icon(_showPass
                                        ? Icons.visibility_off
                                        : Icons.visibility),
                                    onPressed: () =>
                                        setState(() => _showPass = !_showPass),
                                  ),
                                ),
                                obscureText: !_showPass,
                                textInputAction: TextInputAction.done,
                                onSubmitted: (_) => _login(),
                              ),
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                  onPressed: _esqueceuSenha,
                                  child: const Text('Esqueceu a senha?'),
                                ),
                              ),
                              // Mantém a sessão salva neste aparelho (token em
                              // armazenamento seguro). Não salva a senha.
                              CheckboxListTile(
                                value: _manterConectado,
                                onChanged: (v) =>
                                    setState(() => _manterConectado = v ?? false),
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                title: const Text('Manter conectado neste aparelho'),
                                subtitle: const Text(
                                  'Mantém sua sessão neste aparelho. Sua senha não é salva.',
                                  style: TextStyle(fontSize: 12),
                                ),
                              ),
                              const SizedBox(height: 4),
                              SizedBox(
                                height: 50,
                                child: ElevatedButton(
                                  onPressed: loading ? null : _login,
                                  child: loading
                                      ? const SizedBox(
                                          height: 20,
                                          width: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Text(
                                          'ENTRAR',
                                          style: TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      const SizedBox(height: 16),
                      TextButton(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const EscolhaCadastroScreen()),
                        ),
                        child: const Text('Não tem conta? Cadastre-se'),
                      ),
                    ],
                  ),
                ),
              );
        },
      ),
    );
  }
}
