import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/finance_provider.dart';
import '../providers/theme_provider.dart';
import '../services/app_logger.dart';
import 'home_screen.dart';
import 'historico_screen.dart';
import 'add_frete_screen.dart';
import 'add_despesa_screen.dart';
import 'add_abastecimento_screen.dart';
import 'add_vale_screen.dart';

class AppShell extends StatelessWidget {
  const AppShell({super.key});

  Future<void> _navegarPara(BuildContext context, Widget tela) async {
    Navigator.of(context).pop();
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => tela));
    if (context.mounted) context.read<FinanceProvider>().loadData();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final inicial = auth.nome.isNotEmpty ? auth.nome[0].toUpperCase() : 'M';

    return Scaffold(
      appBar: AppBar(
        title: Text('Olá, ${auth.nome}'),
        actions: [
          IconButton(
            icon: Icon(isDark ? Icons.wb_sunny_outlined : Icons.dark_mode_outlined),
            tooltip: isDark ? 'Modo claro' : 'Modo escuro',
            onPressed: () => context.read<ThemeProvider>().toggleTheme(),
          ),
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
                child: Text(inicial, style: const TextStyle(color: Colors.white, fontSize: 22)),
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
                _navegarPara(context, const AddDespesaScreen());
              },
            ),
            ListTile(
              leading: const Icon(Icons.local_gas_station_outlined),
              title: const Text('Novo Abastecimento'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'add_abastecimento'});
                _navegarPara(context, const AddAbastecimentoScreen());
              },
            ),
            ListTile(
              leading: const Icon(Icons.payments_outlined),
              title: const Text('Novo Vale'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'add_vale'});
                _navegarPara(context, const AddValeScreen());
              },
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Histórico'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'historico'});
                _navegarPara(context, const HistoricoScreen());
              },
            ),
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('Perfil'),
              onTap: () {
                AppLogger.action('menu_nav', params: {'destino': 'perfil'});
                Navigator.of(context).pop();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Perfil em breve.')),
                );
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
