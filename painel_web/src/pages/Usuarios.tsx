import React, { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserPlus, Search, Shield, Phone, MapPin, Camera, X, Check, Trash2, AlertTriangle, Key, Copy, KeyRound, Eye, EyeOff, Edit3 } from 'lucide-react';
import api from '../api';
import { ErroCarregamento } from '../components/ErroCarregamento';
import { useCarregamento } from '../hooks/useCarregamento';
import { mensagemErro } from '../utils/mensagemErro';
import { maskPhone } from '../utils/masks';
import { useAuth } from '../contexts/AuthContext';
import { ModalFormulario, SecaoFormulario, Campo, CLASSE_INPUT, CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO, CLASSE_GRADE_2 } from '../components/ModalFormulario';
import { SeletorPerfilAcesso, useePerfisAcesso } from '../components/SeletorPerfilAcesso';
import { SeletorConta } from '../components/SeletorConta';
import { CampoCepEndereco } from '../components/CampoCepEndereco';

export const Usuarios: React.FC = () => {
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.uid || 'admin';

  // Mesma regra da Sidebar: super-admin passa; senão, permissão efetiva; e só cai
  // na classe de conta quando o backend ainda não mandou o efetivo.
  const podeAdministrarUsuarios = currentUser?.is_super_admin === true
    || (currentUser?.effective_permissions
      ? currentUser.effective_permissions['users.manage'] === true
      : currentUser?.role === 'admin');

  const podeVerPermissoes = currentUser?.is_super_admin === true
    || (currentUser?.effective_permissions
      ? currentUser.effective_permissions['permissions.manage'] === true
      : currentUser?.role === 'admin');

  // Carga da lista com estados distintos + AbortController + stale-guard + retry
  // (mesmo hook usado no Planos — cancelamento não vira erro; erro ≠ lista vazia).
  const { estado: estUsuarios, view: viewUsuarios, recarregar: loadUsuarios } = useCarregamento<any>(
    (signal) => api.get('/admin/usuarios', { signal }).then((r) => (r.data || []).map((u: any) => ({
      uid: u.id, nome: u.nome, email: u.email, celular: u.telefone || '', cep: u.cep || '',
      endereco: u.endereco || '', bairro: u.bairro || '', cidade: u.cidade || '', fotoUrl: u.foto_url || '',
      nivel: u.tipo || 'admin', empresaId: u.empresa_id || null,
      // Perfil de acesso é a AUTORIDADE; 'nivel'/'tipo' é só a classe da conta e
      // hoje vale 'admin' para todo usuário interno (D-069). Sem este campo a
      // lista chamaria de 'Administrador' até quem é Operador.
      perfilAcessoNome: u.perfil_acesso_nome || null,
      perfilAcessoId: u.permission_template_id || null,
      ajustesDeAcesso: Number(u.ajustes_de_acesso) || 0,
      empresaTipo: Array.isArray(u.empresas) ? u.empresas[0]?.tipo || null : u.empresas?.tipo || null,
      is_super_admin: !!u.is_super_admin,
      permissoes: u.permissoes || { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: false },
      status: u.status,
    }))),
    [],
    { pollingMs: 30000 }, // atualização automática a cada 30s (pausa oculto/offline/em-voo)
  );
  const usuarios = estUsuarios.dados || [];
  const loading = viewUsuarios.mostrarLoading;
  const erroCarga = viewUsuarios.mostrarErro ? viewUsuarios.mensagemErro : null;
  // Contadores só são "resultado" quando há dados confiáveis (resposta válida).
  // Durante loading inicial / erro sem dados anteriores, mostram "—" (nunca 0 falso).
  const contadoresConfiaveis = viewUsuarios.temDados;
  const [showModal, setShowModal] = useState(false);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState('todas');
  const [categoriaFiltro, setCategoriaFiltro] = useState<'todos' | 'admins' | 'vinculados' | 'autonomos' | 'superadmins' | 'outros'>('todos');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Perfil de acesso escolhido no modal. É o que decide o que a pessoa poderá
  // fazer — o antigo campo 'Nível' só sabia dizer 'Administrador'.
  const [perfilAcessoId, setPerfilAcessoId] = useState<string | null>(null);
  const [erroValidacao, setErroValidacao] = useState<Record<string, string>>({});
  // Gerado uma vez por abertura do modal: um duplo clique ou retry de rede
  // converge para o mesmo usuário em vez de criar dois.
  const clientRequestIdRef = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  // Estado para mostrar/ocultar senha no modal de reset.
  // Reseta ao fechar o modal (setResetUserId(null) + setMostrarSenhaReset(false)).
  const [mostrarSenhaReset, setMostrarSenhaReset] = useState(false);
  // Senha temporária gerada pelo backend, exibida UMA única vez (estado efêmero,
  // nunca localStorage/sessionStorage/log; some ao fechar o modal).
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null);
  const [senhaCopiada, setSenhaCopiada] = useState(false);

  // Tenta copiar via Clipboard API (moderna); falha → fallback execCommand (legado).
  // Falha total → alerta orientando seleção manual.
  const copiarSenha = async (senha: string) => {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha);
      setSenhaCopiada(true);
      return;
    } catch {
      // Clipboard API indisponível — tentar fallback
    }
    const el = document.createElement('textarea');
    try {
      el.value = senha;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      if (!document.execCommand('copy')) throw new Error('execCommand copy returned false');
      setSenhaCopiada(true);
    } catch {
      setSenhaCopiada(false);
      alert('Não foi possível copiar automaticamente. Selecione a senha manualmente.');
    } finally {
      if (el.parentNode) document.body.removeChild(el);
    }
  };

  // Super-admin pode selecionar empresa alvo (dropdown pesquisável)
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [empresasLoaded, setEmpresasLoaded] = useState(false);
  const [selectedEmpresaId, setSelectedEmpresaId] = useState('');
  // Os perfis são necessários na criação E na edição (TEAM-FUNC-01). A conta-alvo
  // manda: na edição é a empresa do usuário editado; na criação, a conta escolhida
  // pelo super-admin. Sem isso o super-admin veria os perfis da própria empresa.
  const empresaAlvoPerfis = editingUser
    ? (currentUser?.is_super_admin ? editingUser.empresaId : null)
    : (currentUser?.is_super_admin ? (selectedEmpresaId || null) : null);
  const { perfis, carregando: perfisCarregando, erro: perfisErro } = useePerfisAcesso(
    showModal && !somenteLeitura && (!currentUser?.is_super_admin || !!editingUser || !!selectedEmpresaId),
    empresaAlvoPerfis,
  );
  // Fluxo "criar administrador da conta" (deep-link vindo de Empresas): a conta
  // chega pré-selecionada e TRAVADA (read-only) para não ser trocada por acidente.
  const [contaTravada, setContaTravada] = useState(false);
  const [bannerConta, setBannerConta] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Garante que o deep-link é processado uma única vez por montagem (evita
  // reabrir o modal em re-render / refresh / voltar no histórico).
  const deepLinkRef = useRef(false);
  // Filtro por tipo dentro do combobox de conta (só afeta a lista do picker do modal,
  // não confundir com o filtro da listagem "Todas as contas").

  // Contas filtradas pela busca do seletor do super-admin.


  const [newUser, setNewUser] = useState({
    nome: '',
    email: '',
    senha: '',
    celular: '',
    cep: '',
    endereco: '',
    bairro: '',
    cidade: '',
    fotoUrl: '',
    nivel: 'admin',
    permissoes: {
      dashboard: true,
      motoristas: true,
      relatorios: true,
      usuarios: false,
      configuracoes: false
    }
  });

  useEffect(() => {
    // A lista de usuários é carregada pelo hook (auto-run). Aqui só a lista de
    // empresas para o seletor (best-effort).
    if (currentUser?.is_super_admin) {
      api.get('/painel-admin/empresas').then(res => {
        setEmpresas((res.data || []).map((e: any) => ({ id: e.id, nome: e.nome, tipo: e.tipo, plano: e.planos?.nome || null, status: e.status || null })));
      }).catch(() => {}).finally(() => setEmpresasLoaded(true));
    } else {
      setEmpresasLoaded(true);
    }
  }, []);

  // Deep-link "Criar administrador agora" (vindo de Empresas).
  // ?empresa_id=<id>&openCreate=true&source=empresa-created
  // - Só super-admin (o fluxo cria admin de uma conta arbitrária).
  // - Espera a lista de contas carregar para VALIDAR que a conta existe.
  // - Conta inexistente/param inválido → aviso seguro, NÃO abre o formulário vazio.
  // - Sempre limpa os params com replace (nunca reabre em refresh / voltar).
  useEffect(() => {
    if (deepLinkRef.current) return;
    if (searchParams.get('openCreate') !== 'true') return;
    if (!currentUser?.is_super_admin) return;
    if (!empresasLoaded) return; // aguarda a lista para validar a conta
    deepLinkRef.current = true;

    const empresaId = searchParams.get('empresa_id') || '';
    const source = searchParams.get('source') || '';
    const empresa = empresas.find(e => e.id === empresaId);

    // Limpa os params antes de qualquer coisa (replace → sem reabertura no refresh/voltar).
    setSearchParams({}, { replace: true });

    if (!empresaId || !empresa) {
      alert('Não foi possível abrir o cadastro: conta não encontrada.');
      return;
    }

    setEditingUser(null);
    setSomenteLeitura(false);
    setSelectedEmpresaId(empresa.id);
    setNewUser(prev => ({ ...prev, nivel: 'admin' }));
    if (source === 'empresa-created') {
      setContaTravada(true);
      setBannerConta(empresa.nome);
    }
    setShowModal(true);
  }, [empresasLoaded, searchParams, empresas, currentUser]);

  // O antigo dropdown de conta virou um seletor simples dentro do modal, então
  // não há mais overlay para fechar ao clicar fora.

  // Fecha o modal de usuário e zera o estado do fluxo "criar administrador da conta"
  // (evita que uma abertura manual posterior herde a conta travada/banner).
  const fecharModal = () => {
    setShowModal(false);
    setContaTravada(false);
    setBannerConta(null);
  };

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      if (editingUser) {
        const payload: any = {
          nome: editingUser.nome,
          telefone: editingUser.celular,
          cep: editingUser.cep,
          endereco: editingUser.endereco,
          bairro: editingUser.bairro,
          cidade: editingUser.cidade,
          foto_url: editingUser.fotoUrl,
          permissoes: editingUser.permissoes,
          status: editingUser.status || 'ativo'
        };

        // NÃO envia tipo na edição: o tipo é definido na criação e não deve ser
        // alterado por esta tela (evita promoção silenciosa de motorista para admin).

        // Super-admin edita dentro do contexto EXPLÍCITO da conta do usuário (§29).
        const paramsEdicao: any = {};
        if (currentUser?.is_super_admin && editingUser.empresaId) {
          paramsEdicao.empresa_id = editingUser.empresaId;
        }

        await api.put('/admin/usuarios/' + editingUser.uid, payload, { params: paramsEdicao });

        // TEAM-FUNC-01: troca de perfil é OUTRA autoridade e outro endpoint — o
        // canônico, que carrega a contenção, o invariante de último administrador
        // e a revogação de sessão. Nunca gravar o ponteiro direto daqui (§35).
        if (perfilAcessoId && perfilAcessoId !== editingUser.perfilAcessoId) {
          try {
            await api.put('/admin/usuarios/' + editingUser.uid + '/perfil-acesso',
              { perfil_acesso_id: perfilAcessoId }, { params: paramsEdicao });
          } catch (e: any) {
            // 409 = último administrador. A mensagem do servidor já diz o caminho;
            // mostrá-la junto do campo é melhor que um erro genérico de salvamento.
            const msg = e?.response?.data?.message
              || 'Não foi possível alterar o perfil de acesso.';
            setErroValidacao({ perfil: msg });
            setIsSubmitting(false);
            return;
          }
        }
      } else {
        // Validação inline, junto do campo (§58). `alert` interrompe e some com a
        // mensagem; o erro fica ao lado do que precisa ser corrigido.
        const erros: Record<string, string> = {};
        if (!newUser.nome.trim()) erros.nome = 'Informe o nome completo.';
        if (!newUser.email.trim()) erros.email = 'Informe o e-mail de acesso.';
        if (currentUser?.is_super_admin && !selectedEmpresaId) erros.conta = 'Selecione a conta do usuário.';
        if (!perfilAcessoId) erros.perfil = 'Escolha o perfil de acesso.';
        if (Object.keys(erros).length) { setErroValidacao(erros); setIsSubmitting(false); return; }
        setErroValidacao({});

        if (!clientRequestIdRef.current) {
          clientRequestIdRef.current = `usuario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        }
        const payload: any = {
          email: newUser.email,
          nome: newUser.nome,
          telefone: newUser.celular,
          cep: newUser.cep,
          endereco: newUser.endereco,
          bairro: newUser.bairro,
          cidade: newUser.cidade,
          foto_url: newUser.fotoUrl,
          permissoes: newUser.permissoes,
          // O perfil canônico é a autoridade; `tipo` deixou de ser enviado daqui.
          perfil_acesso_id: perfilAcessoId,
          client_request_id: clientRequestIdRef.current,
        };
        // Só envia senha se o admin digitou; vazio → backend gera senha aleatória.
        if (newUser.senha && newUser.senha.trim()) payload.senha = newUser.senha;
        const params: any = {};
        if (currentUser?.is_super_admin && selectedEmpresaId) params.empresa_id = selectedEmpresaId;
        const resp = await api.post('/admin/usuarios', payload, { params });
        // Senha gerada pelo backend → exibe one-time (admin não informou senha).
        if (resp?.data?.senha_temporaria_gerada) { setSenhaCopiada(false); setSenhaGerada(resp.data.senha_temporaria_gerada); }
      }
      await loadUsuarios();
      setShowModal(false);
      setEditingUser(null);
      setSelectedEmpresaId('');
        setContaTravada(false);
      setBannerConta(null);
      setPerfilAcessoId(null);
      setErroValidacao({});
          clientRequestIdRef.current = null;
      setNewUser({
        nome: '',
        email: '',
        senha: '',
        celular: '',
        cep: '',
        endereco: '',
        bairro: '',
        cidade: '',
        fotoUrl: '',
        nivel: 'admin',
        permissoes: { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: false }
      });
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('[Usuarios] salvar falhou', { status: error?.response?.status });
      // Só exibe a mensagem amigável do backend (err.response.data.message); nunca
      // error.message cru (pode conter detalhe técnico). Fallback genérico por ação.
      const msgFallback = editingUser ? 'Não foi possível salvar o usuário.' : 'Não foi possível criar o usuário.';
      alert(error.response?.data?.message || msgFallback);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await api.delete('/admin/usuarios/' + deleteTarget.uid);
      setDeleteTarget(null);
      await loadUsuarios();
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('[Usuarios] excluir falhou', { status: error?.response?.status });
      alert('Erro ao excluir: ' + mensagemErro(error, 'tente novamente.'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetSenha = async () => {
    if (!resetUserId) return;
    if (!novaSenha || novaSenha.length < 6) {
      alert('Senha deve ter pelo menos 6 caracteres.');
      return;
    }
    try {
      setIsResetting(true);
      await api.post(`/admin/usuarios/${resetUserId}/reset-senha`, { nova_senha: novaSenha });
      setResetMessage('Senha resetada com sucesso.');
      setResetUserId(null);
      setNovaSenha('');
      setMostrarSenhaReset(false);
      await loadUsuarios();
    } catch (err: any) {
      if (import.meta.env.DEV) console.error('[Usuarios] resetar senha falhou', { status: err?.response?.status });
      alert('Erro ao resetar senha: ' + mensagemErro(err, 'tente novamente.'));
    } finally {
      setIsResetting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        if (editingUser) {
          setEditingUser({ ...editingUser, fotoUrl: base64String });
        } else {
          setNewUser({ ...newUser, fotoUrl: base64String });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const getTipoLabel = (user: any) => {
    if (user.is_super_admin) return 'Super-admin';
    if (user.nivel === 'motorista' && user.empresaTipo === 'autonomo') return 'Motorista autônomo';
    if (user.nivel === 'motorista') return 'Motorista vinculado';
    if (user.nivel === 'admin') return 'Administrador';
    return user.nivel ? `${user.nivel.charAt(0).toUpperCase()}${user.nivel.slice(1)}` : 'Usuário';
  };

  const getEmpresaLabel = (user: any) => {
    if (user.is_super_admin) return 'Plataforma';
    return empresas.find(e => e.id === user.empresaId)?.nome || 'Conta não identificada';
  };

  // Rótulo humano do tipo da conta (nunca expõe valor cru/UUID).
  const tipoContaLabel = (tipo?: string) => (tipo === 'autonomo' ? 'Autônomo' : 'Empresa');

  // Linha de exibição de uma conta no picker: "Nome · Empresa/Autônomo · Plano".
  // Plano só entra se houver. Sem IDs internos.
  const formatContaLinha = (e: any) => [e?.nome, tipoContaLabel(e?.tipo), e?.plano].filter(Boolean).join(' · ');

  // Conta atual de um usuário (edição, somente leitura). Super-admin → Plataforma.
  const contaAtualLabel = (user: any) => {
    if (user?.is_super_admin) return 'Plataforma';
    const e = empresas.find(x => x.id === user?.empresaId);
    return e ? formatContaLinha(e) : 'Conta não identificada';
  };

  const getTipoBadgeClasses = (user: any) => {
    if (user.is_super_admin) return 'bg-yellow-100 text-yellow-800';
    if (user.nivel === 'motorista' && user.empresaTipo === 'autonomo') return 'bg-emerald-100 text-emerald-700';
    if (user.nivel === 'motorista') return 'bg-blue-100 text-blue-700';
    // Roxo é a cor de administrador. Como todo usuário interno tem
    // tipo='admin' (D-069), a cor precisa vir do PERFIL, não da classe da conta —
    // senão um Operador apareceria pintado de administrador.
    if (user.perfilAcessoNome) return /administrador/i.test(user.perfilAcessoNome) ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700';
    if (user.nivel === 'admin') return 'bg-purple-100 text-purple-700';
    return 'bg-gray-100 text-gray-700';
  };

  // Categoria do usuário para o filtro por grupos. Mesma ordem de prioridade de
  // getTipoLabel (super → autônomo → admin → motorista). 'outros' é fallback para
  // não esconder usuário legado/órfão (ex.: nivel 'operador').
  const getCategoriaUsuario = (user: any): 'admins' | 'vinculados' | 'autonomos' | 'superadmins' | 'outros' => {
    if (user.is_super_admin === true) return 'superadmins';
    if (user.empresaTipo === 'autonomo') return 'autonomos';
    if (user.nivel === 'admin') return 'admins';
    if (user.nivel === 'motorista') return 'vinculados';
    return 'outros';
  };

  // Estágio 1: busca por nome/email (base para os contadores).
  const buscados = usuarios.filter(u =>
    (u.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (empresaFiltro === 'todas' || u.empresaId === empresaFiltro)
  );

  // Contadores por categoria, sempre refletindo a busca atual.
  const contagem = {
    todos: buscados.length,
    admins: buscados.filter(u => getCategoriaUsuario(u) === 'admins').length,
    vinculados: buscados.filter(u => getCategoriaUsuario(u) === 'vinculados').length,
    autonomos: buscados.filter(u => getCategoriaUsuario(u) === 'autonomos').length,
    superadmins: buscados.filter(u => getCategoriaUsuario(u) === 'superadmins').length,
    outros: buscados.filter(u => getCategoriaUsuario(u) === 'outros').length,
  };

  // Estágio 2: aplica o filtro de categoria por cima da busca.
  const filtered = categoriaFiltro === 'todos'
    ? buscados
    : buscados.filter(u => getCategoriaUsuario(u) === categoriaFiltro);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Usuários {viewUsuarios.atualizando && <span className="ml-1 align-middle text-xs font-medium text-gray-400">Atualizando…</span>}</h2>
          <p className="text-sm text-gray-500">Pessoas que acessam o sistema, vinculadas às contas da plataforma</p>
        </div>
        <button
          onClick={() => { setEditingUser(null); setSomenteLeitura(false); setContaTravada(false); setBannerConta(null); setSelectedEmpresaId(''); setPerfilAcessoId(null); setShowModal(true); }}
          className="inline-flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm shadow-sm hover:bg-green-800 transition-all active:scale-95"
        >
          <UserPlus size={18} className="mr-2" /> Novo Usuário
        </button>
      </div>

      <div className={`bg-white p-3 rounded-xl shadow-sm border border-gray-100 grid grid-cols-1 gap-3 ${currentUser?.is_super_admin ? 'md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]' : ''}`}>
        <div className="flex items-center border border-gray-200 rounded-lg px-3">
          <Search className="text-gray-400 mr-2" size={18} />
          <input
            type="search"
            name="usuarios_busca_filtro"
            autoComplete="off"
            placeholder="Buscar por nome ou e-mail..."
            className="flex-1 py-2 outline-none text-gray-700 text-sm"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        {currentUser?.is_super_admin && (
          <select value={empresaFiltro} onChange={e => setEmpresaFiltro(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white">
            <option value="todas">Todas as contas</option>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}{e.tipo === 'autonomo' ? ' — Autônomo' : ''}</option>)}
          </select>
        )}
      </div>

      {/* Filtro por categoria (client-side, sobre a busca). Não altera /admin/usuarios. */}
      <div className="flex flex-wrap gap-2">
        {([
          ['todos', 'Todos'],
          ['admins', 'Empresas/Admins'],
          ['vinculados', 'Motoristas vinculados'],
          // Autônomos e Super Admins são conceitos de plataforma → só super-admin.
          ...(currentUser?.is_super_admin
            ? [['autonomos', 'Autônomos'] as const, ['superadmins', 'Super Admins'] as const]
            : []),
          ...(contagem.outros > 0 ? [['outros', 'Outros'] as const] : []),
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCategoriaFiltro(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              categoriaFiltro === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {label} <span className="opacity-70">({contadoresConfiaveis ? contagem[key] : '—'})</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <p className="p-8 text-center text-gray-500">Carregando usuários...</p>
          ) : erroCarga ? (
            <div className="p-4"><ErroCarregamento mensagem={erroCarga} onTentar={loadUsuarios} compacto /></div>
          ) : (
            <table className="w-full table-auto text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
                  <th className="p-3 border-b">Usuário</th>
                  <th className="p-3 border-b">Contato</th>
                  <th className="p-3 border-b">Perfil de acesso</th>
                  <th className="p-3 border-b">Status</th>
                  <th className="p-3 border-b text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhum usuário neste grupo.</td></tr>
                )}
                {filtered.map(user => (
                  <tr key={user.uid} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold overflow-hidden border border-blue-50">
                          {user.fotoUrl ? <img src={user.fotoUrl} alt="" className="w-full h-full object-cover" /> : user.nome?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-800 truncate">{user.nome}</p>
                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                          {currentUser?.is_super_admin && <p className="text-[10px] font-semibold text-gray-400 truncate">Conta: {getEmpresaLabel(user)}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-gray-700 flex items-center"><Phone size={14} className="mr-1.5 text-gray-400" /> {user.celular || '-'}</p>
                      <p className="text-[10px] text-gray-400 flex items-center mt-1">
                        <MapPin size={12} className="mr-1.5 flex-shrink-0" /> 
                        <span className="truncate max-w-[160px] block">
                          {user.cidade ? `${user.cidade} - ${user.endereco}` : (user.endereco || 'Sem endereço')}
                        </span>
                      </p>
                    </td>
                    <td className="p-3 align-top">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${getTipoBadgeClasses(user)}`}>
                        {user.perfilAcessoNome || getTipoLabel(user)}
                      </span>
                      {/* TEAM-UX-001: existir exceção individual é informação de gestão;
                          QUAL chave foi ajustada não é — isso vive na tela de permissões,
                          que tem outra autoridade. Qualifica o perfil, então fica junto
                          dele em vez de virar coluna própria. */}
                      {user.ajustesDeAcesso > 0 && (
                        <p className="mt-1 text-[10px] font-medium text-amber-700">
                          {user.ajustesDeAcesso === 1 ? '1 ajuste de acesso' : `${user.ajustesDeAcesso} ajustes de acesso`}
                        </p>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${user.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {user.status || 'ATIVO'}
                      </span>
                    </td>
                    <td className="p-3 text-right align-top">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setEditingUser(user); setPerfilAcessoId(user.perfilAcessoId || null); setSomenteLeitura(true); setShowModal(true); }}
                          className="inline-flex items-center text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
                          title="Ver"
                          aria-label="Ver usuário"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => { setEditingUser(user); setPerfilAcessoId(user.perfilAcessoId || null); setSomenteLeitura(false); setShowModal(true); }}
                          className="inline-flex items-center text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition-colors"
                          title="Editar"
                          aria-label="Editar usuário"
                        >
                          <Edit3 size={16} />
                        </button>
                        {(currentUser?.is_super_admin || user.nivel === 'motorista') && (
                          <button
                            onClick={() => setResetUserId(user.uid)}
                            className="inline-flex items-center text-orange-600 hover:bg-orange-50 px-2.5 py-1.5 rounded-lg font-bold text-sm transition-colors"
                            title="Resetar senha"
                            aria-label="Resetar senha"
                          >
                            <Key size={14} className="mr-1.5" /> Resetar Senha
                          </button>
                        )}
                        {user.uid !== currentUserId && (
                          <button
                            onClick={() => setDeleteTarget(user)}
                            className="inline-flex items-center text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                            title="Excluir"
                            aria-label="Excluir usuário"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* MODAL DE USUÁRIO — padrão UX_FORM_001 (FREIGHT_MODAL_PATTERN_V1).
          A primeira dobra responde ao que a tarefa realmente é: quem é a pessoa e
          que acesso ela terá. Foto e endereço, que antes ocupavam o topo e o meio
          do formulário, viraram "Informações adicionais", recolhido. */}
      <ModalFormulario
        aberto={showModal}
        titulo={somenteLeitura ? 'Dados do usuário' : editingUser ? 'Editar usuário' : 'Novo usuário'}
        icone={<Shield size={20} className="text-blue-600" />}
        aoFechar={fecharModal}
        largura="xl"
        rodape={(
          <>
            <button type="button" onClick={fecharModal} className={CLASSE_BOTAO_SECUNDARIO}>
              {somenteLeitura ? 'Fechar' : 'Cancelar'}
            </button>
            {/* TEAM-VIS-05: "Dados do usuário" continua sendo um modo de leitura,
                mas quem tem autoridade precisa sair dele sem fechar e reabrir por
                outro botão da lista. É a diferença entre poder corrigir o cadastro
                de um cliente e ter que explicar por telefone como ele se corrige. */}
            {somenteLeitura && podeAdministrarUsuarios && (
              <button
                type="button"
                onClick={() => setSomenteLeitura(false)}
                className={CLASSE_BOTAO_PRIMARIO}
              >
                Editar usuário
              </button>
            )}
            {!somenteLeitura && (
              <button type="button" onClick={handleSave} disabled={isSubmitting} className={CLASSE_BOTAO_PRIMARIO}>
                {isSubmitting ? 'Salvando…' : editingUser ? 'Salvar alterações' : 'Criar usuário'}
              </button>
            )}
          </>
        )}
      >
        <fieldset disabled={somenteLeitura} className="contents">
          {!editingUser && bannerConta && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
              <Shield size={16} className="flex-shrink-0" />
              <span>Criando usuário para: <strong>{bannerConta}</strong></span>
            </div>
          )}

          <div className={CLASSE_GRADE_2}>
            <Campo id="usuario-nome" rotulo="Nome completo" obrigatorio erro={erroValidacao.nome}>
              <input
                id="usuario-nome"
                className={CLASSE_INPUT}
                value={editingUser ? editingUser.nome : newUser.nome}
                onChange={e => editingUser
                  ? setEditingUser({ ...editingUser, nome: e.target.value })
                  : setNewUser({ ...newUser, nome: e.target.value })}
              />
            </Campo>
            <Campo
              id="usuario-email"
              rotulo="E-mail"
              obrigatorio={!editingUser}
              erro={erroValidacao.email}
              ajuda={editingUser ? 'O e-mail de acesso não é alterado por esta tela.' : undefined}
            >
              <input
                id="usuario-email"
                type="email"
                className={CLASSE_INPUT}
                value={editingUser ? editingUser.email : newUser.email}
                onChange={e => editingUser
                  ? setEditingUser({ ...editingUser, email: e.target.value })
                  : setNewUser({ ...newUser, email: e.target.value })}
                disabled={!!editingUser}
              />
            </Campo>
          </div>

          <div className={CLASSE_GRADE_2}>
            <Campo id="usuario-celular" rotulo="Celular">
              <input
                id="usuario-celular"
                className={CLASSE_INPUT}
                placeholder="(00) 0 0000-0000"
                value={editingUser ? editingUser.celular : newUser.celular}
                onChange={e => {
                  const masked = maskPhone(e.target.value);
                  editingUser
                    ? setEditingUser({ ...editingUser, celular: masked })
                    : setNewUser({ ...newUser, celular: masked });
                }}
              />
            </Campo>
            {editingUser && (
              <Campo id="usuario-status" rotulo="Status">
                <select
                  id="usuario-status"
                  className={CLASSE_INPUT}
                  value={editingUser.status}
                  onChange={e => setEditingUser({ ...editingUser, status: e.target.value })}
                >
                  <option value="ativo">Ativo</option>
                  <option value="bloqueado">Bloqueado</option>
                </select>
              </Campo>
            )}
          </div>

          {/* Conta-alvo do super-admin. Continua explícita e obrigatória: sem ela
              o backend recusa a criação, justamente para o usuário nunca nascer
              na empresa errada. Travada quando veio de um deep-link de criação. */}
          {currentUser?.is_super_admin && (editingUser || contaTravada) && (
            <Campo id="usuario-conta-vinculada" rotulo="Conta vinculada" ajuda="Definida na criação, para preservar o isolamento entre contas.">
              <input
                id="usuario-conta-vinculada"
                type="text"
                readOnly
                className={`${CLASSE_INPUT} bg-gray-100 text-gray-600`}
                value={editingUser
                  ? contaAtualLabel(editingUser)
                  : (empresas.find(e => e.id === selectedEmpresaId)?.nome || bannerConta || '')}
              />
            </Campo>
          )}

          {currentUser?.is_super_admin && !editingUser && !contaTravada && (
            <Campo rotulo="Conta" obrigatorio erro={erroValidacao.conta}
              ajuda="O usuário será criado dentro desta conta.">
              {/* TEAM-VIS-01: era um <select size={5}> com todas as contas
                  renderizadas embaixo da busca — uma parede que nunca fechava,
                  nem depois de escolher. Agora busca sob demanda e estado
                  selecionado com "Alterar conta" (§7). */}
              <SeletorConta
                contas={empresas}
                valor={selectedEmpresaId}
                carregando={!empresasLoaded}
                aoEscolher={(id) => {
                  setSelectedEmpresaId(id);
                  // §55: trocar de conta invalida o perfil escolhido — ele
                  // pertence à conta anterior. Nunca carregar template estrangeiro.
                  setPerfilAcessoId(null);
                  setErroValidacao(({ conta, perfil, ...r }) => r);
                }}
              />
            </Campo>
          )}

          {/* PERFIL DE ACESSO — o coração da tela. Substitui o campo "Nível", que
              só sabia oferecer "Administrador" e por isso transformava toda a
              equipe em administradores. */}
          {!editingUser ? (
            <Campo rotulo="Perfil de acesso" obrigatorio erro={erroValidacao.perfil}>
              <SeletorPerfilAcesso
                perfis={perfis}
                carregando={perfisCarregando}
                erro={perfisErro}
                valor={perfilAcessoId}
                podeEditarPermissoes={podeVerPermissoes}
                empresaId={currentUser?.is_super_admin ? selectedEmpresaId : null}
                aoEscolher={(id) => { setPerfilAcessoId(id); setErroValidacao(({ perfil, ...r }) => r); }}
              />
            </Campo>
          ) : (
            <Campo rotulo="Perfil de acesso" erro={erroValidacao.perfil}>
              {/* TEAM-FUNC-01: aqui havia um campo somente-leitura dizendo "use a
                  tela de Perfis e Permissões" — conselho errado, porque aquela tela
                  edita o que um perfil CONCEDE, não troca o perfil de uma pessoa. O
                  endpoint canônico já existia (`PUT /admin/usuarios/:id/perfil-acesso`,
                  com contenção, invariante de último administrador e revogação de
                  sessão); faltava a UI chamá-lo. */}
              <SeletorPerfilAcesso
                perfis={perfis}
                carregando={perfisCarregando}
                erro={perfisErro}
                valor={perfilAcessoId}
                podeEditarPermissoes={podeVerPermissoes}
                empresaId={editingUser.empresaId}
                aoEscolher={(id) => { setPerfilAcessoId(id); setErroValidacao(({ perfil, ...r }) => r); }}
              />
              {perfilAcessoId && perfilAcessoId !== editingUser.perfilAcessoId && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Ao salvar, o acesso muda imediatamente e as sessões abertas desta
                  pessoa são encerradas.
                </p>
              )}

              {/* TEAM-UX-001 §52: exceção individual é OUTRO conceito — não se
                  chama "editar perfil", e o detalhe vive na tela canônica. */}
              {editingUser.ajustesDeAcesso > 0 && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Esta pessoa tem{' '}
                  {editingUser.ajustesDeAcesso === 1
                    ? '1 ajuste individual de acesso'
                    : `${editingUser.ajustesDeAcesso} ajustes individuais de acesso`}
                  {' '}além do perfil.{' '}
                  {podeVerPermissoes && (
                    <Link to="/perfis-permissoes" className="font-semibold underline hover:text-amber-800">
                      Ver ajustes individuais de acesso
                    </Link>
                  )}
                </p>
              )}
            </Campo>
          )}

          {/* Opções de acesso — secundárias por decisão: o padrão é o sistema
              gerar a senha temporária, e não o administrador inventar uma. */}
          {!editingUser && (
            <SecaoFormulario
              titulo="Opções de acesso"
              descricao="Por padrão, o sistema gera uma senha temporária e a mostra uma única vez."
            >
              <Campo
                id="usuario-senha"
                rotulo="Senha temporária personalizada"
                ajuda="Deixe em branco para o sistema gerar automaticamente."
              >
                <input
                  id="usuario-senha"
                  type="text"
                  className={CLASSE_INPUT}
                  placeholder="Gerada automaticamente"
                  value={newUser.senha}
                  onChange={e => setNewUser({ ...newUser, senha: e.target.value })}
                />
              </Campo>
            </SecaoFormulario>
          )}

          {/* Informações adicionais — endereço e foto. Não são a tarefa de criar
              um acesso, então saem da primeira dobra (§53/§54). */}
          <SecaoFormulario
            titulo="Informações adicionais"
            descricao="Foto e endereço. Podem ser preenchidos depois."
          >
            <div className="flex items-center gap-3">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
              <div
                onClick={() => { if (!somenteLeitura) fileInputRef.current?.click(); }}
                className={`w-14 h-14 shrink-0 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 overflow-hidden ${somenteLeitura ? 'cursor-default' : 'hover:border-blue-400 cursor-pointer'}`}
              >
                {(editingUser?.fotoUrl || newUser.fotoUrl)
                  ? <img src={editingUser ? editingUser.fotoUrl : newUser.fotoUrl} alt="" className="w-full h-full object-cover" />
                  : <Camera size={20} />}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-700">Foto do usuário</p>
                {!somenteLeitura && (editingUser?.fotoUrl || newUser.fotoUrl) && (
                  <button
                    type="button"
                    onClick={() => editingUser
                      ? setEditingUser({ ...editingUser, fotoUrl: '' })
                      : setNewUser({ ...newUser, fotoUrl: '' })}
                    className="text-xs font-bold text-red-500 hover:underline"
                  >
                    Remover foto
                  </button>
                )}
              </div>
            </div>

            {/* TEAM-FUNC-03: um componente para os quatro formulários. O patch é
                aplicado com updater funcional de propósito — era exatamente o
                estado obsoleto do closure que apagava o CEP recém-digitado quando
                a consulta voltava. */}
            <CampoCepEndereco
              idPrefixo="usuario"
              desabilitado={somenteLeitura}
              valores={{
                cep: (editingUser ? editingUser.cep : newUser.cep) || '',
                endereco: (editingUser ? editingUser.endereco : newUser.endereco) || '',
                bairro: (editingUser ? editingUser.bairro : newUser.bairro) || '',
                cidade: (editingUser ? editingUser.cidade : newUser.cidade) || '',
              }}
              aoAlterar={(patch) => editingUser
                ? setEditingUser((prev: any) => ({ ...prev, ...patch }))
                : setNewUser((prev: any) => ({ ...prev, ...patch }))}
            />
          </SecaoFormulario>
        </fieldset>
      </ModalFormulario>

      {/* Modal de Confirmação de Exclusão */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle size={32} className="text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-800">Confirmar Exclusão</h3>
              <p className="text-gray-500">
                Tem certeza que deseja excluir o usuário <strong className="text-gray-800">{deleteTarget.nome}</strong>?
              </p>
              <p className="text-xs text-red-500 bg-red-50 p-3 rounded-xl w-full">
                ⚠️ Esta ação é irreversível. O usuário será removido do sistema e não poderá mais fazer login.
              </p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200 rounded-xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl shadow hover:bg-red-700 transition-all active:scale-95 flex items-center disabled:opacity-50"
              >
                <Trash2 size={18} className="mr-2" />
                {isDeleting ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Resetar Senha (admin p/ motoristas, super-admin p/ qualquer um) */}
      {resetUserId && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-lg font-bold">Resetar Senha do Usuário</h3>
              <button onClick={() => { setResetUserId(null); setNovaSenha(''); setResetMessage(''); setMostrarSenhaReset(false); }} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">Informe a nova senha para o usuário selecionado. A senha deve ter ao menos 6 caracteres.</p>
              <div className="relative">
                <input
                  type={mostrarSenhaReset ? 'text' : 'password'}
                  name="reset_usuario_nova_senha"
                  autoComplete="new-password"
                  value={novaSenha}
                  onChange={e => setNovaSenha(e.target.value)}
                  placeholder="Nova senha (mín. 6 caracteres)"
                  className="w-full border rounded px-3 py-2 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenhaReset(!mostrarSenhaReset)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1"
                  title={mostrarSenhaReset ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-label={mostrarSenhaReset ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {mostrarSenhaReset ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {resetMessage && <p className="text-sm text-green-600">{resetMessage}</p>}
            </div>
            <div className="p-4 bg-gray-50 flex justify-end space-x-2">
              <button onClick={() => { setResetUserId(null); setNovaSenha(''); setResetMessage(''); setMostrarSenhaReset(false); }} className="px-4 py-2 border rounded">Cancelar</button>
              <button onClick={handleResetSenha} disabled={isResetting} className="px-4 py-2 bg-orange-600 text-white rounded">{isResetting ? 'Processando...' : 'Confirmar Reset'}</button>
            </div>
          </div>
        </div>
      )}

      {senhaGerada && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 flex flex-col items-center text-center space-y-3">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center"><KeyRound size={32} className="text-amber-600" /></div>
              <h3 className="text-xl font-bold text-gray-800">Senha temporária</h3>
              <p className="text-sm text-gray-500">Copie esta senha agora e entregue ao usuário. <strong className="text-gray-700">Ela será exibida somente uma vez.</strong></p>
              <div className="w-full flex items-center gap-2 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-3">
                <code className="flex-1 text-lg font-mono font-bold text-gray-800 break-all select-all">{senhaGerada}</code>
                <button
                  onClick={() => copiarSenha(senhaGerada!)}
                  className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex-shrink-0"
                >
                  {senhaCopiada ? <><Check size={16} className="mr-1.5" /> Copiado</> : <><Copy size={16} className="mr-1.5" /> Copiar</>}
                </button>
              </div>
              <p className="text-xs text-gray-400">O usuário será obrigado a trocar a senha no primeiro acesso.</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end">
              <button onClick={() => { setSenhaGerada(null); setSenhaCopiada(false); }} className="px-6 py-2.5 bg-gray-800 text-white font-bold rounded-xl hover:bg-gray-900">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
