/// Situação comercial canônica da conta (macrofrente 3A-1).
///
/// Espelha a resposta de GET /contratacao/situacao (autoridade backend =
/// situacaoComercialDomainService). O app NÃO reimplementa a regra de bloqueio:
/// ele lê `podeOperar` (acoes.operar_escrita) daqui. Isto substitui a lógica
/// incorreta do PR #405 (operacaoBloqueada = ... || contratoObrigatorioPendente),
/// que bloqueava indevidamente durante trial válido.
class SituacaoComercial {
  final bool aplicavel;
  final String? situacao;
  final String? motivo;

  // Ações permitidas — decididas pelo backend.
  final bool podeOperar; // acoes.operar_escrita
  final bool podeConsultar;
  final bool podeContratar; // acoes.converter
  final bool assinarContrato; // acoes.assinar_contrato
  final bool regularizar; // acoes.regularizar

  final bool trialAtivo;
  final bool trialExpirado;
  final int? diasRestantes;
  final String? trialEndsAt;
  final String? decisaoPosTrial;
  final String? proximaAcao;

  final String? planoNome;
  final double mensalidade;
  final double implantacao;
  final bool implantacaoGratis;

  final bool contratoObrigatorio;
  final String? contratoStatus;
  final String? motivoBloqueio;

  const SituacaoComercial({
    required this.aplicavel,
    this.situacao,
    this.motivo,
    required this.podeOperar,
    required this.podeConsultar,
    required this.podeContratar,
    required this.assinarContrato,
    required this.regularizar,
    required this.trialAtivo,
    required this.trialExpirado,
    this.diasRestantes,
    this.trialEndsAt,
    this.decisaoPosTrial,
    this.proximaAcao,
    this.planoNome,
    required this.mensalidade,
    required this.implantacao,
    required this.implantacaoGratis,
    required this.contratoObrigatorio,
    this.contratoStatus,
    this.motivoBloqueio,
  });

  /// Fallback seguro (fail-open p/ consulta) usado quando a API falha: nunca
  /// bloqueia a operação por falta de resposta — o gate real continua no backend.
  factory SituacaoComercial.desconhecida() => const SituacaoComercial(
        aplicavel: false,
        podeOperar: true,
        podeConsultar: true,
        podeContratar: false,
        assinarContrato: false,
        regularizar: false,
        trialAtivo: false,
        trialExpirado: false,
        mensalidade: 0,
        implantacao: 0,
        implantacaoGratis: true,
        contratoObrigatorio: false,
      );

  static bool _b(dynamic v, {bool fallback = false}) {
    if (v is bool) return v;
    if (v is String) return v == 'true';
    return fallback;
  }

  static double _d(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse(v?.toString() ?? '') ?? 0;
  }

  static int? _i(dynamic v) {
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '');
  }

  factory SituacaoComercial.fromJson(Map<String, dynamic> json) {
    final acoes = (json['acoes'] is Map)
        ? Map<String, dynamic>.from(json['acoes'] as Map)
        : const <String, dynamic>{};
    return SituacaoComercial(
      aplicavel: _b(json['aplicavel'], fallback: true),
      situacao: json['situacao']?.toString(),
      motivo: json['motivo']?.toString(),
      // Preferimos os campos de conveniência do backend; caímos em `acoes` se ausentes.
      podeOperar: json.containsKey('pode_operar')
          ? _b(json['pode_operar'], fallback: true)
          : _b(acoes['operar_escrita'], fallback: true),
      podeConsultar: json.containsKey('pode_consultar')
          ? _b(json['pode_consultar'], fallback: true)
          : _b(acoes['consultar'], fallback: true),
      podeContratar: json.containsKey('pode_contratar')
          ? _b(json['pode_contratar'])
          : _b(acoes['converter']),
      assinarContrato: _b(acoes['assinar_contrato']),
      regularizar: _b(acoes['regularizar']),
      trialAtivo: _b(json['trial_ativo']),
      trialExpirado: _b(json['trial_expirado']),
      diasRestantes: _i(json['dias_restantes']),
      trialEndsAt: json['trial_ends_at']?.toString(),
      decisaoPosTrial: json['decisao_pos_trial']?.toString(),
      proximaAcao: json['proxima_acao']?.toString(),
      planoNome: json['plano_nome']?.toString(),
      mensalidade: _d(json['mensalidade']),
      implantacao: _d(json['implantacao']),
      implantacaoGratis: _b(json['implantacao_gratis'], fallback: true),
      contratoObrigatorio: _b(json['contrato_obrigatorio']),
      contratoStatus: json['contrato_status']?.toString(),
      motivoBloqueio: json['motivo_bloqueio']?.toString(),
    );
  }

  /// Precisa assinar o contrato agora? (autoridade backend).
  bool get precisaAssinarContrato => assinarContrato;

  /// Rótulo curto para a UI, derivado da situação canônica.
  String get rotulo {
    switch (situacao) {
      case 'trial_ativo':
        return 'Período de teste ativo';
      case 'trial_expirando':
        return 'Teste terminando';
      case 'aguardando_assinatura':
        return 'Assinatura pendente';
      case 'trial_expirado_aguardando_decisao':
        return 'Escolha como continuar';
      case 'trial_encerrado_sem_contratacao':
        return 'Teste encerrado';
      case 'conversao_aguardando_pagamento':
        return 'Pagamento pendente';
      case 'ativa':
        return 'Conta ativa';
      case 'suspensa_financeiramente':
        return 'Conta suspensa';
      case 'bloqueada_administrativamente':
        return 'Conta bloqueada';
      case 'cancelada':
        return 'Conta cancelada';
      default:
        return 'Situação da conta';
    }
  }
}
