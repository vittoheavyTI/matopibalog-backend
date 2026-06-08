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
  List<dynamic> _viagens = [];
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'historico'});
    _fetchViagens();
  }

  Future<void> _fetchViagens() async {
    AppLogger.action('historico_fetch');
    setState(() { _loading = true; _error = ''; });
    try {
      final data = await ApiService.getFretes();
      if (mounted) {
        setState(() { _viagens = data; _loading = false; });
        AppLogger.action('historico_fetch_ok', params: {'total': data.length});
      }
    } catch (e) {
      if (mounted) {
        setState(() { _error = 'Erro ao carregar viagens. Verifique sua conexão.'; _loading = false; });
        AppLogger.error('HistoricoScreen', 'fetchViagens', e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Histórico de Viagens')),
      body: _buildBody(),
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
                onPressed: _fetchViagens,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    if (_viagens.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.local_shipping_outlined, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text('Nenhuma viagem registrada.', style: TextStyle(color: Colors.grey.shade600, fontSize: 16)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchViagens,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _viagens.length,
        itemBuilder: (context, index) => _buildViagemCard(_viagens[index]),
      ),
    );
  }

  Widget _buildViagemCard(dynamic frete) {
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
        onTap: () {
          AppLogger.action('viagem_detalhe_abrir', params: {'frete_id': frete['id']?.toString()});
          Navigator.push(context, MaterialPageRoute(
            builder: (_) => DetalheViagemScreen(frete: frete),
          ));
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
