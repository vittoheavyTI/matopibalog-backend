import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, X, Search, Filter, Truck, MapPin, Calendar, DollarSign, Gauge, Trash2, Edit, Check, AlertTriangle, ChevronLeft, ChevronDown, ChevronRight, Fuel, FileText, TrendingUp, Save, Unlock, Lock, Camera, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../utils';
import api, { newClientRequestId } from '../api';
import { PlanoBloqueadoCard } from '../components/PlanoBloqueadoCard';
import { EVENTO_NOTIFICACOES_NOVAS } from '../components/NotificacoesDropdown';

const gvFmt = (d: any, fmt: string) => {
  if (!d) return '-';
  try { const dt = new Date(d); if (isNaN(dt.getTime())) return '-'; return format(dt, fmt); } catch { return '-'; }
};

// Detecta o 403 de plano bloqueado / trial expirado (middleware verificarPlano) e
// extrai a mensagem amigável do backend. Token expirado (error: 'Token inválido ou
// expirado.') NÃO entra aqui — esse fluxo é do api.ts (PR #219, dispara logout).
const extrairMensagemPlano = (err: any): string | null => {
  const resp = err?.response;
  if (resp?.status !== 403) return null;
  const data = resp.data;
  if (data?.error === 'Token inválido ou expirado.') return null;
  return typeof data?.message === 'string' ? data.message : null;
};

export const GerenciamentoViagens: React.FC = () => {
  const [fretes, setFretes] = useState<any[]>([]);
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Estado terminal de erro/vazio do detalhe do motorista. Evita que a tela fique
  // presa em "Carregando dados do motorista..." quando o carregamento falha (ex.: 403
  // por sessão expirada, 500) ou quando o motorista não vem em /admin/motoristas
  // (fora do escopo do usuário / removido). Sem isso o spinner ficava infinito.
  const [erroCarregamento, setErroCarregamento] = useState(false);
  // Mensagem de plano bloqueado / trial expirado (403 do verificarPlano). Quando
  // definida, a tela mostra o card de regularização no lugar da lista/detalhe —
  // evita "Nenhum frete encontrado" quando a causa real é o bloqueio comercial.
  const [planoBloqueadoMsg, setPlanoBloqueadoMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('todos');
  // A URL (?motorista=<id>) é a fonte de verdade do motorista em foco; filterMot é sincronizado a partir dela.
  const [searchParams, setSearchParams] = useSearchParams();
  const motoristaQuery = searchParams.get('motorista');
  // ?novoFrete=1 (vindo do botão "Adicionar Frete" do Dashboard) abre o modal "Novo Frete".
  const novoFreteQuery = searchParams.get('novoFrete');
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
  const [freteFinalizacao, setFreteFinalizacao] = useState<any | null>(null);
  const [kmFinalizacao, setKmFinalizacao] = useState('');
  const [fotoFinalizacao, setFotoFinalizacao] = useState<File | null>(null);
  const [fotoFinalizacaoPreview, setFotoFinalizacaoPreview] = useState<string | null>(null);
  const [finalizandoFrete, setFinalizandoFrete] = useState(false);
  // Fretes ativos/pendentes (2+) oferecidos no modal de seleção ao finalizar.
  // Vazio = modal fechado. Substitui o antigo window.prompt numerado.
  const [fretesParaFinalizar, setFretesParaFinalizar] = useState<any[]>([]);
  // Recuperação: frete criado mas cuja foto inicial NÃO subiu. Em vez de um alerta
  // sem saída, guardamos o frete + o arquivo + o motivo para oferecer reenvio direto
  // ou abrir o frete pendente. null = modal de recuperação fechado.
  const [freteFotoPendente, setFreteFotoPendente] = useState<{ frete: any; foto: File | null; motivo: string | null } | null>(null);
  const [reenviandoFotoInicial, setReenviandoFotoInicial] = useState(false);
  // Accordion da visualização por frete (detalhe do motorista).
  const [fretesExpandidos, setFretesExpandidos] = useState<Set<string>>(new Set());
  const [semFreteExpandido, setSemFreteExpandido] = useState(false);
  // Combobox digitável de motorista no modal de frete (paridade de UX com o Dashboard).
  const [buscaMotorista, setBuscaMotorista] = useState('');
  const [motoristaAberto, setMotoristaAberto] = useState(false);
  // Limpa busca/dropdown do combobox ao abrir/fechar o modal de frete.
  useEffect(() => { setBuscaMotorista(''); setMotoristaAberto(false); }, [showModal]);

  const [fotoInicial, setFotoInicial] = useState<File | null>(null);
  const [fotoInicialPreview, setFotoInicialPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (fotoInicialPreview) URL.revokeObjectURL(fotoInicialPreview);
  }, [fotoInicialPreview]);
  useEffect(() => () => {
    if (fotoFinalizacaoPreview) URL.revokeObjectURL(fotoFinalizacaoPreview);
  }, [fotoFinalizacaoPreview]);

  const selecionarFotoInicial = (file: File | null) => {
    setFotoInicial(file);
    setFotoInicialPreview(file ? URL.createObjectURL(file) : null);
  };
  const selecionarFotoFinal = (file: File | null) => {
    setFotoFinalizacao(file);
    setFotoFinalizacaoPreview(file ? URL.createObjectURL(file) : null);
  };

  const enviarFotoOdometro = async (freteId: string, tipo: 'inicial' | 'final', file: File) => {
    const form = new FormData();
    form.append('foto', file);
    return api.post(`/fretes/${freteId}/odometro/${tipo}`, form);
  };

  const [formData, setFormData] = useState({
    motorista_id: '',
    origem: '',
    destino: '',
    modalidade_calculo: 'valor_fixo',
    valor_frete: '',
    toneladas: '',
    valor_tonelada_km: '',
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
      setErroCarregamento(false);
      setPlanoBloqueadoMsg(null);
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
      const msgPlano = extrairMensagemPlano(err);
      if (msgPlano) setPlanoBloqueadoMsg(msgPlano);
      else setErroCarregamento(true);
    } finally {
      setLoading(false);
    }
  };

  const loadMotoristaData = async (motId: string) => {
    try {
      setErroCarregamento(false);
      setPlanoBloqueadoMsg(null);
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
        modalidade_calculo: f.modalidade_calculo || 'valor_fixo',
        toneladas: f.toneladas, valor_tonelada_km: f.valor_tonelada_km,
        data: f.data, criadoEm: f.data,
        // Paths de odômetro: sem eles o pré-check de finalização (foto final
        // obrigatória no novo fluxo) fica sempre desligado. Preserva ambos.
        foto_odometro_inicial_path: f.foto_odometro_inicial_path || null,
        foto_odometro_final_path: f.foto_odometro_final_path || null,
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
      const msgPlano = extrairMensagemPlano(err);
      if (msgPlano) setPlanoBloqueadoMsg(msgPlano);
      else setErroCarregamento(true);
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

  // Refresh automático ao chegar notificação nova (evento global do sino):
  // refaz o fetch conforme o modo atual (todos x motorista), sem recarregar a
  // página. Listener limpo no unmount / a cada troca de filtro.
  useEffect(() => {
    const handler = () => {
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
      else loadData();
    };
    window.addEventListener(EVENTO_NOTIFICACOES_NOVAS, handler);
    return () => window.removeEventListener(EVENTO_NOTIFICACOES_NOVAS, handler);
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
    selecionarFotoInicial(null);
    setFormData({
      motorista_id: motId || '',
      origem: '',
      destino: '',
      modalidade_calculo: 'valor_fixo',
      valor_frete: '',
      toneladas: '',
      valor_tonelada_km: '',
      km_inicial: '',
      km_final: '',
      quem_recebeu: 'proprietario',
      status: 'ativo',
      data: format(new Date(), 'yyyy-MM-dd')
    });
    setShowModal(true);
  };

  // Abre o modal "Novo Frete" automaticamente quando o Dashboard navega com ?novoFrete=1.
  // Após abrir, remove o parâmetro (replace) preservando ?motorista — assim não reabre em loop.
  useEffect(() => {
    if (novoFreteQuery === '1') {
      openNewModal();
      const next = new URLSearchParams(searchParams);
      next.delete('novoFrete');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novoFreteQuery]);

  const openEditModal = (frete: any) => {
    setEditingFrete(frete);
    selecionarFotoInicial(null);
    setFormData({
      motorista_id: frete.motorista_id,
      origem: frete.origem,
      destino: frete.destino,
      modalidade_calculo: frete.modalidade_calculo || 'valor_fixo',
      valor_frete: frete.valor_frete != null ? String(frete.valor_frete) : '',
      toneladas: frete.toneladas != null ? String(frete.toneladas) : '',
      valor_tonelada_km: frete.valor_tonelada_km != null ? String(frete.valor_tonelada_km) : '',
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
    const novoFluxoSemFotoInicial = !editingFrete
      || (editingFrete.status === 'pendente' && !editingFrete.foto_odometro_inicial_path);
    if (novoFluxoSemFotoInicial && Number(formData.km_inicial) <= 0) {
      alert('Informe o KM inicial para iniciar o frete.');
      return;
    }
    if (novoFluxoSemFotoInicial && !fotoInicial) {
      alert('Envie a foto do odômetro inicial para iniciar o frete.');
      return;
    }
    if (fotoInicial && fotoInicial.size > 10 * 1024 * 1024) {
      alert('A foto do odômetro deve ter no máximo 10 MB.');
      return;
    }
    // Validação por modalidade:
    //  - tonelada/km: exige toneladas > 0 e valor por tonelada/km > 0. O valor do
    //    frete é CALCULADO no backend (na finalização, com o km_final) — não é digitado.
    //  - valor fixo: exige o valor do frete > 0 (comportamento histórico).
    const isTonKm = formData.modalidade_calculo === 'tonelada_km';
    if (isTonKm) {
      const ton = parseFloat(formData.toneladas);
      const vtk = parseFloat(formData.valor_tonelada_km);
      if (!formData.toneladas || isNaN(ton) || ton <= 0) { alert('Informe as toneladas (maior que zero).'); return; }
      if (!formData.valor_tonelada_km || isNaN(vtk) || vtk <= 0) { alert('Informe o valor por tonelada/km (maior que zero).'); return; }
    } else {
      const valorFrete = parseFloat(formData.valor_frete);
      if (!formData.valor_frete || isNaN(valorFrete) || valorFrete <= 0) { alert('Informe um valor de frete válido.'); return; }
    }
    try {
      setIsSubmitting(true);
      const payload: any = {
        origem: formData.origem,
        destino: formData.destino,
        modalidade_calculo: formData.modalidade_calculo,
        // PR-G2: KM é opcional — manda null quando vazio, 0 ou negativo (o backend trata null
        // como "não enviado"); evita coagir a 0 e reprovar na validação de número positivo.
        km_inicial: Number(formData.km_inicial) > 0 ? parseInt(formData.km_inicial) : null,
        km_final: Number(formData.km_final) > 0 ? parseInt(formData.km_final) : null,
        // Autônomo nunca recebe via 'proprietario': força 'motorista' (regra de produto). Vale na
        // criação E na edição. Vinculado usa o valor escolhido no select (default 'proprietario').
        quem_recebeu: isAutonomoNoModal ? 'motorista' : formData.quem_recebeu,
        status: formData.status,
        data: formData.data
      };
      if (isTonKm) {
        // valor_frete é derivado no backend; enviamos só os insumos.
        payload.toneladas = parseFloat(formData.toneladas);
        payload.valor_tonelada_km = parseFloat(formData.valor_tonelada_km);
      } else {
        payload.valor_frete = parseFloat(formData.valor_frete);
      }

      let freteId: string;
      let freteResultante: any = editingFrete;
      if (editingFrete) {
        // Frete pendente sem foto não pode ser ativado por PATCH. Mantém pendente
        // até o endpoint de upload inicial gravar o path e ativá-lo atomicamente.
        if (editingFrete.status === 'pendente' && !editingFrete.foto_odometro_inicial_path) {
          payload.status = 'pendente';
        }
        await api.patch('/fretes/' + editingFrete.id, {...payload});
        freteId = editingFrete.id;
      } else {
        // Na CRIAÇÃO enviamos quem_recebeu (autônomo travado em 'motorista'; vinculado escolhe,
        // default 'proprietario'). O backend ainda força 'motorista' p/ autônomo (defense-in-depth).
        // status continua omitido: o backend o ignora na criação (insert não inclui o campo).
        const { status: _statusOmitido, ...payloadCriacao } = payload;
        const criado = await api.post('/fretes', {
          ...payloadCriacao,
          motorista_id: formData.motorista_id,
          odometro_obrigatorio: true,
        });
        freteId = criado.data.id;
        freteResultante = criado.data;
      }
      if (fotoInicial) {
        try {
          await enviarFotoOdometro(freteId, 'inicial', fotoInicial);
        } catch (uploadErr: any) {
          // O frete JÁ persistiu, mas a foto inicial não subiu (falha de rede/storage ou
          // endpoint de upload ainda não disponível no backend). Em vez de um alerta sem
          // saída, atualiza a lista e abre o modal de recuperação apontando para o frete
          // correto — com o arquivo já selecionado para reenvio em um clique.
          if (filterMot !== 'todos') { await loadMotoristaData(filterMot); } else { await loadData(); }
          setShowModal(false);
          setFreteFotoPendente({
            frete: { ...(freteResultante || {}), id: freteId, foto_odometro_inicial_path: null },
            foto: fotoInicial,
            motivo: uploadErr?.response?.data?.message || null,
          });
          selecionarFotoInicial(null);
          return;
        }
      }
      if (filterMot !== 'todos') {
        await loadMotoristaData(filterMot);
      } else {
        await loadData();
      }
      setShowModal(false);
      selecionarFotoInicial(null);
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

  // Reenvia a foto inicial de um frete que ficou sem ela (fluxo de recuperação). Reaproveita
  // o arquivo já selecionado; em sucesso, ativa o frete e fecha o modal. Em falha, mantém o
  // modal aberto e mostra o motivo — o usuário ainda pode "Abrir frete pendente".
  const reenviarFotoInicialPendente = async () => {
    const alvo = freteFotoPendente;
    if (!alvo?.frete?.id || !alvo.foto) return;
    try {
      setReenviandoFotoInicial(true);
      await enviarFotoOdometro(alvo.frete.id, 'inicial', alvo.foto);
      if (filterMot !== 'todos') { await loadMotoristaData(filterMot); } else { await loadData(); }
      setFreteFotoPendente(null);
      selecionarFotoInicial(null);
      alert('Foto do odômetro inicial enviada. O frete foi ativado.');
    } catch (err: any) {
      alert('Ainda não foi possível enviar a foto: ' + (err?.response?.data?.message || err.message || 'erro desconhecido') + '.');
    } finally {
      setReenviandoFotoInicial(false);
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

  // Idempotência do lançamento: id estável por sessão do modal (gerado na abertura),
  // reusado em retry do mesmo envio e limpo só após sucesso. savingItem evita o
  // clique duplo (o botão "Lançar Registro" não era desabilitado durante o envio).
  const reqIdItemRef = useRef<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  const handleAddItem = async () => {
    if (!selectedMotorista || !showAddModal || savingItem) return;
    setSavingItem(true);
    try {
      // Resolve o frete ativo: 0 → bloqueia, 1 → usa direto, >1 → solicita seleção.
      // Evita escolher o primeiro silenciosamente quando há múltiplos ativos.
      const ativos = fretes.filter(f =>
        (f.motoristaUid === filterMot || f.motorista_id === filterMot) &&
        (f.status === 'ativo' || f.status === 'pendente'));
      let freteId: string | undefined;
      if (ativos.length === 0) {
        alert('Não há frete ativo para lançar.');
        return;
      } else if (ativos.length === 1) {
        freteId = ativos[0].id;
      } else {
        const escolha = window.prompt(
          `Há ${ativos.length} fretes ativos para este motorista. Digite o número do frete desejado:\n\n` +
          ativos.map((f: any, i: number) =>
            `${i + 1}: ${f.origem || '-'} → ${f.destino || '-'} (${f.status} - R$ ${f.valorFrete ?? f.valor_frete ?? '0'})`
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
      // Reusado em retry do mesmo envio; limpo só após sucesso.
      if (!reqIdItemRef.current) reqIdItemRef.current = newClientRequestId();
      const clientRequestId = reqIdItemRef.current;
      if (showAddModal === 'despesa' || showAddModal === 'manutencao') {
        await api.post('/despesas', { motorista_id: filterMot, frete_id: freteId, tipo: showAddModal === 'manutencao' ? 'manutencao' : 'geral', descricao: newItemData.descricao, valor: Number(newItemData.valor), quem_pagou: newItemData.quemPagou || 'proprietario', client_request_id: clientRequestId });
      } else if (showAddModal === 'abastecimento') {
        await api.post('/abastecimentos', { motorista_id: filterMot, frete_id: freteId, posto: newItemData.posto, litros: Number(newItemData.litros), valor_total: Number(newItemData.valorTotal), quem_pagou: newItemData.quemPagou || 'proprietario', client_request_id: clientRequestId });
      } else if (showAddModal === 'vale') {
        await api.post('/vales', { motorista_id: filterMot, frete_id: freteId, descricao: newItemData.descricao, valor: Number(newItemData.valor), quem_pagou: newItemData.quemPagou || 'proprietario', client_request_id: clientRequestId });
      }
      reqIdItemRef.current = null; // sucesso: próximo lançamento recebe id novo
      if (filterMot !== 'todos') loadMotoristaData(filterMot);
      setShowAddModal(null);
      setNewItemData({});
    } catch (err: any) {
      alert(err?.response?.status === 409
        ? (err.response.data?.message || 'Não é possível lançar em uma viagem encerrada.')
        : 'Erro ao adicionar item.');
    } finally {
      setSavingItem(false);
    }
  };

  const abrirModalFinalizacao = (frete: any) => {
    if (frete?.status === 'pendente' && !frete?.foto_odometro_inicial_path) {
      alert('Envie a foto do odômetro inicial para ativar o frete antes de finalizar.');
      return;
    }
    setFreteFinalizacao(frete);
    setKmFinalizacao(frete?.km_final ? String(frete.km_final) : '');
    selecionarFotoFinal(null);
    setShowFinalizarModal(true);
  };

  const handleFinalizarViagem = () => {
    if (!selectedMotorista) return;
    const ativos = mFretes.filter(f => f.status === 'ativo' || f.status === 'pendente');
    if (ativos.length === 0) {
      alert('Nenhum frete ativo encontrado para finalizar.');
      return;
    }
    if (ativos.length === 1) {
      abrirModalFinalizacao(ativos[0]);
      return;
    }
    // 2+ ativos: abre modal de seleção visual (substitui o window.prompt).
    // Nunca escolhe o primeiro silenciosamente — o usuário decide no modal.
    setFretesParaFinalizar(ativos);
  };

  const confirmFinalizarViagem = async () => {
    if (!selectedMotorista) return;
    const ativo = freteFinalizacao;
    if (!ativo) {
      setShowFinalizarModal(false);
      alert('Nenhum frete ativo encontrado para finalizar.');
      return;
    }
    const novoFluxoOdometro = Boolean(ativo.foto_odometro_inicial_path);
    const exigeKmFinal = novoFluxoOdometro || ativo.modalidade_calculo === 'tonelada_km';
    const kmInicial = Number(ativo.km_inicial ?? ativo.kmInicial);
    const kmFinal = Number(kmFinalizacao);
    if (exigeKmFinal && (!Number.isFinite(kmInicial) || kmInicial <= 0)) {
      alert('O frete não possui KM inicial válido. Edite-o antes de finalizar.');
      return;
    }
    if (exigeKmFinal) {
      // Distingue "KM final ausente" (mensagem por modalidade) de "KM final inválido".
      const kmFinalVazio = String(kmFinalizacao).trim() === '' || !Number.isFinite(kmFinal);
      if (kmFinalVazio) {
        alert(ativo.modalidade_calculo === 'tonelada_km'
          ? 'Informe o KM final para calcular e finalizar o frete por tonelada/km.'
          : 'Informe o KM final para finalizar este frete.');
        return;
      }
      if (kmFinal <= kmInicial) {
        alert('Informe um KM final maior que o KM inicial.');
        return;
      }
    }
    if (ativo.foto_odometro_inicial_path && !ativo.foto_odometro_final_path && !fotoFinalizacao) {
      alert('Envie a foto do odômetro final para concluir o frete.');
      return;
    }
    if (fotoFinalizacao && fotoFinalizacao.size > 10 * 1024 * 1024) {
      alert('A foto do odômetro deve ter no máximo 10 MB.');
      return;
    }
    try {
      setFinalizandoFrete(true);
      if (fotoFinalizacao) await enviarFotoOdometro(ativo.id, 'final', fotoFinalizacao);
      // Finaliza via rota dedicada — o backend é a trava final (409 se houver pendência)
      await api.post('/fretes/' + ativo.id + '/finalizar', exigeKmFinal ? { km_final: kmFinal } : {});
      // Marca como finalizado SOMENTE os aprovados DESTA viagem (frete ativo), após sucesso
      const promises = [
        ...despesas.filter(d => d.status === 'aprovado' && d.frete_id === ativo.id).map(d => api.patch('/despesas/' + d.id, { status: 'finalizado' })),
        ...abastecimentos.filter(a => a.status === 'aprovado' && a.frete_id === ativo.id).map(a => api.patch('/abastecimentos/' + a.id, { status: 'finalizado' })),
        ...vales.filter(v => v.status === 'aprovado' && v.frete_id === ativo.id).map(v => api.patch('/vales/' + v.id, { status: 'finalizado' }))
      ];
      await Promise.all(promises);
      setShowFinalizarModal(false);
      setFreteFinalizacao(null);
      selecionarFotoFinal(null);
      setFilterMot('todos');
      await loadData();
      alert('Frete finalizado! Os dados foram movidos para o resumo histórico.');
    } catch (err: any) {
      // Plano suspenso/bloqueado/expirado (403 do verificarPlano): não é erro de
      // servidor. Mostra o card de regularização com caminho para Faturas / Regularização.
      const planoMsg = extrairMensagemPlano(err);
      if (planoMsg) {
        setShowFinalizarModal(false);
        setPlanoBloqueadoMsg(planoMsg);
        return;
      }
      const msg = err?.response?.status === 409
        ? (err.response.data?.message || 'Há lançamentos pendentes deste motorista.')
        : (err?.response?.data?.message || 'Erro ao finalizar frete no servidor.');
      alert(msg);
    } finally {
      setFinalizandoFrete(false);
    }
  };

  /// Prepara a finalização de um frete específico e verifica suas pendências.
  const handleFinalizarFreteEspecifico = async (frete: any) => {
    if (!frete?.id) return;
    const pendente = mDesp.some(d => d.frete_id === frete.id && d.status === 'pendente') ||
      mAbs.some(a => a.frete_id === frete.id && a.status === 'pendente') ||
      mVales.some(v => v.frete_id === frete.id && v.status === 'pendente');
    if (pendente) {
      alert('Este frete possui lançamentos pendentes. Aprove ou rejeite todos antes de finalizar.');
      return;
    }
    abrirModalFinalizacao(frete);
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
      ativo: 'bg-slate-100 text-slate-700', pendente: 'bg-yellow-100 text-yellow-700',
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
  // Combobox de motorista: rótulo do selecionado e lista filtrada pela busca digitada.
  const motoristaSelecionadoModal = motoristas.find(m => m.uid === formData.motorista_id);
  const motoristaSelecionadoLabel = motoristaSelecionadoModal ? `${motoristaSelecionadoModal.nome} - ${motoristaSelecionadoModal.placa}` : '';
  const buscaMotNorm = buscaMotorista.trim().toLowerCase();
  const listaMotoristasModal = buscaMotNorm
    ? motoristas.filter(m => (m.nome || '').toLowerCase().includes(buscaMotNorm))
    : motoristas;

  const mFretes = fretes.filter(f => f.motoristaUid === filterMot || f.motorista_id === filterMot);
  // Cancelados continuam visíveis na lista/badge (mFretes), mas ficam FORA de TODAS as agregações
  // financeiras (Faturamento, Comissão, Saldo, Resultado) e operacionais (KM total, média de consumo).
  const fretesParaCalculo = mFretes.filter(f => f.status !== 'cancelado');
  const opTotalFretes = fretesParaCalculo.reduce((acc, f) => acc + parseFloat(f.valorFrete), 0);
  const opComissao = opTotalFretes * ((selectedMotorista?.comissao || 0) / 100);
  const mDesp = despesas;
  const mAbs = abastecimentos;
  const mVales = vales;
  // Pendência de um frete específico: algum lançamento (desp/abast/vale) pendente
  // vinculado a ele. Mesma regra da trava de finalização, reusada no modal de seleção.
  const fretePossuiPendencia = (freteId: string) =>
    mDesp.some(d => d.frete_id === freteId && d.status === 'pendente') ||
    mAbs.some(a => a.frete_id === freteId && a.status === 'pendente') ||
    mVales.some(v => v.frete_id === freteId && v.status === 'pendente');
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
  const temFreteAtivo = mFretes.some(f => f.status === 'ativo' || f.status === 'pendente');
  const totalLiters = abastecimentosParaCalculo.filter(a => a.status === 'aprovado').reduce((acc, a) => acc + (parseFloat(a.litros) || 0), 0);
  const totalKM = fretesParaCalculo.reduce((acc, f) => {
    if (f.kmFinal && f.kmInicial && f.kmFinal > f.kmInicial) return acc + (f.kmFinal - f.kmInicial);
    return acc;
  }, 0);
  const mediaConsumo = totalLiters > 0 && totalKM > 0 ? (totalKM / totalLiters).toFixed(2) : '0.00';
  // Avisos de média (apenas visuais — NÃO alteram totalKM/totalLiters/mediaConsumo nem cálculos financeiros).
  const mediaForaEsperado = totalKM > 0 && totalLiters > 0 && (totalKM / totalLiters) > 8;
  const temAbastPendente = mAbs.some(a => a.status === 'pendente');

  // Recorte de exibição da lista principal (não altera dados nem cálculos):
  // o default "Todos Status" prioriza o mês vigente + fretes ativos/pendentes de
  // qualquer mês (carry-over). Finalizados/cancelados de meses anteriores saem do
  // default, mas continuam acessíveis ao escolher o status correspondente.
  const ymAtual = format(new Date(), 'yyyy-MM');
  const isFreteAtivoOuPendente = (f: any) => f.status === 'ativo' || f.status === 'pendente';
  const isFreteDoMesAtual = (f: any) => typeof f.data === 'string' && f.data.slice(0, 7) === ymAtual;

  const filtered = fretes.filter(f => {
    if (filterMot !== 'todos') return f.motoristaUid === filterMot || f.motorista_id === filterMot;
    const matchSearch = f.origem?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.destino?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.motoristas?.usuarios?.nome?.toLowerCase().includes(searchTerm.toLowerCase());
    if (filterStatus === 'todos') {
      return matchSearch && (isFreteDoMesAtual(f) || isFreteAtivoOuPendente(f));
    }
    return matchSearch && f.status === filterStatus;
  });

  const renderLista = () => (
    <>
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Gerenciamento de Fretes</h2>
          <p className="text-gray-600 text-sm">Cadastro e acompanhamento de fretes</p>
        </div>
        <button onClick={() => openNewModal()} className="flex items-center px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-all shadow-md active:scale-95 font-bold">
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
            <option value="ativo">Ativo</option>
            <option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (<p className="p-8 text-center text-gray-600">Carregando fretes...</p>)
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
                {[...filtered].sort((a: any, b: any) => {
                  const prioA = a.status === 'ativo' || a.status === 'pendente' ? 0 : 1;
                  const prioB = b.status === 'ativo' || b.status === 'pendente' ? 0 : 1;
                  if (prioA !== prioB) return prioA - prioB;
                  const tsA = new Date(a.data || a.criadoEm).getTime();
                  const tsB = new Date(b.data || b.criadoEm).getTime();
                  return tsB - tsA;
                }).map(frete => (
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
                        {/* Tonelada/km sem KM final guarda 0 provisório no banco (coluna NOT NULL):
                            mostra "a calcular" em vez de R$ 0,00. Assim que o KM final é informado
                            (na edição ou na finalização), o valor real é calculado e exibido — mesmo
                            que o frete ainda esteja ativo. */}
                        {frete.modalidade_calculo === 'tonelada_km' && !(frete.km_final ?? frete.kmFinal)
                          ? <span className="text-xs text-orange-400 italic">a calcular</span>
                          : ((frete.valor_frete ?? frete.valorFrete) != null ? formatCurrency(frete.valor_frete ?? frete.valorFrete) : <span className="text-xs text-orange-400 italic">a calcular</span>)}
                      </span>
                      {frete.modalidade_calculo === 'tonelada_km' && (
                        <span className="mt-0.5 inline-block text-[10px] font-bold uppercase tracking-wide text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">
                          Ton/km{frete.toneladas ? ` · ${frete.toneladas}t` : ''}
                        </span>
                      )}
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
          <p className="text-xs text-gray-600">Pago por: {item.quemPagou} • {gvFmt(item.data, 'dd/MM HH:mm')}</p>
          {type !== 'vale' && (
            item.fotoUrl ? (
              <p className="text-xs mt-0.5">
                <button type="button" onClick={() => baixarComprovante(item.fotoUrl, item.id)} className="text-blue-600 hover:underline">Baixar comprovante</button>
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
                : <button onClick={() => handleStartEdit(item, type)} className="p-1 text-gray-400 hover:text-blue-600 transition-colors" title="Editar"><Edit size={16} /></button>}
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
    // Enquanto o carregamento inicial está em andamento, mantém o spinner.
    if (loading) {
      return (
        <div className="py-20 text-center text-gray-600">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          Carregando dados do motorista...
        </div>
      );
    }
    // Estado terminal: carregamento terminou mas o motorista não veio na lista
    // (fora do escopo / removido / sessão expirada gerando 403) ou uma chamada falhou.
    // Mostra mensagem amigável com saída para a lista, em vez de spinner infinito.
    if (erroCarregamento || !selectedMotorista) {
      return (
        <div className="py-16 px-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center mb-4">
            <AlertTriangle size={24} className="text-yellow-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-1">Motorista não encontrado, sem acesso ou sessão expirada.</h3>
          <p className="text-sm text-gray-500 mb-6">Volte para a lista e tente novamente. Se o problema continuar, faça login novamente.</p>
          <button onClick={() => selecionarMotorista('todos')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors">
            <ChevronLeft size={18} className="mr-1" /> Voltar para lista
          </button>
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
                <p className="font-bold">
                  {totalKM > 0 && totalLiters > 0
                    ? `${mediaConsumo} KM/L`
                    : totalKM > 0 ? 'Sem abastecimento aprovado' : 'Pendente de KM'}
                </p>
                {mediaForaEsperado && <p className="text-[10px] text-yellow-200 font-semibold mt-0.5">Média fora do esperado — conferir KM/abastecimentos</p>}
                {totalKM > 0 && totalLiters > 0 && temAbastPendente && <p className="text-[10px] text-orange-200 font-semibold mt-0.5">Média parcial — há abastecimentos pendentes</p>}
              </div>
            </div>
            <button onClick={handleToggleBlock} className="p-2 rounded-lg transition-colors bg-white/20 hover:bg-white/30 border border-white/10">
              {selectedMotorista.status === 'bloqueado' ? <Unlock size={20} /> : <Lock size={20} />}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="space-y-6 order-2 lg:order-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-100 font-bold text-gray-700 flex items-center justify-between">
              <span className="flex items-center"><FileText className="mr-2" size={18} /> Lançamentos</span>
              <div className="flex space-x-2">
                <button onClick={() => { reqIdItemRef.current = newClientRequestId(); setShowAddModal('despesa'); }} disabled={!temFreteAtivo} title={!temFreteAtivo ? 'Não há frete ativo para lançar' : undefined} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={14} className="mr-1" /> Despesa
                </button>
                <button onClick={() => { reqIdItemRef.current = newClientRequestId(); setShowAddModal('abastecimento'); }} disabled={!temFreteAtivo} title={!temFreteAtivo ? 'Não há frete ativo para lançar' : undefined} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={14} className="mr-1" /> Abast.
                </button>
                <button onClick={() => { reqIdItemRef.current = newClientRequestId(); setShowAddModal('vale'); }} disabled={!temFreteAtivo} title={!temFreteAtivo ? 'Não há frete ativo para lançar' : undefined} className="flex items-center px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors font-bold text-xs shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={14} className="mr-1" /> Vale
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {mFretes.length === 0 && mDesp.length === 0 && mAbs.length === 0 && mVales.length === 0 &&
                <p className="text-gray-600 text-center py-8">Nenhum lançamento.</p>}

              {/* Fretes ordenados: ativos/pendentes no topo, depois finalizados, do mais recente para o mais antigo */}
              {[...mFretes]
                .filter((f: any) => f.status !== 'cancelado')
                .sort((a: any, b: any) => {
                  const prioA = a.status === 'ativo' || a.status === 'pendente' ? 0 : 1;
                  const prioB = b.status === 'ativo' || b.status === 'pendente' ? 0 : 1;
                  if (prioA !== prioB) return prioA - prioB;
                  return tsFrete(b) - tsFrete(a);
                })
                .map((f: any) => {
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
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-600 mt-1 pl-6">
                            <span>{gvFmt(f.criadoEm || f.data, 'dd/MM/yyyy')}</span>
                            {f.placa && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{f.placa}</span>}
                            {f.kmInicial && f.kmFinal ? (
                              <span className="bg-gray-100 px-1.5 py-0.5 rounded">KM: {f.kmInicial} - {f.kmFinal} ({f.kmFinal - f.kmInicial} km)</span>
                            ) : (<span className="text-orange-500 italic">KM Final Pendente</span>)}
                            {litrosFrete > 0 && distFrete > 0 &&
                              <span className="text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded">Média: {(distFrete / litrosFrete).toFixed(2)} KM/L</span>}
                            <span className="bg-gray-100 px-1.5 py-0.5 rounded">{despFrete.length} desp · {abastFrete.length} abast · {valesFrete.length} vale</span>
                            {deducoesAprov > 0 && <span className="text-gray-600">Deduções aprov.: {formatCurrency(deducoesAprov)}</span>}
                            {pendentesFrete > 0 && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">{pendentesFrete} pendente(s)</span>}
                          </div>
                        </button>
                      )}
                      <div className="flex items-center space-x-3">
                        <span className="font-bold text-blue-600">{formatCurrency(f.valorFrete)}</span>
                        {editandoFrete
                          ? <button onClick={handleSaveEdit} className="p-1 bg-green-600 text-white rounded shadow-sm"><Save size={16} /></button>
                          : <button onClick={() => handleStartEdit(f, 'frete')} className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"><Edit size={16} /></button>}
                        {/* Cancelar frete: só para fretes ativos/pendentes e fora do modo edição.
                            Reusa o fluxo de confirmação (setDeleteTarget → modal → handleDelete),
                            que faz soft-cancel (status 'cancelado', nunca delete físico). */}
                        {!editandoFrete && (f.status === 'ativo' || f.status === 'pendente') && (
                          <button
                            onClick={() => setDeleteTarget(f)}
                            className="p-1 text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancelar frete"
                            aria-label="Cancelar frete"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
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

              {/* Grupo legado: lançamentos sem frete_id — ocultos da visão operacional
                  (não deletados, permanecem no banco). Se necessário no futuro, reativar
                  em seção técnica/admin separada. */}
              {false && (() => {
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
                        {semFreteExpandido ? <ChevronDown size={16} className="text-gray-600 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-600 flex-shrink-0" />}
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
                  <span className="text-gray-600 min-w-0">Faturamento:</span>
                  <span className="font-bold text-gray-800 text-right whitespace-nowrap tabular-nums min-w-[96px]">{formatCurrency(opTotalFretes)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-600 min-w-0">Gastos:</span>
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
                  <span className="text-gray-600 min-w-0">Valor Total do Frete:</span>
                  <span className="font-bold text-gray-800 text-right whitespace-nowrap tabular-nums min-w-[96px]">{formatCurrency(opTotalFretes)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-600 min-w-0">Porcentagem Motorista ({selectedMotorista?.comissao || 0}%):</span>
                  <span className="font-bold text-blue-600 text-right whitespace-nowrap tabular-nums min-w-[96px]">+{formatCurrency(opComissao)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-600 min-w-0">Desp./Abast. (Motorista):</span>
                  <span className="font-bold text-green-600 text-right whitespace-nowrap tabular-nums min-w-[96px]">+{formatCurrency(opDespMot + opAbastMot)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm border-b border-gray-50 pb-1">
                  <span className="text-gray-600 min-w-0">Vales / Adiantamentos:</span>
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
          <button onClick={handleFinalizarViagem}
            disabled={!temFreteAtivo}
            className="mt-3 w-full py-2.5 bg-green-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 transition-all disabled:opacity-50 disabled:shadow-none active:scale-95 flex items-center justify-center">
            {temFreteAtivo
              ? <><Check size={20} className="mr-2" /> FINALIZAR FRETE</>
              : <span className="flex items-center"><Check size={20} className="mr-2" /> FRETE FINALIZADO</span>}
          </button>
        </div>
      </div>
    </>
  );
  };

  return (

    <div className="space-y-3 pb-20 px-6">
      {planoBloqueadoMsg ? (
        <div className="pt-10">
          <PlanoBloqueadoCard message={planoBloqueadoMsg} onRegularizar={() => navigate('/minhas-faturas')} />
        </div>
      ) : filterMot === 'todos' ? renderLista() : renderDetalheMotorista()}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800"><Truck size={20} className="inline mr-2 text-blue-600" />{editingFrete ? 'Editar Frete' : 'Novo Frete'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {!editingFrete && (
                <div className="relative">
                  <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Motorista *</label>
                  <input
                    type="text"
                    value={motoristaAberto ? buscaMotorista : motoristaSelecionadoLabel}
                    onChange={e => setBuscaMotorista(e.target.value)}
                    onFocus={() => { setMotoristaAberto(true); setBuscaMotorista(''); }}
                    onBlur={() => setMotoristaAberto(false)}
                    placeholder="Digite ou selecione o motorista..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
                  />
                  {motoristaAberto && (
                    <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                      {listaMotoristasModal.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-gray-400">Nenhum motorista encontrado</li>
                      ) : (
                        listaMotoristasModal.map(m => (
                          <li
                            key={m.uid}
                            onMouseDown={() => { setFormData(prev => ({ ...prev, motorista_id: m.uid })); setMotoristaAberto(false); setBuscaMotorista(''); }}
                            className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
                          >
                            {m.nome} - {m.placa}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Origem *</label><input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.origem} onChange={e => setFormData({...formData, origem: e.target.value})} placeholder="Cidade de origem" /></div>
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Destino *</label><input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.destino} onChange={e => setFormData({...formData, destino: e.target.value})} placeholder="Cidade de destino" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Modalidade de Cálculo</label>
                  <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500" value={formData.modalidade_calculo} onChange={e => setFormData({...formData, modalidade_calculo: e.target.value})}>
                    <option value="valor_fixo">Valor fixo</option>
                    <option value="tonelada_km">Tonelada / km</option>
                  </select>
                </div>
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Data</label><input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.data} onChange={e => setFormData({...formData, data: e.target.value})} /></div>
              </div>
              {formData.modalidade_calculo === 'tonelada_km' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Toneladas *</label><input type="number" step="0.001" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.toneladas} onChange={e => setFormData({...formData, toneladas: e.target.value})} placeholder="0" /></div>
                    <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Valor por Tonelada/km *</label><input type="number" step="0.0001" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.valor_tonelada_km} onChange={e => setFormData({...formData, valor_tonelada_km: e.target.value})} placeholder="0,00" /></div>
                  </div>
                  {(() => {
                    // Prévia do valor: toneladas × (km_final − km_inicial) × valor_tonelada_km.
                    // Só exibe o total quando há KM final > inicial; senão orienta que o valor
                    // será calculado na finalização. Espelha a regra do backend (utils/calculoFrete).
                    const ton = Number(formData.toneladas);
                    const vtk = Number(formData.valor_tonelada_km);
                    const kmIni = Number(formData.km_inicial);
                    const kmFim = Number(formData.km_final);
                    const temInsumos = ton > 0 && vtk > 0;
                    const kmTotal = (Number.isFinite(kmIni) && Number.isFinite(kmFim) && kmFim > kmIni) ? kmFim - kmIni : null;
                    return (
                      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800">
                        {temInsumos && kmTotal !== null ? (
                          <span><b>Valor previsto:</b> {formatCurrency(Math.round(ton * kmTotal * vtk * 100) / 100)} <span className="text-blue-500">({ton} t × {kmTotal.toLocaleString()} km × {formatCurrency(vtk)})</span></span>
                        ) : (
                          <span>O valor será calculado na finalização, quando o KM final for informado (valor = toneladas × km rodado × valor por tonelada/km).</span>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Valor do Frete *</label><input type="number" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.valor_frete} onChange={e => setFormData({...formData, valor_frete: e.target.value})} placeholder="0,00" /></div>
                  <div />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">KM Inicial *</label><input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.km_inicial} onChange={e => setFormData({...formData, km_inicial: e.target.value})} placeholder="0" /></div>
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">KM Final</label><input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" value={formData.km_final} onChange={e => setFormData({...formData, km_final: e.target.value})} placeholder="0" /></div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2">
                <label className="text-xs font-bold text-blue-800 uppercase flex items-center">
                  <Camera size={15} className="mr-1.5" />Foto do odômetro inicial {!editingFrete || !editingFrete.foto_odometro_inicial_path ? '*' : '(substituir)'}
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => selecionarFotoInicial(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:font-bold file:text-white hover:file:bg-blue-700"
                />
                {fotoInicialPreview ? (
                  <img src={fotoInicialPreview} alt="Prévia do odômetro inicial" className="h-32 w-full rounded-lg object-cover border border-blue-100" />
                ) : editingFrete?.foto_odometro_inicial_path ? (
                  <p className="text-xs font-medium text-green-700">Foto inicial já enviada.</p>
                ) : (
                  <p className="text-xs text-blue-700">Obrigatória para ativar o frete. JPEG, PNG ou WebP, até 10 MB.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Quem Recebeu</label>
                  <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed" value={isAutonomoNoModal ? 'motorista' : formData.quem_recebeu} disabled={isAutonomoNoModal} onChange={e => setFormData({...formData, quem_recebeu: e.target.value})}>
                    <option value="proprietario">Proprietário</option><option value="motorista">Motorista</option>
                  </select>
                </div>
                {editingFrete && (
                  <div><label className="block text-xs font-bold text-gray-600 uppercase mb-1">Status</label>
                    <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option value="pendente">Pendente — aguardando foto inicial</option><option value="ativo">Ativo</option><option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="p-5 pt-0 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={isSubmitting} className="px-4 py-2 text-sm font-bold bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors disabled:opacity-50 flex items-center">
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
              <button onClick={() => setShowAddModal(null)} className="px-5 py-2.5 font-bold text-gray-600 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={handleAddItem} disabled={savingItem} className="px-8 py-2.5 bg-green-700 text-white rounded-xl font-bold shadow-lg shadow-green-200 hover:bg-green-800 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">{savingItem ? 'Lançando...' : 'Lançar Registro'}</button>
            </div>
          </div>
        </div>
      )}

      {showFinalizarModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="shrink-0 px-6 pt-5 pb-3 flex flex-col items-center text-center space-y-2 border-b border-gray-100">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <Check size={24} className="text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">Confirmar Finalização do Frete</h3>
              <p className="text-xs text-gray-500">Confira o resumo antes de finalizar.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                {isAutonomo ? (
                  // PR-G1: autônomo não usa comissão — resumo do modal = Faturamento − Gastos.
                  // Espelha o card "Balanço Atual"; reusa opTotalFretes/autGastos/autResultado.
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total de Fretes (Faturamento):</span>
                      <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Gastos (desp. + abast. + vales):</span>
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
                      <span className="text-gray-600">Total de Fretes:</span>
                      <span className="font-bold text-gray-800">{formatCurrency(opTotalFretes)}</span>
                    </div>
                    {!isAutonomo && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Comissão ({selectedMotorista?.comissao || 0}%):</span>
                        <span className="font-bold text-blue-600">{formatCurrency(opComissao)}</span>
                      </div>
                    )}
                    <div className="border-t border-gray-200 pt-2">
                      <p className="text-xs text-gray-400 font-medium mb-2">Despesas</p>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Desp./Abast.:</span>
                        <span className="font-bold text-orange-600">{formatCurrency(opDespMot + opAbastMot)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Vales:</span>
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
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2 text-left">
                <div>
                  <p className="text-xs font-bold text-blue-800 uppercase">Frete</p>
                  <p className="text-sm font-semibold text-gray-800">{freteFinalizacao?.origem || '-'} → {freteFinalizacao?.destino || '-'}</p>
                  <p className="text-xs text-gray-500">KM inicial: {freteFinalizacao?.km_inicial ?? freteFinalizacao?.kmInicial ?? 'não informado'}</p>
                </div>
                {freteFinalizacao && !freteFinalizacao.foto_odometro_inicial_path && freteFinalizacao.modalidade_calculo !== 'tonelada_km' && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 leading-snug">
                    <span className="font-bold">Legado:</span> frete criado antes do fluxo de odômetro. KM final e foto são opcionais.
                  </p>
                )}
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">KM Final {freteFinalizacao?.foto_odometro_inicial_path || freteFinalizacao?.modalidade_calculo === 'tonelada_km' ? '*' : '(opcional — legado)'}</label>
                  <input
                    type="number"
                    value={kmFinalizacao}
                    onChange={e => setKmFinalizacao(e.target.value)}
                    className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                    placeholder="Informe o KM final"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-700 uppercase flex items-center">
                    <Camera size={15} className="mr-1.5" />Foto do odômetro final {freteFinalizacao?.foto_odometro_inicial_path ? '*' : '(legado)'}
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={e => selecionarFotoFinal(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:font-bold file:text-white hover:file:bg-blue-700"
                  />
                  {fotoFinalizacaoPreview ? (
                    <img src={fotoFinalizacaoPreview} alt="Prévia do odômetro final" className="h-32 w-full rounded-lg object-cover border border-blue-100" />
                  ) : freteFinalizacao?.foto_odometro_final_path ? (
                    <p className="text-xs font-medium text-green-700">Foto final já enviada.</p>
                  ) : (
                    <p className="text-xs text-blue-700">JPEG, PNG ou WebP, até 10 MB.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="shrink-0 p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button onClick={() => { setShowFinalizarModal(false); setFreteFinalizacao(null); selecionarFotoFinal(null); }} disabled={finalizandoFrete} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-all disabled:opacity-50">Cancelar</button>
              <button onClick={confirmFinalizarViagem} disabled={finalizandoFrete} className="px-6 py-2.5 bg-green-600 text-white font-bold rounded-xl shadow hover:bg-green-700 transition-all active:scale-95 flex items-center disabled:opacity-50">
                {finalizandoFrete ? <Upload size={18} className="mr-2 animate-pulse" /> : <Check size={18} className="mr-2" />}{finalizandoFrete ? 'Enviando...' : 'Confirmar Finalização'}
              </button>
            </div>
          </div>
        </div>
      )}

      {freteFotoPendente && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="shrink-0 px-6 pt-5 pb-3 flex flex-col items-center text-center space-y-2 border-b border-gray-100">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                <Camera size={24} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">Foto do odômetro inicial pendente</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 text-sm text-gray-700">
              <p>
                {freteFotoPendente.frete?.status === 'pendente'
                  ? 'O frete foi salvo como pendente porque a foto do odômetro inicial não foi enviada.'
                  : 'O frete foi salvo, mas a foto do odômetro inicial não foi enviada.'}
              </p>
              <p className="text-xs text-gray-500">{freteFotoPendente.frete?.origem || '-'} → {freteFotoPendente.frete?.destino || '-'}</p>
              {freteFotoPendente.motivo && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 leading-snug">Motivo: {freteFotoPendente.motivo}</p>
              )}
              <p className="text-xs text-gray-500">Reenvie a foto agora ou abra o frete pendente para enviá-la depois.</p>
            </div>
            <div className="shrink-0 p-4 bg-gray-50 border-t flex flex-col sm:flex-row justify-end gap-2">
              <button onClick={() => { const f = freteFotoPendente.frete; setFreteFotoPendente(null); openEditModal(f); }} disabled={reenviandoFotoInicial} className="px-4 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-all disabled:opacity-50">Abrir frete pendente</button>
              <button onClick={reenviarFotoInicialPendente} disabled={reenviandoFotoInicial || !freteFotoPendente.foto} className="px-5 py-2.5 bg-green-600 text-white font-bold rounded-xl shadow hover:bg-green-700 transition-all active:scale-95 flex items-center justify-center disabled:opacity-50">
                {reenviandoFotoInicial ? <Upload size={18} className="mr-2 animate-pulse" /> : <Camera size={18} className="mr-2" />}{reenviandoFotoInicial ? 'Enviando...' : 'Reenviar foto agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {fretesParaFinalizar.length > 0 && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800"><Check size={20} className="inline mr-2 text-green-600" />Escolha o frete para finalizar</h3>
              <p className="text-xs text-gray-600 mt-1">Este motorista tem mais de um frete ativo. Selecione qual deseja finalizar.</p>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {fretesParaFinalizar.map((f: any) => {
                const pend = fretePossuiPendencia(f.id);
                return (
                  <div key={f.id} className="border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 truncate">{f.origem || '-'} → {f.destino || '-'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${getStatusBadge(f.status)}`}>{f.status}</span>
                        <span className="text-sm font-bold text-blue-600">{formatCurrency(f.valorFrete ?? f.valor_frete)}</span>
                        {pend && <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-yellow-100 text-yellow-700">TEM PENDÊNCIA</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        // Trava em camadas: aviso visual (label), guarda aqui, guarda em
                        // handleFinalizarFreteEspecifico e a trava final do backend (409).
                        if (pend) { alert('Este frete possui lançamentos pendentes. Aprove ou rejeite todos antes de finalizar.'); return; }
                        setFretesParaFinalizar([]);
                        handleFinalizarFreteEspecifico(f);
                      }}
                      className="shrink-0 px-3 py-2 bg-green-600 text-white font-bold rounded-lg text-sm shadow hover:bg-green-700 transition-all active:scale-95 flex items-center">
                      <Check size={16} className="mr-1" />Finalizar
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end">
              <button onClick={() => setFretesParaFinalizar([])} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-all">Cancelar</button>
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
              <p className="text-gray-600">Tem certeza que deseja cancelar o frete de <strong>{deleteTarget.origem} → {deleteTarget.destino}</strong>?</p>
              <p className="text-xs text-red-500 bg-red-50 p-3 rounded-xl w-full">⚠️ O frete será marcado como cancelado e ficará fora de todos os cálculos.</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-all">Voltar</button>
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
