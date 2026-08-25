import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import portalApi, { mensagemDeErro } from './portalApi';
import { usePortalAuth } from './PortalAuthContext';
import { Carregando, Erro } from './PortalUI';

type Preview = {
  email: string;
  nome_convidado: string | null;
  transportadora: string | null;
  embarcador: string | null;
  utilizavel: boolean;
  motivo: string | null;
};

// Ativação de convite. A tela lê o convite primeiro para poder dizer QUEM está
// convidando e para qual e-mail — sem isso a pessoa digitaria uma senha sem
// saber onde está entrando.

export default function PortalAtivarConvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { aplicarSessao } = usePortalAuth();
  const navigate = useNavigate();

  const [carregando, setCarregando] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);

  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoSenha, setAvisoSenha] = useState(false);

  async function carregar() {
    if (!token) { setErroLeitura('Link de convite inválido.'); setCarregando(false); return; }
    setCarregando(true);
    setErroLeitura(null);
    try {
      const { data } = await portalApi.get('/portal/embarcador/convite', { params: { token } });
      setPreview(data);
      setNome(data.nome_convidado || '');
    } catch (e) {
      setErroLeitura(mensagemDeErro(e, 'Não foi possível ler este convite.'));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha !== confirmacao) { setErro('As senhas não conferem.'); return; }
    if (senha.length < 8) { setErro('Escolha uma senha com pelo menos 8 caracteres.'); return; }
    setEnviando(true);
    try {
      const { data } = await portalApi.post('/portal/embarcador/convite/ativar', { token, senha, nome });
      // Caso real e nada óbvio: se o e-mail já tinha conta, a senha digitada
      // agora NÃO vale — dizer isso evita a pessoa tentar entrar e falhar.
      if (data.senha_definida_agora === false) {
        setAvisoSenha(true);
        await aplicarSessao(data.token);
        return;
      }
      await aplicarSessao(data.token);
      navigate('/portal/embarcador', { replace: true });
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível ativar seu acesso.'));
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) return <div className="min-h-screen bg-slate-100"><Carregando rotulo="Verificando o convite…" /></div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Matopiba Log</h1>
          <p className="mt-1 text-sm text-slate-600">Portal do Embarcador</p>
        </div>

        {erroLeitura && (
          <div className="space-y-4">
            <Erro mensagem={erroLeitura} aoTentarNovamente={carregar} />
            <p className="text-center text-xs text-slate-500">
              Já tem acesso? <Link to="/portal/embarcador/entrar" className="text-emerald-700 underline">Entrar</Link>
            </p>
          </div>
        )}

        {preview && !preview.utilizavel && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
            <p className="text-sm text-amber-900">
              {preview.motivo === 'expirado'
                ? 'Este convite expirou. Peça um novo convite à transportadora.'
                : 'Este convite não está mais disponível. Peça um novo convite à transportadora.'}
            </p>
            <Link to="/portal/embarcador/entrar" className="mt-3 inline-block text-sm text-emerald-700 underline">
              Já tenho acesso
            </Link>
          </div>
        )}

        {avisoSenha && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 text-center" role="status">
            <p className="text-sm text-sky-900">
              Seu acesso foi ativado. Este e-mail já tinha uma conta no Matopiba Log,
              então continue usando a senha que você já utilizava — a senha digitada agora não foi aplicada.
            </p>
            <button
              type="button"
              onClick={() => navigate('/portal/embarcador', { replace: true })}
              className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Continuar
            </button>
          </div>
        )}

        {preview?.utilizavel && !avisoSenha && (
          <form onSubmit={enviar} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p><strong>{preview.transportadora || 'A transportadora'}</strong> liberou seu acesso
                {preview.embarcador ? <> como <strong>{preview.embarcador}</strong></> : null}.</p>
              <p className="mt-1 text-xs text-slate-500">Acesso para {preview.email}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="conv-nome" className="block text-sm font-medium text-slate-700">Seu nome</label>
                <input
                  id="conv-nome" type="text" required value={nome} onChange={(e) => setNome(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label htmlFor="conv-senha" className="block text-sm font-medium text-slate-700">Crie uma senha</label>
                <input
                  id="conv-senha" type="password" autoComplete="new-password" required minLength={8}
                  value={senha} onChange={(e) => setSenha(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
                <p className="mt-1 text-xs text-slate-500">Pelo menos 8 caracteres.</p>
              </div>
              <div>
                <label htmlFor="conv-conf" className="block text-sm font-medium text-slate-700">Repita a senha</label>
                <input
                  id="conv-conf" type="password" autoComplete="new-password" required
                  value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>

            {erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{erro}</p>}

            <button
              type="submit" disabled={enviando}
              className="mt-5 w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {enviando ? 'Ativando…' : 'Ativar meu acesso'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
