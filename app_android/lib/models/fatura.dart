/// Fatura da própria empresa (autônomo), como retornada pelo endpoint read-only
/// GET /pagamentos/me/faturas. Espelha a whitelist do backend — NÃO há campos
/// sensíveis (asaas_id, pix_qr_code, etc.); o QR Pix é buscado sob demanda em
/// outra rota (PR futuro).
///
/// fromJson tolerante: valores numéricos podem vir como num ou String (JSON de
/// billing às vezes serializa decimais como texto); campos ausentes/null viram
/// vazio/null sem lançar.
class Fatura {
  final String id;
  final double valor;
  final String tipoPagamento;
  final String status;
  final String? dueDate;
  final String? pagoEm;
  final String? invoiceUrl;
  final String? bankSlipUrl;
  final String? periodoReferencia;
  final String? origem;
  final String? planoNomeSnapshot;
  final String? modeloCobrancaSnapshot;
  final String? createdAt;

  const Fatura({
    required this.id,
    required this.valor,
    required this.tipoPagamento,
    required this.status,
    this.dueDate,
    this.pagoEm,
    this.invoiceUrl,
    this.bankSlipUrl,
    this.periodoReferencia,
    this.origem,
    this.planoNomeSnapshot,
    this.modeloCobrancaSnapshot,
    this.createdAt,
  });

  /// String não vazia ou null (trata '', null e espaços em branco como null).
  static String? _str(dynamic v) {
    if (v == null) return null;
    final s = v.toString().trim();
    return s.isEmpty ? null : s;
  }

  factory Fatura.fromJson(Map<String, dynamic> json) {
    final valorRaw = json['valor'];
    return Fatura(
      id: json['id']?.toString() ?? '',
      valor: valorRaw is num
          ? valorRaw.toDouble()
          : double.tryParse(valorRaw?.toString() ?? '') ?? 0.0,
      tipoPagamento: json['tipo_pagamento']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      dueDate: _str(json['due_date']),
      pagoEm: _str(json['pago_em']),
      invoiceUrl: _str(json['invoice_url']),
      bankSlipUrl: _str(json['bank_slip_url']),
      periodoReferencia: _str(json['periodo_referencia']),
      origem: _str(json['origem']),
      planoNomeSnapshot: _str(json['plano_nome_snapshot']),
      modeloCobrancaSnapshot: _str(json['modelo_cobranca_snapshot']),
      createdAt: _str(json['created_at']),
    );
  }

  bool get isRecorrente => origem == 'recorrente';
  bool get isPaga => status == 'pago';
}
