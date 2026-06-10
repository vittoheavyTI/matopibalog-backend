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

  Future<void> loadData() async {
    AppLogger.action('load_finance_data');
    _loading = true;
    _error = '';
    notifyListeners();

    try {
      // Perfil carregado primeiro para obter percentual_comissao e tipo de empresa
      final profile = await ApiService.getMe();
      if (profile != null) {
        _percentualComissao = double.tryParse(
          profile['motoristas']?['percentual_comissao']?.toString() ?? '',
        ) ?? 12.0;
        _isAutonomo = (profile['empresas'] as Map?)?['tipo'] == 'autonomo';
      }

      // As 4 listas são independentes entre si — busca em paralelo
      final results = await Future.wait([
        ApiService.getFretes(),
        ApiService.getList('despesas'),
        ApiService.getList('abastecimentos'),
        ApiService.getList('vales'),
      ]);

      final fretes         = results[0];
      final despesas       = results[1];
      final abastecimentos = results[2];
      final vales          = results[3];
      _fretes = fretes;
      _despesas = despesas;
      _abastecimentos = abastecimentos;
      _vales = vales;

      double tf = 0.0;
      for (var f in fretes) {
        tf += double.tryParse(f['valor_frete'].toString()) ?? 0.0;
      }

      // Autônomo: todas as despesas contam (ele é o proprietário).
      // Vinculado: apenas quem_pagou = 'proprietario' conta como dedução da comissão.
      // Rejeitados não entram no cálculo em nenhum caso.
      double td = 0.0;
      for (var d in despesas) {
        if (d['status'] == 'rejeitado') continue;
        if (_isAutonomo || d['quem_pagou'] == 'proprietario') {
          td += double.tryParse(d['valor'].toString()) ?? 0.0;
        }
      }
      for (var a in abastecimentos) {
        if (a['status'] == 'rejeitado') continue;
        if (_isAutonomo || a['quem_pagou'] == 'proprietario') {
          td += double.tryParse(a['valor_total'].toString()) ?? 0.0;
        }
      }
      for (var v in vales) {
        if (v['status'] == 'rejeitado') continue;
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
