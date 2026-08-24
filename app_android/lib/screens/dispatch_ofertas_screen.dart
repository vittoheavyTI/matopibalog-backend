import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

/// Ofertas de despacho recebidas pelo motorista (Dispatch V1). Só mostra o que o
/// PRÓPRIO motorista recebeu — identidade sempre do token, nunca de parâmetro local.
/// Aceitar/recusar são ações reais e imediatas: o primeiro aceite válido vence
/// atomicamente no backend; um 409 ao aceitar significa que outro motorista já
/// aceitou, ou que a oferta expirou/foi cancelada — nunca é um erro genérico.
class DispatchOfertasScreen extends StatefulWidget {
  const DispatchOfertasScreen({super.key});

  @override
  State<DispatchOfertasScreen> createState() => _DispatchOfertasScreenState();
}

class _DispatchOfertasScreenState extends State<DispatchOfertasScreen> {
  List<Map<String, dynamic>> _ofertas = [];
  bool _loading = true;
  String? _erro;
  String? _acaoEmCurso; // id da oferta em accept/decline, para desabilitar botões

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'dispatch_ofertas'});
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _erro = null;
    });
    try {
      final data = await ApiService.getMinhasOfertasDispatch();
      if (!mounted) return;
      setState(() {
        _ofertas = data
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Não foi possível carregar suas ofertas.';
        _loading = false;
      });
    }
  }

  Future<void> _aceitar(String id) async {
    setState(() => _acaoEmCurso = id);
    try {
      await ApiService.aceitarOfertaDispatch(id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Viagem aceita! Ela já está sendo preparada.')),
      );
      await _fetch();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
      await _fetch(); // outro motorista pode ter vencido — recarrega o estado real
    } finally {
      if (mounted) setState(() => _acaoEmCurso = null);
    }
  }

  Future<void> _recusar(String id) async {
    setState(() => _acaoEmCurso = id);
    try {
      await ApiService.recusarOfertaDispatch(id);
      if (!mounted) return;
      await _fetch();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _acaoEmCurso = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ofertas de viagem')),
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_erro != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 56, color: Colors.grey),
              const SizedBox(height: 12),
              Text(_erro!, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _fetch,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    final pendentes = _ofertas.where((o) => o['status'] == 'PENDING').toList();
    final resolvidas = _ofertas.where((o) => o['status'] != 'PENDING').toList();

    if (_ofertas.isEmpty) {
      return RefreshIndicator(
        onRefresh: _fetch,
        child: ListView(
          children: [
            SizedBox(
              height: MediaQuery.of(context).size.height * 0.6,
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.local_shipping_outlined,
                      size: 64,
                      color: Colors.grey.shade400,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Nenhuma oferta de viagem por enquanto.',
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetch,
      child: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          if (pendentes.isNotEmpty) ...[
            _secaoTitulo('Aguardando sua resposta (${pendentes.length})'),
            ...pendentes.map(_cardOferta),
          ],
          if (resolvidas.isNotEmpty) ...[
            _secaoTitulo('Histórico'),
            ...resolvidas.map(_cardOferta),
          ],
        ],
      ),
    );
  }

  Widget _secaoTitulo(String texto) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
    child: Text(
      texto,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.bold,
        color: Colors.grey.shade600,
      ),
    ),
  );

  Widget _cardOferta(Map<String, dynamic> oferta) {
    final id = oferta['id']?.toString() ?? '';
    final status = oferta['status']?.toString() ?? '';
    final pendente = status == 'PENDING';
    final ctx = oferta['trip_context'] as Map?;
    final camp = oferta['campaign_context'] as Map?;
    final round = oferta['dispatch_rounds'] as Map?;
    final origem = ctx?['origem']?.toString();
    final destino = ctx?['destino']?.toString();
    final quantidade = ctx?['planned_quantity'];
    final unidade = ctx?['quantity_unit']?.toString() ?? '';
    final cargaNome = camp?['cargo_name']?.toString();
    final expiraEm = DateTime.tryParse(round?['expires_at']?.toString() ?? '');
    final emAcao = _acaoEmCurso == id;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.local_shipping_outlined,
                  color: pendente ? const Color(0xFF1B5E20) : Colors.grey,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    origem != null && destino != null
                        ? '$origem → $destino'
                        : 'Viagem de escoamento',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                _statusChip(status),
              ],
            ),
            if (cargaNome != null || quantidade != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  [
                    if (cargaNome != null) cargaNome,
                    if (quantidade != null) '${quantidade.toString()} $unidade',
                  ].join(' · '),
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                ),
              ),
            if (pendente && expiraEm != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Válida até ${DateFormat('dd/MM HH:mm').format(expiraEm.toLocal())}',
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                ),
              ),
            if (pendente) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: emAcao ? null : () => _recusar(id),
                      child: emAcao
                          ? const SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Recusar'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF1B5E20),
                        foregroundColor: Colors.white,
                      ),
                      onPressed: emAcao ? null : () => _aceitar(id),
                      child: emAcao
                          ? const SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Aceitar'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _statusChip(String status) {
    final (MaterialColor cor, String texto) = switch (status) {
      'PENDING' => (Colors.amber, 'Aguardando'),
      'ACCEPTED' => (Colors.green, 'Aceita'),
      'DECLINED' => (Colors.grey, 'Recusada'),
      'EXPIRED' => (Colors.grey, 'Expirada'),
      'LOST' => (Colors.grey, 'Não venceu'),
      'CANCELLED' => (Colors.grey, 'Cancelada'),
      _ => (Colors.grey, status),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        texto,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.bold,
          color: cor.shade700,
        ),
      ),
    );
  }
}
