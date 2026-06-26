import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

/// Gate de Termos LGPD do app. Renderizada inline pelo Consumer<AuthProvider>
/// em main.dart (depois da senha temporária, antes do AppShell). Exibe os termos
/// obrigatórios pendentes, exige "Li e concordo" e registra o aceite com
/// origem "app". Ao aceitar todos, libera o AppShell via marcarTermosAceitos().
class TermosPendentesScreen extends StatefulWidget {
  const TermosPendentesScreen({super.key});

  @override
  State<TermosPendentesScreen> createState() => _TermosPendentesScreenState();
}

class _TermosPendentesScreenState extends State<TermosPendentesScreen> {
  bool _carregando = true;
  bool _aceitando = false;
  String _erro = '';
  List<Map<String, dynamic>> _pendentes = [];
  int _indice = 0;
  bool _aceito = false; // checkbox "Li e concordo" do termo atual

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _carregando = true;
      _erro = '';
    });
    final data = await ApiService.buscarTermosPendentes();
    if (!mounted) return;
    if (data == null) {
      setState(() {
        _carregando = false;
        _erro = 'Não foi possível carregar os termos. Verifique sua conexão.';
      });
      return;
    }
    final lista =
        (data['pendentes'] as List?)?.whereType<Map<String, dynamic>>().toList() ?? [];
    if (lista.isEmpty) {
      // Nada pendente: libera o app (o Consumer troca para o AppShell).
      context.read<AuthProvider>().marcarTermosAceitos();
      return;
    }
    setState(() {
      _pendentes = lista;
      _indice = 0;
      _aceito = false;
      _carregando = false;
    });
  }

  Future<void> _aceitar() async {
    if (_aceitando || _pendentes.isEmpty) return;
    final termo = _pendentes[_indice];
    final id = termo['id'] as String?;
    if (id == null) return;

    setState(() {
      _aceitando = true;
      _erro = '';
    });
    AppLogger.action('aceitar_termo_attempt', params: {'tipo': termo['tipo']});

    final res = await ApiService.aceitarTermo(id);
    if (!mounted) return;

    if (res['ok'] == true) {
      AppLogger.action('aceitar_termo_ok', params: {'tipo': termo['tipo']});
      if (_indice + 1 < _pendentes.length) {
        // Próximo termo: exige consentimento próprio (zera o checkbox).
        setState(() {
          _indice += 1;
          _aceito = false;
          _aceitando = false;
        });
      } else {
        // Último termo aceito: libera o AppShell.
        context.read<AuthProvider>().marcarTermosAceitos();
      }
    } else {
      final status = res['status'] as int? ?? 0;
      setState(() {
        _aceitando = false;
        _erro = status == 403
            ? 'Este termo não se aplica ao seu perfil. Entre em contato com o suporte.'
            : (res['message'] as String? ?? 'Erro ao registrar aceite. Tente novamente.');
      });
    }
  }

  Future<void> _recusar() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Recusar termos'),
        content: const Text(
          'Para utilizar o aplicativo é necessário aceitar os termos obrigatórios.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Voltar'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Recusar e sair'),
          ),
        ],
      ),
    );
    if (confirmar == true && mounted) {
      await context.read<AuthProvider>().logout();
    }
  }

  void _verTermoCompleto(Map<String, dynamic> termo, String conteudo) {
    final theme = Theme.of(context);
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      termo['titulo'] as String? ?? 'Termo',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Text(
                  conteudo,
                  style: theme.textTheme.bodyMedium?.copyWith(height: 1.6),
                ),
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Fechar'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Termos pendentes'),
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: _carregando
            ? const Center(child: CircularProgressIndicator())
            : (_pendentes.isEmpty)
                ? _erroSemTermos()
                : _conteudoTermo(),
      ),
    );
  }

  Widget _erroSemTermos() {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 56, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(
              _erro.isNotEmpty ? _erro : 'Não há termos para exibir.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _carregar,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _recusar,
              child: const Text('Sair'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _conteudoTermo() {
    final theme = Theme.of(context);
    final termo = _pendentes[_indice];
    final total = _pendentes.length;
    final tipo = (termo['tipo'] as String? ?? '').replaceAll('_', ' ');
    final versao = termo['versao']?.toString() ?? '1';
    final titulo = termo['titulo'] as String? ?? 'Termo';
    final conteudo = (termo['conteudo'] as String? ?? '').trim();
    final temConteudo = conteudo.isNotEmpty;
    final podeAceitar = temConteudo && _aceito && !_aceitando;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Cabeçalho da marca + identificação do termo
          Center(
            child: Image.asset('assets/LOGOMARCA.png', height: 44, fit: BoxFit.contain),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withAlpha(31),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  tipo.toUpperCase(),
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text('v$versao', style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            titulo,
            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            'Termo ${_indice + 1} de $total',
            style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey),
          ),
          const SizedBox(height: 12),

          // Área de leitura (rolável, ocupa o espaço disponível) ou aviso sem conteúdo
          Expanded(
            child: temConteudo
                ? Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: theme.brightness == Brightness.dark
                          ? Colors.white10
                          : const Color(0xFFF6F7F9),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.grey.withAlpha(64)),
                    ),
                    child: SingleChildScrollView(
                      child: Text(
                        conteudo,
                        style: theme.textTheme.bodyMedium?.copyWith(height: 1.6),
                      ),
                    ),
                  )
                : Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF8E1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFFFE082)),
                    ),
                    child: const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.warning_amber_rounded, color: Color(0xFFB8860B)),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Este termo ainda não possui conteúdo completo cadastrado. '
                            'Entre em contato com o suporte.',
                            style: TextStyle(color: Color(0xFF7A5B00), height: 1.5),
                          ),
                        ),
                      ],
                    ),
                  ),
          ),

          // "Ver termo completo" (modal de leitura ampla) — só quando há conteúdo
          if (temConteudo)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => _verTermoCompleto(termo, conteudo),
                icon: const Icon(Icons.article_outlined, size: 18),
                label: const Text('Ver termo completo'),
              ),
            ),

          // Consentimento explícito
          if (temConteudo)
            CheckboxListTile(
              value: _aceito,
              onChanged: _aceitando ? null : (v) => setState(() => _aceito = v ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('Li e concordo com este termo'),
            ),

          if (_erro.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(_erro, style: TextStyle(color: theme.colorScheme.error, fontSize: 13)),
          ],

          const SizedBox(height: 8),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: podeAceitar ? _aceitar : null,
              child: _aceitando
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text(
                      'Aceitar termo',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 48,
            child: OutlinedButton(
              onPressed: _aceitando ? null : _recusar,
              style: OutlinedButton.styleFrom(
                foregroundColor: theme.colorScheme.error,
                side: BorderSide(color: theme.colorScheme.error.withAlpha(128)),
              ),
              child: const Text('Recusar e sair'),
            ),
          ),
        ],
      ),
    );
  }
}
