import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import 'dart:io';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';

class DetalheViagemScreen extends StatefulWidget {
  final Map<String, dynamic> frete;

  const DetalheViagemScreen({super.key, required this.frete});

  @override
  State<DetalheViagemScreen> createState() => _DetalheViagemScreenState();
}

class _DetalheViagemScreenState extends State<DetalheViagemScreen> {
  List<dynamic> _despesas = [];
  List<dynamic> _abastecimentos = [];
  List<dynamic> _vales = [];
  List<dynamic> _documentos = [];
  bool _enviandoDoc = false;
  // Id do documento cujo download (para abrir/compartilhar) está em andamento,
  // para mostrar o spinner só naquela linha e evitar toques repetidos.
  String? _abrindoDocId;
  bool _loading = true;
  bool _finalizando = false;
  String _error = '';
  Map<String, dynamic>? _perfilCache;
  // Estado local do frete: parte do snapshot recebido, mas pode ser atualizado
  // (ex.: após finalizar pelo próprio app) sem depender de novo fetch da lista.
  late Map<String, dynamic> _frete;

  @override
  void initState() {
    super.initState();
    _frete = widget.frete;
    AppLogger.action('screen_open', params: {'tela': 'detalhe_frete', 'frete_id': _frete['id']?.toString()});
    _fetchDetalhes();
  }

  Future<void> _fetchDetalhes() async {
    setState(() { _loading = true; _error = ''; });
    final freteId = _frete['id']?.toString() ?? '';
    if (freteId.isEmpty) {
      setState(() { _loading = false; });
      return;
    }
    try {
      final despesas = ApiService.getListComFiltro('despesas', {'frete_id': freteId});
      final abast = ApiService.getListComFiltro('abastecimentos', {'frete_id': freteId});
      final vales = ApiService.getListComFiltro('vales', {'frete_id': freteId});
      final documentos = ApiService.getDocumentosFrete(freteId);
      final perfil = ApiService.getMe();
      final results = await Future.wait([despesas, abast, vales, documentos]);
      final perfilData = await perfil;
      if (mounted) {
        setState(() {
          _despesas = results[0];
          _abastecimentos = results[1];
          _vales = results[2];
          _documentos = results[3];
          _perfilCache = perfilData;
          _loading = false;
        });
        AppLogger.action('detalhe_frete_fetch_ok', params: {
          'despesas': _despesas.length,
          'abastecimentos': _abastecimentos.length,
          'vales': _vales.length,
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() { _error = 'Erro ao carregar detalhes.'; _loading = false; });
        AppLogger.error('DetalheFrete', 'fetchDetalhes', e);
      }
    }
  }

  bool _podeFinalizar() {
    final status = _frete['status'] ?? '';
    if (status == 'finalizado' || status == 'cancelado') return false;
    final perfil = _perfilCache;
    if (perfil == null) return false;
    if (perfil['is_super_admin'] == true) return true;
    if (perfil['role'] == 'admin') return true;
    final empresa = perfil['empresas'] as Map<String, dynamic>?;
    final isAutonomo = empresa?['tipo'] == 'autonomo';
    if (isAutonomo) return true;
    final motorista = perfil['motoristas'] as Map<String, dynamic>?;
    return motorista?['pode_finalizar_viagem'] == true;
  }

  bool get _isAutonomo {
    final empresa = _perfilCache?['empresas'] as Map<String, dynamic>?;
    return empresa?['tipo'] == 'autonomo';
  }

  double get _percentualComissao {
    // Sem fallback de 12%: percentual ausente/desconhecido → 0% (nunca assume 12).
    // Usado só no ramo vinculado; autônomo tem cálculo próprio (faturamento−gastos).
    return double.tryParse(
      _perfilCache?['motoristas']?['percentual_comissao']?.toString() ?? '',
    ) ?? 0.0;
  }

  /// Converte valor para quilômetro inteiro positivo. Aceita int, double ou
  /// string com vírgula decimal brasileira. Retorna null se inválido (<=0).
  /// Ex: "1000" → 1000, "1000.5" → 1001, "1000,3" → 1000, "" → null, "0" → null.
  int? _parseKm(dynamic valor) {
    if (valor == null) return null;
    final str = valor.toString().trim().replaceAll(',', '.');
    final parsed = double.tryParse(str);
    if (parsed == null || parsed <= 0) return null;
    return parsed.round();
  }

  /// Modal de coleta de KM antes de finalizar (Série 1.5). Pede o KM final e,
  /// se o frete ainda não tem KM inicial, pede os dois. Valida números positivos
  /// e km_final > km_inicial. Retorna null se o usuário cancelar.
  Future<Map<String, int>?> _coletarKmFinalizacao(int? kmInicialExistente) {
    final precisaKmInicial = kmInicialExistente == null;
    final kmIniCtrl = TextEditingController();
    final kmFimCtrl = TextEditingController();
    return showDialog<Map<String, int>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        String? erro;
        return StatefulBuilder(
          builder: (ctx, setLocal) => AlertDialog(
            title: const Text('Finalizar Frete'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Informe a quilometragem para registrar a média de consumo.'),
                const SizedBox(height: 12),
                if (precisaKmInicial)
                  TextField(
                    controller: kmIniCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'KM Inicial'),
                  )
                else ...[
                  Text('KM inicial registrado: $kmInicialExistente',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                ],
                TextField(
                  controller: kmFimCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'KM Final'),
                ),
                if (erro != null) ...[
                  const SizedBox(height: 8),
                  Text(erro!, style: const TextStyle(color: Colors.red, fontSize: 13)),
                ],
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar'),
              ),
              ElevatedButton(
                onPressed: () {
                  final kmFim = _parseKm(kmFimCtrl.text.trim());
                  final kmIni = _parseKm(kmIniCtrl.text.trim());
                  if (kmFim == null) {
                    setLocal(() => erro = 'KM final inválido. Use apenas números.');
                    return;
                  }
                  if (precisaKmInicial && kmIni == null) {
                    setLocal(() => erro = 'KM inicial inválido. Use apenas números.');
                    return;
                  }
                  final int kmIniEfetivo;
                  if (precisaKmInicial) {
                    kmIniEfetivo = kmIni!;
                  } else {
                    kmIniEfetivo = kmInicialExistente;
                  }
                  if (kmFim <= kmIniEfetivo) {
                    setLocal(() => erro = 'KM final deve ser maior que o KM inicial.');
                    return;
                  }
                  final result = <String, int>{'km_final': kmFim};
                  if (precisaKmInicial) result['km_inicial'] = kmIni!;
                  Navigator.pop(ctx, result);
                },
                child: const Text('Finalizar'),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _finalizarFrete() async {
    final freteId = _frete['id']?.toString() ?? '';
    if (freteId.isEmpty) return;

    // Compatibilidade: a foto final é obrigatória no novo fluxo (que possui
    // foto inicial). Fretes legados sem path inicial continuam finalizáveis.
    File? fotoFinal;
    final exigeFotoFinal = _frete['foto_odometro_inicial_path'] != null
        && _frete['foto_odometro_inicial_path'].toString().isNotEmpty
        && (_frete['foto_odometro_final_path'] == null
            || _frete['foto_odometro_final_path'].toString().isEmpty);
    if (exigeFotoFinal) {
      try {
        final picked = await ImagePicker().pickImage(
          source: ImageSource.camera, imageQuality: 75, maxWidth: 1800, maxHeight: 1800,
        );
        if (picked == null) return;
        fotoFinal = File(picked.path);
      } catch (e) {
        AppLogger.error('DetalheFrete', 'erro_foto_odometro_final', e);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Erro ao acessar a câmera.')));
        }
        return;
      }
    }

    // Coleta de KM antes de finalizar (Série 1.5). Cancelar o modal não finaliza.
    final kmInicialExistente = _parseKm(_frete['km_inicial']);
    final kmColetado = await _coletarKmFinalizacao(kmInicialExistente);
    if (kmColetado == null) return;
    if (!mounted) return;

    AppLogger.action('finalizar_frete', params: {'frete_id': freteId});
    setState(() => _finalizando = true);
    try {
      if (fotoFinal != null) {
        final upload = await ApiService.uploadFotoOdometro(freteId, 'final', fotoFinal.path);
        if (!mounted) return;
        if (upload['ok'] != true) {
          final msg = upload['message']?.toString() ?? 'Erro ao enviar foto do odômetro final.';
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
          return;
        }
        setState(() => _frete['foto_odometro_final_path'] = upload['path']);
      }
      final result = await ApiService.finalizarViagem(
        freteId,
        kmInicial: kmColetado['km_inicial'],
        kmFinal: kmColetado['km_final'],
      );
      if (!mounted) return;
      if (result != null && result['_error'] != true) {
        AppLogger.action('finalizar_frete_ok', params: {'frete_id': freteId});
        // Atualiza o status local para 'finalizado' para que o botão não
        // reapareça caso a tela permaneça/seja reaberta com este snapshot.
        setState(() => _frete['status'] = 'finalizado');
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Frete finalizado com sucesso!')),
        );
        Navigator.pop(context, true);
      } else {
        final msg = result?['message'] ?? 'Erro ao finalizar.';
        AppLogger.warning('DetalheFrete', 'finalizar falhou: $msg');
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      }
    } catch (e) {
      AppLogger.error('DetalheFrete', 'finalizarFrete exception', e);
    } finally {
      if (mounted) setState(() => _finalizando = false);
    }
  }

  double _soma(List<dynamic> items, String campo, {String? filtroStatus, String? quemPagou}) {
    double total = 0.0;
    for (final item in items) {
      if (filtroStatus != null && item['status'] != filtroStatus) continue;
      if (quemPagou != null && item['quem_pagou'] != quemPagou) continue;
      total += double.tryParse(item[campo]?.toString() ?? '0') ?? 0.0;
    }
    return total;
  }

  /// Soma lançamentos EFETIVADOS (aprovado/finalizado) de um determinado pagador.
  /// Usado no saldo do vinculado, que segue o painel: só conta o que foi aprovado
  /// (e 'finalizado', estado dos aprovados após o encerramento do frete).
  double _somaPorPagador(List<dynamic> items, String campo, String quemPagou) {
    double total = 0.0;
    for (final item in items) {
      final status = item['status'];
      if (status != 'aprovado' && status != 'finalizado') continue;
      if (item['quem_pagou'] != quemPagou) continue;
      total += double.tryParse(item[campo]?.toString() ?? '0') ?? 0.0;
    }
    return total;
  }

  // Menu de tipo do documento antes de escolher o arquivo (cte/mdfe/nfe/outro).
  Future<String?> _escolherTipoDocumento() {
    const opcoes = [
      ('cte', 'CT-e'),
      ('mdfe', 'MDF-e'),
      ('nfe', 'NF-e'),
      ('outro', 'Outro'),
    ];
    return showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Tipo do documento', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            for (final o in opcoes)
              ListTile(
                leading: const Icon(Icons.description_outlined),
                title: Text(o.$2),
                onTap: () => Navigator.pop(ctx, o.$1),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  // Origem do arquivo do documento: câmera (foto na hora), galeria ou arquivo
  // do dispositivo/drive (PDF/XML/imagem). Retorna 'camera'|'galeria'|'arquivo'
  // ou null se o usuário fechar a folha.
  Future<String?> _escolherOrigemDocumento() {
    return showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Anexar documento', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Tirar foto agora'),
              onTap: () => Navigator.pop(ctx, 'camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Escolher da galeria'),
              onTap: () => Navigator.pop(ctx, 'galeria'),
            ),
            ListTile(
              leading: const Icon(Icons.attach_file),
              title: const Text('Anexar arquivo (PDF, XML ou imagem)'),
              onTap: () => Navigator.pop(ctx, 'arquivo'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  // Captura (câmera) ou seleciona (galeria) uma imagem e retorna o caminho, ou
  // null se cancelar/der erro. Mesmos limites das demais telas de foto do app.
  Future<String?> _selecionarImagemDocumento(ImageSource source) async {
    try {
      final picked = await ImagePicker().pickImage(
        source: source, imageQuality: 75, maxWidth: 1800, maxHeight: 1800,
      );
      return picked?.path;
    } catch (e) {
      AppLogger.error('DetalheFrete', 'image_picker documento', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(source == ImageSource.camera
              ? 'Erro ao acessar a câmera.'
              : 'Erro ao acessar a galeria.')),
        );
      }
      return null;
    }
  }

  // Seleciona um arquivo do dispositivo/drive (PDF, XML ou imagem) via
  // file_picker — mesma allowlist do backend. Retorna o caminho ou null.
  Future<String?> _selecionarArquivoDocumento() async {
    try {
      final escolhido = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'xml', 'jpg', 'jpeg', 'png', 'webp'],
      );
      return escolhido?.files.single.path;
    } catch (e) {
      AppLogger.error('DetalheFrete', 'file_picker', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível abrir o seletor de arquivos.')),
        );
      }
      return null;
    }
  }

  // Envia o documento selecionado para o frete e atualiza a lista. Reaproveitado
  // pelas três origens (câmera/galeria/arquivo).
  Future<void> _enviarDocumento(String tipo, String caminho) async {
    setState(() => _enviandoDoc = true);
    final freteId = _frete['id']?.toString() ?? '';
    final res = await ApiService.uploadDocumentoFrete(freteId, tipo, caminho);
    if (!mounted) return;
    setState(() => _enviandoDoc = false);
    if (res['ok'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Documento anexado.')),
      );
      _fetchDetalhes();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(res['message']?.toString() ?? 'Erro ao anexar documento.')),
      );
    }
  }

  // Anexa um documento ao frete: escolhe o tipo (CT-e/MDF-e/NF-e/Outro), depois a
  // origem (câmera, galeria ou arquivo) e envia. Bucket privado no backend.
  Future<void> _anexarDocumento() async {
    final tipo = await _escolherTipoDocumento();
    if (tipo == null || !mounted) return;

    final origem = await _escolherOrigemDocumento();
    if (origem == null || !mounted) return;

    String? caminho;
    switch (origem) {
      case 'camera':
        caminho = await _selecionarImagemDocumento(ImageSource.camera);
        break;
      case 'galeria':
        caminho = await _selecionarImagemDocumento(ImageSource.gallery);
        break;
      default:
        caminho = await _selecionarArquivoDocumento();
    }
    if (caminho == null || !mounted) return; // cancelou ou erro

    await _enviarDocumento(tipo, caminho);
  }

  // Ao tocar num documento: busca a signed URL (bucket privado), baixa para um
  // arquivo temporário e abre a folha de compartilhamento nativa (WhatsApp,
  // visualizador de PDF/imagem etc.). Não altera o anexo já existente.
  Future<void> _abrirCompartilharDocumento(Map<String, dynamic> doc) async {
    if (_abrindoDocId != null) return; // já há um download em andamento
    final docId = doc['id']?.toString() ?? '';
    if (docId.isEmpty) return;
    final freteId = _frete['id']?.toString() ?? '';

    setState(() => _abrindoDocId = docId);
    try {
      final url = await ApiService.getDocumentoUrl(freteId, docId);
      if (!mounted) return;
      if (url == null || url.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível gerar o link do documento.')),
        );
        return;
      }

      final nome = doc['nome_arquivo']?.toString();
      final nomeArquivo = (nome != null && nome.trim().isNotEmpty) ? nome.trim() : 'documento_$docId';
      final caminho = await ApiService.baixarDocumentoParaTemp(url, nomeArquivo);
      if (!mounted) return;
      if (caminho == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível baixar o documento.')),
        );
        return;
      }

      final mime = doc['mime']?.toString();
      await Share.shareXFiles(
        [XFile(caminho, mimeType: mime, name: nomeArquivo)],
        subject: nomeArquivo,
      );
    } catch (e) {
      AppLogger.error('DetalheFrete', 'abrir/compartilhar documento', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível abrir o documento.')),
        );
      }
    } finally {
      if (mounted) setState(() => _abrindoDocId = null);
    }
  }

  Widget _secaoDocumentos() {
    IconData iconePorMime(String? mime) {
      if (mime == null) return Icons.insert_drive_file_outlined;
      if (mime.contains('pdf')) return Icons.picture_as_pdf_outlined;
      if (mime.contains('xml')) return Icons.code_outlined;
      if (mime.startsWith('image/')) return Icons.image_outlined;
      return Icons.insert_drive_file_outlined;
    }

    String rotuloTipo(String? tipo) {
      switch (tipo) {
        case 'cte':
          return 'CT-e';
        case 'mdfe':
          return 'MDF-e';
        case 'nfe':
          return 'NF-e';
        default:
          return 'Outro';
      }
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.folder_open_outlined, color: Color(0xFF1B5E20)),
                const SizedBox(width: 8),
                const Text('Documentos', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                const Spacer(),
                Text('${_documentos.length}', style: TextStyle(color: Colors.grey.shade600)),
              ],
            ),
            const Divider(),
            if (_documentos.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text('Nenhum documento anexado.',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
              )
            else
              ..._documentos.map((d) {
                final m = d as Map<String, dynamic>;
                final docId = m['id']?.toString() ?? '';
                final abrindo = _abrindoDocId == docId;
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(iconePorMime(m['mime']?.toString())),
                  title: Text(m['nome_arquivo']?.toString() ?? rotuloTipo(m['tipo']?.toString())),
                  subtitle: Text(rotuloTipo(m['tipo']?.toString())),
                  trailing: abrindo
                      ? const SizedBox(
                          height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.ios_share, color: Color(0xFF1B5E20), size: 20),
                  // Um download por vez: desabilita o toque enquanto outro abre.
                  onTap: _abrindoDocId != null ? null : () => _abrirCompartilharDocumento(m),
                );
              }),
            const SizedBox(height: 6),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                icon: _enviandoDoc
                    ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.attach_file),
                label: Text(_enviandoDoc ? 'Enviando…' : 'Anexar documento'),
                onPressed: _enviandoDoc ? null : _anexarDocumento,
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('PDF, XML ou imagem. Toque no documento para abrir ou compartilhar.',
                  style: TextStyle(color: Colors.grey.shade500, fontSize: 11)),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final f = _frete;
    final origem = f['origem'] ?? '-';
    final destino = f['destino'] ?? '-';

    return Scaffold(
      appBar: AppBar(title: Text('$origem → $destino', overflow: TextOverflow.ellipsis)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? Center(child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(_error),
                    const SizedBox(height: 12),
                    ElevatedButton(onPressed: _fetchDetalhes, child: const Text('Tentar novamente')),
                  ],
                ))
              : RefreshIndicator(
                  onRefresh: _fetchDetalhes,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _cardFrete(f),
                        const SizedBox(height: 16),
                        if (_despesas.isNotEmpty) ...[
                          _secaoLancamentos('Despesas', _despesas, 'valor'),
                          const SizedBox(height: 12),
                        ],
                        if (_abastecimentos.isNotEmpty) ...[
                          _secaoLancamentos('Abastecimentos', _abastecimentos, 'valor_total'),
                          const SizedBox(height: 12),
                        ],
                        if (_vales.isNotEmpty) ...[
                          _secaoLancamentos('Vales', _vales, 'valor'),
                          const SizedBox(height: 12),
                        ],
                        _secaoDocumentos(),
                        const SizedBox(height: 12),
                        _cardResumo(f),
                        const SizedBox(height: 16),
                        if (_podeFinalizar())
                          SizedBox(
                            height: 48,
                            child: ElevatedButton.icon(
                              icon: _finalizando
                                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                  : const Icon(Icons.check_circle_outline),
                              label: const Text('FINALIZAR FRETE'),
                              style: ElevatedButton.styleFrom(backgroundColor: Colors.green.shade700),
                              onPressed: _finalizando ? null : _finalizarFrete,
                            ),
                          )
                        else if (_frete['status'] != 'finalizado' && _frete['status'] != 'cancelado')
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            child: Row(
                              children: [
                                Icon(Icons.lock_outline, color: Colors.grey.shade500, size: 14),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    'Finalização pelo app não autorizada. Contate o administrador.',
                                    style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
                ),
    );
  }

  Widget _cardFrete(Map<String, dynamic> f) {
    final data = f['data'] != null
        ? DateFormat('dd/MM/yyyy').format(DateTime.parse(f['data']))
        : '--';
    final status = f['status'] ?? 'pendente';
    final valorFrete = double.tryParse(f['valor_frete']?.toString() ?? '0') ?? 0.0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.local_shipping_outlined, color: Color(0xFF1B5E20)),
                const SizedBox(width: 8),
                const Text('Dados do Frete', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const Spacer(),
                _badge(status),
              ],
            ),
            const Divider(),
            _linhaDado('Data', data),
            _linhaDado('Origem', f['origem'] ?? '--'),
            _linhaDado('Destino', f['destino'] ?? '--'),
            if (f['placa'] != null) _linhaDado('Placa', f['placa']),
            _linhaDado('Valor', 'R\$ ${valorFrete.toStringAsFixed(2)}'),
            if (f['quem_recebeu'] != null) _linhaDado('Quem recebeu', f['quem_recebeu']),
          ],
        ),
      ),
    );
  }

  Widget _secaoLancamentos(String titulo, List<dynamic> items, String campoValor) {
    final aprovados = items.where((i) => i['status'] == 'aprovado').toList();
    final pendentes = items.where((i) => i['status'] == 'pendente').toList();
    final rejeitados = items.where((i) => i['status'] == 'rejeitado').toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            const Divider(),
            if (aprovados.isNotEmpty)
              _subSecao('Aprovados', aprovados, campoValor, Colors.green),
            if (pendentes.isNotEmpty)
              _subSecao('Pendentes', pendentes, campoValor, Colors.orange),
            if (rejeitados.isNotEmpty)
              _subSecao('Rejeitados', rejeitados, campoValor, Colors.red),
          ],
        ),
      ),
    );
  }

  Widget _subSecao(String label, List<dynamic> items, String campoValor, Color cor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(label, style: TextStyle(color: cor, fontSize: 13, fontWeight: FontWeight.w600)),
        ),
        ...items.map((item) {
          final val = double.tryParse(item[campoValor]?.toString() ?? '0') ?? 0.0;
          final desc = item['descricao'] ?? item['posto'] ?? item['tipo'] ?? '-';
          final obs = item['obs_resolucao'] as String?;
          return Padding(
            padding: const EdgeInsets.only(left: 8, bottom: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(desc, style: const TextStyle(fontSize: 14))),
                    Text('R\$ ${val.toStringAsFixed(2)}', style: TextStyle(fontSize: 14, color: cor)),
                  ],
                ),
                if (obs != null && obs.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      'Obs: $obs',
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade600, fontStyle: FontStyle.italic),
                    ),
                  ),
              ],
            ),
          );
        }),
        const SizedBox(height: 4),
      ],
    );
  }

  Widget _cardResumo(Map<String, dynamic> f) {
    // Frete cancelado: NÃO exibir comissão/saldo/resultado — o frete não tem valor
    // financeiro válido. Substitui o resumo financeiro por um aviso claro. Os dados do
    // frete (_cardFrete) e os lançamentos seguem visíveis. Espelha a regra do
    // finance_provider, que já exclui cancelados das somas gerais.
    if ((f['status'] ?? '') == 'cancelado') {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Icon(Icons.block, color: Colors.red),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Frete cancelado — fora dos cálculos financeiros.',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final valorFrete = double.tryParse(f['valor_frete']?.toString() ?? '0') ?? 0.0;

    // Alinhado com FinanceProvider: vinculado só deduz lancamentos pagos pelo
    // proprietario (quem_pagou == 'proprietario'); autonomo deduz todos.
    final quemPagouFilter = _isAutonomo ? null : 'proprietario';
    final despesasAprov = _soma(_despesas, 'valor', filtroStatus: 'aprovado', quemPagou: quemPagouFilter);
    final abastAprov = _soma(_abastecimentos, 'valor_total', filtroStatus: 'aprovado', quemPagou: quemPagouFilter);
    final valesAprov = _soma(_vales, 'valor', filtroStatus: 'aprovado', quemPagou: quemPagouFilter);
    final totalDeducoes = despesasAprov + abastAprov + valesAprov;

    final pendentes = _despesas.where((i) => i['status'] == 'pendente').length +
        _abastecimentos.where((i) => i['status'] == 'pendente').length +
        _vales.where((i) => i['status'] == 'pendente').length;
    final rejeitados = _despesas.where((i) => i['status'] == 'rejeitado').length +
        _abastecimentos.where((i) => i['status'] == 'rejeitado').length +
        _vales.where((i) => i['status'] == 'rejeitado').length;

    if (_isAutonomo) {
      // Autônomo: Faturamento - Despesas = Resultado
      final resultado = valorFrete - totalDeducoes;
      return Card(
        // sem color explícita → segue tema (evita fundo verde-escuro no dark mode)
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Resumo do Frete', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.onSurface)),
              const Divider(),
              _linhaResumo('Valor do Frete', valorFrete),
              _linhaResumo('Despesas aprovadas', -despesasAprov, color: Colors.red),
              _linhaResumo('Abastecimentos aprovados', -abastAprov, color: Colors.red),
              if (valesAprov > 0)
                _linhaResumo('Vales aprovados', -valesAprov, color: Colors.red),
              const Divider(),
              _linhaResumo('Resultado', resultado, color: resultado >= 0 ? Colors.green : Colors.red, bold: true),
              _avisosPendentes(pendentes, rejeitados),
            ],
          ),
        ),
      );
    }

    // Vinculado (igual ao painel): comissão + reembolsos − adiantamentos.
    //   • comissão = % do valor do frete (crédito);
    //   • reembolso = despesas + abastecimentos pagos PELO MOTORISTA (crédito);
    //   • adiantamentos = vales pagos PELA EMPRESA (desconto);
    //   • despesas/abast pagos pela EMPRESA NÃO reduzem a comissão do motorista.
    // Só entram lançamentos efetivados (aprovado/finalizado); pendentes/rejeitados ficam fora.
    final pct = _percentualComissao;
    final comissao = valorFrete * (pct / 100);
    final reembolso = _somaPorPagador(_despesas, 'valor', 'motorista') +
        _somaPorPagador(_abastecimentos, 'valor_total', 'motorista');
    final adiantamentos = _somaPorPagador(_vales, 'valor', 'proprietario');
    final saldoLiquido = comissao + reembolso - adiantamentos;

    return Card(
      // sem color explícita → segue tema (evita fundo escuro no dark mode), igual ao autônomo
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Resumo do Frete', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.onSurface)),
            const Divider(),
            _linhaResumo('Valor do Frete', valorFrete),
            _linhaResumo('Comissão ($pct%)', comissao, color: Colors.blue),
            if (reembolso > 0)
              _linhaResumo('Reembolso (pago por você)', reembolso, color: Colors.green),
            if (adiantamentos > 0)
              _linhaResumo('Vales / adiantamentos', -adiantamentos, color: Colors.red),
            const Divider(),
            _linhaResumo('Saldo Líquido', saldoLiquido, color: saldoLiquido >= 0 ? Colors.green : Colors.red, bold: true),
            _avisosPendentes(pendentes, rejeitados),
          ],
        ),
      ),
    );
  }

  Widget _avisosPendentes(int pendentes, int rejeitados) {
    return Column(
      children: [
        if (pendentes > 0)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                Icon(Icons.warning_amber_outlined, color: Colors.orange.shade700, size: 16),
                const SizedBox(width: 4),
                Text('$pendentes lançamento(s) pendente(s)', style: TextStyle(color: Colors.orange.shade700, fontSize: 13)),
              ],
            ),
          ),
        if (rejeitados > 0)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(
              children: [
                const Icon(Icons.cancel_outlined, color: Colors.red, size: 16),
                const SizedBox(width: 4),
                Text('$rejeitados lançamento(s) rejeitado(s)', style: const TextStyle(color: Colors.red, fontSize: 13)),
              ],
            ),
          ),
      ],
    );
  }

  Widget _linhaResumo(String label, double valor, {Color? color, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.bold : FontWeight.normal, fontSize: 14)),
          Text(
            'R\$ ${valor.abs().toStringAsFixed(2)}',
            style: TextStyle(
              color: color ?? Theme.of(context).colorScheme.onSurface,
              fontWeight: bold ? FontWeight.bold : FontWeight.normal,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  Widget _linhaDado(String label, String valor) {
    final corLabel = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.75);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 130, child: Text(label, style: TextStyle(color: corLabel, fontSize: 15))),
          Expanded(child: Text(valor, style: const TextStyle(fontSize: 15))),
        ],
      ),
    );
  }

  Widget _badge(String status) {
    final color = _corStatus(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
      child: Text(status, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }

  Color _corStatus(String status) {
    switch (status) {
      case 'finalizado': return Colors.green;
      case 'em_viagem': return Colors.blue;
      case 'cancelado': return Colors.red;
      default: return Colors.orange;
    }
  }
}
