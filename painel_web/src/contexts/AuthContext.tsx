import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api';

export interface User {
  uid: string;
  email: string;
  nome: string;
  role: string;
  status: string;
  fotoUrl?: string;
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

  // Verifica o cookie na montagem para restaurar a sessão
  useEffect(() => {
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
        });
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Reage a expiração de cookie detectada pelo interceptor do axios
  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
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
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
