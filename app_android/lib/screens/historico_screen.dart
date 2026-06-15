import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import 'detalhe_viagem_screen.dart';

class HistoricoScreen extends StatefulWidget {
  const HistoricoScreen({super.key});

  @override
  State<HistoricoScreen> createState() => _HistoricoScreenState();
}

class _HistoricoScreenState extends State<HistoricoScreen> {
  List<dynamic> _fretes = [];
  bool _loading = true;
  String _error = '';

  // Filtro de período: inicia no mês/ano vigente
  late int _mesSelecionado;
  late int _anoSelecionado;

  static const _meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];

  @override
  void initState() {
    super.initState();
    final agora = DateTime.now();
    _mesSelecionado = agora.month;
    _anoSelecionado = agora.year;
    AppLogger.action('screen_open', params: {'tela': 'historico_fretes'});
    _fetchFretes();
  }

  String get _dataInicio {
    return '$_anoSelecionado-${_mesSelecionado.toString().padLeft(2, '0')}-01';
  }

  String get _dataFim {
    // Primeiro dia do mês seguinte (o backend usa lte, então vamos usar o último dia do mês)
    final ultimo = DateTime(_anoSelecionado, _mesSelecionado + 1, 0);
    return '${ultimo.year}-${ultimo.month.toString().padLeft(2, '0')}-${ultimo.day.toString().padLeft(2, '0')}';
  }

  Future<void> _fetchFretes() async {
    AppLogger.action('historico_fetch', params: {'mes': _mesSelecionado, 'ano': _anoSelecionado});
    setState(() { _loading = true; _error = ''; });
    try {
      final data = await ApiService.getFretesComFiltro(_dataInicio, _dataFim);
      if (mounted) {
        setState(() { _fretes = data; _loading = false; });
        AppLogger.action('historico_fetch_ok', params: {'total': data.length, 'mes': _mesSelecionado, 'ano': _anoSelecionado});
      }
    } catch (e) {
      if (mounted) {
        setState(() { _error = 'Erro ao carregar fretes. Verifique sua conexão.'; _loading = false; });
        AppLogger.error('HistoricoScreen', 'fetchFretes', e);
      }
    }
  }

  void _onFiltroAlterado({int? mes, int? ano}) {
    setState(() {
      if (mes != null) _mesSelecionado = mes;
      if (ano != null) _anoSelecionado = ano;
    });
    _fetchFretes();
  }

  @override
  Widget build(BuildContext context) {
    final anoAtual = DateTime.now().year;
    final anos = List.generate(6, (i) => anoAtual - i); // ano atual + 5 anteriores

    return Scaffold(
      appBar: AppBar(title: const Text('Histórico de Fretes')),
      body: Column(
        children: [
          // Seletor de mês/ano
          Container(
            color: Theme.of(context).colorScheme.surface,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: DropdownButtonFormField<int>(
                    value: _mesSelecionado,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Mês',
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(),
                    ),
                    items: List.generate(12, (i) => DropdownMenuItem(
                      value: i + 1,
                      child: Text(_meses[i], overflow: TextOverflow.ellipsis),
                    )),
                    onChanged: (v) { if (v != null) _onFiltroAlterado(mes: v); },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: DropdownButtonFormField<int>(
                    value: _anoSelecionado,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Ano',
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(),
                    ),
                    items: anos.map((a) => DropdownMenuItem(value: a, child: Text('$a'))).toList(),
                    onChanged: (v) { if (v != null) _onFiltroAlterado(ano: v); },
                  ),
                ),
              ],
            ),
          ),
          // Cabeçalho do período
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Text(
              '${_meses[_mesSelecionado - 1]} de $_anoSelecionado',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
          ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_error.isNotEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.cloud_off, size: 64, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(_error, textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade600, fontSize: 16)),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _fetchFretes,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    if (_fretes.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.local_shipping_outlined, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(
              'Nenhum frete encontrado para\n${_meses[_mesSelecionado - 1]} de $_anoSelecionado.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600, fontSize: 16),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchFretes,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _fretes.length,
        itemBuilder: (context, index) => _buildFreteCard(_fretes[index]),
      ),
    );
  }

  Widget _buildFreteCard(dynamic frete) {
    final data = frete['data'] != null
        ? DateFormat('dd/MM/yyyy').format(DateTime.parse(frete['data']))
        : '--';
    final valor = double.tryParse(frete['valor_frete']?.toString() ?? '0') ?? 0.0;
    final status = frete['status'] ?? 'pendente';
    final Color statusColor = _corStatus(status);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () async {
          AppLogger.action('frete_detalhe_abrir', params: {'frete_id': frete['id']?.toString()});
          final result = await Navigator.push(context, MaterialPageRoute(
            builder: (_) => DetalheViagemScreen(frete: frete),
          ));
          // Frete finalizado (ou alterado) dentro do detalhe → recarrega a lista
          // para refletir o novo status no card.
          if (result == true && mounted) {
            await _fetchFretes();
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20), size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${frete['origem'] ?? '-'} → ${frete['destino'] ?? '-'}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Colors.grey),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.calendar_today_outlined, size: 13, color: Colors.grey.shade500),
                  const SizedBox(width: 4),
                  Text(data, style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                  const Spacer(),
                  Text(
                    'R\$ ${valor.toStringAsFixed(2)}',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(status, style: TextStyle(color: statusColor, fontSize: 11)),
                  ),
                ],
              ),
              if (frete['placa'] != null) ...[
                const SizedBox(height: 4),
                Text(frete['placa'], style: TextStyle(color: Colors.grey.shade500, fontSize: 11)),
              ],
            ],
          ),
        ),
      ),
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
