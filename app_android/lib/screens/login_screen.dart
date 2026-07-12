import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import 'cadastro_screen.dart';

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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          final loading = auth.status == AuthStatus.loading;
          final error = auth.error;

          // Mostra erro do auth como SnackBar uma única vez por erro
          if (error.isNotEmpty && auth.status == AuthStatus.error && error != _lastShownError) {
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
                              builder: (_) => const CadastroScreen()),
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
