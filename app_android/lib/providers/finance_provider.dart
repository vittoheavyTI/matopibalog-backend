import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class FinanceProvider extends ChangeNotifier {
  double _totalFretes = 0.0;
  double _comissao = 0.0;
  double _deducoes = 0.0;
  double _saldo = 0.0;
  double _percentualComissao = 12.0;
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
      // Perfil carregado primeiro para obter percentual_comissao antes dos cálculos
      final profile = await ApiService.getMe();
      if (profile != null) {
        _percentualComissao = double.tryParse(
          profile['motoristas']?['percentual_comissao']?.toString() ?? '',
        ) ?? 12.0;
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

      double td = 0.0;
      for (var d in despesas) {
        if (d['quem_pagou'] == 'proprietario') {
          td += double.tryParse(d['valor'].toString()) ?? 0.0;
        }
      }
      for (var a in abastecimentos) {
        if (a['quem_pagou'] == 'proprietario') {
          td += double.tryParse(a['valor_total'].toString()) ?? 0.0;
        }
      }
      for (var v in vales) {
        if (v['quem_pagou'] == 'proprietario') {
          td += double.tryParse(v['valor'].toString()) ?? 0.0;
        }
      }

      _totalFretes = tf;
      _comissao = tf * (_percentualComissao / 100);
      _deducoes = td;
      _saldo = _comissao - _deducoes;

      AppLogger.action('load_finance_data', params: {
        'total_fretes': tf,
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