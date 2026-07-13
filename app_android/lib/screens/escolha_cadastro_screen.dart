import 'package:flutter/material.dart';
import 'cadastro_screen.dart';

/// Tela intermediária entre o Login e o formulário de cadastro.
/// O usuário escolhe o tipo de conta antes de preencher os dados.
///
/// Piloto: apenas dois fluxos suportados de ponta a ponta pelo backend —
/// motorista vinculado (código da empresa) e autônomo (documento de cobrança).
/// "Autônomo com administrador" fica para uma frente própria, quando o
/// convite de administrador existir com segurança no backend.
class EscolhaCadastroScreen extends StatelessWidget {
  const EscolhaCadastroScreen({super.key});

  void _abrirCadastro(BuildContext context, TipoCadastro tipo) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => CadastroScreen(tipo: tipo)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Criar conta')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 8),
            Text(
              'Como você vai usar o app?',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              'Escolha o tipo de conta para continuar.',
              style: TextStyle(color: Colors.grey.shade600),
            ),
            const SizedBox(height: 24),
            _CartaoOpcao(
              icone: Icons.badge_outlined,
              titulo: 'Motorista vinculado',
              descricao:
                  'Você recebeu um código de uma empresa. Sua conta fica vinculada a ela.',
              onTap: () => _abrirCadastro(context, TipoCadastro.vinculado),
            ),
            const SizedBox(height: 16),
            _CartaoOpcao(
              icone: Icons.local_shipping_outlined,
              titulo: 'Autônomo',
              descricao:
                  'Você trabalha por conta própria. Escolhe um plano e usa o app de forma independente.',
              onTap: () => _abrirCadastro(context, TipoCadastro.autonomo),
            ),
          ],
        ),
      ),
    );
  }
}

class _CartaoOpcao extends StatelessWidget {
  const _CartaoOpcao({
    required this.icone,
    required this.titulo,
    required this.descricao,
    required this.onTap,
  });

  final IconData icone;
  final String titulo;
  final String descricao;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: primary.withValues(alpha: 0.12),
                child: Icon(icone, color: primary, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      titulo,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      descricao,
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
