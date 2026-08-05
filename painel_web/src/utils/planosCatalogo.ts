// Tipos e helpers PUROS do catálogo público de planos, compartilhados entre a
// vitrine de upgrade (PlanosPublicos), o cadastro público (CadastroPublico) e o
// componente de cards (PlanosVitrine). Ficam fora do arquivo do componente para
// não quebrar o fast-refresh (um .tsx de componente só deve exportar componentes)
// e para centralizar ordem/rótulos, evitando divergência entre as telas.

export interface FuncionalidadeCard {
  codigo: string;
  texto: string;
  rotulo: 'Incluído' | 'Adicional' | 'Em breve' | 'Sob consulta';
  destaque?: boolean;
}

export interface PlanoPublico {
  id: string;
  nome: string;
  descricao: string;
  // Valor FINAL cobrado, em qualquer modelo — é sempre ele o headline do card.
  preco_mensal: number;
  modelo_cobranca: 'fixo' | 'por_motorista';
  preco_por_motorista: number | null;
  limite_motoristas: number | null;
  dias_trial: number | null;
  recursos: string[];
  // Catálogo estruturado (PR 2C): quando presente, os cards usam isto em vez de
  // `recursos` (texto livre). Rótulo: Incluído | Adicional | Em breve | Sob consulta.
  funcionalidades?: FuncionalidadeCard[];
  capacidade_inclusa?: number | null;
  preco_motorista_extra?: number | null;
  valor_implantacao?: number | null;
  // Plano "sob negociação" (41+): sem preço de tabela, fora do self-service.
  requer_negociacao?: boolean;
}

// Defesa extra: o backend já normaliza `recursos` para array de strings.
export function normalizarRecursos(recursos: unknown): string[] {
  if (Array.isArray(recursos)) return recursos.map((r) => String(r).trim()).filter(Boolean);
  if (typeof recursos === 'string' && recursos.trim()) {
    const s = recursos.trim();
    if (s.startsWith('[')) {
      try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map((r) => String(r).trim()).filter(Boolean); } catch { /* split abaixo */ }
    }
    return s.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
  }
  return [];
}

export function limiteLabel(limite: number | null): string {
  if (limite == null) return 'Motoristas ilimitados';
  return `Até ${limite} motorista${limite === 1 ? '' : 's'}`;
}

// Composição do preço — subtítulo, nunca headline. Só existe em plano por
// motorista; plano fixo devolve null e o card fica idêntico. O valor em destaque
// continua sendo o FINAL: anunciar o unitário grande e cobrar o total seria
// anunciar um preço e cobrar outro.
export function composicaoLabel(plano: PlanoPublico): string | null {
  if (plano.modelo_cobranca !== 'por_motorista') return null;
  if (plano.preco_por_motorista == null || plano.limite_motoristas == null) return null;
  const motoristas = `${plano.limite_motoristas} motorista${plano.limite_motoristas === 1 ? '' : 's'}`;
  return `${motoristas} × R$ ${plano.preco_por_motorista.toFixed(2)}`;
}

// Ordenação da vitrine: planos self-service (automáticos) primeiro, por preço
// crescente; planos "sob negociação" (Enterprise, sem preço de tabela) SEMPRE
// por último — nunca no topo só porque o preço de tabela vem 0.
export function ordenarVitrine(lista: PlanoPublico[]): PlanoPublico[] {
  return [...lista].sort((a, b) => {
    const na = a.requer_negociacao ? 1 : 0;
    const nb = b.requer_negociacao ? 1 : 0;
    if (na !== nb) return na - nb; // negociação sempre depois dos automáticos
    return (a.preco_mensal || 0) - (b.preco_mensal || 0); // preço crescente
  });
}

// Primeiro plano self-service (não-negociação), na ordem da vitrine. Base para o
// default de seleção no cadastro — nunca cai sobre o Enterprise.
export function primeiroPlanoSelfService(lista: PlanoPublico[]): PlanoPublico | null {
  return ordenarVitrine(lista).find((p) => !p.requer_negociacao) || null;
}
