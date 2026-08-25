import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import portalApi, { guardarTokenPortal, limparTokenPortal, lerTokenPortal, mensagemDeErro } from './portalApi';

// Contexto de sessão do Portal do Embarcador. Deliberadamente separado do
// `AuthContext` interno (§15/§26): nunca há fusão de privilégios, e este
// contexto não conhece `empresa_id` nem papéis internos. Ele sabe apenas quem é
// o usuário externo e com quais transportadoras ele tem relacionamento ativo.

export type Transportadora = { relationship_id: string; nome: string };
export type UsuarioPortal = { id: string; nome: string; email: string };

type PortalAuthValor = {
  carregando: boolean;
  autenticado: boolean;
  usuario: UsuarioPortal | null;
  embarcador: { id: string; nome: string } | null;
  transportadoras: Transportadora[];
  // Transportadora ativa. Com uma só, é escolhida automaticamente (§16); com
  // mais de uma, a tela oferece o seletor.
  transportadoraAtiva: Transportadora | null;
  selecionarTransportadora: (relationshipId: string) => void;
  entrar: (email: string, senha: string) => Promise<void>;
  aplicarSessao: (token: string) => Promise<void>;
  sair: () => void;
  erro: string | null;
};

const PortalAuthContext = createContext<PortalAuthValor | null>(null);
const REL_ATIVO_KEY = 'matopibalog_portal_relacionamento';

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [usuario, setUsuario] = useState<UsuarioPortal | null>(null);
  const [embarcador, setEmbarcador] = useState<{ id: string; nome: string } | null>(null);
  const [transportadoras, setTransportadoras] = useState<Transportadora[]>([]);
  const [relAtivo, setRelAtivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregarContexto() {
    const token = lerTokenPortal();
    if (!token) { setCarregando(false); return; }
    try {
      const { data } = await portalApi.get('/portal/embarcador/contexto');
      setUsuario(data.usuario);
      setEmbarcador(data.embarcador);
      setTransportadoras(data.transportadoras || []);
      const salvo = (() => { try { return localStorage.getItem(REL_ATIVO_KEY); } catch { return null; } })();
      const valido = (data.transportadoras || []).some((t: Transportadora) => t.relationship_id === salvo);
      setRelAtivo(valido ? salvo : (data.transportadoras?.[0]?.relationship_id ?? null));
    } catch {
      // Sessão inválida/expirada, ou acesso revogado desde o último login.
      // Limpar é o comportamento correto: manter um token morto só produziria
      // uma sequência de 401 silenciosos.
      limparTokenPortal();
      setUsuario(null);
      setTransportadoras([]);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregarContexto(); }, []);

  async function aplicarSessao(token: string) {
    guardarTokenPortal(token);
    setCarregando(true);
    await carregarContexto();
  }

  async function entrar(email: string, senha: string) {
    setErro(null);
    try {
      const { data } = await portalApi.post('/portal/embarcador/login', { email, senha });
      guardarTokenPortal(data.token);
      setUsuario(data.usuario);
      setEmbarcador(data.embarcador);
      setTransportadoras(data.transportadoras || []);
      setRelAtivo(data.transportadoras?.[0]?.relationship_id ?? null);
    } catch (e) {
      const msg = mensagemDeErro(e, 'Não foi possível entrar. Confira seus dados e tente novamente.');
      setErro(msg);
      throw new Error(msg);
    }
  }

  function selecionarTransportadora(relationshipId: string) {
    setRelAtivo(relationshipId);
    try { localStorage.setItem(REL_ATIVO_KEY, relationshipId); } catch { /* ignora */ }
  }

  function sair() {
    limparTokenPortal();
    try { localStorage.removeItem(REL_ATIVO_KEY); } catch { /* ignora */ }
    setUsuario(null);
    setEmbarcador(null);
    setTransportadoras([]);
    setRelAtivo(null);
  }

  const valor = useMemo<PortalAuthValor>(() => ({
    carregando,
    autenticado: Boolean(usuario),
    usuario,
    embarcador,
    transportadoras,
    transportadoraAtiva: transportadoras.find((t) => t.relationship_id === relAtivo) || transportadoras[0] || null,
    selecionarTransportadora,
    entrar,
    aplicarSessao,
    sair,
    erro,
  }), [carregando, usuario, embarcador, transportadoras, relAtivo, erro]);

  return <PortalAuthContext.Provider value={valor}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth precisa estar dentro de PortalAuthProvider');
  return ctx;
}
