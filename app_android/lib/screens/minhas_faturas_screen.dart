import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../models/fatura.dart';
import '../providers/finance_provider.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

/// Tela READ-ONLY de faturas do autônomo. Consome GET /pagamentos/me/faturas
/// (ApiService.getMinhasFaturas). Neste PR não há ações externas (abrir
/// invoice_url / copiar Pix / baixar boleto) — isso é o PR 2. Nenhuma escrita,
/// nenhuma cobrança, nenhum endpoint admin/recorrente.
class MinhasFaturasScreen extends StatefulWidget {
  const MinhasFaturasScreen({super.key});

  @override
  State<MinhasFaturasScreen> createState() => _MinhasFaturasScreenState();
}

class _MinhasFaturasScreenState extends State<MinhasFaturasScreen> {
  bool _loading = true;
  String _erro = '';
  List<Fatura> _faturas = const [];

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _loading = true;
      _erro = '';
    });
    try {
      final faturas = await ApiService.getMinhasFaturas();
      if (!mounted) return;
      setState(() {
        _faturas = faturas;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message;
        _loading = false;
      });
    } catch (e) {
      AppLogger.error('MinhasFaturasScreen', 'carregar faturas', e);
      if (!mounted) return;
      setState(() {
        _erro = 'Não foi possível carregar suas faturas agora. Tente novamente em instantes.';
        _loading = false;
      });
    }
  }

  // ── Formatação ──────────────────────────────────────────────────────────────
  String _moeda(double v) => 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';

  String _data(String? iso) {
    if (iso == null) return '—';
    final d = DateTime.tryParse(iso);
    if (d == null) return '—';
    return DateFormat('dd/MM/yyyy').format(d.toLocal());
  }

  String _mesCompetencia(String? iso) {
    if (iso == null) return '';
    final d = DateTime.tryParse(iso);
    if (d == null) return '';
    return DateFormat('MM/yyyy').format(d);
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'pago': return 'Pago';
      case 'pendente': return 'Pendente';
      case 'vencido': return 'Vencido';
      case 'cancelado': return 'Cancelado';
      case 'estornado': return 'Estornado';
      default: return status.isEmpty ? '—' : status;
    }
  }

  Color _statusCor(String status) {
    switch (status) {
      case 'pago': return const Color(0xFF2E7D32); // verde
      case 'pendente': return const Color(0xFFF9A825); // âmbar
      case 'vencido': return const Color(0xFFC62828); // vermelho
      case 'cancelado':
      case 'estornado':
        return const Color(0xFF757575); // cinza
      default: return const Color(0xFF757575);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Minhas Faturas')),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_erro.isNotEmpty) {
      return _EstadoMensagem(
        icone: Icons.error_outline,
        titulo: 'Não foi possível carregar',
        mensagem: _erro,
        onTentarNovamente: _carregar,
      );
    }

    // Lista rolável (ListView) mesmo quando vazia, para o pull-to-refresh funcionar.
    final planoCard = _buildPlanoCard(context);
    if (_faturas.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          if (planoCard != null) planoCard,
          const SizedBox(height: 48),
          const _EstadoMensagem.inline(
            icone: Icons.receipt_long_outlined,
            titulo: 'Nenhuma fatura ainda',
            mensagem: 'Quando houver cobranças da sua conta, elas aparecerão aqui.',
          ),
        ],
      );
    }

    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      itemCount: _faturas.length + (planoCard != null ? 1 : 0),
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        if (planoCard != null && index == 0) return planoCard;
        final fatura = _faturas[index - (planoCard != null ? 1 : 0)];
        return _FaturaCard(
          fatura: fatura,
          moeda: _moeda,
          data: _data,
          mesCompetencia: _mesCompetencia,
          statusLabel: _statusLabel,
          statusCor: _statusCor,
        );
      },
    );
  }

  /// Resumo do plano reaproveitando o FinanceProvider (que já carrega
  /// /me/plano-status). Só exibe se houver status conhecido; não altera o provider.
  Widget? _buildPlanoCard(BuildContext context) {
    final finance = context.watch<FinanceProvider>();
    final status = finance.statusPlano;
    if (status.isEmpty) return null;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.workspace_premium_outlined),
        title: const Text('Plano da conta'),
        subtitle: Text('Status: ${_statusLabel(status)}'),
      ),
    );
  }
}

class _FaturaCard extends StatelessWidget {
  const _FaturaCard({
    required this.fatura,
    required this.moeda,
    required this.data,
    required this.mesCompetencia,
    required this.statusLabel,
    required this.statusCor,
  });

  final Fatura fatura;
  final String Function(double) moeda;
  final String Function(String?) data;
  final String Function(String?) mesCompetencia;
  final String Function(String) statusLabel;
  final Color Function(String) statusCor;

  @override
  Widget build(BuildContext context) {
    final cor = statusCor(fatura.status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  moeda(fatura.valor),
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                _StatusChip(label: statusLabel(fatura.status), cor: cor),
              ],
            ),
            const SizedBox(height: 8),
            _linha(Icons.event_outlined, 'Vencimento: ${data(fatura.dueDate)}'),
            if (fatura.tipoPagamento.isNotEmpty)
              _linha(Icons.payments_outlined, 'Forma: ${fatura.tipoPagamento}'),
            if (fatura.isPaga)
              _linha(Icons.check_circle_outline, 'Pago em: ${data(fatura.pagoEm)}'),
            if (fatura.isRecorrente)
              _linha(
                Icons.autorenew_outlined,
                'Mensalidade${mesCompetencia(fatura.periodoReferencia).isNotEmpty ? ' — competência ${mesCompetencia(fatura.periodoReferencia)}' : ''}',
              ),
            if (fatura.planoNomeSnapshot != null)
              _linha(Icons.workspace_premium_outlined, fatura.planoNomeSnapshot!),
          ],
        ),
      ),
    );
  }

  Widget _linha(IconData icone, String texto) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        children: [
          Icon(icone, size: 16, color: Colors.grey),
          const SizedBox(width: 8),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.cor});
  final String label;
  final Color cor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cor),
      ),
      child: Text(
        label,
        style: TextStyle(color: cor, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

class _EstadoMensagem extends StatelessWidget {
  const _EstadoMensagem({
    required this.icone,
    required this.titulo,
    required this.mensagem,
    this.onTentarNovamente,
  }) : _inline = false;

  const _EstadoMensagem.inline({
    required this.icone,
    required this.titulo,
    required this.mensagem,
  })  : onTentarNovamente = null,
        _inline = true;

  final IconData icone;
  final String titulo;
  final String mensagem;
  final VoidCallback? onTentarNovamente;
  final bool _inline;

  @override
  Widget build(BuildContext context) {
    final conteudo = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icone, size: 56, color: Colors.grey),
        const SizedBox(height: 12),
        Text(titulo, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
        const SizedBox(height: 8),
        Text(mensagem, textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
        if (onTentarNovamente != null) ...[
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onTentarNovamente,
            icon: const Icon(Icons.refresh),
            label: const Text('Tentar novamente'),
          ),
        ],
      ],
    );
    if (_inline) return conteudo;
    // Rolável para permitir pull-to-refresh no estado de erro.
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 80),
      children: [conteudo],
    );
  }
}
