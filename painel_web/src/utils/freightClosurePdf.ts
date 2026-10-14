// painel_web/src/utils/freightClosurePdf.ts
// Gerador do Relatório de Fechamento de Frete (Produto Operacional V1)

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
  formatarStatusEnvelope,
  formatarToneladas,
} from './reportingFormatters';

export interface RelatorioFechamentoPayload {
  frete: {
    id: string;
    empresa_id: string;
    motorista_id: string;
    status: string;
    data: string;
    origem: string;
    destino: string;
    km_inicial?: number | null;
    km_final?: number | null;
    distancia_km?: number | null;
    modalidade_calculo?: string;
    toneladas?: number | null;
    valor_tonelada_km?: number | null;
    valor_frete?: number | null;
    quem_recebeu?: string | null;
    foto_odometro_inicial_presente?: boolean;
    foto_odometro_final_presente?: boolean;
  };
  motorista: {
    id: string;
    nome: string;
    placa?: string;
    tipo_empresa?: string;
  };
  lancamentos: {
    despesas: Array<{
      id: string;
      descricao: string;
      tipo: string;
      valor: number | null;
      status: string;
      quem_pagou: string;
    }>;
    abastecimentos: Array<{
      id: string;
      posto: string;
      litros: number;
      arla_litros?: number;
      arla_valor?: number | null;
      valor_total: number | null;
      status: string;
      quem_pagou: string;
    }>;
    vales: Array<{
      id: string;
      descricao: string;
      valor: number | null;
      status: string;
      quem_pagou: string;
    }>;
  };
  documentos_fiscais: {
    total?: number | null;
    tipos: Array<{ tipo: string; status: string }>;
    restricted?: boolean;
  };
  epod?: {
    id: string;
    status: string;
    entregue_em?: string;
    recebedor_nome?: string;
  } | null;
  envelope: {
    status: string;
    detalhes?: {
      id: string;
      envelope_type: string;
      schema_version: string;
      sealed_at: string;
      envelope_hash: string;
      reason: string;
    } | null;
  };
  resumo_financeiro: {
    restricted?: boolean;
    message?: string;
    receita_realizada?: number | null;
    frete_bruto?: number | null;
    custos_diretos?: {
      combustivel?: number;
      pedagio?: number;
      outras_despesas?: number;
      comissao?: number;
      total?: number;
    } | null;
    total_despesas_efetivadas?: number | null;
    total_abastecimentos_efetivados?: number | null;
    total_vales_efetivados?: number | null;
    resultado_operacional?: number | null;
    margem_percentual?: number | null;
    comissao_percentual?: number | null;
    comissao_valor?: number | null;
    saldo_motorista?: number | null;
    saldo_motorista_situacao?: string | null;
    motorista_creditos?: number | null;
    motorista_debitos?: number | null;
    total_pendente?: number | null;
    tem_pendentes?: boolean;
    is_autonomo?: boolean;
    alertas?: string[];
    dados_completos?: boolean;
  };
  gerado_em?: string;
}

export interface GerarPdfFechamentoResult {
  ok: boolean;
  doc?: jsPDF;
  filename?: string;
  error?: string;
}

export function obterNomeArquivoFechamento(freteId: string, dataEmissao?: Date): string {
  const shortId = String(freteId || 'frete').slice(0, 8);
  const dataStr = formatarData(dataEmissao || new Date(), 'yyyyMMdd_HHmm');
  return `relatorio-fechamento-frete-${shortId}-${dataStr}.pdf`;
}

export async function gerarPdfFechamentoFrete(
  data: RelatorioFechamentoPayload,
  opcoes: { autoSave?: boolean } = { autoSave: true }
): Promise<GerarPdfFechamentoResult> {
  if (!data || !data.frete) {
    return { ok: false, error: 'Dados do frete ausentes para gerar o relatório.' };
  }

  const frete = data.frete;
  const motorista = data.motorista || { nome: 'Não informado', placa: '-' };
  const lancamentos = data.lancamentos || { despesas: [], abastecimentos: [], vales: [] };
  const resumo = data.resumo_financeiro || {};
  const dataEmissao = data.gerado_em ? new Date(data.gerado_em) : new Date();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // 1. Branding per-tenant
  await desenharBrandingRelatorio(doc, { geradoEm: dataEmissao });

  // 2. Cabeçalho do Relatório Operacional
  doc.setFontSize(14).setFont('helvetica', 'bold').setTextColor(15, 23, 42);
  doc.text('RELATÓRIO DE FECHAMENTO DE FRETE', 14, 34);

  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(71, 85, 105);
  doc.text(
    'Consolidado operacional e financeiro da viagem (Produto Operacional RBV9-INV-091)',
    14,
    39
  );

  // Aviso explícito de distinção em relação ao Envelope Digital
  doc.setFontSize(7).setFont('helvetica', 'italic').setTextColor(100, 116, 139);
  doc.text(
    'Nota: Este é um relatório operacional consolidado. Para evidência probatória selada e imutável, consulte o Envelope Digital formal.',
    14,
    43
  );

  // 3. Tabela 1: Identificação do Frete e Rota
  autoTable(doc, {
    startY: 47,
    head: [['Identificação da Viagem', 'Dados']],
    body: [
      ['Frete ID', frete.id],
      ['Data de Cadastro', formatarData(frete.data)],
      ['Origem e Destino', `${frete.origem || '-'}  ➔  ${frete.destino || '-'}`],
      ['Motorista', `${motorista.nome} (Placa: ${motorista.placa || '-'})`],
      ['Status Operacional', formatarStatusFrete(frete.status)],
      ['Modalidade de Cálculo', formatarModalidadeCalculo(frete.modalidade_calculo)],
      ['Carga Transportada', formatarToneladas(frete.toneladas)],
      ['Situação do Envelope Formal', formatarStatusEnvelope(data.envelope?.status)],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold', textColor: [30, 41, 59] } },
  });

  // 4. Tabela 2: Quilometragem e Desempenho
  let yPos = (doc as any).lastAutoTable?.finalY || 85;

  autoTable(doc, {
    startY: yPos + 4,
    head: [['Quilometragem e Odômetro', 'Valores']],
    body: [
      ['KM Inicial', formatarKm(frete.km_inicial)],
      ['KM Final', formatarKm(frete.km_final)],
      ['Distância Total', formatarKm(frete.distancia_km)],
      ['Foto Odômetro Inicial', frete.foto_odometro_inicial_presente ? 'Anexada' : 'Pendente / Não enviada'],
      ['Foto Odômetro Final', frete.foto_odometro_final_presente ? 'Anexada' : 'Pendente / Não enviada'],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold', textColor: [30, 41, 59] } },
  });

  yPos = (doc as any).lastAutoTable?.finalY || 120;

  // 5. Tabela 3: Lançamentos de Abastecimento (se houver)
  const abs = lancamentos.abastecimentos || [];
  if (abs.length > 0) {
    const totalLitros = abs.reduce((s, a) => s + (Number(a.litros) || 0), 0);

    autoTable(doc, {
      startY: yPos + 4,
      head: [['Abastecimento', 'Litros', 'ARLA', 'Quem Pagou', 'Status', 'Valor']],
      body: abs.map((a) => [
        a.posto || '-',
        `${Number(a.litros || 0).toFixed(1)} L`,
        a.arla_litros ? `${Number(a.arla_litros).toFixed(1)} L (${formatarMoeda(a.arla_valor)})` : '-',
        a.quem_pagou === 'motorista' ? 'Motorista' : a.quem_pagou === 'proprietario' ? 'Proprietário' : (a.quem_pagou || '-'),
        a.status || '-',
        formatarMoeda(a.valor_total),
      ]),
      foot: [
        [
          'TOTAL ABASTECIMENTOS EFETIVADOS',
          `${totalLitros.toFixed(1)} L`,
          '-',
          '-',
          '-',
          resumo.total_abastecimentos_efetivados != null
            ? formatarMoeda(resumo.total_abastecimentos_efetivados)
            : (resumo.restricted ? '[Restrito]' : '-'),
        ],
      ],
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    });
    yPos = (doc as any).lastAutoTable?.finalY || yPos;
  }

  // 6. Tabela 4: Despesas Operacionais (se houver)
  const desp = lancamentos.despesas || [];
  if (desp.length > 0) {
    autoTable(doc, {
      startY: yPos + 4,
      head: [['Despesa', 'Tipo', 'Quem Pagou', 'Status', 'Valor']],
      body: desp.map((d) => [
        d.descricao || '-',
        d.tipo || '-',
        d.quem_pagou === 'motorista' ? 'Motorista' : d.quem_pagou === 'proprietario' ? 'Proprietário' : (d.quem_pagou || '-'),
        d.status || '-',
        formatarMoeda(d.valor),
      ]),
      foot: [
        [
          'TOTAL DESPESAS EFETIVADAS',
          '-',
          '-',
          '-',
          resumo.total_despesas_efetivadas != null
            ? formatarMoeda(resumo.total_despesas_efetivadas)
            : (resumo.restricted ? '[Restrito]' : '-'),
        ],
      ],
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [225, 29, 72], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    });
    yPos = (doc as any).lastAutoTable?.finalY || yPos;
  }

  // 7. Tabela 5: Vales e Adiantamentos (se houver)
  const vales = lancamentos.vales || [];
  if (vales.length > 0) {
    autoTable(doc, {
      startY: yPos + 4,
      head: [['Vale / Adiantamento', 'Quem Concedeu', 'Status', 'Valor']],
      body: vales.map((v) => [
        v.descricao || 'Vale viagem',
        v.quem_pagou === 'proprietario' ? 'Proprietário' : v.quem_pagou === 'motorista' ? 'Motorista' : (v.quem_pagou || '-'),
        v.status || '-',
        formatarMoeda(v.valor),
      ]),
      foot: [
        [
          'TOTAL VALES EFETIVADOS',
          '-',
          '-',
          resumo.total_vales_efetivados != null
            ? formatarMoeda(resumo.total_vales_efetivados)
            : (resumo.restricted ? '[Restrito]' : '-'),
        ],
      ],
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [234, 88, 12], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    });
    yPos = (doc as any).lastAutoTable?.finalY || yPos;
  }

  // 8. Tabela 6: Documentos Fiscais e Comprovação Digital (ePOD)
  const docsTotal = data.documentos_fiscais?.total ?? (data.documentos_fiscais?.restricted ? null : 0);
  const epod = data.epod;

  autoTable(doc, {
    startY: yPos + 4,
    head: [['Documentos Fiscais e Comprovação de Entrega (ePOD)', 'Situação']],
    body: [
      [
        'Documentos Fiscais Vinculados',
        data.documentos_fiscais?.restricted
          ? 'Informações de documentos fiscais restritas (documents.view ausente)'
          : docsTotal && docsTotal > 0
            ? `${docsTotal} documento(s) fiscal(is) anexado(s) (${(data.documentos_fiscais.tipos || []).map(t => t.tipo.toUpperCase()).join(', ')})`
            : 'Nenhum documento fiscal vinculado',
      ],
      [
        'Comprovação de Entrega Digital (ePOD)',
        epod
          ? `Status: ${epod.status} | Recebido por: ${epod.recebedor_nome || 'Não informado'} em ${formatarDataHora(epod.entregue_em)}`
          : 'Nenhum registro de ePOD associado a esta viagem',
      ],
      [
        'Selo Digital de Fechamento Formal',
        data.envelope?.status === 'FORMAL_ENVELOPE_SEALED'
          ? `Selado formalmente em ${formatarDataHora(data.envelope.detalhes?.sealed_at)} (Hash: ${data.envelope.detalhes?.envelope_hash?.slice(0, 16)}...)`
          : data.envelope?.status === 'LEGACY_NO_FORMAL_ENVELOPE'
            ? 'Frete legado sem envelope formal'
            : 'Pendente de encerramento formal',
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 65, fontStyle: 'bold', textColor: [30, 41, 59] } },
  });

  yPos = (doc as any).lastAutoTable?.finalY || yPos;

  // 9. Tabela 7: Resumo Financeiro da Viagem
  if (resumo.restricted) {
    autoTable(doc, {
      startY: yPos + 4,
      head: [['Resumo Financeiro da Viagem', 'Situação']],
      body: [['Valores e Apuração', resumo.message || 'Informações financeiras restritas para o seu nível de acesso.']],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 65, fontStyle: 'bold' } },
    });
  } else {
    const linhasResumo: Array<[string, string]> = [];

    // Faturamento / Receita realizada
    if (resumo.receita_realizada !== null && resumo.receita_realizada !== undefined) {
      linhasResumo.push(['Receita Realizada (Frete)', formatarMoeda(resumo.receita_realizada)]);
    } else if (resumo.frete_bruto !== null && resumo.frete_bruto !== undefined) {
      linhasResumo.push(['Valor do Frete (Base)', formatarMoeda(resumo.frete_bruto)]);
    } else {
      linhasResumo.push(['Receita do Frete', '[Restrito]']);
    }

    // Comissão do motorista (se houver ou se aplicável)
    if (resumo.is_autonomo) {
      linhasResumo.push(['Comissão do Motorista', 'Não aplicável (Autônomo)']);
    } else if (resumo.comissao_valor !== null && resumo.comissao_valor !== undefined) {
      linhasResumo.push([
        `Comissão do Motorista (${resumo.comissao_percentual ?? 0}%)`,
        formatarMoeda(resumo.comissao_valor),
      ]);
    } else {
      linhasResumo.push(['Comissão do Motorista', '[Restrito]']);
    }

    // Acerto do motorista (créditos, débitos, saldo)
    if (resumo.saldo_motorista !== null && resumo.saldo_motorista !== undefined) {
      if (resumo.motorista_creditos != null && resumo.motorista_debitos != null) {
        linhasResumo.push(['Créditos do Motorista (Comissão + Reembolsos)', formatarMoeda(resumo.motorista_creditos)]);
        linhasResumo.push(['Débitos do Motorista (Vales/Adiantamentos)', formatarMoeda(resumo.motorista_debitos)]);
      }
      linhasResumo.push([
        'SALDO DO MOTORISTA (ACERTO)',
        `${formatarMoeda(resumo.saldo_motorista)} (${resumo.saldo_motorista_situacao || 'Saldo'})`,
      ]);
    } else {
      linhasResumo.push(['SALDO DO MOTORISTA', '[Restrito]']);
    }

    // Custos diretos e Resultado Operacional (somente se autorizados)
    if (resumo.custos_diretos?.total !== null && resumo.custos_diretos?.total !== undefined) {
      linhasResumo.push(['Total de Custos Diretos Operacionais', formatarMoeda(resumo.custos_diretos.total)]);
    } else if (resumo.total_despesas_efetivadas != null && resumo.total_abastecimentos_efetivados != null) {
      linhasResumo.push(['Despesas e Abastecimentos Efetivados', formatarMoeda(resumo.total_despesas_efetivadas + resumo.total_abastecimentos_efetivados)]);
    }

    if (resumo.resultado_operacional !== null && resumo.resultado_operacional !== undefined) {
      const margemStr = resumo.margem_percentual != null ? ` (Margem: ${resumo.margem_percentual}%)` : '';
      linhasResumo.push(['RESULTADO OPERACIONAL', `${formatarMoeda(resumo.resultado_operacional)}${margemStr}`]);
    }

    if (resumo.tem_pendentes && resumo.total_pendente) {
      linhasResumo.push(['Lançamentos Pendentes (Informativo, não compõe saldo)', formatarMoeda(resumo.total_pendente)]);
    }

    autoTable(doc, {
      startY: yPos + 4,
      head: [['Resumo Financeiro e Apuração da Viagem', 'Valor']],
      body: linhasResumo,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 75, fontStyle: 'bold', textColor: [30, 41, 59] } },
    });
  }

  // 10. Rodapé de Paginação em todas as páginas
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);

    doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(100, 116, 139);
    doc.text(
      'Relatório Operacional de Viagem — Matopiba Log Gestão de Frotas',
      14,
      pageHeight - 9
    );

    doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 9, { align: 'right' });
  }

  const filename = obterNomeArquivoFechamento(frete.id, dataEmissao);

  if (opcoes.autoSave !== false) {
    doc.save(filename);
  }

  return { ok: true, doc, filename };
}
