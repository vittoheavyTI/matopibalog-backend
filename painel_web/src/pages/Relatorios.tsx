import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatCurrency } from '../utils';
import { Calendar, FileText, Users, User, Download, Filter, Truck } from 'lucide-react';
import api from '../api';

// Carrega a logo (data URL do localStorage) e calcula dimensões preservando o aspecto real.
// Evita o esticamento: antes o addImage usava naturalWidth=0 (imagem ainda não decodificada)
// e caía no fallback de caixa fixa 35x20.
const loadLogoDims = (dataUrl: string, maxW = 35, maxH = 20): Promise<{ w: number; h: number }> =>
  new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const nw = img.naturalWidth || maxW;
        const nh = img.naturalHeight || maxH;
        const ratio = Math.min(maxW / nw, maxH / nh);
        resolve({ w: nw * ratio, h: nh * ratio });
      };
      img.onerror = () => resolve({ w: maxW, h: maxH });
      img.src = dataUrl;
    } catch { resolve({ w: maxW, h: maxH }); }
  });

export const Relatorios: React.FC = () => {
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [selectedMot, setSelectedMot] = useState<string>('todos');
  const [reportType, setReportType] = useState<'individual' | 'mensal' | 'anual' | 'personalizado'>('mensal');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [startDate, setStartDate] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  const [fretes, setFretes] = useState<any[]>([]);
  const [despesas, setDespesas] = useState<any[]>([]);
  const [abastecimentos, setAbastecimentos] = useState<any[]>([]);
  const [vales, setVales] = useState<any[]>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedTripIds, setSelectedTripIds] = useState<string[]>([]);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);

  useEffect(() => {
    const fetchMotoristas = async () => {
      try {
        const response = await api.get('/admin/motoristas');
        setMotoristas((response.data || []).map((m: any) => ({
          uid: m.id,
          nomeCompleto: m.usuarios.nome,
          percentualComissao: m.percentual_comissao,
          empresaTipo: m.empresa_tipo
        })));
      } catch (err) {
        console.error('Erro ao buscar motoristas:', err);
      }
    };
    fetchMotoristas();
  }, []);

  const loadReportData = async () => {
    let start: Date;
    let end: Date;

    if (reportType === 'mensal') {
      const date = new Date(selectedDate + '-01T12:00:00');
      start = startOfMonth(date);
      end = endOfMonth(date);
    } else if (reportType === 'anual') {
      const year = parseInt(selectedDate.split('-')[0]);
      const date = new Date(year, 0, 1);
      start = startOfYear(date);
      end = endOfYear(date);
    } else {
      start = new Date(startDate + 'T00:00:00');
      end = new Date(endDate + 'T23:59:59');
    }
    const sIso = start.toISOString();
    const eIso = end.toISOString();

    setLoadingData(true);
    try {
      let fUrl = '/fretes?data_inicio=' + sIso + '&data_fim=' + eIso;
      let dUrl = '/despesas?data_inicio=' + sIso + '&data_fim=' + eIso;
      let aUrl = '/abastecimentos?data_inicio=' + sIso + '&data_fim=' + eIso;
      let vUrl = '/vales?data_inicio=' + sIso + '&data_fim=' + eIso;

      if (selectedMot !== 'todos') {
        fUrl += '&motorista_id=' + selectedMot;
        dUrl += '&motorista_id=' + selectedMot;
        aUrl += '&motorista_id=' + selectedMot;
        vUrl += '&motorista_id=' + selectedMot;
      }

      const [resF, resD, resA, resV] = await Promise.all([
        api.get(fUrl),
        api.get(dUrl),
        api.get(aUrl),
        api.get(vUrl)
      ]);

      setFretes((resF.data || []).map((f: any) => ({
        id: f.id,
        motoristaUid: f.motorista_id,
        motoristaNome: f.motoristas?.usuarios?.nome || 'N/A',
        placa: f.placa,
        origem: f.origem,
        destino: f.destino,
        valorFrete: parseFloat(f.valor_frete),
        quemRecebeu: f.quem_recebeu,
        km_inicial: parseFloat(f.km_inicial),
        km_final: parseFloat(f.km_final),
        status: f.status,
        data: f.data
      })));

      setDespesas((resD.data || []).filter((d: any) => d.status === 'aprovado' || d.status === 'finalizado').map((d: any) => ({
        id: d.id,
        motoristaUid: d.motorista_id,
        valor: parseFloat(d.valor),
        descricao: d.descricao,
        tipo: d.tipo,
        quemPagou: d.quem_pagou,
        status: d.status,
        data: d.data,
        frete_id: d.frete_id
      })));

      setAbastecimentos((resA.data || []).filter((a: any) => a.status === 'aprovado' || a.status === 'finalizado').map((a: any) => ({
        id: a.id,
        motoristaUid: a.motorista_id,
        valorTotal: parseFloat(a.valor_total),
        litros: parseFloat(a.litros),
        arlaLitros: a.arla_litros ? parseFloat(a.arla_litros) : null,
        arlaValor: a.arla_valor ? parseFloat(a.arla_valor) : null,
        posto: a.posto,
        quemPagou: a.quem_pagou,
        frete_id: a.frete_id,
        status: a.status,
        data: a.data
      })));

      setVales((resV.data || []).filter((v: any) => v.status === 'aprovado' || v.status === 'finalizado').map((v: any) => ({
        id: v.id,
        motoristaUid: v.motorista_id,
        valor: parseFloat(v.valor),
        posto: v.posto,
        litros: v.litros ? parseFloat(v.litros) : null,
        quemPagou: v.quem_pagou,
        status: v.status,
        data: v.data,
        frete_id: v.frete_id
      })));

    } catch (err) {
      console.error('Erro ao carregar dados do relatório', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, [reportType, selectedDate, startDate, endDate, selectedMot]);

  const generatePDF = async () => {
    try {
      setIsGenerating(true);
      
      if (fretes.length === 0 && despesas.length === 0) {
        alert("Nenhum dado encontrado para o período selecionado.");
        return;
      }

      const doc = new jsPDF();
    
    // Header
    const savedLogo = localStorage.getItem('matopibalog_logo');
    const savedCompany = localStorage.getItem('matopibalog_company');
    let company: any = null;
    try {
      company = savedCompany ? JSON.parse(savedCompany) : null;
    } catch (e) {}

    if (savedLogo) {
      try {
        const maxW = 35, maxH = 20;
        // Aguarda o decode da imagem p/ usar dimensões reais e preservar o aspecto (não estica).
        const { w, h } = await loadLogoDims(savedLogo, maxW, maxH);
        doc.addImage(savedLogo, 'PNG', 12, 8 + (maxH - h) / 2, w, h);
      } catch (e) {}
    }

    doc.setFontSize(16).setFont("helvetica", "bold");
    if (company && company.nome) {
      doc.text(company.nome.toUpperCase(), 48, 14);
      doc.setFontSize(8).setFont("helvetica", "normal");
      doc.text(`${company.endereco || ''}, ${company.cidade || ''}-${company.estado || ''}`, 48, 22);
      doc.text(`CNPJ: ${company.cnpj || ''} | Tel: ${company.telefone || ''}`, 48, 28);
    } else {
      doc.text('MATOPIBA LOG - GESTÃO DE FROTAS', 48, 20);
    }

    const periodLabel = reportType === 'mensal' ? format(new Date(selectedDate + '-01T12:00:00'), "MMMM 'de' yyyy", { locale: ptBR }) : 
                        reportType === 'anual' ? selectedDate.split('-')[0] : 
                        'PERÍODO PERSONALIZADO';
    const displayPeriod = periodLabel.toUpperCase();

    doc.setFontSize(16).setFont("helvetica", "bold");
    doc.text(`RELATÓRIO FINANCEIRO - ${displayPeriod}`, 105, 65, { align: 'center' });
    
    doc.setFontSize(10).setFont("helvetica", "normal");
    const motLabel = selectedMot === 'todos' ? 'TODOS OS MOTORISTAS' : motoristas.find(m => String(m.uid).trim() === String(selectedMot).trim())?.nomeCompleto;
    doc.text(`ALVO: ${motLabel}`, 14, 75);
    const startF = format(new Date(startDate + 'T12:00:00'), 'dd/MM/yyyy');
    const endF = format(new Date(endDate + 'T12:00:00'), 'dd/MM/yyyy');
    doc.text(`PERÍODO: ${startF} até ${endF}`, 14, 82);

    // Consolidated Table Data
    const targetMotsForSummary = motoristas.filter(m => selectedMot === 'todos' || String(m.uid).trim() === String(selectedMot).trim());
    
    const rawStats = targetMotsForSummary.map(m => {
      const mFretes = fretes.filter(f => String(f.motoristaUid).trim() === String(m.uid).trim());
      const mDesp = despesas.filter(d => String(d.motoristaUid).trim() === String(m.uid).trim());
      const mAbs = abastecimentos.filter(a => String(a.motoristaUid).trim() === String(m.uid).trim());
      const mVales = vales.filter(v => String(v.motoristaUid).trim() === String(m.uid).trim());

      const totalFrete = mFretes.reduce((s, f) => s + (f.valorFrete || 0), 0);
      const comissao = totalFrete * ((m.percentualComissao || 0) / 100);
      const totalGastos = mDesp.reduce((s, d) => s + (d.valor || 0), 0) + 
                          mAbs.reduce((s, a) => s + (a.valorTotal || 0), 0) + 
                          mVales.reduce((s, v) => s + (v.valor || 0), 0);
      const saldoLiq = comissao - totalGastos;
      
      const totalKm = mFretes.reduce((s, f) => s + (f.km_final && f.km_inicial ? f.km_final - f.km_inicial : 0), 0);
      const totalLitros = mAbs.reduce((s, a) => s + (a.litros || 0), 0);
      const media = totalLitros > 0 ? (totalKm / totalLitros).toFixed(2) : '0.00';

      return {
        nome: m.nomeCompleto,
        uid: m.uid,
        viagens: mFretes.length,
        totalFrete,
        comissao,
        totalGastos,
        saldoLiq,
        totalKm,
        totalLitros,
        media
      };
    }).filter(s => s.viagens > 0 || s.totalGastos > 0);

    if (rawStats.length === 0) {
      alert("Nenhum dado consolidado para gerar o PDF.");
      setIsGenerating(false);
      return;
    }

    // PR3B.1: motorista autônomo selecionado → modelo Faturamento/Gastos/Resultado (sem comissão/saldo).
    // Misto ("Todos") e vinculado mantêm o layout atual.
    const isAutonomoPDF = selectedMot !== 'todos'
      && motoristas.find(m => String(m.uid).trim() === String(selectedMot).trim())?.empresaTipo === 'autonomo';

    const tableBody = rawStats.map(s => isAutonomoPDF
      ? [s.nome, s.viagens.toString(), formatCurrency(s.totalFrete), formatCurrency(s.totalGastos), formatCurrency(s.totalFrete - s.totalGastos), `${s.media} KM/L`]
      : [s.nome, s.viagens.toString(), formatCurrency(s.totalFrete), formatCurrency(s.comissao), formatCurrency(s.totalGastos), formatCurrency(s.saldoLiq), `${s.media} KM/L`]
    );

    const globalTotals = rawStats.reduce((acc, s) => ({
      viagens: acc.viagens + s.viagens,
      totalFrete: acc.totalFrete + s.totalFrete,
      comissao: acc.comissao + s.comissao,
      totalGastos: acc.totalGastos + s.totalGastos,
      saldoLiq: acc.saldoLiq + s.saldoLiq,
      totalKm: acc.totalKm + s.totalKm,
      totalLitros: acc.totalLitros + s.totalLitros
    }), { viagens: 0, totalFrete: 0, comissao: 0, totalGastos: 0, saldoLiq: 0, totalKm: 0, totalLitros: 0 });

    const mediaGlobal = `${globalTotals.totalLitros > 0 ? (globalTotals.totalKm / globalTotals.totalLitros).toFixed(2) : '0.00'} KM/L`;

    autoTable(doc, {
      startY: 92,
      head: isAutonomoPDF
        ? [['Motorista', 'Fretes', 'Faturamento', 'Gastos', 'Resultado', 'Média']]
        : [['Motorista', 'Viagens', 'Total Frete', 'Comissão', 'Despesas', 'Saldo Líq.', 'Média']],
      body: tableBody,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      foot: [isAutonomoPDF
        ? ['TOTAIS', globalTotals.viagens.toString(), formatCurrency(globalTotals.totalFrete), formatCurrency(globalTotals.totalGastos), formatCurrency(globalTotals.totalFrete - globalTotals.totalGastos), mediaGlobal]
        : ['TOTAIS', globalTotals.viagens.toString(), formatCurrency(globalTotals.totalFrete), formatCurrency(globalTotals.comissao), formatCurrency(globalTotals.totalGastos), formatCurrency(globalTotals.saldoLiq), mediaGlobal]
      ],
      footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
    });

    // Profit Summary after the table
    const finalY = (doc as any).lastAutoTable.finalY + 15;
    const rightEdge = 195;
    const labelX = 130;

    doc.setFontSize(12).setFont("helvetica", "bold").setTextColor(0, 0, 0);
    doc.text('RESUMO GERAL DO PERÍODO', rightEdge, finalY, { align: 'right' });

    doc.setFontSize(10).setFont("helvetica", "normal");
    if (isAutonomoPDF) {
      const resultadoGlobal = globalTotals.totalFrete - globalTotals.totalGastos;
      doc.text(`Faturamento Total:`, labelX, finalY + 10);
      doc.text(`${formatCurrency(globalTotals.totalFrete)}`, rightEdge, finalY + 10, { align: 'right' });

      doc.text(`Total Gastos:`, labelX, finalY + 18);
      doc.text(`${formatCurrency(globalTotals.totalGastos)}`, rightEdge, finalY + 18, { align: 'right' });

      doc.setDrawColor(200).line(labelX, finalY + 22, rightEdge, finalY + 22);

      doc.setFontSize(11).setFont("helvetica", "bold");
      if (resultadoGlobal >= 0) { doc.setTextColor(21, 128, 61); } else { doc.setTextColor(185, 28, 28); }
      doc.text(`RESULTADO:`, labelX, finalY + 30);
      doc.text(`${formatCurrency(resultadoGlobal)}`, rightEdge, finalY + 30, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    } else {
      doc.text(`Total Bruto (Fretes):`, labelX, finalY + 10);
      doc.text(`${formatCurrency(globalTotals.totalFrete)}`, rightEdge, finalY + 10, { align: 'right' });

      doc.text(`Total Comissões:`, labelX, finalY + 18);
      doc.text(`${formatCurrency(globalTotals.comissao)}`, rightEdge, finalY + 18, { align: 'right' });

      doc.text(`Total Despesas/Vales:`, labelX, finalY + 26);
      doc.text(`${formatCurrency(globalTotals.totalGastos)}`, rightEdge, finalY + 26, { align: 'right' });

      doc.setDrawColor(200).line(labelX, finalY + 30, rightEdge, finalY + 30);

      doc.setFontSize(11).setFont("helvetica", "bold");
      if (globalTotals.saldoLiq >= 0) {
        doc.setTextColor(21, 128, 61); // Green
      } else {
        doc.setTextColor(185, 28, 28); // Red
      }
      doc.text(`SALDO LÍQUIDO FINAL:`, labelX, finalY + 38);
      doc.text(`${formatCurrency(globalTotals.saldoLiq)}`, rightEdge, finalY + 38, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    }

    // Detailed breakdown by type for each motorista
    const targetMots = motoristas.filter(m => {
      const isTarget = selectedMot === 'todos' || String(m.uid).trim() === String(selectedMot).trim();
      if (!isTarget) return false;
      return fretes.some(f => String(f.motoristaUid).trim() === String(m.uid).trim()) || 
             despesas.some(d => String(d.motoristaUid).trim() === String(m.uid).trim()) ||
             abastecimentos.some(a => String(a.motoristaUid).trim() === String(m.uid).trim()) ||
             vales.some(v => String(v.motoristaUid).trim() === String(m.uid).trim());
    });

    let detalhamentoY = finalY + 55;

    targetMots.forEach((m) => {
      const mFretes = fretes.filter(f => String(f.motoristaUid).trim() === String(m.uid).trim());
      const mDespAll = despesas.filter(d => String(d.motoristaUid).trim() === String(m.uid).trim());
      const mAbsAll = abastecimentos.filter(a => String(a.motoristaUid).trim() === String(m.uid).trim());
      const mValAll = vales.filter(v => String(v.motoristaUid).trim() === String(m.uid).trim());

      if (mFretes.length === 0 && mDespAll.length === 0 && mAbsAll.length === 0 && mValAll.length === 0) return;

      if (detalhamentoY > 250) { doc.addPage(); detalhamentoY = 15; }
      doc.setFontSize(14).setFont("helvetica", "bold");
      doc.text(`DETALHAMENTO: ${m.nomeCompleto.toUpperCase()}`, 14, detalhamentoY);

      let yPos = detalhamentoY + 8;
      const leftX = 14;

      // ─── 1. FRETES REALIZADOS ───
      if (mFretes.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('FRETES REALIZADOS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Rota', 'Placa', 'KM Inicial', 'KM Final', 'Distância', 'Média', 'Frete', 'Status', 'Quem Recebeu']],
          body: mFretes.map(f => {
            const kmInicial = f.km_inicial || 0;
            const kmFinal = f.km_final || 0;
            const dist = kmFinal - kmInicial;
            const litrosFrete = mAbsAll.filter(a => a.frete_id === f.id).reduce((acc, a) => acc + a.litros, 0);
            const media = (litrosFrete > 0 && dist > 0) ? (dist / litrosFrete).toFixed(2) : '0.00';
            return [
              format(new Date(f.data), 'dd/MM/yyyy'),
              `${f.origem} > ${f.destino}`,
              f.placa || '-',
              kmInicial > 0 ? kmInicial.toString() : '-',
              kmFinal > 0 ? kmFinal.toString() : '-',
              dist > 0 ? `${dist} KM` : '-',
              media !== '0.00' ? `${media} KM/L` : '-',
              formatCurrency(f.valorFrete),
              f.status ? f.status.toUpperCase() : '',
              f.quemRecebeu === 'proprietario' ? 'Proprietário' : f.quemRecebeu === 'motorista' ? 'Motorista' : '-'
            ];
          }),
          foot: [[
            'TOTAIS', '', '', '', '', '', '',
            formatCurrency(mFretes.reduce((s, f) => s + (f.valorFrete || 0), 0)),
            '', ''
          ]],
          headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 7 },
          styles: { fontSize: 7, cellPadding: 1.5 },
          columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 14 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 16, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' }, 6: { cellWidth: 16, halign: 'right' }, 7: { cellWidth: 22, halign: 'right' }, 8: { cellWidth: 16 }, 9: { cellWidth: 18 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      // ─── 2. ABASTECIMENTOS ───
      if (mAbsAll.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('ABASTECIMENTOS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Posto', 'Litros', 'Valor', 'Pagador']],
          body: mAbsAll.map(a => [
            format(new Date(a.data), 'dd/MM'),
            a.posto || '-',
            `${(a.litros || 0).toFixed(1)}L${a.arlaLitros ? ` + ARLA ${(a.arlaLitros || 0).toFixed(1)}L` : ''}`,
            formatCurrency(a.valorTotal),
            a.quemPagou === 'proprietario' ? 'Proprietário' : 'Motorista'
          ]),
          foot: [[
            'TOTAIS',
            '',
            `${mAbsAll.reduce((s, a) => s + (a.litros || 0) + (a.arlaLitros || 0), 0).toFixed(1)}L`,
            formatCurrency(mAbsAll.reduce((s, a) => s + (a.valorTotal || 0), 0)),
            ''
          ]],
          headStyles: { fillColor: [245, 158, 11], fontSize: 8 },
          footStyles: { fillColor: [255, 247, 237], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26 }, 3: { cellWidth: 26, halign: 'right' }, 4: { cellWidth: 22 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      // ─── 3. VALES / ADIANTAMENTOS ───
      if (mValAll.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('VALES / ADIANTAMENTOS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Descrição', 'Valor', 'Pagador']],
          body: mValAll.map(v => [
            format(new Date(v.data), 'dd/MM'),
            v.posto ? `Vale - ${v.posto}` : 'Vale',
            formatCurrency(v.valor),
            v.quemPagou === 'proprietario' ? 'Proprietário' : 'Motorista'
          ]),
          foot: [['TOTAIS', '', formatCurrency(mValAll.reduce((s, v) => s + (v.valor || 0), 0)), '']],
          headStyles: { fillColor: [139, 92, 246], fontSize: 8 },
          footStyles: { fillColor: [245, 243, 255], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 22 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      // ─── 4. OUTRAS DESPESAS ───
      if (mDespAll.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('OUTRAS DESPESAS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Descrição', 'Valor', 'Pagador']],
          body: mDespAll.map(d => [
            format(new Date(d.data), 'dd/MM'),
            d.descricao || 'Despesa',
            formatCurrency(d.valor),
            d.quemPagou === 'proprietario' ? 'Proprietário' : 'Motorista'
          ]),
          foot: [['TOTAIS', '', formatCurrency(mDespAll.reduce((s, d) => s + (d.valor || 0), 0)), '']],
          headStyles: { fillColor: [239, 68, 68], fontSize: 8 },
          footStyles: { fillColor: [254, 242, 242], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 22 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      detalhamentoY = yPos;
    });

    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `relatorio-matopiba-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(pdfUrl);
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Ocorreu um erro ao gerar o relatório.");
    } finally {
      setIsGenerating(false);
    }
  };

  const generatePDFSelected = async () => {
    try {
      setIsGenerating(true);

      if (selectedTripIds.length === 0) {
        alert("Nenhum frete selecionado.");
        setIsGenerating(false);
        return;
      }

      const selectedFretes = fretes.filter(f => selectedTripIds.includes(f.id));

      const doc = new jsPDF();

    const savedLogo = localStorage.getItem('matopibalog_logo');
    const savedCompany = localStorage.getItem('matopibalog_company');
    let company: any = null;
    try {
      company = savedCompany ? JSON.parse(savedCompany) : null;
    } catch (e) {}

    if (savedLogo) {
      try {
        const maxW = 35, maxH = 20;
        // Aguarda o decode da imagem p/ usar dimensões reais e preservar o aspecto (não estica).
        const { w, h } = await loadLogoDims(savedLogo, maxW, maxH);
        doc.addImage(savedLogo, 'PNG', 12, 8 + (maxH - h) / 2, w, h);
      } catch (e) {}
    }

    doc.setFontSize(16).setFont("helvetica", "bold");
    if (company && company.nome) {
      doc.text(company.nome.toUpperCase(), 48, 14);
      doc.setFontSize(8).setFont("helvetica", "normal");
      doc.text(`${company.endereco || ''}, ${company.cidade || ''}-${company.estado || ''}`, 48, 22);
      doc.text(`CNPJ: ${company.cnpj || ''} | Tel: ${company.telefone || ''}`, 48, 28);
    } else {
      doc.text('MATOPIBA LOG - GESTÃO DE FROTAS', 48, 20);
    }

    const periodLabel = reportType === 'mensal' ? format(new Date(selectedDate + '-01T12:00:00'), "MMMM 'de' yyyy", { locale: ptBR }) :
                        reportType === 'anual' ? selectedDate.split('-')[0] :
                        'PERÍODO PERSONALIZADO';
    const displayPeriod = periodLabel.toUpperCase();

    doc.setFontSize(16).setFont("helvetica", "bold");
    doc.text(`RELATÓRIO FINANCEIRO - ${displayPeriod}`, 105, 65, { align: 'center' });

    doc.setFontSize(10).setFont("helvetica", "normal");
    const motLabel = selectedMot === 'todos' ? 'TODOS OS MOTORISTAS' : motoristas.find(m => String(m.uid).trim() === String(selectedMot).trim())?.nomeCompleto;
    doc.text(`ALVO: ${motLabel}`, 14, 75);
    const startF = format(new Date(startDate + 'T12:00:00'), 'dd/MM/yyyy');
    const endF = format(new Date(endDate + 'T12:00:00'), 'dd/MM/yyyy');
    doc.text(`PERÍODO: ${startF} até ${endF}`, 14, 82);

    doc.setFontSize(9).setFont("helvetica", "italic");
    doc.text(`FRETES SELECIONADOS: ${selectedTripIds.length}`, 14, 89);

    // Summary table for selected trips
    const motoristaUids = [...new Set(selectedFretes.map(f => f.motoristaUid))];
    const targetMots = motoristas.filter(m => motoristaUids.includes(m.uid));
    // PR3B.1: fretes selecionados de UM único motorista autônomo → modelo Faturamento/Gastos/Resultado.
    // Seleção mista (mais de um motorista) mantém o layout atual.
    const isAutonomoPDF = targetMots.length === 1 && targetMots[0]?.empresaTipo === 'autonomo';

    const rawStats = targetMots.map(m => {
      const mFretes = selectedFretes.filter(f => String(f.motoristaUid).trim() === String(m.uid).trim());
      const mDesp = despesas.filter(d => String(d.motoristaUid).trim() === String(m.uid).trim() && selectedTripIds.includes(d.frete_id));
      const mAbs = abastecimentos.filter(a => String(a.motoristaUid).trim() === String(m.uid).trim() && selectedTripIds.includes(a.frete_id));
      const mVales = vales.filter(v => String(v.motoristaUid).trim() === String(m.uid).trim() && selectedTripIds.includes(v.frete_id));

      const totalFrete = mFretes.reduce((s, f) => s + (f.valorFrete || 0), 0);
      const comissao = totalFrete * ((m.percentualComissao || 0) / 100);
      const totalGastos = mDesp.reduce((s, d) => s + (d.valor || 0), 0) +
                          mAbs.reduce((s, a) => s + (a.valorTotal || 0), 0) +
                          mVales.reduce((s, v) => s + (v.valor || 0), 0);
      const saldoLiq = comissao - totalGastos;

      const totalKm = mFretes.reduce((s, f) => s + (f.km_final && f.km_inicial ? f.km_final - f.km_inicial : 0), 0);
      const totalLitros = mAbs.reduce((s, a) => s + (a.litros || 0), 0);
      const media = totalLitros > 0 ? (totalKm / totalLitros).toFixed(2) : '0.00';

      return {
        nome: m.nomeCompleto,
        uid: m.uid,
        viagens: mFretes.length,
        totalFrete,
        comissao,
        totalGastos,
        saldoLiq,
        totalKm,
        totalLitros,
        media
      };
    }).filter(s => s.viagens > 0 || s.totalGastos > 0);

    let detalhamentoY = 105;

    if (rawStats.length > 0) {
      const tableBody = rawStats.map(s => isAutonomoPDF
        ? [s.nome, s.viagens.toString(), formatCurrency(s.totalFrete), formatCurrency(s.totalGastos), formatCurrency(s.totalFrete - s.totalGastos), `${s.media} KM/L`]
        : [s.nome, s.viagens.toString(), formatCurrency(s.totalFrete), formatCurrency(s.comissao), formatCurrency(s.totalGastos), formatCurrency(s.saldoLiq), `${s.media} KM/L`]
      );

      const globalTotals = rawStats.reduce((acc, s) => ({
        viagens: acc.viagens + s.viagens,
        totalFrete: acc.totalFrete + s.totalFrete,
        comissao: acc.comissao + s.comissao,
        totalGastos: acc.totalGastos + s.totalGastos,
        saldoLiq: acc.saldoLiq + s.saldoLiq,
        totalKm: acc.totalKm + s.totalKm,
        totalLitros: acc.totalLitros + s.totalLitros
      }), { viagens: 0, totalFrete: 0, comissao: 0, totalGastos: 0, saldoLiq: 0, totalKm: 0, totalLitros: 0 });

      const mediaGlobal = `${globalTotals.totalLitros > 0 ? (globalTotals.totalKm / globalTotals.totalLitros).toFixed(2) : '0.00'} KM/L`;

      autoTable(doc, {
        startY: 99,
        head: isAutonomoPDF
          ? [['Motorista', 'Fretes', 'Faturamento', 'Gastos', 'Resultado', 'Média']]
          : [['Motorista', 'Viagens', 'Total Frete', 'Comissão', 'Despesas', 'Saldo Líq.', 'Média']],
        body: tableBody,
        theme: 'striped',
        headStyles: { fillColor: [59, 130, 246] },
        foot: [isAutonomoPDF
          ? ['TOTAIS', globalTotals.viagens.toString(), formatCurrency(globalTotals.totalFrete), formatCurrency(globalTotals.totalGastos), formatCurrency(globalTotals.totalFrete - globalTotals.totalGastos), mediaGlobal]
          : ['TOTAIS', globalTotals.viagens.toString(), formatCurrency(globalTotals.totalFrete), formatCurrency(globalTotals.comissao), formatCurrency(globalTotals.totalGastos), formatCurrency(globalTotals.saldoLiq), mediaGlobal]
        ],
        footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
      });

      const finalY = (doc as any).lastAutoTable.finalY + 15;
      const rightEdge = 195;
      const labelX = 130;

      doc.setFontSize(12).setFont("helvetica", "bold").setTextColor(0, 0, 0);
      doc.text('RESUMO GERAL DO PERÍODO', rightEdge, finalY, { align: 'right' });

      doc.setFontSize(10).setFont("helvetica", "normal");
      if (isAutonomoPDF) {
        const resultadoGlobal = globalTotals.totalFrete - globalTotals.totalGastos;
        doc.text(`Faturamento Total:`, labelX, finalY + 10);
        doc.text(`${formatCurrency(globalTotals.totalFrete)}`, rightEdge, finalY + 10, { align: 'right' });

        doc.text(`Total Gastos:`, labelX, finalY + 18);
        doc.text(`${formatCurrency(globalTotals.totalGastos)}`, rightEdge, finalY + 18, { align: 'right' });

        doc.setDrawColor(200).line(labelX, finalY + 22, rightEdge, finalY + 22);

        doc.setFontSize(11).setFont("helvetica", "bold");
        if (resultadoGlobal >= 0) { doc.setTextColor(21, 128, 61); } else { doc.setTextColor(185, 28, 28); }
        doc.text(`RESULTADO:`, labelX, finalY + 30);
        doc.text(`${formatCurrency(resultadoGlobal)}`, rightEdge, finalY + 30, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text(`Total Bruto (Fretes):`, labelX, finalY + 10);
        doc.text(`${formatCurrency(globalTotals.totalFrete)}`, rightEdge, finalY + 10, { align: 'right' });

        doc.text(`Total Comissões:`, labelX, finalY + 18);
        doc.text(`${formatCurrency(globalTotals.comissao)}`, rightEdge, finalY + 18, { align: 'right' });

        doc.text(`Total Despesas/Vales:`, labelX, finalY + 26);
        doc.text(`${formatCurrency(globalTotals.totalGastos)}`, rightEdge, finalY + 26, { align: 'right' });

        doc.setDrawColor(200).line(labelX, finalY + 30, rightEdge, finalY + 30);

        doc.setFontSize(11).setFont("helvetica", "bold");
        if (globalTotals.saldoLiq >= 0) {
          doc.setTextColor(21, 128, 61);
        } else {
          doc.setTextColor(185, 28, 28);
        }
        doc.text(`SALDO LÍQUIDO FINAL:`, labelX, finalY + 38);
        doc.text(`${formatCurrency(globalTotals.saldoLiq)}`, rightEdge, finalY + 38, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      detalhamentoY = finalY + 55;
    }

    targetMots.forEach((m) => {
      const mFretes = selectedFretes.filter(f => String(f.motoristaUid).trim() === String(m.uid).trim());
      const selectedIds = mFretes.map(f => f.id);
      const mDespAll = despesas.filter(d => String(d.motoristaUid).trim() === String(m.uid).trim() && selectedIds.includes(d.frete_id));
      const mAbsAll = abastecimentos.filter(a => String(a.motoristaUid).trim() === String(m.uid).trim() && selectedIds.includes(a.frete_id));
      const mValAll = vales.filter(v => String(v.motoristaUid).trim() === String(m.uid).trim() && selectedIds.includes(v.frete_id));

      if (mFretes.length === 0) return;

      if (detalhamentoY > 250) { doc.addPage(); detalhamentoY = 15; }
      doc.setFontSize(14).setFont("helvetica", "bold");
      doc.text(`DETALHAMENTO: ${m.nomeCompleto.toUpperCase()}`, 14, detalhamentoY);

      let yPos = detalhamentoY + 8;
      const leftX = 14;

      // ─── 1. FRETES REALIZADOS ───
      if (mFretes.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('FRETES REALIZADOS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Rota', 'Placa', 'KM Inicial', 'KM Final', 'Distância', 'Média', 'Frete', 'Status', 'Quem Recebeu']],
          body: mFretes.map(f => {
            const kmInicial = f.km_inicial || 0;
            const kmFinal = f.km_final || 0;
            const dist = kmFinal - kmInicial;
            const litrosFrete = mAbsAll.filter(a => a.frete_id === f.id).reduce((acc, a) => acc + a.litros, 0);
            const media = (litrosFrete > 0 && dist > 0) ? (dist / litrosFrete).toFixed(2) : '0.00';
            return [
              format(new Date(f.data), 'dd/MM/yyyy'),
              `${f.origem} > ${f.destino}`,
              f.placa || '-',
              kmInicial > 0 ? kmInicial.toString() : '-',
              kmFinal > 0 ? kmFinal.toString() : '-',
              dist > 0 ? `${dist} KM` : '-',
              media !== '0.00' ? `${media} KM/L` : '-',
              formatCurrency(f.valorFrete),
              f.status ? f.status.toUpperCase() : '',
              f.quemRecebeu === 'proprietario' ? 'Proprietário' : f.quemRecebeu === 'motorista' ? 'Motorista' : '-'
            ];
          }),
          foot: [[
            'TOTAIS', '', '', '', '', '', '',
            formatCurrency(mFretes.reduce((s, f) => s + (f.valorFrete || 0), 0)),
            '', ''
          ]],
          headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 7 },
          styles: { fontSize: 7, cellPadding: 1.5 },
          columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 14 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 16, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' }, 6: { cellWidth: 16, halign: 'right' }, 7: { cellWidth: 22, halign: 'right' }, 8: { cellWidth: 16 }, 9: { cellWidth: 18 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      // ─── 2. ABASTECIMENTOS ───
      if (mAbsAll.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('ABASTECIMENTOS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Posto', 'Litros', 'Valor', 'Pagador']],
          body: mAbsAll.map(a => [
            format(new Date(a.data), 'dd/MM'),
            a.posto || '-',
            `${(a.litros || 0).toFixed(1)}L${a.arlaLitros ? ` + ARLA ${(a.arlaLitros || 0).toFixed(1)}L` : ''}`,
            formatCurrency(a.valorTotal),
            a.quemPagou === 'proprietario' ? 'Proprietário' : 'Motorista'
          ]),
          foot: [[
            'TOTAIS',
            '',
            `${mAbsAll.reduce((s, a) => s + (a.litros || 0) + (a.arlaLitros || 0), 0).toFixed(1)}L`,
            formatCurrency(mAbsAll.reduce((s, a) => s + (a.valorTotal || 0), 0)),
            ''
          ]],
          headStyles: { fillColor: [245, 158, 11], fontSize: 8 },
          footStyles: { fillColor: [255, 247, 237], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26 }, 3: { cellWidth: 26, halign: 'right' }, 4: { cellWidth: 22 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      // ─── 3. VALES / ADIANTAMENTOS ───
      if (mValAll.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('VALES / ADIANTAMENTOS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Descrição', 'Valor', 'Pagador']],
          body: mValAll.map(v => [
            format(new Date(v.data), 'dd/MM'),
            v.posto ? `Vale - ${v.posto}` : 'Vale',
            formatCurrency(v.valor),
            v.quemPagou === 'proprietario' ? 'Proprietário' : 'Motorista'
          ]),
          foot: [['TOTAIS', '', formatCurrency(mValAll.reduce((s, v) => s + (v.valor || 0), 0)), '']],
          headStyles: { fillColor: [139, 92, 246], fontSize: 8 },
          footStyles: { fillColor: [245, 243, 255], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 22 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      // ─── 4. OUTRAS DESPESAS ───
      if (mDespAll.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 15; }
        yPos += 2;
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(31, 41, 55);
        doc.text('OUTRAS DESPESAS', leftX, yPos);
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: yPos + 4,
          head: [['Data', 'Descrição', 'Valor', 'Pagador']],
          body: mDespAll.map(d => [
            format(new Date(d.data), 'dd/MM'),
            d.descricao || 'Despesa',
            formatCurrency(d.valor),
            d.quemPagou === 'proprietario' ? 'Proprietário' : 'Motorista'
          ]),
          foot: [['TOTAIS', '', formatCurrency(mDespAll.reduce((s, d) => s + (d.valor || 0), 0)), '']],
          headStyles: { fillColor: [239, 68, 68], fontSize: 8 },
          footStyles: { fillColor: [254, 242, 242], textColor: [31, 41, 55], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 26, halign: 'right' }, 3: { cellWidth: 22 } }
        });
        yPos = (doc as any).lastAutoTable.finalY + 6;
      }

      detalhamentoY = yPos;
    });

    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `relatorio-matopiba-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(pdfUrl);
    } catch (error) {
      console.error("Erro ao gerar PDF selecionado:", error);
      alert("Ocorreu um erro ao gerar o relatório.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Centro de Relatórios</h2>
          <p className="text-gray-500 text-sm">Gere auditorias financeiras completas da sua frota</p>
        </div>
        <FileText size={40} className="text-blue-500 opacity-20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filtros */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center">
              <Filter size={16} className="mr-2" /> Parâmetros
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Motorista</label>
                <div className="relative">
                  <Users className="absolute left-3 top-3 text-gray-400" size={18} />
                  <select 
                    value={selectedMot} 
                    onChange={(e) => setSelectedMot(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border rounded-xl appearance-none bg-white focus:border-blue-500 outline-none"
                  >
                    <option value="todos">Todos os Motoristas</option>
                    {motoristas.map(m => (
                      <option key={m.uid} value={m.uid}>{m.nomeCompleto}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Tipo de Período</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setReportType('mensal')} className={`p-2 text-xs font-bold rounded-lg border transition-all ${reportType === 'mensal' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'hover:bg-gray-50'}`}>Mensal</button>
                  <button onClick={() => setReportType('anual')} className={`p-2 text-xs font-bold rounded-lg border transition-all ${reportType === 'anual' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'hover:bg-gray-50'}`}>Anual</button>
                  <button onClick={() => setReportType('personalizado')} className={`p-2 text-xs font-bold rounded-lg border transition-all col-span-2 ${reportType === 'personalizado' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'hover:bg-gray-50'}`}>Período Personalizado</button>
                </div>
              </div>

              {reportType === 'mensal' && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Mês de Referência</label>
                  <input type="month" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-full p-2.5 border rounded-xl outline-none focus:border-blue-500" />
                </div>
              )}

              {reportType === 'anual' && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Ano de Referência</label>
                  <select value={selectedDate.split('-')[0]} onChange={e => setSelectedDate(e.target.value + '-01')} className="w-full p-2.5 border rounded-xl outline-none focus:border-blue-500 bg-white">
                    {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}

              {reportType === 'personalizado' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Início</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Fim</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                  </div>
                </div>
              )}

              <button 
                onClick={generatePDF}
                disabled={isGenerating || (fretes.length === 0 && despesas.length === 0)}
                className={`w-full font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center ${
                  isGenerating || (fretes.length === 0 && despesas.length === 0)
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' 
                  : 'bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700 active:scale-95'
                }`}
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                    Processando...
                  </>
                ) : (
                  <>
                    <Download size={18} className="mr-2" /> Gerar Relatório PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Preview / Resumo */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 min-h-[400px]">
            <div className="flex items-center justify-between mb-8 border-b pb-4">
              <h3 className="font-bold text-gray-800">Prévia do Relatório</h3>
              <div className="flex items-center text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full uppercase">
                <Calendar size={14} className="mr-1" /> 
                {reportType === 'mensal' ? format(new Date(selectedDate + '-01T12:00:00'), 'MMMM / yyyy') : 
                 reportType === 'anual' ? selectedDate.split('-')[0] : 'Período Customizado'}
              </div>
            </div>

            {loadingData ? (
               <div className="py-20 text-center text-gray-500">Carregando dados...</div>
            ) : (
              <>
                {(() => {
                  // PR3A: cards sensíveis ao tipo. Autônomo NÃO vê "Comissões" — vê Faturamento/Gastos/Resultado.
                  // `|| 0` em todos os somatórios evita NaN.
                  const selObj = selectedMot !== 'todos' ? motoristas.find(m => m.uid === selectedMot) : null;
                  const isAutSel = selObj?.empresaTipo === 'autonomo';
                  const totalFrete = fretes.reduce((s,f)=>s+(f.valorFrete||0), 0);
                  const gastosTotais = despesas.reduce((s,d)=>s+(d.valor||0),0) + abastecimentos.reduce((s,a)=>s+(a.valorTotal||0),0) + vales.reduce((s,v)=>s+(v.valor||0),0);
                  const card = (label: string, value: number, opts: any = {}) => (
                    <div key={label} className={`p-4 rounded-2xl border ${opts.box || 'bg-gray-50 border-gray-100'}`}>
                      <p className={`text-[10px] font-bold uppercase mb-1 ${opts.labelCls || 'text-gray-400'}`}>{label}</p>
                      <p className={`text-lg font-black ${opts.valCls || 'text-gray-800'}`}>{opts.raw ? value : formatCurrency(value)}</p>
                    </div>
                  );

                  // 1) Autônomo selecionado → Faturamento / Gastos / Resultado / Viagens (sem Comissões)
                  if (isAutSel) {
                    const resultado = totalFrete - gastosTotais;
                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {card('Faturamento', totalFrete)}
                        {card('Gastos', gastosTotais, { box: 'bg-red-50 border-red-100', labelCls: 'text-red-600', valCls: 'text-red-700' })}
                        {card('Resultado', resultado, { box: 'bg-green-50 border-green-100', labelCls: 'text-green-600', valCls: resultado >= 0 ? 'text-green-700' : 'text-red-700' })}
                        {card('Viagens', fretes.length, { box: 'bg-blue-50 border-blue-100', labelCls: 'text-blue-600', valCls: 'text-blue-700', raw: true })}
                      </div>
                    );
                  }

                  // 2) Modo misto ("Todos") → separar visualmente Vinculados x Autônomos (sem total único)
                  if (selectedMot === 'todos') {
                    let tfVinc=0, comVinc=0, gVinc=0, tfAut=0, gAut=0, nVinc=0, nAut=0;
                    motoristas.forEach(m => {
                      const mF = fretes.filter(f => f.motoristaUid === m.uid);
                      const g = despesas.filter(d => d.motoristaUid === m.uid).reduce((s,d)=>s+(d.valor||0),0)
                        + abastecimentos.filter(a => a.motoristaUid === m.uid).reduce((s,a)=>s+(a.valorTotal||0),0)
                        + vales.filter(v => v.motoristaUid === m.uid).reduce((s,v)=>s+(v.valor||0),0);
                      if (mF.length === 0 && g === 0) return;
                      const tot = mF.reduce((s,f)=>s+(f.valorFrete||0),0);
                      if (m.empresaTipo === 'autonomo') { tfAut+=tot; gAut+=g; nAut++; }
                      else { tfVinc+=tot; comVinc += tot*((m.percentualComissao||0)/100); gVinc+=g; nVinc++; }
                    });
                    const resAut = tfAut - gAut;
                    return (
                      <div className="space-y-4 mb-8">
                        {nVinc > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase mb-2 tracking-widest">Vinculados</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                              {card('Total Frete', tfVinc)}
                              {card('Comissões', comVinc, { box: 'bg-green-50 border-green-100', labelCls: 'text-green-600', valCls: 'text-green-700' })}
                              {card('Despesas', gVinc, { box: 'bg-red-50 border-red-100', labelCls: 'text-red-600', valCls: 'text-red-700' })}
                            </div>
                          </div>
                        )}
                        {nAut > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-amber-500 uppercase mb-2 tracking-widest">Autônomos</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                              {card('Faturamento', tfAut)}
                              {card('Gastos', gAut, { box: 'bg-red-50 border-red-100', labelCls: 'text-red-600', valCls: 'text-red-700' })}
                              {card('Resultado', resAut, { box: 'bg-green-50 border-green-100', labelCls: 'text-green-600', valCls: resAut >= 0 ? 'text-green-700' : 'text-red-700' })}
                            </div>
                          </div>
                        )}
                        {nVinc === 0 && nAut === 0 && (
                          <p className="text-sm text-gray-400 text-center py-4">Nenhum dado no período.</p>
                        )}
                      </div>
                    );
                  }

                  // 3) Vinculado selecionado → comportamento atual (Total Frete / Comissões / Despesas / Viagens)
                  const comissaoVinc = fretes.reduce((s,f) => {
                    const m = motoristas.find(mot => mot.uid === f.motoristaUid);
                    return s + (m?.empresaTipo === 'autonomo' ? 0 : (f.valorFrete||0) * ((m?.percentualComissao || 0)/100));
                  }, 0);
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                      {card('Total Frete', totalFrete)}
                      {card('Comissões', comissaoVinc, { box: 'bg-green-50 border-green-100', labelCls: 'text-green-600', valCls: 'text-green-700' })}
                      {card('Despesas', gastosTotais, { box: 'bg-red-50 border-red-100', labelCls: 'text-red-600', valCls: 'text-red-700' })}
                      {card('Viagens', fretes.length, { box: 'bg-blue-50 border-blue-100', labelCls: 'text-blue-600', valCls: 'text-blue-700', raw: true })}
                    </div>
                  );
                })()}

                <div className="border rounded-2xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-[10px] font-bold uppercase text-gray-400 border-b">
                      <tr>
                        <th className="p-4 w-8"></th>
                        <th className="p-4">Motorista</th>
                        <th className="p-4 text-right">{(selectedMot !== 'todos' && motoristas.find(m => m.uid === selectedMot)?.empresaTipo === 'autonomo') ? 'Faturamento' : 'Frete Bruto'}</th>
                        <th className="p-4 text-right">{(selectedMot !== 'todos' && motoristas.find(m => m.uid === selectedMot)?.empresaTipo === 'autonomo') ? 'Resultado' : selectedMot === 'todos' ? 'Comissão / Resultado' : 'Comissão'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {motoristas.filter(m => selectedMot === 'todos' || m.uid === selectedMot).map(m => {
                        const mFretes = fretes.filter(f => f.motoristaUid === m.uid);
                        if (mFretes.length === 0) return null;
                        const total = mFretes.reduce((s,f)=>s+f.valorFrete,0);
                        // PR3A: autônomo = Faturamento − Gastos (sem comissão). Gastos = desp+abast+vales
                        // (já filtrados aprovado/finalizado no load), ignorando quem_pagou. `|| 0` evita NaN.
                        const isAut = m.empresaTipo === 'autonomo';
                        const mGastos = despesas.filter(d => d.motoristaUid === m.uid).reduce((s,d)=>s+(d.valor||0),0)
                          + abastecimentos.filter(a => a.motoristaUid === m.uid).reduce((s,a)=>s+(a.valorTotal||0),0)
                          + vales.filter(v => v.motoristaUid === m.uid).reduce((s,v)=>s+(v.valor||0),0);
                        const resultado = total - mGastos;
                        return (
                          <React.Fragment key={m.uid}>
                            <tr className="bg-gray-100/30">
                              <td className="p-4"></td>
                              <td className="p-4 flex items-center">
                                <div className="bg-blue-100 p-1.5 rounded-lg mr-3">
                                  <User size={16} className="text-blue-600" />
                                </div>
                                <span className="text-base font-black text-gray-800">{m.nomeCompleto}</span>
                                {isAut && <span className="ml-2 text-[9px] font-bold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Autônomo</span>}
                              </td>
                              <td className="p-4 text-right text-sm font-black text-gray-700">{formatCurrency(total)}</td>
                              <td className="p-4 text-right text-sm font-black">
                                {isAut ? (
                                  <div>
                                    <span className={resultado >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(resultado)}</span>
                                    <p className="text-[9px] font-bold text-gray-400 uppercase">Resultado · Gastos {formatCurrency(mGastos)}</p>
                                  </div>
                                ) : (
                                  <span className="text-blue-600">{formatCurrency(total * ((m.percentualComissao || 0)/100))}</span>
                                )}
                              </td>
                            </tr>
                            {mFretes.map(f => {
                              const kmInicial = f.km_inicial || 0;
                              const kmFinal = f.km_final || 0;
                              const distancia = kmFinal - kmInicial;
                              const litrosFrete = abastecimentos.filter(a => a.frete_id === f.id).reduce((acc, a) => acc + a.litros, 0);
                              const media = litrosFrete > 0 && distancia > 0 ? (distancia / litrosFrete).toFixed(2) : null;
                              const isSelected = selectedTripIds.includes(f.id);
                              const isExpanded = expandedTripId === f.id;

                              const fAbs = abastecimentos.filter(a => a.frete_id === f.id);
                              const fDesp = despesas.filter(d => d.frete_id === f.id);
                              const fVal = vales.filter(v => v.frete_id === f.id);

                              return (
                                <React.Fragment key={f.id}>
                                  <tr
                                    className={`border-b border-gray-50 transition-colors cursor-pointer ${isExpanded ? 'bg-blue-50/50' : 'hover:bg-blue-50/30'}`}
                                    onClick={() => setExpandedTripId(isExpanded ? null : f.id)}
                                  >
                                    <td className="pl-4 py-2" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          setSelectedTripIds(prev =>
                                            prev.includes(f.id) ? prev.filter(id => id !== f.id) : [...prev, f.id]
                                          );
                                        }}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                                      />
                                    </td>
                                    <td colSpan={3} className="pr-4 py-2">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center text-xs font-bold text-gray-600 min-w-0">
                                          <span className="w-10 text-gray-400">{format(new Date(f.data), 'dd/MM')}</span>
                                          <Truck size={12} className="mx-2 text-blue-400 flex-shrink-0" />
                                          <span className="truncate">{f.origem}</span>
                                          <span className="mx-2 text-gray-300 flex-shrink-0">➔</span>
                                          <span className="truncate">{f.destino}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] font-bold flex-shrink-0">
                                          <span className="text-gray-400">INI: <span className="text-gray-600">{kmInicial > 0 ? kmInicial.toLocaleString() : '-'}</span></span>
                                          <span className="text-gray-400">FIM: <span className="text-gray-600">{kmFinal > 0 ? kmFinal.toLocaleString() : '-'}</span></span>
                                          <span className="text-gray-400">DIST: <span className="text-blue-600">{distancia > 0 ? `${distancia.toLocaleString()} KM` : '-'}</span></span>
                                          <span className="text-gray-400">MÉD: <span className="text-green-600">{media ? `${media} KM/L` : '-'}</span></span>
                                          <span className="text-gray-800 ml-1">{formatCurrency(f.valorFrete)}</span>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr>
                                      <td colSpan={4} className="bg-blue-50/30 px-6 py-4">
                                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Data</p>
                                            <p className="text-sm font-bold text-gray-800">{format(new Date(f.data), 'dd/MM/yyyy')}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Placa</p>
                                            <p className="text-sm font-bold text-gray-800">{f.placa || '-'}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Valor Frete</p>
                                            <p className="text-sm font-bold text-blue-600">{formatCurrency(f.valorFrete)}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Status</p>
                                            <p className="text-sm font-bold text-gray-800">{f.status ? f.status.toUpperCase() : '-'}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Quem Recebeu</p>
                                            <p className="text-sm font-bold text-gray-800">{f.quemRecebeu === 'proprietario' ? 'Proprietário' : f.quemRecebeu === 'motorista' ? 'Motorista' : '-'}</p>
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">KM Inicial</p>
                                            <p className="text-sm font-bold text-gray-800">{kmInicial > 0 ? kmInicial.toLocaleString() : '-'}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">KM Final</p>
                                            <p className="text-sm font-bold text-gray-800">{kmFinal > 0 ? kmFinal.toLocaleString() : '-'}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Distância</p>
                                            <p className="text-sm font-bold text-blue-600">{distancia > 0 ? `${distancia.toLocaleString()} KM` : '-'}</p>
                                          </div>
                                          <div className="bg-white p-2.5 rounded-lg border border-gray-100">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">Média Consumo</p>
                                            <p className="text-sm font-bold text-green-600">{media ? `${media} KM/L` : '-'}</p>
                                          </div>
                                        </div>

                                        {fAbs.length === 0 && fDesp.length === 0 && fVal.length === 0 ? (
                                          <p className="text-xs text-gray-400 text-center py-2">Nenhum lançamento neste frete.</p>
                                        ) : (
                                          <div className="space-y-3">
                                            {fAbs.length > 0 && (
                                              <div>
                                                <p className="text-[9px] font-bold text-blue-600 uppercase mb-1.5 flex items-center gap-1">⛽ Abastecimentos</p>
                                                {fAbs.map((a, i) => (
                                                  <div key={`a-${i}`} className="flex justify-between items-center text-xs bg-white rounded px-3 py-1.5 border border-blue-100 mb-1">
                                                    <span className="text-gray-700">{a.posto} <span className="text-gray-400">({a.litros}L{a.arlaLitros ? ` + ARLA ${a.arlaLitros}L` : ''})</span></span>
                                                    <span className="font-bold text-gray-800">{formatCurrency(a.valorTotal)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                            {fDesp.length > 0 && (
                                              <div>
                                                <p className="text-[9px] font-bold text-red-500 uppercase mb-1.5 flex items-center gap-1">📋 Despesas</p>
                                                {fDesp.map((d, i) => (
                                                  <div key={`d-${i}`} className="flex justify-between items-center text-xs bg-white rounded px-3 py-1.5 border border-red-100 mb-1">
                                                    <span className="text-gray-700">{d.descricao || 'Despesa'}</span>
                                                    <span className="font-bold text-gray-800">{formatCurrency(d.valor)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                            {fVal.length > 0 && (
                                              <div>
                                                <p className="text-[9px] font-bold text-orange-500 uppercase mb-1.5 flex items-center gap-1">💰 Vales</p>
                                                {fVal.map((v, i) => (
                                                  <div key={`v-${i}`} className="flex justify-between items-center text-xs bg-white rounded px-3 py-1.5 border border-orange-100 mb-1">
                                                    <span className="text-gray-700">Vale</span>
                                                    <span className="font-bold text-orange-700">{formatCurrency(v.valor)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        <div className="flex justify-center mt-4">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              generatePDFSelected();
                                            }}
                                            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 transition-all active:scale-95 shadow-md"
                                          >
                                            <Download size={14} /> Gerar Relatório de Frete
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                      {fretes.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-gray-400 text-sm">Nenhum frete encontrado neste período.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedTripIds.length > 0 && (
                  <div className="flex justify-center mt-4">
                    <button
                      onClick={generatePDFSelected}
                      disabled={isGenerating}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95 ${
                        isGenerating
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                          : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100'
                      }`}
                    >
                      {isGenerating ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          Processando...
                        </>
                      ) : (
                        <>
                          <Download size={18} /> Gerar relatórios selecionados ({selectedTripIds.length})
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
