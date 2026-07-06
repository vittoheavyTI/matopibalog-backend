import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { formatCurrency } from '../utils';
import {
  DollarSign, AlertCircle, FileText, Check, X,
  Save, Edit, Unlock, Lock, ChevronLeft, Plus, Fuel, TrendingUp, Truck,
  Building2, Clock, AlertTriangle
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api, { newClientRequestId } from '../api';
import { EVENTO_NOTIFICACOES_NOVAS } from '../components/NotificacoesDropdown';
import { PlanoBloqueadoCard } from '../components/PlanoBloqueadoCard';
import { useAuth } from '../contexts/AuthContext';

const extrairMensagemPlano = (err: any): string | null => {
  if (err?.response?.status !== 403) return null;
  const message = err?.response?.data?.message || '';
  return /plano|trial|suspens|bloquead|expirad|regulariz/i.test(message)
    ? message || 'Sua empresa está suspensa ou bloqueada.'
    : null;
};

// [PR2B] Card de métrica reutilizável. Recebe as classes de cor como strings
// literais (nunca interpoladas) para não quebrar o purge do Tailwind.
const StatCard: React.FC<{
  label: string;
  value: string;
  icon: React.ElementType;
  boxBorder: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}> = ({ label, value, icon: Icon, boxBorder, iconBg, iconColor, valueColor }) => (
  <div className={`bg-white p-4 rounded-xl shadow-sm border ${boxBorder}`}>
    <div className="flex items-center space-x-3 mb-2">
      <div className={`w-9 h-9 ${iconBg} rounded-lg flex items-center justify-center`}>
        <Icon size={18} className={iconColor} />
      </div>
      <p className="text-sm text-gray-600 font-medium">{label}</p>
    </div>
    <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
  </div>
);

// Seletor de empresa pesquisável (combobox) — substitui o <select> nativo do filtro
// "Todas as empresas" no Dashboard do super-admin. Permite digitar para filtrar a lista.
// Sem dependência nova: input + lista filtrada + fecha ao selecionar / clicar fora.
const EmpresaCombobox: React.FC<{
  empresas: { id: string; nome: string }[];
  value: string;
  onChange: (v: string) => void;
}> = ({ empresas, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selecionada = empresas.find(e => e.id === value);
  const label = value === 'todas' ? '' : (selecionada?.nome || '');
  const filtradas = empresas.filter(e => e.nome.toLowerCase().includes(busca.toLowerCase()));

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selecionar = (v: string) => { onChange(v); setBusca(''); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={open ? busca : label}
        placeholder="Todas as empresas"
        onFocus={() => { setBusca(''); setOpen(true); }}
        onChange={e => { setBusca(e.target.value); setOpen(true); }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-green-600/30"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          <button type="button" onMouseDown={() => selecionar('todas')} className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${value === 'todas' ? 'text-green-700 font-semibold' : 'text-gray-700'}`}>
            Todas as empresas
          </button>
          {filtradas.map(e => (
            <button key={e.id} type="button" onMouseDown={() => selecionar(e.id)} className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${value === e.id ? 'text-green-700 font-semibold' : 'text-gray-700'}`}>
              {e.nome}
            </button>
          ))}
          {filtradas.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">Nenhuma empresa encontrada</p>}
        </div>
      )}
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin === true;
  const [motoristasEmViagem, setMotoristasEmViagem] = useState<any[]>([]);
  const [empresaFiltro, setEmpresaFiltro] = useState('todas');
  const [vinculoFiltro, setVinculoFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [fretes, setFretes] = useState<any[]>([]);
  const [despesas, setDespesas] = useState<any[]>([]);
  const [abastecimentos, setAbastecimentos] = useState<any[]>([]);
  const [vales, setVales] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  // Empresas da plataforma (só super-admin) — alimenta a seção Receita/Trial/Alertas
  // fundida da antiga página "Visão Geral". Reaproveita a mesma query /painel-admin/empresas.
  const [empresasPainel, setEmpresasPainel] = useState<any[]>([]);
  // Loadings por seção: a lista "Motoristas em Frete" (rápida) não pode ficar presa
  // esperando o /dashboard/summary (lento — várias queries sequenciais no backend).
  // Cada área tem seu próprio loading e atualiza assim que sua resposta chega.
  const [loadingEmViagem, setLoadingEmViagem] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Dashboard é visão automática do mês atual. O seletor de data foi removido da UI;
  // a consulta por período vive em Relatórios e Histórico de Fretes. Mantemos o valor
  // em estado (identidade estável) para não disparar o useEffect em loop.
  const [selectedMonth] = useState(new Date());
  const [selectedMot, setSelectedMot] = useState<any | null>(null);
  const [planoBloqueadoMsg, setPlanoBloqueadoMsg] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string, type: 'despesa' | 'manutencao' | 'abastecimento' | 'vale' | 'frete', data: any } | null>(null);

  // Criação de frete foi centralizada no Gerenciamento de Fretes (fonte de verdade).
  // O botão "Adicionar Frete" do Dashboard apenas navega para lá e abre o modal "Novo Frete".
  const [showAddDespesaModal, setShowAddDespesaModal] = useState(false);
  const [newDespesa, setNewDespesa] = useState({ tipo: 'despesa', descricao: '', valor: '', quem_pagou: 'proprietario', posto: '', litros: '', valor_total: '', data: '' });
  const [savingDespesa, setSavingDespesa] = useState(false);
  // Idempotência: id estável por sessão do modal de lançamento. Gerado ao abrir o
  // modal; reusado em retry do mesmo envio; limpo após sucesso. (Ver newClientRequestId.)
  const reqIdDespesaRef = useRef<string | null>(null);

  const loadDashboardData = async () => {
    setLoadingEmViagem(true);
    setLoadingSummary(true);

    // Motoristas + Em Viagem: a lista "em viagem" é enriquecida com a foto/empresa
    // vinda de /admin/motoristas (fonte de verdade), então essas duas chamadas rápidas
    // andam juntas — mas SEM esperar o /dashboard/summary (lento).
    const motoristasEmViagemPromise = Promise.all([
      api.get('/admin/motoristas').catch(() => ({ data: [] })),
      api.get('/admin/motoristas/em-viagem').catch(() => ({ data: [] }))
    ]).then(([resMot, resEmViagem]) => {
      const motoristasData = resMot.data || [];
      const emViagemData = resEmViagem.data || [];

      // Mapeamento usando dados completos de resMot como fonte de verdade para empresa_tipo
      const motoristaLookup = new Map<string, any>(motoristasData.map((m: any) => [m.id, m]));

      const mapMotorista = (m: any) => {
        const fullM = motoristaLookup.get(m.id) || m;
        const empresa = Array.isArray(fullM.empresas) ? fullM.empresas[0] : fullM.empresas;
        return {
          uid: fullM.id,
          nomeCompleto: fullM.usuarios?.nome || 'Motorista',
          fotoUrl: fullM.usuarios?.foto_url || '',
          placaVeiculo: fullM.placa_veiculo,
          percentualComissao: fullM.percentual_comissao,
          statusCadastro: fullM.status_cadastro,
          empresaId: fullM.usuarios?.empresa_id || fullM.empresa_id,
          empresaNome: empresa?.nome || 'Sem empresa',
          empresaTipo: fullM.empresa_tipo || empresa?.tipo
        };
      };

      setMotoristasEmViagem(emViagemData.map(mapMotorista));
    }).catch((err) => {
      console.error('Erro ao carregar motoristas/em-viagem', err);
    }).finally(() => {
      setLoadingEmViagem(false);
    });

    // Resumo financeiro (cards): independente — não bloqueia a lista acima.
    const summaryPromise = api.get(`/dashboard/summary?mes=${selectedMonth.getMonth() + 1}&ano=${selectedMonth.getFullYear()}`)
      .then((resSum) => {
        setSummary(resSum.data || null);
      })
      .catch((err) => {
        console.error('Erro ao carregar resumo do dashboard', err);
        setSummary(null);
      })
      .finally(() => {
        setLoadingSummary(false);
      });

    // Super-admin: empresas da plataforma para a seção Receita/Trial/Alertas.
    // Independente e tolerante — falha não bloqueia o resto do Dashboard.
    if (isSuperAdmin) {
      api.get('/painel-admin/empresas')
        .then(r => setEmpresasPainel(r.data || []))
        .catch(() => setEmpresasPainel([]));
    }

    await Promise.allSettled([motoristasEmViagemPromise, summaryPromise]);
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
        data: d.data,
        frete_id: d.frete_id,
        fotoUrl: d.foto_url,
        tipo: d.tipo === 'manutencao' ? 'manutencao' : 'despesa'  // preserva sub-tipo de manutenção
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
        frete_id: a.frete_id,
        fotoUrl: a.foto_url,
        tipo: 'abastecimento'   // tipo explícito — elimina heurística baseada em litros
      })));
      setVales(valesData.filter((v: any) => v.status !== 'finalizado').map((v: any) => ({
        id: v.id,
        motoristaUid: v.motorista_id,
        // Vale: descricao correto; posto é fallback p/ registros antigos
        descricao: v.descricao || v.posto || '',
        valor: v.valor,
        quemPagou: v.quem_pagou,
        status: v.status,
        data: v.data,
        frete_id: v.frete_id,
        tipo: 'vale'            // tipo explícito — evita falsa classificação como despesa
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

  // Refresh automático ao chegar notificação nova (evento global do sino):
  // refaz o fetch da visão atual, sem recarregar a página. Listener limpo no
  // unmount / a cada mudança de mês/motorista para não vazar closures antigas.
  useEffect(() => {
    const handler = () => {
      loadDashboardData();
      if (selectedMot) loadMotoristaData(selectedMot.uid);
    };
    window.addEventListener(EVENTO_NOTIFICACOES_NOVAS, handler);
    return () => window.removeEventListener(EVENTO_NOTIFICACOES_NOVAS, handler);
  }, [selectedMonth, selectedMot]);

  const handleAprovarDespesa = async (id: string, tipoItem: string, aprovado: boolean, obs?: string) => {
    const status = aprovado ? 'aprovado' : 'rejeitado';
    const payload: any = { status };
    if (obs !== undefined) payload.obs_resolucao = obs;
    try {
      if (tipoItem === 'despesa' || tipoItem === 'manutencao') {
        await api.patch('/despesas/' + id, payload);
      } else if (tipoItem === 'abastecimento') {
        await api.patch('/abastecimentos/' + id, payload);
      } else if (tipoItem === 'vale') {
        await api.patch('/vales/' + id, payload);
      }

      if (selectedMot) loadMotoristaData(selectedMot.uid);
      loadDashboardData();
    } catch (err) {
      console.error(err);
      alert('Erro ao atualizar status. Verifique se o servidor está rodando.');
    }
  };

  const handleResolverComObservacao = async (id: string, tipoItem: string, aprovado: boolean) => {
    const obs = window.prompt(
      aprovado ? 'Justificativa da aprovação (opcional):' : 'Motivo da rejeição (opcional):'
    );
    if (obs === null) return; // cancelou
    await handleAprovarDespesa(id, tipoItem, aprovado, obs || undefined);
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
        // Finaliza via rota dedicada — o backend é a trava final (409 se houver pendência),
        // igual ao Gerenciamento de Fretes. Antes era um PATCH cru de status, que contornava a trava.
        await api.post('/fretes/' + ativo.id + '/finalizar');
        // Marca como finalizado SOMENTE os aprovados DESTE frete (frete_id === ativo.id), após sucesso.
        // Lançamentos sem vínculo ou de outros fretes são preservados.
        const promises = [
          ...despesas.filter(d => d.status === 'aprovado' && d.frete_id === ativo.id).map(d => api.patch('/despesas/' + d.id, { status: 'finalizado' })),
          ...abastecimentos.filter(a => a.status === 'aprovado' && a.frete_id === ativo.id).map(a => api.patch('/abastecimentos/' + a.id, { status: 'finalizado' })),
          ...vales.filter(v => v.status === 'aprovado' && v.frete_id === ativo.id).map(v => api.patch('/vales/' + v.id, { status: 'finalizado' }))
        ];
        await Promise.allSettled(promises);
      }
      setSelectedMot(null);
      loadDashboardData();
      alert('Frete finalizado com sucesso! Os dados foram movidos para o resumo histórico.');
    } catch (err: any) {
      const planoMsg = extrairMensagemPlano(err);
      if (planoMsg) {
        setPlanoBloqueadoMsg(planoMsg);
        return;
      }
      const msg = err?.response?.status === 409
        ? (err.response.data?.message || 'Há lançamentos pendentes deste motorista.')
        : 'Erro ao finalizar frete no servidor.';
      alert(msg);
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

  const handleSubmitDespesa = async () => {
    if (!selectedMot) return;
    const tipo = newDespesa.tipo;
    if (tipo === 'despesa' && (!newDespesa.descricao || !newDespesa.valor)) { alert('Preencha descrição e valor.'); return; }
    if (tipo === 'abastecimento' && (!newDespesa.posto || !newDespesa.litros || !newDespesa.valor_total)) { alert('Preencha posto, litros e valor total.'); return; }
    if (tipo === 'vale' && !newDespesa.valor) { alert('Preencha o valor do vale.'); return; }
    // Resolve o frete ativo/pendente do motorista: 0 → bloqueia, 1 → usa direto,
    // 2+ → solicita seleção. Evita escolher o primeiro silenciosamente quando há
    // múltiplos fretes ativos (mesma regra do Gerenciamento de Fretes). O backend
    // também rejeita (409) quando não há frete ativo — esta validação é antecipada.
    const ativos = fretes.filter(f =>
      f.motoristaUid === selectedMot.uid &&
      (f.status === 'ativo' || f.status === 'pendente'));
    let freteId: string | undefined;
    if (ativos.length === 0) {
      alert('Este motorista não possui frete ativo. Inicie ou selecione um frete antes de lançar despesa, abastecimento ou vale.');
      return;
    } else if (ativos.length === 1) {
      freteId = ativos[0].id;
    } else {
      const escolha = window.prompt(
        `Há ${ativos.length} fretes ativos para este motorista. Digite o número do frete desejado:\n\n` +
        ativos.map((f: any, i: number) =>
          `${i + 1}: ${f.origem || '-'} → ${f.destino || '-'} (${f.status} - R$ ${f.valorFrete ?? '0'})`
        ).join('\n') +
        '\n\nCancelar para não lançar.'
      );
      if (escolha === null) return;
      const idx = parseInt(escolha) - 1;
      if (isNaN(idx) || idx < 0 || idx >= ativos.length) {
        alert('Opção inválida.');
        return;
      }
      freteId = ativos[idx].id;
    }
    // Idempotência: garante um id mesmo se o modal foi aberto por caminho atípico.
    // O mesmo id é reusado em retry do mesmo envio (limpo só após sucesso).
    if (!reqIdDespesaRef.current) reqIdDespesaRef.current = newClientRequestId();
    const vinc = { frete_id: freteId, client_request_id: reqIdDespesaRef.current };
    setSavingDespesa(true);
    try {
      if (tipo === 'abastecimento') {
        await api.post('/abastecimentos', { ...vinc, motorista_id: selectedMot.uid, posto: newDespesa.posto, litros: Number(newDespesa.litros), valor_total: Number(newDespesa.valor_total), quem_pagou: newDespesa.quem_pagou, data: newDespesa.data });
      } else if (tipo === 'vale') {
        await api.post('/vales', { ...vinc, motorista_id: selectedMot.uid, descricao: newDespesa.descricao || 'Vale/Adiantamento', valor: Number(newDespesa.valor), quem_pagou: 'proprietario', data: newDespesa.data });
      } else {
        await api.post('/despesas', { ...vinc, motorista_id: selectedMot.uid, tipo: 'geral', descricao: newDespesa.descricao, valor: Number(newDespesa.valor), quem_pagou: newDespesa.quem_pagou, data: newDespesa.data });
      }
      reqIdDespesaRef.current = null; // sucesso: próximo lançamento recebe id novo
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

  // Cancelados continuam visíveis nas listagens (mFretes), mas ficam FORA de TODAS as agregações
  // financeiras (Faturamento/Comissão/Saldo/Resultado) e operacionais (KM total, média de consumo).
  const fretesParaCalculo = mFretes.filter(f => f.status !== 'cancelado');
  const opTotalFretes = fretesParaCalculo.reduce((acc, f) => acc + parseFloat(f.valorFrete), 0);
  const opComissao = opTotalFretes * ((selectedMot?.percentualComissao || 0) / 100);
  const fretesCanceladosIds = new Set(mFretes.filter(f => f.status === 'cancelado').map(f => f.id));
  const isLancamentoDeFreteCancelado = (item: any) =>
    item.frete_id !== null && item.frete_id !== undefined && fretesCanceladosIds.has(item.frete_id);
  const despesasParaCalculo = mDespesas.filter(d => !isLancamentoDeFreteCancelado(d));
  const abastecimentosParaCalculo = mAbast.filter(a => !isLancamentoDeFreteCancelado(a));
  const valesParaCalculo = mVales.filter(v => !isLancamentoDeFreteCancelado(v));

  const opDespMot = despesasParaCalculo.filter(d => d.status === 'aprovado' && d.quemPagou === 'motorista').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastMot = abastecimentosParaCalculo.filter(a => a.status === 'aprovado' && a.quemPagou === 'motorista').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);

  const opDespOwner = despesasParaCalculo.filter(d => d.status === 'aprovado' && d.quemPagou === 'proprietario').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastOwner = abastecimentosParaCalculo.filter(a => a.status === 'aprovado' && a.quemPagou === 'proprietario').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);
  const opValesOwner = valesParaCalculo.filter(v => v.status === 'aprovado' && v.quemPagou === 'proprietario').reduce((acc, v) => acc + parseFloat(v.valor), 0);

  const opSaldoLiquido = opComissao + opDespMot + opAbastMot - opValesOwner;
  const opLucroEmpresa = opTotalFretes - opComissao - opDespOwner - opAbastOwner;

  const temPendente = mDespesas.some(d => d.status === 'pendente') || mAbast.some(a => a.status === 'pendente') || mVales.some(v => v.status === 'pendente');

  const totalLiters = abastecimentosParaCalculo.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.litros) || 0), 0);
  const totalKM = fretesParaCalculo.reduce((acc, f) => {
    if (f.kmFinal && f.kmInicial && f.kmFinal > f.kmInicial) {
      return acc + (f.kmFinal - f.kmInicial);
    }
    return acc;
  }, 0);
  const mediaConsumo = totalLiters > 0 && totalKM > 0 ? (totalKM / totalLiters).toFixed(2) : '0.00';
  // Avisos de média (apenas visuais — NÃO alteram totalKM/totalLiters/mediaConsumo nem cálculos financeiros).
  const mediaForaEsperado = totalKM > 0 && totalLiters > 0 && (totalKM / totalLiters) > 8;
  const temAbastPendente = mAbast.some(a => a.status === 'pendente');

  const isAutonomo = selectedMot?.empresaTipo === 'autonomo';
  const autGastos =
    despesasParaCalculo.filter(d => d.status === 'aprovado').reduce((acc, d) => acc + (parseFloat(d.valor) || 0), 0) +
    abastecimentosParaCalculo.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.valorTotal) || 0), 0) +
    valesParaCalculo.filter(v => v.status === 'aprovado').reduce((acc, v) => acc + (parseFloat(v.valor) || 0), 0);
  const autResultado = opTotalFretes - autGastos;

  // Lógica de Paginação do Resumo
  const totalItems = summary?.fretes_por_motorista?.length || 0;
  const totalPages = Math.ceil(totalItems / summaryPageSize);
  const paginatedSummary = summary?.fretes_por_motorista?.slice(
    (summaryPage - 1) * summaryPageSize,
    summaryPage * summaryPageSize
  ) || [];

  // [PR2B] Cenário dos cards. Sem scope (backend antigo) → comporta como antes (vinculado).
  const scope = summary?.scope;
  const temVinculados = scope?.tem_vinculados ?? true;
  const temAutonomos = scope?.tem_autonomos ?? false;
  const soAutonomo = temAutonomos && !temVinculados;
  const misto = temVinculados && temAutonomos;
  // soVinculado é o padrão: cobre vinculado-only e o caso sem motoristas (4 cards zerados, como hoje).
  const soVinculado = !soAutonomo && !misto;
  const empresasEmFrete = Array.from(
    new Map(motoristasEmViagem.map(m => [m.empresaId, { id: m.empresaId, nome: m.empresaNome }])).values()
  ).filter(e => e.id).sort((a, b) => a.nome.localeCompare(b.nome));
  const motoristasEmViagemFiltrados = isSuperAdmin
    ? motoristasEmViagem.filter(m => {
        const porEmpresa = empresaFiltro === 'todas' || m.empresaId === empresaFiltro;
        const porVinculo = vinculoFiltro === 'todos'
          || (vinculoFiltro === 'autonomos' ? m.empresaTipo === 'autonomo' : m.empresaTipo !== 'autonomo');
        const porStatus = statusFiltro === 'todos'
          || (statusFiltro === 'bloqueado' ? m.statusCadastro === 'bloqueado' : m.statusCadastro !== 'bloqueado');
        return porEmpresa && porVinculo && porStatus;
      })
    : motoristasEmViagem;

  // Derivados da fusão da "Visão Geral" (só super-admin): receita mensal por empresa
  // ativa com plano pago, empresas em trial, ativas e inadimplentes/bloqueadas.
  const empresasTrial = empresasPainel.filter((e: any) => e.status === 'trial');
  const empresasAtivas = empresasPainel.filter((e: any) => e.status === 'ativo');
  const empresasInadimplentes = empresasPainel.filter((e: any) => ['suspenso', 'bloqueado', 'expirado'].includes(e.status));
  // Escalável: ordena por receita desc e mostra só o Top 8 no gráfico (labels legíveis).
  // "Ver todas" leva a Assinaturas quando houver mais que 8.
  const empresasPagantes = empresasPainel
    .filter((e: any) => e.status === 'ativo' && parseFloat(e.planos?.preco_mensal || 0) > 0)
    .sort((a: any, b: any) => parseFloat(b.planos?.preco_mensal || 0) - parseFloat(a.planos?.preco_mensal || 0));
  const receitaChart = empresasPagantes.slice(0, 8).map((e: any) => ({
    nome: e.nome && e.nome.length > 10 ? e.nome.substring(0, 10) + '…' : (e.nome || '?'),
    receita: parseFloat(e.planos?.preco_mensal || 0),
  }));

  if (planoBloqueadoMsg) {
    return <div className="pt-10"><PlanoBloqueadoCard message={planoBloqueadoMsg} onRegularizar={() => navigate('/minhas-faturas')} /></div>;
  }

  return (
    <div className="space-y-5 pb-10">
      {!selectedMot && (
        <div className="flex justify-between items-center gap-3 animate-fade-in">
          <h2 className="text-2xl font-bold text-gray-800">{isSuperAdmin ? 'Visão Geral da Plataforma' : 'Dashboard'}</h2>
          <p className="text-xs text-gray-500 text-right">Visão do mês atual • Para outros períodos, use Relatórios ou Histórico</p>
        </div>
      )}

      {!selectedMot && !summary && loadingSummary && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 text-center text-gray-500 italic animate-fade-in">
          Carregando resumo financeiro...
        </div>
      )}

      {!selectedMot && summary && (
        <div className="space-y-5 animate-fade-in">
          {/* [PR2B] Vinculado-only: visual atual preservado (campos antigos). */}
          {soVinculado && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard label="Total de Fretes" value={formatCurrency(summary.total_fretes)} icon={DollarSign} boxBorder="border-blue-100" iconBg="bg-blue-100" iconColor="text-blue-600" valueColor="text-blue-600" />
              <StatCard label="Comissão" value={formatCurrency(summary.total_comissoes)} icon={TrendingUp} boxBorder="border-green-100" iconBg="bg-green-100" iconColor="text-green-600" valueColor="text-green-600" />
              <StatCard label="Despesas" value={formatCurrency(summary.total_deducoes)} icon={Fuel} boxBorder="border-orange-100" iconBg="bg-orange-100" iconColor="text-orange-600" valueColor="text-orange-600" />
              <StatCard label="Saldo a Receber" value={formatCurrency(Math.abs(summary.saldo_a_pagar))} icon={Truck} boxBorder="border-purple-100" iconBg="bg-purple-100" iconColor="text-purple-600" valueColor="text-purple-600" />
            </div>
          )}

          {/* [PR2B] Autônomo-only: Faturamento / Gastos / Resultado (sem comissão, sem saldo a pagar). */}
          {soAutonomo && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="Faturamento" value={formatCurrency(summary.faturamento_autonomos)} icon={DollarSign} boxBorder="border-blue-100" iconBg="bg-blue-100" iconColor="text-blue-600" valueColor="text-blue-600" />
              <StatCard label="Gastos" value={formatCurrency(summary.gastos_autonomos)} icon={Fuel} boxBorder="border-orange-100" iconBg="bg-orange-100" iconColor="text-orange-600" valueColor="text-orange-600" />
              <StatCard label="Resultado" value={formatCurrency(summary.resultado_autonomos)} icon={TrendingUp} boxBorder="border-green-100" iconBg="bg-green-100" iconColor="text-green-600" valueColor={summary.resultado_autonomos >= 0 ? 'text-green-600' : 'text-red-600'} />
            </div>
          )}

          {/* [PR2B] Global/misto: duas faixas separadas, sem somar conceitos. */}
          {misto && (
            <>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Motoristas Vinculados</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard label="Comissão" value={formatCurrency(summary.total_comissoes_vinculados)} icon={TrendingUp} boxBorder="border-green-100" iconBg="bg-green-100" iconColor="text-green-600" valueColor="text-green-600" />
                  <StatCard label="Despesas" value={formatCurrency(summary.deducoes_vinculados)} icon={Fuel} boxBorder="border-orange-100" iconBg="bg-orange-100" iconColor="text-orange-600" valueColor="text-orange-600" />
                  <StatCard label="Saldo" value={formatCurrency(summary.saldo_a_pagar_vinculados)} icon={Truck} boxBorder="border-purple-100" iconBg="bg-purple-100" iconColor="text-purple-600" valueColor={summary.saldo_a_pagar_vinculados >= 0 ? 'text-purple-600' : 'text-red-600'} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Motoristas Autônomos</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard label="Faturamento" value={formatCurrency(summary.faturamento_autonomos)} icon={DollarSign} boxBorder="border-blue-100" iconBg="bg-blue-100" iconColor="text-blue-600" valueColor="text-blue-600" />
                  <StatCard label="Gastos" value={formatCurrency(summary.gastos_autonomos)} icon={Fuel} boxBorder="border-orange-100" iconBg="bg-orange-100" iconColor="text-orange-600" valueColor="text-orange-600" />
                  <StatCard label="Resultado" value={formatCurrency(summary.resultado_autonomos)} icon={TrendingUp} boxBorder="border-green-100" iconBg="bg-green-100" iconColor="text-green-600" valueColor={summary.resultado_autonomos >= 0 ? 'text-green-600' : 'text-red-600'} />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Seção b/c da fusão da "Visão Geral": Receita por Empresa + Trial + Alertas (só super-admin). */}
      {!selectedMot && isSuperAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in">
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 text-sm flex items-center"><TrendingUp size={16} className="mr-1.5 text-green-600" /> Receita por Empresa</h3>
                <p className="text-xs text-gray-400">Top 8 por valor mensal · {empresasPagantes.length} pagante(s) · {empresasAtivas.length} ativa(s)</p>
              </div>
              {empresasPagantes.length > 8 && (
                <button onClick={() => navigate('/painel-administrativo/financeiro?aba=visao-geral')} className="text-xs font-semibold text-green-700 hover:underline flex-shrink-0">Ver todas →</button>
              )}
            </div>
            {receitaChart.length === 0 ? (
              <div className="h-44 flex items-center justify-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <p className="text-sm text-gray-400">Nenhuma empresa ativa com plano pago</p>
              </div>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={receitaChart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-20} textAnchor="end" height={44} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v: number) => `R$${v}`} width={56} />
                    <Tooltip formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, 'Receita mensal']} labelStyle={{ fontWeight: 700 }} />
                    <Bar dataKey="receita" fill="#15803d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <button onClick={() => navigate('/painel-administrativo/financeiro?aba=assinaturas')} className="block w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-amber-200 hover:shadow transition-all">
              <h3 className="font-bold text-gray-800 text-sm mb-2 flex items-center justify-between">
                <span className="flex items-center"><Clock size={15} className="mr-1.5 text-amber-500" /> Empresas em Trial</span>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">{empresasTrial.length}</span>
              </h3>
              {empresasTrial.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">Nenhuma empresa em trial.</p>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-auto">
                  {empresasTrial.slice(0, 5).map((e: any, i: number) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-amber-50 rounded-lg">
                      <span className="text-sm font-medium text-gray-700 truncate">{e.nome}</span>
                      <span className="text-[10px] font-bold text-amber-600 flex-shrink-0 ml-2">Trial</span>
                    </div>
                  ))}
                  {empresasTrial.length > 5 && <p className="text-xs text-amber-700 font-semibold px-1 pt-1">+{empresasTrial.length - 5} — ver em Assinaturas</p>}
                </div>
              )}
            </button>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h3 className="font-bold text-gray-800 text-sm mb-2 flex items-center"><AlertTriangle size={15} className="mr-1.5 text-red-500" /> Alertas</h3>
              <div className="space-y-1.5">
                <button onClick={() => navigate('/painel-administrativo/empresas')} className="flex items-center gap-2 w-full px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm text-gray-700 transition-colors">
                  <Building2 size={15} className="text-blue-500 flex-shrink-0" /> <span className="flex-1 text-left">{empresasAtivas.length} empresa(s) ativa(s)</span>
                </button>
                <button onClick={() => navigate('/painel-administrativo/financeiro?aba=assinaturas')} className="flex items-center gap-2 w-full px-3 py-2 bg-yellow-50 hover:bg-yellow-100 rounded-lg text-sm text-gray-700 transition-colors">
                  <Clock size={15} className="text-yellow-500 flex-shrink-0" /> <span className="flex-1 text-left">{empresasTrial.length} em período de teste</span>
                </button>
                <button onClick={() => navigate('/painel-administrativo/financeiro?aba=alertas')} className="flex items-center gap-2 w-full px-3 py-2 bg-red-50 hover:bg-red-100 rounded-lg text-sm text-gray-700 transition-colors">
                  <AlertTriangle size={15} className="text-red-500 flex-shrink-0" /> <span className="flex-1 text-left">{empresasInadimplentes.length} suspensa(s)/bloqueada(s)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {!selectedMot && (
          <div className="flex justify-between items-center px-2 animate-fade-in">
            <button
              onClick={() => { if (!isSuperAdmin) window.open('/relatorios/viagens', '_blank', 'noopener,noreferrer'); }}
              className={`text-xl font-bold text-gray-700 flex items-center ${isSuperAdmin ? 'cursor-default' : 'hover:text-blue-600 transition-colors cursor-pointer'}`}
              title={isSuperAdmin ? 'Visão global de fretes ativos' : 'Ir para Gerenciamento de Fretes'}
            >
              <DollarSign size={20} className="mr-2 text-green-600" /> Motoristas em Frete
            </button>
            {!isSuperAdmin && <button
              onClick={() => navigate('/relatorios/viagens?novoFrete=1')}
              className="flex items-center px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-all shadow-md active:scale-95 font-bold text-sm"
            >
              <Plus size={18} className="mr-1" /> Adicionar Frete
            </button>}
          </div>
        )}

        {!selectedMot && isSuperAdmin && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <EmpresaCombobox empresas={empresasEmFrete} value={empresaFiltro} onChange={setEmpresaFiltro} />
            <select value={vinculoFiltro} onChange={e => setVinculoFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
              <option value="todos">Autônomos e vinculados</option>
              <option value="autonomos">Somente autônomos</option>
              <option value="vinculados">Somente vinculados</option>
            </select>
            <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
              <option value="todos">Todos os status</option>
              <option value="em_viagem">Em viagem</option>
              <option value="bloqueado">Bloqueados</option>
            </select>
          </div>
        )}

        {selectedMot ? (
          <div className="animate-fade-in space-y-5">
            <button onClick={() => setSelectedMot(null)} className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors">
              <ChevronLeft size={20} className="mr-1" /> Voltar para Lista
            </button>
            <div className="bg-blue-600 p-4 rounded-xl shadow-lg flex flex-wrap justify-between items-center gap-4 text-white">
              <div className="flex items-center space-x-4">
                <div className="bg-white w-12 h-12 rounded-lg flex items-center justify-center text-blue-600 font-bold text-xl">{selectedMot.nomeCompleto?.charAt(0) || '?'}</div>
                <div>
                  <h2 className="text-2xl font-bold">{selectedMot.nomeCompleto}</h2>
                  <p className="text-blue-100 text-sm">
                    Placa: {selectedMot.placaVeiculo}
                    {isAutonomo ? ' | Motorista Autônomo' : ` | Comissão: ${selectedMot.percentualComissao}%`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="bg-white/20 px-4 py-2 rounded-lg flex items-center border border-white/10">
                  <Fuel size={18} className="mr-2" />
                  <div className="text-left">
                    <p className="text-[10px] uppercase font-bold text-blue-100">Média Consumo</p>
                    <p className="font-bold">
                      {totalKM > 0 && totalLiters > 0
                        ? `${mediaConsumo} KM/L`
                        : totalKM > 0 ? 'Sem abastecimento aprovado' : 'Pendente de KM'}
                    </p>
                    {mediaForaEsperado && <p className="text-[10px] text-yellow-200 font-semibold mt-0.5">Média fora do esperado — conferir KM/abastecimentos</p>}
                    {totalKM > 0 && totalLiters > 0 && temAbastPendente && <p className="text-[10px] text-orange-200 font-semibold mt-0.5">Média parcial — há abastecimentos pendentes</p>}
                  </div>
                </div>
                <button onClick={() => handleToggleBlock(selectedMot)} className="p-2 rounded-lg transition-colors bg-white/20 hover:bg-white/30 border border-white/10">
                  {selectedMot.statusCadastro === 'bloqueado' ? <Unlock size={20} /> : <Lock size={20} />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-5">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="bg-gray-50 p-4 border-b border-gray-100 font-bold text-gray-700 flex items-center justify-between">
                    <span className="flex items-center"><FileText className="mr-2" size={18} /> Lançamentos</span>
                    <button
                      onClick={() => { reqIdDespesaRef.current = newClientRequestId(); setShowAddDespesaModal(true); setNewDespesa({ tipo: 'despesa', descricao: '', valor: '', quem_pagou: 'proprietario', posto: '', litros: '', valor_total: '', data: new Date().toISOString().split('T')[0] }); }}
                      className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm"
                    >
                      <Plus size={14} className="mr-1" /> Nova Despesa
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    {mFretes.length === 0 && mDespesas.length === 0 && mAbast.length === 0 && mVales.length === 0 && <p className="text-gray-600 text-center py-8">Nenhum lançamento.</p>}

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
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-600 mt-1">
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
                      // tipo vem do mapeamento explícito — não usar heurística de litros/quemPagou
                      const type: string = item.tipo || 'despesa';
                      return (
                        <div key={item.id} className={`group flex justify-between items-center p-3 border rounded-lg transition-all ${item.status === 'aprovado' ? 'bg-green-50/50 border-green-100' : item.status === 'rejeitado' ? 'bg-red-50/50 border-red-100' : 'border-gray-100'}`}>
                          <div className="flex-1">
                            <p className="font-medium text-gray-800">
                              {type === 'manutencao' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded mr-2 font-bold">MANUTENÇÃO</span>}
                              {item.descricao || item.posto || 'Vale/Adiantamento'} {item.litros && <span className="text-xs text-blue-600">({item.litros}L)</span>}
                            </p>
                            <p className="text-xs text-gray-600">Pago por: {item.quemPagou} • {format(new Date(item.data), 'dd/MM HH:mm')}</p>
                            {type !== 'vale' && item.fotoUrl && (
                              <p className="text-xs mt-0.5">
                                <a href={item.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Ver comprovante</a>
                              </p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`font-bold ${type === 'vale' ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(Math.abs(item.valor || item.valorTotal))}</span>
                            {item.status === 'pendente' ? (
                              <div className="flex space-x-1">
                                <button onClick={() => handleResolverComObservacao(item.id, type as any, true)} className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors" title="Aprovar com justificativa"><Check size={18} /></button>
                                <button onClick={() => handleResolverComObservacao(item.id, type as any, false)} className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors" title="Rejeitar com motivo"><X size={18} /></button>
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
                                  <button onClick={() => handleStartEdit(item, type)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Editar"><Edit size={16} /></button>
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

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 h-fit sticky top-6">
                <h4 className="flex items-center text-gray-800 mb-6 font-bold text-lg"><DollarSign className="mr-2 text-green-600" /> Balanço Atual</h4>
                <div className="space-y-4">
                  {isAutonomo ? (
                    <>
                      <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                        <span className="text-gray-600">Faturamento:</span>
                        <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                        <span className="text-gray-600">Gastos:</span>
                        <span className="font-bold text-red-600">-{formatCurrency(autGastos)}</span>
                      </div>
                      <div className="flex justify-between items-center text-base font-extrabold bg-gray-50 p-3 rounded-lg">
                        <span className="text-gray-700">RESULTADO:</span>
                        <span className={autResultado >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(Math.abs(autResultado))}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                        <span className="text-gray-600">Valor Total do Frete:</span>
                        <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                        <span className="text-gray-600">Porcentagem Motorista ({selectedMot?.percentualComissao || 0}%):</span>
                        <span className="font-bold text-blue-600">+{formatCurrency(opComissao)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                        <span className="text-gray-600">Desp./Abast. (Motorista):</span>
                        <span className="font-bold text-green-600">+{formatCurrency(opDespMot + opAbastMot)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                        <span className="text-gray-600">Vales / Adiantamentos:</span>
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
                    </>
                  )}
                </div>
                <button onClick={handleFinalizarViagem} disabled={temPendente} className="mt-8 w-full py-4 bg-green-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 transition-all disabled:opacity-50 disabled:shadow-none active:scale-95 flex items-center justify-center">
                  <Check size={20} className="mr-2" /> FINALIZAR FRETE
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8 animate-fade-in">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs uppercase font-bold tracking-wider">
                  <th className="px-4 py-2.5 border-b">Motorista (Em Curso/Pendente)</th>
                  {isSuperAdmin && <th className="px-4 py-2.5 border-b">Empresa</th>}
                  <th className="px-4 py-2.5 border-b">Placa</th>
                  <th className="px-4 py-2.5 border-b">Status</th>
                  <th className="px-4 py-2.5 border-b text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loadingEmViagem ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 5 : 4} className="py-8 text-center text-gray-600 italic">
                      Carregando motoristas em frete...
                    </td>
                  </tr>
                ) : motoristasEmViagemFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 5 : 4} className="py-8 text-center text-gray-600 italic">
                      Nenhum motorista corresponde aos filtros atuais.
                    </td>
                  </tr>
                ) : (
                  motoristasEmViagemFiltrados.map(mot => (
                    <tr key={mot.uid} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center">
                          <div className="bg-blue-50 text-blue-600 w-8 h-8 rounded-lg flex items-center justify-center mr-3 font-bold text-xs overflow-hidden">
                            {mot.fotoUrl
                              ? <img src={mot.fotoUrl} alt="" className="w-full h-full object-cover" />
                              : (mot.nomeCompleto?.charAt(0) || '?')}
                          </div>
                          <span className="font-semibold text-gray-700">{mot.nomeCompleto}</span>
                        </div>
                      </td>
                      {isSuperAdmin && <td className="px-4 py-2.5 text-sm text-gray-600">{mot.empresaNome}</td>}
                      <td className="px-4 py-2.5 text-gray-600 font-medium">{mot.placaVeiculo}</td>
                      <td className="px-4 py-2.5">
                        <span className={`flex items-center text-xs font-bold px-2 py-1 rounded-full w-fit ${mot.statusCadastro === 'bloqueado' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                          {mot.statusCadastro === 'bloqueado' ? <Lock size={14} className="mr-1" /> : <AlertCircle size={14} className="mr-1" />}
                          {mot.statusCadastro === 'bloqueado' ? 'BLOQUEADO' : 'EM VIAGEM'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => navigate(isSuperAdmin ? '/painel-administrativo/motoristas' : '/relatorios/viagens?motorista=' + mot.uid)}
                          className="px-4 py-2 bg-green-700 text-white rounded-lg font-bold text-sm hover:bg-green-800 shadow-sm transition-all active:scale-95"
                        >
                          {isSuperAdmin ? 'Ver no Painel Admin' : 'Gerenciar Frete'}
                        </button>
                      </td>
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!selectedMot && isSuperAdmin && (
        <button onClick={() => navigate('/relatorios/resumo')} className="w-full bg-white border border-blue-100 rounded-xl p-4 text-left text-blue-700 font-bold hover:bg-blue-50 transition-colors">
          Abrir Histórico de Fretes
        </button>
      )}

      {!selectedMot && !isSuperAdmin && summary?.fretes_por_motorista && (
        <div className="space-y-5 mt-6 animate-fade-in">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
              <button
                onClick={() => window.open('/relatorios/resumo', '_blank', 'noopener,noreferrer')}
                className="text-lg font-bold text-gray-800 flex items-center hover:text-blue-600 transition-colors cursor-pointer"
                title="Ir para Histórico de Fretes"
              >
                <Truck size={22} className="mr-2 text-blue-600" /> Histórico de Fretes
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
                  <tr className="bg-gray-50/50 text-gray-600 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
                    <th className="p-4">Motorista</th>
                    <th className="p-4">Última Rota</th>
                    <th className="p-4 text-center">KM Total</th>
                    <th className="p-4 text-center">Média</th>
                    {/* [PR2B] autônomo-only usa linguagem própria e sem coluna Comissão */}
                    <th className="p-4 text-right">{soAutonomo ? 'Faturamento' : 'Total Fretes'}</th>
                    {!soAutonomo && <th className="p-4 text-right">Comissão</th>}
                    <th className="p-4 text-right">{soAutonomo ? 'Gastos' : 'Despesas'}</th>
                    <th className="p-4 text-right">{soAutonomo ? 'Resultado' : 'Saldo Líquido'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginatedSummary.map((m: any, idx: number) => {
                    // [PR2B] Autônomo: Comissão "—", Despesas=Gastos, Saldo=Resultado.
                    // Vinculado: usa campos segmentados (idênticos aos antigos p/ vinculado).
                    const auto = m.is_autonomo;
                    const despVal = auto ? (m.gastos_autonomo ?? 0) : (m.deducoes_vinculado ?? m.deducoes);
                    const saldoVal = auto ? (m.resultado_autonomo ?? 0) : (m.saldo_vinculado ?? m.saldo);
                    return (
                      <tr key={idx} className="hover:bg-blue-50/30 transition-colors group">
                        <td className="p-4">
                          <div className="flex items-center">
                            <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-[10px] font-bold mr-2 border border-blue-200">
                              {m.nome?.charAt(0) || '?'}
                            </div>
                            <span className="text-sm font-bold text-gray-700">{m.nome}</span>
                            {auto && <span className="ml-2 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase">Autônomo</span>}
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-[11px] font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-md">{m.ultima_rota || '-'}</span>
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
                        {!soAutonomo && (
                          <td className="p-4 text-right">
                            {auto
                              ? <span className="text-xs font-bold text-gray-400">—</span>
                              : <span className="text-xs font-bold text-blue-600">{formatCurrency(m.comissao_vinculado ?? m.comissao)}</span>}
                          </td>
                        )}
                        <td className="p-4 text-right">
                          <span className="text-xs font-medium text-red-500">-{formatCurrency(despVal)}</span>
                        </td>
                        <td className="p-4 text-right">
                          <span className={`text-sm font-black ${auto ? (saldoVal >= 0 ? 'text-green-700' : 'text-red-600') : 'text-green-700'}`}>{formatCurrency(saldoVal)}</span>
                        </td>
                      </tr>
                    );
                  })}
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
              <button onClick={handleSubmitDespesa} disabled={savingDespesa} className="px-4 py-2 text-sm font-bold bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors disabled:opacity-50">
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
