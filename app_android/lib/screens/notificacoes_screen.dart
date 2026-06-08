import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class NotificacoesScreen extends StatefulWidget {
  const NotificacoesScreen({super.key});

  @override
  State<NotificacoesScreen> createState() => _NotificacoesScreenState();
}

class _NotificacoesScreenState extends State<NotificacoesScreen> {
  List<dynamic> _notificacoes = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'notificacoes'});
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    final data = await ApiService.getNotificacoes();
    if (mounted) setState(() { _notificacoes = data; _loading = false; });
  }

  Future<void> _marcarLida(String id, int index) async {
    await ApiService.marcarNotificacaoLida(id);
    if (mounted) {
      setState(() {
        _notificacoes[index] = {...(_notificacoes[index] as Map), 'lida': true};
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final naoLidas = _notificacoes.where((n) => n['lida'] == false).length;

    return Scaffold(
      appBar: AppBar(
        title: Text(naoLidas > 0 ? 'Notificações ($naoLidas)' : 'Notificações'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _notificacoes.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.notifications_none, size: 64, color: Colors.grey.shade400),
                      const SizedBox(height: 12),
                      Text('Nenhuma notificação.', style: TextStyle(color: Colors.grey.shade600)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _fetch,
                  child: ListView.builder(
                    itemCount: _notificacoes.length,
                    itemBuilder: (ctx, i) {
                      final n = _notificacoes[i];
                      final lida = n['lida'] == true;
                      final data = n['created_at'] != null
                          ? DateFormat('dd/MM/yy HH:mm').format(DateTime.parse(n['created_at']).toLocal())
                          : '';
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: lida ? Colors.grey.shade200 : const Color(0xFF1B5E20),
                          child: Icon(
                            _icone(n['tipo'] ?? ''),
                            color: lida ? Colors.grey : Colors.white,
                            size: 18,
                          ),
                        ),
                        title: Text(n['titulo'] ?? '', style: TextStyle(fontWeight: lida ? FontWeight.normal : FontWeight.bold)),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(n['mensagem'] ?? '', style: const TextStyle(fontSize: 12)),
                            if (data.isNotEmpty) Text(data, style: TextStyle(fontSize: 10, color: Colors.grey.shade500)),
                          ],
                        ),
                        isThreeLine: true,
                        tileColor: lida ? null : const Color(0xFF1B5E20).withValues(alpha: 0.05),
                        onTap: lida ? null : () => _marcarLida(n['id'], i),
                      );
                    },
                  ),
                ),
    );
  }

  IconData _icone(String tipo) {
    switch (tipo) {
      case 'viagem_finalizada': return Icons.check_circle_outline;
      case 'lancamento_aprovado': return Icons.thumb_up_outlined;
      case 'lancamento_rejeitado': return Icons.thumb_down_outlined;
      default: return Icons.notifications_outlined;
    }
  }
}
