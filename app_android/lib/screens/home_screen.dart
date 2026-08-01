import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'minhas_faturas_screen.dart';
import '../services/api_service.dart';
import '../services/location_tracking_service.dart';
import 'package:url_launcher/url_launcher.dart';

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

  int _fretesEmAndamentoParaRastreamento(FinanceProvider finance) {
    const statusAtivos = {'ativo', 'em_viagem', 'em_andamento'};
    return finance.fretes
        .where((f) => f is Map && statusAtivos.contains((f['status'] ?? '').toString()))
        .map((f) => (f as Map)['id']?.toString())
        .where((id) => id != null && id.isNotEmpty)
        .toSet()
        .length
        .clamp(0, 4);
  }

  Future<void> _solicitarAtivacaoLocalizacao(FinanceProvider finance) async {
    final activeTrips = _fretesEmAndamentoParaRastreamento(finance);
    if (activeTrips == 0) {
      await LocationTrackingService.stop();
      return;
    }
    final result = await LocationTrackingService.startForActiveTrips(
      activeTrips: activeTrips,
      requestPermission: true,
    );
    if (!mounted) return;
    final msg = _mensagemRastreamento(result);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    await LocationTrackingService.openOperationalSettings(result);
  }

  String _mensagemRastreamento(LocationTrackingStartResult result) {
    switch (result) {
      case LocationTrackingStartResult.started:
        return 'Compartilhamento ativo. Ultima localizacao enviada sera atualizada durante a viagem.';
      case LocationTrackingStartResult.serviceDisabled:
        return 'Ative a localizacao do aparelho para compartilhar a viagem.';
      case LocationTrackingStartResult.denied:
        return 'Permissao negada. O app segue utilizavel, mas o compartilhamento nao esta ativo.';
      case LocationTrackingStartResult.deniedForever:
        return 'Permissao bloqueada nas configuracoes do Android.';
      case LocationTrackingStartResult.approximateOnly:
        return 'A operacao exige localizacao precisa. Ajuste a permissao nas configuracoes do Android.';
      case LocationTrackingStartResult.missingSession:
        return 'Sessao nao encontrada para iniciar o compartilhamento.';
      case LocationTrackingStartResult.unsupported:
        return 'Compartilhamento disponivel apenas no app Android.';
      case LocationTrackingStartResult.failed:
        return 'Nao foi possivel iniciar o compartilhamento agora.';
    }
  }

  Widget _cardLocalizacao(FinanceProvider finance) {
    final activeTrips = _fretesEmAndamentoParaRastreamento(finance);
    return ValueListenableBuilder<LocationTrackingSnapshot>(
      valueListenable: LocationTrackingService.snapshot,
      builder: (context, tracking, _) {
        final precisaAcao = _precisaMostrarAlertaLocalizacao(activeTrips, tracking);
        if (!precisaAcao) return const SizedBox.shrink();
        final cor = Colors.amber.shade800;
        return Card(
          color: Colors.amber.shade50,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.location_on_outlined, color: cor),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Localizacao precisa de atencao', style: TextStyle(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(
                        tracking.message,
                        style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => _solicitarAtivacaoLocalizacao(finance),
                  child: const Text('Ativar'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  bool _precisaMostrarAlertaLocalizacao(int activeTrips, LocationTrackingSnapshot tracking) {
    if (activeTrips == 0 || tracking.isActive) return false;
    return const {
      LocationTrackingStatus.awaitingPermission,
      LocationTrackingStatus.permissionDenied,
      LocationTrackingStatus.deniedForever,
      LocationTrackingStatus.approximateOnly,
      LocationTrackingStatus.gpsDisabled,
      LocationTrackingStatus.failed,
      LocationTrackingStatus.missingSession,
    }.contains(tracking.status);
  }

  bool _gerandoRegularizacao = false;

  /// Gera (idempotente) a fatura de regularização e leva o usuário para
  /// Minhas Faturas, onde ele paga (link/Pix). Recusas de negócio (422)
  /// mostram a mensagem do backend; aí o suporte é o fallback.
  Future<void> _regularizarAgora(FinanceProvider finance) async {
    AppLogger.action('regularizacao_gerar_fatura');
    setState(() => _gerandoRegularizacao = true);
    try {
      final r = await ApiService.gerarFaturaRegularizacao();
      if (!mounted) return;
      if (r['ok'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Fatura disponível em Minhas Faturas. Pague para liberar sua conta.'),
        ));
        await Navigator.push(context, MaterialPageRoute(builder: (_) => const MinhasFaturasScreen()));
        if (mounted) await _refresh();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r['message'].toString())));
      }
    } finally {
      if (mounted) setState(() => _gerandoRegularizacao = false);
    }
  }

  Future<void> _abrirWhatsappSuporte(String numero) async {
    AppLogger.action('regularizacao_whatsapp');
    final digitos = numero.replaceAll(RegExp(r'\D'), '');
    final uri = Uri.parse('https://wa.me/$digitos');
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (ok) return;
    await Clipboard.setData(ClipboardData(text: numero));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Número copiado: $numero')));
  }

  Future<void> _ligarSuporte(String telefone) async {
    AppLogger.action('regularizacao_telefone');
    final uri = Uri(scheme: 'tel', path: telefone.replaceAll(RegExp(r'[^\d+]'), ''));
    final ok = await launchUrl(uri);
    if (ok) return;
    await Clipboard.setData(ClipboardData(text: telefone));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Telefone copiado: $telefone')));
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
    SeletorFrete.resolver(
      context,
      finance.fretesAtivos,
      onIniciarFrete: () => _navegarERefresh(const AddFreteScreen()),
    ).then((freteId) {
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
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
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
      // Spinner central só na PRIMEIRA carga (sem dados ainda). Nos refreshes
      // seguintes mantemos o conteúdo já carregado visível — o feedback do
      // pull-to-refresh fica por conta do próprio RefreshIndicator, evitando a
      // sensação de "recarregou tudo do zero".
      child: finance.loading && !finance.hasLoadedOnce
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (finance.planoBloqueado)
                    Card(
                      color: Colors.red.shade50,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [Icon(Icons.lock_outline, color: Colors.red.shade700), const SizedBox(width: 8), const Expanded(child: Text('Regularização necessária', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)))]),
                          const SizedBox(height: 8),
                          Text(finance.mensagemRegularizacao, style: TextStyle(color: Colors.red.shade900)),
                          if (finance.responsavelRegularizacao == 'autonomo') ...[
                            const SizedBox(height: 12),
                            // Caminho principal: gerar/ver a fatura e pagar.
                            // O backend é idempotente: se já existe fatura
                            // aberta, devolve-a sem criar outra.
                            ElevatedButton.icon(
                              icon: const Icon(Icons.receipt_long),
                              label: const Text('Regularizar agora'),
                              onPressed: _gerandoRegularizacao ? null : () => _regularizarAgora(finance),
                            ),
                            const SizedBox(height: 8),
                            OutlinedButton.icon(
                              icon: const Icon(Icons.receipt_long_outlined),
                              label: const Text('Ver minhas faturas'),
                              onPressed: () {
                                AppLogger.action('regularizacao_ver_faturas');
                                Navigator.push(context, MaterialPageRoute(builder: (_) => const MinhasFaturasScreen()));
                              },
                            ),
                            if (finance.temContatoSuporte) ...[
                              const SizedBox(height: 8),
                              Wrap(spacing: 8, runSpacing: 4, children: [
                                if (finance.suporteWhatsapp.isNotEmpty)
                                  TextButton.icon(
                                    icon: const Icon(Icons.chat, size: 18),
                                    label: const Text('WhatsApp'),
                                    onPressed: () => _abrirWhatsappSuporte(finance.suporteWhatsapp),
                                  ),
                                if (finance.suporteTelefone.isNotEmpty)
                                  TextButton.icon(
                                    icon: const Icon(Icons.phone, size: 18),
                                    label: const Text('Ligar'),
                                    onPressed: () => _ligarSuporte(finance.suporteTelefone),
                                  ),
                                if (finance.suporteEmail.isNotEmpty)
                                  TextButton.icon(
                                    icon: const Icon(Icons.support_agent, size: 18),
                                    label: const Text('E-mail'),
                                    onPressed: () async {
                                      await Clipboard.setData(ClipboardData(text: finance.suporteEmail));
                                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Contato copiado: ${finance.suporteEmail}')));
                                    },
                                  ),
                              ]),
                            ],
                          ],
                        ]),
                      ),
                    ),
                  _cardLocalizacao(finance),
                  const SizedBox(height: 8),
                  if (finance.planoBloqueado) const SizedBox(height: 16),
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
                            _infoRow('Faturamento realizado', finance.totalFretesMes),
                            if (finance.emAndamentoMes > 0)
                              _infoRow('Em andamento (previsto)', finance.emAndamentoMes, color: Colors.grey),
                            _infoRow('Despesas', finance.deducoesMes, color: Colors.red),
                            const Divider(),
                            _infoRow('Resultado', finance.saldoMes, color: finance.saldoMes >= 0 ? Colors.green : Colors.red, bold: true),
                          ] else ...[
                            _infoRow('Fretes realizados', finance.totalFretesMes),
                            if (finance.emAndamentoMes > 0)
                              _infoRow('Em andamento (previsto)', finance.emAndamentoMes, color: Colors.grey),
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
                      onPressed: finance.planoBloqueado ? null : _abrirNovoLancamento,
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Histórico de Fretes — acesso PERMANENTE, independe de haver frete no
                  // mês. Fica visualmente separado do bloco "Últimos Fretes" abaixo.
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.history, color: Theme.of(context).colorScheme.primary, size: 26),
                              const SizedBox(width: 10),
                              const Expanded(
                                child: Text('Histórico de Fretes',
                                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text('Consulte fretes de meses anteriores',
                              style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
                          const SizedBox(height: 12),
                          // Botão grande e de alto contraste: onSurface = preto no claro,
                          // branco no escuro (resolve o verde ilegível no dark).
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () => _navegarERefresh(const HistoricoScreen()),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Theme.of(context).colorScheme.onSurface,
                                minimumSize: const Size(0, 48),
                                textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                              ),
                              icon: const Icon(Icons.history, size: 20),
                              label: const Text('Ver histórico completo'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Últimos Fretes: só quando houver fretes recentes (ativos/mês vigente).
                  // Em erro de carga NÃO mostramos "Nenhum frete" (o banner de erro acima
                  // já avisa) — evita falso vazio quando a API falhou.
                  if (fretesHome.isNotEmpty) ...[
                    const Text('Últimos Fretes', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    ...fretesHome.take(3).map((f) => _buildViagemCard(f)),
                  ] else if (finance.error.isEmpty && finance.fretes.isNotEmpty) ...[
                    // Há fretes no geral, mas nenhum ativo/do mês atual (carga OK).
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
                          ],
                        ),
                      ),
                    ),
                  ] else if (finance.error.isEmpty) ...[
                    // Carga OK e nenhum frete → conta realmente vazia.
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            Icon(Icons.local_shipping_outlined, size: 48, color: Colors.grey.shade400),
                            const SizedBox(height: 8),
                            Text('Nenhum frete ainda.', style: TextStyle(color: Colors.grey.shade600)),
                            const SizedBox(height: 4),
                            Text('Toque em NOVO LANÇAMENTO para começar.', style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
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
