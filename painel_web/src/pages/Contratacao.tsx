import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Download, FileCheck2, FileText, KeyRound, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '../api';

type Contrato = {
  id: string;
  status: string;
  versao?: string;
  metodo_assinatura?: string | null;
  documento_pronto?: boolean;
  signed_storage_path?: string | null;
  certificate_storage_path?: string | null;
  signed_file_hash?: string | null;
  certificate_file_hash?: string | null;
  aceito_em?: string | null;
};

type ResumoContratacao = {
  plano_nome?: string | null;
  capacidade_inclusa?: number | string | null;
  quantidade_contratada?: number | string | null;
  preco_motorista_extra?: number | string | null;
  valor_mensal?: number | string | null;
  implantacao_gratis?: boolean | null;
  valor_implantacao?: number | string | null;
  total_inicial?: number | string | null;
  trial_dias?: number | string | null;
};

type Proposta = {
  id: string;
  status: string;
  resumo?: ResumoContratacao;
  valor_mensal?: number;
  valor_implantacao?: number;
  total_inicial?: number;
  trial_dias?: number;
  aceito_em?: string | null;
  contratos_comerciais?: Contrato[] | Contrato | null;
};

const brl = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

function mensagemErro(err: unknown, fallback: string) {
  if (typeof err === 'object' && err && 'response' in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message || fallback;
  }
  return fallback;
}

const statusLabel: Record<string, string> = {
  enviada: 'Proposta emitida',
  aceita: 'Proposta aceita',
  cancelada: 'Proposta cancelada',
  expirada: 'Proposta expirada',
  aguardando_assinatura: 'Aguardando assinatura',
  pronto_assinatura: 'Pronto para assinatura',
  aguardando_assinatura_cliente: 'Aguardando sua assinatura',
  aguardando_assinatura_matopiba: 'Aguardando Matopiba',
  plenamente_assinado: 'Contrato assinado',
  assinado: 'Contrato assinado',
  aceito_manualmente: 'Contrato concluido',
  recusado: 'Recusado',
  rascunho: 'Em preparacao',
};

function contratosDe(proposta?: Proposta | null): Contrato[] {
  const c = proposta?.contratos_comerciais;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

function etapaAtual(proposta?: Proposta | null, contrato?: Contrato | null) {
  if (!proposta) return 1;
  if (!contrato) return 3;
  if (['plenamente_assinado', 'assinado', 'aceito_manualmente'].includes(contrato.status)) return 9;
  if (contrato.status === 'aguardando_assinatura_matopiba') return 5;
  return 4;
}

function clientePodeAssinar(contrato?: Contrato | null) {
  if (!contrato) return false;
  return ['aguardando_assinatura', 'pronto_assinatura', 'aguardando_assinatura_cliente'].includes(contrato.status);
}

export const Contratacao: React.FC = () => {
  const [dados, setDados] = useState<{ propostas: Proposta[]; migration_pendente?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [abrindo, setAbrindo] = useState(false);
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [poderes, setPoderes] = useState(false);
  const [desafio, setDesafio] = useState<{ email_mascarado?: string; expires_at?: string } | null>(null);
  const [assinando, setAssinando] = useState(false);

  async function carregar() {
    setLoading(true);
    setErro('');
    try {
      const { data } = await api.get('/contratacao/minha');
      setDados(data);
    } catch (err: unknown) {
      setErro(mensagemErro(err, 'Nao foi possivel carregar sua contratacao agora.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => { void carregar(); }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const proposta = useMemo(() => dados?.propostas?.[0] || null, [dados]);
  const contrato = contratosDe(proposta)[0] || null;
  const resumo = proposta?.resumo || {};
  const etapa = etapaAtual(proposta, contrato);
  const podeAssinar = clientePodeAssinar(contrato);

  async function abrirContrato() {
    if (!contrato?.id) return;
    setAbrindo(true);
    setErro('');
    try {
      const { data } = await api.get(`/contratacao/contratos/${contrato.id}/assinado-url`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      setErro(mensagemErro(err, 'Contrato assinado ainda nao disponivel.'));
    } finally {
      setAbrindo(false);
    }
  }

  async function solicitarCodigo() {
    if (!contrato?.id || !senha.trim()) {
      setErro('Informe sua senha atual para receber o codigo.');
      return;
    }
    setAssinando(true);
    setErro('');
    setSucesso('');
    try {
      const { data } = await api.post(`/contratacao/contratos/${contrato.id}/assinatura/desafio`, { senha });
      setDesafio({ email_mascarado: data?.email_mascarado, expires_at: data?.expires_at });
      setSucesso(`Codigo enviado para ${data?.email_mascarado || 'seu e-mail'}.`);
      await carregar();
    } catch (err: unknown) {
      setErro(mensagemErro(err, 'Nao foi possivel enviar o codigo.'));
    } finally {
      setAssinando(false);
    }
  }

  async function confirmarCodigo() {
    if (!contrato?.id) return;
    if (!consentimento || !poderes) {
      setErro('Confirme o consentimento e a declaracao de poderes.');
      return;
    }
    if (!/^\d{6}$/.test(codigo)) {
      setErro('Informe o codigo de 6 digitos.');
      return;
    }
    setAssinando(true);
    setErro('');
    setSucesso('');
    try {
      await api.post(`/contratacao/contratos/${contrato.id}/assinatura/confirmar`, {
        codigo,
        consentimento_aceito: true,
        declaracao_poderes: true,
      });
      setSenha('');
      setCodigo('');
      setConsentimento(false);
      setPoderes(false);
      setDesafio(null);
      setSucesso('Assinatura registrada. Agora a Matopiba conclui a assinatura da outra parte.');
      await carregar();
    } catch (err: unknown) {
      setErro(mensagemErro(err, 'Nao foi possivel confirmar a assinatura.'));
    } finally {
      setAssinando(false);
    }
  }

  const passos = [
    'Empresa cadastrada',
    'Administrador criado',
    'Proposta emitida',
    'Assinatura do cliente',
    'Assinatura Matopiba',
    'Configuracao financeira',
    'Periodo de teste',
    'Configuracao inicial',
    'Pronto para operar',
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white border border-gray-100 rounded-lg p-4 shadow-sm flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Contratacao</h1>
          <p className="text-sm text-gray-500">Proposta, contrato e assinatura eletronica.</p>
        </div>
        <button
          type="button"
          onClick={carregar}
          disabled={loading}
          title="Atualizar"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {erro && <Aviso tipo="erro" texto={erro} />}
      {sucesso && <Aviso tipo="sucesso" texto={sucesso} />}

      {loading ? (
        <div className="bg-white border border-gray-100 rounded-lg p-8 text-sm text-gray-500">Carregando contratacao...</div>
      ) : !proposta ? (
        <div className="bg-white border border-gray-100 rounded-lg p-6 text-sm text-gray-600">
          Ainda nao ha proposta comercial vinculada a sua empresa.
        </div>
      ) : (
        <div className="grid xl:grid-cols-3 gap-4">
          <section className="xl:col-span-2 bg-white border border-gray-100 rounded-lg p-5 shadow-sm space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{resumo.plano_nome || 'Plano contratado'}</h2>
                <p className="text-sm text-gray-500">{statusLabel[proposta.status] || proposta.status}</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {contrato ? (statusLabel[contrato.status] || contrato.status) : 'Contrato em preparacao'}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <Info label="Capacidade incluida" value={`${resumo.capacidade_inclusa ?? '-'} motorista(s)`} />
              <Info label="Quantidade contratada" value={`${resumo.quantidade_contratada ?? '-'} motorista(s)`} />
              <Info label="Motoristas extras" value={resumo.preco_motorista_extra ? brl(resumo.preco_motorista_extra) : 'Nao aplicavel'} />
              <Info label="Mensalidade" value={brl(resumo.valor_mensal ?? proposta.valor_mensal)} />
              <Info label="Implantacao" value={resumo.implantacao_gratis ? 'Implantacao gratis' : brl(resumo.valor_implantacao ?? proposta.valor_implantacao)} />
              <Info label="Valor inicial" value={brl(resumo.total_inicial ?? proposta.total_inicial)} />
              <Info label="Teste gratis" value={`${resumo.trial_dias ?? proposta.trial_dias ?? 0} dias`} />
              <Info label="Recorrencia" value="Mensal" />
              <Info label="Metodo" value={contrato?.metodo_assinatura === 'interno_otp' ? 'Codigo por e-mail' : 'Manual'} />
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 text-sm text-gray-600">
              {contrato?.status === 'plenamente_assinado'
                ? 'Contrato assinado pelas duas partes. A etapa financeira continua separada.'
                : contrato?.status === 'aguardando_assinatura_matopiba'
                  ? 'Sua assinatura foi registrada. Aguardando a assinatura da Matopiba.'
                  : podeAssinar
                    ? 'Para assinar, confirme sua senha atual, receba o codigo no e-mail verificado e informe o codigo abaixo.'
                    : 'Acompanhe o andamento da contratacao nesta tela.'}
            </div>

            {podeAssinar && (
              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                  <ShieldCheck size={18} /> Assinatura eletronica
                </div>
                <div className="grid sm:grid-cols-[1fr_auto] gap-2">
                  <div className="relative">
                    <KeyRound size={16} className="absolute left-3 top-3 text-gray-400" />
                    <input
                      type="password"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder="Senha atual"
                      className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={solicitarCodigo}
                    disabled={assinando || !senha.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    <MailCheck size={16} /> Enviar codigo
                  </button>
                </div>
                {desafio && (
                  <div className="space-y-3">
                    <div className="text-xs text-gray-500">
                      Codigo enviado para {desafio.email_mascarado || 'seu e-mail'}.
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Codigo de 6 digitos"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} className="mt-1" />
                      <span>Li o contrato e aceito assinar eletronicamente com codigo de confirmacao.</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={poderes} onChange={(e) => setPoderes(e.target.checked)} className="mt-1" />
                      <span>Declaro que tenho poderes para representar a empresa nesta contratacao.</span>
                    </label>
                    <button
                      type="button"
                      onClick={confirmarCodigo}
                      disabled={assinando || codigo.length !== 6 || !consentimento || !poderes}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                    >
                      <FileCheck2 size={16} /> Confirmar assinatura
                    </button>
                  </div>
                )}
              </div>
            )}

            {contrato?.signed_storage_path && (
              <button
                type="button"
                onClick={abrirContrato}
                disabled={abrindo}
                className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
              >
                <Download size={16} /> {abrindo ? 'Abrindo...' : 'Baixar contrato assinado'}
              </button>
            )}
          </section>

          <aside className="bg-white border border-gray-100 rounded-lg p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Proximos passos</h2>
            <ol className="space-y-3">
              {passos.map((p, idx) => {
                const n = idx + 1;
                const done = n < etapa || etapa === 9;
                const active = n === etapa && etapa !== 9;
                return (
                  <li key={p} className="flex items-start gap-3 text-sm">
                    {done ? <CheckCircle2 className="text-green-600 shrink-0" size={18} /> : <Clock className={active ? 'text-blue-600 shrink-0' : 'text-gray-300 shrink-0'} size={18} />}
                    <div>
                      <div className={done ? 'font-medium text-gray-900' : active ? 'font-semibold text-blue-700' : 'text-gray-500'}>{p}</div>
                      {active && <div className="text-xs text-gray-500 mt-0.5">Etapa atual</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
};

function Aviso({ tipo, texto }: { tipo: 'erro' | 'sucesso'; texto: string }) {
  const ok = tipo === 'sucesso';
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
      {ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
      <span>{texto}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-400">
        <FileText size={13} /> {label}
      </div>
      <div className="mt-1 font-semibold text-gray-900">{value}</div>
    </div>
  );
}
