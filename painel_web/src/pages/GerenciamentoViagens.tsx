import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, X, Search, Filter, Truck, MapPin, Calendar, DollarSign, Gauge, Trash2, Edit, Check, AlertTriangle, ChevronLeft, ChevronDown, ChevronRight, Fuel, FileText, TrendingUp, Save, Unlock, Lock } from 'lucide-react';
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
  // A URL (?motorista=<id>) é a fonte de verdade do motorista em foco; filterMot é sincronizado a partir dela.
  const [searchParams, setSearchParams] = useSearchParams();
  const motoristaQuery = searchParams.get('motorista');
  const [filterMot, setFilterMot] = useState(() => motoristaQuery || 'todos');

  // Troca de motorista (dropdown / clique na lista / "Voltar para Lista"): mantém URL e filterMot juntos.
  const selecionarMotorista = (value: string) => {
    setFilterMot(value);
    if (value === 'todos') setSearchParams({}, { replace: true });
    else setSearchParams({ motorista: value }, { replace: true });
  };

  const [showModal, setShowModal] = useState(false);
  const [editingFrete, setEditingFrete] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFinalizarModal, setShowFinalizarModal] = useState(false);
  // Accordion da visualização por frete (detalhe do motorista).
  const [fretesExpandidos, setFretesExpandidos] = useState<Set<string>>(new Set());
  const [semFreteExpandido, setSemFreteExpandido] = useState(false);

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
        status: m.usuarios?.status,
        empresaTipo: m.empresa_tipo
      })));
    } catch (err) {
      console.error('Erro ao carregar fretes:', err);
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
        id: d.id, motoristaUid: d.motorista_id, descricao: d.descricao, fotoUrl: d.foto_url,
        obsResolucao: d.obs_resolucao,
        valor: d.valor, quemPagou: d.quem_pagou, status: d.status, data: d.data, frete_id: d.frete_id,
        tipo: d.tipo === 'manutencao' ? 'manutencao' : 'despesa'  // preserva sub-tipo (consistente com Dashboard)
      })));
      setAbastecimentos(abastData.filter((a: any) => a.status !== 'finalizado').map((a: any) => ({
        id: a.id, motoristaUid: a.motorista_id, posto: a.posto, litros: a.litros, fotoUrl: a.foto_url,
        obsResolucao: a.obs_resolucao,
        valorTotal: a.valor_total, quemPagou: a.quem_pagou, status: a.status,
        data: a.data, frete_id: a.frete_id, tipo: 'abastecimento'
      })));
      setVales(valesData.filter((v: any) => v.status !== 'finalizado').map((v: any) => ({
        // Vale: descricao é o campo correto; posto é fallback p/ registros antigos.
        // fotoUrl mapeado só por consistência — Vale NÃO renderiza comprovante.
        id: v.id, motoristaUid: v.motorista_id, descricao: v.descricao || v.posto || '', fotoUrl: v.foto_url,
        obsResolucao: v.obs_resolucao,
        valor: v.valor, quemPagou: v.quem_pagou, status: v.status, data: v.data, frete_id: v.frete_id, tipo: 'vale'
      })));
    } catch (err) {
      console.error('Erro ao carregar dados do motorista', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Reage à navegação do Dashboard / sidebar: ?motorista=<id> muda → atualiza o filtro
  // mesmo sem o componente desmontar. Sem query → volta a "todos".
  useEffect(() => {
    setFilterMot(motoristaQuery || 'todos');
  }, [motoristaQuery]);

  // Carrega os dados conforme o modo. CAUSA-RAIZ: loadMotoristaData() sobrescreve os arrays
  // globais (fretes/despesas/abastecimentos/vales) com os de UM motorista; ao voltar para
  // "Todos" é preciso recarregar loadData() para a lista geral não ficar contaminada.
  // O mount já chama loadData(); o guard evita um segundo fetch redundante no 1º render.
  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (filterMot !== 'todos') {
      loadMotoristaData(filterMot);
    } else if (!isFirstFilterRun.current) {
      loadData();
    }
    isFirstFilterRun.current = false;
  }, [filterMot]);

  // Default do accordion: ao trocar de motorista / recarregar dados, fretes
  // ativos/pendentes abrem; demais (ex.: cancelado) e o grupo legado iniciam fechados.
  useEffect(() => {
    if (filterMot === 'todos') return;
    const abertosPorPadrao = fretes
      .filter(f => f.status === 'ativo' || f.status === 'pendente')
      .map(f => f.id as string);
    setFretesExpandidos(new Set(abertosPorPadrao));
    setSemFreteExpandido(false);
  }, [filterMot, fretes]);

  const toggleFreteExpandido = (freteId: string) => {
    setFretesExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(freteId)) next.delete(freteId);
      else next.add(freteId);
      return next;
    });
  };

  // Ordenação por data desc (mais recente → mais antigo). Data ausente/inválida → fim.
  const tsFrete = (f: any): number => {
    const t = new Date(f?.data ?? f?.criadoEm ?? 0).getTime();
    return Number.isNaN(t) ? 0 : t;
  };

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
    // Validação client-side dos obrigatórios (paridade com o modal do Dashboard). Bloqueia antes
    // de chamar o backend. Motorista só é exigido na CRIAÇÃO — na edição vem do frete e o campo é
    // oculto. KM, data, status e quem_recebeu seguem opcionais.
    if (!editingFrete && !formData.motorista_id) { alert('Selecione um motorista.'); return; }
    if (!formData.origem || !formData.origem.trim()) { alert('Informe a origem.'); return; }
    if (!formData.destino || !formData.destino.trim()) { alert('Informe o destino.'); return; }
    const valorFrete = parseFloat(formData.valor_frete);
    if (!formData.valor_frete || isNaN(valorFrete) || valorFrete <= 0) { alert('Informe um valor de frete válido.'); return; }
    try {
      setIsSubmitting(true);
      const payload = {
        origem: formData.origem,
        destino: formData.destino,
        valor_frete: parseFloat(formData.valor_frete),
        // PR-G2: KM é opcional — manda null quando vazio, 0 ou negativo (o backend trata null
        // como "não enviado"); evita coagir a 0 e reprovar na validação de número positivo.
        km_inicial: Number(formData.km_inicial) > 0 ? parseInt(formData.km_inicial) : null,
        km_final: Number(formData.km_final) > 0 ? parseInt(formData.km_final) : null,
        // Autônomo nunca recebe via 'proprietario': força 'motorista' (regra de produto). Na criação
        // este campo é omitido logo abaixo; logo, isto trava apenas o PATCH de edição.
        quem_recebeu: isAutonomoNoModal ? 'motorista' : formData.quem_recebeu,
        status: formData.status,
        data: formData.data
      };

      if (editingFrete) {
        await api.patch('/fretes/' + editingFrete.id, {...payload});
      } else {
        // Na CRIAÇÃO, não enviamos quem_recebeu nem status: o backend ignora status na criação
        // (insert não inclui o campo) e deriva quem_recebeu pelo tipo real da empresa
        // (autonomo → 'motorista'; demais → 'proprietario'). Enviar status aqui era inócuo.
        // O override manual de ambos segue valendo só na edição (PATCH acima).
        const { quem_recebeu: _quemRecebeuOmitido, status: _statusOmitido, ...payloadCriacao } = payload;
        await api.post('/fretes', { ...payloadCriacao, motorista_id: formData.motorista_id });
      }
      if (filterMot !== 'todos') {
        await loadMotoristaData(filterMot);
      } else {
        await loadData();
      }
      setShowModal(false);
    } catch (err: any) {
      // PR-G2: mostra o(s) campo(s) inválido(s) que o backend devolve em errors[], em vez de
      // só "Dados inválidos." — facilita diagnosticar qual campo reprovou.
      const data = err.response?.data;
      const detalhe = Array.isArray(data?.errors) && data.errors.length
        ? ' (' + data.errors.map((e: any) => `${e.campo}: ${e.mensagem}`).join('; ') + ')'
        : '';
      alert('Erro ao salvar frete: ' + (data?.message || err.message) + detalhe);
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
      alert('Erro ao excluir frete: ' + (err.response?.data?.message || err.message));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAprovarDespesa = async (id: string, tipoItem: string, aprovado: boolean, obs?: string) => {
    const status = aprovado ? 'aprovado' : 'rejeitado';
    const payload: any = { status };
    if (obs !== undefined) payload.obs_resolucao = obs;
    try {
      // Usar tipoItem diretamente (já vem correto do mapeamento via item.tipo)
      if (tipoItem === 'despesa' || tipoItem === 'manutencao') {
        await api.patch('/despesas/' + id, payload);
      } else if (tipoItem === 'abastecimento') {
        await api.patch('/abastecimentos/' + id, payload);
      } else if (tipoItem === 'vale') {
        await api.patch('/vales/' + id, payload);
      }
      if (filterMot !== 'todos') await loadMotoristaData(filterMot);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Tente novamente.';
      alert('Erro ao atualizar status: ' + msg);
    }
  };

  const handleResolverComObservacao = async (id: string, tipoItem: string, aprovado: boolean) => {
    const obs = window.prompt(
      aprovado ? 'Observação ao aprovar (opcional):' : 'Motivo da rejeição (opcional):'
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
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
    } catch (err) {
      alert('Erro ao resetar status.');
    }
  };

  const handleStartEdit = (item: any, type: any) => setEditingItem({ id: item.id, type, data: { ...item } });

  // Baixa o comprovante via fetch->blob. Em falha (CORS/erro), abre em nova aba
  // como fallback seguro — nunca quebra a tela.
  const baixarComprovante = async (url: string, id: string) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `comprovante-${id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.warn('Falha no download do comprovante, abrindo em nova aba:', e);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

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
        // Vale usa descricao (não posto/litros). posto fica só como fallback de leitura.
        await api.patch('/vales/' + id, { valor: parseFloat(data.valor), descricao: data.descricao });
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
      // Vincula o lançamento ao frete ativo do motorista (mesma regra do finalize)
      const freteAtivo = fretes.find(f =>
        (f.motoristaUid === filterMot || f.motorista_id === filterMot) &&
        (f.status === 'ativo' || f.status === 'pendente'));
      const freteId = freteAtivo?.id;
      // Regra da tela: sem frete ativo/pendente, não lança (e nunca POST sem frete_id aqui).
      // Backend permite frete_id=null por design (Dashboard/app/legado), então a trava é local.
      if (!freteId) {
        alert('Não há frete ativo para lançar.');
        return;
      }
      if (showAddModal === 'despesa' || showAddModal === 'manutencao') {
        await api.post('/despesas', { motorista_id: filterMot, frete_id: freteId, tipo: showAddModal === 'manutencao' ? 'manutencao' : 'geral', descricao: newItemData.descricao, valor: Number(newItemData.valor), quem_pagou: newItemData.quemPagou || 'proprietario' });
      } else if (showAddModal === 'abastecimento') {
        await api.post('/abastecimentos', { motorista_id: filterMot, frete_id: freteId, posto: newItemData.posto, litros: Number(newItemData.litros), valor_total: Number(newItemData.valorTotal), quem_pagou: newItemData.quemPagou || 'proprietario' });
      } else if (showAddModal === 'vale') {
        await api.post('/vales', { motorista_id: filterMot, frete_id: freteId, descricao: newItemData.descricao, valor: Number(newItemData.valor), quem_pagou: newItemData.quemPagou || 'proprietario' });
      }
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
      setShowAddModal(null);
      setNewItemData({});
    } catch (err: any) {
      alert(err?.response?.status === 409
        ? (err.response.data?.message || 'Não é possível lançar em uma viagem encerrada.')
        : 'Erro ao adicionar item.');
    }
  };

  // Localiza o frete ativo/pendente do motorista atualmente selecionado.
  // Mesma regra de vínculo usada nos lançamentos: motorista do filtro + status ativo/pendente.
  const getFreteAtivoSelecionado = () =>
    fretes.find(f =>
      (f.motoristaUid === filterMot || f.motorista_id === filterMot) &&
      (f.status === 'ativo' || f.status === 'pendente'));

  const handleFinalizarViagem = () => {
    if (!selectedMotorista) return;
    // Defesa em camada de handler: sem frete ativo/pendente, não abre o modal.
    if (!getFreteAtivoSelecionado()) {
      alert('Nenhum frete ativo encontrado para finalizar.');
      return;
    }
    setShowFinalizarModal(true);
  };

  const confirmFinalizarViagem = async () => {
    if (!selectedMotorista) return;
    // Defesa final: evita falso sucesso se o frete ativo sumiu entre abrir e confirmar.
    const ativo = getFreteAtivoSelecionado();
    if (!ativo) {
      setShowFinalizarModal(false);
      alert('Nenhum frete ativo encontrado para finalizar.');
      return;
    }
    try {
      // Finaliza via rota dedicada — o backend é a trava final (409 se houver pendência)
      await api.post('/fretes/' + ativo.id + '/finalizar');
      // Marca como finalizado SOMENTE os aprovados DESTA viagem (frete ativo), após sucesso
      const promises = [
        ...despesas.filter(d => d.status === 'aprovado' && d.frete_id === ativo.id).map(d => api.patch('/despesas/' + d.id, { status: 'finalizado' })),
        ...abastecimentos.filter(a => a.status === 'aprovado' && a.frete_id === ativo.id).map(a => api.patch('/abastecimentos/' + a.id, { status: 'finalizado' })),
        ...vales.filter(v => v.status === 'aprovado' && v.frete_id === ativo.id).map(v => api.patch('/vales/' + v.id, { status: 'finalizado' }))
      ];
      await Promise.all(promises);
      setShowFinalizarModal(false);
      setFilterMot('todos');
      loadData();
      alert('Frete finalizado! Os dados foram movidos para o resumo histórico.');
    } catch (err: any) {
      const msg = err?.response?.status === 409
        ? (err.response.data?.message || 'Há lançamentos pendentes deste motorista.')
        : 'Erro ao finalizar frete no servidor.';
      alert(msg);
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
  // Autônomo do frete aberto no modal: na EDIÇÃO usa o motorista do frete editado (não o filtro,
  // que pode estar em "Todos"); na criação, o motorista escolhido no formulário. Detecção pelo
  // tipo real da empresa (empresaTipo), nunca pelo nome.
  const motoristaIdNoModal = editingFrete?.motorista_id ?? formData.motorista_id;
  const isAutonomoNoModal = motoristas.find(m => m.uid === motoristaIdNoModal)?.empresaTipo === 'autonomo';

  const mFretes = fretes.filter(f => f.motoristaUid === filterMot || f.motorista_id === filterMot);
  // Cancelados continuam visíveis na lista/badge (mFretes), mas ficam FORA de TODAS as agregações
  // financeiras (Faturamento, Comissão, Saldo, Resultado) e operacionais (KM total, média de consumo).
  const fretesParaCalculo = mFretes.filter(f => f.status !== 'cancelado');
  const opTotalFretes = fretesParaCalculo.reduce((acc, f) => acc + parseFloat(f.valorFrete), 0);
  const opComissao = opTotalFretes * ((selectedMotorista?.comissao || 0) / 100);
  const mDesp = despesas;
  const mAbs = abastecimentos;
  const mVales = vales;
  const fretesCanceladosIds = new Set(mFretes.filter(f => f.status === 'cancelado').map(f => f.id));
  const isLancamentoDeFreteCancelado = (item: any) =>
    item.frete_id !== null && item.frete_id !== undefined && fretesCanceladosIds.has(item.frete_id);
  const despesasParaCalculo = mDesp.filter(d => !isLancamentoDeFreteCancelado(d));
  const abastecimentosParaCalculo = mAbs.filter(a => !isLancamentoDeFreteCancelado(a));
  const valesParaCalculo = mVales.filter(v => !isLancamentoDeFreteCancelado(v));
  const opDespMot = despesasParaCalculo.filter(d => d.status === 'aprovado' && d.quemPagou === 'motorista').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastMot = abastecimentosParaCalculo.filter(a => a.status === 'aprovado' && a.quemPagou === 'motorista').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);
  const opDespOwner = despesasParaCalculo.filter(d => d.status === 'aprovado' && d.quemPagou === 'proprietario').reduce((acc, d) => acc + parseFloat(d.valor), 0);
  const opAbastOwner = abastecimentosParaCalculo.filter(a => a.status === 'aprovado' && a.quemPagou === 'proprietario').reduce((acc, a) => acc + parseFloat(a.valorTotal), 0);
  const opValesOwner = valesParaCalculo.filter(v => v.status === 'aprovado' && v.quemPagou === 'proprietario').reduce((acc, v) => acc + parseFloat(v.valor), 0);
  const opSaldoLiquido = opComissao + opDespMot + opAbastMot - opValesOwner;
  const opLucroEmpresa = opTotalFretes - opComissao - opDespOwner - opAbastOwner;
  // Autônomo: modelo faturamento - gastos (sem comissão/saldo/resultado-empresa).
  // Gastos ignoram quem_pagou e somam despesas + abastecimentos + vales aprovados.
  const isAutonomo = selectedMotorista?.empresaTipo === 'autonomo';
  const autGastos =
    despesasParaCalculo.filter(d => d.status === 'aprovado').reduce((acc, d) => acc + (parseFloat(d.valor) || 0), 0) +
    abastecimentosParaCalculo.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.valorTotal) || 0), 0) +
    valesParaCalculo.filter(v => v.status === 'aprovado').reduce((acc, v) => acc + (parseFloat(v.valor) || 0), 0);
  const autResultado = opTotalFretes - autGastos;
  const temPendente = mDesp.some(d => d.status === 'pendente') || mAbs.some(a => a.status === 'pendente') || mVales.some(v => v.status === 'pendente');
  const temFreteAtivo = mFretes.some(f => f.status === 'ativo' || f.status === 'pendente');
  const totalLiters = abastecimentosParaCalculo.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.litros) || 0), 0);
  const totalKM = fretesParaCalculo.reduce((acc, f) => {
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
          <h2 className="text-2xl font-bold text-gray-800">Gerenciamento de Fretes</h2>
          <p className="text-gray-500 text-sm">Cadastro e acompanhamento de fretes</p>
        </div>
        <button onClick={() => openNewModal()} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95 font-bold">
          <Plus size={20} className="mr-2" /> Novo Frete
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
            <select value={filterMot} onChange={e => selecionarMotorista(e.target.value)} className="border rounded-lg p-2 outline-none bg-white text-gray-600">
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
          {loading ? (<p className="p-8 text-center text-gray-500">Carregando fretes...</p>)
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
                        onClick={() => selecionarMotorista(frete.motorista_id || frete.motoristaUid)}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-800 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                        title="Gerenciar fretes deste motorista"
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
                        <button onClick={() => setDeleteTarget(frete)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Cancelar frete"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-400"><Truck size={40} className="mx-auto mb-2 text-gray-300" />Nenhum frete encontrado.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );

  // Renderiza um item de lançamento (despesa/abastecimento/vale) com os mesmos
  // estilos e ações de antes. Extraído para reuso nos grupos por frete e no grupo legado.
  const renderLancamentoItem = (item: any) => {
    // Usar item.tipo diretamente (definido no mapeamento de loadMotoristaData)
    // Evita inferência por heurística que falhava quando litros=0 ou quemPagou='motorista'
    const type: string = item.tipo || 'despesa';
    return (
      <div key={item.id} className={`group flex justify-between items-center p-3 border rounded-lg transition-all ${item.status === 'aprovado' ? 'bg-green-50/50 border-green-100' : item.status === 'rejeitado' ? 'bg-red-50/50 border-red-100' : 'border-gray-100'}`}>
        <div className="flex-1">
          <p className="font-medium text-gray-800">
            {type === 'manutencao' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded mr-2 font-bold">MANUTENÇÃO</span>}
            {item.descricao || item.posto || 'Vale/Adiantamento'} {item.litros && <span className="text-xs text-blue-600">({item.litros}L)</span>}
          </p>
          <p className="text-xs text-gray-500">Pago por: {item.quemPagou} • {gvFmt(item.data, 'dd/MM HH:mm')}</p>
          {type !== 'vale' && (
            item.fotoUrl ? (
              <p className="text-xs mt-0.5 flex items-center gap-3">
                <a href={item.fotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Abrir comprovante</a>
                <button type="button" onClick={() => baixarComprovante(item.fotoUrl, item.id)} className="text-blue-600 hover:underline">Baixar</button>
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">Sem comprovante</p>
            )
          )}
          {item.obsResolucao && item.status !== 'pendente' && (
            <p className="text-xs mt-0.5 text-gray-600 italic">
              <span className="font-semibold not-italic">
                {item.status === 'rejeitado' ? 'Obs. rejeição: ' : 'Justificativa do admin: '}
              </span>
              {item.obsResolucao}
            </p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span className={`font-bold ${type === 'vale' ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(Math.abs(item.valor || item.valorTotal))}</span>
          {item.status === 'pendente' ? (
            <div className="flex space-x-1">
              <button onClick={() => handleResolverComObservacao(item.id, type, true)} className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors" title="Aprovar com observação"><Check size={18} /></button>
              <button onClick={() => handleResolverComObservacao(item.id, type, false)} className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors" title="Rejeitar com motivo"><X size={18} /></button>
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
  };

  // Ordena lançamentos por data desc (mais recente primeiro); data ausente/inválida → fim.
  const ordenarLancamentos = (itens: any[]) =>
    [...itens].sort((x, y) => {
      const tx = new Date(x?.data ?? 0).getTime();
      const ty = new Date(y?.data ?? 0).getTime();
      return (Number.isNaN(ty) ? 0 : ty) - (Number.isNaN(tx) ? 0 : tx);
    });

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
      <button onClick={() => selecionarMotorista('todos')} className="flex items-center text-blue-600 hover:text-blue-800 font-bold transition-colors">
        <ChevronLeft size={20} className="mr-1" /> Voltar para Lista
      </button>

      {selectedMotorista && (
        <div className="bg-blue-600 p-4 rounded-xl shadow-lg flex flex-wrap justify-between items-center gap-3 text-white">
          <div className="flex items-center space-x-3">
            <div className="bg-white w-10 h-10 rounded-lg flex items-center justify-center text-blue-600 font-bold text-lg">
              {selectedMotorista.nome?.charAt(0) || '?'}
            </div>
            <div>
              <h2 className="text-xl font-bold">{selectedMotorista.nome}</h2>
              <p className="text-blue-100 text-sm">
                Placa: {selectedMotorista.placa}
                {isAutonomo ? ' | Motorista Autônomo' : ` | Comissão: ${selectedMotorista.comissao}%`}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 px-3 py-1.5 rounded-lg flex items-center border border-white/10">
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

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-6 order-2 lg:order-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-100 font-bold text-gray-700 flex items-center justify-between">
              <span className="flex items-center"><FileText className="mr-2" size={18} /> Lançamentos</span>
              <div className="flex space-x-2">
                <button onClick={() => setShowAddModal('despesa')} disabled={!temFreteAtivo} title={!temFreteAtivo ? 'Não há frete ativo para lançar' : undefined} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={14} className="mr-1" /> Despesa
                </button>
                <button onClick={() => setShowAddModal('abastecimento')} disabled={!temFreteAtivo} title={!temFreteAtivo ? 'Não há frete ativo para lançar' : undefined} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={14} className="mr-1" /> Abast.
                </button>
                <button onClick={() => setShowAddModal('vale')} disabled={!temFreteAtivo} title={!temFreteAtivo ? 'Não há frete ativo para lançar' : undefined} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={14} className="mr-1" /> Vale
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {mFretes.length === 0 && mDesp.length === 0 && mAbs.length === 0 && mVales.length === 0 &&
                <p className="text-gray-500 text-center py-8">Nenhum lançamento.</p>}

              {/* Um card/accordion por frete, do mais recente para o mais antigo */}
              {[...mFretes].sort((a: any, b: any) => tsFrete(b) - tsFrete(a)).map((f: any) => {
                const despFrete = mDesp.filter((d: any) => d.frete_id === f.id);
                const abastFrete = mAbs.filter((a: any) => a.frete_id === f.id);
                const valesFrete = mVales.filter((v: any) => v.frete_id === f.id);
                const itensFrete = ordenarLancamentos([...despFrete, ...abastFrete, ...valesFrete]);
                const pendentesFrete = itensFrete.filter((i: any) => i.status === 'pendente').length;
                const deducoesAprov = itensFrete
                  .filter((i: any) => i.status === 'aprovado')
                  .reduce((acc: number, i: any) => acc + (parseFloat(i.valor ?? i.valorTotal) || 0), 0);
                const aberto = fretesExpandidos.has(f.id);
                const editandoFrete = editingItem?.id === f.id;
                const litrosFrete = abastFrete.filter((a: any) => a.status === 'aprovado').reduce((acc: number, a: any) => acc + (parseFloat(a.litros) || 0), 0);
                const distFrete = (f.kmFinal || 0) - (f.kmInicial || 0);

                return (
                  <div key={f.id} className="border border-blue-100 rounded-lg overflow-hidden">
                    <div className="group flex justify-between items-center gap-3 p-3 bg-blue-50/40">
                      {editandoFrete ? (
                        <div className="flex-1 grid grid-cols-3 gap-2 pr-2">
                          <input className="border rounded px-2 py-1 text-sm" placeholder="Origem" value={editingItem?.data.origem || ''}
                            onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, origem: e.target.value}} : prev)} />
                          <input className="border rounded px-2 py-1 text-sm" placeholder="Destino" value={editingItem?.data.destino || ''}
                            onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, destino: e.target.value}} : prev)} />
                          <div className="flex space-x-1">
                            <input type="number" className="border rounded px-2 py-1 text-sm w-1/2" placeholder="KM Ini" value={editingItem?.data.kmInicial || ''}
                              onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, kmInicial: Number(e.target.value)}} : prev)} />
                            <input type="number" className="border rounded px-2 py-1 text-sm w-1/2" placeholder="KM Fim" value={editingItem?.data.kmFinal || ''}
                              onChange={e => setEditingItem(prev => prev ? {...prev, data: {...prev.data, kmFinal: Number(e.target.value)}} : prev)} />
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => toggleFreteExpandido(f.id)} className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            {aberto ? <ChevronDown size={16} className="text-blue-600 flex-shrink-0" /> : <ChevronRight size={16} className="text-blue-600 flex-shrink-0" />}
                            <p className="font-bold text-gray-800">{f.origem} ➔ {f.destino}</p>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${getStatusBadge(f.status)}`}>{f.status}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500 mt-1 pl-6">
                            <span>{gvFmt(f.criadoEm || f.data, 'dd/MM/yyyy')}</span>
                            {f.placa && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{f.placa}</span>}
                            {f.kmInicial && f.kmFinal ? (
                              <span className="bg-gray-100 px-1.5 py-0.5 rounded">KM: {f.kmInicial} - {f.kmFinal} ({f.kmFinal - f.kmInicial} km)</span>
                            ) : (<span className="text-orange-500 italic">KM Final Pendente</span>)}
                            {litrosFrete > 0 && distFrete > 0 &&
                              <span className="text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">Média: {(distFrete / litrosFrete).toFixed(2)} KM/L</span>}
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded">{despFrete.length} desp · {abastFrete.length} abast · {valesFrete.length} vale</span>
                            {deducoesAprov > 0 && <span className="text-gray-500">Deduções aprov.: {formatCurrency(deducoesAprov)}</span>}
                            {pendentesFrete > 0 && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendentesFrete} pendente(s)</span>}
                          </div>
                        </button>
                      )}
                      <div className="flex items-center space-x-3">
                        <span className="font-bold text-blue-600">{formatCurrency(f.valorFrete)}</span>
                        {editandoFrete
                          ? <button onClick={handleSaveEdit} className="p-1 bg-green-600 text-white rounded shadow-sm"><Save size={16} /></button>
                          : <button onClick={() => handleStartEdit(f, 'frete')} className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"><Edit size={16} /></button>}
                      </div>
                    </div>

                    {aberto && (
                      <div className="p-3 space-y-3 bg-white">
                        {itensFrete.length === 0
                          ? <p className="text-gray-400 text-sm text-center py-3">Nenhum lançamento vinculado a este frete.</p>
                          : itensFrete.map(renderLancamentoItem)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Grupo legado: lançamentos sem frete_id (não podem sumir) */}
              {(() => {
                const itensSemFrete = ordenarLancamentos([
                  ...mDesp.filter((d: any) => !d.frete_id),
                  ...mAbs.filter((a: any) => !a.frete_id),
                  ...mVales.filter((v: any) => !v.frete_id),
                ]);
                if (itensSemFrete.length === 0) return null;
                return (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <button type="button" onClick={() => setSemFreteExpandido(v => !v)} className="w-full flex justify-between items-center gap-3 p-3 bg-gray-50 text-left">
                      <div className="flex items-center gap-2">
                        {semFreteExpandido ? <ChevronDown size={16} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />}
                        <div>
                          <p className="font-bold text-gray-700">Lançamentos sem frete vinculado</p>
                          <p className="text-[10px] text-gray-400">Itens legados, anteriores ao vínculo obrigatório</p>
                        </div>
                      </div>
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold">{itensSemFrete.length}</span>
                    </button>
                    {semFreteExpandido && (
                      <div className="p-3 space-y-3 bg-white">
                        {itensSemFrete.map(renderLancamentoItem)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 h-fit order-1 lg:order-2 lg:sticky lg:top-6">
          <h4 className="flex items-center text-gray-800 mb-4 font-bold text-lg"><DollarSign className="mr-2 text-green-600" /> Balanço Atual</h4>
          <div className="space-y-2">
            {isAutonomo ? (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-500 min-w-0">Faturamento:</span>
                  <span className="font-bold text-gray-800 text-right whitespace-nowrap tabular-nums min-w-[96px]">{formatCurrency(opTotalFretes)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-500 min-w-0">Gastos:</span>
                  <span className="font-bold text-red-600 text-right whitespace-nowrap tabular-nums min-w-[96px]">-{formatCurrency(autGastos)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-base font-extrabold bg-gray-50 -mx-2 px-2 py-2 rounded-lg">
                  <span className="text-gray-700 min-w-0">RESULTADO:</span>
                  <span className={`text-right whitespace-nowrap tabular-nums min-w-[96px] ${autResultado >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(Math.abs(autResultado))}</span>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-500 min-w-0">Valor Total do Frete:</span>
                  <span className="font-bold text-gray-800 text-right whitespace-nowrap tabular-nums min-w-[96px]">{formatCurrency(opTotalFretes)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-500 min-w-0">Porcentagem Motorista ({selectedMotorista?.comissao || 0}%):</span>
                  <span className="font-bold text-blue-600 text-right whitespace-nowrap tabular-nums min-w-[96px]">+{formatCurrency(opComissao)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-500 min-w-0">Desp./Abast. (Motorista):</span>
                  <span className="font-bold text-green-600 text-right whitespace-nowrap tabular-nums min-w-[96px]">+{formatCurrency(opDespMot + opAbastMot)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-500 min-w-0">Vales / Adiantamentos:</span>
                  <span className="font-bold text-red-600 text-right whitespace-nowrap tabular-nums min-w-[96px]">-{formatCurrency(opValesOwner)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-base font-extrabold bg-gray-50 -mx-2 px-2 py-2 rounded-lg">
                  <span className="text-gray-700 min-w-0">SALDO MOTORISTA:</span>
                  <span className={`text-right whitespace-nowrap tabular-nums min-w-[96px] ${opSaldoLiquido >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(Math.abs(opSaldoLiquido))}</span>
                </div>
                <div className="pt-3 border-t border-gray-100 mt-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm font-bold text-gray-600">
                    <span className="flex items-center min-w-0"><TrendingUp size={16} className="mr-2 text-green-500 shrink-0" /> RESULTADO EMPRESA:</span>
                    <span className="text-gray-900 text-right whitespace-nowrap tabular-nums min-w-[96px]">{formatCurrency(Math.abs(opLucroEmpresa))}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">* Frete Total (-) Comissão (-) Despesas/Abast. pagos pela empresa.</p>
                </div>
              </>
            )}
          </div>
          <button onClick={handleFinalizarViagem} disabled={temPendente || !temFreteAtivo}
            className="mt-3 w-full py-2.5 bg-green-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 transition-all disabled:opacity-50 disabled:shadow-none active:scale-95 flex items-center justify-center">
            {temFreteAtivo ? <><Check size={20} className="mr-2" /> FINALIZAR FRETE</> : <span className="flex items-center"><Check size={20} className="mr-2" /> FRETE FINALIZADO</span>}
          </button>
        </div>
      </div>
    </>
  );
  };

  return (

    <div className="space-y-3 pb-20 px-6">
      {filterMot === 'todos' ? renderLista() : renderDetalheMotorista()}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-800"><Truck size={20} className="inline mr-2 text-blue-600" />{editingFrete ? 'Editar Frete' : 'Novo Frete'}</h3>
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
                  <select className="w-full border p-2.5 rounded-xl outline-none focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed" value={editingFrete && isAutonomoNoModal ? 'motorista' : formData.quem_recebeu} disabled={!!(editingFrete && isAutonomoNoModal)} onChange={e => setFormData({...formData, quem_recebeu: e.target.value})}>
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
              <h3 className="text-xl font-bold text-gray-800">Confirmar Finalização do Frete</h3>
              <p className="text-sm text-gray-500">Confira o resumo antes de finalizar:</p>
            </div>
            <div className="px-6 pb-4 space-y-3">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                {isAutonomo ? (
                  // PR-G1: autônomo não usa comissão — resumo do modal = Faturamento − Gastos.
                  // Espelha o card "Balanço Atual"; reusa opTotalFretes/autGastos/autResultado.
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total de Fretes (Faturamento):</span>
                      <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Gastos (desp. + abast. + vales):</span>
                      <span className="font-bold text-red-600">{formatCurrency(autGastos)}</span>
                    </div>
                    <div className="border-t border-gray-200 pt-3 flex justify-between text-base font-extrabold">
                      <span className="text-gray-700">Resultado:</span>
                      <span className={autResultado >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(Math.abs(autResultado))}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total de Fretes:</span>
                      <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Comissão ({selectedMotorista?.comissao || 0}%):</span>
                      <span className="font-bold text-blue-600">{formatCurrency(opComissao)}</span>
                    </div>
                    <div className="border-t border-gray-200 pt-2">
                      <p className="text-xs text-gray-400 font-medium mb-2">Despesas</p>
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
                  </>
                )}
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
              <h3 className="text-xl font-bold text-gray-800">Cancelar Frete</h3>
              <p className="text-gray-500">Tem certeza que deseja cancelar o frete de <strong>{deleteTarget.origem} → {deleteTarget.destino}</strong>?</p>
              <p className="text-xs text-red-500 bg-red-50 p-3 rounded-xl w-full">⚠️ O frete será marcado como cancelado no sistema.</p>
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
