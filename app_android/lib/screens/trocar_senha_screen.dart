import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class TrocarSenhaScreen extends StatefulWidget {
  const TrocarSenhaScreen({super.key});

  @override
  State<TrocarSenhaScreen> createState() => _TrocarSenhaScreenState();
}

class _TrocarSenhaScreenState extends State<TrocarSenhaScreen> {
  final _novaSenhaCtrl = TextEditingController();
  final _confirmaCtrl = TextEditingController();
  bool _showNova = false;
  bool _showConfirma = false;
  bool _salvando = false;

  @override
  void dispose() {
    _novaSenhaCtrl.dispose();
    _confirmaCtrl.dispose();
    super.dispose();
  }

  Future<void> _trocar() async {
    final nova = _novaSenhaCtrl.text;
    final confirma = _confirmaCtrl.text;

    if (nova.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A senha deve ter pelo menos 6 caracteres.')),
      );
      return;
    }
    if (nova != confirma) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('As senhas não coincidem.')),
      );
      return;
    }

    setState(() => _salvando = true);
    AppLogger.action('trocar_senha_attempt');

    final resultado = await ApiService.trocarSenha(nova);

    if (!mounted) return;
    setState(() => _salvando = false);

    if (resultado['ok'] == true) {
      AppLogger.action('trocar_senha_ok');
      // O Consumer<AuthProvider> em main.dart troca automaticamente para AppShell
      // quando senhaTemporaria = false. NÃO chamar Navigator.pop() aqui —
      // a TrocarSenhaScreen é renderizada inline (não via push), e pop() na raiz
      // causaria tela preta antes do rebuild.
      context.read<AuthProvider>().limparSenhaTemporaria();
    } else {
      AppLogger.action('trocar_senha_erro', params: {'msg': resultado['message']});
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(resultado['message'] as String? ?? 'Erro ao trocar senha.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Definir nova senha'),
        automaticallyImplyLeading: false,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 16),
            Icon(Icons.lock_reset_outlined, size: 64, color: theme.colorScheme.primary),
            const SizedBox(height: 24),
            Text(
              'Primeiro acesso',
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Seu acesso foi criado pelo administrador. Defina uma senha pessoal para continuar.',
              style: theme.textTheme.bodyMedium?.copyWith(color: Colors.grey.shade600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    TextField(
                      controller: _novaSenhaCtrl,
                      obscureText: !_showNova,
                      decoration: InputDecoration(
                        labelText: 'Nova senha',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_showNova ? Icons.visibility_off : Icons.visibility),
                          onPressed: () => setState(() => _showNova = !_showNova),
                        ),
                      ),
                      textInputAction: TextInputAction.next,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _confirmaCtrl,
                      obscureText: !_showConfirma,
                      decoration: InputDecoration(
                        labelText: 'Confirmar nova senha',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_showConfirma ? Icons.visibility_off : Icons.visibility),
                          onPressed: () => setState(() => _showConfirma = !_showConfirma),
                        ),
                      ),
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _salvando ? null : _trocar(),
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      height: 50,
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _salvando ? null : _trocar,
                        child: _salvando
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text(
                                'DEFINIR SENHA',
                                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                              ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
