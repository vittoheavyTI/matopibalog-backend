import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Tela final de boas-vindas dos 3 fluxos de cadastro. Orienta o próximo passo
/// REAL de cada caso (sem promessa visual falsa):
///  - 'vinculado'      → conta vinculada; fazer login e usar o app;
///  - 'autonomo'       → conta em trial; fazer login, ver plano/regularização;
///  - 'autonomo_admin' → autônomo criado + status do administrador. Se o admin
///    foi criado, mostra a senha temporária UMA vez (para repassar); se não,
///    explica que a conta existe e o admin pode ser adicionado pelo painel.
class BoasVindasScreen extends StatelessWidget {
  const BoasVindasScreen({
    super.key,
    required this.fluxo,
    this.adminResultado,
  });

  /// 'vinculado' | 'autonomo' | 'autonomo_admin'.
  final String fluxo;

  /// Presente apenas em 'autonomo_admin'. Espelha o backend:
  ///   { criado: true,  email, senha_temporaria }  ou
  ///   { criado: false, motivo }
  final Map<String, dynamic>? adminResultado;

  bool get _adminCriado => adminResultado != null && adminResultado!['criado'] == true;

  void _irParaLogin(BuildContext context) {
    // Volta à primeira rota da pilha (tela de Login).
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Conta criada'),
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              Icon(Icons.check_circle, color: primary, size: 72),
              const SizedBox(height: 16),
              Text(
                'Cadastro concluído!',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                _mensagemPrincipal(),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: Colors.grey.shade700),
              ),
              const SizedBox(height: 24),
              ..._blocoProximoPasso(context),
              const SizedBox(height: 32),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: () => _irParaLogin(context),
                  child: const Text('IR PARA O LOGIN', style: TextStyle(fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _mensagemPrincipal() {
    switch (fluxo) {
      case 'vinculado':
        return 'Sua conta foi criada e vinculada à empresa. Faça login para começar a usar o app.';
      case 'autonomo_admin':
        return 'Sua conta de autônomo foi criada e o período de teste começou.';
      case 'autonomo':
      default:
        return 'Sua conta de autônomo foi criada e o período de teste começou. Faça login para começar a usar o app.';
    }
  }

  List<Widget> _blocoProximoPasso(BuildContext context) {
    switch (fluxo) {
      case 'vinculado':
        return [
          const _CartaoInfo(
            icone: Icons.smartphone,
            titulo: 'Próximo passo',
            texto: 'Faça login com seu e-mail e senha. Seus fretes e lançamentos ficam no app.',
          ),
        ];
      case 'autonomo_admin':
        return _blocoAdmin(context);
      case 'autonomo':
      default:
        return [
          const _CartaoInfo(
            icone: Icons.workspace_premium_outlined,
            titulo: 'Plano e período de teste',
            texto: 'Você já pode usar o app no período de teste. Acompanhe o plano e a regularização dentro do app.',
          ),
        ];
    }
  }

  List<Widget> _blocoAdmin(BuildContext context) {
    if (_adminCriado) {
      final email = adminResultado!['email']?.toString() ?? '';
      final senha = adminResultado!['senha_temporaria']?.toString() ?? '';
      return [
        _CartaoInfo(
          icone: Icons.admin_panel_settings_outlined,
          titulo: 'Administrador vinculado',
          texto: 'O administrador $email foi vinculado à sua conta e acessa o PAINEL (web).',
          cor: Colors.green,
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.amber.shade50,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.amber.shade200),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Senha temporária do administrador',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              const Text(
                'Anote e repasse agora — ela aparece uma única vez. No 1º acesso ao painel, o administrador troca a senha.',
                style: TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: SelectableText(
                      senha,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.5,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Copiar senha',
                    icon: const Icon(Icons.copy),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: senha));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Senha copiada.')),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ];
    }

    // Sucesso parcial: autônomo criado, admin não. Mensagem clara + próximo passo real.
    final motivo = adminResultado?['motivo']?.toString();
    return [
      _CartaoInfo(
        icone: Icons.info_outline,
        titulo: 'Conta criada, administrador não',
        texto: motivo != null && motivo.isNotEmpty
            ? motivo
            : 'Não foi possível criar o administrador agora.',
        cor: Colors.orange,
      ),
      const SizedBox(height: 12),
      const _CartaoInfo(
        icone: Icons.support_agent_outlined,
        titulo: 'Como adicionar depois',
        texto: 'Sua conta está ativa. O administrador pode ser adicionado pelo painel (web) ou com o suporte, a qualquer momento.',
      ),
    ];
  }
}

class _CartaoInfo extends StatelessWidget {
  const _CartaoInfo({
    required this.icone,
    required this.titulo,
    required this.texto,
    this.cor,
  });

  final IconData icone;
  final String titulo;
  final String texto;
  final Color? cor;

  @override
  Widget build(BuildContext context) {
    final c = cor ?? Theme.of(context).colorScheme.primary;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: c.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, color: c),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(titulo, style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(texto, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
