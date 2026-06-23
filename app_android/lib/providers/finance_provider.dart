import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class FinanceProvider extends ChangeNotifier {
  double _totalFretes = 0.0;
  double _comissao = 0.0;
  double _deducoes = 0.0;
  double _saldo = 0.0;
  double _percentualComissao = 12.0;
  bool _isAutonomo = false;
  bool _loading = false;
  String _error = '';
  List<dynamic> _fretes = [];
  List<dynamic> _despesas = [];
  List<dynamic> _abastecimentos = [];
  List<dynamic> _vales = [];

  double get totalFretes => _totalFretes;
  double get comissao => _comissao;
  double get deducoes => _deducoes;
  double get saldo => _saldo;
  double get percentualComissao => _percentualComissao;
  bool get isAutonomo => _isAutonomo;
  bool get loading => _loading;
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

  Future<void> loadData() async {
    AppLogger.action('load_finance_data');
    _loading = true;
    _error = '';
    notifyListeners();

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

      // Autônomo: todas as despesas contam (ele é o proprietário).
      // Vinculado: apenas quem_pagou = 'proprietario' conta como dedução da comissão.
      // Rejeitados não entram no cálculo em nenhum caso.
      // Lançamentos vinculados a frete cancelado também são excluídos (itens sem
      // frete_id — lançamentos soltos — são sempre preservados).
      double td = 0.0;
      for (var d in despesas) {
        if (d['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(d, fretesCanceladosIds)) continue;
        if (_isAutonomo || d['quem_pagou'] == 'proprietario') {
          td += double.tryParse(d['valor'].toString()) ?? 0.0;
        }
      }
      for (var a in abastecimentos) {
        if (a['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(a, fretesCanceladosIds)) continue;
        if (_isAutonomo || a['quem_pagou'] == 'proprietario') {
          td += double.tryParse(a['valor_total'].toString()) ?? 0.0;
        }
      }
      for (var v in vales) {
        if (v['status'] == 'rejeitado') continue;
        if (_isLancamentoDeFreteCancelado(v, fretesCanceladosIds)) continue;
        if (_isAutonomo || v['quem_pagou'] == 'proprietario') {
          td += double.tryParse(v['valor'].toString()) ?? 0.0;
        }
      }

      _totalFretes = tf;
      _deducoes = td;

      if (_isAutonomo) {
        // Autônomo: sem comissão por percentual do cadastro
        // Resultado = faturamento - despesas
        _comissao = 0.0;
        _saldo = tf - td;
      } else {
        // Vinculado: comissão pelo percentual do cadastro
        _comissao = tf * (_percentualComissao / 100);
        _saldo = _comissao - td;
      }

      AppLogger.action('load_finance_data', params: {
        'total_fretes': tf,
        'is_autonomo': _isAutonomo,
        'comissao': _comissao,
        'deducoes': td,
        'saldo': _saldo,
      });
    } catch (e) {
      _error = 'Erro ao carregar dados. Verifique sua conexão.';
      AppLogger.error('FinanceProvider', 'loadData exception', e);
    } finally {
      _loading = false;
      notifyListeners();
    }
  }
}
