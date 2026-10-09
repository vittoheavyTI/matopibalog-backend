import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import api from '../api';
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
  permissoes?: Record<string, boolean>;
  // P2 — permissões efetivas V9 (templates+overrides). Fonte de verdade para
  // menu/gates da UI; o backend continua a autoridade real.
  effective_permissions?: Record<string, boolean>;
  permission_template?: string | null;
  driver_financial_visibility?: string | null;
  senha_temporaria?: boolean;
  termos_pendentes?: boolean;
  termos_pendentes_count?: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  sessionValidationUnavailable: boolean;
  revalidarSessao: () => Promise<void>;
  login: (user?: User) => Promise<User | null>;
  logout: (motivo?: MotivoSessao) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  sessionValidationUnavailable: false,
  revalidarSessao: async () => {},
  login: async () => null,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

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
  permissoes: data.permissoes ?? undefined,
  effective_permissions: data.effective_permissions ?? undefined,
  permission_template: data.permission_template ?? null,
  driver_financial_visibility: data.driver_financial_visibility ?? null,
  senha_temporaria: data.senha_temporaria ?? false,
  termos_pendentes: data.termos_pendentes ?? false,
  termos_pendentes_count: data.termos_pendentes_count ?? 0,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionValidationUnavailable, setSessionValidationUnavailable] = useState(false);
  const loadingRef = useRef(true);
  // Guarda contra reentrância: processa o encerramento por 'auth:unauthorized'
  // uma única vez. Rearmado a cada login para novos ciclos de sessão.
  const encerrandoRef = useRef(false);

  // R1A: Invariante PROTECTED_UI_REQUIRES_SUCCESSFUL_AUTHORITATIVE_/auth/me
  // Valida e hidrata a sessão autoritativa com o backend.
  const revalidarSessao = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      loadingRef.current = false;
      setLoading(false);
      setUser(null);
      setSessionValidationUnavailable(false);
      return;
    }

    setLoading(true);
    loadingRef.current = true;
    try {
      const res = await api.get('/auth/me');
      setUser(mapMeToUser(res.data));
      setSessionValidationUnavailable(false);
    } catch (err: any) {
      const status = err?.response?.status;
      const authFalhou = status === 401
        || (status === 403 && err?.response?.data?.error === 'Token inválido ou expirado.');
      if (authFalhou) {
        // Token realmente inválido/expirado no servidor → limpa e desloga.
        localStorage.removeItem('auth_token');
        setUser(null);
        setSessionValidationUnavailable(false);
      } else {
        // Falha transitória (429, 5xx, offline/rede):
        // NÃO apaga o token válido do localStorage, mas NUNCA constrói usuário
        // local nem autoriza UI protegida. Seta estado explícito recuperável.
        setUser(null);
        setSessionValidationUnavailable(true);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // Verifica o cookie na montagem para restaurar a sessão
  useEffect(() => {
    revalidarSessao();
  }, []);

  // Reage a expiração de sessão detectada pelo interceptor do axios.
  useEffect(() => {
    const handleUnauthorized = () => {
      if (loadingRef.current) return;
      if (encerrandoRef.current) return;
      encerrandoRef.current = true;
      try { localStorage.removeItem('auth_token'); } catch (e) { /* ignore */ }
      setUser(null);
      setSessionValidationUnavailable(false);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // R1A: Post-login hydration.
  // Uma resposta de /auth/login sozinha NÃO torna rotas protegidas autorizadas se os
  // campos autoritativos não tiverem sido hidratados com sucesso por /auth/me.
  const login = async (_userParam?: User): Promise<User | null> => {
    encerrandoRef.current = false;
    setLoading(true);
    try {
      const res = await api.get('/auth/me');
      const hydrated = mapMeToUser(res.data);
      setUser(hydrated);
      setSessionValidationUnavailable(false);
      return hydrated;
    } catch (err: any) {
      const status = err?.response?.status;
      const authFalhou = status === 401
        || (status === 403 && err?.response?.data?.error === 'Token inválido ou expirado.');
      if (authFalhou) {
        localStorage.removeItem('auth_token');
        setUser(null);
        setSessionValidationUnavailable(false);
        throw err;
      } else {
        // Falha transitória pós-login: NÃO entra na aplicação nem constrói autoridade parcial.
        // Preserva a credencial recém-emitida no localStorage e sinaliza validação indisponível.
        setUser(null);
        setSessionValidationUnavailable(true);
        return null;
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // motivo: por que a sessão terminou.
  const logout = async (motivo: MotivoSessao = 'manual') => {
    definirMotivoSessao(motivo);
    try {
      await api.post('/auth/logout');
    } catch {}
    try { localStorage.removeItem('auth_token'); } catch(e) {}
    ['matopibalog_company', 'choferlog_company',
     'matopibalog_logo', 'matopibalog_logo_scale', 'matopibalog_logo_y',
     'matopibalog_empresa_logo',
     OPERATIONAL_GROUP_CONTEXT_KEY,
     OPERATIONAL_UNIT_CONTEXT_KEY,
    ].forEach(k => localStorage.removeItem(k));
    setUser(null);
    setSessionValidationUnavailable(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, sessionValidationUnavailable, revalidarSessao, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
