import React, { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
  const [motoristaBusca, setMotoristaBusca] = useState<string>('');
  const [motoristaAberto, setMotoristaAberto] = useState<boolean>(false);
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
  // Lançamentos da viagem aberta — buscados por frete_id direto na API (modelo do app).
  // Independe do mês do lançamento; os arrays mensais continuam alimentando stats/totais.
  const [tripDesp, setTripDesp] = useState<any[]>([]);
  const [tripAbs, setTripAbs] = useState<any[]>([]);
  const [tripVales, setTripVales] = useState<any[]>([]);
  // Rejeitados da viagem — exibidos só para auditoria (Etapas C/D).
  // NUNCA entram nos cálculos; no PDF aparecem apenas na seção
  // "LANÇAMENTOS REJEITADOS — FORA DOS CÁLCULOS", sem totais.
  const [tripDespRej, setTripDespRej] = useState<any[]>([]);
  const [tripAbsRej, setTripAbsRej] = useState<any[]>([]);
  const [tripValesRej, setTripValesRej] = useState<any[]>([]);
  // true enquanto os 3 GETs por frete_id estão em voo — bloqueia o PDF de sair vazio
  const [tripLoading, setTripLoading] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const response = await api.get('/admin/motoristas');
        setMotoristas((response.data || []).map((m: any) => ({
          uid: m.id,
          nomeCompleto: m.usuarios.nome,
          percentualComissao: m.percentual_comissao,
          placa: m.placa_veiculo,
          empresaTipo: m.empresa_tipo
        })).sort((a: any, b: any) => (a.nomeCompleto || '').localeCompare(b.nomeCompleto || '')));
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

  // Histórico: aprovado e finalizado entram; pendente fica fora; rejeitado entra na etapa de auditoria (C)
  useEffect(() => {
    // Limpa imediatamente: ao trocar de viagem, nada da anterior pode aparecer
    // na tela nem entrar num PDF gerado durante o carregamento.
    setTripDesp([]); setTripAbs([]); setTripVales([]);
    setTripDespRej([]); setTripAbsRej([]); setTripValesRej([]);
    // Desliga o loading aqui também: se o efeito anterior foi cancelado (vivo=false),
    // o finally dele não roda — sem isso, "Voltar para Motoristas" durante o fetch
    // deixaria tripLoading preso em true.
    setTripLoading(false);
    if (!selectedTripId) return;
    setTripLoading(true);
    let vivo = true;
    (async () => {
      try {
        const [rd, ra, rv] = await Promise.all([
          api.get('/despesas?frete_id=' + selectedTripId),
          api.get('/abastecimentos?frete_id=' + selectedTripId),
          api.get('/vales?frete_id=' + selectedTripId),
        ]);
        if (!vivo) return;
        const resolvido = (s: string) => s === 'aprovado' || s === 'finalizado';
        const rejeitado = (s: string) => s === 'rejeitado';
        const mapDesp = (d: any) => ({
          valor: parseFloat(d.valor), descricao: d.descricao, tipo: d.tipo,
          quemPagou: d.quem_pagou, data: d.data, frete_id: d.frete_id,
          fotoUrl: d.foto_url, obsResolucao: d.obs_resolucao
        });
        const mapAbs = (a: any) => ({
          valorTotal: parseFloat(a.valor_total), litros: parseFloat(a.litros),
          arlaLitros: a.arla_litros ? parseFloat(a.arla_litros) : null,
          arlaValor: a.arla_valor ? parseFloat(a.arla_valor) : null,
          posto: a.posto, quemPagou: a.quem_pagou, data: a.data, frete_id: a.frete_id,
          fotoUrl: a.foto_url, obsResolucao: a.obs_resolucao
        });
        const mapVale = (v: any) => ({
          valor: parseFloat(v.valor), descricao: v.descricao || v.posto || '',
          posto: v.posto, quemPagou: v.quem_pagou, data: v.data, frete_id: v.frete_id,
          obsResolucao: v.obs_resolucao
        });
        setTripDesp((rd.data || []).filter((d: any) => resolvido(d.status)).map(mapDesp));
        setTripAbs((ra.data || []).filter((a: any) => resolvido(a.status)).map(mapAbs));
        setTripVales((rv.data || []).filter((v: any) => resolvido(v.status)).map(mapVale));
        // Rejeitados: auditoria apenas — fora de todo cálculo e do PDF. Pendentes continuam fora.
        setTripDespRej((rd.data || []).filter((d: any) => rejeitado(d.status)).map(mapDesp));
        setTripAbsRej((ra.data || []).filter((a: any) => rejeitado(a.status)).map(mapAbs));
        setTripValesRej((rv.data || []).filter((v: any) => rejeitado(v.status)).map(mapVale));
      } catch (err) {
        console.error('Erro ao carregar lançamentos da viagem:', err);
      } finally {
        if (vivo) setTripLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [selectedTripId]);

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

      // PR7-base: o Histórico só considera fretes FINALIZADOS do período. Os lançamentos só entram
      // nos TOTAIS do resumo se vinculados a um desses fretes (frete_id no Set abaixo). Lançamentos de
      // fretes ativos/em andamento e órfãos (sem frete_id) ficam FORA dos totais. A seção
      // "Lançamentos Gerais (sem frete vinculado)" segue exibindo os órfãos apenas como sinalização.
      const fretesFinalizadosIds = new Set(fretes.map((f: any) => f.id));

      // Histórico: inclui aprovados E finalizados (ao finalizar a viagem, itens aprovados viram 'finalizado').
      // Pendentes/rejeitados ficam fora (rejeitados em auditoria = bloco próprio).
      const despesas = (despesasData || []).filter((d: any) => d.status === 'aprovado' || d.status === 'finalizado').map((d: any) => ({
        motoristaUid: d.motorista_id,
        valor: parseFloat(d.valor),
        descricao: d.descricao,
        tipo: d.tipo,
        quemPagou: d.quem_pagou,
        data: d.data,
        frete_id: d.frete_id,
        fotoUrl: d.foto_url
      }));

      const abastecimentos = (abastecimentosData || []).filter((a: any) => a.status === 'aprovado' || a.status === 'finalizado').map((a: any) => ({
        motoristaUid: a.motorista_id,
        valorTotal: parseFloat(a.valor_total),
        litros: parseFloat(a.litros),
        arlaLitros: a.arla_litros ? parseFloat(a.arla_litros) : null,
        arlaValor: a.arla_valor ? parseFloat(a.arla_valor) : null,
        posto: a.posto,
        quemPagou: a.quem_pagou,
        data: a.data,
        frete_id: a.frete_id,
        fotoUrl: a.foto_url
      }));

      const vales = (valesData || []).filter((v: any) => v.status === 'aprovado' || v.status === 'finalizado').map((v: any) => ({
        motoristaUid: v.motorista_id,
        valor: parseFloat(v.valor),
        // Vale: descricao correto; posto é fallback p/ registros antigos
        descricao: v.descricao || v.posto || '',
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
        // PR7-base: além do motorista, só entram lançamentos vinculados a frete finalizado do período.
        const mDesp = despesas.filter((d: any) => d.motoristaUid === m.uid && d.frete_id && fretesFinalizadosIds.has(d.frete_id));
        const mAbs = abastecimentos.filter((a: any) => a.motoristaUid === m.uid && a.frete_id && fretesFinalizadosIds.has(a.frete_id));
        const mVal = vales.filter((v: any) => v.motoristaUid === m.uid && v.frete_id && fretesFinalizadosIds.has(v.frete_id));

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
      const savedLogo = localStorage.getItem('matopibalog_logo');
      const savedCompany = localStorage.getItem('matopibalog_company');
      let company: any = null;
      try { company = savedCompany ? JSON.parse(savedCompany) : null; } catch (e) {}

      if (savedLogo) {
        try {
          const img = new Image();
          img.src = savedLogo;
          const maxW = 35, maxH = 20;
          const ratio = Math.min(maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
          const w = (img.naturalWidth || maxW) * ratio;
          const h = (img.naturalHeight || maxH) * ratio;
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

      const monthLabel = format(new Date(selectedDate + '-01T12:00:00'), "MMMM 'de' yyyy", { locale: ptBR });
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
          head: [['Motorista', 'Fretes', 'Total Frete', 'Comissão', 'Despesas', 'Saldo Líq.', 'Média']],
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
          doc.text(`FRETES DETALHADOS - ${motLabel}`, 14, 15);

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
            doc.text(`FRETES: ${m.nomeCompleto.toUpperCase()}`, 14, 15);

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
      const savedLogo = localStorage.getItem('matopibalog_logo');
      const savedCompany = localStorage.getItem('matopibalog_company');
      let company: any = null;
      try { company = savedCompany ? JSON.parse(savedCompany) : null; } catch (e) {}

      if (savedLogo) {
        try {
          const img = new Image();
          img.src = savedLogo;
          const maxW = 35, maxH = 20;
          const ratio = Math.min(maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
          const w = (img.naturalWidth || maxW) * ratio;
          const h = (img.naturalHeight || maxH) * ratio;
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

      doc.setFontSize(18).setFont("helvetica", "bold");
      doc.text('RELATÓRIO DE FRETE', 105, 42, { align: 'center' });
      doc.setFontSize(8).setFont("helvetica", "normal");
      doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 105, 47, { align: 'center' });

      // Mesmos arrays do detalhe aberto (por frete_id) — tela e PDF sempre iguais
      const fDesp = tripDesp;
      const fAbs = tripAbs;
      const fVales = tripVales;

      // Linha extra de auditoria (justificativa/comprovante) abaixo do item,
      // em colSpan na largura total — não espreme colunas e não afeta totais:
      // os foots somam o ARRAY de dados, nunca as linhas da tabela.
      const montarBody = (
        itens: any[],
        linhaPrincipal: (item: any) => any[],
        colunas: number,
        comComprovante: boolean,
        justificativaObrigatoria = false
      ) => {
        const body: any[] = [];
        const links: Record<number, string> = {};
        itens.forEach(item => {
          body.push(linhaPrincipal(item));
          const partes: string[] = [];
          const obs = item.obsResolucao || (justificativaObrigatoria ? 'Sem justificativa informada' : '');
          if (obs) partes.push(`Justificativa: ${obs}`);
          if (comComprovante && item.fotoUrl) partes.push('Ver comprovante');
          if (partes.length > 0) {
            if (comComprovante && item.fotoUrl) links[body.length] = item.fotoUrl;
            body.push([{
              content: partes.join('   •   '),
              colSpan: colunas,
              styles: { fontSize: 8, textColor: [100, 116, 139], fontStyle: 'italic' }
            }]);
          }
        });
        return { body, links };
      };
      // Torna a linha com "Ver comprovante" clicável sem imprimir a URL crua.
      const linkComprovante = (links: Record<number, string>) => (data: any) => {
        const url = links[data.row.index];
        if (data.section === 'body' && url) {
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
        }
      };

      const motInfo = motoristas.find(m => m.uid === selectedMot);
      const motNome = motInfo?.nomeCompleto || trip.motoristaNome || 'N/A';

      autoTable(doc, {
        startY: 50,
        body: [
          ['Rota:', `${trip.origem} > ${trip.destino}`],
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

      if (Number.isFinite(trip.km_inicial) || Number.isFinite(trip.km_final)) {
        // PR7A: km_inicial/km_final vêm de parseFloat e podem ser NaN quando ausentes.
        // NaN não é nullish, então `?.toString() || '-'` exibia "NaN" — usar Number.isFinite.
        const dist = Number.isFinite(trip.km_final) && Number.isFinite(trip.km_inicial) ? trip.km_final - trip.km_inicial : 0;
        autoTable(doc, {
          startY: yAfter,
          body: [
            ['KM Inicial:', Number.isFinite(trip.km_inicial) ? trip.km_inicial.toLocaleString() : '-'],
            ['KM Final:', Number.isFinite(trip.km_final) ? trip.km_final.toLocaleString() : '-'],
            ['Distância:', dist > 0 ? `${dist.toLocaleString()} km` : '-'],
          ],
          theme: 'plain',
          styles: { fontSize: 10 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 35 }, 1: { cellWidth: 100 } },
        });
      }

      const finalY = (doc as any).lastAutoTable?.finalY || yAfter;

      if (fAbs.length > 0) {
        const abs = montarBody(fAbs, (a: any) => [
          a.posto || '-',
          `${Number(a.litros || 0).toFixed(1)}L`,
          a.arlaLitros ? `${a.arlaLitros.toFixed(1)}L (${formatCurrency(a.arlaValor)})` : '-',
          formatCurrency(a.valorTotal)
        ], 4, true);
        autoTable(doc, {
          startY: finalY + 10,
          head: [['Abastecimentos', 'Litros', 'ARLA', 'Valor']],
          body: abs.body,
          foot: [[
            'TOTAL',
            `${fAbs.reduce((s, a) => s + a.litros, 0).toFixed(1)}L`,
            fAbs.some(a => a.arlaValor) ? formatCurrency(fAbs.reduce((s, a) => s + (a.arlaValor || 0), 0)) : '-',
            formatCurrency(fAbs.reduce((s, a) => s + a.valorTotal, 0))
          ]],
          headStyles: { fillColor: [59, 130, 246] },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' },
          didDrawCell: linkComprovante(abs.links)
        });
      }

      const yAbs = (doc as any).lastAutoTable?.finalY || finalY;

      if (fDesp.length > 0) {
        const desp = montarBody(fDesp, (d: any) => [
          d.descricao,
          d.tipo || '-',
          d.quemPagou === 'proprietario' ? 'Proprietário' : d.quemPagou === 'motorista' ? 'Motorista' : '-',
          formatCurrency(d.valor)
        ], 4, true);
        autoTable(doc, {
          startY: yAbs + 10,
          head: [['Despesas', 'Tipo', 'Quem Pagou', 'Valor']],
          body: desp.body,
          foot: [['TOTAL', '', '', formatCurrency(fDesp.reduce((s, d) => s + d.valor, 0))]],
          headStyles: { fillColor: [239, 68, 68] },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' },
          didDrawCell: linkComprovante(desp.links)
        });
      }

      const yDesp = (doc as any).lastAutoTable?.finalY || yAbs;

      if (fVales.length > 0) {
        // Vales não têm comprovante (mapVale não traz foto_url)
        const vls = montarBody(fVales, (v: any) => [
          'Vale',
          v.descricao || v.posto || 'Vale/Adiantamento',
          v.quemPagou === 'proprietario' ? 'Proprietário' : v.quemPagou === 'motorista' ? 'Motorista' : '-',
          formatCurrency(v.valor)
        ], 4, false);
        autoTable(doc, {
          startY: yDesp + 10,
          head: [['Vales', 'Descrição', 'Quem Pagou', 'Valor']],
          body: vls.body,
          foot: [['TOTAL', '', '', formatCurrency(fVales.reduce((s, v) => s + v.valor, 0))]],
          headStyles: { fillColor: [249, 115, 22] },
          footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' }
        });
      }

      const ySummary = (doc as any).lastAutoTable?.finalY || yDesp;
      // Mesmas fórmulas da tela (por viagem, sem Math.abs)
      // PR7A: autônomo não usa comissão — resultado = Faturamento − Gastos (todos os
      // lançamentos do frete, ignorando quem_pagou). Vinculado mantém o modelo atual.
      const isAutonomo = motInfo?.empresaTipo === 'autonomo';
      const percentComissao = motInfo?.percentualComissao || 0;
      const valorComissao = trip.valorFrete * (percentComissao / 100);
      const gastosMotorista = fDesp.filter(d => d.quemPagou === 'motorista').reduce((s, d) => s + d.valor, 0)
        + fAbs.filter(a => a.quemPagou === 'motorista').reduce((s, a) => s + a.valorTotal, 0);
      const gastosProprietario = fDesp.filter(d => d.quemPagou === 'proprietario').reduce((s, d) => s + d.valor, 0)
        + fAbs.filter(a => a.quemPagou === 'proprietario').reduce((s, a) => s + a.valorTotal, 0);
      const valesViagem = fVales.filter(v => v.quemPagou === 'proprietario').reduce((s, v) => s + v.valor, 0);
      const saldoMotorista = valorComissao + gastosMotorista - valesViagem;
      const resultadoEmpresa = trip.valorFrete - valorComissao - gastosProprietario;
      const gastosTotais = fDesp.reduce((s, d) => s + (d.valor || 0), 0) + fAbs.reduce((s, a) => s + (a.valorTotal || 0), 0) + fVales.reduce((s, v) => s + (v.valor || 0), 0);
      const resultadoAut = trip.valorFrete - gastosTotais;

      autoTable(doc, {
        startY: ySummary + 15,
        body: isAutonomo ? [
          ['RESUMO FINANCEIRO', '', ''],
          ['Faturamento', formatCurrency(trip.valorFrete), ''],
          ['Gastos (desp. + abast. + vales)', formatCurrency(gastosTotais), ''],
          ['RESULTADO', formatCurrency(resultadoAut), ''],
        ] : [
          ['RESUMO FINANCEIRO', '', ''],
          ['Valor do Frete', formatCurrency(trip.valorFrete), ''],
          [`Comissão (${percentComissao}%)`, formatCurrency(valorComissao), ''],
          ['Desp./Abast. pagos pelo Motorista', formatCurrency(gastosMotorista), ''],
          ['Vales / Adiantamentos', formatCurrency(valesViagem), ''],
          ['SALDO DO MOTORISTA', formatCurrency(saldoMotorista), ''],
          ['RESULTADO DA EMPRESA', formatCurrency(resultadoEmpresa), ''],
        ],
        theme: 'plain',
        styles: { fontSize: 11 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { cellWidth: 40 } },
      });
      const boldRows = isAutonomo ? [0, 3] : [0, 5, 6];
      (doc as any).lastAutoTable?.rows?.forEach((row: any, i: number) => {
        if (boldRows.includes(i)) {
          row.cells.forEach((cell: any) => { cell.styles.fontStyle = 'bold'; cell.styles.fontSize = 12; });
        }
      });

      // ===== Auditoria: lançamentos rejeitados (Etapa D) =====
      // Lê APENAS tripDespRej/tripAbsRej/tripValesRej. Sem foot/total de
      // propósito: nada desta seção entra em soma alguma.
      if (tripDespRej.length > 0 || tripAbsRej.length > 0 || tripValesRej.length > 0) {
        let yRej = ((doc as any).lastAutoTable?.finalY || ySummary) + 15;
        // Título é doc.text manual (não pagina sozinho): perto do rodapé, vira página
        if (yRej > doc.internal.pageSize.getHeight() - 40) {
          doc.addPage();
          yRej = 20;
        }
        doc.setFontSize(12).setFont("helvetica", "bold");
        doc.text('LANÇAMENTOS REJEITADOS — FORA DOS CÁLCULOS', 14, yRej);
        doc.setFontSize(8).setFont("helvetica", "normal");
        doc.text('Exibidos somente para auditoria; não entram em nenhum total.', 14, yRej + 5);
        const estiloRej = {
          headStyles: { fillColor: [148, 163, 184] as any },
          bodyStyles: { textColor: [100, 116, 139] as any }
        };
        let yTab = yRej + 10;
        if (tripDespRej.length > 0) {
          const rej = montarBody(tripDespRej, (d: any) => [
            d.descricao,
            d.tipo || '-',
            'REJEITADO',
            formatCurrency(d.valor)
          ], 4, true, true);
          autoTable(doc, {
            startY: yTab,
            head: [['Despesas rejeitadas', 'Tipo', 'Status', 'Valor']],
            body: rej.body,
            ...estiloRej,
            didDrawCell: linkComprovante(rej.links)
          });
          yTab = (doc as any).lastAutoTable.finalY + 8;
        }
        if (tripAbsRej.length > 0) {
          const rej = montarBody(tripAbsRej, (a: any) => [
            a.posto || '-',
            `${Number(a.litros || 0).toFixed(1)}L`,
            'REJEITADO',
            formatCurrency(a.valorTotal)
          ], 4, true, true);
          autoTable(doc, {
            startY: yTab,
            head: [['Abastecimentos rejeitados', 'Litros', 'Status', 'Valor']],
            body: rej.body,
            ...estiloRej,
            didDrawCell: linkComprovante(rej.links)
          });
          yTab = (doc as any).lastAutoTable.finalY + 8;
        }
        if (tripValesRej.length > 0) {
          // Vales não têm comprovante (mapVale não traz foto_url)
          const rej = montarBody(tripValesRej, (v: any) => [
            v.descricao || v.posto || 'Vale/Adiantamento',
            'Vale',
            'REJEITADO',
            formatCurrency(v.valor)
          ], 4, false, true);
          autoTable(doc, {
            startY: yTab,
            head: [['Vales rejeitados', 'Tipo', 'Status', 'Valor']],
            body: rej.body,
            ...estiloRej
          });
        }
      }

      doc.save(`Frete_${trip.origem}_${trip.destino}_${safeFmt(trip.data, 'ddMMyyyy')}.pdf`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o relatório.');
    } finally {
      setIsGenerating(false);
    }
  };

  // PDF Auditoria mensal de UM motorista. Reusa o padrão do PDF da viagem,
  // mas com helpers DUPLICADOS (montarBody/linkComprovante) para NÃO tocar
  // gerarPDFViagem (já validado). Sem endpoint novo: itera fretesDetalhados e
  // busca despesas/abastecimentos/vales por frete_id. Fórmulas idênticas ao detalhe.
  const gerarPDFAuditoriaMensalMotorista = async () => {
    if (selectedMot === 'todos') return;
    const motInfo = motoristas.find(m => m.uid === selectedMot);
    const trips = fretesDetalhados;
    if (!trips || trips.length === 0) {
      alert('Nenhum frete finalizado para este motorista no período selecionado.');
      return;
    }
    try {
      setIsGenerating(true);
      const doc = new jsPDF();

      // Linha de "Evidência": Ref (UUID) do lançamento + justificativa + status do comprovante.
      const montarBody = (
        itens: any[], linhaPrincipal: (item: any) => any[], colunas: number,
        comComprovante: boolean, justificativaObrigatoria = false
      ) => {
        const body: any[] = []; const links: Record<number, string> = {};
        itens.forEach(item => {
          body.push(linhaPrincipal(item));
          const partes: string[] = [];
          if (item.id) partes.push(`Ref: ${item.id}`);
          if (item.status) partes.push(`Status: ${String(item.status).toUpperCase()}`);
          const obs = item.obsResolucao || (justificativaObrigatoria ? 'Sem justificativa informada' : '');
          if (obs) partes.push(`Justificativa: ${obs}`);
          if (comComprovante) {
            if (item.fotoUrl) { links[body.length] = item.fotoUrl; partes.push('Ver comprovante'); }
            else partes.push('Sem comprovante');
          }
          if (partes.length > 0) {
            body.push([{ content: 'Evidência — ' + partes.join('   •   '), colSpan: colunas,
              styles: { fontSize: 8, textColor: [100, 116, 139], fontStyle: 'italic' } }]);
          }
        });
        return { body, links };
      };
      const linkComprovante = (links: Record<number, string>) => (data: any) => {
        const url = links[data.row.index];
        if (data.section === 'body' && url) {
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
        }
      };
      const resolvido = (s: string) => s === 'aprovado' || s === 'finalizado';
      const rejeitado = (s: string) => s === 'rejeitado';
      const mapDesp = (d: any) => ({ id: d.id, status: d.status, valor: parseFloat(d.valor), descricao: d.descricao, tipo: d.tipo,
        quemPagou: d.quem_pagou, data: d.data, frete_id: d.frete_id, fotoUrl: d.foto_url, obsResolucao: d.obs_resolucao });
      const mapAbs = (a: any) => ({ id: a.id, status: a.status, valorTotal: parseFloat(a.valor_total), litros: parseFloat(a.litros),
        arlaLitros: a.arla_litros ? parseFloat(a.arla_litros) : null, arlaValor: a.arla_valor ? parseFloat(a.arla_valor) : null,
        posto: a.posto, quemPagou: a.quem_pagou, data: a.data, frete_id: a.frete_id, fotoUrl: a.foto_url, obsResolucao: a.obs_resolucao });
      const mapVale = (v: any) => ({ id: v.id, status: v.status, valor: parseFloat(v.valor), descricao: v.descricao || v.posto || '',
        posto: v.posto, quemPagou: v.quem_pagou, data: v.data, frete_id: v.frete_id, obsResolucao: v.obs_resolucao });

      // Cabeçalho (mesmo padrão dos outros PDFs)
      const savedLogo = localStorage.getItem('matopibalog_logo');
      const savedCompany = localStorage.getItem('matopibalog_company');
      let company: any = null;
      try { company = savedCompany ? JSON.parse(savedCompany) : null; } catch (e) {}
      if (savedLogo) {
        try {
          const img = new Image(); img.src = savedLogo;
          const maxW = 35, maxH = 20;
          const ratio = Math.min(maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
          doc.addImage(savedLogo, 'PNG', 12, 8 + (maxH - (img.naturalHeight || maxH) * ratio) / 2,
            (img.naturalWidth || maxW) * ratio, (img.naturalHeight || maxH) * ratio);
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
      const monthLabel = format(new Date(selectedDate + '-01T12:00:00'), "MMMM 'de' yyyy", { locale: ptBR });
      doc.setFontSize(16).setFont("helvetica", "bold");
      doc.text('AUDITORIA MENSAL DE FRETES POR MOTORISTA', 105, 42, { align: 'center' });
      doc.setFontSize(8).setFont("helvetica", "italic");
      doc.text('Documento de apoio à auditoria. Não substitui conferência fiscal/contábil nem garante ausência de fraude.', 105, 47, { align: 'center' });
      doc.setFontSize(10).setFont("helvetica", "normal");
      doc.text(`Período: ${monthLabel.toUpperCase()} | Motorista: ${(motInfo?.nomeCompleto || 'N/A').toUpperCase()}`, 14, 54);
      doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 14, 59);

      // PR7A: autônomo não usa comissão — resultado = Faturamento − Gastos (todos os lançamentos).
      const isAutonomo = motInfo?.empresaTipo === 'autonomo';
      const pct = motInfo?.percentualComissao || 0;
      let pFrete = 0, pComissao = 0, pSaldoMot = 0, pResultEmp = 0, pGastosMot = 0, pGastosProp = 0, pVales = 0, pGastosTotais = 0;
      let nRejDesp = 0, nRejAbs = 0, nRejVale = 0, vRej = 0, nSemComp = 0, nViagensAlerta = 0;
      let primeiro = true;

      for (const trip of trips) {
        const [rd, ra, rv] = await Promise.all([
          api.get('/despesas?frete_id=' + trip.id),
          api.get('/abastecimentos?frete_id=' + trip.id),
          api.get('/vales?frete_id=' + trip.id),
        ]);
        const fDesp: any[] = (rd.data || []).filter((d: any) => resolvido(d.status)).map(mapDesp);
        const fAbs: any[] = (ra.data || []).filter((a: any) => resolvido(a.status)).map(mapAbs);
        const fVales: any[] = (rv.data || []).filter((v: any) => resolvido(v.status)).map(mapVale);
        const fDespRej: any[] = (rd.data || []).filter((d: any) => rejeitado(d.status)).map(mapDesp);
        const fAbsRej: any[] = (ra.data || []).filter((a: any) => rejeitado(a.status)).map(mapAbs);
        const fValesRej: any[] = (rv.data || []).filter((v: any) => rejeitado(v.status)).map(mapVale);

        let y = 66;
        if (!primeiro) { doc.addPage(); y = 18; }
        primeiro = false;

        const dist = trip.km_final && trip.km_inicial ? trip.km_final - trip.km_inicial : 0;
        doc.setFontSize(12).setFont("helvetica", "bold");
        doc.text(`FRETE: ${trip.origem} > ${trip.destino}`, 14, y);
        autoTable(doc, {
          startY: y + 4,
          body: [
            ['Ref (frete_id):', String(trip.id), 'Data:', safeFmt(trip.data, 'dd/MM/yyyy')],
            ['Motorista:', motInfo?.nomeCompleto || '-', 'Placa:', trip.placa || '-'],
            ['Status:', (trip.status || '-').toUpperCase(), 'Quem Recebeu:',
              trip.quemRecebeu === 'proprietario' ? 'Proprietário' : trip.quemRecebeu === 'motorista' ? 'Motorista' : '-'],
            ['Valor Frete:', formatCurrency(trip.valorFrete), 'Distância:', dist > 0 ? `${dist.toLocaleString()} km` : '-'],
          ],
          theme: 'plain', styles: { fontSize: 9 },
          columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } },
        });
        let cy = (doc as any).lastAutoTable.finalY + 6;

        if (fAbs.length > 0) {
          const abs = montarBody(fAbs, (a: any) => [a.posto || '-', `${Number(a.litros || 0).toFixed(1)}L`,
            a.arlaLitros ? `${a.arlaLitros.toFixed(1)}L (${formatCurrency(a.arlaValor)})` : '-', formatCurrency(a.valorTotal)], 4, true);
          autoTable(doc, { startY: cy, head: [['Abastecimentos', 'Litros', 'ARLA', 'Valor']], body: abs.body,
            foot: [['TOTAL', `${fAbs.reduce((s, a) => s + a.litros, 0).toFixed(1)}L`,
              fAbs.some(a => a.arlaValor) ? formatCurrency(fAbs.reduce((s, a) => s + (a.arlaValor || 0), 0)) : '-',
              formatCurrency(fAbs.reduce((s, a) => s + a.valorTotal, 0))]],
            headStyles: { fillColor: [59, 130, 246] }, footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' },
            didDrawCell: linkComprovante(abs.links) });
          cy = (doc as any).lastAutoTable.finalY + 6;
        }
        if (fDesp.length > 0) {
          const desp = montarBody(fDesp, (d: any) => [d.descricao, d.tipo || '-',
            d.quemPagou === 'proprietario' ? 'Proprietário' : d.quemPagou === 'motorista' ? 'Motorista' : '-', formatCurrency(d.valor)], 4, true);
          autoTable(doc, { startY: cy, head: [['Despesas', 'Tipo', 'Quem Pagou', 'Valor']], body: desp.body,
            foot: [['TOTAL', '', '', formatCurrency(fDesp.reduce((s, d) => s + d.valor, 0))]],
            headStyles: { fillColor: [239, 68, 68] }, footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' },
            didDrawCell: linkComprovante(desp.links) });
          cy = (doc as any).lastAutoTable.finalY + 6;
        }
        if (fVales.length > 0) {
          const vls = montarBody(fVales, (v: any) => ['Vale', v.descricao || v.posto || 'Vale/Adiantamento',
            v.quemPagou === 'proprietario' ? 'Proprietário' : v.quemPagou === 'motorista' ? 'Motorista' : '-', formatCurrency(v.valor)], 4, false);
          autoTable(doc, { startY: cy, head: [['Vales', 'Descrição', 'Quem Pagou', 'Valor']], body: vls.body,
            foot: [['TOTAL', '', '', formatCurrency(fVales.reduce((s, v) => s + v.valor, 0))]],
            headStyles: { fillColor: [249, 115, 22] }, footStyles: { fillColor: [241, 245, 249], textColor: [31, 41, 55], fontStyle: 'bold' } });
          cy = (doc as any).lastAutoTable.finalY + 6;
        }

        // Fórmulas IDÊNTICAS ao detalhe da viagem (gerarPDFViagem) — não alteradas
        const valorComissao = trip.valorFrete * (pct / 100);
        const gastosMotorista = fDesp.filter(d => d.quemPagou === 'motorista').reduce((s, d) => s + d.valor, 0)
          + fAbs.filter(a => a.quemPagou === 'motorista').reduce((s, a) => s + a.valorTotal, 0);
        const gastosProprietario = fDesp.filter(d => d.quemPagou === 'proprietario').reduce((s, d) => s + d.valor, 0)
          + fAbs.filter(a => a.quemPagou === 'proprietario').reduce((s, a) => s + a.valorTotal, 0);
        const valesViagem = fVales.filter(v => v.quemPagou === 'proprietario').reduce((s, v) => s + v.valor, 0);
        const saldoMotorista = valorComissao + gastosMotorista - valesViagem;
        const resultadoEmpresa = trip.valorFrete - valorComissao - gastosProprietario;
        const gastosTotaisTrip = fDesp.reduce((s, d) => s + (d.valor || 0), 0) + fAbs.reduce((s, a) => s + (a.valorTotal || 0), 0) + fVales.reduce((s, v) => s + (v.valor || 0), 0);
        pFrete += trip.valorFrete; pComissao += valorComissao; pSaldoMot += saldoMotorista; pResultEmp += resultadoEmpresa;
        pGastosMot += gastosMotorista; pGastosProp += gastosProprietario; pVales += valesViagem; pGastosTotais += gastosTotaisTrip;

        autoTable(doc, { startY: cy,
          body: isAutonomo ? [
            ['Faturamento', formatCurrency(trip.valorFrete)],
            ['Gastos (desp. + abast. + vales)', formatCurrency(gastosTotaisTrip)],
            ['RESULTADO', formatCurrency(trip.valorFrete - gastosTotaisTrip)],
          ] : [
            ['Comissão', formatCurrency(valorComissao)],
            ['Desp./Abast. pagos pelo Motorista', formatCurrency(gastosMotorista)],
            ['Desp./Abast. pagos pelo Proprietário', formatCurrency(gastosProprietario)],
            ['Vales / Adiantamentos', formatCurrency(valesViagem)],
            ['SALDO DO MOTORISTA', formatCurrency(saldoMotorista)],
            ['RESULTADO DA EMPRESA', formatCurrency(resultadoEmpresa)],
          ],
          theme: 'plain', styles: { fontSize: 10 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 95 } } });
        cy = (doc as any).lastAutoTable.finalY + 8;

        // ===== ALERTAS DE AUDITORIA (por viagem) =====
        const despSemComp = fDesp.filter(d => !d.fotoUrl).length;
        const absSemComp = fAbs.filter(a => !a.fotoUrl).length;
        const totalRej = fDespRej.length + fAbsRej.length + fValesRej.length;
        const alertas: string[] = [];
        if (fDesp.length === 0 && fAbs.length === 0 && fVales.length === 0) alertas.push('Frete sem lançamentos aprovados/finalizados.');
        if (!trip.km_inicial || !trip.km_final) alertas.push('KM inicial e/ou final ausente.');
        if (dist <= 0) alertas.push('Distância zerada ou incompleta.');
        if (despSemComp > 0) alertas.push(`${despSemComp} despesa(s) aprovada(s)/finalizada(s) sem comprovante.`);
        if (absSemComp > 0) alertas.push(`${absSemComp} abastecimento(s) aprovado(s)/finalizado(s) sem comprovante.`);
        if (fDespRej.some(d => !d.obsResolucao)) alertas.push('Despesa rejeitada sem justificativa.');
        if (fAbsRej.some(a => !a.obsResolucao)) alertas.push('Abastecimento rejeitado sem justificativa.');
        if (fValesRej.some(v => !v.obsResolucao)) alertas.push('Vale rejeitado sem justificativa.');
        if (totalRej > 0) alertas.push(`${totalRej} lançamento(s) rejeitado(s) (fora dos cálculos).`);
        if (valesViagem > 0) alertas.push('Vales/adiantamentos impactando o saldo do motorista.');

        nSemComp += despSemComp + absSemComp;
        nRejDesp += fDespRej.length; nRejAbs += fAbsRej.length; nRejVale += fValesRej.length;
        vRej += fDespRej.reduce((s, d) => s + d.valor, 0) + fAbsRej.reduce((s, a) => s + a.valorTotal, 0) + fValesRej.reduce((s, v) => s + v.valor, 0);
        if (alertas.length > 0) nViagensAlerta++;

        if (alertas.length > 0) {
          if (cy > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); cy = 18; }
          autoTable(doc, { startY: cy,
            head: [['ALERTAS DE AUDITORIA']],
            body: alertas.map(a => [a]),
            headStyles: { fillColor: [202, 138, 4] }, bodyStyles: { textColor: [120, 53, 15], fontSize: 9 } });
          cy = (doc as any).lastAutoTable.finalY + 8;
        }

        // ===== Rejeitados — evidência, fora dos cálculos =====
        if (totalRej > 0) {
          if (cy > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); cy = 18; }
          doc.setFontSize(11).setFont("helvetica", "bold");
          doc.text('LANÇAMENTOS REJEITADOS — FORA DOS CÁLCULOS', 14, cy);
          const estiloRej = { headStyles: { fillColor: [148, 163, 184] as any }, bodyStyles: { textColor: [100, 116, 139] as any } };
          let yt = cy + 4;
          if (fDespRej.length > 0) {
            const r = montarBody(fDespRej, (d: any) => [d.descricao, d.tipo || '-', 'REJEITADO', formatCurrency(d.valor)], 4, true, true);
            autoTable(doc, { startY: yt, head: [['Despesas rejeitadas', 'Tipo', 'Status', 'Valor']], body: r.body, ...estiloRej, didDrawCell: linkComprovante(r.links) });
            yt = (doc as any).lastAutoTable.finalY + 6;
          }
          if (fAbsRej.length > 0) {
            const r = montarBody(fAbsRej, (a: any) => [a.posto || '-', `${Number(a.litros || 0).toFixed(1)}L`, 'REJEITADO', formatCurrency(a.valorTotal)], 4, true, true);
            autoTable(doc, { startY: yt, head: [['Abastecimentos rejeitados', 'Litros', 'Status', 'Valor']], body: r.body, ...estiloRej, didDrawCell: linkComprovante(r.links) });
            yt = (doc as any).lastAutoTable.finalY + 6;
          }
          if (fValesRej.length > 0) {
            const r = montarBody(fValesRej, (v: any) => [v.descricao || v.posto || 'Vale/Adiantamento', 'Vale', 'REJEITADO', formatCurrency(v.valor)], 4, false, true);
            autoTable(doc, { startY: yt, head: [['Vales rejeitados', 'Tipo', 'Status', 'Valor']], body: r.body, ...estiloRej });
          }
        }
      }

      // ===== RESUMO DE MATERIALIDADE (período) =====
      doc.addPage();
      doc.setFontSize(14).setFont("helvetica", "bold");
      doc.text('RESUMO DE MATERIALIDADE — PERÍODO', 14, 18);
      autoTable(doc, { startY: 24,
        body: [
          ['Fretes auditados', String(trips.length)],
          ...(isAutonomo ? [
            ['Total de Fretes (Faturamento)', formatCurrency(pFrete)],
            ['Total de Gastos (desp. + abast. + vales)', formatCurrency(pGastosTotais)],
            ['RESULTADO TOTAL', formatCurrency(pFrete - pGastosTotais)],
          ] : [
            ['Total de Fretes', formatCurrency(pFrete)],
            [`Total de Comissão (${pct}%)`, formatCurrency(pComissao)],
            ['Total Desp./Abast. pagos pelo Motorista', formatCurrency(pGastosMot)],
            ['Total Desp./Abast. pagos pelo Proprietário', formatCurrency(pGastosProp)],
            ['Total de Vales/Adiantamentos', formatCurrency(pVales)],
            ['SALDO TOTAL DO MOTORISTA', formatCurrency(pSaldoMot)],
            ['RESULTADO TOTAL DA EMPRESA', formatCurrency(pResultEmp)],
          ]),
          ['Rejeitados (fora dos cálculos)', `${nRejDesp} desp. • ${nRejAbs} abast. • ${nRejVale} vales — ${formatCurrency(vRej)}`],
          ['Lançamentos sem comprovante', String(nSemComp)],
          ['Fretes com alerta', `${nViagensAlerta} de ${trips.length}`],
        ],
        theme: 'plain', styles: { fontSize: 11 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } } });

      doc.save(`Auditoria_${(motInfo?.nomeCompleto || 'motorista').replace(/\s+/g, '_')}_${monthLabel}.pdf`);
    } catch (error) {
      console.error('Erro ao gerar PDF de auditoria:', error);
      alert('Ocorreu um erro ao gerar a auditoria.');
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
          <p>Carregando dados do frete...</p>
        </div>
      );
    }

    const fDesp = tripDesp;
    const fAbs = tripAbs;
    const fVales = tripVales;
    const fDespRej = tripDespRej;
    const fAbsRej = tripAbsRej;
    const fValesRej = tripValesRej;
    const temRejeitados = fDespRej.length > 0 || fAbsRej.length > 0 || fValesRej.length > 0;
    const dist = trip.km_final && trip.km_inicial ? trip.km_final - trip.km_inicial : 0;
    const litrosTotal = fAbs.reduce((s, a) => s + a.litros, 0);
    const media = litrosTotal > 0 && dist > 0 ? (dist / litrosTotal).toFixed(2) : null;
    const totalDesp = fDesp.reduce((s, d) => s + d.valor, 0);
    const totalAbs = fAbs.reduce((s, a) => s + a.valorTotal, 0);
    const totalVales = fVales.reduce((s, v) => s + v.valor, 0);
    // Cálculo por viagem (somente lançamentos desta viagem; sem Math.abs — sinal real)
    const percentComissao = motoristas.find(m => m.uid === selectedMot)?.percentualComissao || 0;
    const comissaoViagem = trip.valorFrete * (percentComissao / 100);
    const gastosMotorista = fDesp.filter(d => d.quemPagou === 'motorista').reduce((s, d) => s + d.valor, 0)
      + fAbs.filter(a => a.quemPagou === 'motorista').reduce((s, a) => s + a.valorTotal, 0);
    const gastosProprietario = fDesp.filter(d => d.quemPagou === 'proprietario').reduce((s, d) => s + d.valor, 0)
      + fAbs.filter(a => a.quemPagou === 'proprietario').reduce((s, a) => s + a.valorTotal, 0);
    const valesViagem = fVales.filter(v => v.quemPagou === 'proprietario').reduce((s, v) => s + v.valor, 0);
    const saldoMotoristaViagem = comissaoViagem + gastosMotorista - valesViagem;
    const resultadoEmpresaViagem = trip.valorFrete - comissaoViagem - gastosProprietario;
    // PR7A: autônomo = Faturamento − Gastos (todos os lançamentos do frete, ignorando quem_pagou).
    const isAutonomo = motoristas.find(m => m.uid === selectedMot)?.empresaTipo === 'autonomo';
    const gastosTotaisViagem = totalDesp + totalAbs + totalVales;
    const resultadoViagemAut = trip.valorFrete - gastosTotaisViagem;

    return (
      <>
        <button onClick={() => setSelectedTripId(null)} className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors">
          <ChevronLeft size={20} className="mr-1" /> Voltar para Fretes
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
              <FileText size={18} className="mr-2 text-blue-600" /> Lançamentos do Frete
            </h3>
          </div>
          {fAbs.length === 0 && fDesp.length === 0 && fVales.length === 0 ? (
            <div className="p-6 text-center text-gray-400">
              {temRejeitados
                ? 'Nenhum lançamento aprovado para este frete — há apenas lançamentos rejeitados (abaixo).'
                : 'Nenhum lançamento registrado para este frete.'}
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {fAbs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-2 flex items-center"><Fuel size={14} className="mr-1" /> Abastecimentos</p>
                  {fAbs.map((a, i) => (
                    <div key={`a-${i}`} className="flex justify-between items-center text-sm bg-blue-50/50 rounded-lg px-3 py-2 border border-blue-100 mb-1">
                      <span className="text-gray-700">{a.posto} <span className="text-gray-400">({a.litros.toFixed(1)}L)</span>{a.fotoUrl && <> • <a href={a.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a></>}{a.obsResolucao && <span className="block text-xs text-gray-500 italic">Justificativa: {a.obsResolucao}</span>}</span>
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
                      <span className="text-gray-700">{d.descricao}{d.fotoUrl && <> • <a href={d.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a></>}{d.obsResolucao && <span className="block text-xs text-gray-500 italic">Justificativa: {d.obsResolucao}</span>}</span>
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
                      <span className="text-gray-700">{v.descricao || v.posto || 'Vale/Adiantamento'}{v.obsResolucao && <span className="block text-xs text-gray-500 italic">Justificativa: {v.obsResolucao}</span>}</span>
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

        {temRejeitados && (
          <div className="bg-white rounded-xl shadow-sm border border-red-200">
            <div className="p-4 border-b border-red-100">
              <h3 className="font-bold text-red-700 flex items-center">
                <FileText size={18} className="mr-2 text-red-600" /> Lançamentos rejeitados (fora dos cálculos)
              </h3>
              <p className="text-xs text-gray-400 mt-1">Exibidos somente para auditoria — não entram em nenhum total nem no saldo.</p>
            </div>
            <div className="p-4 space-y-4">
              {fDespRej.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-red-500 uppercase mb-2 flex items-center"><FileText size={14} className="mr-1" /> Despesas rejeitadas</p>
                  {fDespRej.map((d, i) => (
                    <div key={`dr-${i}`} className="flex justify-between items-center text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 mb-1">
                      <span className="text-gray-600">
                        <span className="inline-block mr-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700">Rejeitado</span>
                        {d.descricao}{d.fotoUrl && <> • <a href={d.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a></>}
                        <span className="block text-xs text-gray-500 italic">Justificativa: {d.obsResolucao || 'Sem justificativa informada'}</span>
                      </span>
                      <span className="font-bold text-gray-400 line-through">{formatCurrency(d.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
              {fAbsRej.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-red-500 uppercase mb-2 flex items-center"><Fuel size={14} className="mr-1" /> Abastecimentos rejeitados</p>
                  {fAbsRej.map((a, i) => (
                    <div key={`ar-${i}`} className="flex justify-between items-center text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 mb-1">
                      <span className="text-gray-600">
                        <span className="inline-block mr-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700">Rejeitado</span>
                        {a.posto} <span className="text-gray-400">({a.litros.toFixed(1)}L)</span>{a.fotoUrl && <> • <a href={a.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a></>}
                        <span className="block text-xs text-gray-500 italic">Justificativa: {a.obsResolucao || 'Sem justificativa informada'}</span>
                      </span>
                      <span className="font-bold text-gray-400 line-through">{formatCurrency(a.valorTotal)}</span>
                    </div>
                  ))}
                </div>
              )}
              {fValesRej.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-red-500 uppercase mb-2 flex items-center"><DollarSign size={14} className="mr-1" /> Vales rejeitados</p>
                  {fValesRej.map((v, i) => (
                    <div key={`vr-${i}`} className="flex justify-between items-center text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 mb-1">
                      <span className="text-gray-600">
                        <span className="inline-block mr-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700">Rejeitado</span>
                        {v.descricao || v.posto || 'Vale/Adiantamento'}
                        <span className="block text-xs text-gray-500 italic">Justificativa: {v.obsResolucao || 'Sem justificativa informada'}</span>
                      </span>
                      <span className="font-bold text-gray-400 line-through">{formatCurrency(v.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h4 className="flex items-center text-gray-800 mb-4 font-bold text-lg">
            <TrendingUp className="mr-2 text-green-600" size={20} /> Resumo Financeiro
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-500">{isAutonomo ? 'Faturamento' : 'Valor do Frete'}</span>
              <span className="font-bold text-gray-800">{formatCurrency(trip.valorFrete)}</span>
            </div>
            {isAutonomo ? (
              <>
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                  <span className="text-gray-500">Gastos (desp. + abast. + vales)</span>
                  <span className="font-bold text-red-600">-{formatCurrency(gastosTotaisViagem)}</span>
                </div>
                <div className="flex justify-between items-center text-base font-extrabold bg-gray-50 p-3 rounded-lg">
                  <span className="text-gray-700">RESULTADO</span>
                  <span className={resultadoViagemAut >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(resultadoViagemAut)}</span>
                </div>
                <p className="text-[10px] text-gray-400 px-1">* Faturamento (−) Gastos do frete (desp., abast. e vales), somente deste frete.</p>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                  <span className="text-gray-500">Comissão do Motorista ({percentComissao}%)</span>
                  <span className="font-bold text-blue-600">{formatCurrency(comissaoViagem)}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                  <span className="text-gray-500">Desp./Abast. pagos pelo Motorista</span>
                  <span className="font-bold text-green-600">+{formatCurrency(gastosMotorista)}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                  <span className="text-gray-500">Vales / Adiantamentos</span>
                  <span className="font-bold text-red-600">-{formatCurrency(valesViagem)}</span>
                </div>
                <div className="flex justify-between items-center text-base font-extrabold bg-gray-50 p-3 rounded-lg">
                  <span className="text-gray-700">SALDO DO MOTORISTA</span>
                  <span className={saldoMotoristaViagem >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(saldoMotoristaViagem)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold pt-3 border-t border-gray-100">
                  <span className="text-gray-600 flex items-center"><TrendingUp size={16} className="mr-2 text-green-500" /> RESULTADO DA EMPRESA (deste frete)</span>
                  <span className={resultadoEmpresaViagem >= 0 ? 'text-gray-900' : 'text-red-600'}>{formatCurrency(resultadoEmpresaViagem)}</span>
                </div>
                <p className="text-[10px] text-gray-400 px-1">* Frete (−) Comissão (−) Desp./Abast. pagos pela empresa, somente deste frete.</p>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => gerarPDFViagem(trip)}
            disabled={isGenerating || tripLoading}
            className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
          >
            <Printer size={20} className="mr-2" />
            {tripLoading ? 'Carregando lançamentos...' : isGenerating ? 'Gerando...' : 'Imprimir Relatório deste Frete'}
          </button>
        </div>
      </>
    );
  };

  // Filtros do Histórico: mês/ano derivam de selectedDate (yyyy-MM), que segue sendo a fonte única.
  const anoAtual = new Date().getFullYear();
  const anoSel = selectedDate.split('-')[0];
  const mesSel = selectedDate.split('-')[1];
  // Intervalo dinâmico: 3 anos atrás até 2 à frente, sempre incluindo o ano selecionado.
  const anosDisponiveis = Array.from(new Set([
    ...Array.from({ length: 6 }, (_, i) => String(anoAtual - 3 + i)),
    anoSel,
  ])).sort();
  const meses = Array.from({ length: 12 }, (_, i) => ({
    valor: String(i + 1).padStart(2, '0'),
    nome: format(new Date(2000, i, 1), 'MMMM', { locale: ptBR }),
  }));
  // Filtro só visual da lista do combobox; nunca altera dados carregados nem permissões.
  const motoristasFiltrados = motoristas.filter(m =>
    !motoristaBusca.trim() ||
    (m.nomeCompleto || '').toLowerCase().includes(motoristaBusca.trim().toLowerCase())
  );
  // Nome exibido no campo quando o dropdown está fechado (sincroniza com selectedMot).
  const nomeMotoristaSelecionado = selectedMot === 'todos'
    ? 'Todos os Motoristas'
    : (motoristas.find(m => m.uid === selectedMot)?.nomeCompleto || '');

  return (
    <CatchError>
    <div className="space-y-6 pb-20 px-6">
      {selectedTripId ? renderDetalheViagem() : (<>
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          {selectedMot !== 'todos' && (
            <button
              onClick={() => { setSelectedMot('todos'); setSelectedTripId(null); }}
              className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors text-sm mb-1"
            >
              <ChevronLeft size={18} className="mr-1" /> Voltar para Motoristas
            </button>
          )}
          <h2 className="text-2xl font-bold text-gray-800">Histórico de Fretes</h2>
          <p className="text-gray-500 text-sm">Auditoria de fretes, lançamentos, comprovantes e resultado financeiro por frete.</p>
        </div>
        {stats.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={generatePDF}
              disabled={isGenerating}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95 font-bold text-sm disabled:opacity-50"
            >
              <Download size={18} className="mr-2" />
              {isGenerating ? 'Gerando...' : 'PDF Resumo'}
            </button>
            <button
              type="button"
              onClick={gerarPDFAuditoriaMensalMotorista}
              disabled={isGenerating || selectedMot === 'todos'}
              title={selectedMot === 'todos' ? 'Selecione um motorista para gerar auditoria' : undefined}
              className="flex items-center px-4 py-2 bg-white border border-blue-200 text-blue-600 rounded-lg font-bold text-sm hover:bg-blue-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={18} className="mr-2" />
              {isGenerating ? 'Gerando auditoria...' : 'PDF Auditoria'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap items-center gap-4">
        <div className="flex items-center space-x-2">
          <Calendar size={18} className="text-gray-400" />
          <select
            value={mesSel}
            onChange={e => setSelectedDate(`${anoSel}-${e.target.value}`)}
            className="border rounded-lg p-2 outline-none focus:border-blue-500 bg-white capitalize"
          >
            {meses.map(m => (
              <option key={m.valor} value={m.valor} className="capitalize">{m.nome}</option>
            ))}
          </select>
          <select
            value={anoSel}
            onChange={e => setSelectedDate(`${e.target.value}-${mesSel}`)}
            className="border rounded-lg p-2 outline-none focus:border-blue-500 bg-white"
          >
            {anosDisponiveis.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <Users size={18} className="text-gray-400" />
          <div className="relative w-56">
            <input
              type="text"
              value={motoristaAberto ? motoristaBusca : nomeMotoristaSelecionado}
              onChange={e => setMotoristaBusca(e.target.value)}
              onFocus={() => { setMotoristaAberto(true); setMotoristaBusca(''); }}
              onBlur={() => setMotoristaAberto(false)}
              placeholder="Buscar motorista"
              className="border rounded-lg p-2 outline-none focus:border-blue-500 w-full bg-white"
            />
            {motoristaAberto && (
              <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                <li
                  onMouseDown={() => { setSelectedMot('todos'); setMotoristaAberto(false); setMotoristaBusca(''); }}
                  className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm font-medium"
                >
                  Todos os Motoristas
                </li>
                {motoristasFiltrados.map(m => (
                  <li
                    key={m.uid}
                    onMouseDown={() => { setSelectedMot(m.uid); setMotoristaAberto(false); setMotoristaBusca(''); }}
                    className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm"
                  >
                    {m.nomeCompleto}
                  </li>
                ))}
                {motoristasFiltrados.length === 0 && (
                  <li className="px-3 py-2 text-sm text-gray-400">Nenhum motorista encontrado</li>
                )}
              </ul>
            )}
          </div>
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
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Fretes</p>
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
                    Fretes de {motoristas.find(m => m.uid === selectedMot)?.nomeCompleto || 'Motorista'}
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
                          Lançamentos Gerais (sem frete vinculado)
                        </h3>
                      </div>
                      <div className="p-4 space-y-2">
                        {unlinkedAbs.map((a, i) => (
                          <div key={`ul-abs-${i}`} className="flex justify-between items-center text-sm bg-blue-50/50 rounded-lg px-3 py-2 border border-blue-100">
                            <span className="text-gray-700"><Fuel size={14} className="inline mr-1 text-blue-500" />{a.posto} <span className="text-gray-400">({a.litros}L)</span>{a.fotoUrl && <> • <a href={a.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a></>}</span>
                            <span className="font-bold text-gray-700">{formatCurrency(a.valorTotal)}</span>
                          </div>
                        ))}
                        {unlinkedDesp.map((d, i) => (
                          <div key={`ul-desp-${i}`} className="flex justify-between items-center text-sm bg-orange-50/50 rounded-lg px-3 py-2 border border-orange-100">
                            <span className="text-gray-700"><FileText size={14} className="inline mr-1 text-orange-500" />{d.descricao}{d.fotoUrl && <> • <a href={d.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a></>}</span>
                            <span className="font-bold text-gray-700">{formatCurrency(d.valor)}</span>
                          </div>
                        ))}
                        {unlinkedVales.map((v, i) => (
                          <div key={`ul-vale-${i}`} className="flex justify-between items-center text-sm bg-red-50/50 rounded-lg px-3 py-2 border border-red-100">
                            <span className="text-gray-700"><DollarSign size={14} className="inline mr-1 text-red-500" />{v.descricao || v.posto || 'Vale/Adiantamento'}</span>
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
                    <th className="p-4 text-right">Fretes</th>
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
                    <tr key={s.uid} onClick={() => setSelectedMot(s.uid)} className="hover:bg-blue-50/40 transition-colors cursor-pointer" title="Ver fretes deste motorista">
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
