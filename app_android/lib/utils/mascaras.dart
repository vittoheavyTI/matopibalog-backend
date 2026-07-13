import 'package:flutter/services.dart';

/// Máscaras de entrada reutilizáveis do app (CPF, CNPJ, Documento CPF/CNPJ,
/// telefone/celular e placa). Implementadas apenas com [TextInputFormatter]
/// nativo — sem dependência externa.
///
/// Regra geral: a máscara altera só a EXIBIÇÃO. Quem envia ao backend deve
/// continuar removendo os separadores com `replaceAll(RegExp(r'\D'), '')`
/// (documentos/telefone). A placa é enviada em maiúsculas como digitada.
///
/// Espelha os formatos de painel_web/src/utils/masks.ts para paridade web↔app.

/// Mantém só dígitos de [texto].
String apenasDigitos(String texto) => texto.replaceAll(RegExp(r'\D'), '');

/// Formata CPF: `000.000.000-00` (máx. 11 dígitos).
String formatarCpf(String valor) {
  final d = apenasDigitos(valor);
  final n = d.length > 11 ? d.substring(0, 11) : d;
  final b = StringBuffer();
  for (var i = 0; i < n.length; i++) {
    if (i == 3 || i == 6) b.write('.');
    if (i == 9) b.write('-');
    b.write(n[i]);
  }
  return b.toString();
}

/// Formata CNPJ: `00.000.000/0000-00` (máx. 14 dígitos).
String formatarCnpj(String valor) {
  final d = apenasDigitos(valor);
  final n = d.length > 14 ? d.substring(0, 14) : d;
  final b = StringBuffer();
  for (var i = 0; i < n.length; i++) {
    if (i == 2 || i == 5) b.write('.');
    if (i == 8) b.write('/');
    if (i == 12) b.write('-');
    b.write(n[i]);
  }
  return b.toString();
}

/// Formata Documento dinâmico: até 11 dígitos usa CPF; acima, CNPJ.
String formatarDocumento(String valor) {
  final d = apenasDigitos(valor);
  return d.length <= 11 ? formatarCpf(d) : formatarCnpj(d);
}

/// Formata telefone/celular: `(00) 0000-0000` (10 díg.) ou
/// `(00) 00000-0000` (11 díg.).
String formatarTelefone(String valor) {
  final d0 = apenasDigitos(valor);
  final n = d0.length > 11 ? d0.substring(0, 11) : d0;
  if (n.isEmpty) return '';
  final b = StringBuffer('(');
  for (var i = 0; i < n.length; i++) {
    if (i == 2) b.write(') ');
    // Hífen: após o 4º dígito em fixo (10 díg.), após o 5º em celular (11 díg.).
    if ((n.length <= 10 && i == 6) || (n.length >= 11 && i == 7)) b.write('-');
    b.write(n[i]);
  }
  return b.toString();
}

/// Formata placa: maiúsculas, só letras/números, máx. 7 caracteres.
/// Insere hífen apenas no padrão antigo (AAA-0000), quando já dá para
/// distingui-lo do Mercosul (AAA0A00). Enquanto ambíguo, não insere.
String formatarPlaca(String valor) {
  var s = valor.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
  if (s.length > 7) s = s.substring(0, 7);
  // Padrão antigo detectável: 3 letras seguidas de dígito na 4ª e 5ª posições.
  final antigo = s.length >= 5 &&
      RegExp(r'^[A-Z]{3}$').hasMatch(s.substring(0, 3)) &&
      RegExp(r'^\d$').hasMatch(s[3]) &&
      RegExp(r'^\d$').hasMatch(s[4]);
  if (antigo) {
    return '${s.substring(0, 3)}-${s.substring(3)}';
  }
  return s;
}

/// Normaliza a placa para persistência: maiúsculas, só letras/números
/// (remove hífen e espaços). O hífen é só decoração visual da máscara —
/// o valor gravado permanece estável (ex.: `ABC-1234` → `ABC1234`).
String normalizarPlaca(String valor) =>
    valor.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');

/// [TextInputFormatter] genérico que aplica uma função de formatação e
/// reposiciona o cursor no fim do texto formatado.
class _FormatadorTexto extends TextInputFormatter {
  const _FormatadorTexto(this.formatar);
  final String Function(String) formatar;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final texto = formatar(newValue.text);
    return TextEditingValue(
      text: texto,
      selection: TextSelection.collapsed(offset: texto.length),
    );
  }
}

/// Formatters prontos para uso em `inputFormatters:`.
class Mascaras {
  Mascaras._();

  static const TextInputFormatter cpf = _FormatadorTexto(formatarCpf);
  static const TextInputFormatter cnpj = _FormatadorTexto(formatarCnpj);
  static const TextInputFormatter documento = _FormatadorTexto(formatarDocumento);
  static const TextInputFormatter telefone = _FormatadorTexto(formatarTelefone);
  static const TextInputFormatter placa = _FormatadorTexto(formatarPlaca);
}
