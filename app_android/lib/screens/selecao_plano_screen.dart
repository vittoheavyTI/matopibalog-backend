import 'package:flutter/material.dart';
import '../models/plano_publico.dart';
import '../services/api_service.dart';

/// Resultado da tela de seleção de plano.
/// Distingue "usuário confirmou" (retorna esta classe, com plano podendo ser
/// nulo quando o Plano Básico é usado por padrão) de "usuário voltou" (a tela
/// é encerrada com `null` pelo botão de voltar do AppBar).
class ResultadoSelecaoPlano {
  const ResultadoSelecaoPlano(this.plano);
  final PlanoPublico? plano;
}

/// Segunda etapa do cadastro autônomo: escolha do plano.
/// Os dados cadastrais já foram preenchidos e validados na tela anterior;
/// aqui o usuário só seleciona o plano e confirma ("Criar conta").
class SelecaoPlanoScreen extends StatefulWidget {
  const SelecaoPlanoScreen({super.key});

  @override
  State<SelecaoPlanoScreen> createState() => _SelecaoPlanoScreenState();
}

class _SelecaoPlanoScreenState extends State<SelecaoPlanoScreen> {
  bool _carregando = true;
  String _erro = '';
  // Carregou com sucesso mas não há plano de autônomo → bloqueia a conclusão.
  bool _semPlanos = false;
  List<PlanoPublico> _planos = const [];
  PlanoPublico? _planoSelecionado;

  @override
  void initState() {
    super.initState();
    _carregarPlanos();
  }

  Future<void> _carregarPlanos() async {
    try {
      // Só planos destinados a autônomo (categoria autonomo/ambos). O default é
      // o primeiro da lista (mais barato) — não dependemos mais do nome do plano.
      final planos = await ApiService.getPlanosPublicos(categoria: 'autonomo');
      if (!mounted) return;
      setState(() {
        _planos = planos;
        _planoSelecionado = planos.isNotEmpty ? planos.first : null;
        _semPlanos = planos.isEmpty;
        _carregando = false;
        _erro = '';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _carregando = false;
        // Falha de rede: não bloqueia — sem plano_id, o backend escolhe um plano
        // elegível de autônomo (ou retorna erro amigável). Nunca plano de empresa.
        _erro = 'Não foi possível carregar os planos. Você pode tentar concluir; '
            'usaremos um plano de autônomo disponível.';
      });
    }
  }

  String _formatarPreco(double valor) {
    return 'R\$ ${valor.toStringAsFixed(2).replaceAll('.', ',')}/mês';
  }

  void _confirmar() {
    Navigator.pop(context, ResultadoSelecaoPlano(_planoSelecionado));
  }

  Widget _buildPlanoCard(PlanoPublico plano) {
    final selecionado = _planoSelecionado?.id == plano.id;
    final detalhes = <String>[
      if (plano.diasTrial != null) '${plano.diasTrial} dias de teste grátis',
      plano.valorImplantacao <= 0
          ? 'Implantação grátis no lançamento'
          : 'Implantação R\$ ${plano.valorImplantacao.toStringAsFixed(2).replaceAll('.', ',')}',
      'Recorrência mensal',
      if (plano.limiteMotoristas != null) 'Até ${plano.limiteMotoristas} motorista(s)',
      ...plano.recursos.take(3),
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => setState(() => _planoSelecionado = plano),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selecionado ? Theme.of(context).colorScheme.primary : Colors.grey.shade300,
              width: selecionado ? 2 : 1,
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                selecionado ? Icons.radio_button_checked : Icons.radio_button_off,
                color: selecionado ? Theme.of(context).colorScheme.primary : Colors.grey,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(plano.nome, style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(
                      _formatarPreco(plano.precoMensal),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (plano.descricao.isNotEmpty)
                      Text(plano.descricao, style: const TextStyle(fontSize: 12)),
                    for (final detalhe in detalhes)
                      Text('• $detalhe', style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Escolha seu plano')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Selecione o plano para iniciar seu período de teste.',
              style: TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 16),
            if (_carregando)
              const Center(
                child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()),
              )
            else ...[
              if (_semPlanos) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: const Text(
                    'Nenhum plano para autônomo disponível no momento. '
                    'Tente novamente mais tarde ou fale com o suporte.',
                    style: TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(height: 16),
              ] else if (_erro.isNotEmpty) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.orange.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.orange.shade200),
                  ),
                  child: Text(_erro, style: const TextStyle(fontSize: 13)),
                ),
                const SizedBox(height: 16),
              ],
              ..._planos.map(_buildPlanoCard),
            ],
            if (!_carregando && !_semPlanos) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFE7F0FE),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFB6D4FE)),
                ),
                child: const Text(
                  'Para liberar o uso do sistema, será necessário assinar eletronicamente o contrato, com código enviado por e-mail.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF1B4B91)),
                ),
              ),
            ],
            const SizedBox(height: 24),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                // Lista vazia (sem plano de autônomo) bloqueia a conclusão.
                onPressed: (_carregando || _semPlanos) ? null : _confirmar,
                child: const Text('CRIAR CONTA', style: TextStyle(fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
