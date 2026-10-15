// painel_web/src/utils/formalEnvelopePdf.ts
// Gerador do Envelope Digital Formal em PDF (RBV9-INV-091 / E3.8)

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { desenharBrandingRelatorio } from './relatorioBranding';
import {
  formatarData,
  formatarDataHora,
  formatarKm,
  formatarMoeda,
  formatarModalidadeCalculo,
  formatarStatusFrete,
  formatarToneladas,
} from './reportingFormatters';

export interface EnvelopeDigitalPayload {
  status: string;
  envelope: {
    id: string;
    frete_id: string;
    empresa_id?: string;
    envelope_type?: string;
    schema_version?: string;
    source?: string;
    request_id?: string;
    correlation_id?: string;
    sealed_at?: string;
    envelope_hash?: string;
    reason?: string;
    frete_snapshot?: Record<string, any>;
    financial_snapshot?: Record<string, any>;
    audit_summary?: Record<string, any>;
    metadata?: Record<string, any>;
    payload?: Record<string, any>;
  } | null;
  motorista_nome?: string | null;
  placa?: string | null;
}

export interface GerarPdfEnvelopeResult {
  ok: boolean;
  doc?: jsPDF;
  filename?: string;
  error?: string;
}

export function obterNomeArquivoEnvelope(freteId: string, sealedAt?: string | null): string {
  const shortId = String(freteId || 'frete').slice(0, 8);
  const dataStr = sealedAt ? formatarData(sealedAt, 'yyyyMMdd_HHmm') : 'selado';
  return `envelope-digital-${shortId}-${dataStr}.pdf`;
}

export async function gerarPdfEnvelopeDigital(
  data: EnvelopeDigitalPayload,
  opcoes: { autoSave?: boolean } = { autoSave: true }
): Promise<GerarPdfEnvelopeResult> {
  const envelope = data?.envelope;
  if (!envelope || data.status !== 'FORMAL_ENVELOPE_SEALED') {
    return {
      ok: false,
      error: data?.status === 'LEGACY_NO_FORMAL_ENVELOPE'
        ? 'Frete legado finalizado antes do envelope digital formal (E3.8).'
        : 'Este frete ainda não possui envelope digital formal selado.',
    };
  }

  const payload = envelope.payload || {};
  const frete = envelope.frete_snapshot || payload.frete_snapshot || {};
  const financeiro = envelope.financial_snapshot || payload.financial_snapshot || {};
  const auditSummary = envelope.audit_summary || payload.audit_summary || {};
  const rawHash = envelope.envelope_hash || payload.envelope_hash;
  const hash = rawHash && typeof rawHash === 'string' && rawHash !== 'undefined' && rawHash !== 'null'
    ? rawHash
    : 'Não disponível';
  const sealedDate = envelope.sealed_at || payload.sealed_at || null;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // 1. Cabeçalho de Branding
  await desenharBrandingRelatorio(doc, { geradoEm: sealedDate ? new Date(sealedDate) : new Date() });

  // 2. Título do Documento
  doc.setFontSize(14).setFont('helvetica', 'bold').setTextColor(15, 23, 42);
  doc.text('ENVELOPE DIGITAL FORMAL — FECHAMENTO DE FRETE', 14, 34);

  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(71, 85, 105);
  doc.text(
    'Comprovante oficial imutável de encerramento e integridade do frete (RBV9-INV-091 / E3.8)',
    14,
    39
  );

  // 3. Bloco de Destaque da Chave de Integridade (Hash SHA-256)
  const boxY = 41;
  const boxHeight = 15;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, boxY, 182, boxHeight, 2, 2, 'FD');

  doc.setFontSize(7.5).setFont('helvetica', 'bold').setTextColor(30, 41, 59);
  doc.text('CHAVE DE INTEGRIDADE CRIPTOGRÁFICA (SHA-256):', 18, boxY + 4.5);

  doc.setFontSize(7.5).setFont('courier', 'bold').setTextColor(15, 118, 110);
  doc.text(hash, 18, boxY + 9);

  doc.setFontSize(6.5).setFont('helvetica', 'normal').setTextColor(100, 116, 139);
  const envId = envelope.id && envelope.id !== 'undefined' ? envelope.id : '-';
  const sealedDataStr = sealedDate ? formatarDataHora(sealedDate) : 'Não disponível';
  doc.text(
    `Envelope ID: ${envId}   |   Selado formalmente em: ${sealedDataStr}`,
    18,
    boxY + 13
  );

  // 4. Tabela 1: Identificação do Frete e Rota
  const motoristaNome = data.motorista_nome || (data as any).motorista?.nome || frete.motorista_nome;
  const motoristaId = frete.motorista_id || (data as any).motorista?.id;
  const motoristaExibicao = motoristaNome && motoristaNome !== 'undefined'
    ? `${motoristaNome}${motoristaId && motoristaId !== 'undefined' ? ` (ID: ${String(motoristaId).slice(0, 8)}...)` : ''}`
    : (motoristaId && motoristaId !== 'undefined' ? String(motoristaId) : 'Não informado');
  const placaExibicao = (data.placa && data.placa !== 'undefined')
    ? data.placa
    : ((data as any).motorista?.placa && (data as any).motorista?.placa !== 'undefined'
      ? (data as any).motorista.placa
      : (frete.placa && frete.placa !== 'undefined' ? frete.placa : '-'));

  autoTable(doc, {
    startY: boxY + boxHeight + 3,
    head: [['Identificação e Rota', 'Registro Selado']],
    body: [
      ['Identificador do Frete', envelope.frete_id && envelope.frete_id !== 'undefined' ? envelope.frete_id : (frete.id || '-')],
      ['Data de Cadastro', formatarData(frete.data)],
      ['Rota Operacional', `${frete.origem || '-'} para ${frete.destino || '-'}`],
      ['Motorista Designado', motoristaExibicao],
      ['Placa do Veículo', placaExibicao],
      ['Status no Fechamento', formatarStatusFrete(frete.status || 'finalizado')],
    ],
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', textColor: [30, 41, 59] } },
    margin: { bottom: 15, left: 14, right: 14 },
  });

  // 5. Tabela 2: Quilometragem e Odômetro
  const kmIni = frete.km_inicial ?? financeiro.km_inicial;
  const kmFim = frete.km_final ?? financeiro.km_final;
  const dist = Number.isFinite(Number(kmFim)) && Number.isFinite(Number(kmIni))
    ? Number(kmFim) - Number(kmIni)
    : null;

  const yAposTab1 = (doc as any).lastAutoTable?.finalY || 105;

  autoTable(doc, {
    startY: yAposTab1 + 3,
    head: [['Registro Operacional de KM', 'Valor no Fechamento']],
    body: [
      ['KM Inicial', formatarKm(kmIni)],
      ['KM Final', formatarKm(kmFim)],
      ['Distância Percorrida', formatarKm(dist)],
      [
        'Odômetro Inicial',
        frete.foto_odometro_inicial_path ? 'Foto anexada e arquivada' : 'Não anexado',
      ],
      [
        'Odômetro Final',
        frete.foto_odometro_final_path ? 'Foto anexada e arquivada' : 'Não anexado',
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', textColor: [30, 41, 59] } },
    margin: { bottom: 15, left: 14, right: 14 },
  });

  // 6. Tabela 3: Snapshot Comercial e Financeiro
  const yAposTab2 = (doc as any).lastAutoTable?.finalY || 145;

  const modalidade = financeiro.modalidade_calculo || frete.modalidade_calculo;
  const valorFrete = financeiro.valor_frete ?? frete.valor_frete;
  const toneladas = financeiro.toneladas ?? frete.toneladas;
  const valorTonKm = financeiro.valor_tonelada_km ?? frete.valor_tonelada_km;
  const quemRecebeu = financeiro.quem_recebeu || frete.quem_recebeu;

  const valorFreteTxt = valorFrete !== undefined && valorFrete !== null
    ? formatarMoeda(Number(valorFrete))
    : '[Informação financeira restrita / não autorizada]';

  const tonTxt = toneladas !== undefined && toneladas !== null
    ? formatarToneladas(toneladas)
    : (modalidade === 'tonelada_km' ? '-' : 'N/A (Valor fixo)');

  const valorTonKmTxt = valorTonKm !== undefined && valorTonKm !== null
    ? formatarMoeda(Number(valorTonKm))
    : (modalidade === 'tonelada_km' ? '-' : 'N/A (Valor fixo)');

  const quemRecebeuTxt = quemRecebeu === 'motorista'
    ? 'Motorista'
    : quemRecebeu === 'proprietario'
      ? 'Proprietário'
      : (quemRecebeu || '-');

  autoTable(doc, {
    startY: yAposTab2 + 3,
    head: [['Snapshot Comercial e Financeiro (Selado)', 'Condição Formal']],
    body: [
      ['Modalidade de Cálculo', formatarModalidadeCalculo(modalidade)],
      ['Toneladas Transportadas', tonTxt],
      ['Valor Tonelada / KM', valorTonKmTxt],
      ['Valor Total do Frete', valorFreteTxt],
      ['Quem Recebeu o Frete', quemRecebeuTxt],
    ],
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', textColor: [30, 41, 59] } },
    margin: { bottom: 15, left: 14, right: 14 },
  });

  // 7. Tabela 4: Metadados de Auditoria e Encerramento
  const yAposTab3 = (doc as any).lastAutoTable?.finalY || 185;

  const linhasAuditoria: Array<[string, string]> = [
    ['Motivo Declarado', payload.reason || envelope.reason || 'Encerramento formal de frete'],
    ['Fonte de Finalização', envelope.source || 'backend_finalization'],
    ['Versão do Schema', envelope.schema_version || 'e38.freight_closure.v1'],
  ];

  const reqId = payload.request_id || envelope.request_id || (envelope as any).client_request_id || auditSummary.client_request_id;
  if (reqId && reqId !== '-' && reqId !== 'undefined') {
    linhasAuditoria.push(['Identificador de Requisição', String(reqId)]);
  }

  const corrId = payload.correlation_id || envelope.correlation_id;
  if (corrId && corrId !== '-' && corrId !== 'undefined') {
    linhasAuditoria.push(['Correlação de Auditoria', String(corrId)]);
  }

  if (auditSummary.lancamento_eventos_count != null && String(auditSummary.lancamento_eventos_count) !== '-') {
    linhasAuditoria.push([
      'Eventos de Lançamento no Fechamento',
      String(auditSummary.lancamento_eventos_count),
    ]);
  }

  if (auditSummary.fretes_financeiro_auditoria_count != null && String(auditSummary.fretes_financeiro_auditoria_count) !== '-') {
    linhasAuditoria.push([
      'Eventos Financeiros Auditados',
      String(auditSummary.fretes_financeiro_auditoria_count),
    ]);
  }

  if (auditSummary.historical_completeness && auditSummary.historical_completeness !== '-' && auditSummary.historical_completeness !== 'undefined') {
    linhasAuditoria.push([
      'Classificação de Integridade',
      auditSummary.historical_completeness === 'formal_snapshot'
        ? 'Snapshot Formal Nativo E3.8'
        : String(auditSummary.historical_completeness),
    ]);
  }

  autoTable(doc, {
    startY: yAposTab3 + 3,
    head: [['Governança e Auditoria do Fechamento', 'Referência do Sistema']],
    body: linhasAuditoria,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.5 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', textColor: [30, 41, 59] } },
    margin: { bottom: 15, left: 14, right: 14 },
  });

  // 8. Rodapé em todas as páginas com numeração "Página X de Y" e declaração legal
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);

    doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(100, 116, 139);
    doc.text(
      'Documento de evidência probatória selado via E3.8. Alterações materiais invalidam o hash criptográfico.',
      14,
      pageHeight - 9
    );

    doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 9, { align: 'right' });
  }

  const filename = obterNomeArquivoEnvelope(envelope.frete_id, sealedDate);

  if (opcoes.autoSave !== false) {
    doc.save(filename);
  }

  return { ok: true, doc, filename };
}
