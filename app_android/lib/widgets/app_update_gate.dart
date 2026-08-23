import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/app_version_policy_service.dart';

/// Gate de atualização do app (MOBILE-M1-008 / D-053).
///
/// Envolve o `home` do app. No startup e ao voltar do background:
///   - `required`  → tela de bloqueio controlado (substitui o conteúdo);
///   - `recommended` → diálogo visível, dispensável (uma vez por sessão);
///   - `optional`  → aviso discreto (SnackBar), não interrompe;
///   - `none`/`unknown` → nada (fallback seguro: nunca bloqueia por rede ruim).
///
/// A atualização "in-app" no M1 abre a ficha oficial da Play Store via
/// `url_launcher` (mesmo padrão já usado no app). O update nativo da Play
/// (flexible/immediate) fica como evolução, sem bloquear este release.
class AppUpdateGate extends StatefulWidget {
  final Widget child;

  /// Injetável para teste. Em produção usa o serviço padrão (BuildInfo + backend).
  final AppVersionPolicyService? service;

  const AppUpdateGate({super.key, required this.child, this.service});

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate>
    with WidgetsBindingObserver {
  late final AppVersionPolicyService _service;
  AppVersionPolicy? _policy;
  bool _avisoRecomendadoMostrado = false;
  bool _avisoOpcionalMostrado = false;
  bool _verificando = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? AppVersionPolicyService();
    WidgetsBinding.instance.addObserver(this);
    _verificar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Ao retornar do background, reconcilia a política (a versão mínima pode ter
    // mudado enquanto o app esteve suspenso).
    if (state == AppLifecycleState.resumed) {
      _verificar();
    }
  }

  Future<void> _verificar() async {
    if (_verificando) return;
    _verificando = true;
    try {
      final policy = await _service.fetchPolicy();
      if (!mounted) return;
      setState(() => _policy = policy);
      _talvezAvisar();
    } finally {
      _verificando = false;
    }
  }

  void _talvezAvisar() {
    final policy = _policy;
    if (policy == null) return;
    // required é tratado no build (tela de bloqueio); aqui só avisos leves.
    if (policy.precisaAtualizarRecomendado && !_avisoRecomendadoMostrado) {
      _avisoRecomendadoMostrado = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _mostrarDialogoRecomendado(policy);
      });
    } else if (policy.atualizacaoOpcional && !_avisoOpcionalMostrado) {
      _avisoOpcionalMostrado = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _mostrarAvisoOpcional(policy);
      });
    }
  }

  Future<void> _abrirLoja(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Play indisponível/contexto sem loja: não quebra o app (§41).
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Não foi possível abrir a loja. Tente novamente.'),
        ),
      );
    }
  }

  Future<void> _mostrarDialogoRecomendado(AppVersionPolicy policy) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Atualização recomendada'),
        content: Text(
          policy.releaseNotes.isNotEmpty
              ? policy.releaseNotes
              : 'Uma nova versão do Matopiba Log está disponível com melhorias '
                  'importantes. Recomendamos atualizar.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Agora não'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              _abrirLoja(policy.storeUrl);
            },
            child: const Text('Atualizar'),
          ),
        ],
      ),
    );
  }

  void _mostrarAvisoOpcional(AppVersionPolicy policy) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 6),
        content: const Text('Há uma nova versão disponível.'),
        action: SnackBarAction(
          label: 'Atualizar',
          textColor: Colors.white,
          onPressed: () => _abrirLoja(policy.storeUrl),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final policy = _policy;
    if (policy != null && policy.precisaAtualizarObrigatorio) {
      return _RequiredUpdateScreen(
        policy: policy,
        onAtualizar: () => _abrirLoja(policy.storeUrl),
        onVerificarNovamente: _verificar,
      );
    }
    return widget.child;
  }
}

/// Tela de atualização OBRIGATÓRIA (versão local < mínima suportada).
/// Explica o porquê em alto nível, oferece a ação de atualizar e permite
/// re-verificar (sem loop: apenas refaz a checagem).
class _RequiredUpdateScreen extends StatelessWidget {
  final AppVersionPolicy policy;
  final VoidCallback onAtualizar;
  final Future<void> Function() onVerificarNovamente;

  const _RequiredUpdateScreen({
    required this.policy,
    required this.onAtualizar,
    required this.onVerificarNovamente,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset(
                  'assets/LOGOMARCA.png',
                  height: 96,
                  fit: BoxFit.contain,
                ),
                const SizedBox(height: 32),
                const Icon(Icons.system_update, size: 56),
                const SizedBox(height: 16),
                Text(
                  'Atualização necessária',
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Esta versão do aplicativo não é mais compatível. '
                  'Para continuar usando o Matopiba Log com segurança, '
                  'atualize para a versão mais recente.',
                  style: Theme.of(context).textTheme.bodyLarge,
                  textAlign: TextAlign.center,
                ),
                if (policy.releaseNotes.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    policy.releaseNotes,
                    style: Theme.of(context).textTheme.bodyMedium,
                    textAlign: TextAlign.center,
                  ),
                ],
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: onAtualizar,
                    icon: const Icon(Icons.download),
                    label: const Text('Atualizar agora'),
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => onVerificarNovamente(),
                  child: const Text('Já atualizei — verificar novamente'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
