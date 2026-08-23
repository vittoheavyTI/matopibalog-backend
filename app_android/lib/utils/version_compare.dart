/// Comparação de versão do app (MOBILE-M1-008 / D-053).
///
/// NUNCA compara versão lexicograficamente — "1.10.0" É MAIOR que "1.9.0".
/// Compara segmento a segmento numericamente, descartando build metadata (`+45`)
/// e pré-release (`-rc1`). Espelha exatamente o contrato do backend
/// (backend/utils/appVersionPolicy.js), coberto por testes nos dois lados.

/// Extrai os segmentos numéricos de uma versão. Retorna `null` quando não há
/// nenhum segmento numérico válido (o chamador decide o fallback seguro).
List<int>? parseVersion(String? value) {
  if (value == null) return null;
  final raw = value.trim();
  if (raw.isEmpty) return null;
  // Remove build metadata e pré-release: "1.2.3+45" / "1.2.3-rc1" -> "1.2.3".
  final core = raw.split('+').first.split('-').first.trim();
  if (core.isEmpty) return null;
  final parts = core.split('.');
  final nums = <int>[];
  for (final part in parts) {
    if (!RegExp(r'^\d+$').hasMatch(part)) return null;
    nums.add(int.parse(part));
  }
  return nums.isEmpty ? null : nums;
}

/// `compareVersions('1.10.0', '1.9.0') == 1`. Retorna -1 | 0 | 1, ou `null`
/// quando qualquer lado não é parseável.
int? compareVersions(String? a, String? b) {
  final va = parseVersion(a);
  final vb = parseVersion(b);
  if (va == null || vb == null) return null;
  final len = va.length > vb.length ? va.length : vb.length;
  for (var i = 0; i < len; i++) {
    final na = i < va.length ? va[i] : 0;
    final nb = i < vb.length ? vb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
