import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import 'package:intl/intl.dart';

class HistoricoScreen extends StatefulWidget {
  const HistoricoScreen({super.key});

  @override
  State<HistoricoScreen> createState() => _HistoricoScreenState();
}

class _HistoricoScreenState extends State<HistoricoScreen> {
  List<dynamic> _items = [];
  bool _loading = true;
  String _error = '';
  String _tipoFiltro = 'fretes';

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'historico'});
    _fetchData();
  }

  Future<void> _fetchData() async {
    AppLogger.action('historico_fetch', params: {'tipo': _tipoFiltro});
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final data = await ApiService.getList(_tipoFiltro);
      if (mounted) {
        setState(() {
          _items = data;
          _loading = false;
        });
        AppLogger.action('historico_fetch_ok', params: {'tipo': _tipoFiltro, 'total': data.length});
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Erro ao carregar dados. Verifique sua conexão.';
          _loading = false;
        });
        AppLogger.error('HistoricoScreen', 'fetch $_tipoFiltro', e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('HISTÓRICO'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(50),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: Row(
              children: [
                _filterBtn('fretes', 'Fretes'),
                _filterBtn('despesas', 'Despesas'),
                _filterBtn('abastecimentos', 'Abastec.'),
                _filterBtn('vales', 'Vales'),
              ],
            ),
          ),
        ),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error.isNotEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.cloud_off, size: 64, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(
                _error,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 16),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _fetchData,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    if (_items.isEmpty) {
      return const Center(child: Text('Nenhum registro encontrado.'));
    }

    return RefreshIndicator(
      onRefresh: _fetchData,
      child: ListView.builder(
        itemCount: _items.length,
        itemBuilder: (context, index) {
          final item = _items[index];
          return ListTile(
            leading: Icon(_getIcon()),
            title: Text(_getTitle(item)),
            subtitle: Text(
              DateFormat('dd/MM/yyyy HH:mm')
                  .format(DateTime.parse(item['data'])),
            ),
            trailing: Text(
              'R\$ ${(_getValue(item)).toStringAsFixed(2)}',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          );
        },
      ),
    );
  }

  Widget _filterBtn(String tipo, String label) {
    bool selected = _tipoFiltro == tipo;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4.0),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (val) {
          if (val) {
            setState(() => _tipoFiltro = tipo);
            _fetchData();
          }
        },
      ),
    );
  }

  IconData _getIcon() {
    switch (_tipoFiltro) {
      case 'fretes': return Icons.local_shipping;
      case 'despesas': return Icons.receipt;
      case 'abastecimentos': return Icons.local_gas_station;
      case 'vales': return Icons.money;
      default: return Icons.info;
    }
  }

  String _getTitle(dynamic item) {
    if (_tipoFiltro == 'fretes') return '${item['origem']} -> ${item['destino']}';
    if (_tipoFiltro == 'despesas') return item['descricao'] ?? 'Despesa';
    return item['posto'] ?? 'Geral';
  }

  double _getValue(dynamic item) {
    return double.tryParse(
      (item['valor_frete'] ?? item['valor'] ?? item['valor_total'] ?? 0).toString(),
    ) ?? 0.0;
  }
}