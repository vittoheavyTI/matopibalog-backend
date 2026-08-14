import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import api, { decodificarPayloadJwt } from '../api';
import { definirMotivoSessao, type MotivoSessao } from '../utils/sessionReason';
import { OPERATIONAL_GROUP_CONTEXT_KEY, OPERATIONAL_UNIT_CONTEXT_KEY } from '../utils/operationalContextStorage';

export interface User {
  uid: string;
  email: string;
  nome: string;
  role: string;
  status: string;
  fotoUrl?: string;
  is_super_admin?: boolean;
  empresa_id?: string;
  empresa_tipo?: string;
  empresa_nome?: string;
  senha_temporaria?: boolean;
  termos_pendentes?: boolean;
  termos_pendentes_count?: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (user: User) => void;
  logout: (motivo?: MotivoSessao) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

// Usuário MÍNIMO reconstruído do próprio JWT (localStorage), usado quando o
// /auth/me falha por motivo TRANSITÓRIO (429/offline/5xx): preserva a sessão em
// vez de jogar no login. Campos de gate (senha_temporaria/termos) ficam neutros e
// são re-enriquecidos na próxima chamada bem-sucedida de /auth/me. Token expirado
// (exp no passado) → null, para cair no login normalmente.
function usuarioMinimoDoToken(): User | null {
  try {
    const t = localStorage.getItem('auth_token');
    if (!t) return null;
    const p = decodificarPayloadJwt(t);
    if (!p || !p.uid) return null;
    if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null;
    return {
      uid: p.uid,
      email: p.email ?? '',
      nome: p.email ?? '',
      role: p.role ?? '',
      status: 'ativo',
      is_super_admin: p.is_super_admin ?? false,
      senha_temporaria: false,
      termos_pendentes: false,
      termos_pendentes_count: 0,
    };
  } catch {
    return null;
  }
}

// Mapeia a resposta de /auth/me para o nosso User. Centralizado para que tanto a
// restauração de sessão (montagem) quanto o enriquecimento pós-login usem o mesmo
// formato — incluindo os campos do gate (senha_temporaria / termos_pendentes).
const mapMeToUser = (data: any): User => ({
  uid: data.id,
  email: data.email,
  nome: data.nome,
  role: data.tipo,
  status: data.status,
  fotoUrl: data.foto_url,
  is_super_admin: data.is_super_admin ?? false,
  empresa_id: data.empresa_id,
  empresa_tipo: data.empresas?.tipo ?? undefined,
  empresa_nome: data.empresas?.nome ?? undefined,
  // Sem isto, ao recarregar a página a flag se perderia e o usuário
  // com senha temporária burlaria a troca obrigatória (gate do ProtectedRoute).
  senha_temporaria: data.senha_temporaria ?? false,
  termos_pendentes: data.termos_pendentes ?? false,
  termos_pendentes_count: data.termos_pendentes_count ?? 0,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  // Guarda contra reentrância: processa o encerramento por 'auth:unauthorized'
  // uma única vez. Rearmado a cada login para novos ciclos de sessão.
  const encerrandoRef = useRef(false);

  // Verifica o cookie na montagem para restaurar a sessão
  useEffect(() => {
    // Preferir token salvo no localStorage (Bearer). Se não existir, não tenta API.
    const token = localStorage.getItem('auth_token');
    if (!token) {
      loadingRef.current = false;
      setLoading(false);
      setUser(null);
      return;
    }

    api.get('/auth/me')
      .then((res) => {
        setUser(mapMeToUser(res.data));
      })
      .catch((err) => {
        const status = err?.response?.status;
        const authFalhou = status === 401
          || (status === 403 && err?.response?.data?.error === 'Token inválido ou expirado.');
        if (authFalhou) {
          // Token realmente inválido/expirado no servidor → limpa e desloga.
          localStorage.removeItem('auth_token');
          setUser(null);
        } else {
          // Transitório (429 rate limit / offline / 5xx): NÃO apaga o token válido
          // (JWT dura 7 dias). Restaura um usuário mínimo do token para não jogar o
          // usuário no login por causa de um pico de requisições; o /auth/me
          // re-enriquece (nome/empresa/gate) na próxima chamada que passar.
          setUser(usuarioMinimoDoToken());
        }
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, []);

  // Reage a expiração de sessão detectada pelo interceptor do axios.
  // O interceptor já registrou o motivo (expired/invalid) antes de disparar; aqui
  // apenas limpamos token e estado (uma única vez) e deixamos o ProtectedRoute
  // levar ao /login. NÃO gravamos motivo aqui para não sobrescrever o já definido.
  useEffect(() => {
    const handleUnauthorized = () => {
      if (loadingRef.current) return;
      if (encerrandoRef.current) return;
      encerrandoRef.current = true;
      try { localStorage.removeItem('auth_token'); } catch (e) { /* ignore */ }
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = (user: User) => {
    // Novo ciclo de sessão: rearma o guarda de encerramento para que uma futura
    // expiração volte a ser processada.
    encerrandoRef.current = false;
    // Aplica imediatamente os dados vindos do /auth/login para não travar a navegação.
    setUser(user);
    // O /auth/login NÃO retorna termos_pendentes (apenas /auth/me calcula). Sem este
    // refresh, o gate de termos só dispararia após um F5. Buscamos /auth/me em seguida
    // para enriquecer o estado e acionar o ProtectedRoute sem recarregar a página.
    // Se já viermos com termos_pendentes definido (ex.: limpeza pós-aceite), preserva.
    api.get('/auth/me')
      .then((res) => setUser((atual) => (atual ? mapMeToUser(res.data) : atual)))
      .catch(() => { /* mantém o user do login; sem bloqueio de navegação */ });
  };

  // motivo: por que a sessão terminou. Padrão 'manual' (clique em Sair) → o Login
  // NÃO mostra alerta de expiração. O watcher de inatividade chama logout('idle').
  // Gravado ANTES de qualquer chamada de rede, para não ser trocado pelo
  // registro "soft" do interceptor caso o /auth/logout falhe.
  const logout = async (motivo: MotivoSessao = 'manual') => {
    definirMotivoSessao(motivo);
    try {
      await api.post('/auth/logout');
    } catch {}
    // Remove token stored locally
    try { localStorage.removeItem('auth_token'); } catch(e) {}
    // Limpa cache per-session para a próxima conta começar sem dados da anterior.
    // company E logo são POR EMPRESA (multi-tenant): sem limpar, a próxima conta no
    // mesmo navegador poderia herdar a logo da anterior até a config hidratar. O
    // Sidebar re-hidrata a logo da empresa logada em seguida (/configuracoes).
    ['matopibalog_company', 'choferlog_company',
     'matopibalog_logo', 'matopibalog_logo_scale', 'matopibalog_logo_y',
     'matopibalog_empresa_logo',
     OPERATIONAL_GROUP_CONTEXT_KEY,
     OPERATIONAL_UNIT_CONTEXT_KEY,
    ].forEach(k => localStorage.removeItem(k));
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
