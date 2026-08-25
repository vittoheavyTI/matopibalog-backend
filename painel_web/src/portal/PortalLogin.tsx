import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { usePortalAuth } from './PortalAuthContext';
import { CampoSenha, Carregando, FOCO_CLARO } from './PortalUI';

// Entrada do portal. Simples de propósito (§27): quem chega aqui é um cliente da
// transportadora, não um operador — nenhuma navegação interna, nenhum conceito
// do sistema, nenhuma promessa de recurso que o portal não tem.

export default function PortalLogin() {
  const { entrar, autenticado, carregando } = usePortalAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const navigate = useNavigate();

  if (carregando) return <Carregando rotulo="Verificando seu acesso…" />;
  if (autenticado) return <Navigate to="/portal/embarcador" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
      navigate('/portal/embarcador', { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Matopiba Log</h1>
          <p className="mt-1 text-sm text-slate-600">Portal do Embarcador</p>
        </div>

        <form onSubmit={enviar} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <label htmlFor="portal-email" className="block text-sm font-medium text-slate-700">E-mail</label>
              <input
                id="portal-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
            </div>
            <CampoSenha
              id="portal-senha"
              rotulo="Senha"
              autoComplete="current-password"
              valor={senha}
              aoMudar={setSenha}
            />
          </div>

          {erro && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erro}</p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className={`mt-5 w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60 ${FOCO_CLARO}`}
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          {/* Não prometemos recuperação de senha aqui: o portal ainda não tem
              esse fluxo próprio, e um link que não funciona é pior que a
              ausência dele. A orientação é honesta sobre o caminho real. */}
          <p className="mt-4 text-center text-xs text-slate-500">
            Recebeu um convite? <Link to="/portal/embarcador/convite" className={`rounded text-emerald-700 underline ${FOCO_CLARO}`}>Ative seu acesso</Link>.
          </p>
          <p className="mt-2 text-center text-xs text-slate-500">
            Esqueceu a senha? Fale com a transportadora para receber um novo convite.
          </p>
        </form>
      </div>
    </div>
  );
}
