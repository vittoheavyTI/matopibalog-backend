import { erroSanidadeTonKm } from './limitesFrete';

export type FreteOperationalLimitError = {
  error: 'frete_operational_limit';
  field?: string;
  current_value?: number | string;
  max_value?: number | string;
  limit?: string;
  message?: string;
};

export type InlineFreteRecovery = {
  frete: any;
  message: string;
  mostrarEditorCompleto: boolean;
};

const CAMPOS_INLINE_FRETE = new Set(['origem', 'destino']);

export function obterErroLimiteFrete(err: unknown): FreteOperationalLimitError | null {
  const data = (err as any)?.response?.data;
  if (!data || typeof data !== 'object') return null;
  if ((err as any)?.response?.status !== 422) return null;
  if ((data as any).error !== 'frete_operational_limit') return null;
  return data as FreteOperationalLimitError;
}

export function campoFreteEditavelNoInline(field?: string): boolean {
  return Boolean(field && CAMPOS_INLINE_FRETE.has(field));
}

export function labelCampoFrete(field?: string): string {
  const labels: Record<string, string> = {
    valor_tonelada_km: 'Valor por tonelada/km',
    toneladas: 'Toneladas',
    valor_frete: 'Valor do frete',
    km: 'KM',
    km_inicial: 'KM inicial',
    km_final: 'KM final',
  };
  return field ? (labels[field] || field) : 'Campo do frete';
}

const numero = (valor: unknown): number | null => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const brl = (valor: unknown): string => {
  const n = numero(valor);
  if (n === null) return String(valor ?? '-');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
};

export function formatarErroLimiteFrete(data: FreteOperationalLimitError): string {
  const label = labelCampoFrete(data.field);
  const sufixo = data.field === 'valor_tonelada_km' ? '/t·km' : '';
  const atual = data.current_value !== undefined ? `${brl(data.current_value)}${sufixo}` : null;
  const max = data.max_value !== undefined ? `${brl(data.max_value)}${sufixo}` : data.limit || null;

  return [
    'Não foi possível salvar este frete.',
    `Campo incompatível com as regras atuais: ${label}.`,
    atual ? `Valor atual: ${atual}.` : null,
    max ? `Limite operacional atual: ${max}.` : null,
    'Este é um registro legado.',
    'Use "Editar frete completo" para corrigir somente se souber o valor comercial correto.',
  ].filter(Boolean).join('\n');
}

export function montarRecuperacaoInlineFrete(
  fretes: any[],
  id: string,
  dadosEditados: any,
  limite: FreteOperationalLimitError,
): InlineFreteRecovery {
  const freteAlvo = fretes.find((frete: any) => frete.id === id) || { id, ...dadosEditados };
  return {
    frete: freteAlvo,
    message: formatarErroLimiteFrete(limite),
    mostrarEditorCompleto: !campoFreteEditavelNoInline(limite.field),
  };
}

export function freteTonKmIncompativelAtual(frete: any): boolean {
  if (!frete || (frete.modalidade_calculo || 'valor_fixo') !== 'tonelada_km') return false;
  return Boolean(erroSanidadeTonKm({
    toneladas: frete.toneladas,
    valorToneladaKm: frete.valor_tonelada_km,
    kmInicial: frete.km_inicial ?? frete.kmInicial,
    kmFinal: frete.km_final ?? frete.kmFinal,
  }));
}
