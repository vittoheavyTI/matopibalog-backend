import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
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

  Future<void> _navegarERefresh(Widget tela) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => tela));
    if (mounted) _refresh();
  }

  void _abrirNovoLancamento() {
    AppLogger.action('novo_lancamento_sheet_open');
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 16),
            const Text('Novo Lançamento', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ListTile(
              leading: const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Frete'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(const AddFreteScreen()); },
            ),
            ListTile(
              leading: const Icon(Icons.receipt_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Despesa'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(const AddDespesaScreen()); },
            ),
            ListTile(
              leading: const Icon(Icons.local_gas_station_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Abastecimento'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(const AddAbastecimentoScreen()); },
            ),
            ListTile(
              leading: const Icon(Icons.payments_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Vale'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(const AddValeScreen()); },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
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
                          Expanded(child: Text(finance.error, style: TextStyle(color: Colors.orange.shade900))),
                        ],
                      ),
                    ),

                  // Resumo financeiro
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          const Text('Resumo do Mês', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                          const Divider(),
                          _infoRow('Total Fretes', finance.totalFretes),
                          _infoRow(
                            'Comissão (${finance.percentualComissao.toStringAsFixed(1)}%)',
                            finance.comissao,
                            color: Colors.blue,
                          ),
                          _infoRow('Deduções (Empresa)', finance.deducoes, color: Colors.red),
                          const Divider(),
                          _infoRow('Saldo a Receber', finance.saldo, color: Colors.green, bold: true),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Botão principal
                  SizedBox(
                    height: 52,
                    child: ElevatedButton.icon(
                      icon: const Icon(Icons.add, size: 22),
                      label: const Text('NOVO LANÇAMENTO', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      onPressed: _abrirNovoLancamento,
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Últimas viagens
                  if (finance.fretes.isNotEmpty) ...[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Últimas Viagens', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                        TextButton(
                          onPressed: () => _navegarERefresh(const HistoricoScreen()),
                          child: const Text('Ver todas'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    ...finance.fretes.take(3).map((f) => _buildViagemCard(f)),
                  ] else ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            Icon(Icons.local_shipping_outlined, size: 48, color: Colors.grey.shade400),
                            const SizedBox(height: 8),
                            Text('Nenhuma viagem ainda.', style: TextStyle(color: Colors.grey.shade600)),
                            const SizedBox(height: 4),
                            Text('Toque em NOVO LANÇAMENTO para começar.', style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _buildViagemCard(dynamic frete) {
    final data = frete['data'] != null
        ? DateFormat('dd/MM/yyyy').format(DateTime.parse(frete['data']))
        : '--';
    final valor = double.tryParse(frete['valor_frete']?.toString() ?? '0') ?? 0.0;
    final status = frete['status'] ?? 'pendente';
    final Color statusColor = status == 'finalizado'
        ? Colors.green
        : status == 'em_viagem'
            ? Colors.blue
            : Colors.orange;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20)),
        title: Text('${frete['origem'] ?? '-'} → ${frete['destino'] ?? '-'}'),
        subtitle: Text(data),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('R\$ ${valor.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 2),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
              child: Text(status, style: TextStyle(color: statusColor, fontSize: 10)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, double value, {Color? color, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal)),
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
}
