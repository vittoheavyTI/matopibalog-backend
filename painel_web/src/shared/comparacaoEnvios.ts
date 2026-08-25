// Comparação entre dois envios de uma solicitação de transporte.
//
// Vive aqui, e não dentro de uma tela, porque as DUAS pontas precisam da mesma
// resposta: a transportadora, para decidir sobre o reenvio, e o embarcador, para
// entender o que ele mesmo mudou (VIS-09). Duas implementações da mesma
// comparação acabariam divergindo — e divergir aqui significa as duas partes
// lendo histórias diferentes do mesmo pedido.
//
// A saída é texto em linguagem de negócio. Nenhum nome de campo do banco
// aparece: quem lê é o cliente, não quem escreveu o schema.

export type EnvioComparavel = {
  versao: number;
  cargo_name?: string | null;
  destination_name?: string | null;
  quantity_unit?: string | null;
  total_quantidade?: number | null;
  origens: { nome: string; quantidade: number }[];
};

export function formatarQuantidade(valor: number | null | undefined, unidade?: string | null): string {
  if (valor === null || valor === undefined) return '—';
  const n = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(valor);
  return `${n} ${unidade === 'kg' ? 'kg' : 't'}`;
}

// `anterior` é o envio mais antigo e `atual` o mais novo — nesta ordem. Trocar
// os dois inverte a narrativa ("aumentou" vira "diminuiu"), então quem chama
// precisa ser explícito sobre qual é qual.
export function diferencasEntreEnvios(
  anterior: EnvioComparavel | null,
  atual: EnvioComparavel | null,
): string[] {
  if (!anterior || !atual) return [];
  const mudancas: string[] = [];

  if (anterior.cargo_name !== atual.cargo_name) {
    mudancas.push(`Carga: "${anterior.cargo_name}" → "${atual.cargo_name}"`);
  }
  if (anterior.destination_name !== atual.destination_name) {
    mudancas.push(`Destino: "${anterior.destination_name}" → "${atual.destination_name}"`);
  }
  if (anterior.total_quantidade !== atual.total_quantidade) {
    mudancas.push(
      `Quantidade total: ${formatarQuantidade(anterior.total_quantidade, anterior.quantity_unit)}`
      + ` → ${formatarQuantidade(atual.total_quantidade, atual.quantity_unit)}`,
    );
  }

  const antes = new Map(anterior.origens.map((o) => [o.nome, o.quantidade]));
  const depois = new Map(atual.origens.map((o) => [o.nome, o.quantidade]));

  for (const [nome, q] of depois) {
    if (!antes.has(nome)) {
      mudancas.push(`Local incluído: ${nome} (${formatarQuantidade(q, atual.quantity_unit)})`);
    } else if (antes.get(nome) !== q) {
      mudancas.push(
        `${nome}: ${formatarQuantidade(antes.get(nome) ?? null, anterior.quantity_unit)}`
        + ` → ${formatarQuantidade(q, atual.quantity_unit)}`,
      );
    }
  }
  for (const nome of antes.keys()) {
    if (!depois.has(nome)) mudancas.push(`Local removido: ${nome}`);
  }

  return mudancas;
}
