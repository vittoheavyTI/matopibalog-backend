import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/finance_provider.dart';
import '../services/app_logger.dart';
import 'add_frete_screen.dart';
import 'add_despesa_screen.dart';
import 'add_abastecimento_screen.dart';
import 'add_vale_screen.dart';
import 'historico_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'home'});
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<FinanceProvider>().loadData();
    });
  }

  Future<void> _refresh() async {
    await context.read<FinanceProvider>().loadData();
  }

  @override
  Widget build(BuildContext context) {
    final finance = context.watch<FinanceProvider>();

    return RefreshIndicator(
        onRefresh: _refresh,
        child: finance.loading
            ? const Center(child: CircularProgressIndicator())
            : SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (finance.error.isNotEmpty)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: Colors.orange.shade50,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.orange.shade200),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.warning_amber_rounded, color: Colors.orange.shade700),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                finance.error,
                                style: TextStyle(color: Colors.orange.shade900),
                              ),
                            ),
                          ],
                        ),
                      ),
                    Card(
                      elevation: 4,
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          children: [
                            const Text(
                              'Resumo do Mês',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const Divider(),
                            _infoRow('Total Fretes', finance.totalFretes),
                            _infoRow(
                              'Comissão (${finance.percentualComissao.toStringAsFixed(1)}%)',
                              finance.comissao,
                              color: Colors.blue,
                            ),
                            _infoRow(
                              'Deduções (Empresa)',
                              finance.deducoes,
                              color: Colors.red,
                            ),
                            const Divider(),
                            _infoRow(
                              'Saldo a Receber',
                              finance.saldo,
                              color: Colors.green,
                              bold: true,
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    _buildBtn(
                      context,
                      'ADICIONAR FRETE',
                      Icons.local_shipping,
                      const AddFreteScreen(),
                    ),
                    _buildBtn(
                      context,
                      'ADICIONAR DESPESA',
                      Icons.receipt,
                      const AddDespesaScreen(),
                    ),
                    _buildBtn(
                      context,
                      'ADICIONAR ABASTECIMENTO',
                      Icons.local_gas_station,
                      const AddAbastecimentoScreen(),
                    ),
                    _buildBtn(
                      context,
                      'ADICIONAR VALE',
                      Icons.money,
                      const AddValeScreen(),
                    ),
                    _buildBtn(
                      context,
                      'HISTÓRICO',
                      Icons.history,
                      const HistoricoScreen(),
                      color: Colors.grey,
                    ),
                  ],
                ),
              ),
    );
  }

  Widget _infoRow(
    String label,
    double value, {
    Color? color,
    bool bold = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontWeight: bold ? FontWeight.bold : FontWeight.normal,
            ),
          ),
          Text(
            'R\$ ${value.toStringAsFixed(2)}',
            style: TextStyle(
              color: color ?? Theme.of(context).colorScheme.onSurface,
              fontWeight: bold ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBtn(
    BuildContext context,
    String title,
    IconData icon,
    Widget screen, {
    Color? color,
  }) {
    final btnColor = color ?? Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: ElevatedButton.icon(
        icon: Icon(icon, size: 28),
        label: Text(title, style: const TextStyle(fontSize: 16)),
        style: ElevatedButton.styleFrom(
          backgroundColor: btnColor,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
        onPressed: () async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => screen,
          ));
          if (mounted) _refresh();
        },
      ),
    );
  }
}