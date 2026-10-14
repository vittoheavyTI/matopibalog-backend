// painel_web/src/utils/reportingFormatters.ts
// Formatadores centralizados para produtos de relatório (PDF e UI)

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatarMoeda(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '-';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarData(data: any, formato = 'dd/MM/yyyy'): string {
  if (!data) return '-';
  if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.trim())) {
    const [ano, mes, dia] = data.trim().split('-');
    if (formato === 'dd/MM/yyyy') {
      return `${dia}/${mes}/${ano}`;
    }
  }
  try {
    const d = new Date(data);
    if (isNaN(d.getTime())) return '-';
    return format(d, formato, { locale: ptBR });
  } catch {
    return '-';
  }
}

export function formatarDataHora(data: any): string {
  return formatarData(data, 'dd/MM/yyyy HH:mm');
}

export function formatarKm(km: number | string | null | undefined): string {
  if (km === null || km === undefined || km === '') return '-';
  const n = Number(km);
  if (!Number.isFinite(n)) return '-';
  return `${n.toLocaleString('pt-BR')} km`;
}

export function formatarToneladas(ton: number | string | null | undefined): string {
  if (ton === null || ton === undefined || ton === '') return '-';
  const n = Number(ton);
  if (!Number.isFinite(n)) return '-';
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} t`;
}

export function formatarModalidadeCalculo(modalidade: string | null | undefined): string {
  if (!modalidade) return '-';
  if (modalidade === 'tonelada_km') return 'Por Tonelada / KM';
  if (modalidade === 'valor_fixo') return 'Valor Fixo';
  return modalidade;
}

export const formatarModalidade = formatarModalidadeCalculo;

export function formatarStatusFrete(status: string | null | undefined): string {
  if (!status) return '-';
  const s = String(status).toLowerCase();
  if (s === 'ativo') return 'Ativo';
  if (s === 'pendente') return 'Pendente';
  if (s === 'finalizado') return 'Finalizado';
  if (s === 'cancelado') return 'Cancelado';
  return status;
}

export function formatarStatusEnvelope(status: string | null | undefined): string {
  if (!status) return 'Não selado';
  if (status === 'FORMAL_ENVELOPE_SEALED') return 'Envelope Digital Selado (Formal)';
  if (status === 'LEGACY_NO_FORMAL_ENVELOPE') return 'Legado (sem envelope formal)';
  if (status === 'NO_FORMAL_ENVELOPE_YET') return 'Pendente de fechamento';
  return status;
}

export function resumirHashIntegridade(hash: string | null | undefined, prefixLen = 8): string {
  if (!hash) return '-';
  const str = String(hash).trim();
  if (str.length <= prefixLen * 2) return str;
  return `${str.slice(0, prefixLen)}...${str.slice(-5)}`;
}

export function sanitizarNomeArquivo(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function gerarNomeArquivoEnvelope(freteId: string, dataHora?: string | null): string {
  const shortId = String(freteId || 'frete').slice(0, 8);
  const dataStr = dataHora ? formatarData(dataHora, 'yyyyMMdd') : format(new Date(), 'yyyyMMdd');
  return `envelope-digital-frete-${shortId}-${dataStr}.pdf`;
}

export function gerarNomeArquivoFechamento(freteId: string, dataHora?: string | null): string {
  const shortId = String(freteId || 'frete').slice(0, 8);
  const dataStr = dataHora ? formatarData(dataHora, 'yyyyMMdd') : format(new Date(), 'yyyyMMdd');
  return `relatorio-fechamento-frete-${shortId}-${dataStr}.pdf`;
}
