import React, { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { formatCurrency } from '../utils';
import { Calendar, Users, User, Download, Truck, DollarSign, ChevronLeft, ChevronRight, Fuel, FileText, TrendingUp, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../api';

const safeFmt = (d: any, fmt: string) => {
  if (!d) return '-';
  try { const dt = new Date(d); if (isNaN(dt.getTime())) return '-'; return format(dt, fmt); } catch { return '-'; }
};

class CatchError extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8">
          <h2 className="text-red-600 font-bold text-xl mb-4">Erro no ResumoMotorista</h2>
          <pre className="bg-red-50 p-4 rounded-lg text-red-800 text-sm overflow-auto max-h-96 whitespace-pre-wrap break-all">
            {this.state.error.message}{'\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}

export const ResumoMotorista: React.FC = () => {
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [selectedMot, setSelectedMot] = useState<string>('todos');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [fretesDetalhados, setFretesDetalhados] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [despesasDet, setDespesasDet] = useState<any[]>([]);
  const [abastecimentosDet, setAbastecimentosDet] = useState<any[]>([]);
  const [valesDet, setValesDet] = useState<any[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        const response = await api.get('/admin/motoristas');
        setMotoristas((response.data || []).map((m: any) => ({
          uid: m.id,
          nomeCompleto: m.usuarios.nome,
          percentualComissao: m.percentual_comissao,
          placa: m.placa_veiculo
        })));
      } catch (err) {
        console.error('Erro ao buscar motoristas:', err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    setSelectedTripId(null);
    if (motoristas.length > 0 || selectedMot !== 'todos') {
      loadData();
    }
  }, [selectedDate, selectedMot, motoristas]);

  const loadData = async () => {
    const date = new Date(selectedDate + '-01T12:00:00');
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    const sIso = start.toISOString();
    const eIso = end.toISOString();

    setLoading(true);
    try {
      let fretesUrl = '/fretes?data_inicio=' + sIso + '&data_fim=' + eIso;
      let despesasUrl = '/despesas?data_inicio=' + sIso + '&data_fim=' + eIso;
      let abastecimentosUrl = '/abastecimentos?data_inicio=' + sIso + '&data_fim=' + eIso;
      let valesUrl = '/vales?data_inicio=' + sIso + '&data_fim=' + eIso;

      if (selectedMot !== 'todos') {
        fretesUrl += '&motorista_id=' + selectedMot;
        despesasUrl += '&motorista_id=' + selectedMot;
        abastecimentosUrl += '&motorista_id=' + selectedMot;
        valesUrl += '&motorista_id=' + selectedMot;
      }

      const [fretesResult, despesasResult, abastecimentosResult, valesResult] = await Promise.all([
        api.get(fretesUrl),
        api.get(despesasUrl),
        api.get(abastecimentosUrl),
        api.get(valesUrl)
      ]);

      const fretesData = fretesResult.data || [];
      const despesasData = despesasResult.data || [];
      const abastecimentosData = abastecimentosResult.data || [];
      const valesData = valesResult.data || [];

      const fretes = (fretesData || []).filter((f: any) => f.status === 'finalizado').map((f: any) => ({
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
        data: f.data || f.criadoEm || f.criado_em
      }));

      setFretesDetalhados(fretes);

      const despesas = (despesasData || []).filter((d: any) => d.status === 'aprovado').map((d: any) => ({
        motoristaUid: d.motorista_id,
        valor: parseFloat(d.valor),
        descricao: d.descricao,
        tipo: d.tipo,
        quemPagou: d.quem_pagou,
        data: d.data,
        frete_id: d.frete_id
      }));

      const abastecimentos = (abastecimentosData || []).filter((a: any) => a.status === 'aprovado').map((a: any) => ({
        motoristaUid: a.motorista_id,
        valorTotal: parseFloat(a.valor_total),
        litros: parseFloat(a.litros),
        arlaLitros: a.arla_litros ? parseFloat(a.arla_litros) : null,
        arlaValor: a.arla_valor ? parseFloat(a.arla_valor) : null,
        posto: a.posto,
        quemPagou: a.quem_pagou,
        data: a.data,
        frete_id: a.frete_id
      }));

      const vales = (valesData || []).filter((v: any) => v.status === 'aprovado').map((v: any) => ({
        motoristaUid: v.motorista_id,
        valor: parseFloat(v.valor),
        posto: v.posto,
        litros: v.litros ? parseFloat(v.litros) : null,
        quemPagou: v.quem_pagou,
        data: v.data,
        frete_id: v.frete_id
      }));

      if (selectedMot !== 'todos') {
        setDespesasDet(despesas.filter((d: any) => d.motoristaUid === selectedMot));
        setAbastecimentosDet(abastecimentos.filter((a: any) => a.motoristaUid === selectedMot));
        setValesDet(vales.filter((v: any) => v.motoristaUid === selectedMot));
      } else {
        setDespesasDet([]);
        setAbastecimentosDet([]);
        setValesDet([]);
      }

      const targetMots = motoristas.filter(m => selectedMot === 'todos' || m.uid === selectedMot);

      const rawStats = targetMots.map(m => {
        const mFretes = fretes.filter((f: any) => f.motoristaUid === m.uid);
        const mDesp = despesas.filter((d: any) => d.motoristaUid === m.uid);
        const mAbs = abastecimentos.filter((a: any) => a.motoristaUid === m.uid);
        const mVal = vales.filter((v: any) => v.motoristaUid === m.uid);

        const totalFrete = mFretes.reduce((s: number, f: any) => s + f.valorFrete, 0);
        const comissao = totalFrete * ((m.percentualComissao || 0) / 100);
        const totalGastos = mDesp.reduce((s: number, d: any) => s + d.valor, 0) +
          mAbs.reduce((s: number, a: any) => s + a.valorTotal, 0) +
          mVal.reduce((s: number, v: any) => s + v.valor, 0);
        const saldoLiq = comissao - totalGastos;
        const totalKm = mFretes.reduce((s: number, f: any) => s + (f.km_final && f.km_inicial ? f.km_final - f.km_inicial : 0), 0);
        const totalLitros = mAbs.reduce((s: number, a: any) => s + a.litros, 0);
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

      setStats(rawStats);

      setTotals(rawStats.reduce((acc, s) => ({
        viagens: acc.viagens + s.viagens,
        totalFrete: acc.totalFrete + s.totalFrete,
        comissao: acc.comissao + s.comissao,
        totalGastos: acc.totalGastos + s.totalGastos,
        saldoLiq: acc.saldoLiq + s.saldoLiq,
        totalKm: acc.totalKm + s.totalKm,
        totalLitros: acc.totalLitros + s.totalLitros
      }), { viagens: 0, totalFrete: 0, comissao: 0, totalGastos: 0, saldoLiq: 0, totalKm: 0, totalLitros: 0 }));
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  const generatePDF = async () => {
    try {
      setIsGenerating(true);
      const doc = new jsPDF();
      const savedLogo = localStorage.getItem('choferlog_logo');
      const savedCompany = localStorage.getItem('choferlog_company');
      let company: any = null;
      try { company = savedCompany ? JSON.parse(savedCompany) : null; } catch (e) {}

      if (savedLogo) {
        try { doc.addImage(savedLogo, 'PNG', 12, 8, 35, 35); } catch (e) {}
      }

      doc.setFontSize(16).setFont("helvetica", "bold");
      if (company && company.nome) {
        doc.text(company.nome.toUpperCase(), 48, 14);
        doc.setFontSize(8).setFont("helvetica", "normal");
        doc.text(`${company.endereco || ''}, ${company.cidade || ''}-${company.estado || ''}`, 48, 22);
        doc.text(`CNPJ: ${company.cnpj || ''} | Tel: ${company.telefone || ''}`, 48, 28);
      } else {
        doc.text('CHOFER LOG - GESTÃO DE FROTAS', 48, 20);
      }

      const monthLabel = safeFmt(selectedDate + '-01T12:00:00', "MMMM 'de' yyyy");
      const motLabel = selectedMot === 'todos' ? 'TODOS OS MOTORISTAS' : (motoristas.find(m => m.uid === selectedMot)?.nomeCompleto || 'SELECIONADO');
      doc.setFontSize(14).setFont("helvetica", "bold");
      doc.text('RESUMO POR MOTORISTA', 105, 45, { align: 'center' });
      doc.setFontSize(10).setFont("helvetica", "normal");
      doc.text(`Período: ${monthLabel.toUpperCase()} | Motorista: ${motLabel}`, 14, 55);

      if (stats.length > 0) {
        const tableBody = stats.map(s => [
          s.nome,
          s.viagens.toString(),
          formatCurrency(s.totalFrete),
          formatCurrency(s.comissao),
          formatCurrency(s.totalGastos),
          formatCurrency(s.saldoLiq),
          `${s.media} KM/L`
        ]);

        autoTable(doc, {
          startY: 60,
          head: [['Motorista', 'Viagens', 'Total Frete', 'Comissão', 'Despesas', 'Saldo Líq.', 'Média']],
          body: tableBody,
          theme: 'striped',
          headStyles: { fillColor: [59, 130, 246] },
          foot: [[
            'TOTAIS',
            (totals?.viagens || 0).toString(),
            formatCurrency(totals?.totalFrete || 0),
            formatCurrency(totals?.comissao || 0),
            formatCurrency(totals?.totalGastos || 0),
            formatCurrency(totals?.saldoLiq || 0),
            `${totals?.totalLitros > 0 ? (totals.totalKm / totals.totalLitros).toFixed(2) : '0.00'} KM/L`
          ]],
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
        });

        if (selectedMot !== 'todos' && fretesDetalhados.length > 0) {
          doc.addPage();
          doc.setFontSize(14).setFont("helvetica", "bold");
          doc.text(`VIAGENS DETALHADAS - ${motLabel}`, 14, 15);

          autoTable(doc, {
            startY: 20,
            head: [['Data', 'Rota', 'Placa', 'Valor Frete', 'KM Inicial', 'KM Final', 'Distância', 'Média', 'Status']],
            body: fretesDetalhados.map(f => {
              const dist = (f.km_final && f.km_inicial) ? f.km_final - f.km_inicial : 0;
              const fAbs = abastecimentosDet.filter(a => a.frete_id === f.id);
              const litrosTotal = fAbs.reduce((s, a) => s + a.litros, 0);
              const media = litrosTotal > 0 && dist > 0 ? (dist / litrosTotal).toFixed(2) : '-';
              return [
                safeFmt(f.data, 'dd/MM/yyyy'),
                `${f.origem} > ${f.destino}`,
                f.placa || '-',
                formatCurrency(f.valorFrete),
                f.km_inicial ? f.km_inicial.toLocaleString() : '-',
                f.km_final ? f.km_final.toLocaleString() : '-',
                dist > 0 ? `${dist} KM` : '-',
                media,
                f.status ? f.status.toUpperCase() : ''
              ];
            }),
            headStyles: { fillColor: [71, 85, 105] }
          });
        } else if (selectedMot === 'todos') {
          motoristas.forEach(m => {
            const mFretes = fretesDetalhados.filter(f => f.motoristaUid === m.uid);
            if (mFretes.length === 0) return;

            doc.addPage();
            doc.setFontSize(13).setFont("helvetica", "bold");
            doc.text(`VIAGENS: ${m.nomeCompleto.toUpperCase()}`, 14, 15);

            autoTable(doc, {
              startY: 20,
              head: [['Data', 'Rota', 'Placa', 'Valor Frete', 'KM Inicial', 'KM Final', 'Distância', 'Status']],
              body: mFretes.map(f => {
                const dist = (f.km_final && f.km_inicial) ? f.km_final - f.km_inicial : 0;
                return [
                  safeFmt(f.data, 'dd/MM/yyyy'),
                  `${f.origem} > ${f.destino}`,
                  f.placa || '-',
                  formatCurrency(f.valorFrete),
                  f.km_inicial ? f.km_inicial.toLocaleString() : '-',
                  f.km_final ? f.km_final.toLocaleString() : '-',
                  dist > 0 ? `${dist} KM` : '-',
                  f.status ? f.status.toUpperCase() : ''
                ];
              }),
              headStyles: { fillColor: [71, 85, 105] }
            });
          });
        }
      }

      doc.save(`Resumo_Motorista_${selectedMot}_${monthLabel}.pdf`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o relatório.');
    } finally {
      setIsGenerating(false);
    }
  };

  const gerarPDFViagem = async (trip: any) => {
    try {
      setIsGenerating(true);
      const doc = new jsPDF();
      const savedLogo = localStorage.getItem('choferlog_logo');
      const savedCompany = localStorage.getItem('choferlog_company');
      let company: any = null;
      try { company = savedCompany ? JSON.parse(savedCompany) : null; } catch (e) {}

      if (savedLogo) {
        try { doc.addImage(savedLogo, 'PNG', 12, 8, 35, 35); } catch (e) {}
      }

      doc.setFontSize(16).setFont("helvetica", "bold");
      if (company && company.nome) {
        doc.text(company.nome.toUpperCase(), 48, 14);
        doc.setFontSize(8).setFont("helvetica", "normal");
        doc.text(`${company.endereco || ''}, ${company.cidade || ''}-${company.estado || ''}`, 48, 22);
        doc.text(`CNPJ: ${company.cnpj || ''} | Tel: ${company.telefone || ''}`, 48, 28);
      } else {
        doc.text('CHOFER LOG - GESTÃO DE FROTAS', 48, 20);
      }

      doc.setFontSize(18).setFont("helvetica", "bold");
      doc.text('RELATÓRIO DE VIAGEM', 105, 42, { align: 'center' });

      const fDesp = despesasDet.filter(d => d.frete_id === trip.id);
      const fAbs = abastecimentosDet.filter(a => a.frete_id === trip.id);
      const fVales = valesDet.filter(v => v.frete_id === trip.id);

      const motInfo = motoristas.find(m => m.uid === selectedMot);
      const motNome = motInfo?.nomeCompleto || trip.motoristaNome || 'N/A';

      autoTable(doc, {
        startY: 50,
        body: [
          ['Rota:', `${trip.origem} → ${trip.destino}`],
          ['Data:', safeFmt(trip.data, 'dd/MM/yyyy')],
          ['Motorista:', motNome],
          ['Placa:', trip.placa || '-'],
          ['Valor Frete:', formatCurrency(trip.valorFrete)],
          ['Quem Recebeu:', trip.quemRecebeu === 'proprietario' ? 'Proprietário' : trip.quemRecebeu === 'motorista' ? 'Motorista' : '-'],
          ['Status:', trip.status?.toUpperCase() || '-'],
        ],
        theme: 'plain',
        styles: { fontSize: 10 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 }, 1: { cellWidth: 95 } },
      });

      const yAfter = (doc as any).lastAutoTable.finalY + 10;

      if (trip.km_inicial || trip.km_final) {
        const dist = trip.km_final && trip.km_inicial ? trip.km_final - trip.km_inicial : 0;
        autoTable(doc, {
          startY: yAfter,
          body: [
            ['KM Inicial:', trip.km_inicial?.toString() || '-'],
            ['KM Final:', trip.km_final?.toString() || '-'],
            ['Distância:', dist > 0 ? `${dist.toLocaleString()} km` : '-'],
          ],
          theme: 'plain',
          styles: { fontSize: 10 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 35 }, 1: { cellWidth: 100 } },
        });
      }

      const finalY = (doc as any).lastAutoTable?.finalY || yAfter;

      if (fAbs.length > 0) {
        autoTable(doc, {
          startY: finalY + 10,
          head: [['Abastecimentos', 'Litros', 'ARLA', 'Valor']],
          body: fAbs.map(a => [
            a.posto || '-',
            `${a.litros.toFixed(1)}L`,
            a.arlaLitros ? `${a.arlaLitros.toFixed(1)}L (${formatCurrency(a.arlaValor)})` : '-',
            formatCurrency(a.valorTotal)
          ]),
          foot: [[
            'TOTAL',
            `${fAbs.reduce((s, a) => s + a.litros, 0).toFixed(1)}L`,
            fAbs.some(a => a.arlaValor) ? formatCurrency(fAbs.reduce((s, a) => s + (a.arlaValor || 0), 0)) : '-',
            formatCurrency(fAbs.reduce((s, a) => s + a.valorTotal, 0))
          ]],
          headStyles: { fillColor: [59, 130, 246] },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
        });
      }

      const yAbs = (doc as any).lastAutoTable?.finalY || finalY;

      if (fDesp.length > 0) {
        autoTable(doc, {
          startY: yAbs + 10,
          head: [['Despesas', 'Tipo', 'Quem Pagou', 'Valor']],
          body: fDesp.map(d => [
            d.descricao,
            d.tipo || '-',
            d.quemPagou === 'proprietario' ? 'Proprietário' : d.quemPagou === 'motorista' ? 'Motorista' : '-',
            formatCurrency(d.valor)
          ]),
          foot: [['TOTAL', '', '', formatCurrency(fDesp.reduce((s, d) => s + d.valor, 0))]],
          headStyles: { fillColor: [239, 68, 68] },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
        });
      }

      const yDesp = (doc as any).lastAutoTable?.finalY || yAbs;

      if (fVales.length > 0) {
        autoTable(doc, {
          startY: yDesp + 10,
          head: [['Vales', 'Posto', 'Litros', 'Quem Pagou', 'Valor']],
          body: fVales.map(v => [
            'Vale',
            v.posto || '-',
            v.litros ? `${v.litros.toFixed(1)}L` : '-',
            v.quemPagou === 'proprietario' ? 'Proprietário' : v.quemPagou === 'motorista' ? 'Motorista' : '-',
            formatCurrency(v.valor)
          ]),
          foot: [['TOTAL', '', '', '', formatCurrency(fVales.reduce((s, v) => s + v.valor, 0))]],
          headStyles: { fillColor: [249, 115, 22] },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
        });
      }

      const ySummary = (doc as any).lastAutoTable?.finalY || yDesp;
      const totalGastos = fDesp.reduce((s, d) => s + d.valor, 0) + fAbs.reduce((s, a) => s + a.valorTotal, 0) + fVales.reduce((s, v) => s + v.valor, 0);
      const percentComissao = motInfo?.percentualComissao || 0;
      const valorComissao = trip.valorFrete * (percentComissao / 100);
      const saldoMotorista = valorComissao - totalGastos;

      autoTable(doc, {
        startY: ySummary + 15,
        body: [
          ['RESUMO FINANCEIRO', '', ''],
          ['Valor do Frete', formatCurrency(trip.valorFrete), ''],
          [`Comissão (${percentComissao}%)`, formatCurrency(valorComissao), ''],
          ['Total Despesas', formatCurrency(totalGastos), ''],
          ['SALDO DO MOTORISTA', formatCurrency(saldoMotorista), ''],
        ],
        theme: 'plain',
        styles: { fontSize: 11 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { cellWidth: 40 } },
      });
      (doc as any).lastAutoTable?.rows?.forEach((row: any, i: number) => {
        if (i === 0 || i === 4) {
          row.cells.forEach((cell: any) => { cell.styles.fontStyle = 'bold'; cell.styles.fontSize = 12; });
        }
      });

      doc.save(`Viagem_${trip.origem}_${trip.destino}_${safeFmt(trip.data, 'ddMMyyyy')}.pdf`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o relatório.');
    } finally {
      setIsGenerating(false);
    }
  };

  const renderDetalheViagem = () => {
    const trip = fretesDetalhados.find(f => f.id === selectedTripId);
    if (!trip) {
      return (
        <div className="py-20 text-center text-gray-500">
          <Truck size={48} className="mx-auto mb-3 text-gray-300" />
          <p>Carregando dados da viagem...</p>
        </div>
      );
    }

    const fDesp = despesasDet.filter(d => d.frete_id === trip.id);
    const fAbs = abastecimentosDet.filter(a => a.frete_id === trip.id);
    const fVales = valesDet.filter(v => v.frete_id === trip.id);
    const dist = trip.km_final && trip.km_inicial ? trip.km_final - trip.km_inicial : 0;
    const litrosTotal = fAbs.reduce((s, a) => s + a.litros, 0);
    const media = litrosTotal > 0 && dist > 0 ? (dist / litrosTotal).toFixed(2) : null;
    const totalDesp = fDesp.reduce((s, d) => s + d.valor, 0);
    const totalAbs = fAbs.reduce((s, a) => s + a.valorTotal, 0);
    const totalVales = fVales.reduce((s, v) => s + v.valor, 0);
    const totalGastos = totalDesp + totalAbs + totalVales;
    const saldo = trip.valorFrete - totalGastos;

    return (
      <>
        <button onClick={() => setSelectedTripId(null)} className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors">
          <ChevronLeft size={20} className="mr-1" /> Voltar para Viagens
        </button>

        <div className="bg-blue-600 p-6 rounded-xl shadow-lg text-white">
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <h2 className="text-2xl font-bold">{trip.origem} → {trip.destino}</h2>
              <p className="text-blue-200 text-sm mt-1">
                {safeFmt(trip.data, 'dd/MM/yyyy')} • {trip.placa || '-'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black">{formatCurrency(trip.valorFrete)}</p>
              <span className={`inline-block mt-1 px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                trip.status === 'finalizado' ? 'bg-green-500' :
                trip.status === 'ativo' ? 'bg-blue-400' :
                trip.status === 'cancelado' ? 'bg-red-500' :
                'bg-yellow-500'
              }`}>{trip.status}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">KM Inicial</p>
            <p className="text-xl font-bold text-gray-800">{trip.km_inicial ? trip.km_inicial.toLocaleString() : '-'}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">KM Final</p>
            <p className="text-xl font-bold text-gray-800">{trip.km_final ? trip.km_final.toLocaleString() : '-'}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Distância</p>
            <p className="text-xl font-bold text-blue-600">{dist > 0 ? `${dist.toLocaleString()} km` : '-'}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Média Consumo</p>
            <p className="text-xl font-bold text-green-600">{media ? `${media} km/l` : '-'}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-700 flex items-center">
              <FileText size={18} className="mr-2 text-blue-600" /> Lançamentos da Viagem
            </h3>
          </div>
          {fAbs.length === 0 && fDesp.length === 0 && fVales.length === 0 ? (
            <div className="p-6 text-center text-gray-400">Nenhum lançamento registrado para esta viagem.</div>
          ) : (
            <div className="p-4 space-y-4">
              {fAbs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-2 flex items-center"><Fuel size={14} className="mr-1" /> Abastecimentos</p>
                  {fAbs.map((a, i) => (
                    <div key={`a-${i}`} className="flex justify-between items-center text-sm bg-blue-50/50 rounded-lg px-3 py-2 border border-blue-100 mb-1">
                      <span className="text-gray-700">{a.posto} <span className="text-gray-400">({a.litros.toFixed(1)}L)</span></span>
                      <span className="font-bold text-gray-800">{formatCurrency(a.valorTotal)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-sm font-bold text-gray-800 bg-blue-100/50 rounded-lg px-3 py-2 mt-1">
                    <span>Total Abastecimentos ({litrosTotal.toFixed(1)}L)</span>
                    <span>{formatCurrency(totalAbs)}</span>
                  </div>
                </div>
              )}
              {fDesp.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-red-500 uppercase mb-2 flex items-center"><FileText size={14} className="mr-1" /> Despesas</p>
                  {fDesp.map((d, i) => (
                    <div key={`d-${i}`} className="flex justify-between items-center text-sm bg-red-50/50 rounded-lg px-3 py-2 border border-red-100 mb-1">
                      <span className="text-gray-700">{d.descricao}</span>
                      <span className="font-bold text-gray-800">{formatCurrency(d.valor)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-sm font-bold text-gray-800 bg-red-100/50 rounded-lg px-3 py-2 mt-1">
                    <span>Total Despesas</span>
                    <span>{formatCurrency(totalDesp)}</span>
                  </div>
                </div>
              )}
              {fVales.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-orange-500 uppercase mb-2 flex items-center"><DollarSign size={14} className="mr-1" /> Vales / Adiantamentos</p>
                  {fVales.map((v, i) => (
                    <div key={`v-${i}`} className="flex justify-between items-center text-sm bg-orange-50/50 rounded-lg px-3 py-2 border border-orange-100 mb-1">
                      <span className="text-gray-700">Vale</span>
                      <span className="font-bold text-orange-700">{formatCurrency(v.valor)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-sm font-bold text-gray-800 bg-orange-100/50 rounded-lg px-3 py-2 mt-1">
                    <span>Total Vales</span>
                    <span>{formatCurrency(totalVales)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h4 className="flex items-center text-gray-800 mb-4 font-bold text-lg">
            <TrendingUp className="mr-2 text-green-600" size={20} /> Resumo Financeiro
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-500">Valor do Frete</span>
              <span className="font-bold text-gray-800">{formatCurrency(trip.valorFrete)}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-500">Comissão do Motorista</span>
              <span className="font-bold text-green-600">{formatCurrency(trip.valorFrete * ((motoristas.find(m => m.uid === selectedMot)?.percentualComissao || 0) / 100))}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-500">Total de Gastos</span>
              <span className="font-bold text-red-600">-{formatCurrency(totalGastos)}</span>
            </div>
            <div className="flex justify-between items-center text-base font-extrabold bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-700">SALDO DA VIAGEM</span>
              <span className={saldo >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(Math.abs(saldo))}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => gerarPDFViagem(trip)}
            disabled={isGenerating}
            className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
          >
            <Printer size={20} className="mr-2" />
            {isGenerating ? 'Gerando...' : 'Imprimir Relatório desta Viagem'}
          </button>
        </div>
      </>
    );
  };

  return (
    <CatchError>
    <div className="space-y-6 pb-20 px-6">
      {selectedTripId ? renderDetalheViagem() : (<>
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Resumo por Motorista</h2>
          <p className="text-gray-500 text-sm">Acompanhamento financeiro consolidado</p>
        </div>
        {stats.length > 0 && (
          <button
            onClick={generatePDF}
            disabled={isGenerating}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95 font-bold text-sm disabled:opacity-50"
          >
            <Download size={18} className="mr-2" />
            {isGenerating ? 'Gerando...' : 'Gerar Relatório PDF'}
          </button>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap items-center gap-4">
        <div className="flex items-center space-x-2">
          <Calendar size={18} className="text-gray-400" />
          <input
            type="month"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="border rounded-lg p-2 outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Users size={18} className="text-gray-400" />
          <select
            value={selectedMot}
            onChange={e => setSelectedMot(e.target.value)}
            className="border rounded-lg p-2 outline-none bg-white"
          >
            <option value="todos">Todos os Motoristas</option>
            {motoristas.map(m => (
              <option key={m.uid} value={m.uid}>{m.nomeCompleto}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-500">Carregando dados...</div>
      ) : stats.length === 0 && fretesDetalhados.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-gray-100 text-center text-gray-400">
          <Truck size={48} className="mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">Nenhum dado encontrado para este período.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Viagens</p>
              <p className="text-2xl font-black text-gray-800">{totals?.viagens ?? 0}</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
              <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Total Frete</p>
              <p className="text-2xl font-black text-blue-700">{formatCurrency(totals?.totalFrete ?? 0)}</p>
            </div>
            <div className="p-4 bg-green-50 rounded-2xl border border-green-100">
              <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Comissões</p>
              <p className="text-2xl font-black text-green-700">{formatCurrency(totals?.comissao ?? 0)}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
              <p className="text-[10px] font-bold text-red-600 uppercase mb-1">Despesas</p>
              <p className="text-2xl font-black text-red-700">{formatCurrency(totals?.totalGastos ?? 0)}</p>
            </div>
            <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
              <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Saldo Líq.</p>
              <p className={`text-2xl font-black ${(totals?.saldoLiq ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatCurrency(totals?.saldoLiq ?? 0)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {selectedMot !== 'todos' && fretesDetalhados.length > 0 ? (
              <div>
                <div className="bg-gray-50 p-4 border-b border-gray-100">
                  <h3 className="font-bold text-gray-700 flex items-center">
                    <Truck size={18} className="mr-2 text-blue-600" />
                    Viagens de {motoristas.find(m => m.uid === selectedMot)?.nomeCompleto || 'Motorista'}
                  </h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {fretesDetalhados.map(f => {
                    const dist = f.km_final && f.km_inicial ? f.km_final - f.km_inicial : 0;

                    return (
                      <div
                        key={f.id}
                        onClick={() => setSelectedTripId(f.id)}
                        className="cursor-pointer transition-colors hover:bg-blue-50/50"
                      >
                        <div className="flex items-center justify-between p-4">
                          <div className="flex items-center space-x-4 flex-1 min-w-0">
                            <div className="text-gray-400 flex-shrink-0">
                              <ChevronRight size={20} />
                            </div>
                            <div className="flex-shrink-0 w-10 text-center">
                              <span className="text-xs font-bold text-gray-500">{safeFmt(f.data, 'dd')}</span>
                              <p className="text-[9px] text-gray-400 uppercase">{safeFmt(f.data, 'MMM')}</p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-800 truncate">{f.origem} → {f.destino}</p>
                              <p className="text-xs text-gray-400">
                                {f.placa} {dist > 0 ? ` • ${(dist || 0).toLocaleString()} km` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 flex-shrink-0">
                            <span className="font-bold text-gray-800">{formatCurrency(f.valorFrete)}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              f.status === 'finalizado' ? 'bg-green-100 text-green-700' :
                              f.status === 'ativo' ? 'bg-blue-100 text-blue-700' :
                              f.status === 'cancelado' ? 'bg-red-100 text-red-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>{f.status}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const unlinkedDesp = despesasDet.filter(d => !d.frete_id);
                  const unlinkedAbs = abastecimentosDet.filter(a => !a.frete_id);
                  const unlinkedVales = valesDet.filter(v => !v.frete_id);
                  if (unlinkedDesp.length === 0 && unlinkedAbs.length === 0 && unlinkedVales.length === 0) return null;
                  return (
                    <div className="border-t border-gray-100">
                      <div className="bg-gray-50 p-4 border-b border-gray-100">
                        <h3 className="font-bold text-gray-700 flex items-center">
                          <FileText size={18} className="mr-2 text-blue-600" />
                          Lançamentos Gerais (sem viagem vinculada)
                        </h3>
                      </div>
                      <div className="p-4 space-y-2">
                        {unlinkedAbs.map((a, i) => (
                          <div key={`ul-abs-${i}`} className="flex justify-between items-center text-sm bg-blue-50/50 rounded-lg px-3 py-2 border border-blue-100">
                            <span className="text-gray-700"><Fuel size={14} className="inline mr-1 text-blue-500" />{a.posto} <span className="text-gray-400">({a.litros}L)</span></span>
                            <span className="font-bold text-gray-700">{formatCurrency(a.valorTotal)}</span>
                          </div>
                        ))}
                        {unlinkedDesp.map((d, i) => (
                          <div key={`ul-desp-${i}`} className="flex justify-between items-center text-sm bg-orange-50/50 rounded-lg px-3 py-2 border border-orange-100">
                            <span className="text-gray-700"><FileText size={14} className="inline mr-1 text-orange-500" />{d.descricao}</span>
                            <span className="font-bold text-gray-700">{formatCurrency(d.valor)}</span>
                          </div>
                        ))}
                        {unlinkedVales.map((v, i) => (
                          <div key={`ul-vale-${i}`} className="flex justify-between items-center text-sm bg-red-50/50 rounded-lg px-3 py-2 border border-red-100">
                            <span className="text-gray-700"><DollarSign size={14} className="inline mr-1 text-red-500" />Vale</span>
                            <span className="font-bold text-red-600">{formatCurrency(v.valor)}</span>
                          </div>
                        ))}
                        {(() => {
                          const total = [...unlinkedDesp, ...unlinkedAbs, ...unlinkedVales].reduce((s, i) => s + (i.valor || i.valorTotal || 0), 0);
                          return (
                            <div className="flex justify-between items-center text-sm font-bold text-gray-800 border-t border-gray-200 pt-2 mt-2">
                              <span>Total Geral</span>
                              <span className="text-red-600">{formatCurrency(total)}</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-[10px] font-bold uppercase text-gray-400 border-b">
                  <tr>
                    <th className="p-4">Motorista</th>
                    <th className="p-4 text-right">Viagens</th>
                    <th className="p-4 text-right">Total Frete</th>
                    <th className="p-4 text-right">Comissão</th>
                    <th className="p-4 text-right">Despesas</th>
                    <th className="p-4 text-right">Saldo Líq.</th>
                    <th className="p-4 text-right">KM Total</th>
                    <th className="p-4 text-right">Média</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.map(s => (
                    <tr key={s.uid} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center">
                          <User size={16} className="mr-2 text-blue-500" />
                          <span className="font-semibold text-gray-800">{s.nome}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right font-bold text-gray-700">{s.viagens}</td>
                      <td className="p-4 text-right font-bold text-gray-700">{formatCurrency(s.totalFrete)}</td>
                      <td className="p-4 text-right font-bold text-green-600">{formatCurrency(s.comissao)}</td>
                      <td className="p-4 text-right font-bold text-red-600">{formatCurrency(s.totalGastos)}</td>
                      <td className={`p-4 text-right font-bold ${s.saldoLiq >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatCurrency(s.saldoLiq)}
                      </td>
                      <td className="p-4 text-right text-gray-600">{s.totalKm ? s.totalKm.toLocaleString() : 0} km</td>
                      <td className="p-4 text-right text-gray-600">{s.media ?? '-'} km/l</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr>
                    <td className="p-4 font-black text-gray-800">TOTAIS</td>
                    <td className="p-4 text-right font-black text-gray-800">{totals?.viagens ?? 0}</td>
                    <td className="p-4 text-right font-black text-gray-800">{formatCurrency(totals?.totalFrete)}</td>
                    <td className="p-4 text-right font-black text-green-700">{formatCurrency(totals?.comissao)}</td>
                    <td className="p-4 text-right font-black text-red-700">{formatCurrency(totals?.totalGastos)}</td>
                    <td className={`p-4 text-right font-black ${(totals?.saldoLiq ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(totals?.saldoLiq)}
                    </td>
                    <td className="p-4 text-right font-black text-gray-800">{(totals?.totalKm ?? 0).toLocaleString()} km</td>
                    <td className="p-4 text-right font-black text-gray-800">
                      {totals?.totalLitros > 0 ? (totals.totalKm / totals.totalLitros).toFixed(2) : '0.00'} km/l
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
      </>)}
    </div>
    </CatchError>
  );
};
