import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/situacao_comercial.dart';
import '../services/contratacao_api_service.dart';

/// Tela de Situação Comercial do autônomo/cliente (macrofrente 3A-1, §17/§22).
///
/// Mostra plano, período de teste, situação do contrato e a próxima ação. O
/// BLOQUEIO de operação é decidido pelo backend (situacao.podeOperar); a tela
/// apenas reflete e orienta — nunca infere bloqueio localmente. A assinatura, por
/// arquitetura atual, é concluída na rota web oficial (/contratacao).
class SituacaoComercialScreen extends StatefulWidget {
  const SituacaoComercialScreen({super.key});

  // Rota web oficial de assinatura de contrato.
  static const String _urlContratacaoWeb = 'https://matopibalog.com.br/contratacao';

  @override
  State<SituacaoComercialScreen> createState() => _SituacaoComercialScreenState();
}

class _SituacaoComercialScreenState extends State<SituacaoComercialScreen> {
  bool _carregando = true;
  bool _erro = false;
  SituacaoComercial? _situacao;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _carregando = true;
      _erro = false;
    });
    final s = await ContratacaoApiService.getSituacaoComercial();
    if (!mounted) return;
    setState(() {
      _situacao = s;
      _carregando = false;
      // Só marcamos erro quando o backend é aplicável mas não respondeu.
      _erro = !s.aplicavel && s.situacao == null;
    });
  }

  Future<void> _abrirAssinatura() async {
    final uri = Uri.parse(SituacaoComercialScreen._urlContratacaoWeb);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir a página de assinatura.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Minha conta')),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: _buildBody(context),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_carregando) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_erro) {
      return ListView(
        children: [
          const SizedBox(height: 120),
          const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
          const SizedBox(height: 12),
          const Center(child: Text('Não foi possível carregar a situação da conta.')),
          const SizedBox(height: 12),
          Center(
            child: FilledButton.icon(
              onPressed: _carregar,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ),
        ],
      );
    }

    final s = _situacao ?? SituacaoComercial.desconhecida();
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusHeader(situacao: s),
        const SizedBox(height: 16),

        // Bloqueio de operação (quando o backend nega escrita).
        if (!s.podeOperar)
          Card(
            color: theme.colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  const Icon(Icons.lock_outline),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _mensagemBloqueio(s),
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ),
          ),

        if (!s.podeOperar) const SizedBox(height: 12),

        // Plano e valores.
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Plano', style: theme.textTheme.labelMedium),
                Text(s.planoNome ?? '—', style: theme.textTheme.titleMedium),
                const Divider(height: 20),
                _linha('Mensalidade', _moeda(s.mensalidade)),
                _linha('Implantação', s.implantacaoGratis ? 'Grátis' : _moeda(s.implantacao)),
                if (s.trialEndsAt != null)
                  _linha(
                    'Fim do teste',
                    s.diasRestantes != null && s.diasRestantes! >= 0
                        ? 'em ${s.diasRestantes} dia(s)'
                        : 'encerrado',
                  ),
                if (s.contratoStatus != null)
                  _linha('Contrato', _contratoLabel(s.contratoStatus!)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // CTA de assinatura, quando a autoridade backend pedir.
        if (s.precisaAssinarContrato)
          FilledButton.icon(
            onPressed: _abrirAssinatura,
            icon: const Icon(Icons.draw_outlined),
            label: const Text('Assinar contrato'),
          ),

        if (s.precisaAssinarContrato)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'A assinatura é concluída na página segura, com confirmação por código no seu e-mail.',
              style: theme.textTheme.bodySmall,
            ),
          ),
      ],
    );
  }

  String _mensagemBloqueio(SituacaoComercial s) {
    if (s.precisaAssinarContrato) {
      return 'Assine o contrato para liberar o uso completo do sistema.';
    }
    switch (s.situacao) {
      case 'suspensa_financeiramente':
        return 'Conta suspensa por pendência financeira. Regularize para voltar a operar.';
      case 'trial_expirado_aguardando_decisao':
        return 'Seu período de teste terminou. Escolha como deseja continuar.';
      case 'conversao_aguardando_pagamento':
        return 'Pagamento inicial pendente. Conclua para ativar a conta.';
      case 'bloqueada_administrativamente':
        return 'Conta bloqueada. Entre em contato com o suporte.';
      default:
        return 'Operação temporariamente indisponível para esta conta.';
    }
  }

  static Widget _linha(String label, String valor) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label),
            Text(valor, style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
      );

  static String _moeda(double v) => 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';

  static String _contratoLabel(String status) {
    switch (status) {
      case 'plenamente_assinado':
      case 'assinado':
      case 'aceito_manualmente':
        return 'Assinado';
      case 'aguardando_assinatura_cliente':
        return 'Aguardando você';
      case 'aguardando_assinatura_matopiba':
        return 'Aguardando Matopiba';
      default:
        return status;
    }
  }
}

class _StatusHeader extends StatelessWidget {
  final SituacaoComercial situacao;
  const _StatusHeader({required this.situacao});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cor = situacao.podeOperar ? Colors.green : theme.colorScheme.error;
    final icone = situacao.trialAtivo
        ? Icons.timelapse
        : (situacao.podeOperar ? Icons.check_circle_outline : Icons.error_outline);
    return Row(
      children: [
        Icon(icone, color: cor, size: 28),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(situacao.rotulo, style: theme.textTheme.titleMedium),
              if (situacao.trialAtivo && situacao.diasRestantes != null)
                Text('Faltam ${situacao.diasRestantes} dia(s) de teste',
                    style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ],
    );
  }
}
