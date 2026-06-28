import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class FinanceProvider extends ChangeNotifier {
  double _totalFretes = 0.0;
  double _comissao = 0.0;
  double _deducoes = 0.0;
  double _saldo = 0.0;
  // Campos mensais para o card "Resumo do Mês"
  double _totalFretesMes = 0.0;
  double _comissaoMes = 0.0;
  double _deducoesMes = 0.0;
  double _saldoMes = 0.0;
  double _percentualComissao = 12.0;
  bool _isAutonomo = false;
  bool _loading = false;
  // Vira true após o primeiro loadData (com ou sem dados). Usado pela Home para
  // mostrar o spinner central só na carga inicial; nos refreshes seguintes o
  // conteúdo já carregado permanece visível (feedback fica a cargo do RefreshIndicator).
  bool _hasLoadedOnce = false;
  String _error = '';
  List<dynamic> _fretes = [];
  List<dynamic> _despesas = [];
  List<dynamic> _abastecimentos = [];
  List<dynamic> _vales = [];

  double get totalFretes => _totalFretes;
  double get comissao => _comissao;
  double get deducoes => _deducoes;
  double get saldo => _saldo;
  double get totalFretesMes => _totalFretesMes;
  double get comissaoMes => _comissaoMes;
  double get deducoesMes => _deducoesMes;
  double get saldoMes => _saldoMes;
  double get percentualComissao => _percentualComissao;
  bool get isAutonomo => _isAutonomo;
  bool get loading => _loading;
  bool get hasLoadedOnce => _hasLoadedOnce;
  String get error => _error;
  List<dynamic> get fretes => _fretes;
  List<dynamic> get despesas => _despesas;
  List<dynamic> get abastecimentos => _abastecimentos;
  List<dynamic> get vales => _vales;

  // Status considerados "frete em execução", em ordem de prioridade.
  static const List<String> _statusAtivoPrioritario = ['em_viagem', 'em_andamento', 'ativo'];
  // Fallback: 'pendente' é o default histórico do banco e a convenção do painel
  // (ativo||pendente). Nunca consideramos 'finalizado'/'cancelado' como ativos.
  static const String _statusAtivoFallback = 'pendente';

  /// Frete ativo do motorista para auto-vincular lançamentos feitos pela Home/Menu.
  /// _fretes vem ordenado por data desc (mais recente primeiro). Se houver mais de
  /// um frete ativo, retorna o mais recente — limitação controlada (ver relatório).
  Map<String, dynamic>? get freteAtivo {
    for (final f in _fretes) {
      final s = (f['status'] ?? '').toString();
      if (_statusAtivoPrioritario.contains(s)) return Map<String, dynamic>.from(f as Map);
    }
    for (final f in _fretes) {
      final s = (f['status'] ?? '').toString();
      if (s == _statusAtivoFallback) return Map<String, dynamic>.from(f as Map);
    }
    return null;
  }

  /// id do frete ativo, ou null quando não há frete em execução (lançamento solto).
  String? get freteAtivoId => freteAtivo?['id']?.toString();

  /// Todos os fretes considerados ativos (mesma definição de [freteAtivo]),
  /// mas sem limitar ao primeiro — útil quando há mais de um frete aberto
  /// e o app precisa exibir um seletor.
  List<Map<String, dynamic>> get fretesAtivos {
    return _fretes
        .where((f) {
          final s = (f['status'] ?? '').toString();
          return _statusAtivoPrioritario.contains(s) || s == _statusAtivoFallback;
        })
        .map((f) => Map<String, dynamic>.from(f as Map))
        .toList();
  }

  /// Verdadeiro quando o lançamento pertence a um frete cancelado.
  /// Lançamentos sem frete_id (lançamentos soltos) são SEMPRE preservados.
  bool _isLancamentoDeFreteCancelado(
      Map<String, dynamic> item, Set<dynamic> fretesCanceladosIds) {
    final freteId = item['frete_id'];
    if (freteId == null || freteId.toString().isEmpty) return false;
    return fretesCanceladosIds.contains(freteId.toString());
  }

  /// Lançamento "efetivado": entra no saldo do vinculado (igual ao painel, que
  /// só considera aprovados). 'finalizado' também conta — é o estado em que o
  /// painel coloca os aprovados ao encerrar o frete. Pendentes e rejeitados
  /// ficam de fora. (Não altera a regra do autônomo.)
  static bool _efetivado(dynamic status) =>
      status == 'aprovado' || status == 'finalizado';

  Future<void> loadData() async {
    AppLogger.action('load_finance_data');
    _loading = true;
    _error = '';
    notifyListeners();

    // Mede só a onda de rede (5 GETs paralelos), para diagnosticar se a lentidão
    // percebida é rede/cold start ou render. Não loga dados sensíveis — apenas ms.
    final cronometro = Stopwatch()..start();
    try {
      // Perfil + 4 listas são independentes entre si — busca tudo em paralelo
      // (1 onda de rede). Antes o getMe era serial e bloqueava as outras 4.
      final results = await Future.wait([
        ApiService.getMe(),
        ApiService.getFretes(),
        ApiService.getList('despesas'),
        ApiService.getList('abastecimentos'),
        ApiService.getList('vales'),
      ]);
      cronometro.stop();

      final profile        = results[0] as Map<String, dynamic>?;
      final fretes         = results[1] as List<dynamic>;
      final despesas       = results[2] as List<dynamic>;
      final abastecimentos = results[3] as List<dynamic>;
      final vales          = results[4] as List<dynamic>;

      // Cálculo de percentual/tipo de empresa só depois das respostas chegarem
      if (profile != null) {
        _percentualComissao = double.tryParse(
          profile['motoristas']?['percentual_comissao']?.toString() ?? '',
        ) ?? 12.0;
        _isAutonomo = (profile['empresas'] as Map?)?['tipo'] == 'autonomo';
      }
      _fretes = fretes;
      _despesas = despesas;
      _abastecimentos = abastecimentos;
      _vales = vales;

      // Fretes cancelados continuam VISÍVEIS nas listas (_fretes, Home, Histórico,
      // Detalhe), mas ficam FORA de todas as agregações financeiras: não entram no
      // faturamento/comissão e seus lançamentos vinculados não entram nas deduções.
      // IDs guardados como String para comparação consistente com frete_id dos lançamentos.
      final fretesCanceladosIds = <dynamic>{
        for (var f in fretes)
          if ((f['status'] ?? '').toString() == 'cancelado') f['id']?.toString()
      };

      double tf = 0.0;
      for (var f in fretes) {
        if ((f['status'] ?? '').toString() == 'cancelado') continue;
        tf += double.tryParse(f['valor_frete'].toString()) ?? 0.0;
      }

      // Regras de dedução (rejeitados e lançamentos de frete cancelado SEMPRE fora;
      // itens sem frete_id — soltos — são preservados):
      //   • Autônomo: deduz TODOS os lançamentos não-rejeitados (ele é o proprietário).
      //   • Vinculado (igual ao painel): despesas/abast pagos pela EMPRESA não reduzem
      //     a comissão; despesas/abast pagos pelo MOTORISTA entram como reembolso (crédito)
      //     e vales/adiantamentos pagos pela EMPRESA entram como desconto.
      double td = 0.0; // autônomo: soma de todos os gastos
      double reembMot = 0.0; // vinculado: desp+abast pagos pelo motorista (crédito)
      double adiantEmpresa = 0.0; // vinculado: vales pagos pela empresa (desconto)
      for (var d in despesas) {
        if (d['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(d, fretesCanceladosIds)) continue;
        final valor = double.tryParse(d['valor'].toString()) ?? 0.0;
        td += valor;
        if (d['quem_pagou'] == 'motorista' && _efetivado(d['status'])) reembMot += valor;
      }
      for (var a in abastecimentos) {
        if (a['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(a, fretesCanceladosIds)) continue;
        final valor = double.tryParse(a['valor_total'].toString()) ?? 0.0;
        td += valor;
        if (a['quem_pagou'] == 'motorista' && _efetivado(a['status'])) reembMot += valor;
      }
      for (var v in vales) {
        if (v['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(v, fretesCanceladosIds)) continue;
        final valor = double.tryParse(v['valor'].toString()) ?? 0.0;
        td += valor;
        if (v['quem_pagou'] == 'proprietario' && _efetivado(v['status'])) adiantEmpresa += valor;
      }

      _totalFretes = tf;

      if (_isAutonomo) {
        // Autônomo: sem comissão por percentual do cadastro
        // Resultado = faturamento - despesas
        _comissao = 0.0;
        _deducoes = td;
        _saldo = tf - td;
      } else {
        // Vinculado: comissão pelo percentual do cadastro.
        // Saldo (igual ao painel) = comissão + reembolsos − adiantamentos.
        // _deducoes guarda o desconto LÍQUIDO (adiantamentos − reembolsos) para manter
        // a relação exibida no app: Saldo = Comissão − Deduções.
        _comissao = tf * (_percentualComissao / 100);
        _deducoes = adiantEmpresa - reembMot;
        _saldo = _comissao - _deducoes;
      }

      // ─── Cálculo mensal (Resumo do Mês) ─────────────────────────────────────
      // Fretes que entram no resumo: ativos (qualquer mês) + finalizados do mês vigente.
      final ymAtual = DateTime.now().toString().substring(0, 7); // yyyy-MM
      final fretesResumoIds = <String>{};
      for (var f in fretes) {
        final status = (f['status'] ?? '').toString();
        if (status == 'cancelado') continue;
        final data = f['data']?.toString() ?? '';
        final isAtivo = _statusAtivoPrioritario.contains(status) || status == _statusAtivoFallback;
        final isMesVigente = data.startsWith(ymAtual);
        if (isAtivo || isMesVigente) {
          fretesResumoIds.add(f['id']?.toString() ?? '');
        }
      }

      double tfMes = 0.0;
      for (var f in fretes) {
        if (!fretesResumoIds.contains(f['id']?.toString())) continue;
        tfMes += double.tryParse(f['valor_frete'].toString()) ?? 0.0;
      }

      // IDs de fretes cancelados para exclusão de lançamentos (já calculado acima).
      // Mesmas regras de dedução do cálculo geral (autônomo x vinculado), aplicadas
      // só aos lançamentos que entram no resumo do mês.
      double tdMes = 0.0; // autônomo
      double reembMotMes = 0.0; // vinculado: reembolso ao motorista
      double adiantEmpresaMes = 0.0; // vinculado: adiantamentos da empresa
      for (var d in despesas) {
        if (d['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(d, fretesCanceladosIds)) continue;
        // Lançamento vinculado a frete não incluso: pula
        final freteId = d['frete_id']?.toString() ?? '';
        if (freteId.isNotEmpty && !fretesResumoIds.contains(freteId)) continue;
        // Lançamento solto sem frete_id: só entra se for do mês vigente
        if (freteId.isEmpty) {
          final data = (d['created_at'] ?? d['data'] ?? '').toString();
          if (!data.startsWith(ymAtual)) continue;
        }
        final valor = double.tryParse(d['valor'].toString()) ?? 0.0;
        tdMes += valor;
        if (d['quem_pagou'] == 'motorista' && _efetivado(d['status'])) reembMotMes += valor;
      }
      for (var a in abastecimentos) {
        if (a['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(a, fretesCanceladosIds)) continue;
        final freteId = a['frete_id']?.toString() ?? '';
        if (freteId.isNotEmpty && !fretesResumoIds.contains(freteId)) continue;
        if (freteId.isEmpty) {
          final data = (a['created_at'] ?? a['data'] ?? '').toString();
          if (!data.startsWith(ymAtual)) continue;
        }
        final valor = double.tryParse(a['valor_total'].toString()) ?? 0.0;
        tdMes += valor;
        if (a['quem_pagou'] == 'motorista' && _efetivado(a['status'])) reembMotMes += valor;
      }
      for (var v in vales) {
        if (v['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(v, fretesCanceladosIds)) continue;
        final freteId = v['frete_id']?.toString() ?? '';
        if (freteId.isNotEmpty && !fretesResumoIds.contains(freteId)) continue;
        if (freteId.isEmpty) {
          final data = (v['created_at'] ?? v['data'] ?? '').toString();
          if (!data.startsWith(ymAtual)) continue;
        }
        final valor = double.tryParse(v['valor'].toString()) ?? 0.0;
        tdMes += valor;
        if (v['quem_pagou'] == 'proprietario' && _efetivado(v['status'])) adiantEmpresaMes += valor;
      }

      _totalFretesMes = tfMes;
      if (_isAutonomo) {
        _comissaoMes = 0.0;
        _deducoesMes = tdMes;
        _saldoMes = tfMes - tdMes;
      } else {
        // Igual ao painel: comissão + reembolsos − adiantamentos.
        // _deducoesMes = desconto líquido (mantém Saldo = Comissão − Deduções no card).
        _comissaoMes = tfMes * (_percentualComissao / 100);
        _deducoesMes = adiantEmpresaMes - reembMotMes;
        _saldoMes = _comissaoMes - _deducoesMes;
      }

      AppLogger.action('load_finance_data', params: {
        'total_fretes': tf,
        'is_autonomo': _isAutonomo,
        'comissao': _comissao,
        'deducoes': td,
        'saldo': _saldo,
        'duracao_ms': cronometro.elapsedMilliseconds,
      });
    } catch (e) {
      _error = 'Erro ao carregar dados. Verifique sua conexão.';
      AppLogger.error('FinanceProvider', 'loadData exception', e);
    } finally {
      _loading = false;
      _hasLoadedOnce = true;
      notifyListeners();
    }
  }
}
