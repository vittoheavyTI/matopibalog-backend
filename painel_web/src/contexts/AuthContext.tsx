import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import api from '../api';

export interface User {
  uid: string;
  email: string;
  nome: string;
  role: string;
  status: string;
  fotoUrl?: string;
  is_super_admin?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);

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
        const data = res.data;
        setUser({
          uid: data.id,
          email: data.email,
          nome: data.nome,
          role: data.tipo,
          status: data.status,
          fotoUrl: data.foto_url,
          is_super_admin: data.is_super_admin ?? false,
        });
      })
      .catch(() => {
        // Se o token for inválido, remove e limpa estado
        localStorage.removeItem('auth_token');
        setUser(null);
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, []);

  // Reage a expiração de cookie detectada pelo interceptor do axios
  useEffect(() => {
    const handleUnauthorized = () => {
      if (!loadingRef.current) setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = (user: User) => {
    setUser(user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    // Remove token stored locally
    try { localStorage.removeItem('auth_token'); } catch(e) {}
    // Limpa cache per-session para a próxima conta começar sem dados da anterior
    // company é per-session (varia por empresa); logo é do sistema (persiste entre sessões)
    ['matopibalog_company', 'choferlog_company',
    ].forEach(k => localStorage.removeItem(k));
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
