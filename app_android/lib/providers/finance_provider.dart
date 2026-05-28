import 'package:flutter/material.dart';
import '../services/api_service.dart';

class FinanceProvider extends ChangeNotifier {
  double _totalFretes = 0.0;
  double _comissao = 0.0;
  double _deducoes = 0.0;
  double _saldo = 0.0;
  double _percentualComissao = 12.0;
  bool _loading = false;
  String _error = '';

  double get totalFretes => _totalFretes;
  double get comissao => _comissao;
  double get deducoes => _deducoes;
  double get saldo => _saldo;
  double get percentualComissao => _percentualComissao;
  bool get loading => _loading;
  String get error => _error;

  Future<void> loadData() async {
    _loading = true;
    _error = '';
    notifyListeners();

    try {
      final profile = await ApiService.getMe();
      if (profile != null) {
        _percentualComissao = double.tryParse(
          profile['motoristas']['percentual_comissao'].toString(),
        ) ?? 12.0;
      }

      final fretes = await ApiService.getFretes();
      final despesas = await ApiService.getList('despesas');
      final abastecimentos = await ApiService.getList('abastecimentos');
      final vales = await ApiService.getList('vales');

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
    } catch (e) {
      _error = 'Erro ao carregar dados. Verifique sua conexão.';
    } finally {
      _loading = false;
      notifyListeners();
    }
  }
}