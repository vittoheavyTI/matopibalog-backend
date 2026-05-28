import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import 'login_screen.dart';
import 'add_frete_screen.dart';
import 'add_despesa_screen.dart';
import 'add_abastecimento_screen.dart';
import 'add_vale_screen.dart';
import 'historico_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _nome = '';
  double _percentual = 12.0;
  double totalFretes = 0.0;
  double comissao = 0.0;
  double deducoes = 0.0;
  double saldo = 0.0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);
    final prefs = await SharedPreferences.getInstance();
    
    // 1. Carregar perfil para pegar percentual de comissão atualizado
    final profile = await ApiService.getMe();
    if (profile != null) {
      _nome = profile['nome'] ?? '';
      _percentual = double.tryParse(profile['motoristas']['percentual_comissao'].toString()) ?? 12.0;
    } else {
      _nome = prefs.getString('user_nome') ?? '';
    }

    // 2. Buscar fretes, despesas, abastecimentos e vales para calcular indicadores
    final fretes = await ApiService.getFretes();
    final despesas = await ApiService.getList('despesas');
    final abastecimentos = await ApiService.getList('abastecimentos');
    final vales = await ApiService.getList('vales');

    double tf = 0.0;
    for (var f in fretes) {
      tf += double.tryParse(f['valor_frete'].toString()) ?? 0.0;
    }

    double td = 0.0;
    // Somar apenas o que o proprietário pagou (deduções da comissão)
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

    if (mounted) {
      setState(() {
        totalFretes = tf;
        comissao = tf * (_percentual / 100);
        deducoes = td;
        saldo = comissao - deducoes;
        _loading = false;
      });
    }
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    if (mounted) {
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LoginScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Olá, $_nome'),
        actions: [
          IconButton(icon: const Icon(Icons.logout), onPressed: _logout)
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        child: _loading 
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Card(
                    elevation: 4,
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        children: [
                          const Text('Resumo do Mês', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                          const Divider(),
                          _infoRow('Total Fretes', totalFretes),
                          _infoRow('Comissão ($_percentual%)', comissao, color: Colors.blue),
                          _infoRow('Deduções (Empresa)', deducoes, color: Colors.red),
                          const Divider(),
                          _infoRow('Saldo a Receber', saldo, color: Colors.green, bold: true),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  _buildBtn(context, 'ADICIONAR FRETE', Icons.local_shipping, const AddFreteScreen()),
                  _buildBtn(context, 'ADICIONAR DESPESA', Icons.receipt, const AddDespesaScreen()),
                  _buildBtn(context, 'ADICIONAR ABASTECIMENTO', Icons.local_gas_station, const AddAbastecimentoScreen()),
                  _buildBtn(context, 'ADICIONAR VALE', Icons.money, const AddValeScreen()),
                  _buildBtn(context, 'HISTÓRICO', Icons.history, const HistoricoScreen(), color: Colors.grey),
                ],
              ),
            ),
      ),
    );
  }

  Widget _infoRow(String label, double value, {Color? color, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal)),
          Text(
            'R\$ ${value.toStringAsFixed(2)}',
            style: TextStyle(color: color ?? Colors.black, fontWeight: bold ? FontWeight.bold : FontWeight.normal),
          ),
        ],
      ),
    );
  }

  Widget _buildBtn(BuildContext context, String title, IconData icon, Widget screen, {Color color = Colors.blue}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: ElevatedButton.icon(
        icon: Icon(icon, size: 28, color: Colors.white),
        label: Text(title, style: const TextStyle(fontSize: 16, color: Colors.white)),
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        onPressed: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
          _loadData(); // Atualiza dados ao voltar
        },
      ),
    );
  }
}
