import React, { useState, useRef, useEffect } from 'react';
import { UserPlus, Search, Shield, Phone, MapPin, Camera, X, Check, Trash2, AlertTriangle, Loader2, Key, Copy, KeyRound, Eye, EyeOff, Edit3 } from 'lucide-react';
import api from '../api';
import { mensagemErro } from '../utils/mensagemErro';
import { maskPhone, maskCEP } from '../utils/masks';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

export const Usuarios: React.FC = () => {
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.uid || 'admin';

  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [somenteLeitura, setSomenteLeitura] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState('todas');
  const [categoriaFiltro, setCategoriaFiltro] = useState<'todos' | 'admins' | 'vinculados' | 'autonomos' | 'superadmins' | 'outros'>('todos');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetchingCep, setIsFetchingCep] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  // Estado para mostrar/ocultar senha no modal de reset.
  // Reseta ao fechar o modal (setResetUserId(null) + setMostrarSenhaReset(false)).
  const [mostrarSenhaReset, setMostrarSenhaReset] = useState(false);
  // Mostrar/ocultar a "Senha Provisória" do modal Novo Usuário (separado do reset).
  const [showSenhaNovoUsuario, setShowSenhaNovoUsuario] = useState(false);
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
  const [selectedEmpresaId, setSelectedEmpresaId] = useState('');
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [showEmpresaDropdown, setShowEmpresaDropdown] = useState(false);
  // Filtro por tipo dentro do combobox de conta (só afeta a lista do picker do modal,
  // não confundir com o filtro da listagem "Todas as contas").
  const [empresaTipoFiltro, setEmpresaTipoFiltro] = useState<'todas' | 'empresas' | 'autonomos'>('todas');
  const empresaDropdownRef = useRef<HTMLDivElement>(null);

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

  const loadUsuarios = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/usuarios');
      setUsuarios((response.data || []).map((u: any) => ({
        uid: u.id,
        nome: u.nome,
        email: u.email,
        celular: u.telefone || '',
        cep: u.cep || '',
        endereco: u.endereco || '',
        bairro: u.bairro || '',
        cidade: u.cidade || '',
        fotoUrl: u.foto_url || '',
        nivel: u.tipo || 'admin',
        empresaId: u.empresa_id || null,
        empresaTipo: Array.isArray(u.empresas) ? u.empresas[0]?.tipo || null : u.empresas?.tipo || null,
        is_super_admin: !!u.is_super_admin,
        permissoes: u.permissoes || { dashboard: true, motoristas: true, relatorios: true, usuarios: false, configuracoes: false },
        status: u.status
      })));
    } catch (err: any) {
      console.error('Erro detalhado ao carregar usuários:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsuarios();
    if (currentUser?.is_super_admin) {
      api.get('/painel-admin/empresas').then(res => {
        setEmpresas((res.data || []).map((e: any) => ({ id: e.id, nome: e.nome, tipo: e.tipo, plano: e.planos?.nome || null, status: e.status || null })));
      }).catch(() => {});
    }
  }, []);

  // Fecha dropdown de empresa ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (empresaDropdownRef.current && !empresaDropdownRef.current.contains(e.target as Node)) {
        setShowEmpresaDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

        await api.put('/admin/usuarios/' + editingUser.uid, payload);
      } else {
        // Super-admin deve selecionar empresa alvo explicitamente
        if (currentUser?.is_super_admin && !selectedEmpresaId) {
          alert('Selecione a conta à qual o usuário será vinculado.');
          return;
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
          tipo: newUser.nivel
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
      setEmpresaSearch('');
      setEmpresaTipoFiltro('todas');
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
      console.error('Erro detalhado ao salvar usuário:', error);
      console.error('Payload do usuário no momento do erro:', editingUser ? { type: 'EDIT', data: editingUser } : { type: 'NEW', data: newUser });
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
      console.error('Erro detalhado ao excluir usuário:', error);
      console.error('Alvo da exclusão:', deleteTarget);
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
      console.error('Erro ao resetar senha:', err);
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

  const buscarCep = async (cepStr: string) => {
    const cleanCep = cepStr.replace(/\D/g, '');
    if (cleanCep.length !== 8) return;
    
    try {
      setIsFetchingCep(true);
      const response = await axios.get(`https://viacep.com.br/ws/${cleanCep}/json/`);
      if (response.data && !response.data.erro) {
        if (editingUser) {
          setEditingUser({
            ...editingUser,
            endereco: response.data.logradouro,
            bairro: response.data.bairro,
            cidade: `${response.data.localidade} - ${response.data.uf}`
          });
        } else {
          setNewUser({
            ...newUser,
            endereco: response.data.logradouro,
            bairro: response.data.bairro,
            cidade: `${response.data.localidade} - ${response.data.uf}`
          });
        }
      }
    } catch (err) {
      console.error('Erro ao buscar CEP:', err);
    } finally {
      setIsFetchingCep(false);
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
    if (user.nivel === 'admin') return 'bg-purple-100 text-purple-700';
    if (user.nivel === 'motorista') return 'bg-blue-100 text-blue-700';
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
          <h2 className="text-2xl font-bold text-gray-800">Usuários</h2>
          <p className="text-sm text-gray-500">Pessoas que acessam o sistema, vinculadas às contas da plataforma</p>
        </div>
        <button 
          onClick={() => { setEditingUser(null); setSomenteLeitura(false); setShowModal(true); }}
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
            {label} <span className="opacity-70">({contagem[key]})</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <p className="p-8 text-center text-gray-500">Carregando usuários...</p>
          ) : (
            <table className="w-full table-auto text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
                  <th className="p-3 border-b">Usuário</th>
                  <th className="p-3 border-b">Contato</th>
                  <th className="p-3 border-b">Nível</th>
                  <th className="p-3 border-b">Status</th>
                  <th className="p-3 border-b">Permissões</th>
                  <th className="p-3 border-b text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhum usuário neste grupo.</td></tr>
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
                        {getTipoLabel(user)}
                      </span>
                    </td>
                    <td className="p-3 align-top">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${user.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {user.status || 'ATIVO'}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(user.permissoes || {}).filter(([_, v]) => v).map(([key]) => (
                          <span key={key} className="bg-gray-100 text-gray-500 text-[9px] px-1.5 py-0.5 rounded border border-gray-200 uppercase font-medium">
                            {key}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right align-top">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setEditingUser(user); setSomenteLeitura(true); setShowModal(true); }}
                          className="inline-flex items-center text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
                          title="Ver"
                          aria-label="Ver usuário"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => { setEditingUser(user); setSomenteLeitura(false); setShowModal(true); }}
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

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-800">{somenteLeitura ? 'Dados do Usuário' : editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h3>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
            </div>
            
            <fieldset disabled={somenteLeitura} className="contents">
            <div className="p-4 overflow-y-auto space-y-4">
              <div className="flex flex-col items-center space-y-1 pb-1">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleFileChange} 
                />
                <div 
                  onClick={() => { if (!somenteLeitura) fileInputRef.current?.click(); }}
                  className={`w-16 h-16 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 group transition-all overflow-hidden relative ${somenteLeitura ? 'cursor-default' : 'hover:border-blue-400 hover:text-blue-500 cursor-pointer'}`}
                >
                  {(editingUser?.fotoUrl || newUser.fotoUrl) ? (
                    <>
                      <img 
                        src={editingUser ? editingUser.fotoUrl : newUser.fotoUrl} 
                        alt="Preview" 
                        className="w-full h-full object-cover" 
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera size={24} className="text-white" />
                      </div>
                    </>
                  ) : (
                    <>
                      <Camera size={24} />
                      <span className="text-[10px] font-bold uppercase mt-1">Foto</span>
                    </>
                  )}
                </div>
                {!somenteLeitura && (editingUser?.fotoUrl || newUser.fotoUrl) && (
                  <button 
                    onClick={() => editingUser ? setEditingUser({...editingUser, fotoUrl: ''}) : setNewUser({...newUser, fotoUrl: ''})}
                    className="text-[10px] font-bold text-red-500 uppercase hover:underline"
                  >
                    Remover Foto
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Nome Completo</label>
                    <input 
                      className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-gray-50/50" 
                      value={editingUser ? editingUser.nome : newUser.nome}
                      onChange={e => editingUser ? setEditingUser({...editingUser, nome: e.target.value}) : setNewUser({...newUser, nome: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">E-mail</label>
                    <input 
                      className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-gray-50/50" 
                      value={editingUser ? editingUser.email : newUser.email}
                      onChange={e => editingUser ? setEditingUser({...editingUser, email: e.target.value}) : setNewUser({...newUser, email: e.target.value})}
                      disabled={!!editingUser}
                    />
                  </div>
                  {editingUser && currentUser?.is_super_admin && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Conta vinculada</label>
                      <input
                        type="text"
                        readOnly
                        className="w-full border p-3 rounded-xl bg-gray-100 text-gray-600"
                        value={contaAtualLabel(editingUser)}
                      />
                      <p className="text-[10px] text-gray-400 mt-1 ml-1">
                        A troca de conta do usuário será disponibilizada em uma etapa específica, para preservar o isolamento entre contas.
                      </p>
                    </div>
                  )}
                  {!editingUser && currentUser?.is_super_admin && (
                    <div ref={empresaDropdownRef} className="relative">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Empresa</label>
                      <input
                        className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white"
                        value={selectedEmpresaId ? (empresas.find(e => e.id === selectedEmpresaId)?.nome || '') : empresaSearch}
                        onChange={e => { setEmpresaSearch(e.target.value); setSelectedEmpresaId(''); setShowEmpresaDropdown(true); }}
                        onFocus={() => setShowEmpresaDropdown(true)}
                        placeholder="Digite para buscar..."
                      />
                      {showEmpresaDropdown && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                          <div className="flex gap-1 p-2 border-b bg-gray-50 sticky top-0">
                            {([['todas', 'Todas'], ['empresas', 'Empresas'], ['autonomos', 'Autônomos']] as const).map(([k, l]) => (
                              <button
                                key={k}
                                type="button"
                                onClick={() => setEmpresaTipoFiltro(k)}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${empresaTipoFiltro === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                          {(() => {
                            const lista = empresas
                              .filter(e => empresaTipoFiltro === 'todas' || (empresaTipoFiltro === 'autonomos' ? e.tipo === 'autonomo' : e.tipo !== 'autonomo'))
                              .filter(e => !empresaSearch || e.nome.toLowerCase().includes(empresaSearch.toLowerCase()));
                            if (lista.length === 0) {
                              return <div className="px-4 py-3 text-sm text-gray-400">Nenhuma conta encontrada</div>;
                            }
                            return lista.map(e => (
                              <div
                                key={e.id}
                                className="px-4 py-2.5 hover:bg-blue-50 cursor-pointer"
                                onClick={() => { setSelectedEmpresaId(e.id); setEmpresaSearch(''); setShowEmpresaDropdown(false); }}
                              >
                                <div className="text-sm text-gray-700">{formatContaLinha(e)}</div>
                                {e.status && e.status !== 'ativo' && (
                                  <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">{e.status}</div>
                                )}
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                  {!editingUser && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Senha Provisória</label>
                      <div className="relative">
                        <input
                          type={showSenhaNovoUsuario ? 'text' : 'password'}
                          autoComplete="new-password"
                          className="w-full border p-3 pr-10 rounded-xl outline-none focus:border-blue-500 bg-gray-50/50"
                          value={newUser.senha}
                          onChange={e => setNewUser({...newUser, senha: e.target.value})}
                          placeholder="Mín. 6 caracteres"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSenhaNovoUsuario(!showSenhaNovoUsuario)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1"
                          title={showSenhaNovoUsuario ? 'Ocultar senha' : 'Mostrar senha'}
                          aria-label={showSenhaNovoUsuario ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showSenhaNovoUsuario ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  )}
                  {editingUser ? (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Nível</label>
                      <input
                        type="text"
                        readOnly
                        className="w-full border p-3 rounded-xl bg-gray-100 text-gray-600"
                        value={editingUser.nivel === 'operador' ? 'Operador legado — sem permissão funcional' : getTipoLabel(editingUser)}
                      />
                      <p className="text-[10px] text-gray-400 mt-1 ml-1">
                        O nível do usuário é definido no cadastro e não pode ser alterado nesta tela.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Nível</label>
                      <select
                        className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white"
                        value={newUser.nivel}
                        onChange={e => setNewUser({...newUser, nivel: e.target.value})}
                      >
                        <option value="admin">Administrador</option>
                      </select>
                      <p className="text-[10px] text-gray-400 mt-1 ml-1">
                        Para cadastrar motoristas, use a tela de Motoristas.
                      </p>
                    </div>
                  )}
                  {editingUser && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Status</label>
                      <select 
                        className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white"
                        value={editingUser.status}
                        onChange={e => setEditingUser({...editingUser, status: e.target.value})}
                      >
                        <option value="ativo">Ativo</option>
                        <option value="bloqueado">Bloqueado</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Celular</label>
                    <input 
                      className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-gray-50/50" 
                      placeholder="(00) 0 0000-0000"
                      value={editingUser ? editingUser.celular : newUser.celular}
                      onChange={e => {
                        const masked = maskPhone(e.target.value);
                        editingUser ? setEditingUser({...editingUser, celular: masked}) : setNewUser({...newUser, celular: masked});
                      }}
                    />
                  </div>
                  
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-3">
                    <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center">
                      <MapPin size={14} className="mr-1.5 text-gray-400" /> Localização
                    </h4>
                    
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1 flex justify-between">
                        CEP
                        {isFetchingCep && <Loader2 size={12} className="animate-spin text-blue-500" />}
                      </label>
                      <input 
                        className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white" 
                        placeholder="00000-000"
                        maxLength={9}
                        value={editingUser ? editingUser.cep : newUser.cep}
                        onChange={e => {
                          const masked = maskCEP(e.target.value);
                          editingUser ? setEditingUser({...editingUser, cep: masked}) : setNewUser({...newUser, cep: masked});
                        }}
                        onBlur={e => buscarCep(e.target.value)}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Endereço / Logradouro</label>
                      <input 
                        className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white" 
                        placeholder="Rua, número..."
                        value={editingUser ? editingUser.endereco : newUser.endereco}
                        onChange={e => editingUser ? setEditingUser({...editingUser, endereco: e.target.value}) : setNewUser({...newUser, endereco: e.target.value})}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Bairro</label>
                        <input 
                          className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white" 
                          placeholder="Bairro"
                          value={editingUser ? editingUser.bairro : newUser.bairro}
                          onChange={e => editingUser ? setEditingUser({...editingUser, bairro: e.target.value}) : setNewUser({...newUser, bairro: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Cidade / UF</label>
                        <input 
                          className="w-full border p-3 rounded-xl outline-none focus:border-blue-500 bg-white" 
                          placeholder="Cidade - UF"
                          value={editingUser ? editingUser.cidade : newUser.cidade}
                          onChange={e => editingUser ? setEditingUser({...editingUser, cidade: e.target.value}) : setNewUser({...newUser, cidade: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <h4 className="text-sm font-bold text-gray-700 mb-2 flex items-center"><Shield size={18} className="mr-2 text-blue-600" /> Permissões de Acesso</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {Object.keys(newUser.permissoes || {}).map(key => (
                    <label key={key} className="flex items-center space-x-2 p-2 bg-white rounded-lg border border-gray-200 cursor-pointer hover:border-blue-300 transition-colors">
                      <input 
                        type="checkbox" 
                        className="rounded text-blue-600" 
                        checked={editingUser ? (editingUser.permissoes as any)[key] : (newUser.permissoes as any)[key]}
                        onChange={e => {
                          const checked = e.target.checked;
                          if (editingUser) {
                            setEditingUser({...editingUser, permissoes: {...editingUser.permissoes, [key]: checked}});
                          } else {
                            setNewUser({...newUser, permissoes: {...(newUser.permissoes as any), [key]: checked}});
                          }
                        }}
                      />
                      <span className="text-xs font-bold text-gray-600 uppercase">{key}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            </fieldset>

            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-3 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 font-medium text-sm text-gray-600 hover:bg-gray-200 rounded-xl transition-all">{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
              {!somenteLeitura && <button
                onClick={handleSave}
                disabled={isSubmitting}
                className="inline-flex items-center px-4 py-2.5 bg-green-700 text-white rounded-xl font-medium text-sm shadow-sm hover:bg-green-800 transition-all active:scale-95 disabled:opacity-50"
              >
                <Check size={18} className="mr-2" /> {isSubmitting ? 'Salvando...' : 'Salvar'}
              </button>}
            </div>
          </div>
        </div>
      )}

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
