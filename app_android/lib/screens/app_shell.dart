import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/finance_provider.dart';
import '../providers/theme_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../widgets/seletor_frete.dart';
import 'home_screen.dart';
import 'historico_screen.dart';
import 'add_frete_screen.dart';
import 'add_despesa_screen.dart';
import 'add_abastecimento_screen.dart';
import 'add_vale_screen.dart';
import 'perfil_screen.dart';
import 'notificacoes_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _naoLidas = 0;

  @override
  void initState() {
    super.initState();
    _carregarContador();
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final inicial = auth.nome.isNotEmpty ? auth.nome[0].toUpperCase() : 'M';

    return Scaffold(
      appBar: AppBar(
        title: Text(auth.nome),
        actions: [
          IconButton(
            tooltip: 'Notificações',
            onPressed: _abrirNotificacoes,
            icon: Badge(
              isLabelVisible: _naoLidas > 0,
              label: Text(_naoLidas > 99 ? '99+' : '$_naoLidas'),
              child: const Icon(Icons.notifications_outlined),
            ),
          ),
          const SizedBox(width: 4),
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
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'add_frete'});
                _navegarPara(context, const AddFreteScreen());
              },
            ),
            ListTile(
              leading: const Icon(Icons.receipt_outlined),
              title: const Text('Nova Despesa'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'add_despesa'});
                _novoLancamentoComFrete(context, (freteId) => AddDespesaScreen(freteId: freteId));
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_gas_station_outlined),
              title: const Text('Novo Abastecimento'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'add_abastecimento'});
                _novoLancamentoComFrete(context, (freteId) => AddAbastecimentoScreen(freteId: freteId));
              },
            ),
            // Vale: oculto para autônomo (ele é proprietário, não faz sentido pedir vale)
            if (!auth.isAutonomo)
              ListTile(
                leading: const Icon(Icons.payments_outlined),
                title: const Text('Novo Vale'),
                onTap: () {
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
