import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/finance_provider.dart';
import '../providers/theme_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/push_service.dart';
import '../widgets/seletor_frete.dart';
import 'home_screen.dart';
import 'historico_screen.dart';
import 'add_frete_screen.dart';
import 'add_despesa_screen.dart';
import 'add_abastecimento_screen.dart';
import 'add_vale_screen.dart';
import 'perfil_screen.dart';
import 'notificacoes_screen.dart';
import 'minhas_faturas_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  int _naoLidas = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _carregarContador();
    // Ao receber um push em primeiro plano, atualiza o badge do sino E os dados
    // da tela (Últimos Fretes/Lançamentos) sem o usuário precisar recarregar.
    PushService.onPushRecebido = _onEventoNotificacao;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Evita segurar referência a este State após ser descartado.
    if (PushService.onPushRecebido == _onEventoNotificacao) {
      PushService.onPushRecebido = null;
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Ao voltar do segundo plano, o push pode ter chegado enquanto o app estava
    // oculto (contador e dados mexidos no servidor). Recarrega badge + dados sem
    // exigir que o usuário abra o sino ou puxe a lista.
    if (state == AppLifecycleState.resumed) {
      _onEventoNotificacao();
    }
  }

  /// Reação a um evento de notificação (push em foreground ou volta do 2º plano):
  /// atualiza o badge do sino e recarrega os dados financeiros. `loadData` mantém
  /// o conteúdo atual visível (o spinner central só aparece na 1ª carga), então
  /// o refresh é silencioso. Não gera loop: loadData não dispara notificação.
  void _onEventoNotificacao() {
    _carregarContador();
    if (mounted) context.read<FinanceProvider>().loadData();
  }

  /// Busca o contador remoto de não lidas para o badge do sino.
  /// Só atualiza o estado se ainda montado; falhas retornam 0 (sem badge falso).
  Future<void> _carregarContador() async {
    final count = await ApiService.contarNotificacoesNaoLidas();
    if (mounted) setState(() => _naoLidas = count);
  }

  /// Abre a tela de notificações e, ao voltar, recarrega o contador
  /// (o usuário pode ter marcado itens como lidos lá dentro).
  Future<void> _abrirNotificacoes() async {
    AppLogger.action('menu_nav', params: {'destino': 'notificacoes'});
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const NotificacoesScreen()),
    );
    if (mounted) _carregarContador();
  }

  Future<void> _navegarPara(BuildContext context, Widget tela) async {
    Navigator.of(context).pop();
    final alterou = await Navigator.of(context).push(MaterialPageRoute(builder: (_) => tela));
    // Só recarrega se a tela sinalizou alteração (pop(context, true)).
    // Perfil/Histórico/Notificações não alteram dados → não disparam reload.
    if (alterou == true && context.mounted) context.read<FinanceProvider>().loadData();
  }

  /// Abre uma tela de lançamento (Despesa/Abastecimento/Vale) garantindo que o
  /// frete ativo já esteja resolvido. Usa o helper compartilhado SeletorFrete
  /// para lidar com 0/1/2+ fretes ativos, igual à Home.
  Future<void> _novoLancamentoComFrete(
    BuildContext context,
    Widget Function(String? freteId) builder,
  ) async {
    final finance = context.read<FinanceProvider>();
    Navigator.of(context).pop(); // fecha o drawer
    // Recarrega dados se o frete ativo ainda não foi carregado
    if (finance.fretesAtivos.isEmpty) {
      await finance.loadData();
    }
    if (!context.mounted) return;
    final freteId = await SeletorFrete.resolver(
      context,
      finance.fretesAtivos,
      // Drawer já foi fechado acima; navega direto (sem o pop inicial de _navegarPara).
      onIniciarFrete: () async {
        final criou = await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const AddFreteScreen()),
        );
        if (criou == true && context.mounted) finance.loadData();
      },
    );
    if (freteId == null || !context.mounted) return;
    final alterou = await Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => builder(freteId)));
    if (alterou == true && context.mounted) finance.loadData();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final finance = context.watch<FinanceProvider>();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final inicial = auth.nome.isNotEmpty ? auth.nome[0].toUpperCase() : 'M';

    return Scaffold(
      appBar: AppBar(
        title: Text(auth.nome),
        actions: [
          IconButton(
            tooltip: 'Notificações',
            onPressed: _abrirNotificacoes,
            // Sino maior e mais visível (pedido de UX). O AppBar é sempre verde,
            // então o ícone branco tem bom contraste no tema claro e no escuro.
            iconSize: 30,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            icon: Badge(
              isLabelVisible: _naoLidas > 0,
              backgroundColor: const Color(0xFFD32F2F),
              textColor: Colors.white,
              label: Text(
                _naoLidas > 99 ? '99+' : '$_naoLidas',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
              ),
              child: const Icon(Icons.notifications),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      drawer: Drawer(
        child: Column(
          children: [
            UserAccountsDrawerHeader(
              decoration: const BoxDecoration(color: Color(0xFF1B5E20)),
              accountName: Text(auth.nome, style: const TextStyle(fontWeight: FontWeight.bold)),
              accountEmail: const Text('Matopiba Log'),
              currentAccountPicture: CircleAvatar(
                backgroundColor: const Color(0xFF827717),
                backgroundImage: auth.fotoUrl.isNotEmpty ? NetworkImage(auth.fotoUrl) : null,
                child: auth.fotoUrl.isEmpty
                    ? Text(inicial, style: const TextStyle(color: Colors.white, fontSize: 22))
                    : null,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.home_outlined),
              title: const Text('Início'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'inicio'});
                Navigator.of(context).pop();
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_shipping_outlined),
              title: const Text('Novo Frete'),
              enabled: !finance.planoBloqueado,
              onTap: finance.planoBloqueado ? null : () {
                AppLogger.action('menu_nav', params: {'destino': 'add_frete'});
                _navegarPara(context, const AddFreteScreen());
              },
            ),
            ListTile(
              leading: const Icon(Icons.receipt_outlined),
              title: const Text('Nova Despesa'),
              enabled: !finance.planoBloqueado,
              onTap: finance.planoBloqueado ? null : () {
                AppLogger.action('menu_nav', params: {'destino': 'add_despesa'});
                _novoLancamentoComFrete(context, (freteId) => AddDespesaScreen(freteId: freteId));
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_gas_station_outlined),
              title: const Text('Novo Abastecimento'),
              enabled: !finance.planoBloqueado,
              onTap: finance.planoBloqueado ? null : () {
                AppLogger.action('menu_nav', params: {'destino': 'add_abastecimento'});
                _novoLancamentoComFrete(context, (freteId) => AddAbastecimentoScreen(freteId: freteId));
              },
            ),
            // Vale: oculto para autônomo (ele é proprietário, não faz sentido pedir vale)
            if (!auth.isAutonomo)
              ListTile(
                leading: const Icon(Icons.payments_outlined),
                title: const Text('Novo Vale'),
                enabled: !finance.planoBloqueado,
                onTap: finance.planoBloqueado ? null : () {
                  AppLogger.action('menu_nav', params: {'destino': 'add_vale'});
                  _novoLancamentoComFrete(context, (freteId) => AddValeScreen(freteId: freteId));
                },
              ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Histórico de Fretes'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'historico'});
                _navegarPara(context, const HistoricoScreen());
              },
            ),
            // Faturas só para AUTÔNOMO (dono do próprio negócio). Motorista
            // vinculado não vê o billing da transportadora (o backend também
            // barra com 403). A tela é read-only.
            if (auth.isAutonomo)
              ListTile(
                leading: const Icon(Icons.receipt_long_outlined),
                title: const Text('Minhas Faturas'),
                onTap: () {
                  AppLogger.action('menu_nav', params: {'destino': 'minhas_faturas'});
                  _navegarPara(context, const MinhasFaturasScreen());
                },
              ),
            ListTile(
              leading: const Icon(Icons.notifications_outlined),
              title: const Text('Notificações'),
              trailing: _naoLidas > 0
                  ? Badge(label: Text(_naoLidas > 99 ? '99+' : '$_naoLidas'))
                  : null,
              onTap: () {
                Navigator.of(context).pop();
                _abrirNotificacoes();
              },
            ),
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('Perfil'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'perfil'});
                _navegarPara(context, const PerfilScreen());
              },
            ),
            const Divider(),
            ListTile(
              leading: Icon(isDark ? Icons.wb_sunny_outlined : Icons.dark_mode_outlined),
              title: Text(isDark ? 'Modo Claro' : 'Modo Escuro'),
              onTap: () {
                Navigator.of(context).pop();
                context.read<ThemeProvider>().toggleTheme();
              },
            ),
            const Spacer(),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.logout, color: Colors.red),
              title: const Text('Sair', style: TextStyle(color: Colors.red)),
              onTap: () {
                AppLogger.action('logout_menu');
                auth.logout();
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
      body: const HomeScreen(),
    );
  }
}
