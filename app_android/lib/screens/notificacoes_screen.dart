import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/push_service.dart';

class NotificacoesScreen extends StatefulWidget {
  const NotificacoesScreen({super.key});

  @override
  State<NotificacoesScreen> createState() => _NotificacoesScreenState();
}

class _NotificacoesScreenState extends State<NotificacoesScreen> {
  List<Map<String, dynamic>> _notificacoes = [];
  bool _loading = true;
  String? _erro;

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'notificacoes'});
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _erro = null;
    });
    try {
      final data = await ApiService.getNotificacoes();
      if (!mounted) return;
      setState(() {
        _notificacoes = data
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Não foi possível carregar as notificações.';
        _loading = false;
      });
    }
  }

  Future<void> _marcarLida(String id, int index) async {
    final sucesso = await ApiService.marcarNotificacaoLida(id);
    if (!mounted) return;
    if (sucesso) {
      setState(() {
        _notificacoes[index] = {
          ..._notificacoes[index],
          'lida': true,
          'read_at': DateTime.now().toIso8601String(),
        };
      });
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível marcar como lida.')),
      );
    }
  }

  Future<void> _marcarTodasLidas() async {
    final sucesso = await ApiService.marcarTodasNotificacoesLidas();
    if (!mounted) return;
    if (sucesso) {
      setState(() {
        _notificacoes = _notificacoes
            .map((item) => {...item, 'lida': true})
            .toList();
      });
      // Nada mais está não lido: limpa a bandeja/badge do sistema.
      PushService.limparNotificacoesBandeja();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Não foi possível marcar todas como lidas.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final naoLidas = _notificacoes
        .where((item) => item['lida'] == false)
        .length;

    return Scaffold(
      appBar: AppBar(
        title: Text(naoLidas > 0 ? 'Notificações ($naoLidas)' : 'Notificações'),
        actions: [
          if (naoLidas > 0)
            IconButton(
              tooltip: 'Marcar todas como lidas',
              onPressed: _marcarTodasLidas,
              icon: const Icon(Icons.done_all),
            ),
        ],
      ),
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
              const Icon(
                Icons.cloud_off_outlined,
                size: 56,
                color: Colors.grey,
              ),
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

    if (_notificacoes.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.notifications_none,
              size: 64,
              color: Colors.grey.shade400,
            ),
            const SizedBox(height: 12),
            Text(
              'Nenhuma notificação por enquanto.',
              style: TextStyle(color: Colors.grey.shade600),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetch,
      child: ListView.separated(
        itemCount: _notificacoes.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final notificacao = _notificacoes[index];
          final lida = notificacao['lida'] == true;
          final id = notificacao['id']?.toString() ?? '';
          final data = _formatarData(notificacao['created_at']);
          return ListTile(
            leading: CircleAvatar(
              backgroundColor: lida
                  ? Colors.grey.shade200
                  : const Color(0xFF1B5E20),
              child: Icon(
                _icone(notificacao['tipo']?.toString() ?? ''),
                color: lida ? Colors.grey : Colors.white,
                size: 18,
              ),
            ),
            title: Text(
              notificacao['titulo']?.toString() ?? '',
              style: TextStyle(
                fontWeight: lida ? FontWeight.normal : FontWeight.bold,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(notificacao['mensagem']?.toString() ?? ''),
                if (data.isNotEmpty)
                  Text(
                    data,
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
                  ),
              ],
            ),
            isThreeLine: true,
            tileColor: lida
                ? null
                : const Color(0xFF1B5E20).withValues(alpha: 0.05),
            onTap: lida || id.isEmpty ? null : () => _marcarLida(id, index),
          );
        },
      ),
    );
  }

  String _formatarData(dynamic valor) {
    final data = DateTime.tryParse(valor?.toString() ?? '');
    return data == null
        ? ''
        : DateFormat('dd/MM/yy HH:mm').format(data.toLocal());
  }

  IconData _icone(String tipo) {
    switch (tipo) {
      case 'conta_criada':
      case 'conta_vinculada':
        return Icons.person_outline;
      case 'frete_criado':
        return Icons.local_shipping_outlined;
      case 'frete_finalizado':
      case 'viagem_finalizada':
        return Icons.check_circle_outline;
      case 'lancamento_criado':
        return Icons.receipt_long_outlined;
      case 'lancamento_aprovado':
        return Icons.thumb_up_outlined;
      case 'lancamento_rejeitado':
        return Icons.thumb_down_outlined;
      default:
        return Icons.notifications_outlined;
    }
  }
}
