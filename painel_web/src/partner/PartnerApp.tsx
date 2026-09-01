import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Package, Clock, ArrowLeft, Check, X, Send } from 'lucide-react';

// Área do parceiro (E3.6A) — superfície EXTERNA, mobile-first.
//
// Deliberadamente separada do painel interno: cliente HTTP próprio, sessão
// própria, navegação própria. O parceiro nunca vê menu, tela ou rota do sistema
// da transportadora — ele vê apenas o que foi compartilhado com ele.
//
// A sessão vive em `partner_token`, distinta do token interno. As duas nunca se
// misturam: o backend recusa cada uma no mundo da outra.

const CHAVE_SESSAO = 'matopibalog_partner_token';

const clienteParceiro = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || ''}/portal/parceiro`,
});

// 401 no meio da navegação = sessão vencida ou acesso revogado. Limpar e mandar
// para o login é a única saída honesta — o convite não serve mais.
clienteParceiro.interceptors.response.use(
  (r) => r,
  (erro) => {
    if (erro?.response?.status === 401) {
      localStorage.removeItem(CHAVE_SESSAO);
    }
    return Promise.reject(erro);
  },
);

clienteParceiro.interceptors.request.use((config) => {
  const token = localStorage.getItem(CHAVE_SESSAO);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type Oportunidade = {
  recipient_id: string;
  id: string;
  cargo_descricao: string;
  origem_resumo: string | null;
  destino_resumo: string | null;
  quantidade: number;
  quantidade_unidade: string;
  janela_inicio: string | null;
  janela_fim: string | null;
  restricoes: string | null;
  mensagem: string | null;
  prazo_resposta: string | null;
  estado: string;
  criado_em: string;
  visualizado_em?: string | null;
};

type Revisao = {
  revisao: number;
  situacao: 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'DECLINED';
  capacidade_quantidade: number | null;
  capacidade_unidade: string | null;
  nota: string | null;
  criado_em: string;
};

const ROTULO_SITUACAO: Record<Revisao['situacao'], string> = {
  AVAILABLE: 'Tenho disponibilidade',
  PARTIALLY_AVAILABLE: 'Tenho parte',
  DECLINED: 'Não consigo atender',
};

function quantidade(v: number, u: string) {
  return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${u}`;
}

function dataCurta(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : null;
}

function janela(inicio: string | null, fim: string | null) {
  const a = dataCurta(inicio); const b = dataCurta(fim);
  if (a && b) return `${a} a ${b}`;
  if (a) return `a partir de ${a}`;
  if (b) return `até ${b}`;
  return 'sem janela definida';
}

function mensagemDeErro(e: unknown, padrao: string) {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' && msg.trim() ? msg : padrao;
}

// ── Ativação do convite ────────────────────────────────────────────────────────

function Ativar() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const token = params.get('token') || '';
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const ativar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const { data } = await clienteParceiro.post('/ativar', {
        token,
        nome: nome.trim() || null,
        senha: senha || null,
      });
      localStorage.setItem(CHAVE_SESSAO, data.token);
      navegar('/portal/parceiro/oportunidades', { replace: true });
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível ativar este convite.'));
    } finally {
      setEnviando(false);
    }
  };

  if (!token) {
    return (
      <Moldura>
        <p className="text-sm text-gray-600">
          Link de convite inválido. Peça um novo link à transportadora.
        </p>
        <LinkParaEntrar />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <h1 className="text-xl font-bold text-gray-800">Criar seu acesso</h1>
      <p className="mt-1 text-sm text-gray-600">
        Você foi convidado a receber oportunidades de carga. Escolha uma senha para entrar
        sempre que quiser — este acesso mostra apenas o que for compartilhado com você.
      </p>

      <label htmlFor="nome" className="mt-4 block text-xs font-bold uppercase text-gray-600">
        Seu nome
      </label>
      <input
        id="nome"
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Como devemos chamar você"
      />

      <label htmlFor="senha" className="mt-3 block text-xs font-bold uppercase text-gray-600">
        Senha
      </label>
      <input
        id="senha"
        type="password"
        autoComplete="new-password"
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        placeholder="Mínimo de 8 caracteres"
      />
      {/* Se o e-mail já tiver conta no Matopiba Log, a senha pedida é a DELA — a
          senha existente é verificada, nunca redefinida. */}
      <p className="mt-1 text-xs text-gray-500">
        Se você já tem conta no Matopiba Log com este e-mail, informe a senha dela.
      </p>

      {erro && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erro}</p>}

      <button
        type="button"
        onClick={ativar}
        disabled={enviando}
        className="mt-4 w-full rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {enviando ? 'Ativando…' : 'Ativar acesso'}
      </button>
      <LinkParaEntrar />
    </Moldura>
  );
}

// ── Login recorrente ───────────────────────────────────────────────────────────
//
// É o que torna o acesso durável: o convite serve uma vez, para provar quem é.
// Depois disso a pessoa entra como em qualquer produto.
// Um contexto = um vínculo desta identidade com UMA organização parceira.
// Repare no que não vem: nada da transportadora solicitante.
type ContextoDeParceiro = {
  partner_user_id: string;
  organizacao: string | null;
  vinculado_em: string | null;
};

function Entrar() {
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // HIGH-15: só aparece quando o backend responde `requires_context_selection`,
  // isto é, quando esta identidade está vinculada a mais de uma rede. Quem tem
  // uma só nunca vê esta tela.
  const [contextos, setContextos] = useState<ContextoDeParceiro[] | null>(null);

  const concluir = (token: string) => {
    localStorage.setItem(CHAVE_SESSAO, token);
    navegar('/portal/parceiro/oportunidades', { replace: true });
  };

  const entrar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const { data } = await clienteParceiro.post('/entrar', { email: email.trim(), senha });
      if (data?.requires_context_selection) {
        setContextos(data.contextos || []);
        return;
      }
      concluir(data.token);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível entrar.'));
    } finally {
      setEnviando(false);
    }
  };

  // A senha é reenviada aqui de propósito: não existe token intermediário
  // "quase autenticado" guardado entre as duas telas. A posse da conta é provada
  // de novo, e o backend ainda confere que o vínculo escolhido é mesmo desta
  // identidade — a lista da tela não autoriza nada por si só.
  const escolher = async (partnerUserId: string) => {
    setEnviando(true);
    setErro(null);
    try {
      const { data } = await clienteParceiro.post('/contexto', {
        email: email.trim(), senha, partner_user_id: partnerUserId,
      });
      concluir(data.token);
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível entrar nesta rede.'));
    } finally {
      setEnviando(false);
    }
  };

  if (contextos) {
    return (
      <Moldura>
        <h1 className="text-xl font-bold text-gray-800">Escolha a rede</h1>
        <p className="mt-1 text-sm text-gray-600">
          Seu e-mail tem acesso a mais de uma rede de parceiros. Escolha em qual quer entrar agora.
        </p>

        <div className="mt-4 space-y-2">
          {contextos.map((c) => (
            <button
              key={c.partner_user_id}
              type="button"
              onClick={() => escolher(c.partner_user_id)}
              disabled={enviando}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-sm hover:border-green-600 disabled:opacity-50"
            >
              <span className="block font-bold text-gray-800">{c.organizacao || 'Parceiro'}</span>
              {c.vinculado_em && (
                <span className="block text-xs text-gray-500">
                  Acesso desde {new Date(c.vinculado_em).toLocaleDateString('pt-BR')}
                </span>
              )}
            </button>
          ))}
        </div>

        {erro && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erro}</p>}

        <button
          type="button"
          onClick={() => { setContextos(null); setErro(null); }}
          className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600"
        >
          Voltar
        </button>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <h1 className="text-xl font-bold text-gray-800">Entrar</h1>
      <p className="mt-1 text-sm text-gray-600">Área do parceiro.</p>

      <label htmlFor="email" className="mt-4 block text-xs font-bold uppercase text-gray-600">E-mail</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="senha-login" className="mt-3 block text-xs font-bold uppercase text-gray-600">Senha</label>
      <input
        id="senha-login"
        type="password"
        autoComplete="current-password"
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
      />

      {erro && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erro}</p>}

      <button
        type="button"
        onClick={entrar}
        disabled={enviando}
        className="mt-4 w-full rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </Moldura>
  );
}

function LinkParaEntrar() {
  return (
    <p className="mt-4 text-center text-sm text-gray-600">
      Já ativou seu acesso?{' '}
      <Link to="/portal/parceiro/entrar" className="font-bold text-green-700 hover:underline">
        Entrar
      </Link>
    </p>
  );
}
// ── Lista ──────────────────────────────────────────────────────────────────────

function Lista() {
  const navegar = useNavigate();
  const [itens, setItens] = useState<Oportunidade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    clienteParceiro.get('/oportunidades')
      .then((r) => setItens(r.data?.itens || []))
      .catch((e) => setErro(mensagemDeErro(e, 'Não foi possível carregar suas oportunidades.')))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const abertas = useMemo(() => itens.filter((i) => i.estado === 'CURRENT'), [itens]);
  const encerradas = useMemo(() => itens.filter((i) => i.estado !== 'CURRENT'), [itens]);

  return (
    <Moldura>
      <h1 className="text-xl font-bold text-gray-800">Oportunidades</h1>
      <p className="mt-1 text-sm text-gray-600">Cargas que transportadoras compartilharam com você.</p>

      {carregando && <p className="mt-6 text-sm text-gray-500">Carregando…</p>}
      {erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erro}</p>}

      {!carregando && !erro && itens.length === 0 && (
        <div className="mt-8 text-center">
          <Package size={28} className="mx-auto text-gray-300" />
          <p className="mt-2 text-sm text-gray-600">Nenhuma oportunidade por enquanto.</p>
          <p className="mt-1 text-xs text-gray-500">Quando uma transportadora compartilhar uma carga, ela aparece aqui.</p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {abertas.map((o) => <Cartao key={o.recipient_id} o={o} aoAbrir={() => navegar(`/portal/parceiro/oportunidades/${o.recipient_id}`)} />)}
      </div>

      {encerradas.length > 0 && (
        <>
          <p className="mt-6 text-xs font-bold uppercase tracking-wider text-gray-500">Encerradas</p>
          <div className="mt-2 space-y-3 opacity-70">
            {encerradas.map((o) => <Cartao key={o.recipient_id} o={o} aoAbrir={() => navegar(`/portal/parceiro/oportunidades/${o.recipient_id}`)} />)}
          </div>
        </>
      )}
    </Moldura>
  );
}

function Cartao({ o, aoAbrir }: { o: Oportunidade; aoAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-colors hover:bg-gray-50"
    >
      <p className="font-bold text-gray-800">{o.cargo_descricao}</p>
      <p className="mt-1 text-2xl font-bold text-green-700">{quantidade(o.quantidade, o.quantidade_unidade)}</p>
      <p className="mt-1 text-xs text-gray-500">{janela(o.janela_inicio, o.janela_fim)}</p>
      {o.prazo_resposta && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
          <Clock size={12} /> Responder até {dataCurta(o.prazo_resposta)}
        </p>
      )}
      {o.estado !== 'CURRENT' && (
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          {o.estado === 'WITHDRAWN' ? 'Retirada pela transportadora' : 'Não vale mais como pedido atual'}
        </p>
      )}
    </button>
  );
}

// ── Detalhe + resposta ─────────────────────────────────────────────────────────

function Detalhe() {
  const { recipientId } = useParams();
  const navegar = useNavigate();
  const [oportunidade, setOportunidade] = useState<Oportunidade | null>(null);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [situacao, setSituacao] = useState<Revisao['situacao'] | null>(null);
  const [capacidade, setCapacidade] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    clienteParceiro.get(`/oportunidades/${recipientId}`)
      .then((r) => {
        setOportunidade({ ...r.data.oportunidade, recipient_id: r.data.recipient_id });
        setRevisoes(r.data.minhas_respostas || []);
      })
      .catch((e) => setErro(mensagemDeErro(e, 'Não foi possível abrir esta oportunidade.')))
      .finally(() => setCarregando(false));
  }, [recipientId]);

  useEffect(() => { carregar(); }, [carregar]);

  const responder = async () => {
    if (!situacao || !oportunidade) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      await clienteParceiro.post(`/oportunidades/${recipientId}/responder`, {
        situacao,
        capacidade_quantidade: situacao === 'DECLINED' ? null : Number(capacidade),
        // A unidade é sempre a do pedido: o parceiro não escolhe, para não haver
        // conversão implícita entre kg e ton.
        capacidade_unidade: situacao === 'DECLINED' ? null : oportunidade.quantidade_unidade,
        nota: nota.trim() || null,
        client_request_id: `resp-${recipientId}-${Date.now().toString(36)}`,
      });
      setSituacao(null);
      setCapacidade('');
      setNota('');
      carregar();
    } catch (e) {
      setErroEnvio(mensagemDeErro(e, 'Não foi possível enviar sua resposta.'));
    } finally {
      setEnviando(false);
    }
  };

  if (carregando) return <Moldura><p className="text-sm text-gray-500">Carregando…</p></Moldura>;
  if (erro || !oportunidade) {
    return <Moldura><p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p></Moldura>;
  }

  const aberta = oportunidade.estado === 'CURRENT';
  const jaRespondeu = revisoes.length > 0;

  return (
    <Moldura>
      <button
        type="button"
        onClick={() => navegar('/portal/parceiro/oportunidades')}
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-800"
      >
        <ArrowLeft size={16} /> Voltar
      </button>

      <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="font-bold text-gray-800">{oportunidade.cargo_descricao}</p>
        <p className="mt-1 text-3xl font-bold text-green-700">
          {quantidade(oportunidade.quantidade, oportunidade.quantidade_unidade)}
        </p>
        {(oportunidade.origem_resumo || oportunidade.destino_resumo) && (
          <p className="mt-2 text-sm text-gray-600">
            {oportunidade.origem_resumo || '—'} → {oportunidade.destino_resumo || '—'}
          </p>
        )}
        <p className="mt-1 text-sm text-gray-600">Janela: {janela(oportunidade.janela_inicio, oportunidade.janela_fim)}</p>
        {oportunidade.prazo_resposta && (
          <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-700">
            <Clock size={14} /> Responder até {dataCurta(oportunidade.prazo_resposta)}
          </p>
        )}
        {oportunidade.mensagem && (
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{oportunidade.mensagem}</p>
        )}
      </div>

      {!aberta && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {oportunidade.estado === 'WITHDRAWN'
            ? 'A transportadora retirou esta oportunidade.'
            : 'Esta oportunidade mudou e não aceita mais respostas. Aguarde um novo pedido.'}
        </p>
      )}

      {jaRespondeu && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Suas respostas</p>
          <div className="mt-2 space-y-2">
            {revisoes.map((r) => (
              <div key={r.revisao} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-gray-800">{ROTULO_SITUACAO[r.situacao]}</span>
                  <span className="text-xs text-gray-500">
                    {r.revisao > 1 ? `revisão ${r.revisao}` : 'primeira resposta'} · {dataCurta(r.criado_em)}
                  </span>
                </div>
                {r.capacidade_quantidade != null && (
                  <p className="mt-1 text-sm text-gray-700">
                    {quantidade(r.capacidade_quantidade, r.capacidade_unidade || '')}
                  </p>
                )}
                {r.nota && <p className="mt-1 text-xs text-gray-600">{r.nota}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {aberta && (
        <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-800">
            {jaRespondeu ? 'Revisar sua resposta' : 'Sua resposta'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Informe apenas a capacidade que você consegue atender. Valores comerciais são tratados
            fora do sistema.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2">
            {(['AVAILABLE', 'PARTIALLY_AVAILABLE', 'DECLINED'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSituacao(s)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors ${
                  situacao === s ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {s === 'DECLINED' ? <X size={16} /> : <Check size={16} />}
                {ROTULO_SITUACAO[s]}
              </button>
            ))}
          </div>

          {situacao && situacao !== 'DECLINED' && (
            <div className="mt-3">
              <label htmlFor="capacidade" className="block text-xs font-bold uppercase text-gray-600">
                Quanto você consegue atender ({oportunidade.quantidade_unidade})
              </label>
              <input
                id="capacidade"
                type="number"
                inputMode="decimal"
                min="0"
                max={oportunidade.quantidade}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                value={capacidade}
                onChange={(e) => setCapacidade(e.target.value)}
                placeholder={`Até ${oportunidade.quantidade}`}
              />
            </div>
          )}

          {situacao && (
            <>
              <label htmlFor="nota" className="mt-3 block text-xs font-bold uppercase text-gray-600">
                Observação
              </label>
              <textarea
                id="nota"
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Opcional"
              />
            </>
          )}

          {erroEnvio && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erroEnvio}</p>
          )}

          <button
            type="button"
            onClick={responder}
            disabled={!situacao || enviando}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            <Send size={16} />
            {enviando ? 'Enviando…' : jaRespondeu ? 'Enviar revisão' : 'Enviar resposta'}
          </button>
        </div>
      )}
    </Moldura>
  );
}

// ── Moldura ────────────────────────────────────────────────────────────────────

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white px-4 py-3">
        <p className="text-sm font-bold text-green-800">Matopiba Log · Parceiros</p>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-5">{children}</main>
    </div>
  );
}

function ExigirSessao({ children }: { children: React.ReactNode }) {
  if (!localStorage.getItem(CHAVE_SESSAO)) {
    // Mandar de volta ao link do convite era conselho impossível: o convite é de
    // uso único e já foi consumido. O caminho certo é entrar.
    return <Navigate to="/portal/parceiro/entrar" replace />;
  }
  return <>{children}</>;
}

export default function PartnerApp() {
  return (
    <Routes>
      <Route path="ativar" element={<Ativar />} />
      <Route path="entrar" element={<Entrar />} />
      <Route path="oportunidades" element={<ExigirSessao><Lista /></ExigirSessao>} />
      <Route path="oportunidades/:recipientId" element={<ExigirSessao><Detalhe /></ExigirSessao>} />
      <Route path="*" element={<Navigate to="/portal/parceiro/oportunidades" replace />} />
    </Routes>
  );
}
