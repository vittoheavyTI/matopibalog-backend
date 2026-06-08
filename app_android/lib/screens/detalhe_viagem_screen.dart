import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class DetalheViagemScreen extends StatefulWidget {
  final Map<String, dynamic> frete;

  const DetalheViagemScreen({super.key, required this.frete});

  @override
  State<DetalheViagemScreen> createState() => _DetalheViagemScreenState();
}

class _DetalheViagemScreenState extends State<DetalheViagemScreen> {
  List<dynamic> _despesas = [];
  List<dynamic> _abastecimentos = [];
  List<dynamic> _vales = [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'detalhe_viagem', 'frete_id': widget.frete['id']?.toString()});
    _fetchDetalhes();
  }

  Future<void> _fetchDetalhes() async {
    setState(() { _loading = true; _error = ''; });
    final freteId = widget.frete['id']?.toString() ?? '';
    if (freteId.isEmpty) {
      setState(() { _loading = false; });
      return;
    }
    try {
      final results = await Future.wait([
        ApiService.getListComFiltro('despesas', {'frete_id': freteId}),
        ApiService.getListComFiltro('abastecimentos', {'frete_id': freteId}),
        ApiService.getListComFiltro('vales', {'frete_id': freteId}),
      ]);
      if (mounted) {
        setState(() {
          _despesas = results[0];
          _abastecimentos = results[1];
          _vales = results[2];
          _loading = false;
        });
        AppLogger.action('detalhe_viagem_fetch_ok', params: {
          'despesas': _despesas.length,
          'abastecimentos': _abastecimentos.length,
          'vales': _vales.length,
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() { _error = 'Erro ao carregar detalhes.'; _loading = false; });
        AppLogger.error('DetalheViagem', 'fetchDetalhes', e);
      }
    }
  }

  double _soma(List<dynamic> items, String campo, {String? filtroStatus}) {
    double total = 0.0;
    for (final item in items) {
      if (filtroStatus != null && item['status'] != filtroStatus) continue;
      total += double.tryParse(item[campo]?.toString() ?? '0') ?? 0.0;
    }
    return total;
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.frete;
    final origem = f['origem'] ?? '-';
    final destino = f['destino'] ?? '-';

    return Scaffold(
      appBar: AppBar(title: Text('$origem → $destino', overflow: TextOverflow.ellipsis)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? Center(child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(_error),
                    const SizedBox(height: 12),
                    ElevatedButton(onPressed: _fetchDetalhes, child: const Text('Tentar novamente')),
                  ],
                ))
              : RefreshIndicator(
                  onRefresh: _fetchDetalhes,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _cardFrete(f),
                        const SizedBox(height: 16),
                        if (_despesas.isNotEmpty) ...[
                          _secaoLancamentos('Despesas', _despesas, 'valor'),
                          const SizedBox(height: 12),
                        ],
                        if (_abastecimentos.isNotEmpty) ...[
                          _secaoLancamentos('Abastecimentos', _abastecimentos, 'valor_total'),
                          const SizedBox(height: 12),
                        ],
                        if (_vales.isNotEmpty) ...[
                          _secaoLancamentos('Vales', _vales, 'valor'),
                          const SizedBox(height: 12),
                        ],
                        _cardResumo(f),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
                ),
    );
  }

  Widget _cardFrete(Map<String, dynamic> f) {
    final data = f['data'] != null
        ? DateFormat('dd/MM/yyyy').format(DateTime.parse(f['data']))
        : '--';
    final status = f['status'] ?? 'pendente';
    final valorFrete = double.tryParse(f['valor_frete']?.toString() ?? '0') ?? 0.0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20)),
                const SizedBox(width: 8),
                const Text('Dados do Frete', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const Spacer(),
                _badge(status),
              ],
            ),
            const Divider(),
            _linhaDado('Data', data),
            _linhaDado('Origem', f['origem'] ?? '--'),
            _linhaDado('Destino', f['destino'] ?? '--'),
            if (f['placa'] != null) _linhaDado('Placa', f['placa']),
            _linhaDado('Valor', 'R\$ ${valorFrete.toStringAsFixed(2)}'),
            if (f['quem_recebeu'] != null) _linhaDado('Quem recebeu', f['quem_recebeu']),
          ],
        ),
      ),
    );
  }

  Widget _secaoLancamentos(String titulo, List<dynamic> items, String campovalor) {
    final aprovados = items.where((i) => i['status'] == 'aprovado').toList();
    final pendentes = items.where((i) => i['status'] == 'pendente').toList();
    final rejeitados = items.where((i) => i['status'] == 'rejeitado').toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            const Divider(),
            if (aprovados.isNotEmpty) ...[
              _subSecao('Aprovados', aprovados, campovalor, Colors.green),
            ],
            if (pendentes.isNotEmpty) ...[
              _subSecao('Pendentes', pendentes, campovalor, Colors.orange),
            ],
            if (rejeitados.isNotEmpty) ...[
              _subSecao('Rejeitados', rejeitados, campovalor, Colors.red),
            ],
          ],
        ),
      ),
    );
  }

  Widget _subSecao(String label, List<dynamic> items, String campoValor, Color cor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(label, style: TextStyle(color: cor, fontSize: 12, fontWeight: FontWeight.w600)),
        ),
        ...items.map((item) {
          final val = double.tryParse(item[campoValor]?.toString() ?? '0') ?? 0.0;
          final desc = item['descricao'] ?? item['posto'] ?? item['tipo'] ?? '-';
          return Padding(
            padding: const EdgeInsets.only(left: 8, bottom: 4),
            child: Row(
              children: [
                Expanded(child: Text(desc, style: const TextStyle(fontSize: 13))),
                Text('R\$ ${val.toStringAsFixed(2)}', style: TextStyle(fontSize: 13, color: cor)),
              ],
            ),
          );
        }),
        const SizedBox(height: 4),
      ],
    );
  }

  Widget _cardResumo(Map<String, dynamic> f) {
    final valorFrete = double.tryParse(f['valor_frete']?.toString() ?? '0') ?? 0.0;
    const comissaoPct = 12.0;
    final comissao = valorFrete * (comissaoPct / 100);

    final despesasAprov = _soma(_despesas, 'valor', filtroStatus: 'aprovado');
    final abastAprov = _soma(_abastecimentos, 'valor_total', filtroStatus: 'aprovado');
    final valesAprov = _soma(_vales, 'valor', filtroStatus: 'aprovado');
    final totalDeducoes = despesasAprov + abastAprov + valesAprov;
    final saldoLiquido = comissao - totalDeducoes;

    final pendentes = _despesas.where((i) => i['status'] == 'pendente').length +
        _abastecimentos.where((i) => i['status'] == 'pendente').length +
        _vales.where((i) => i['status'] == 'pendente').length;
    final rejeitados = _despesas.where((i) => i['status'] == 'rejeitado').length +
        _abastecimentos.where((i) => i['status'] == 'rejeitado').length +
        _vales.where((i) => i['status'] == 'rejeitado').length;

    return Card(
      color: const Color(0xFF1B5E20).withValues(alpha: 0.05),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Resumo Final', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1B5E20))),
            const Divider(),
            _linhaResumo('Valor do Frete', valorFrete),
            _linhaResumo('Comissão ($comissaoPct%)', comissao, color: Colors.blue),
            _linhaResumo('Despesas aprovadas', -despesasAprov, color: Colors.red),
            _linhaResumo('Abastecimentos aprovados', -abastAprov, color: Colors.red),
            _linhaResumo('Vales aprovados', -valesAprov, color: Colors.red),
            const Divider(),
            _linhaResumo('Saldo Líquido', saldoLiquido, color: saldoLiquido >= 0 ? Colors.green : Colors.red, bold: true),
            if (pendentes > 0)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    Icon(Icons.warning_amber_outlined, color: Colors.orange.shade700, size: 16),
                    const SizedBox(width: 4),
                    Text('$pendentes lançamento(s) pendente(s)', style: TextStyle(color: Colors.orange.shade700, fontSize: 12)),
                  ],
                ),
              ),
            if (rejeitados > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    const Icon(Icons.cancel_outlined, color: Colors.red, size: 16),
                    const SizedBox(width: 4),
                    Text('$rejeitados lançamento(s) rejeitado(s)', style: const TextStyle(color: Colors.red, fontSize: 12)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _linhaResumo(String label, double valor, {Color? color, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
          Text(
            'R\$ ${valor.abs().toStringAsFixed(2)}',
            style: TextStyle(
              color: color ?? Theme.of(context).colorScheme.onSurface,
              fontWeight: bold ? FontWeight.bold : FontWeight.normal,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _linhaDado(String label, String valor) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Expanded(child: Text(valor, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }

  Widget _badge(String status) {
    final color = _corStatus(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
      child: Text(status, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }

  Color _corStatus(String status) {
    switch (status) {
      case 'finalizado': return Colors.green;
      case 'em_viagem': return Colors.blue;
      case 'cancelado': return Colors.red;
      default: return Colors.orange;
    }
  }
}
