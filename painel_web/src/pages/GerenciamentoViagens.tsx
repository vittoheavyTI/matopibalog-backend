import React, { useState, useEffect } from 'react';
import { Plus, X, Search, Filter, Truck, MapPin, Calendar, DollarSign, Gauge, Trash2, Edit, Check, AlertTriangle, ChevronLeft, Fuel, FileText, TrendingUp, Save, Unlock, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../utils';
import api from '../api';

const gvFmt = (d: any, fmt: string) => {
  if (!d) return '-';
  try { const dt = new Date(d); if (isNaN(dt.getTime())) return '-'; return format(dt, fmt); } catch { return '-'; }
};

export const GerenciamentoViagens: React.FC = () => {
  const [fretes, setFretes] = useState<any[]>([]);
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [filterMot, setFilterMot] = useState('todos');

  const [showModal, setShowModal] = useState(false);
  const [editingFrete, setEditingFrete] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFinalizarModal, setShowFinalizarModal] = useState(false);

  const [formData, setFormData] = useState({
    motorista_id: '',
    origem: '',
    destino: '',
    valor_frete: '',
    km_inicial: '',
    km_final: '',
    quem_recebeu: 'proprietario',
    status: 'ativo',
    data: format(new Date(), 'yyyy-MM-dd')
  });

  const [despesas, setDespesas] = useState<any[]>([]);
  const [abastecimentos, setAbastecimentos] = useState<any[]>([]);
  const [vales, setVales] = useState<any[]>([]);
  const [editingItem, setEditingItem] = useState<{ id: string, type: string, data: any } | null>(null);
  const [showAddModal, setShowAddModal] = useState<'despesa' | 'abastecimento' | 'vale' | 'manutencao' | null>(null);
  const [newItemData, setNewItemData] = useState<any>({});

  const loadData = async () => {
    try {
      setLoading(true);
      const [resFretes, resMots] = await Promise.all([
        api.get('/fretes'),
        api.get('/admin/motoristas')
      ]);
      const fretesData = resFretes.data || [];
      const motsData = resMots.data || [];
      setFretes(fretesData);
      setMotoristas(motsData.map((m: any) => ({
        uid: m.id,
        nome: m.usuarios?.nome,
        placa: m.placa_veiculo,
        comissao: m.percentual_comissao,
        status: m.usuarios?.status
      })));
    } catch (err) {
      console.error('Erro ao carregar viagens:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMotoristaData = async (motId: string) => {
    try {
      const [resF, resD, resA, resV] = await Promise.all([
        api.get('/fretes?motorista_id=' + motId),
        api.get('/despesas?motorista_id=' + motId),
        api.get('/abastecimentos?motorista_id=' + motId),
        api.get('/vales?motorista_id=' + motId)
      ]);
      const fretesData = (resF.data || []).filter((f: any) => f.status !== 'finalizado');
      const despesasData = (resD.data || []).filter((d: any) => d.status !== 'finalizado');
      const abastData = (resA.data || []).filter((a: any) => a.status !== 'finalizado');
      const valesData = (resV.data || []).filter((v: any) => v.status !== 'finalizado');
      setFretes(fretesData.filter((f: any) => f.status !== 'finalizado').map((f: any) => ({
        id: f.id, motorista_id: f.motorista_id, motoristaUid: f.motorista_id,
        motoristas: f.motoristas,
        origem: f.origem, destino: f.destino,
        valor_frete: f.valor_frete, valorFrete: f.valor_frete,
        km_inicial: f.km_inicial, km_final: f.km_final,
        kmInicial: f.km_inicial, kmFinal: f.km_final,
        data: f.data, criadoEm: f.data,
        status: f.status, placa: f.placa
      })));
      setDespesas(despesasData.filter((d: any) => d.status !== 'finalizado').map((d: any) => ({
        id: d.id, motoristaUid: d.motorista_id, descricao: d.descricao,
        valor: d.valor, quemPagou: d.quem_pagou, status: d.status, data: d.data, tipo: 'despesa'
      })));
      setAbastecimentos(abastData.filter((a: any) => a.status !== 'finalizado').map((a: any) => ({
        id: a.id, motoristaUid: a.motorista_id, posto: a.posto, litros: a.litros,
        valorTotal: a.valor_total, quemPagou: a.quem_pagou, status: a.status,
        data: a.data, frete_id: a.frete_id, tipo: 'abastecimento'
      })));
      setVales(valesData.filter((v: any) => v.status !== 'finalizado').map((v: any) => ({
        id: v.id, motoristaUid: v.motorista_id, descricao: v.descricao,
        valor: v.valor, quemPagou: v.quem_pagou, status: v.status, data: v.data, tipo: 'vale'
      })));
    } catch (err) {
      console.error('Erro ao carregar dados do motorista', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (filterMot !== 'todos') {
      loadMotoristaData(filterMot);
    }
  }, [filterMot]);

  const openNewModal = (motId?: string) => {
    setEditingFrete(null);
    setFormData({
      motorista_id: motId || '',
      origem: '',
      destino: '',
      valor_frete: '',
      km_inicial: '',
      km_final: '',
      quem_recebeu: 'proprietario',
      status: 'ativo',
      data: format(new Date(), 'yyyy-MM-dd')
    });
    setShowModal(true);
  };

  const openEditModal = (frete: any) => {
    setEditingFrete(frete);
    setFormData({
      motorista_id: frete.motorista_id,
      origem: frete.origem,
      destino: frete.destino,
      valor_frete: String(frete.valor_frete),
      km_inicial: frete.km_inicial ? String(frete.km_inicial) : '',
      km_final: frete.km_final ? String(frete.km_final) : '',
      quem_recebeu: frete.quem_recebeu,
      status: frete.status,
      data: frete.data ? format(new Date(frete.data), 'yyyy-MM-dd') : ''
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      const payload = {
        origem: formData.origem,
        destino: formData.destino,
        valor_frete: parseFloat(formData.valor_frete),
        km_inicial: formData.km_inicial ? parseInt(formData.km_inicial) : null,
        km_final: formData.km_final ? parseInt(formData.km_final) : null,
        quem_recebeu: formData.quem_recebeu,
        status: formData.status,
        data: formData.data
      };

      if (editingFrete) {
        await api.patch('/fretes/' + editingFrete.id, {...payload});
      } else {
        await api.post('/fretes', { ...payload, motorista_id: formData.motorista_id });
      }
      if (filterMot !== 'todos') {
        await loadMotoristaData(filterMot);
      } else {
        await loadData();
      }
      setShowModal(false);
    } catch (err: any) {
      alert('Erro ao salvar viagem: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await api.delete('/fretes/' + deleteTarget.id);
      setDeleteTarget(null);
      if (filterMot !== 'todos') {
        await loadMotoristaData(filterMot);
      } else {
        await loadData();
      }
    } catch (err: any) {
      alert('Erro ao excluir viagem: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsDeleting(false);
    }
  };

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
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
    } catch (err) {
      alert('Erro ao atualizar status.');
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
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
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
        await api.patch('/fretes/' + id, {...payload});
      } else if (type === 'despesa' || type === 'manutencao') {
        await api.patch('/despesas/' + id, { descricao: data.descricao, valor: parseFloat(data.valor) });
      } else if (type === 'abastecimento') {
        await api.patch('/abastecimentos/' + id, {
          posto: data.posto, litros: parseFloat(data.litros), valor_total: parseFloat(data.valorTotal || data.valor_total)
        });
      } else if (type === 'vale') {
        await api.patch('/vales/' + id, { valor: parseFloat(data.valor), posto: data.posto });
      }
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
      setEditingItem(null);
    } catch (err) {
      alert('Erro ao salvar edição.');
    }
  };

  const handleAddItem = async () => {
    if (!selectedMotorista || !showAddModal) return;
    try {
      if (showAddModal === 'despesa' || showAddModal === 'manutencao') {
        await api.post('/despesas', { motorista_id: filterMot, descricao: newItemData.descricao, valor: Number(newItemData.valor), quem_pagou: newItemData.quemPagou || 'proprietario' });
      } else if (showAddModal === 'abastecimento') {
        await api.post('/abastecimentos', { motorista_id: filterMot, posto: newItemData.posto, litros: Number(newItemData.litros), valor_total: Number(newItemData.valorTotal), quem_pagou: newItemData.quemPagou || 'proprietario' });
      } else if (showAddModal === 'vale') {
        await api.post('/vales', { motorista_id: filterMot, descricao: newItemData.descricao, valor: Number(newItemData.valor), quem_pagou: newItemData.quemPagou || 'proprietario' });
      }
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
      setShowAddModal(null);
      setNewItemData({});
    } catch (err) {
      alert('Erro ao adicionar item.');
    }
  };

  const handleFinalizarViagem = () => {
    if (!selectedMotorista) return;
    setShowFinalizarModal(true);
  };

  const confirmFinalizarViagem = async () => {
    if (!selectedMotorista) return;
    try {
      const ativo = fretes.find(f => f.status === 'ativo' || f.status === 'pendente');
      if (ativo) {
        await api.patch('/fretes/' + ativo.id, { status: 'finalizado' });
        const promises = [
          ...despesas.filter(d => d.status === 'aprovado').map(d => api.patch('/despesas/' + d.id, { status: 'finalizado' })),
          ...abastecimentos.filter(a => a.status === 'aprovado').map(a => api.patch('/abastecimentos/' + a.id, { status: 'finalizado' })),
          ...vales.filter(v => v.status === 'aprovado').map(v => api.patch('/vales/' + v.id, { status: 'finalizado' }))
        ];
        await Promise.all(promises);
      }
      setShowFinalizarModal(false);
      setFilterMot('todos');
      loadData();
      alert('Viagem finalizada com sucesso! Os dados foram movidos para o resumo histórico.');
    } catch (err) {
      alert('Erro ao finalizar viagem no servidor.');
    }
  };

  const handleToggleBlock = async () => {
    if (!selectedMotorista) return;
    const newStatus = selectedMotorista.status === 'bloqueado' ? 'ativo' : 'bloqueado';
    try {
      await api.patch('/admin/motoristas/' + filterMot + '/block', { status: newStatus });
      setMotoristas(prev => prev.map(m => m.uid === filterMot ? { ...m, status: newStatus } : m));
    } catch (err) {
      alert('Erro ao bloquear/desbloquear motorista.');
    }
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, string> = {
      ativo: 'bg-blue-100 text-blue-700', pendente: 'bg-yellow-100 text-yellow-700',
      finalizado: 'bg-green-100 text-green-700', cancelado: 'bg-red-100 text-red-700',
      aprovado: 'bg-green-100 text-green-700', rejeitado: 'bg-red-100 text-red-700'
    };
    return config[status] || 'bg-gray-100 text-gray-700';
  };

  const selectedMotorista = filterMot !== 'todos' ? motoristas.find(m => m.uid === filterMot) : null;

  const mFretes = fretes.filter(f => f.motoristaUid === filterMot || f.motorista_id === filterMot);
  const opTotalFretes = mFretes.reduce((acc, f) => acc + parseFloat(f.valorFrete), 0);
  const opComissao = opTotalFretes * ((selectedMotorista?.comissao || 0) / 100);
  const mDesp = despesas;
  const mAbs = abastecimentos;
  const mVales = vales;
  const opDespMot = mDesp.filter(d => d.status === 'aprovado' && d.quemPagou === 'motorista').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastMot = mAbs.filter(a => a.status === 'aprovado' && a.quemPagou === 'motorista').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);
  const opDespOwner = mDesp.filter(d => d.status === 'aprovado' && d.quemPagou === 'proprietario').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastOwner = mAbs.filter(a => a.status === 'aprovado' && a.quemPagou === 'proprietario').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);
  const opValesOwner = mVales.filter(v => v.status === 'aprovado' && v.quemPagou === 'proprietario').reduce((acc, v) => acc + parseFloat(v.valor), 0);
  const opSaldoLiquido = opComissao + opDespMot + opAbastMot - opValesOwner;
  const opLucroEmpresa = opTotalFretes - opComissao - opDespOwner - opAbastOwner;
  const temPendente = mDesp.some(d => d.status === 'pendente') || mAbs.some(a => a.status === 'pendente') || mVales.some(v => v.status === 'pendente');
  const temFreteAtivo = mFretes.some(f => f.status === 'ativo' || f.status === 'pendente');
  const totalLiters = mAbs.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.litros) || 0), 0);
  const totalKM = mFretes.reduce((acc, f) => {
    if (f.kmFinal && f.kmInicial && f.kmFinal > f.kmInicial) return acc + (f.kmFinal - f.kmInicial);
    return acc;
  }, 0);
  const mediaConsumo = totalLiters > 0 && totalKM > 0 ? (totalKM / totalLiters).toFixed(2) : '0.00';

  const filtered = fretes.filter(f => {
    if (f.status === 'finalizado') return false;
    if (filterMot !== 'todos') return f.motoristaUid === filterMot || f.motorista_id === filterMot;
    const matchSearch = f.origem?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.destino?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.motoristas?.usuarios?.nome?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === 'todos' || f.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const renderLista = () => (
    <>
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Gerenciamento de Viagens</h2>
          <p className="text-gray-500 text-sm">Cadastro e acompanhamento de fretes</p>
        </div>
        <button onClick={() => openNewModal()} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95 font-bold">
          <Plus size={20} className="mr-2" /> Nova Viagem
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center">
          <Search className="text-gray-400 mr-2" size={20} />
          <input type="text" placeholder="Buscar por origem, destino ou motorista..." className="flex-1 outline-none text-gray-700" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center space-x-2 text-xs">
            <Filter size={14} className="text-gray-400" />
            <select value={filterMot} onChange={e => setFilterMot(e.target.value)} className="border rounded-lg p-2 outline-none bg-white text-gray-600">
              <option value="todos">Todos Motoristas</option>
              {motoristas.map(m => (<option key={m.uid} value={m.uid}>{m.nome}</option>))}
            </select>
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded-lg p-2 outline-none bg-white text-gray-600 text-xs">
            <option value="todos">Todos Status</option>
            <option value="ativo">Ativo</option><option value="pendente">Pendente</option>
            <option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (<p className="p-8 text-center text-gray-500">Carregando viagens...</p>)
          : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
                  <th className="p-4 border-b">Data</th>
                  <th className="p-4 border-b">Motorista</th>
                  <th className="p-4 border-b">Rota</th>
                  <th className="p-4 border-b">Valor</th>
                  <th className="p-4 border-b">KM</th>
                  <th className="p-4 border-b">Status</th>
                  <th className="p-4 border-b text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(frete => (
                  <tr key={frete.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4">
                      <span className="text-sm text-gray-700 flex items-center">
                        <Calendar size={14} className="mr-1.5 text-gray-400" />
                        {gvFmt(frete.data || frete.criadoEm, 'dd/MM/yyyy')}
                      </span>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => setFilterMot(frete.motorista_id || frete.motoristaUid)}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-800 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                        title="Gerenciar viagens deste motorista"
                      >
                        {frete.motoristas?.usuarios?.nome || frete.motoristaNome || 'N/A'}
                      </button>
                      <span className="text-xs text-gray-400 block px-3">{frete.placa}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center text-sm text-gray-700">
                        <MapPin size={14} className="mr-1 text-green-500 flex-shrink-0" />
                        <span className="truncate max-w-[150px]">{frete.origem}</span>
                        <span className="mx-1.5 text-gray-300">→</span>
                        <MapPin size={14} className="mr-1 text-red-500 flex-shrink-0" />
                        <span className="truncate max-w-[150px]">{frete.destino}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-sm font-bold text-gray-800 flex items-center">
                        <DollarSign size={14} className="mr-0.5 text-green-600" />
                        {formatCurrency(frete.valor_frete || frete.valorFrete)}
                      </span>
                    </td>
                    <td className="p-4">
                      {(frete.km_final || frete.kmFinal) && (frete.km_inicial || frete.kmInicial) ? (
                        <span className="text-sm text-gray-600 flex items-center">
                          <Gauge size={14} className="mr-1 text-blue-500" />
                          {((frete.km_final || frete.kmFinal) - (frete.km_inicial || frete.kmInicial)).toLocaleString()} km
                        </span>
                      ) : (<span className="text-xs text-orange-400 italic">Em curso</span>)}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${getStatusBadge(frete.status)}`}>{frete.status}</span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <button onClick={() => openEditModal(frete)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar"><Edit size={16} /></button>
                        <button onClick={() => setDeleteTarget(frete)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Cancelar viagem"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-400"><Truck size={40} className="mx-auto mb-2 text-gray-300" />Nenhuma viagem encontrada.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );

  const renderDetalheMotorista = () => {
    if (!selectedMotorista) {
      return (
        <div className="py-20 text-center text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          Carregando dados do motorista...
        </div>
      );
    }

    return (
    <>
      <button onClick={() => setFilterMot('todos')} className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors">
        <ChevronLeft size={20} className="mr-1" /> Voltar para Lista
      </button>

      {selectedMotorista && (
        <div className="bg-blue-600 p-6 rounded-xl shadow-lg flex flex-wrap justify-between items-center gap-4 text-white">
          <div className="flex items-center space-x-4">
            <div className="bg-white w-12 h-12 rounded-lg flex items-center justify-center text-blue-600 font-bold text-xl">
              {selectedMotorista.nome?.charAt(0) || '?'}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{selectedMotorista.nome}</h2>
              <p className="text-blue-100 text-sm">Placa: {selectedMotorista.placa} | Comissão: {selectedMotorista.comissao}%</p>
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
            <button onClick={handleToggleBlock} className="p-2 rounded-lg transition-colors bg-white/20 hover:bg-white/30 border border-white/10">
              {selectedMotorista.status === 'bloqueado' ? <Unlock size={20} /> : <Lock size={20} />}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-100 font-bold text-gray-700 flex items-center justify-between">
              <span className="flex items-center"><FileText className="mr-2" size={18} /> Lançamentos</span>
              <div className="flex space-x-2">
                <button onClick={() => setShowAddModal('despesa')} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm">
                  <Plus size={14} className="mr-1" /> Despesa
                </button>
                <button onClick={() => setShowAddModal('abastecimento')} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm">
                  <Plus size={14} className="mr-1" /> Abast.
                </button>
                <button onClick={() => setShowAddModal('vale')} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm">
                  <Plus size={14} className="mr-1" /> Vale
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {mFretes.length === 0 && mDesp.length === 0 && mAbs.length === 0 && mVales.length === 0 &&
                <p className="text-gray-500 text-center py-8">Nenhum lançamento.</p>}

              {mFretes.map((f: any) => (
                <div key={f.id} className="group flex justify-between items-center p-3 border rounded-lg bg-blue-50/30 border-blue-100 transition-all">
                  <div className="flex-1">
                    {editingItem?.id === f.id ? (
                      <div className="grid grid-cols-3 gap-2 pr-4">
                        <input className="border rounded px-2 py-1 text-sm" placeholder="Origem" value={editingItem.data.origem}
                          onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, origem: e.target.value}} : prev)} />
                        <input className="border rounded px-2 py-1 text-sm" placeholder="Destino" value={editingItem.data.destino}
                          onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, destino: e.target.value}} : prev)} />
                        <div className="flex space-x-1">
                          <input type="number" className="border rounded px-2 py-1 text-sm w-1/2" placeholder="KM Ini" value={editingItem.data.kmInicial || ''}
                            onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, kmInicial: Number(e.target.value)}} : prev)} />
                          <input type="number" className="border rounded px-2 py-1 text-sm w-1/2" placeholder="KM Fim" value={editingItem.data.kmFinal || ''}
                            onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, kmFinal: Number(e.target.value)}} : prev)} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="font-medium text-gray-800">Frete: {f.origem} ➔ {f.destino}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500 mt-1">
                          {f.kmInicial && f.kmFinal ? (
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded">KM: {f.kmInicial} - {f.kmFinal} ({f.kmFinal - f.kmInicial} km)</span>
                          ) : (<span className="text-orange-500 italic">KM Final Pendente</span>)}
                          <span>{gvFmt(f.criadoEm || f.data, 'dd/MM/yyyy')}</span>
                          {(() => {
                            const litrosFrete = mAbs.filter((a: any) => a.frete_id === f.id && a.status === 'aprovado').reduce((acc: number, a: any) => acc + (parseFloat(a.litros) || 0), 0);
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
                    {editingItem?.id === f.id
                      ? <button onClick={handleSaveEdit} className="p-1 bg-green-600 text-white rounded shadow-sm"><Save size={16} /></button>
                      : <button onClick={() => handleStartEdit(f, 'frete')} className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"><Edit size={16} /></button>}
                  </div>
                </div>
              ))}

              {[...mDesp, ...mAbs, ...mVales].map((item: any) => {
                const type = item.litros ? 'abastecimento' : item.quemPagou === 'proprietario' && !item.descricao ? 'vale' : item.tipo === 'manutencao' ? 'manutencao' : 'despesa';
                return (
                  <div key={item.id} className={`group flex justify-between items-center p-3 border rounded-lg transition-all ${item.status === 'aprovado' ? 'bg-green-50/50 border-green-100' : item.status === 'rejeitado' ? 'bg-red-50/50 border-red-100' : 'border-gray-100'}`}>
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">
                        {type === 'manutencao' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded mr-2 font-bold">MANUTENÇÃO</span>}
                        {item.descricao || item.posto || 'Vale/Adiantamento'} {item.litros && <span className="text-xs text-blue-600">({item.litros}L)</span>}
                      </p>
                      <p className="text-xs text-gray-500">Pago por: {item.quemPagou} • {gvFmt(item.data, 'dd/MM HH:mm')}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`font-bold ${type === 'vale' ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(Math.abs(item.valor || item.valorTotal))}</span>
                      {item.status === 'pendente' ? (
                        <div className="flex space-x-1">
                          <button onClick={() => handleAprovarDespesa(item.id, type, true)} className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors" title="Aprovar"><Check size={18} /></button>
                          <button onClick={() => handleAprovarDespesa(item.id, type, false)} className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors" title="Rejeitar"><X size={18} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          <button onClick={() => handleResetStatus(item.id, type)}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase transition-all hover:opacity-80 active:scale-95 ${item.status === 'aprovado' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                            title="Clique para mudar status">{item.status}</button>
                          {editingItem?.id === item.id
                            ? <button onClick={handleSaveEdit} className="p-1 bg-green-600 text-white rounded shadow-sm"><Save size={16} /></button>
                            : <button onClick={() => { handleStartEdit(item, type); handleResetStatus(item.id, type); }} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Editar"><Edit size={16} /></button>}
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
              <span className="text-gray-500">Porcentagem Motorista ({selectedMotorista?.comissao || 0}%):</span>
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
          <button onClick={handleFinalizarViagem} disabled={temPendente || !temFreteAtivo}
            className="mt-8 w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 transition-all disabled:opacity-50 disabled:shadow-none active:scale-95 flex items-center justify-center">
            {temFreteAtivo ? <><Check size={20} className="mr-2" /> FINALIZAR VIAGEM</> : <span className="flex items-center"><Check size={20} className="mr-2" /> VIAGEM FINALIZADA</span>}
          </button>
        </div>
      </div>
    </>
  );
  };

  return (

    <div className="space-y-6 pb-20 px-6">
      {filterMot === 'todos' ? renderLista() : renderDetalheMotorista()}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-800"><Truck size={20} className="inline mr-2 text-blue-600" />{editingFrete ? 'Editar Viagem' : 'Nova Viagem'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"><X size={20} /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {!editingFrete && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Motorista</label>
                  <select className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500 bg-white" value={formData.motorista_id} onChange={e => setFormData({...formData, motorista_id: e.target.value})}>
                    <option value="">Selecione um motorista...</option>
                    {motoristas.map(m => (<option key={m.uid} value={m.uid}>{m.nome} - {m.placa}</option>))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Origem</label><input className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500" value={formData.origem} onChange={e => setFormData({...formData, origem: e.target.value})} placeholder="Cidade de origem" /></div>
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Destino</label><input className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500" value={formData.destino} onChange={e => setFormData({...formData, destino: e.target.value})} placeholder="Cidade de destino" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Valor do Frete</label><input type="number" step="0.01" className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500" value={formData.valor_frete} onChange={e => setFormData({...formData, valor_frete: e.target.value})} placeholder="0,00" /></div>
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Data</label><input type="date" className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500" value={formData.data} onChange={e => setFormData({...formData, data: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">KM Inicial</label><input type="number" className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500" value={formData.km_inicial} onChange={e => setFormData({...formData, km_inicial: e.target.value})} placeholder="0" /></div>
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">KM Final</label><input type="number" className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500" value={formData.km_final} onChange={e => setFormData({...formData, km_final: e.target.value})} placeholder="0" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Quem Recebeu</label>
                  <select className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500 bg-white" value={formData.quem_recebeu} onChange={e => setFormData({...formData, quem_recebeu: e.target.value})}>
                    <option value="proprietario">Proprietário</option><option value="motorista">Motorista</option>
                  </select>
                </div>
                {editingFrete && (
                  <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Status</label>
                    <select className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500 bg-white" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option value="ativo">Ativo</option><option value="pendente">Pendente</option><option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="p-5 bg-gray-50 border-t flex justify-end space-x-3">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl transition-all">Cancelar</button>
              <button onClick={handleSave} disabled={isSubmitting} className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition-all active:scale-95 flex items-center disabled:opacity-50">
                <Check size={18} className="mr-2" />{isSubmitting ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 uppercase text-xs tracking-widest">Lançar Novo Registro</h3>
              <button onClick={() => setShowAddModal(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-5 text-gray-700">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 block mb-1.5">Categoria</label>
                <select className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none bg-white font-semibold focus:border-blue-500 transition-colors" value={showAddModal} onChange={e => setShowAddModal(e.target.value as any)}>
                  <option value="despesa">Despesa (Almoço, Pedágio...)</option>
                  <option value="manutencao">Manutenção (Peças, Oficina...)</option>
                  <option value="abastecimento">Abastecimento</option>
                  <option value="vale">Vale / Adiantamento</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 block mb-1.5">Descrição / Posto</label>
                <input type="text" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors" placeholder={showAddModal === 'abastecimento' ? 'Nome do Posto' : 'Ex: Peças Motor'} onChange={e => setNewItemData({...newItemData, [showAddModal === 'abastecimento' ? 'posto' : 'descricao']: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 block mb-1.5">{showAddModal === 'abastecimento' ? 'Litros' : 'Valor (R$)'}</label>
                  <input type="number" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors" placeholder="0.00" onChange={e => setNewItemData({...newItemData, [showAddModal === 'abastecimento' ? 'litros' : 'valor']: e.target.value})} />
                </div>
                {showAddModal === 'abastecimento' && (
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 block mb-1.5">Valor Total</label>
                    <input type="number" className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none focus:border-blue-500 transition-colors" placeholder="0.00" onChange={e => setNewItemData({...newItemData, valorTotal: e.target.value})} />
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 block mb-1.5">Quem Pagou?</label>
                <select className="w-full border-2 border-gray-100 rounded-xl p-3 outline-none bg-white focus:border-blue-500 transition-colors" onChange={e => setNewItemData({...newItemData, quemPagou: e.target.value})}>
                  <option value="proprietario">Proprietário (Empresa)</option>
                  <option value="motorista">Motorista (Para Reembolso)</option>
                </select>
              </div>
            </div>
            <div className="p-5 bg-gray-50 flex justify-end space-x-3 border-t">
              <button onClick={() => setShowAddModal(null)} className="px-5 py-2.5 font-bold text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={handleAddItem} className="px-8 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95">Lançar Registro</button>
            </div>
          </div>
        </div>
      )}

      {showFinalizarModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                <Check size={28} className="text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800">Finalizar Viagem</h3>
              <p className="text-sm text-gray-500">Confira o resumo antes de finalizar:</p>
            </div>
            <div className="px-6 pb-4 space-y-3">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total de Fretes:</span>
                  <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Comissão ({selectedMotorista?.comissao || 0}%):</span>
                  <span className="font-bold text-blue-600">{formatCurrency(opComissao)}</span>
                </div>
                <div className="border-t border-gray-200 pt-2">
                  <p className="text-xs text-gray-400 font-medium mb-2">Deduções</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Desp./Abast.:</span>
                    <span className="font-bold text-orange-600">{formatCurrency(opDespMot + opAbastMot)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Vales:</span>
                    <span className="font-bold text-red-600">{formatCurrency(opValesOwner)}</span>
                  </div>
                </div>
                <div className="border-t border-gray-200 pt-3 flex justify-between text-base font-extrabold">
                  <span className="text-gray-700">Saldo Líquido:</span>
                  <span className={opSaldoLiquido >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(Math.abs(opSaldoLiquido))}</span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button onClick={() => setShowFinalizarModal(false)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl transition-all">Cancelar</button>
              <button onClick={confirmFinalizarViagem} className="px-6 py-2.5 bg-green-600 text-white font-bold rounded-xl shadow hover:bg-green-700 transition-all active:scale-95 flex items-center">
                <Check size={18} className="mr-2" />Confirmar Finalização
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center"><AlertTriangle size={32} className="text-red-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Cancelar Viagem</h3>
              <p className="text-gray-500">Tem certeza que deseja cancelar a viagem de <strong>{deleteTarget.origem} → {deleteTarget.destino}</strong>?</p>
              <p className="text-xs text-red-500 bg-red-50 p-3 rounded-xl w-full">⚠️ A viagem será marcada como cancelada no sistema.</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl transition-all">Voltar</button>
              <button onClick={handleDelete} disabled={isDeleting} className="px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow hover:bg-red-700 transition-all active:scale-95 flex items-center disabled:opacity-50">
                <Trash2 size={18} className="mr-2" />{isDeleting ? 'Cancelando...' : 'Sim, Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};