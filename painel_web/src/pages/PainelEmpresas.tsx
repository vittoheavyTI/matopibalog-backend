import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Search, Plus, X, Check, AlertTriangle, Eye, Ban, Unlock, Trash2, KeyRound, CalendarClock, ShieldAlert, UserPlus, CreditCard, Archive, ArchiveRestore, FileText } from 'lucide-react';
import api from '../api';
import { maskCNPJ, maskCPF, maskPhone } from '../utils/masks';

// Formata ISO → DD/MM/AAAA (pt-BR). Retorna '-' se inválido.
function formatData(iso?: string) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR');
}

// Formata uma data-only ('YYYY-MM-DD') SEM conversão de fuso — preserva
// exatamente o dia escolhido (evita o -1 dia que new Date(UTC) causa em fuso
// negativo). Para timestamps completos, cai no formatData.
function formatDia(s?: string) {
  if (!s) return '-';
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : formatData(s);
}

// Trial vencido = data no passado.
function trialVencido(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d < new Date();
}

type EmpresaContratacao = { id: string; nome?: string };
type ResumoContratacao = {
  plano_nome?: string | null;
  quantidade_contratada?: number | string | null;
  capacidade_inclusa?: number | string | null;
  valor_mensal?: number | string | null;
  valor_implantacao?: number | string | null;
  total_inicial?: number | string | null;
  trial_dias?: number | string | null;
  implantacao_gratis?: boolean | null;
};
type ContratoComercial = {
  id: string;
  status: string;
  signed_storage_path?: string | null;
};
type PropostaContratacao = {
  id: string;
  status: string;
  resumo?: ResumoContratacao;
  contratos_comerciais?: ContratoComercial[] | ContratoComercial | null;
};
type SignatarioContratacao = { id: string; papel: string; status: string };
type EventoContratacao = { id: string; tipo: string };
type DadosContratacao = {
  propostas?: PropostaContratacao[];
  signatarios?: SignatarioContratacao[];
  eventos?: EventoContratacao[];
};

function contratoPrincipal(proposta?: PropostaContratacao | null) {
  const c = proposta?.contratos_comerciais;
  if (!c) return null;
  return Array.isArray(c) ? (c[0] || null) : c;
}

function mensagemApi(err: unknown, fallback: string) {
  if (typeof err === 'object' && err && 'response' in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message || fallback;
  }
  return fallback;
}

// Estado de assinatura da conta (discreto). Define o rótulo e se a ação
// "Configurar assinatura sandbox" deve aparecer. A ação NÃO aparece quando:
// sem plano, plano isento (preço 0) ou assinatura já ativa. billing_status vem
// do backend (empresas.*) e pode ser undefined antes da migration → tratado
// como "sem assinatura" (a ação só funciona após a migration aplicada).
function estadoAssinatura(e: any): { label: string; tone: 'ok' | 'warn' | 'muted' | 'neutral'; showAction: boolean } {
  const preco = Number(e?.planos?.preco_mensal ?? 0);
  if (!e?.plano_id || !e?.planos) return { label: 'Sem plano', tone: 'neutral', showAction: false };
  if (!(preco > 0)) return { label: 'Isento', tone: 'neutral', showAction: false };
  if (e.billing_status === 'ativo') return { label: 'Assinatura ativa', tone: 'ok', showAction: false };
  const mapa: Record<string, string> = {
    pendente_cliente: 'Cadastro pendente',
    pendente_assinatura: 'Assinatura pendente',
    erro: 'Erro na assinatura',
    inativo: 'Assinatura inativa',
    nao_configurado: 'Sem assinatura',
  };
  return { label: mapa[e.billing_status] || 'Sem assinatura', tone: e.billing_status === 'erro' ? 'warn' : 'muted', showAction: true };
}

const TONE_CLASSES: Record<string, string> = {
  ok: 'text-green-600',
  warn: 'text-red-500',
  muted: 'text-gray-400',
  neutral: 'text-gray-300',
};

export const PainelEmpresas: React.FC = () => {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [planos, setPlanos] = useState<any[]>([]);
  // Contagem de administradores por conta, derivada de UMA chamada a /admin/usuarios
  // (agrupada em memória). null = ainda não carregada / falhou → NÃO classificar como
  // "Sem administrador" (mostra skeleton ou aviso neutro).
  const [adminCounts, setAdminCounts] = useState<Record<string, number> | null>(null);
  const [adminCountsLoading, setAdminCountsLoading] = useState(true);
  const [adminCountsErro, setAdminCountsErro] = useState(false);
  // Modal de sucesso pós-criação (conta recém-criada, ainda sem administrador).
  const [successConta, setSuccessConta] = useState<{ id: string; nome: string } | null>(null);
  // Confirmação da ação "Configurar assinatura sandbox" (piloto).
  // Botão é provisório para validação — o onboarding automático será fechado
  // posteriormente. Não é o fluxo comercial final.
  const [assinaturaTarget, setAssinaturaTarget] = useState<any | null>(null);
  const [assinaturaEnviando, setAssinaturaEnviando] = useState(false);
  const [contratacaoTarget, setContratacaoTarget] = useState<EmpresaContratacao | null>(null);
  const [contratacaoDados, setContratacaoDados] = useState<DadosContratacao | null>(null);
  const [contratacaoLoading, setContratacaoLoading] = useState(false);
  const [contratacaoEnviando, setContratacaoEnviando] = useState(false);
  const [planosLoading, setPlanosLoading] = useState(false);
  const [planosErro, setPlanosErro] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [formDados, setFormDados] = useState({ nome: '', cnpj: '', email: '', telefone: '', plano_id: '', tipo: 'transportadora' });
  // Capacidade contratada (mega-frente extras por empresa).
  const [qcValue, setQcValue] = useState('');
  const [qcPreview, setQcPreview] = useState<any>(null);
  const [qcMsg, setQcMsg] = useState('');
  const [qcLoading, setQcLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [trialTarget, setTrialTarget] = useState<any>(null);
  const [customDate, setCustomDate] = useState('');
  // Extensão manual do prazo de suspensão por inadimplência (super-admin).
  const [prazoTarget, setPrazoTarget] = useState<any>(null);
  const [prazoInfo, setPrazoInfo] = useState<any>(null);
  const [prazoLoading, setPrazoLoading] = useState(false);
  const [prazoData, setPrazoData] = useState('');
  const [prazoMotivo, setPrazoMotivo] = useState('');
  const [confirmAtivo, setConfirmAtivo] = useState(false);
  const [toast, setToast] = useState<{ message: string; tipo: 'sucesso' | 'erro' } | null>(null);
  // Arquivamento: por padrão a listagem oculta arquivadas; o toggle traz todas.
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<any>(null);
  const [archiveMotivo, setArchiveMotivo] = useState('');

  useEffect(() => { carregarPlanos(); carregarAdmins(); }, []);
  // Recarrega a lista quando alterna "mostrar arquivadas" (roda também na montagem).
  useEffect(() => { carregar(); }, [showArchived]);

  // Auto-dismiss do toast: some sozinho após 3,5s. Cada novo toast reinicia o
  // timer (o cleanup limpa o anterior) e o unmount também limpa — evita a
  // notificação ficar fixa indefinidamente. Fechar manual: botão X no toast.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function carregar() {
    const response = await api.get('/painel-admin/empresas' + (showArchived ? '?includeArchived=true' : ''));
    setEmpresas(response.data || []);
  }

  // Arquivar/restaurar conta. Arquivar tira da operação SEM apagar nada (faturas e
  // histórico permanecem); restaurar traz de volta. Ortogonal a suspensão.
  async function confirmarArquivar() {
    if (!archiveTarget) return;
    const arquivando = !archiveTarget.arquivada_em;
    try {
      await api.put('/painel-admin/empresas/' + archiveTarget.id,
        arquivando ? { arquivar: true, motivo: archiveMotivo.trim() || null } : { arquivar: false });
    } catch {
      setToast({ message: arquivando ? 'Erro ao arquivar' : 'Erro ao restaurar', tipo: 'erro' });
      return;
    }
    setToast({ message: arquivando ? 'Conta arquivada!' : 'Conta restaurada!', tipo: 'sucesso' });
    setArchiveTarget(null); setArchiveMotivo(''); carregar();
  }

  // Uma única consulta de usuários (super-admin recebe todos, com empresa_id + tipo).
  // Conta apenas tipo === 'admin' por empresa_id, em memória → sem N+1, sem backend.
  // Falha → adminCounts=null + erro=true (a UI mostra aviso neutro, nunca "Sem administrador").
  async function carregarAdmins() {
    setAdminCountsLoading(true);
    setAdminCountsErro(false);
    try {
      const response = await api.get('/admin/usuarios');
      const counts: Record<string, number> = {};
      (response.data || []).forEach((u: any) => {
        if (u.tipo === 'admin' && u.empresa_id) {
          counts[u.empresa_id] = (counts[u.empresa_id] || 0) + 1;
        }
      });
      setAdminCounts(counts);
    } catch {
      setAdminCounts(null);
      setAdminCountsErro(true);
    } finally {
      setAdminCountsLoading(false);
    }
  }

  // Carrega o catálogo de planos para o <select> do formulário (mesmo endpoint de PainelPlanos).
  async function carregarPlanos() {
    setPlanosLoading(true);
    setPlanosErro(false);
    try {
      const response = await api.get('/painel-admin/planos');
      setPlanos(response.data || []);
    } catch {
      setPlanosErro(true);
    } finally {
      setPlanosLoading(false);
    }
  }

  async function previewQuantidade() {
    if (!editing) return;
    const q = Number(qcValue);
    setQcMsg('');
    if (!Number.isInteger(q) || q < 1) { setQcMsg('Informe um inteiro ≥ 1.'); return; }
    setQcLoading(true);
    try {
      const { data } = await api.get(`/painel-admin/empresas/${editing.id}/valor-efetivo?quantidade=${q}`);
      setQcPreview(data);
    } catch (err: any) {
      setQcMsg(err?.response?.data?.message || 'Não foi possível calcular.');
    } finally { setQcLoading(false); }
  }

  async function aplicarQuantidade() {
    if (!editing) return;
    const q = Number(qcValue);
    if (!Number.isInteger(q) || q < 1) { setQcMsg('Informe um inteiro ≥ 1.'); return; }
    setQcLoading(true); setQcMsg('');
    try {
      const { data } = await api.patch(`/painel-admin/empresas/${editing.id}/quantidade-contratada`, { quantidade_contratada: q, motivo: 'ajuste_painel' });
      setQcPreview(data);
      setQcMsg('Quantidade aplicada. Sync Asaas marcado (vale para a próxima competência).');
      carregar();
    } catch (err: any) {
      const d = err?.response?.data;
      setQcMsg(d?.requer_negociacao ? (d.message || 'Acima do limite — negociação.') : (d?.message || 'Não foi possível aplicar.'));
    } finally { setQcLoading(false); }
  }

  async function handleSalvar() {
    if (!formDados.nome.trim()) { setToast({ message: 'Nome é obrigatório', tipo: 'erro' }); return; }
    const emailTrim = formDados.email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) { setToast({ message: 'E-mail inválido', tipo: 'erro' }); return; }
    const payload = { nome: formDados.nome, cnpj: formDados.cnpj, email: formDados.email, telefone: formDados.telefone, plano_id: formDados.plano_id || null };
    if (editing) {
      try { await api.put('/painel-admin/empresas/' + editing.id, payload); }
      catch (err: any) { setToast({ message: err?.response?.data?.message || 'Não foi possível salvar a conta.', tipo: 'erro' }); return; }
      setToast({ message: 'Empresa atualizada!', tipo: 'sucesso' });
      setShowModal(false); setEditing(null); carregar();
    } else {
      let novaEmpresa: any = null;
      try {
        const resp = await api.post('/painel-admin/empresas', { ...payload, tipo: formDados.tipo, status: 'trial' });
        novaEmpresa = resp.data;
      }
      catch (err: any) { setToast({ message: err?.response?.data?.message || 'Não foi possível salvar a conta.', tipo: 'erro' }); return; }
      setShowModal(false);
      carregar();
      carregarAdmins();
      // Conta nasce sem administrador → oferece criar o primeiro admin agora ou depois.
      // Fallback (sem id no retorno): mantém o toast de criação simples.
      if (novaEmpresa?.id) {
        setSuccessConta({ id: novaEmpresa.id, nome: novaEmpresa.nome || formDados.nome });
      } else {
        setToast({ message: 'Empresa criada!', tipo: 'sucesso' });
      }
    }
  }

  async function suspender(id: string) {
    const e = empresas.find(emp => emp.id === id);
    if (!e) return;
    try { await api.put('/painel-admin/empresas/' + id, { status: e.status === 'suspenso' ? 'ativo' : 'suspenso' }); } catch { setToast({ message: 'Erro ao alterar status', tipo: 'erro' }); return; }
    setToast({ message: 'Status alterado!', tipo: 'sucesso' });
    carregar();
  }

  async function resetSenhaAdmin(empresaId: string, nomeEmpresa: string) {
    const nova = prompt(`Nova senha para o admin de "${nomeEmpresa}" (mín. 6 caracteres):`);
    if (!nova || nova.length < 6) return;
    try {
      // Busca o admin da empresa e reseta a senha
      const resp = await api.get(`/admin/usuarios?empresa_id=${empresaId}`);
      const admins = (resp.data || []).filter((u: any) => u.tipo === 'admin');
      if (admins.length === 0) { alert('Nenhum admin encontrado para esta empresa.'); return; }
      // Reseta a senha do primeiro admin
      await api.post(`/admin/usuarios/${admins[0].id}/reset-senha`, { nova_senha: nova });
      setToast({ message: `Senha do admin de "${nomeEmpresa}" resetada!`, tipo: 'sucesso' });
    } catch {
      setToast({ message: 'Erro ao resetar senha.', tipo: 'erro' });
    }
  }

  async function excluir() {
    if (!deleteTarget) return;
    try { await api.delete('/painel-admin/empresas/' + deleteTarget.id); } catch { setToast({ message: 'Erro ao excluir', tipo: 'erro' }); return; }
    setToast({ message: 'Empresa excluída!', tipo: 'sucesso' });
    setDeleteTarget(null); carregar(); carregarAdmins();
  }

  // Prorroga/libera trial via endpoint dedicado. body = { dias: 7|15 } ou { trial_ends_at: 'YYYY-MM-DD' }.
  async function aplicarTrial(body: { dias?: number; trial_ends_at?: string }) {
    if (!trialTarget) return;
    try {
      const resp = await api.patch('/painel-admin/empresas/' + trialTarget.id + '/trial', body);
      setToast({ message: 'Trial atualizado até ' + formatData(resp.data?.trial_ends_at) + '!', tipo: 'sucesso' });
      setTrialTarget(null); setCustomDate(''); setConfirmAtivo(false); carregar();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao atualizar trial';
      setToast({ message: msg, tipo: 'erro' });
    }
  }

  // Abre o modal de prazo e carrega a extensão atual + faturas abertas.
  async function abrirPrazo(e: any) {
    setPrazoTarget(e); setPrazoInfo(null); setPrazoData(''); setPrazoMotivo(''); setPrazoLoading(true);
    try {
      const { data } = await api.get('/painel-admin/empresas/' + e.id + '/prazo-suspensao');
      setPrazoInfo(data);
    } catch (err: any) {
      setToast({ message: err?.response?.data?.message || 'Erro ao carregar prazo', tipo: 'erro' });
    } finally { setPrazoLoading(false); }
  }

  // Concede/atualiza a extensão. Motivo obrigatório; data futura.
  async function concederPrazo() {
    if (!prazoTarget) return;
    try {
      await api.patch('/painel-admin/empresas/' + prazoTarget.id + '/prazo-suspensao', { prazo_ate: prazoData, motivo: prazoMotivo.trim() });
      setToast({ message: 'Prazo concedido até ' + formatDia(prazoData) + '!', tipo: 'sucesso' });
      setPrazoTarget(null); carregar();
    } catch (err: any) {
      setToast({ message: err?.response?.data?.message || 'Erro ao conceder prazo', tipo: 'erro' });
    }
  }

  // Remove a extensão (mantém a trilha no backend).
  async function removerPrazo() {
    if (!prazoTarget) return;
    try {
      await api.delete('/painel-admin/empresas/' + prazoTarget.id + '/prazo-suspensao');
      setToast({ message: 'Prazo removido.', tipo: 'sucesso' });
      setPrazoTarget(null); carregar();
    } catch (err: any) {
      setToast({ message: err?.response?.data?.message || 'Erro ao remover prazo', tipo: 'erro' });
    }
  }

  async function abrirContratacao(e: EmpresaContratacao) {
    setContratacaoTarget(e);
    setContratacaoDados(null);
    setContratacaoLoading(true);
    try {
      const { data } = await api.get('/painel-admin/empresas/' + e.id + '/contratacao');
      setContratacaoDados(data);
    } catch (err: unknown) {
      setToast({ message: mensagemApi(err, 'Erro ao carregar contratação.'), tipo: 'erro' });
    } finally {
      setContratacaoLoading(false);
    }
  }

  async function uploadContratoAssinado(file: File) {
    const contrato = contratoPrincipal(contratacaoDados?.propostas?.[0]);
    if (!contratacaoTarget || !contrato) return;
    const form = new FormData();
    form.append('arquivo', file);
    setContratacaoEnviando(true);
    try {
      await api.post(`/painel-admin/empresas/${contratacaoTarget.id}/contratos/${contrato.id}/upload-assinado`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setToast({ message: 'Contrato assinado recebido.', tipo: 'sucesso' });
      await abrirContratacao(contratacaoTarget);
    } catch (err: unknown) {
      setToast({ message: mensagemApi(err, 'Erro ao enviar contrato.'), tipo: 'erro' });
    } finally {
      setContratacaoEnviando(false);
    }
  }

  async function aceitarContratoManual() {
    const contrato = contratoPrincipal(contratacaoDados?.propostas?.[0]);
    if (!contratacaoTarget || !contrato) return;
    setContratacaoEnviando(true);
    try {
      await api.post(`/painel-admin/empresas/${contratacaoTarget.id}/contratos/${contrato.id}/aceitar-manual`);
      setToast({ message: 'Aceite manual registrado.', tipo: 'sucesso' });
      await abrirContratacao(contratacaoTarget);
    } catch (err: unknown) {
      setToast({ message: mensagemApi(err, 'Erro ao registrar aceite.'), tipo: 'erro' });
    } finally {
      setContratacaoEnviando(false);
    }
  }

  async function abrirContratoAssinadoAdmin() {
    const contrato = contratoPrincipal(contratacaoDados?.propostas?.[0]);
    if (!contratacaoTarget || !contrato) return;
    setContratacaoEnviando(true);
    try {
      const { data } = await api.get(`/painel-admin/empresas/${contratacaoTarget.id}/contratos/${contrato.id}/assinado-url`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      setToast({ message: mensagemApi(err, 'Contrato assinado ainda não disponível.'), tipo: 'erro' });
    } finally {
      setContratacaoEnviando(false);
    }
  }

  const filtered = empresas.filter(e => {
    const porBusca = (e.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) || (e.cnpj || '').includes(searchTerm);
    // 'autonomos' → só tipo autonomo; 'empresas' → todo o resto (transportadora, fazenda etc).
    const porTipo = tipoFiltro === 'todos' || (tipoFiltro === 'autonomos' ? e.tipo === 'autonomo' : e.tipo !== 'autonomo');
    return porBusca && porTipo;
  });

  // Opções do <select> de plano: apenas planos ativos. Ao editar, se o plano
  // atual estiver inativo (ou sumido do catálogo), injeta a opção corrente
  // marcada como "(inativo)" para aparecer selecionada e não zerar ao salvar.
  const isAutonomo = formDados.tipo === 'autonomo';
  // Plano precisa casar com o público-alvo da conta: autônomo vê planos
  // autonomo/ambos; empresa/transportadora vê empresa/ambos. Filtro por
  // categoria (nunca por nome); categoria ausente conta como 'ambos'.
  const categoriasPermitidas = isAutonomo ? ['autonomo', 'ambos'] : ['empresa', 'ambos'];
  const planosAtivos = planos.filter((p: any) =>
    p.ativo !== false && categoriasPermitidas.includes(String(p.categoria || 'ambos')));
  let opcoesPlano: any[] = planosAtivos;
  const planoAtualId = formDados.plano_id;
  // Documento da conta é condicional ao tipo: autônomo usa CPF, empresa usa CNPJ.
  // O campo técnico continua sendo `empresas.cnpj` (nenhuma mudança de backend/schema).
  const documentLabel = isAutonomo ? 'CPF' : 'CNPJ';
  const documentMask = isAutonomo ? maskCPF : maskCNPJ;
  if (planoAtualId && !planosAtivos.some((p: any) => p.id === planoAtualId)) {
    const doCatalogo = planos.find((p: any) => p.id === planoAtualId);
    const atual = doCatalogo
      ? { ...doCatalogo, ativo: false }
      : { id: planoAtualId, nome: editing?.planos?.nome || 'Plano atual', preco_mensal: editing?.planos?.preco_mensal || 0, ativo: false };
    opcoesPlano = [atual, ...planosAtivos];
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center space-x-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold ${toast.tipo === 'sucesso' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.tipo === 'sucesso' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} title="Fechar" aria-label="Fechar notificação" className="ml-1 p-0.5 rounded-full hover:bg-white/20"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center space-x-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="bg-gray-800 p-2 rounded-lg text-white"><Shield size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Empresas e Autônomos</h1>
          <p className="text-sm text-gray-500">Contas da plataforma. Pessoas com acesso são geridas separadamente em Usuários.</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="bg-white p-2.5 rounded-xl shadow-sm border border-gray-100 flex items-center flex-1 min-w-[180px] max-w-md">
            <Search size={18} className="text-gray-400 mr-2 flex-shrink-0" />
            <input type="text" placeholder="Buscar por nome ou CNPJ..." className="flex-1 outline-none text-gray-700 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 shadow-sm">
            <option value="todos">Todos os tipos</option>
            <option value="empresas">Empresas</option>
            <option value="autonomos">Autônomos</option>
          </select>
          <button
            onClick={() => setShowArchived(v => !v)}
            title={showArchived ? 'Ocultar contas arquivadas' : 'Mostrar contas arquivadas'}
            className={`flex items-center gap-1.5 border rounded-xl px-3 py-2.5 text-sm font-medium shadow-sm ${showArchived ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <Archive size={16} /> {showArchived ? 'Ocultando operação' : 'Mostrar arquivadas'}
          </button>
        </div>
        <button onClick={() => { setEditing(null); setFormDados({ nome: '', cnpj: '', email: '', telefone: '', plano_id: '', tipo: 'transportadora' }); setShowModal(true); }} className="flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 active:scale-95"><Plus size={18} className="mr-1.5" /> Nova Conta</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
              <th className="px-4 py-2.5 border-b">Conta</th><th className="px-4 py-2.5 border-b">Documento</th><th className="px-4 py-2.5 border-b">Plano</th><th className="px-4 py-2.5 border-b">Assinatura</th><th className="px-4 py-2.5 border-b">Status</th><th className="px-4 py-2.5 border-b text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(e => (
              <tr key={e.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5">
                  <p className="font-bold text-gray-800">{e.nome}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{e.tipo === 'autonomo' ? 'Autônomo' : 'Empresa'}</p>
                  <div className="mt-1">
                    {adminCountsErro ? (
                      // Consulta falhou → aviso neutro; NUNCA marcar como "Sem administrador".
                      <span className="text-[10px] font-semibold text-gray-300">Administradores indisponível</span>
                    ) : (adminCountsLoading || adminCounts === null) ? (
                      // Skeleton enquanto a contagem não termina.
                      <span className="inline-block h-3 w-24 rounded bg-gray-100 animate-pulse align-middle" />
                    ) : ((adminCounts[e.id] || 0) === 0) ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-red-500">Sem administrador</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-gray-500">
                        {adminCounts[e.id]} {adminCounts[e.id] === 1 ? 'administrador' : 'administradores'}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{e.cnpj || '—'}</td>
                <td className="px-4 py-2.5"><span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-700">{e.planos?.nome || e.plano_id || '-'}</span></td>
                <td className="px-4 py-2.5">
                  {(() => {
                    const { label, tone } = estadoAssinatura(e);
                    return (
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${TONE_CLASSES[tone] || TONE_CLASSES.neutral}`}>
                        {label}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${e.status === 'ativo' ? 'bg-green-50 text-green-700' : e.status === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{e.status}</span>
                  {e.arquivada_em && (
                    <span className="ml-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-600" title={`Arquivada em ${formatData(e.arquivada_em)}`}>Arquivada</span>
                  )}
                  <div className="mt-1 text-[10px] font-semibold">
                    {e.trial_ends_at
                      ? (trialVencido(e.trial_ends_at)
                          ? <span className="text-red-500">Trial vencido</span>
                          : <span className="text-amber-600">Trial até {formatData(e.trial_ends_at)}</span>)
                      : <span className="text-gray-300">Sem trial definido</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => { setEditing(e); setFormDados({ nome: e.nome || '', cnpj: e.cnpj || '', email: e.email_contato || '', telefone: e.telefone_contato || '', plano_id: e.plano_id || '', tipo: e.tipo || 'transportadora' }); setQcValue(e.quantidade_contratada != null ? String(e.quantidade_contratada) : ''); setQcPreview(null); setQcMsg(''); setShowModal(true); }} title="Editar empresa" aria-label="Editar empresa" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                    <button onClick={() => suspender(e.id)} title={e.status === 'suspenso' ? 'Reativar empresa' : 'Suspender empresa'} aria-label={e.status === 'suspenso' ? 'Reativar empresa' : 'Suspender empresa'} className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg">{e.status === 'suspenso' ? <Unlock size={16} /> : <Ban size={16} />}</button>
                    <button onClick={() => { setTrialTarget(e); setCustomDate(''); setConfirmAtivo(false); }} title="Gerenciar trial" aria-label="Gerenciar trial da empresa" className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"><CalendarClock size={16} /></button>
                    <button onClick={() => abrirPrazo(e)} title="Prazo de suspensão (inadimplência)" aria-label="Conceder prazo de suspensão por inadimplência" className={`p-1.5 rounded-lg ${e.suspensao_prazo_ate ? 'text-indigo-600 hover:bg-indigo-50' : 'text-slate-500 hover:bg-slate-100'}`}><ShieldAlert size={16} /></button>
                    <button onClick={() => resetSenhaAdmin(e.id, e.nome)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="Resetar senha do admin" aria-label="Resetar senha do admin"><KeyRound size={16} /></button>
                    <button onClick={() => abrirContratacao(e)} className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg" title="Contratação comercial" aria-label="Abrir contratação comercial"><FileText size={16} /></button>
                    <button onClick={() => { setArchiveTarget(e); setArchiveMotivo(''); }} title={e.arquivada_em ? 'Restaurar conta' : 'Arquivar conta (tira da operação, mantém histórico)'} aria-label={e.arquivada_em ? 'Restaurar conta' : 'Arquivar conta'} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg">{e.arquivada_em ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
                    <button onClick={() => setDeleteTarget(e)} title="Excluir empresa" aria-label="Excluir empresa" className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                    {(() => {
                      const { showAction } = estadoAssinatura(e);
                      if (!showAction) return null;
                      return (
                        <button
                          onClick={() => setAssinaturaTarget(e)}
                          disabled={assinaturaEnviando}
                          title="Configurar assinatura sandbox (piloto)"
                          aria-label="Configurar assinatura sandbox"
                          className="p-1.5 text-green-700 hover:bg-green-50 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <CreditCard size={16} />
                        </button>
                      );
                    })()}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhuma empresa</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-800">{editing ? 'Editar Conta' : 'Nova Conta'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Nome da conta</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.nome || ''} onChange={e => setFormDados({ ...formDados, nome: e.target.value })} />
              </div>
              {/* Tipo vem ANTES do documento: define se o campo seguinte é CPF ou CNPJ. */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo de conta</label>
                <select disabled={!!editing} className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50 disabled:text-gray-400" value={formDados.tipo} onChange={e => {
                  // Ao trocar o tipo, reaplica a máscara correspondente sobre os dígitos
                  // já digitados (as máscaras extraem os dígitos internamente). Não apaga o valor.
                  // Zera o plano: as categorias elegíveis mudam com o tipo (empresa x autônomo).
                  const novoTipo = e.target.value;
                  const novaMask = novoTipo === 'autonomo' ? maskCPF : maskCNPJ;
                  setFormDados({ ...formDados, tipo: novoTipo, cnpj: novaMask(formDados.cnpj), plano_id: '' });
                }}>
                  <option value="transportadora">Empresa / Transportadora</option>
                  <option value="autonomo">Autônomo</option>
                </select>
                {!editing && formDados.tipo === 'autonomo' && <p className="text-xs text-emerald-700 mt-1">Depois de criar a conta, adicione a pessoa responsável em Usuários.</p>}
                {editing && <p className="text-xs text-gray-400 mt-1">O tipo da conta não pode ser alterado após a criação neste momento.</p>}
              </div>
              {/* Documento da conta: rótulo e máscara condicionais ao tipo (campo técnico segue empresas.cnpj). */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">{documentLabel}</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.cnpj || ''} onChange={e => setFormDados({ ...formDados, cnpj: documentMask(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">E-mail de contato da conta</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.email || ''} onChange={e => setFormDados({ ...formDados, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Telefone de contato da conta</label>
                <input type="text" className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.telefone || ''} onChange={e => setFormDados({ ...formDados, telefone: maskPhone(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Plano</label>
                {planosLoading ? (
                  <div className="w-full border-2 border-gray-50 rounded-xl p-3 bg-gray-50/50 text-sm text-gray-400">Carregando planos…</div>
                ) : planosErro ? (
                  <div className="w-full border-2 border-red-100 rounded-xl p-3 bg-red-50/50 text-sm text-red-600">
                    Não foi possível carregar os planos.{' '}
                    <button type="button" onClick={carregarPlanos} className="underline font-semibold">Tentar novamente</button>
                  </div>
                ) : (
                  <>
                    <select className="w-full border-2 border-gray-50 rounded-xl p-3 outline-none focus:border-blue-500 bg-gray-50/50" value={formDados.plano_id} onChange={e => setFormDados({ ...formDados, plano_id: e.target.value })}>
                      <option value="">Sem plano</option>
                      {opcoesPlano.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.nome} — R$ {Number(p.preco_mensal || 0).toFixed(2)}{p.ativo === false ? ' (inativo)' : ''}</option>
                      ))}
                    </select>
                    {planos.length === 0 && <p className="text-xs text-amber-600 mt-1">Nenhum plano cadastrado. A conta ficará sem plano.</p>}
                  </>
                )}
              </div>

              {/* Capacidade contratada (extras por empresa) — só ao editar empresa com plano */}
              {editing && formDados.tipo !== 'autonomo' && formDados.plano_id && (
                <div className="border-2 border-blue-50 rounded-xl p-3 bg-blue-50/30">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Capacidade contratada (motoristas/caminhões)</label>
                  <p className="text-xs text-gray-500 mb-2">Cobrança por capacidade contratada (não por motoristas ativos). Extras acima da capacidade inclusa do plano.</p>
                  <div className="flex gap-2">
                    <input type="number" min="1" value={qcValue} onChange={e => { setQcValue(e.target.value); setQcPreview(null); }} className="w-28 border-2 border-gray-100 rounded-xl p-2.5 outline-none focus:border-blue-500" />
                    <button type="button" onClick={previewQuantidade} disabled={qcLoading} className="px-3 py-2 border border-gray-300 rounded-xl text-sm font-medium disabled:opacity-50">Prévia</button>
                    <button type="button" onClick={aplicarQuantidade} disabled={qcLoading} className="px-3 py-2 bg-green-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">Aplicar</button>
                  </div>
                  {qcPreview && (
                    <div className="mt-2 text-sm text-gray-700 space-y-0.5">
                      <div>Base: <b>R$ {Number(qcPreview.valor_base ?? 0).toFixed(2)}</b> (inclui {qcPreview.capacidade_inclusa})</div>
                      {qcPreview.quantidade_extra > 0 && <div>Extras: {qcPreview.quantidade_extra} × → <b>R$ {Number(qcPreview.valor_extra ?? 0).toFixed(2)}</b></div>}
                      <div>Total mensal: <b className="text-green-800">R$ {qcPreview.valor_depois != null ? Number(qcPreview.valor_depois).toFixed(2) : '—'}</b>{qcPreview.valor_antes != null && qcPreview.valor_antes !== qcPreview.valor_depois && <span className="text-gray-400"> (antes R$ {Number(qcPreview.valor_antes).toFixed(2)})</span>}</div>
                      {qcPreview.requer_negociacao && <div className="text-amber-700 font-medium">Acima de 40 → sob negociação.</div>}
                      {qcPreview.recomendacao_upgrade && <div className="mt-1 rounded-lg bg-amber-50 border border-amber-200 p-2 text-amber-800 text-xs">{qcPreview.mensagem_upgrade || `Com essa quantidade, o plano ${qcPreview.plano_recomendado_nome} fica mais vantajoso.`}{qcPreview.economia_upgrade > 0 && ` (economia R$ ${Number(qcPreview.economia_upgrade).toFixed(2)}/mês)`}</div>}
                    </div>
                  )}
                  {qcMsg && <p className="mt-2 text-xs text-gray-600">{qcMsg}</p>}
                </div>
              )}
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Cancelar</button>
              <button onClick={handleSalvar} className="flex items-center px-5 py-2 bg-green-700 text-white rounded-lg font-medium text-sm hover:bg-green-800"><Check size={16} className="mr-1.5" /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center"><AlertTriangle size={32} className="text-red-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Excluir Empresa</h3>
              <p className="text-gray-500">Remover <strong className="text-gray-800">{deleteTarget.nome}</strong>?</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl">Cancelar</button>
              <button onClick={excluir} className="flex items-center px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow hover:bg-red-700"><Trash2 size={18} className="mr-2" /> Excluir</button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                  {archiveTarget.arquivada_em ? <ArchiveRestore size={30} className="text-slate-600" /> : <Archive size={30} className="text-slate-600" />}
                </div>
                <h3 className="text-xl font-bold text-gray-800">{archiveTarget.arquivada_em ? 'Restaurar conta' : 'Arquivar conta'}</h3>
                <p className="text-gray-500 text-sm">
                  <strong className="text-gray-800">{archiveTarget.nome}</strong>
                </p>
              </div>
              {archiveTarget.arquivada_em ? (
                <p className="text-sm text-gray-600 bg-slate-50 rounded-xl p-3">
                  Traz a conta de volta para a operação e para a listagem padrão. Nenhum dado foi perdido.
                </p>
              ) : (
                <>
                  <div className="text-sm text-gray-600 bg-amber-50/60 border border-amber-100 rounded-xl p-3 space-y-1">
                    <p><strong>Não apaga nada.</strong> Faturas e histórico permanecem.</p>
                    <p>Tira a conta da operação: some da listagem padrão, dos jobs de cobrança/trial e do escrutínio do billing-health.</p>
                    <p>É reversível a qualquer momento (Restaurar).</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-gray-400 mb-1">Motivo (opcional)</label>
                    <input
                      type="text" value={archiveMotivo} onChange={ev => setArchiveMotivo(ev.target.value)}
                      placeholder="ex.: conta de teste"
                      className="w-full border-2 border-gray-100 rounded-xl p-2.5 outline-none focus:border-slate-400 bg-gray-50/50 text-sm"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => { setArchiveTarget(null); setArchiveMotivo(''); }} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl">Cancelar</button>
              <button onClick={confirmarArquivar} className="flex items-center px-6 py-2.5 bg-slate-700 text-white font-bold rounded-xl shadow hover:bg-slate-800">
                {archiveTarget.arquivada_em ? <><ArchiveRestore size={18} className="mr-2" /> Restaurar</> : <><Archive size={18} className="mr-2" /> Arquivar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {contratacaoTarget && (() => {
        const proposta = contratacaoDados?.propostas?.[0] || null;
        const contrato = contratoPrincipal(proposta);
        const resumo = proposta?.resumo || {};
        const signatarios = contratacaoDados?.signatarios || [];
        const eventos = contratacaoDados?.eventos || [];
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Contratação comercial</h3>
                  <p className="text-sm text-gray-500">{contratacaoTarget.nome}</p>
                </div>
                <button onClick={() => { setContratacaoTarget(null); setContratacaoDados(null); }} className="p-2 hover:bg-gray-200 rounded-full" title="Fechar" aria-label="Fechar"><X size={22} /></button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                {contratacaoLoading ? (
                  <p className="text-sm text-gray-500">Carregando contratação...</p>
                ) : !proposta ? (
                  <p className="text-sm text-gray-600 bg-amber-50 border border-amber-100 rounded-xl p-3">Nenhuma proposta comercial encontrada para esta conta.</p>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs uppercase font-bold text-gray-400">Proposta</p>
                        <p className="font-semibold text-gray-800">{proposta.status}</p>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs uppercase font-bold text-gray-400">Contrato</p>
                        <p className="font-semibold text-gray-800">{contrato?.status || 'em preparação'}</p>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs uppercase font-bold text-gray-400">Implantação</p>
                        <p className="font-semibold text-gray-800">{resumo.implantacao_gratis ? 'Grátis' : `R$ ${Number(resumo.valor_implantacao || 0).toFixed(2).replace('.', ',')}`}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-100 p-4">
                      <h4 className="font-bold text-gray-800 mb-2">Resumo comercial</h4>
                      <div className="grid sm:grid-cols-2 gap-2 text-sm text-gray-600">
                        <p><strong>Plano:</strong> {resumo.plano_nome || '-'}</p>
                        <p><strong>Quantidade:</strong> {resumo.quantidade_contratada || '-'} motorista(s)</p>
                        <p><strong>Capacidade incluída:</strong> {resumo.capacidade_inclusa || '-'} motorista(s)</p>
                        <p><strong>Mensalidade:</strong> R$ {Number(resumo.valor_mensal || 0).toFixed(2).replace('.', ',')}</p>
                        <p><strong>Total inicial:</strong> R$ {Number(resumo.total_inicial || 0).toFixed(2).replace('.', ',')}</p>
                        <p><strong>Teste grátis:</strong> {resumo.trial_dias || 0} dias</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-100 p-4">
                      <h4 className="font-bold text-gray-800 mb-2">Signatários e eventos</h4>
                      <div className="grid sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-xs uppercase font-bold text-gray-400 mb-1">Signatários</p>
                          {signatarios.length === 0 ? <p className="text-gray-400">Nenhum registro.</p> : signatarios.map((s: SignatarioContratacao) => (
                            <p key={s.id} className="text-gray-700">{s.papel}: <strong>{s.status}</strong></p>
                          ))}
                        </div>
                        <div>
                          <p className="text-xs uppercase font-bold text-gray-400 mb-1">Eventos</p>
                          {eventos.length === 0 ? <p className="text-gray-400">Nenhum evento.</p> : eventos.slice(0, 5).map((ev: EventoContratacao) => (
                            <p key={ev.id} className="text-gray-700">{ev.tipo}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="p-4 bg-gray-50 border-t flex flex-wrap justify-end gap-2">
                <label className={`px-4 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 ${(!contrato || contratacaoEnviando) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  Enviar PDF assinado
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    disabled={!contrato || contratacaoEnviando}
                    onChange={(ev) => {
                      const file = ev.target.files?.[0];
                      ev.currentTarget.value = '';
                      if (file) uploadContratoAssinado(file);
                    }}
                  />
                </label>
                <button disabled={!contrato?.signed_storage_path || contratacaoEnviando} onClick={abrirContratoAssinadoAdmin} className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-50">Baixar PDF</button>
                <button disabled={!contrato || contratacaoEnviando || contrato.status === 'aceito_manualmente'} onClick={aceitarContratoManual} className="px-4 py-2 rounded-lg text-sm font-medium bg-green-700 text-white hover:bg-green-800 disabled:opacity-50">
                  Registrar aceite manual
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {successConta && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center"><Check size={32} className="text-green-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Conta criada com sucesso.</h3>
              <p className="text-gray-500">Esta conta ainda não possui administrador. Deseja criar o primeiro administrador agora?</p>
              <p className="text-sm font-semibold text-gray-700">{successConta.nome}</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={() => setSuccessConta(null)} className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl">Criar depois</button>
              <button
                onClick={() => {
                  const conta = successConta;
                  setSuccessConta(null);
                  navigate(`/painel-administrativo/usuarios?empresa_id=${encodeURIComponent(conta.id)}&openCreate=true&source=empresa-created`);
                }}
                className="flex items-center px-6 py-2.5 bg-green-700 text-white font-bold rounded-xl shadow hover:bg-green-800"
              >
                <UserPlus size={18} className="mr-2" /> Criar administrador agora
              </button>
            </div>
          </div>
        </div>
      )}

      {assinaturaTarget && (() => {
        const { label } = estadoAssinatura(assinaturaTarget);
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="p-6 flex flex-col items-center text-center space-y-3">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center"><CreditCard size={32} className="text-amber-600" /></div>
                <h3 className="text-xl font-bold text-gray-800">Configurar assinatura sandbox</h3>
                <p className="text-gray-500 text-sm">Esta ação vai criar (ou conciliar) o cliente e a assinatura recorrente no Asaas para <strong>{assinaturaTarget.nome}</strong>.</p>
                <p className="text-xs text-gray-400">Estado atual: <span className="font-semibold">{label}</span></p>
                <p className="text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">Configuração de piloto no ambiente Asaas sandbox. O onboarding automático será fechado posteriormente — este não é o fluxo comercial final.</p>
              </div>
              <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
                <button onClick={() => setAssinaturaTarget(null)} disabled={assinaturaEnviando} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium disabled:opacity-40">Cancelar</button>
                <button
                  onClick={async () => {
                    setAssinaturaEnviando(true);
                    try {
                      const resp = await api.post('/pagamentos/assinaturas/' + assinaturaTarget.id + '/garantir');
                      setToast({ message: resp.data?.mensagem || 'Assinatura sandbox configurada.', tipo: 'sucesso' });
                      carregar();
                    } catch (err: any) {
                      const msg = err?.response?.data?.message || 'Erro ao configurar assinatura.';
                      setToast({ message: msg, tipo: 'erro' });
                    } finally {
                      setAssinaturaEnviando(false);
                      setAssinaturaTarget(null);
                    }
                  }}
                  disabled={assinaturaEnviando}
                  className="flex items-center px-5 py-2 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {assinaturaEnviando ? <>Carregando…</> : <>Configurar assinatura</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {trialTarget && (() => {
        const hojeStr = new Date().toISOString().slice(0, 10);
        const max90Str = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const bloqueado = trialTarget.status === 'ativo' && !confirmAtivo;
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="p-6 border-b flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><CalendarClock size={20} className="text-amber-600" /> Trial · {trialTarget.nome}</h3>
                <button onClick={() => setTrialTarget(null)} title="Fechar" aria-label="Fechar" className="p-2 hover:bg-gray-200 rounded-full"><X size={22} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="text-sm text-gray-600">
                  Status atual: <span className="font-bold">{trialTarget.status}</span><br />
                  {trialTarget.trial_ends_at
                    ? (trialVencido(trialTarget.trial_ends_at)
                        ? <>Trial <span className="font-bold text-red-600">vencido</span> em {formatData(trialTarget.trial_ends_at)}</>
                        : <>Trial até <span className="font-bold text-amber-600">{formatData(trialTarget.trial_ends_at)}</span></>)
                    : <span className="text-gray-400">Sem trial definido</span>}
                </div>

                {trialTarget.status === 'ativo' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                      <span>Esta empresa está <strong>ATIVA</strong>. Liberar trial vai alterar o status para <strong>trial</strong>.</span>
                    </div>
                    <label className="flex items-center gap-2 mt-2 cursor-pointer font-semibold">
                      <input type="checkbox" checked={confirmAtivo} onChange={ev => setConfirmAtivo(ev.target.checked)} />
                      <span>Confirmo liberar trial para esta empresa ativa</span>
                    </label>
                  </div>
                )}

                <div className="flex gap-2">
                  <button disabled={bloqueado} onClick={() => aplicarTrial({ dias: 7 })} title="Prorrogar trial por 7 dias" aria-label="Prorrogar trial por 7 dias" className="flex-1 px-3 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed">+7 dias</button>
                  <button disabled={bloqueado} onClick={() => aplicarTrial({ dias: 15 })} title="Prorrogar trial por 15 dias" aria-label="Prorrogar trial por 15 dias" className="flex-1 px-3 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed">+15 dias</button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5 ml-1">Data personalizada (máx. 90 dias)</label>
                  <div className="flex gap-2">
                    <input type="date" min={hojeStr} max={max90Str} value={customDate} onChange={ev => setCustomDate(ev.target.value)} className="flex-1 border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm" />
                    <button disabled={!customDate || bloqueado} onClick={() => aplicarTrial({ trial_ends_at: customDate })} title="Aplicar data personalizada de trial" aria-label="Aplicar data personalizada de trial" className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">Aplicar</button>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-gray-50 border-t flex justify-end">
                <button onClick={() => setTrialTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal — Prazo de suspensão (extensão manual por inadimplência) */}
      {prazoTarget && (() => {
        const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
        const min = amanha.toISOString().slice(0, 10);
        const max = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
        const ativa = prazoInfo?.extensao_ativa === true;
        const faturas = prazoInfo?.faturas_abertas || [];
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPrazoTarget(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={ev => ev.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><ShieldAlert size={20} className="text-indigo-600" /> Prazo de suspensão · {prazoTarget.nome}</h3>
                <button onClick={() => setPrazoTarget(null)} title="Fechar" aria-label="Fechar" className="p-2 hover:bg-gray-200 rounded-full"><X size={22} /></button>
              </div>
              <div className="p-5 space-y-4">
                {prazoLoading ? (
                  <p className="text-sm text-gray-500">Carregando...</p>
                ) : (
                  <>
                    {/* Extensão ativa */}
                    {ativa ? (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                        <div className="font-bold flex items-center gap-1.5"><Check size={15} /> Extensão ativa até {formatDia(prazoInfo.suspensao_prazo_ate)}</div>
                        {prazoInfo.suspensao_prazo_motivo && <div className="mt-1">Motivo: {prazoInfo.suspensao_prazo_motivo}</div>}
                        <p className="mt-1 text-xs text-blue-600">A empresa não será suspensa por inadimplência até esse prazo.</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">Sem extensão ativa. A suspensão automática segue a carência padrão (D+3 após o vencimento).</p>
                    )}

                    {/* Faturas abertas/vencidas */}
                    <div>
                      <div className="text-xs font-bold text-gray-400 uppercase mb-1.5">Faturas abertas/vencidas</div>
                      {faturas.length === 0 ? (
                        <p className="text-sm text-gray-500">Nenhuma fatura em aberto.</p>
                      ) : (
                        <ul className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-xl">
                          {faturas.map((f: any) => (
                            <li key={f.id} className="flex items-center justify-between px-3 py-2">
                              <span className={f.status === 'vencido' ? 'text-red-600 font-medium' : 'text-gray-700'}>{f.status} · venc. {formatDia(f.due_date)}</span>
                              <span className="font-semibold text-gray-800">R$ {Number(f.valor || 0).toFixed(2).replace('.', ',')}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Conceder / atualizar */}
                    <div className="border-t pt-4">
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">{ativa ? 'Atualizar prazo até' : 'Conceder prazo até'}</label>
                      <input type="date" min={min} max={max} value={prazoData} onChange={ev => setPrazoData(ev.target.value)} className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm mb-2" />
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Motivo (obrigatório)</label>
                      <textarea value={prazoMotivo} onChange={ev => setPrazoMotivo(ev.target.value)} rows={2} placeholder="Ex.: acordo comercial / falha bancária confirmada" className="w-full border-2 border-gray-50 rounded-xl p-2.5 outline-none focus:border-blue-500 bg-gray-50/50 text-sm" />
                    </div>
                  </>
                )}
              </div>
              <div className="p-4 bg-gray-50 border-t flex items-center justify-between gap-2">
                {ativa ? (
                  <button onClick={removerPrazo} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium">Remover prazo</button>
                ) : <span />}
                <div className="flex gap-2">
                  <button onClick={() => setPrazoTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm font-medium">Fechar</button>
                  <button disabled={!prazoData || !prazoMotivo.trim()} onClick={concederPrazo} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">{ativa ? 'Atualizar' : 'Conceder prazo'}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
