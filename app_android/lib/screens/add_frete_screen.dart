import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/app_logger.dart';
import '../services/document_scanner_service.dart';
import '../services/location_tracking_service.dart';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';

class _DocumentoPendente {
  final String tipo;
  final String path;
  final String nome;

  const _DocumentoPendente({
    required this.tipo,
    required this.path,
    required this.nome,
  });
}

class AddFreteScreen extends StatefulWidget {
  const AddFreteScreen({super.key});

  @override
  State<AddFreteScreen> createState() => _AddFreteScreenState();
}

class _AddFreteScreenState extends State<AddFreteScreen> {
  final _origemCtrl = TextEditingController();
  final _destinoCtrl = TextEditingController();
  final _kmCtrl = TextEditingController();
  final _valorCtrl = TextEditingController();
  String _quemRecebeu = 'motorista';
  bool _loading = false;
  File? _fotoOdometroInicial;
  final List<_DocumentoPendente> _documentosPendentes = [];
  // Guarda o id de um frete já criado cuja foto inicial ainda não subiu. Enquanto
  // definido, tocar em Salvar REENVIA só a foto (não recria o frete) — evita duplicar.
  String? _fretePendenteId;

  @override
  void initState() {
    super.initState();
    AppLogger.action('screen_open', params: {'tela': 'add_frete'});
  }

  Future<void> _salvar() async {
    if (_origemCtrl.text.isEmpty ||
        _destinoCtrl.text.isEmpty ||
        _valorCtrl.text.isEmpty) {
      AppLogger.action('frete_validation_error',
          params: {'motivo': 'campos_obrigatorios'});
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Preencha os campos obrigatórios.')));
      return;
    }

    // Aceita vírgula decimal (padrão brasileiro) convertendo para ponto
    final valorStr = _valorCtrl.text.trim().replaceAll(',', '.');
    final valorFrete = double.tryParse(valorStr);
    if (valorFrete == null || valorFrete <= 0) {
      AppLogger.action('frete_validation_error',
          params: {'motivo': 'valor_invalido'});
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(
                'Valor do frete inválido. Use apenas números (ex: 1500 ou 1500,50).')),
      );
      return;
    }

    AppLogger.action('frete_save_attempt', params: {
      'origem': _origemCtrl.text,
      'destino': _destinoCtrl.text,
      'quem_recebeu': _quemRecebeu,
    });
    setState(() => _loading = true);

    // Novo fluxo: KM e foto inicial são obrigatórios. O backend cria o registro
    // pendente e só o ativa depois do upload privado da foto.
    final kmStr = _kmCtrl.text.trim();
    final kmInicial = int.tryParse(kmStr);
    if (kmInicial == null || kmInicial <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Informe um KM inicial válido, maior que zero.')),
      );
      setState(() => _loading = false);
      return;
    }
    if (_fotoOdometroInicial == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('Tire a foto do odômetro inicial para iniciar o frete.')),
      );
      setState(() => _loading = false);
      return;
    }

    final payload = <String, dynamic>{
      'origem': _origemCtrl.text.trim(),
      'destino': _destinoCtrl.text.trim(),
      'valor_frete': valorFrete,
      'quem_recebeu': _quemRecebeu,
      'odometro_obrigatorio': true,
    };
    payload['km_inicial'] = kmInicial;

    try {
      String freteId;
      if (_fretePendenteId != null) {
        // Retentativa: o frete já foi criado numa tentativa anterior cujo upload
        // falhou. Reenvia SÓ a foto para o mesmo id — nunca cria outro frete.
        freteId = _fretePendenteId!;
      } else {
        final resultado = await ApiService.createFrete(payload);
        if (!mounted) return;
        if (resultado['ok'] != true) {
          final msg =
              resultado['message'] as String? ?? 'Erro ao salvar frete.';
          AppLogger.warning('AddFrete', msg);
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(msg)));
          return;
        }
        freteId = resultado['id']?.toString() ?? '';
        if (freteId.isEmpty) {
          throw StateError('Backend não retornou o identificador do frete.');
        }
      }

      final rastreamentoOk = await _prepararRastreamentoAntesDoInicio();
      if (!mounted) return;
      if (!rastreamentoOk) {
        _fretePendenteId = freteId;
        return;
      }

      final upload = await ApiService.uploadFotoOdometro(
          freteId, 'inicial', _fotoOdometroInicial!.path);
      if (!mounted) {
        return;
      }
      if (upload['ok'] != true) {
        // Frete persistiu, mas a foto não subiu. Guarda o id para a próxima tentativa
        // reenviar só a foto (sem recriar) e orienta o usuário a tocar em Salvar.
        _fretePendenteId = freteId;
        final msg = upload['message']?.toString() ??
            'Frete salvo como pendente, mas a foto inicial não foi enviada.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content:
                  Text('$msg Toque em Salvar novamente para reenviar a foto.')),
        );
        return;
      }

      await LocationTrackingService.startForActiveTrips(requestPermission: false);
      final documentosComFalha = await _enviarDocumentosPendentes(freteId);
      if (!mounted) {
        return;
      }

      AppLogger.action('frete_save_ok');
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context, true);
      if (documentosComFalha > 0) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              'Frete registrado, mas $documentosComFalha documento(s) não foram anexados. '
              'Reenvie pelo detalhe do frete.',
            ),
          ),
        );
      } else {
        messenger.showSnackBar(
          const SnackBar(content: Text('Frete registrado com sucesso!')),
        );
      }
    } catch (e) {
      AppLogger.error('AddFrete', 'erro_conexao', e);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Erro de conexão.')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _prepararRastreamentoAntesDoInicio() async {
    final result = await LocationTrackingService.prepareForTripStart(requestPermission: false);
    if (result == LocationTrackingStartResult.started) return true;
    if (!mounted) return false;
    final msg = _mensagemRastreamento(result);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    await LocationTrackingService.openOperationalSettings(result);
    return false;
  }

  String _mensagemRastreamento(LocationTrackingStartResult result) {
    switch (result) {
      case LocationTrackingStartResult.started:
        return 'Compartilhamento pronto para iniciar.';
      case LocationTrackingStartResult.serviceDisabled:
        return 'Ative a localizacao do aparelho para iniciar o frete.';
      case LocationTrackingStartResult.denied:
        return 'Permissao negada. O frete permanece pendente ate a permissao ser concedida.';
      case LocationTrackingStartResult.deniedForever:
        return 'Permissao bloqueada nas configuracoes do Android. O frete permanece pendente.';
      case LocationTrackingStartResult.approximateOnly:
        return 'A operacao exige localizacao precisa. Ajuste a permissao nas configuracoes do Android.';
      case LocationTrackingStartResult.missingSession:
        return 'Sessao nao encontrada para iniciar o compartilhamento.';
      case LocationTrackingStartResult.unsupported:
        return 'Compartilhamento disponivel apenas no app Android.';
      case LocationTrackingStartResult.failed:
        return 'Nao foi possivel preparar o compartilhamento agora.';
    }
  }

  String _rotuloTipoDocumento(String tipo) {
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

  Future<String?> _escolherTipoDocumento() {
    const opcoes = [
      {'valor': 'cte', 'rotulo': 'CT-e'},
      {'valor': 'mdfe', 'rotulo': 'MDF-e'},
      {'valor': 'nfe', 'rotulo': 'NF-e'},
      {'valor': 'outro', 'rotulo': 'Outro'},
    ];
    return showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Tipo do documento',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            for (final opcao in opcoes)
              ListTile(
                leading: const Icon(Icons.description_outlined),
                title: Text(opcao['rotulo']!),
                onTap: () => Navigator.pop(ctx, opcao['valor']),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  // Origem do documento fiscal: scanner (gera PDF) ou arquivo do dispositivo/drive.
  // Retorna 'scan', 'arquivo' ou null se o usuário fechar a folha.
  Future<String?> _escolherOrigemDocumento() {
    return showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Anexar documento',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.document_scanner_outlined),
              title: const Text('Escanear documento'),
              onTap: () => Navigator.pop(ctx, 'scan'),
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

  // Escaneia o documento fiscal como PDF quando o plugin suportar e adiciona à
  // lista de pendentes. Cancelar volta sem mensagem; indisponível/erro mostra
  // aviso e o usuário anexa um arquivo (fallback).
  Future<void> _escanearDocumentoFrete(String tipo) async {
    final resultado = await DocumentScannerService.escanearDocumento(
      maxPaginas: 10,
      comoPdf: true,
    );
    if (!mounted) return;
    if (resultado.cancelado) return;
    if (!resultado.ok || resultado.caminhos.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(resultado.mensagem ??
            'Não foi possível escanear. Anexe um arquivo.')),
      );
      return;
    }
    setState(() {
      for (final caminho in resultado.caminhos) {
        _documentosPendentes.add(
          _DocumentoPendente(
            tipo: tipo,
            path: caminho,
            nome: caminho.split(RegExp(r'[\\/]')).last,
          ),
        );
      }
    });
  }

  // Seleciona um arquivo do dispositivo/drive (PDF, XML ou imagem) e adiciona à
  // lista de pendentes. Mesma allowlist do backend.
  Future<void> _selecionarArquivoDocumento(String tipo) async {
    FilePickerResult? escolhido;
    try {
      escolhido = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf', 'xml', 'jpg', 'jpeg', 'png', 'webp'],
      );
    } catch (e) {
      AppLogger.error('AddFrete', 'file_picker_documento', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Não foi possível abrir o seletor de arquivos.')),
        );
      }
      return;
    }

    final arquivo = escolhido?.files.single;
    final caminho = arquivo?.path;
    if (arquivo == null || caminho == null) return;

    setState(() {
      _documentosPendentes.add(
        _DocumentoPendente(
          tipo: tipo,
          path: caminho,
          nome: arquivo.name,
        ),
      );
    });
  }

  Future<void> _adicionarDocumento() async {
    final tipo = await _escolherTipoDocumento();
    if (tipo == null || !mounted) return;

    final origem = await _escolherOrigemDocumento();
    if (origem == null || !mounted) return;

    if (origem == 'scan') {
      await _escanearDocumentoFrete(tipo);
    } else {
      await _selecionarArquivoDocumento(tipo);
    }
  }

  Future<int> _enviarDocumentosPendentes(String freteId) async {
    var falhas = 0;
    for (final doc in _documentosPendentes) {
      final res =
          await ApiService.uploadDocumentoFrete(freteId, doc.tipo, doc.path);
      if (res['ok'] != true) {
        falhas++;
        AppLogger.warning(
          'AddFrete',
          'falha ao anexar documento ${doc.nome}: ${res['message'] ?? 'erro desconhecido'}',
        );
      }
    }
    return falhas;
  }

  Future<void> _capturarFotoInicial() async {
    try {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.camera,
        imageQuality: 75,
        maxWidth: 1800,
        maxHeight: 1800,
      );
      if (picked != null && mounted) {
        setState(() => _fotoOdometroInicial = File(picked.path));
      }
    } catch (e) {
      AppLogger.error('AddFrete', 'erro_foto_odometro_inicial', e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Erro ao acessar a câmera.')));
      }
    }
  }

  Widget _secaoDocumentosFiscais() {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(Icons.folder_open_outlined, color: Color(0xFF1B5E20)),
                SizedBox(width: 8),
                Text('Documentos fiscais',
                    style:
                        TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Opcional. Você também pode anexar depois no detalhe do frete.',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
            ),
            const SizedBox(height: 10),
            if (_documentosPendentes.isEmpty)
              Text(
                'Nenhum documento selecionado.',
                style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
              )
            else
              ..._documentosPendentes.asMap().entries.map((entry) {
                final index = entry.key;
                final doc = entry.value;
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.description_outlined),
                  title: Text(doc.nome, overflow: TextOverflow.ellipsis),
                  subtitle: Text(_rotuloTipoDocumento(doc.tipo)),
                  trailing: IconButton(
                    tooltip: 'Remover',
                    icon: const Icon(Icons.close),
                    onPressed: _loading
                        ? null
                        : () => setState(
                            () => _documentosPendentes.removeAt(index)),
                  ),
                );
              }),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _loading ? null : _adicionarDocumento,
              icon: const Icon(Icons.attach_file),
              label: const Text('Adicionar documento'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('NOVO FRETE')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(
                controller: _origemCtrl,
                decoration: const InputDecoration(labelText: 'Origem')),
            const SizedBox(height: 16),
            TextField(
                controller: _destinoCtrl,
                decoration: const InputDecoration(labelText: 'Destino')),
            const SizedBox(height: 16),
            TextField(
                controller: _kmCtrl,
                decoration: const InputDecoration(labelText: 'KM Inicial *'),
                keyboardType: TextInputType.number),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _loading ? null : _capturarFotoInicial,
              icon: const Icon(Icons.camera_alt),
              label: Text(_fotoOdometroInicial == null
                  ? 'TIRAR FOTO DO ODÔMETRO INICIAL *'
                  : 'TROCAR FOTO DO ODÔMETRO INICIAL'),
            ),
            if (_fotoOdometroInicial != null) ...[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.file(_fotoOdometroInicial!,
                    height: 180, width: double.infinity, fit: BoxFit.cover),
              ),
            ],
            const SizedBox(height: 16),
            TextField(
                controller: _valorCtrl,
                decoration: const InputDecoration(
                    labelText: 'Valor do Frete', prefixText: 'R\$ '),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true)),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _quemRecebeu,
              decoration:
                  const InputDecoration(labelText: 'Quem Recebeu o Frete?'),
              items: const [
                DropdownMenuItem(value: 'motorista', child: Text('Motorista')),
                DropdownMenuItem(
                    value: 'proprietario', child: Text('Proprietário')),
              ],
              onChanged: (v) => setState(() => _quemRecebeu = v!),
            ),
            const SizedBox(height: 16),
            _secaoDocumentosFiscais(),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: _loading ? null : _salvar,
                child: _loading
                    ? const CircularProgressIndicator()
                    : const Text('SALVAR FRETE'),
              ),
            )
          ],
        ),
      ),
    );
  }
}
