import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
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
  bool _editando = false;
  bool _salvando = false;
  String _error = '';

  final _telefoneCtrl = TextEditingController();
  final _cepCtrl = TextEditingController();
  final _enderecoCtrl = TextEditingController();
  final _bairroCtrl = TextEditingController();
  final _cidadeCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'perfil'});
    _fetchPerfil();
  }

  @override
  void dispose() {
    _telefoneCtrl.dispose();
    _cepCtrl.dispose();
    _enderecoCtrl.dispose();
    _bairroCtrl.dispose();
    _cidadeCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchPerfil() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final data = await ApiService.getMe();
      if (mounted) {
        setState(() {
          _profile = data;
          _loading = false;
          if (data != null) _preencherCampos(data);
        });
        AppLogger.action('perfil_carregado', params: {'ok': data != null});
      }
    } catch (e) {
      if (mounted) {
        setState(() { _error = 'Erro ao carregar perfil.'; _loading = false; });
        AppLogger.error('PerfilScreen', 'fetchPerfil', e);
      }
    }
  }

  void _preencherCampos(Map<String, dynamic> p) {
    _telefoneCtrl.text = p['celular'] ?? p['telefone'] ?? '';
    _cepCtrl.text = p['cep'] ?? '';
    _enderecoCtrl.text = p['endereco'] ?? '';
    _bairroCtrl.text = p['bairro'] ?? '';
    _cidadeCtrl.text = p['cidade'] ?? '';
  }

  Future<void> _salvarEdicao() async {
    setState(() => _salvando = true);
    AppLogger.action('perfil_save_attempt');
    try {
      final updated = await ApiService.updateMe({
        'celular': _telefoneCtrl.text.trim(),
        'cep': _cepCtrl.text.trim(),
        'endereco': _enderecoCtrl.text.trim(),
        'bairro': _bairroCtrl.text.trim(),
        'cidade': _cidadeCtrl.text.trim(),
      });
      if (mounted) {
        if (updated != null) {
          setState(() { _profile = updated; _editando = false; });
          AppLogger.action('perfil_save_ok');
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Perfil atualizado!')),
          );
        } else {
          AppLogger.warning('PerfilScreen', 'updateMe retornou null');
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Erro ao salvar. Tente novamente.')),
          );
        }
      }
    } catch (e) {
      AppLogger.error('PerfilScreen', 'salvarEdicao', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao salvar.')),
        );
      }
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  Future<void> _trocarFoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: const Text('Tirar foto'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('Escolher da galeria'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: source, imageQuality: 70);
      if (picked == null) return;

      AppLogger.action('perfil_foto_upload');
      setState(() => _salvando = true);
      final result = await ApiService.uploadFotoPerfil(picked.path);
      if (mounted) {
        if (result['ok'] == true) {
          final fotoUrl = result['foto_url'] as String?;
          if (fotoUrl != null) {
            context.read<AuthProvider>().atualizarFotoUrl(fotoUrl);
            setState(() {
              if (_profile != null) _profile!['foto_url'] = fotoUrl;
            });
            AppLogger.action('perfil_foto_ok');
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Foto atualizada!'),
                backgroundColor: Colors.green,
              ),
            );
          }
        } else {
          final msg = result['message'] as String? ?? 'Erro ao enviar foto.';
          AppLogger.warning('PerfilScreen', 'uploadFoto falhou: $msg');
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(msg)),
          );
        }
      }
    } catch (e) {
      AppLogger.error('PerfilScreen', 'trocarFoto', e);
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  Future<void> _alterarSenha() async {
    final novaSenhaCtrl   = TextEditingController();
    final confirmaSenhaCtrl = TextEditingController();
    bool showNova    = false;
    bool showConfirma = false;

    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Alterar senha'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: novaSenhaCtrl,
                obscureText: !showNova,
                decoration: InputDecoration(
                  labelText: 'Nova senha',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(showNova ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setDialogState(() => showNova = !showNova),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: confirmaSenhaCtrl,
                obscureText: !showConfirma,
                decoration: InputDecoration(
                  labelText: 'Confirmar nova senha',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    icon: Icon(showConfirma ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setDialogState(() => showConfirma = !showConfirma),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('CANCELAR'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('SALVAR'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) return;

    final nova    = novaSenhaCtrl.text;
    final confirma = confirmaSenhaCtrl.text;
    novaSenhaCtrl.dispose();
    confirmaSenhaCtrl.dispose();

    if (nova.length < 6) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('A senha deve ter pelo menos 6 caracteres.')),
        );
      }
      return;
    }
    if (nova != confirma) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('As senhas não coincidem.')),
        );
      }
      return;
    }

    AppLogger.action('alterar_senha_attempt');
    setState(() => _salvando = true);
    final resultado = await ApiService.trocarSenha(nova);
    if (!mounted) return;
    setState(() => _salvando = false);

    if (resultado['ok'] == true) {
      AppLogger.action('alterar_senha_ok');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Senha alterada com sucesso!'), backgroundColor: Colors.green),
      );
    } else {
      AppLogger.action('alterar_senha_erro', params: {'msg': resultado['message']});
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(resultado['message'] as String? ?? 'Erro ao alterar senha.')),
      );
    }
  }

  String _mascaraCpf(String? cpf) {
    if (cpf == null || cpf.isEmpty) return '--';
    final digits = cpf.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 4) return '***.***.***-**';
    return '***.***.***-${digits.substring(digits.length - 2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Meu Perfil'),
        actions: [
          if (!_loading && _profile != null && !_editando)
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Editar perfil',
              onPressed: () => setState(() => _editando = true),
            ),
          if (_editando) ...[
            TextButton(
              onPressed: _salvando ? null : () => setState(() { _editando = false; _preencherCampos(_profile!); }),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white)),
            ),
            IconButton(
              icon: const Icon(Icons.check),
              tooltip: 'Salvar',
              onPressed: _salvando ? null : _salvarEdicao,
            ),
          ],
        ],
      ),
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
              : Stack(
                  children: [
                    _buildBody(),
                    if (_salvando)
                      Container(
                        color: Colors.black26,
                        child: const Center(child: CircularProgressIndicator()),
                      ),
                  ],
                ),
    );
  }

  Widget _buildBody() {
    final p = _profile!;
    final motorista = p['motoristas'] as Map<String, dynamic>?;
    final empresa = p['empresas'] as Map<String, dynamic>?;
    final nome = p['nome'] ?? '--';
    final inicial = nome.isNotEmpty ? nome[0].toUpperCase() : 'M';
    final fotoUrl = p['foto_url'] as String?;

    return RefreshIndicator(
      onRefresh: _fetchPerfil,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Avatar com botão de troca
            Center(
              child: Stack(
                children: [
                  CircleAvatar(
                    radius: 44,
                    backgroundColor: const Color(0xFF1B5E20),
                    backgroundImage: (fotoUrl != null && fotoUrl.isNotEmpty)
                        ? NetworkImage(fotoUrl)
                        : null,
                    child: (fotoUrl == null || fotoUrl.isEmpty)
                        ? Text(inicial, style: const TextStyle(color: Colors.white, fontSize: 36))
                        : null,
                  ),
                  Positioned(
                    bottom: 0, right: 0,
                    child: GestureDetector(
                      onTap: _trocarFoto,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: Color(0xFF1B5E20),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.camera_alt, color: Colors.white, size: 16),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Center(child: Text(nome, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold))),
            const SizedBox(height: 4),
            if (empresa != null)
              Center(child: Text(empresa['nome'] ?? '--', style: TextStyle(color: Colors.grey.shade600))),
            const SizedBox(height: 24),

            // Dados editáveis
            _secao('Contato'),
            _editando
                ? _campo('Telefone', _telefoneCtrl, TextInputType.phone)
                : _linha('Telefone', p['celular'] ?? p['telefone'] ?? '--'),

            if (!_editando) ...[
              const SizedBox(height: 16),
              _secao('Endereço'),
              _linha('CEP', p['cep'] ?? '--'),
              _linha('Endereço', p['endereco'] ?? '--'),
              _linha('Bairro', p['bairro'] ?? '--'),
              _linha('Cidade', p['cidade'] ?? '--'),
            ] else ...[
              const SizedBox(height: 8),
              _secao('Endereço'),
              _campo('CEP', _cepCtrl, TextInputType.number),
              const SizedBox(height: 8),
              _campo('Endereço', _enderecoCtrl, TextInputType.streetAddress),
              const SizedBox(height: 8),
              _campo('Bairro', _bairroCtrl, TextInputType.text),
              const SizedBox(height: 8),
              _campo('Cidade', _cidadeCtrl, TextInputType.text),
            ],

            const SizedBox(height: 16),
            _secao('Dados da Conta'),
            _linha('E-mail', p['email']),
            _linha('CPF', _mascaraCpf(p['cpf'])),
            _linha('Status', p['status'] ?? '--'),
            _linha('Tipo de conta', p['role'] ?? '--'),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _salvando ? null : _alterarSenha,
              icon: const Icon(Icons.lock_reset_outlined, size: 18),
              label: const Text('Alterar senha'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 44),
              ),
            ),

            if (motorista != null) ...[
              const SizedBox(height: 16),
              _secao('Motorista'),
              _linha('Placa', motorista['placa_veiculo'] ?? '--'),
              // Para autônomo: percentual por frete (não há fixo); ocultar comissão fixa
              if (empresa?['tipo'] != 'autonomo')
                _linha('Comissão', motorista['percentual_comissao'] != null
                    ? '${motorista['percentual_comissao']}%' : '--'),
              _linha('Status', motorista['status_cadastro'] ?? '--'),
            ],

            if (empresa != null) ...[
              const SizedBox(height: 16),
              _secao('Empresa'),
              _linha('Nome', empresa['nome'] ?? '--'),
              _linha('Tipo', empresa['tipo'] ?? '--'),
            ],

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _secao(String titulo) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(titulo, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF1B5E20))),
  );

  Widget _linha(String label, String? valor) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 130, child: Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
        Expanded(child: Text(valor ?? '--', style: const TextStyle(fontSize: 13))),
      ],
    ),
  );

  Widget _campo(String label, TextEditingController ctrl, TextInputType tipo) => TextField(
    controller: ctrl,
    keyboardType: tipo,
    decoration: InputDecoration(labelText: label),
  );
}
