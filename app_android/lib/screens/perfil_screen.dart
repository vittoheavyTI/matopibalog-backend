import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';

class PerfilScreen extends StatefulWidget {
  const PerfilScreen({super.key});

  @override
  State<PerfilScreen> createState() => _PerfilScreenState();
}

class _PerfilScreenState extends State<PerfilScreen> {
  Map<String, dynamic>? _profile;
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'perfil'});
    _fetchPerfil();
  }

  Future<void> _fetchPerfil() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final data = await ApiService.getMe();
      if (mounted) {
        setState(() { _profile = data; _loading = false; });
        AppLogger.action('perfil_carregado', params: {'ok': data != null});
      }
    } catch (e) {
      if (mounted) {
        setState(() { _error = 'Erro ao carregar perfil.'; _loading = false; });
        AppLogger.error('PerfilScreen', 'fetchPerfil', e);
      }
    }
  }

  String _mascaraCpf(String? cpf) {
    if (cpf == null || cpf.isEmpty) return '--';
    final digits = cpf.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 4) return '***.***.***-***';
    return '***.***.***-${digits.substring(digits.length - 2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Meu Perfil')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? Center(child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(_error),
                    const SizedBox(height: 16),
                    ElevatedButton(onPressed: _fetchPerfil, child: const Text('Tentar novamente')),
                  ],
                ))
              : _buildBody(),
    );
  }

  Widget _buildBody() {
    final p = _profile!;
    final motorista = p['motoristas'] as Map<String, dynamic>?;
    final empresa = p['empresas'] as Map<String, dynamic>?;
    final nome = p['nome'] ?? '--';
    final inicial = nome.isNotEmpty ? nome[0].toUpperCase() : 'M';

    return RefreshIndicator(
      onRefresh: _fetchPerfil,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Avatar
            Center(
              child: CircleAvatar(
                radius: 44,
                backgroundColor: const Color(0xFF1B5E20),
                child: Text(inicial, style: const TextStyle(color: Colors.white, fontSize: 36)),
              ),
            ),
            const SizedBox(height: 12),
            Center(child: Text(nome, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold))),
            const SizedBox(height: 4),
            if (empresa != null)
              Center(child: Text(empresa['nome'] ?? '--', style: TextStyle(color: Colors.grey.shade600))),
            const SizedBox(height: 24),

            // Dados do usuário
            _secao('Dados da Conta'),
            _linha('E-mail', p['email']),
            _linha('Telefone', p['celular'] ?? p['telefone'] ?? '--'),
            _linha('CPF', _mascaraCpf(p['cpf'])),
            _linha('Status', p['status'] ?? '--'),
            _linha('Tipo de conta', p['role'] ?? '--'),

            if (motorista != null) ...[
              const SizedBox(height: 16),
              _secao('Dados do Motorista'),
              _linha('Placa', motorista['placa_veiculo'] ?? '--'),
              _linha('Comissão', motorista['percentual_comissao'] != null
                  ? '${motorista['percentual_comissao']}%' : '--'),
              _linha('Status cadastro', motorista['status_cadastro'] ?? '--'),
            ],

            if (empresa != null) ...[
              const SizedBox(height: 16),
              _secao('Empresa'),
              _linha('Nome', empresa['nome'] ?? '--'),
              _linha('Tipo', empresa['tipo'] ?? '--'),
            ],
          ],
        ),
      ),
    );
  }

  Widget _secao(String titulo) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(titulo, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF1B5E20))),
    );
  }

  Widget _linha(String label, String? valor) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 140, child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Expanded(child: Text(valor ?? '--', style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }
}
