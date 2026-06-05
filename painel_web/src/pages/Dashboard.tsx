import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { formatCurrency } from '../utils';
import {
  DollarSign, AlertCircle, FileText, Check, X,
  Save, Edit, Unlock, Lock, ChevronLeft, Plus, Fuel, TrendingUp, Truck
} from 'lucide-react';
import api from '../api';

export const Dashboard: React.FC = () => {
  const [motoristasEmViagem, setMotoristasEmViagem] = useState<any[]>([]);
  const [_allMotoristas, setAllMotoristas] = useState<any[]>([]);
  const [fretes, setFretes] = useState<any[]>([]);
  const [despesas, setDespesas] = useState<any[]>([]);
  const [abastecimentos, setAbastecimentos] = useState<any[]>([]);
  const [vales, setVales] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);

  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedMot, setSelectedMot] = useState<any | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string, type: 'despesa' | 'manutencao' | 'abastecimento' | 'vale' | 'frete', data: any } | null>(null);

  const [showAddFreteModal, setShowAddFreteModal] = useState(false);
  const [newFrete, setNewFrete] = useState({ motorista_id: '', origem: '', destino: '', valor_frete: '', km_inicial: '' });
  const [savingFrete, setSavingFrete] = useState(false);

  const [showAddDespesaModal, setShowAddDespesaModal] = useState(false);
  const [newDespesa, setNewDespesa] = useState({ tipo: 'despesa', descricao: '', valor: '', quem_pagou: 'proprietario', posto: '', litros: '', valor_total: '', data: '' });
  const [savingDespesa, setSavingDespesa] = useState(false);

  const loadDashboardData = async () => {
    try {
      // 1. Busca os motoristas (com tratamento de erro individual)
      const resMot = await api.get('/admin/motoristas').catch(() => ({ data: [] }));

      // 2. Busca o resumo do mês (com tratamento de erro individual)
      const resSum = await api.get(`/dashboard/summary?mes=${selectedMonth.getMonth() + 1}&ano=${selectedMonth.getFullYear()}`).catch(() => ({ data: null }));

      const motoristasData = resMot.data || [];
      const mapMotorista = (m: any) => ({
        uid: m.id,
        nomeCompleto: m.usuarios?.nome || 'Motorista',
        placaVeiculo: m.placa_veiculo,
        percentualComissao: m.percentual_comissao,
        statusCadastro: m.status_cadastro
      });

      setAllMotoristas(motoristasData.map(mapMotorista));
      setMotoristasEmViagem(
        motoristasData
          .filter((m: any) => ['aprovado', 'pendente'].includes(m.status_cadastro))
          .map(mapMotorista)
      );

      setSummary(resSum.data || null);
    } catch (err) {
      console.error('Erro geral ao carregar dashboard', err);
    }
  };

  const loadMotoristaData = async (motId: string) => {
    try {
      // Aqui aplicamos a mesma proteção contra Efeito Dominó
      const [resF, resD, resA, resV] = await Promise.allSettled([
        api.get('/fretes?motorista_id=' + motId),
        api.get('/despesas?motorista_id=' + motId),
        api.get('/abastecimentos?motorista_id=' + motId),
        api.get('/vales?motorista_id=' + motId)
      ]);

      const fretesData = resF.status === 'fulfilled' ? resF.value.data || [] : [];
      const despesasData = resD.status === 'fulfilled' ? resD.value.data || [] : [];
      const abastData = resA.status === 'fulfilled' ? resA.value.data || [] : [];
      const valesData = resV.status === 'fulfilled' ? resV.value.data || [] : [];

      setFretes(fretesData.filter((f: any) => f.status !== 'finalizado').map((f: any) => ({
        id: f.id,
        motoristaUid: f.motorista_id,
        origem: f.origem,
        destino: f.destino,
        valorFrete: f.valor_frete,
        kmInicial: f.km_inicial,
        kmFinal: f.km_final,
        criadoEm: f.data,
        status: f.status
      })));
      setDespesas(despesasData.filter((d: any) => d.status !== 'finalizado').map((d: any) => ({
        id: d.id,
        motoristaUid: d.motorista_id,
        descricao: d.descricao,
        valor: d.valor,
        quemPagou: d.quem_pagou,
        status: d.status,
        data: d.data
      })));
      setAbastecimentos(abastData.filter((a: any) => a.status !== 'finalizado').map((a: any) => ({
        id: a.id,
        motoristaUid: a.motorista_id,
        posto: a.posto,
        litros: a.litros,
        valorTotal: a.valor_total,
        quemPagou: a.quem_pagou,
        status: a.status,
        data: a.data,
        frete_id: a.frete_id
      })));
      setVales(valesData.filter((v: any) => v.status !== 'finalizado').map((v: any) => ({
        id: v.id,
        motoristaUid: v.motorista_id,
        descricao: v.descricao,
        valor: v.valor,
        quemPagou: v.quem_pagou,
        status: v.status,
        data: v.data
      })));
    } catch (err) {
      console.error('Erro ao carregar dados do motorista', err);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedMonth]);

  useEffect(() => {
    if (selectedMot) {
      loadMotoristaData(selectedMot.uid);
    }
  }, [selectedMot]);

  const handleAprovarDespesa = async (id: string, tipoItem: string, aprovado: boolean) => {
    const status = aprovado ? 'aprovado' : 'rejeitado';
    try {
      if (tipoItem === 'despesa' || tipoItem === 'manutencao') {
        await api.patch('/despesas/' + id, { status });
      } else if (tipoItem === 'abastecimento') {
        await api.patch('/abastecimentos/' + id, { status });
      } else if (tipoItem === 'vale') {
        await api.patch('/vales/' + id, { status });
      }

      if (selectedMot) loadMotoristaData(selectedMot.uid);
      loadDashboardData();
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar status. Verifique se o servidor está rodando.');
    }
  };

  const handleResetStatus = async (id: string, tipoItem: string) => {
    try {
      if (tipoItem === 'despesa' || tipoItem === 'manutencao') {
        await api.patch('/despesas/' + id, { status: 'pendente' });
      } else if (tipoItem === 'abastecimento') {
        await api.patch('/abastecimentos/' + id, { status: 'pendente' });
      } else if (tipoItem === 'vale') {
        await api.patch('/vales/' + id, { status: 'pendente' });
      }
      if (selectedMot) loadMotoristaData(selectedMot.uid);
      loadDashboardData();
    } catch (err) {
      alert('Erro ao resetar status.');
    }
  };

  const handleStartEdit = (item: any, type: any) => setEditingItem({ id: item.id, type, data: { ...item } });

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const { id, type, data } = editingItem;
    try {
      if (type === 'frete') {
        const payload: any = {};
        if (data.origem) payload.origem = data.origem;
        if (data.destino) payload.destino = data.destino;
        if (data.kmInicial) payload.km_inicial = Number(data.kmInicial);
        if (data.kmFinal) payload.km_final = Number(data.kmFinal);

        await api.patch('/fretes/' + id, payload);
      } else if (type === 'despesa' || type === 'manutencao') {
        await api.patch('/despesas/' + id, { descricao: data.descricao, valor: parseFloat(data.valor) });
      } else if (type === 'abastecimento') {
        await api.patch('/abastecimentos/' + id, {
          posto: data.posto,
          litros: parseFloat(data.litros),
          valor_total: parseFloat(data.valorTotal || data.valor_total)
        });
      } else if (type === 'vale') {
        await api.patch('/vales/' + id, { valor: parseFloat(data.valor), posto: data.posto });
      }
      if (selectedMot) loadMotoristaData(selectedMot.uid);
      setEditingItem(null);
    } catch (err) {
      alert('Erro ao salvar edição.');
    }
  };

  const handleFinalizarViagem = async () => {
    if (!selectedMot) return;
    try {
      const ativo = fretes.find(f => f.status === 'ativo' || f.status === 'pendente');
      if (ativo) {
        await api.patch('/fretes/' + ativo.id, { status: 'finalizado' });
        const promises = [
          ...despesas.filter(d => d.status === 'aprovado').map(d => api.patch('/despesas/' + d.id, { status: 'finalizado' })),
          ...abastecimentos.filter(a => a.status === 'aprovado').map(a => api.patch('/abastecimentos/' + a.id, { status: 'finalizado' })),
          ...vales.filter(v => v.status === 'aprovado').map(v => api.patch('/vales/' + v.id, { status: 'finalizado' }))
        ];
        await Promise.allSettled(promises);
      }
      setSelectedMot(null);
      loadDashboardData();
      alert('Viagem finalizada com sucesso! Os dados foram movidos para o resumo histórico.');
    } catch (err) {
      alert('Erro ao finalizar viagem no servidor.');
    }
  };

  const handleToggleBlock = async (mot: any) => {
    const newStatus = mot.statusCadastro === 'bloqueado' ? 'ativo' : 'bloqueado';
    try {
      await api.patch('/admin/motoristas/' + mot.uid + '/block', { status: newStatus });
      loadDashboardData();
      if (selectedMot?.uid === mot.uid) setSelectedMot((prev: any) => ({ ...prev, statusCadastro: newStatus }));
    } catch (err) {
      alert('Erro ao bloquear/desbloquear motorista.');
    }
  };

  const handleSubmitFrete = async () => {
    if (!newFrete.motorista_id || !newFrete.origem || !newFrete.destino || !newFrete.valor_frete) {
      alert('Preencha motorista, origem, destino e valor.'); return;
    }
    setSavingFrete(true);
    try {
      await api.post('/fretes', {
        motorista_id: newFrete.motorista_id,
        origem: newFrete.origem,
        destino: newFrete.destino,
        valor_frete: Number(newFrete.valor_frete),
        ...(newFrete.km_inicial ? { km_inicial: Number(newFrete.km_inicial) } : {}),
      });
      setShowAddFreteModal(false);
      setNewFrete({ motorista_id: '', origem: '', destino: '', valor_frete: '', km_inicial: '' });
      loadDashboardData();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erro ao adicionar frete.');
    } finally { setSavingFrete(false); }
  };

  const handleSubmitDespesa = async () => {
    if (!selectedMot) return;
    const tipo = newDespesa.tipo;
    if (tipo === 'despesa' && (!newDespesa.descricao || !newDespesa.valor)) { alert('Preencha descrição e valor.'); return; }
    if (tipo === 'abastecimento' && (!newDespesa.posto || !newDespesa.litros || !newDespesa.valor_total)) { alert('Preencha posto, litros e valor total.'); return; }
    if (tipo === 'vale' && !newDespesa.valor) { alert('Preencha o valor do vale.'); return; }
    setSavingDespesa(true);
    try {
      if (tipo === 'abastecimento') {
        await api.post('/abastecimentos', { motorista_id: selectedMot.uid, posto: newDespesa.posto, litros: Number(newDespesa.litros), valor_total: Number(newDespesa.valor_total), quem_pagou: newDespesa.quem_pagou, data: newDespesa.data });
      } else if (tipo === 'vale') {
        await api.post('/vales', { motorista_id: selectedMot.uid, descricao: newDespesa.descricao || 'Vale/Adiantamento', valor: Number(newDespesa.valor), quem_pagou: 'proprietario', data: newDespesa.data });
      } else {
        await api.post('/despesas', { motorista_id: selectedMot.uid, tipo: 'geral', descricao: newDespesa.descricao, valor: Number(newDespesa.valor), quem_pagou: newDespesa.quem_pagou, data: newDespesa.data });
      }
      setShowAddDespesaModal(false);
      setNewDespesa({ tipo: 'despesa', descricao: '', valor: '', quem_pagou: 'proprietario', posto: '', litros: '', valor_total: '', data: '' });
      loadMotoristaData(selectedMot.uid);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erro ao adicionar lançamento.');
    } finally { setSavingDespesa(false); }
  };


  const [summaryPage, setSummaryPage] = useState(1);
  const [summaryPageSize, setSummaryPageSize] = useState(5);

  const mFretes = fretes;
  const mDespesas = despesas;
  const mAbast = abastecimentos;
  const mVales = vales;

  const opTotalFretes = mFretes.reduce((acc, f) => acc + parseFloat(f.valorFrete), 0);
  const opComissao = opTotalFretes * ((selectedMot?.percentualComissao || 0) / 100);

  const opDespMot = mDespesas.filter(d => d.status === 'aprovado' && d.quemPagou === 'motorista').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastMot = mAbast.filter(a => a.status === 'aprovado' && a.quemPagou === 'motorista').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);

  const opDespOwner = mDespesas.filter(d => d.status === 'aprovado' && d.quemPagou === 'proprietario').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastOwner = mAbast.filter(a => a.status === 'aprovado' && a.quemPagou === 'proprietario').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);
  const opValesOwner = mVales.filter(v => v.status === 'aprovado' && v.quemPagou === 'proprietario').reduce((acc, v) => acc + parseFloat(v.valor), 0);

  const opSaldoLiquido = opComissao + opDespMot + opAbastMot - opValesOwner;
  const opLucroEmpresa = opTotalFretes - opComissao - opDespOwner - opAbastOwner;

  const temPendente = mDespesas.some(d => d.status === 'pendente') || mAbast.some(a => a.status === 'pendente') || mVales.some(v => v.status === 'pendente');

  const totalLiters = mAbast.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.litros) || 0), 0);
  const totalKM = mFretes.reduce((acc, f) => {
    if (f.kmFinal && f.kmInicial && f.kmFinal > f.kmInicial) {
      return acc + (f.kmFinal - f.kmInicial);
    }
    return acc;
  }, 0);
  const mediaConsumo = totalLiters > 0 && totalKM > 0 ? (totalKM / totalLiters).toFixed(2) : '0.00';

  // Lógica de Paginação do Resumo
  const totalItems = summary?.fretes_por_motorista?.length || 0;
  const totalPages = Math.ceil(totalItems / summaryPageSize);
  const paginatedSummary = summary?.fretes_por_motorista?.slice(
    (summaryPage - 1) * summaryPageSize,
    summaryPage * summaryPageSize
  ) || [];

  return (
    <div className="space-y-6 pb-10">
      {!selectedMot && (
        <div className="flex justify-between items-center animate-fade-in">
          <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
          <input
            type="month"
            value={format(selectedMonth, 'yyyy-MM')}
            onChange={(e) => setSelectedMonth(new Date(e.target.value + '-01T12:00:00'))}
            className="px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white shadow-sm"
          />
        </div>
      )}

      {!selectedMot && summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-fade-in">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <DollarSign size={20} className="text-blue-600" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Total de Fretes</p>
            </div>
            <p className="text-3xl font-bold text-blue-600">{formatCurrency(summary.total_fretes)}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-green-100">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-green-600" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Comissão</p>
            </div>
            <p className="text-3xl font-bold text-green-600">{formatCurrency(summary.total_comissoes)}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-orange-100">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <Fuel size={20} className="text-orange-600" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Deduções</p>
            </div>
            <p className="text-3xl font-bold text-orange-600">{formatCurrency(summary.total_deducoes)}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-purple-100">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Truck size={20} className="text-purple-600" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Saldo a Receber</p>
            </div>
            <p className="text-3xl font-bold text-purple-600">{formatCurrency(Math.abs(summary.saldo_a_pagar))}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {!selectedMot && (
          <div className="flex justify-between items-center px-2 animate-fade-in">
            <button
              onClick={() => window.open('/viagens', '_blank')}
              className="text-xl font-bold text-gray-700 flex items-center hover:text-blue-600 transition-colors cursor-pointer"
              title="Abrir Gerenciamento de Viagens em nova aba"
            >
              <DollarSign size={20} className="mr-2 text-green-600" /> Gerenciamento de Viagens
            </button>
            <button
              onClick={() => { setShowAddFreteModal(true); setNewFrete({ motorista_id: '', origem: '', destino: '', valor_frete: '', km_inicial: '' }); }}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95 font-bold text-sm"
            >
              <Plus size={18} className="mr-1" /> Adicionar Frete
            </button>
          </div>
        )}

        {selectedMot ? (
          <div className="animate-fade-in space-y-6">
            <button onClick={() => setSelectedMot(null)} className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors">
              <ChevronLeft size={20} className="mr-1" /> Voltar para Lista
            </button>
            <div className="bg-blue-600 p-6 rounded-xl shadow-lg flex flex-wrap justify-between items-center gap-4 text-white">
              <div className="flex items-center space-x-4">
                <div className="bg-white w-12 h-12 rounded-lg flex items-center justify-center text-blue-600 font-bold text-xl">{selectedMot.nomeCompleto?.charAt(0) || '?'}</div>
                <div>
                  <h2 className="text-2xl font-bold">{selectedMot.nomeCompleto}</h2>
                  <p className="text-blue-100 text-sm">Placa: {selectedMot.placaVeiculo} | Comissão: {selectedMot.percentualComissao}%</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="bg-white/20 px-4 py-2 rounded-lg flex items-center border border-white/10">
                  <Fuel size={18} className="mr-2" />
                  <div className="text-left">
                    <p className="text-[10px] uppercase font-bold text-blue-100">Média Consumo</p>
                    <p className="font-bold">{mediaConsumo} KM/L</p>
                  </div>
                </div>
                <button onClick={() => handleToggleBlock(selectedMot)} className="p-2 rounded-lg transition-colors bg-white/20 hover:bg-white/30 border border-white/10">
                  {selectedMot.statusCadastro === 'bloqueado' ? <Unlock size={20} /> : <Lock size={20} />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="bg-gray-50 p-4 border-b border-gray-100 font-bold text-gray-700 flex items-center justify-between">
                    <span className="flex items-center"><FileText className="mr-2" size={18} /> Lançamentos</span>
                    <button
                      onClick={() => { setShowAddDespesaModal(true); setNewDespesa({ tipo: 'despesa', descricao: '', valor: '', quem_pagou: 'proprietario', posto: '', litros: '', valor_total: '', data: new Date().toISOString().split('T')[0] }); }}
                      className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm"
                    >
                      <Plus size={14} className="mr-1" /> Nova Despesa
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    {mFretes.length === 0 && mDespesas.length === 0 && mAbast.length === 0 && mVales.length === 0 && <p className="text-gray-500 text-center py-8">Nenhum lançamento.</p>}

                    {mFretes.map(f => (
                      <div key={f.id} className="group flex justify-between items-center p-3 border rounded-lg bg-blue-50/30 border-blue-100 transition-all">
                        <div className="flex-1">
                          {editingItem?.id === f.id ? (
                            <div className="grid grid-cols-3 gap-2 pr-4">
                              <input className="border rounded px-2 py-1 text-sm" placeholder="Origem" value={editingItem!.data.origem} onChange={e => setEditingItem(prev => prev ? { ...prev, data: { ...prev.data, origem: e.target.value } } : prev)} />
                              <input className="border rounded px-2 py-1 text-sm" placeholder="Destino" value={editingItem!.data.destino} onChange={e => setEditingItem(prev => prev ? { ...prev, data: { ...prev.data, destino: e.target.value } } : prev)} />
                              <div className="flex space-x-1">
                                <input type="number" className="border rounded px-2 py-1 text-sm w-1/2" placeholder="KM Ini" value={editingItem!.data.kmInicial || ''} onChange={e => setEditingItem(prev => prev ? { ...prev, data: { ...prev.data, kmInicial: Number(e.target.value) } } : prev)} />
                                <input type="number" className="border rounded px-2 py-1 text-sm w-1/2" placeholder="KM Fim" value={editingItem!.data.kmFinal || ''} onChange={e => setEditingItem(prev => prev ? { ...prev, data: { ...prev.data, kmFinal: Number(e.target.value) } } : prev)} />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="font-medium text-gray-800">Frete: {f.origem} ➔ {f.destino}</p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500 mt-1">
                                {f.kmInicial && f.kmFinal ? (
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded">KM: {f.kmInicial} - {f.kmFinal} ({f.kmFinal - f.kmInicial} km)</span>
                                ) : (
                                  <span className="text-orange-500 italic">KM Final Pendente</span>
                                )}
                                <span>{format(new Date(f.criadoEm), 'dd/MM/yyyy')}</span>
                                {(() => {
                                  const litrosFrete = mAbast.filter(a => a.frete_id === f.id && a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.litros) || 0), 0);
                                  const dist = (f.kmFinal || 0) - (f.kmInicial || 0);
                                  if (litrosFrete > 0 && dist > 0) {
                                    return <span className="text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">Média: {(dist / litrosFrete).toFixed(2)} KM/L</span>;
                                  }
                                  return null;
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="font-bold text-blue-600">{formatCurrency(f.valorFrete)}</span>
                          {editingItem?.id === f.id ? <button onClick={handleSaveEdit} className="p-1 bg-green-600 text-white rounded shadow-sm"><Save size={16} /></button> : <button onClick={() => handleStartEdit(f, 'frete')} className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"><Edit size={16} /></button>}
                        </div>
                      </div>
                    ))}

                    {[...mDespesas, ...mAbast, ...mVales].map((item: any) => {
                      const type = item.litros ? 'abastecimento' : item.quemPagou === 'proprietario' && !item.descricao ? 'vale' : item.tipo === 'manutencao' ? 'manutencao' : 'despesa';
                      return (
                        <div key={item.id} className={`group flex justify-between items-center p-3 border rounded-lg transition-all ${item.status === 'aprovado' ? 'bg-green-50/50 border-green-100' : item.status === 'rejeitado' ? 'bg-red-50/50 border-red-100' : 'border-gray-100'}`}>
                          <div className="flex-1">
                            <p className="font-medium text-gray-800">
                              {type === 'manutencao' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded mr-2 font-bold">MANUTENÇÃO</span>}
                              {item.descricao || item.posto || 'Vale/Adiantamento'} {item.litros && <span className="text-xs text-blue-600">({item.litros}L)</span>}
                            </p>
                            <p className="text-xs text-gray-500">Pago por: {item.quemPagou} • {format(new Date(item.data), 'dd/MM HH:mm')}</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`font-bold ${type === 'vale' ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(Math.abs(item.valor || item.valorTotal))}</span>
                            {item.status === 'pendente' ? (
                              <div className="flex space-x-1">
                                <button onClick={() => handleAprovarDespesa(item.id, type as any, true)} className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors" title="Aprovar"><Check size={18} /></button>
                                <button onClick={() => handleAprovarDespesa(item.id, type as any, false)} className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors" title="Rejeitar"><X size={18} /></button>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-1">
                                <button
                                  onClick={() => handleResetStatus(item.id, type as any)}
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase transition-all hover:opacity-80 active:scale-95 ${item.status === 'aprovado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                                  title="Clique para mudar status"
                                >
                                  {item.status}
                                </button>
                                {editingItem?.id === item.id ? (
                                  <button onClick={handleSaveEdit} className="p-1 bg-green-600 text-white rounded shadow-sm"><Save size={16} /></button>
                                ) : (
                                  <button onClick={() => { handleStartEdit(item, type); handleResetStatus(item.id, type as any); }} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Editar"><Edit size={16} /></button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 h-fit sticky top-6">
                <h4 className="flex items-center text-gray-800 mb-6 font-bold text-lg"><DollarSign className="mr-2 text-green-600" /> Balanço Atual</h4>
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-500">Valor Total do Frete:</span>
                    <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-500">Porcentagem Motorista ({selectedMot?.percentualComissao || 0}%):</span>
                    <span className="font-bold text-blue-600">+{formatCurrency(opComissao)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-500">Desp./Abast. (Motorista):</span>
                    <span className="font-bold text-green-600">+{formatCurrency(opDespMot + opAbastMot)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-500">Vales / Adiantamentos:</span>
                    <span className="font-bold text-red-600">-{formatCurrency(opValesOwner)}</span>
                  </div>
                  <div className="flex justify-between items-center text-base font-extrabold bg-gray-50 p-3 rounded-lg">
                    <span className="text-gray-700">SALDO MOTORISTA:</span>
                    <span className={opSaldoLiquido >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(Math.abs(opSaldoLiquido))}</span>
                  </div>

                  <div className="pt-6 border-t border-gray-100 mt-4">
                    <div className="flex justify-between items-center text-sm font-bold text-gray-600 px-1">
                      <span className="flex items-center"><TrendingUp size={16} className="mr-2 text-green-500" /> RESULTADO EMPRESA:</span>
                      <span className="text-gray-900">{formatCurrency(Math.abs(opLucroEmpresa))}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 px-1">* Frete Total (-) Comissão (-) Despesas/Abast. pagos pela empresa.</p>
                  </div>
                </div>
                <button onClick={handleFinalizarViagem} disabled={temPendente} className="mt-8 w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 transition-all disabled:opacity-50 disabled:shadow-none active:scale-95 flex items-center justify-center">
                  <Check size={20} className="mr-2" /> FINALIZAR VIAGEM
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8 animate-fade-in">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase font-bold tracking-wider">
                  <th className="p-5 border-b">Motorista (Em Curso/Pendente)</th>
                  <th className="p-5 border-b">Placa</th>
                  <th className="p-5 border-b">Status</th>
                  <th className="p-5 border-b text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {motoristasEmViagem.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-10 text-center text-gray-500 italic">
                      Nenhum motorista em viagem ativa no momento.
                    </td>
                  </tr>
                ) : (
                  motoristasEmViagem.map(mot => (
                    <tr key={mot.uid} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-5">
                        <div className="flex items-center">
                          <div className="bg-blue-50 text-blue-600 w-8 h-8 rounded-lg flex items-center justify-center mr-3 font-bold text-xs">{mot.nomeCompleto?.charAt(0) || '?'}</div>
                          <span className="font-semibold text-gray-700">{mot.nomeCompleto}</span>
                        </div>
                      </td>
                      <td className="p-5 text-gray-600 font-medium">{mot.placaVeiculo}</td>
                      <td className="p-5">
                        <span className={`flex items-center text-xs font-bold px-2 py-1 rounded-full w-fit ${mot.statusCadastro === 'bloqueado' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                          {mot.statusCadastro === 'bloqueado' ? <Lock size={14} className="mr-1" /> : <AlertCircle size={14} className="mr-1" />}
                          {mot.statusCadastro === 'bloqueado' ? 'BLOQUEADO' : 'EM VIAGEM'}
                        </span>
                      </td>
                      <td className="p-5 text-center">
                        <button
                          onClick={() => { setSelectedMot(mot); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-md transition-all active:scale-95"
                        >
                          Gerenciar Viagem
                        </button>
                      </td>
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!selectedMot && summary?.fretes_por_motorista && (
        <div className="space-y-6 mt-6 animate-fade-in">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
              <button
                onClick={() => window.open('/resumo', '_blank')}
                className="text-lg font-bold text-gray-800 flex items-center hover:text-blue-600 transition-colors cursor-pointer"
                title="Abrir Resumo por Motorista em nova aba"
              >
                <Truck size={22} className="mr-2 text-blue-600" /> Resumo por Motorista
              </button>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-gray-400 uppercase">Mostrar:</span>
                  <select
                    value={summaryPageSize}
                    onChange={(e) => { setSummaryPageSize(Number(e.target.value)); setSummaryPage(1); }}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm font-bold text-gray-600 outline-none focus:border-blue-500"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 text-gray-500 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
                    <th className="p-4">Motorista</th>
                    <th className="p-4">Última Rota</th>
                    <th className="p-4 text-center">KM Total</th>
                    <th className="p-4 text-center">Média</th>
                    <th className="p-4 text-right">Total Fretes</th>
                    <th className="p-4 text-right">Comissão</th>
                    <th className="p-4 text-right">Despesas</th>
                    <th className="p-4 text-right">Saldo Líquido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginatedSummary.map((m: any, idx: number) => (
                    <tr key={idx} className="hover:bg-blue-50/30 transition-colors group">
                      <td className="p-4">
                        <div className="flex items-center">
                          <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-[10px] font-bold mr-2 border border-blue-200">
                            {m.nome?.charAt(0) || '?'}
                          </div>
                          <span className="text-sm font-bold text-gray-700">{m.nome}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md">{m.ultima_rota || '-'}</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-xs font-bold text-gray-600">{m.total_km} KM</span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`text-xs font-bold px-2 py-1 rounded-md ${parseFloat(m.media_consumo) > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-400'}`}>
                          {m.media_consumo} KM/L
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-xs font-bold text-gray-700">{formatCurrency(m.total_fretes)}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-xs font-bold text-blue-600">{formatCurrency(m.comissao)}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-xs font-medium text-red-500">-{formatCurrency(m.deducoes)}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-sm font-black text-green-700">{formatCurrency(m.saldo)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="p-4 bg-gray-50 border-t flex justify-between items-center">
                <span className="text-xs font-bold text-gray-400 uppercase">Página {summaryPage} de {totalPages}</span>
                <div className="flex space-x-2">
                  <button
                    disabled={summaryPage === 1}
                    onClick={() => setSummaryPage(prev => prev - 1)}
                    className="px-3 py-1 bg-white border border-gray-200 rounded text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    disabled={summaryPage === totalPages}
                    onClick={() => setSummaryPage(prev => prev + 1)}
                    className="px-3 py-1 bg-white border border-gray-200 rounded text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showAddFreteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddFreteModal(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Adicionar Frete</h3>
              <button onClick={() => setShowAddFreteModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Motorista *</label>
                <select value={newFrete.motorista_id} onChange={e => setNewFrete(p => ({ ...p, motorista_id: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
                  <option value="">Selecione o motorista</option>
                  {motoristasEmViagem.map(m => <option key={m.uid} value={m.uid}>{m.nomeCompleto} — {m.placaVeiculo}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Origem *</label>
                  <input value={newFrete.origem} onChange={e => setNewFrete(p => ({ ...p, origem: e.target.value }))} placeholder="Ex: São Paulo" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Destino *</label>
                  <input value={newFrete.destino} onChange={e => setNewFrete(p => ({ ...p, destino: e.target.value }))} placeholder="Ex: Brasília" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Valor do Frete (R$) *</label>
                  <input type="number" min="0" step="0.01" value={newFrete.valor_frete} onChange={e => setNewFrete(p => ({ ...p, valor_frete: e.target.value }))} placeholder="0,00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">KM Inicial</label>
                  <input type="number" min="0" value={newFrete.km_inicial} onChange={e => setNewFrete(p => ({ ...p, km_inicial: e.target.value }))} placeholder="Opcional" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>
            <div className="p-5 pt-0 flex justify-end gap-3">
              <button onClick={() => setShowAddFreteModal(false)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
              <button onClick={handleSubmitFrete} disabled={savingFrete} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                {savingFrete ? 'Salvando...' : 'Adicionar Frete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddDespesaModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddDespesaModal(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Novo Lançamento — {selectedMot?.nomeCompleto}</h3>
              <button onClick={() => setShowAddDespesaModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">Tipo</label>
                <div className="flex gap-2">
                  {(['despesa', 'abastecimento', 'vale'] as const).map(t => (
                    <button key={t} onClick={() => setNewDespesa(p => ({ ...p, tipo: t }))}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ${newDespesa.tipo === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}>
                      {t === 'despesa' ? 'Despesa' : t === 'abastecimento' ? 'Abastecimento' : 'Vale'}
                    </button>
                  ))}
                </div>
              </div>

              {newDespesa.tipo === 'despesa' && (<>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Descrição *</label>
                  <input value={newDespesa.descricao} onChange={e => setNewDespesa(p => ({ ...p, descricao: e.target.value }))} placeholder="Ex: Pedágio, manutenção..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Valor (R$) *</label>
                    <input type="number" min="0" step="0.01" value={newDespesa.valor} onChange={e => setNewDespesa(p => ({ ...p, valor: e.target.value }))} placeholder="0,00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Pago por</label>
                    <select value={newDespesa.quem_pagou} onChange={e => setNewDespesa(p => ({ ...p, quem_pagou: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
                      <option value="proprietario">Proprietário</option>
                      <option value="motorista">Motorista</option>
                    </select>
                  </div>
                </div>
              </>)}

              {newDespesa.tipo === 'abastecimento' && (<>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Posto *</label>
                  <input value={newDespesa.posto} onChange={e => setNewDespesa(p => ({ ...p, posto: e.target.value }))} placeholder="Nome do posto" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Litros *</label>
                    <input type="number" min="0" step="0.01" value={newDespesa.litros} onChange={e => setNewDespesa(p => ({ ...p, litros: e.target.value }))} placeholder="0,00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Total (R$) *</label>
                    <input type="number" min="0" step="0.01" value={newDespesa.valor_total} onChange={e => setNewDespesa(p => ({ ...p, valor_total: e.target.value }))} placeholder="0,00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Pago por</label>
                    <select value={newDespesa.quem_pagou} onChange={e => setNewDespesa(p => ({ ...p, quem_pagou: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
                      <option value="proprietario">Proprietário</option>
                      <option value="motorista">Motorista</option>
                    </select>
                  </div>
                </div>
              </>)}

              {newDespesa.tipo === 'vale' && (<>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Valor (R$) *</label>
                    <input type="number" min="0" step="0.01" value={newDespesa.valor} onChange={e => setNewDespesa(p => ({ ...p, valor: e.target.value }))} placeholder="0,00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Descrição</label>
                    <input value={newDespesa.descricao} onChange={e => setNewDespesa(p => ({ ...p, descricao: e.target.value }))} placeholder="Opcional" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                </div>
                <p className="text-xs text-gray-400 italic">Vales são sempre debitados do proprietário.</p>
              </>)}

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Data</label>
                <input type="date" value={newDespesa.data} onChange={e => setNewDespesa(p => ({ ...p, data: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="p-5 pt-0 flex justify-end gap-3">
              <button onClick={() => setShowAddDespesaModal(false)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
              <button onClick={handleSubmitDespesa} disabled={savingDespesa} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                {savingDespesa ? 'Salvando...' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* (O restante do arquivo continua igualzinho) */}
    </div>
  );
};
