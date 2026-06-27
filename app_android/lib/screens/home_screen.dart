import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../providers/auth_provider.dart';
import '../providers/finance_provider.dart';
import '../services/app_logger.dart';
import '../widgets/seletor_frete.dart';
import 'add_frete_screen.dart';
import 'add_despesa_screen.dart';
import 'add_abastecimento_screen.dart';
import 'add_vale_screen.dart';
import 'historico_screen.dart';
import 'detalhe_viagem_screen.dart';

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
    // Só recarrega se a tela retornou true (lançamento/frete salvo).
    // "Ver todos" → Histórico não altera dados → não dispara reload.
    final alterou = await Navigator.push(context, MaterialPageRoute(builder: (_) => tela));
    if (alterou == true && mounted) _refresh();
  }

  void _abrirNovoLancamento() {
    AppLogger.action('novo_lancamento_sheet_open');
    final finance = context.read<FinanceProvider>();
    // Usa o helper compartilhado para resolver 0/1/2+ fretes ativos.
    // O seletor modal é o mesmo bottom sheet usado pelo drawer.
    SeletorFrete.resolver(context, finance.fretesAtivos).then((freteId) {
      if (freteId != null && mounted) {
        _mostrarBottomSheetLancamento(freteId);
      }
    });
  }

  /// Seletor modal quando há mais de um frete ativo.
  /// Bottom sheet de tipo de lançamento, extraído com [freteId] por parâmetro.
  void _mostrarBottomSheetLancamento(String? freteId) {
    AppLogger.action('novo_lancamento_sheet_open');
    final isAutonomo = context.read<AuthProvider>().isAutonomo;
    final finance = context.read<FinanceProvider>();
    // Resolve o frete realmente escolhido pelo freteId (pode não ser o mais
    // recente quando há 2+ ativos). Antes usava finance.freteAtivo, que mostrava
    // sempre o mais recente — texto podia divergir do frete em que o lançamento cai.
    final freteEscolhido = finance.fretesAtivos.firstWhere(
      (f) => f['id']?.toString() == freteId,
      orElse: () => finance.freteAtivo ?? <String, dynamic>{},
    );

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
            if (freteEscolhido.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: Text(
                  'Despesa/Abastecimento/Vale serão vinculados ao frete ativo: '
                  '${freteEscolhido['origem'] ?? '-'} → ${freteEscolhido['destino'] ?? '-'}',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                ),
              ),
            const SizedBox(height: 8),
            ListTile(
              leading: const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Frete'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(const AddFreteScreen()); },
            ),
            ListTile(
              leading: const Icon(Icons.receipt_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Despesa'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(AddDespesaScreen(freteId: freteId)); },
            ),
            ListTile(
              leading: const Icon(Icons.local_gas_station_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Abastecimento'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(AddAbastecimentoScreen(freteId: freteId)); },
            ),
            ListTile(
              leading: const Icon(Icons.build_outlined, color: Color(0xFF1B5E20)),
              title: const Text('Manutenção'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(AddDespesaScreen(freteId: freteId, tipoInicial: 'Manutenção')); },
            ),
            ListTile(
              leading: const Icon(Icons.more_horiz, color: Color(0xFF1B5E20)),
              title: const Text('Outro'),
              onTap: () { Navigator.pop(ctx); _navegarERefresh(AddDespesaScreen(freteId: freteId, tipoInicial: 'Outros')); },
            ),
            // Vale: oculto para autônomo (ele é proprietário, não faz sentido)
            if (!isAutonomo)
              ListTile(
                leading: const Icon(Icons.payments_outlined, color: Color(0xFF1B5E20)),
                title: const Text('Vale'),
                onTap: () { Navigator.pop(ctx); _navegarERefresh(AddValeScreen(freteId: freteId)); },
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

    // Filtro para "Últimos Fretes": fretes ativos (qualquer mês) + fretes do mês vigente.
    // Finalizados/cancelados de meses anteriores ficam só no Histórico.
    final ymAtual = DateFormat('yyyy-MM').format(DateTime.now());
    final idsAtivos = finance.fretesAtivos
        .map((f) => f['id']?.toString())
        .where((id) => id != null)
        .toSet();
    final fretesHome = finance.fretes.where((f) {
      // Cancelados não aparecem na Home (ficam só no Histórico).
      if ((f['status'] ?? '').toString() == 'cancelado') return false;
      final id = f['id']?.toString();
      if (id != null && idsAtivos.contains(id)) return true;
      final data = f['data']?.toString() ?? '';
      return data.startsWith(ymAtual);
    }).toList();
    // Ativos/pendentes no topo, finalizados depois; dentro do grupo, data desc.
    // Apenas reordena a lista de exibição — não altera nenhum cálculo.
    _ordenarFretesPorPrioridade(fretesHome);

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
                          if (finance.isAutonomo) ...[
                            _infoRow('Faturamento', finance.totalFretesMes),
                            _infoRow('Despesas', finance.deducoesMes, color: Colors.red),
                            const Divider(),
                            _infoRow('Resultado', finance.saldoMes, color: finance.saldoMes >= 0 ? Colors.green : Colors.red, bold: true),
                          ] else ...[
                            _infoRow('Total Fretes', finance.totalFretesMes),
                            _infoRow(
                              'Comissão (${finance.percentualComissao.toStringAsFixed(1)}%)',
                              finance.comissaoMes,
                              color: Colors.blue,
                            ),
                            _infoRow('Despesas', finance.deducoesMes, color: Colors.red),
                            const Divider(),
                            _infoRow('Saldo a Receber', finance.saldoMes, color: Colors.green, bold: true),
                          ],
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

                  // Últimos fretes: mostra apenas fretes ativos (qualquer mês) + fretes do mês vigente.
                  // Finalizados/cancelados de meses anteriores ficam só no Histórico.
                  if (finance.fretes.isNotEmpty && fretesHome.isEmpty) ...[
                    // Existem fretes no geral, mas nenhum se encaixa nos critérios da Home
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            Icon(Icons.search_off, size: 48, color: Colors.grey.shade400),
                            const SizedBox(height: 8),
                            Text(
                              'Sem fretes ativos ou do mês atual.',
                              style: TextStyle(color: Colors.grey.shade600),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Consulte o Histórico de Fretes para ver registros anteriores.',
                              style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ] else if (fretesHome.isNotEmpty) ...[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Últimos Fretes', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                        TextButton(
                          onPressed: () => _navegarERefresh(const HistoricoScreen()),
                          style: TextButton.styleFrom(
                            foregroundColor: Theme.of(context).colorScheme.onSurface,
                            textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                          child: const Text('Histórico de Fretes'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    ...fretesHome.take(3).map((f) => _buildViagemCard(f)),
                  ] else ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            Icon(Icons.local_shipping_outlined, size: 48, color: Colors.grey.shade400),
                            const SizedBox(height: 8),
                            Text('Nenhum frete ainda.', style: TextStyle(color: Colors.grey.shade600)),
                            const SizedBox(height: 4),
                            Text('Toque em NOVO LANÇAMENTO para começar.', style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
                          ],
                        ),
                      ),
                    ),
                  ],

                  // Últimos lançamentos (despesas, abastecimentos, vales)
                  ..._buildUltimosLancamentos(finance),
                ],
              ),
            ),
    );
  }

  List<Widget> _buildUltimosLancamentos(FinanceProvider finance) {
    final items = <Map<String, dynamic>>[];
    for (final d in finance.despesas) {
      items.add({...Map<String, dynamic>.from(d as Map), '_tipo': 'despesa'});
    }
    for (final a in finance.abastecimentos) {
      items.add({...Map<String, dynamic>.from(a as Map), '_tipo': 'abastecimento'});
    }
    for (final v in finance.vales) {
      items.add({...Map<String, dynamic>.from(v as Map), '_tipo': 'vale'});
    }
    if (items.isEmpty) return [];

    items.sort((a, b) {
      final da = (a['created_at'] ?? a['data'] ?? '') as String;
      final db = (b['created_at'] ?? b['data'] ?? '') as String;
      return db.compareTo(da);
    });

    final recentes = items.take(5).toList();
    return [
      const SizedBox(height: 20),
      const Text('Últimos Lançamentos', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
      const SizedBox(height: 8),
      ...recentes.map((item) => _buildLancamentoCard(item)),
    ];
  }

  Widget _buildLancamentoCard(Map<String, dynamic> item) {
    final tipo = item['_tipo'] as String;
    final valor = tipo == 'abastecimento'
        ? double.tryParse(item['valor_total']?.toString() ?? '0') ?? 0.0
        : double.tryParse(item['valor']?.toString() ?? '0') ?? 0.0;

    final String desc;
    if (tipo == 'despesa') {
      desc = item['descricao'] as String? ?? item['tipo'] as String? ?? 'Despesa';
    } else if (tipo == 'abastecimento') {
      desc = item['posto'] as String? ?? 'Abastecimento';
    } else {
      desc = item['posto'] as String? ?? 'Vale';
    }

    String dataStr = '--';
    final rawDate = item['created_at'] ?? item['data'];
    if (rawDate != null) {
      try {
        dataStr = DateFormat('dd/MM').format(DateTime.parse(rawDate as String));
      } catch (_) {}
    }

    final IconData icon;
    final String label;
    final Color color;
    switch (tipo) {
      case 'despesa':
        icon = Icons.receipt_outlined;
        label = 'Despesa';
        color = Colors.orange.shade700;
        break;
      case 'abastecimento':
        icon = Icons.local_gas_station_outlined;
        label = 'Abastecimento';
        color = Colors.blue.shade700;
        break;
      default:
        icon = Icons.payments_outlined;
        label = 'Vale';
        color = Colors.purple.shade700;
    }

    final status = item['status'] as String? ?? 'pendente';
    final obs = item['obs_resolucao'] as String?;
    final Color statusColor = status == 'aprovado'
        ? Colors.green
        : status == 'rejeitado'
            ? Colors.red
            : Colors.orange;

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: ListTile(
        dense: true,
        leading: CircleAvatar(
          radius: 18,
          backgroundColor: color.withValues(alpha: 0.12),
          child: Icon(icon, color: color, size: 18),
        ),
        title: Text(desc, style: const TextStyle(fontSize: 15), overflow: TextOverflow.ellipsis),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$label · $dataStr', style: const TextStyle(fontSize: 14)),
            if (obs != null && obs.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  '${status == 'rejeitado' ? 'Motivo' : 'Obs'}: $obs',
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade600, fontStyle: FontStyle.italic),
                ),
              ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              'R\$ ${valor.toStringAsFixed(2)}',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: color),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(status, style: TextStyle(color: statusColor, fontSize: 12)),
            ),
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
        onTap: () => _navegarERefresh(DetalheViagemScreen(frete: frete)),
        leading: const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20)),
        title: Text('${frete['origem'] ?? '-'} → ${frete['destino'] ?? '-'}'),
        subtitle: Text(data),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('R\$ ${valor.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 2),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
              child: Text(status, style: TextStyle(color: statusColor, fontSize: 12)),
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

/// Prioridade de exibição por status: ativos/pendentes no topo, finalizados
/// depois, cancelados por último. Não influencia nenhum cálculo financeiro.
int _prioridadeStatusFrete(String status) {
  switch (status) {
    case 'ativo':
      return 0;
    case 'pendente':
      return 1;
    case 'em_viagem':
    case 'em_andamento':
      return 2;
    case 'finalizado':
      return 3;
    case 'cancelado':
      return 5;
    default:
      return 4;
  }
}

/// Ordena a lista (in-place) por prioridade de status e, dentro da mesma
/// prioridade, por data decrescente (mais recente primeiro). Reordena apenas
/// a lista de exibição; não altera valores nem cálculos.
void _ordenarFretesPorPrioridade(List<dynamic> fretes) {
  fretes.sort((a, b) {
    final pa = _prioridadeStatusFrete((a['status'] ?? '').toString());
    final pb = _prioridadeStatusFrete((b['status'] ?? '').toString());
    if (pa != pb) return pa.compareTo(pb);
    final da = (a['data'] ?? a['criadoEm'] ?? a['created_at'] ?? '').toString();
    final db = (b['data'] ?? b['criadoEm'] ?? b['created_at'] ?? '').toString();
    return db.compareTo(da);
  });
}
