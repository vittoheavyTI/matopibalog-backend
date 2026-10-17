class PlanoPublico {
  final String id;
  final String nome;
  final String descricao;
  final double precoMensal;
  final int? limiteMotoristas;
  final int? diasTrial;
  final double valorImplantacao;
  final List<String> recursos;

  const PlanoPublico({
    required this.id,
    required this.nome,
    required this.descricao,
    required this.precoMensal,
    required this.limiteMotoristas,
    required this.diasTrial,
    required this.valorImplantacao,
    required this.recursos,
  });

  factory PlanoPublico.fromJson(Map<String, dynamic> json) {
    final precoRaw = json['preco_mensal'];
    final limiteRaw = json['limite_motoristas'];
    final trialRaw = json['dias_trial'];
    final recursosRaw = json['recursos'];

    return PlanoPublico(
      id: json['id']?.toString() ?? '',
      nome: json['nome']?.toString() ?? 'Plano',
      descricao: json['descricao']?.toString() ?? '',
      precoMensal: precoRaw is num
          ? precoRaw.toDouble()
          : double.tryParse(precoRaw?.toString() ?? '') ?? 0,
      limiteMotoristas: limiteRaw is num
          ? limiteRaw.toInt()
          : int.tryParse(limiteRaw?.toString() ?? ''),
      diasTrial: trialRaw is num
          ? trialRaw.toInt()
          : int.tryParse(trialRaw?.toString() ?? ''),
      valorImplantacao: json['valor_implantacao'] is num
          ? (json['valor_implantacao'] as num).toDouble()
          : double.tryParse(json['valor_implantacao']?.toString() ?? '') ?? 0,
      recursos: recursosRaw is List
          ? recursosRaw
              .map((recurso) => recurso.toString().trim())
              .where((recurso) => recurso.isNotEmpty)
              .toList()
          : const [],
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'nome': nome,
        'descricao': descricao,
        'preco_mensal': precoMensal,
        'limite_motoristas': limiteMotoristas,
        'dias_trial': diasTrial,
        'valor_implantacao': valorImplantacao,
        'recursos': recursos,
      };
}
