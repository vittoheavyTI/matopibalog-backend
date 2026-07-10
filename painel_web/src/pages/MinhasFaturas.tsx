import React, { useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Receipt, AlertCircle, ExternalLink, RefreshCw, Copy, QrCode, X, Download } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

interface Fatura {
  id: string;
  empresa_id: string;
  asaas_id: string;
  valor: number;
  tipo_pagamento: 'PIX' | 'BOLETO' | 'CARTAO';
  status: 'pendente' | 'pago' | 'vencido' | 'cancelado' | 'estornado';
  invoice_url: string;
  bank_slip_url?: string;
  pix_qr_code: string;
  due_date: string;
  pago_em: string;
  created_at: string;
}

interface PlanoStatus {
  status: string;
  trial_ends_at: string | null;
  trial_expirado: boolean;
  plano_id: string | null;
  plano: {
    nome: string;
    preco_mensal: number;
    limite_motoristas: number;
  } | null;
  empresa_tipo?: string;
  regularizacao?: {
    responsavel: string;
    suporte_email: string | null;
  };
}

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago:     { label: 'Pago',     color: 'bg-green-100 text-green-800'  },
  vencido:  { label: 'Vencido',  color: 'bg-red-100 text-red-800'      },
  cancelado:{ label: 'Cancelado',color: 'bg-gray-100 text-gray-800'    },
  estornado:{ label: 'Estornado',color: 'bg-purple-100 text-purple-800'},
};

function formatarData(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

function validarUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getTipoLabel(tipo?: string): string {
  if (tipo === 'BOLETO') return 'Boleto + Pix';
  if (tipo === 'PIX') return 'Pix';
  if (tipo === 'CREDIT_CARD' || tipo === 'CARTAO') return 'Cartão';
  return 'Escolha a forma de pagamento';
}

export const MinhasFaturas: React.FC = () => {
  const { user } = useAuth();
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [planoStatus, setPlanoStatus] = useState<PlanoStatus | null>(null);
  const [erroPlano, setErroPlano] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [erroSync, setErroSync] = useState<string | null>(null);
  // Modal Pix
  const [pixModal, setPixModal] = useState<{ faturaId: string; qrCode: string; copiaCola: string } | null>(null);
  const [pixCarregando, setPixCarregando] = useState(false);
  const [pixCopiado, setPixCopiado] = useState(false);
  const pixTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    if (user?.is_super_admin) return;
    carregarDados();
  }, [user?.uid]);

  // Limpa modal Pix ao fechar
  useEffect(() => {
    if (!pixModal) {
      setPixCopiado(false);
      if (pixTimeoutRef.current) clearTimeout(pixTimeoutRef.current);
    }
  }, [pixModal]);

  const carregarDados = async () => {
    setLoading(true);
    setErro(null);
    setErroPlano(null);
    setFaturas([]);
    setPlanoStatus(null);

    try {
      const [resultadoFaturas, resultadoPlano] = await Promise.allSettled([
        api.get(`/pagamentos/cobrancas/${user!.uid}`),
        api.get('/pagamentos/plano-status'),
      ]);

      if (resultadoFaturas.status === 'fulfilled') {
        const dados: Fatura[] = resultadoFaturas.value.data || [];
        dados.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        });
        setFaturas(dados);
      } else {
        setErro('Não foi possível carregar suas faturas.');
      }

      if (resultadoPlano.status === 'fulfilled') {
        setPlanoStatus(resultadoPlano.value.data);
      } else {
        const mensagem = resultadoPlano.reason?.response?.data?.message;
        setErroPlano(mensagem || 'Não foi possível carregar o status do plano.');
      }
    } finally {
      setLoading(false);
    }

    // Sincronização em segundo plano (best-effort)
    sincronizar(false);
  };

  const sincronizar = async (manual: boolean = true) => {
    if (sincronizando) return;
    setSincronizando(true);
    setErroSync(null);
    try {
      await api.post('/pagamentos/minhas-faturas/sincronizar');
      // Recarrega os dados locais após sincronizar
      const response = await api.get(`/pagamentos/cobrancas/${user!.uid}`);
      if (response.data) {
        const dados: Fatura[] = response.data || [];
        dados.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        });
        setFaturas(dados);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao sincronizar.';
      if (manual) setErroSync(msg);
    } finally {
      setSincronizando(false);
    }
  };

  const abrirPix = async (fatura: Fatura) => {
    // Se já tem QR code local, abre direto
    if (fatura.pix_qr_code) {
      setPixModal({ faturaId: fatura.id, qrCode: fatura.pix_qr_code, copiaCola: fatura.pix_qr_code });
      return;
    }
    setPixCarregando(true);
    try {
      const { data } = await api.get(`/pagamentos/faturas/${fatura.id}/pix`);
      setPixModal({ faturaId: fatura.id, qrCode: data.pix_qr_code, copiaCola: data.pix_qr_code });
    } catch {
      // Se falhou, tenta abrir invoice_url como fallback
      if (fatura.invoice_url && validarUrl(fatura.invoice_url)) {
        window.open(fatura.invoice_url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setPixCarregando(false);
    }
  };

  const copiarPix = () => {
    if (pixModal?.copiaCola) {
      navigator.clipboard?.writeText(pixModal.copiaCola);
      setPixCopiado(true);
      if (pixTimeoutRef.current) clearTimeout(pixTimeoutRef.current);
      pixTimeoutRef.current = setTimeout(() => setPixCopiado(false), 2000);
    }
  };

  // Super-admin vai para painel admin
  if (user?.is_super_admin) {
    return <Navigate to="/painel-administrativo/financeiro?aba=faturas" replace />;
  }

  const trialAtivo = planoStatus?.status === 'trial' && !planoStatus?.trial_expirado;
  const trialEndsAt = planoStatus?.trial_ends_at;
  const trialData = trialEndsAt ? formatarData(trialEndsAt.split('T')[0]) : null;

  // Separa próxima fatura e histórico
  const pendentes = faturas.filter(f => f.status === 'pendente' || f.status === 'vencido');
  // Ordena pendentes por due_date ascendente (a mais próxima primeiro)
  pendentes.sort((a, b) => {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });
  const proximaFatura = pendentes.length > 0 ? pendentes[0] : null;
  // Histórico: as demais faturas, ordenadas da mais recente para a mais antiga por due_date
  const historico = faturas
    .filter(f => f !== proximaFatura)
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
    });

  const requerRegularizacao = ['suspenso', 'expirado', 'bloqueado'].includes(planoStatus?.status || '') || planoStatus?.trial_expirado;
  const suporteEmail = planoStatus?.regularizacao?.suporte_email;
  const suporteHref = suporteEmail
    ? `mailto:${suporteEmail}?subject=${encodeURIComponent('Solicitação de regularização do plano')}`
    : null;

  const bannerPlano = (() => {
    const status = planoStatus?.status;
    if (status === 'ativo') return {
      titulo: 'Plano ativo',
      texto: 'Seu plano está ativo.',
      classes: 'bg-green-50 border-green-200 text-green-800',
    };
    if (status === 'trial') {
      if (planoStatus?.trial_expirado) return {
        titulo: 'Período de teste expirado',
        texto: trialData ? `Seu teste expirou em ${trialData}.` : 'Seu período de teste expirou.',
        classes: 'bg-red-50 border-red-200 text-red-800',
      };
      return {
        titulo: 'Período de teste',
        texto: trialData ? `Seu período de teste permanece ativo até ${trialData}.` : 'Sua empresa está no período de teste.',
        classes: 'bg-blue-50 border-blue-200 text-blue-800',
      };
    }
    if (status === 'suspenso') return {
      titulo: 'Conta suspensa',
      texto: proximaFatura?.invoice_url
        ? 'Sua conta está suspensa. Pague a fatura pendente para recuperar o acesso.'
        : 'Sua conta está suspensa. Entre em contato com o suporte para regularizar.',
      classes: 'bg-red-50 border-red-200 text-red-800',
    };
    if (status === 'expirado' || status === 'bloqueado') return {
      titulo: status === 'expirado' ? 'Plano expirado' : 'Plano bloqueado',
      texto: 'Seu acesso operacional está bloqueado. Entre em contato com o suporte.',
      classes: 'bg-red-50 border-red-200 text-red-800',
    };
    return {
      titulo: 'Status do plano',
      texto: status ? `Status atual: ${status}.` : 'Status não informado.',
      classes: 'bg-gray-50 border-gray-200 text-gray-700',
    };
  })();

  return (
    <div className="space-y-6 pb-20 px-6">

      <div className="flex items-center gap-3">
        <Receipt className="text-blue-600" size={28} />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Faturas e Regularização</h2>
          <p className="text-gray-500 text-sm">Acompanhe suas mensalidades e realize pagamentos</p>
        </div>
      </div>

      {/* Sincronização */}
      <div className="flex items-center justify-end gap-2">
        {erroSync && <span className="text-xs text-red-500">{erroSync}</span>}
        <button
          onClick={() => sincronizar(true)}
          disabled={sincronizando}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
          {sincronizando ? 'Sincronizando…' : 'Atualizar status'}
        </button>
      </div>

      {loading && (
        <div className="p-8 text-center text-gray-500">Carregando...</div>
      )}

      {erro && (
        <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-xl">
          <AlertCircle size={18} /> {erro}
        </div>
      )}

      {!loading && erroPlano && (
        <div className="flex items-center gap-2 p-4 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl">
          <AlertCircle size={18} /> {erroPlano}
        </div>
      )}

      {!loading && (
        <div className={`rounded-xl border p-5 ${bannerPlano.classes}`}>
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-bold">{bannerPlano.titulo}</h3>
              <p className="text-sm mt-1">{bannerPlano.texto}</p>
              {planoStatus?.plano && (
                <p className="text-xs mt-2 opacity-80">
                  {planoStatus.plano.nome} · R$ {Number(planoStatus.plano.preco_mensal).toFixed(2)}/mês
                </p>
              )}
              {requerRegularizacao && suporteHref && !proximaFatura && (
                <a href={suporteHref} className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-bold">
                  <ExternalLink size={15} /> Solicitar regularização
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Próxima mensalidade */}
      {!loading && proximaFatura && (
        <div className={`rounded-xl p-6 border-2 shadow-sm ${
          proximaFatura.status === 'vencido'
            ? 'border-red-300 bg-red-50'
            : trialAtivo
              ? 'border-blue-300 bg-blue-50'
              : 'border-yellow-300 bg-yellow-50'
        }`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
            {trialAtivo ? 'Próxima mensalidade' : proximaFatura.status === 'vencido' ? '⚠️ Fatura Vencida' : 'Próxima Fatura'}
          </p>

          {trialAtivo && trialData && (
            <p className="text-sm font-medium text-blue-700 mb-3">
              A vencer — período de teste ativo
            </p>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-3xl font-bold text-gray-800">
                R$ {Number(proximaFatura.valor).toFixed(2)}
              </div>
              <div className="text-sm text-gray-500 mt-1">
                Plano {planoStatus?.plano?.nome || '—'} · Vencimento: {formatarData(proximaFatura.due_date)}
              </div>
            </div>
            <span className={`self-start sm:self-auto px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-widest ${statusMap[proximaFatura.status]?.color}`}>
              {proximaFatura.status === 'pendente' ? (trialAtivo ? 'A vencer' : 'Pendente') : statusMap[proximaFatura.status]?.label}
            </span>
          </div>

          {trialAtivo && trialData && (
            <p className="text-sm text-blue-600 mt-3">
              Seu período de teste permanece ativo até {trialData}. Você pode pagar antecipadamente.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {proximaFatura.invoice_url && validarUrl(proximaFatura.invoice_url) && (
              <a
                href={proximaFatura.invoice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white rounded-xl font-bold text-sm transition-colors"
              >
                <ExternalLink size={16} /> Pagar agora
              </a>
            )}
            {(proximaFatura.tipo_pagamento === 'PIX' || proximaFatura.tipo_pagamento === 'BOLETO') && (
              <button
                onClick={() => abrirPix(proximaFatura)}
                disabled={pixCarregando}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                <QrCode size={16} /> {pixCarregando ? 'Carregando…' : 'Pix'}
              </button>
            )}
            {proximaFatura.invoice_url && validarUrl(proximaFatura.invoice_url) && (
              <a
                href={proximaFatura.invoice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl font-semibold text-sm transition-colors"
              >
                <Download size={16} /> Boleto
              </a>
            )}
          </div>

          <p className="text-[11px] text-gray-400 mt-3">
            Os pagamentos são processados em ambiente seguro pelo Asaas.
            {getTipoLabel(proximaFatura.tipo_pagamento) !== 'Escolha a forma de pagamento' && (
              <> Forma: {getTipoLabel(proximaFatura.tipo_pagamento)}.</>
            )}
          </p>
        </div>
      )}

      {!loading && !proximaFatura && faturas.length > 0 && (
        <div className="rounded-xl p-5 border text-sm font-medium bg-green-50 border-green-200 text-green-700">
          ✅ Nenhuma fatura pendente. Tudo em dia!
        </div>
      )}

      {!loading && !erro && faturas.length === 0 && (
        <div className="rounded-xl p-8 bg-white border border-gray-100 text-center">
          <Receipt className="mx-auto text-gray-300 mb-3" size={40} />
          <p className="text-gray-600 font-medium">
            {requerRegularizacao
              ? 'Não há fatura disponível para regularização no momento.'
              : 'Nenhuma fatura disponível no momento.'}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            {requerRegularizacao
              ? (suporteEmail ? `Solicite a regularização pelo suporte: ${suporteEmail}.` : 'Entre em contato com o suporte para emissão da cobrança.')
              : 'Quando uma cobrança for emitida, ela aparecerá aqui.'}
          </p>
        </div>
      )}

      {/* Histórico */}
      {!loading && faturas.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-gray-700 mb-3">Histórico de mensalidades</h3>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {historico.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Nenhum histórico disponível.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600 text-xs font-bold uppercase tracking-wider">
                      <th className="p-4 border-b">Descrição</th>
                      <th className="p-4 border-b">Valor</th>
                      <th className="p-4 border-b">Vencimento</th>
                      <th className="p-4 border-b">Status</th>
                      <th className="p-4 border-b">Forma</th>
                      <th className="p-4 border-b">Pago em</th>
                      <th className="p-4 border-b">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {historico.map(f => {
                      const st = statusMap[f.status] || { label: f.status, color: 'bg-gray-100 text-gray-800' };
                      return (
                        <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-4 text-sm text-gray-700">
                            {planoStatus?.plano ? `Mensalidade ${planoStatus.plano.nome}` : 'Assinatura'}
                          </td>
                          <td className="p-4 text-sm font-bold text-gray-800">
                            R$ {Number(f.valor).toFixed(2)}
                          </td>
                          <td className="p-4 text-sm text-gray-700">
                            {formatarData(f.due_date)}
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${st.color}`}>
                              {st.label}
                            </span>
                          </td>
                          <td className="p-4 text-sm text-gray-500">{getTipoLabel(f.tipo_pagamento)}</td>
                          <td className="p-4 text-sm text-gray-500">
                            {f.pago_em
                              ? new Date(f.pago_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                              : '—'}
                          </td>
                          <td className="p-4 text-sm">
                            <div className="flex items-center gap-1">
                              {f.invoice_url && validarUrl(f.invoice_url) && (
                                <a
                                  href={f.invoice_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1 font-medium ${f.status === 'pendente' || f.status === 'vencido' ? 'text-green-700 hover:text-green-800' : 'text-blue-600 hover:text-blue-700'}`}
                                >
                                  <ExternalLink size={14} />
                                  {f.status === 'pendente' || f.status === 'vencido' ? 'Abrir fatura' : 'Ver fatura'}
                                </a>
                              )}
                              {(f.tipo_pagamento === 'PIX' || f.tipo_pagamento === 'BOLETO') && f.status !== 'pago' && (
                                <button
                                  onClick={() => abrirPix(f)}
                                  className="text-gray-400 hover:text-green-700 p-1"
                                  title="Pix"
                                >
                                  <QrCode size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Pix */}
      {pixModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPixModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">Pix</h3>
              <button onClick={() => setPixModal(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* QR Code de mentirinha (será real quando o backend servir a imagem) */}
              <div className="flex justify-center">
                <div className="w-48 h-48 bg-gray-100 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center text-gray-400 text-xs text-center p-2">
                  QR Code Pix
                  <br />
                  {pixModal.copiaCola.slice(0, 20)}...
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Código Pix Copia e Cola</label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={pixModal.copiaCola}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 bg-gray-50"
                  />
                  <button
                    onClick={copiarPix}
                    className="p-1.5 text-gray-500 hover:text-green-700"
                    title="Copiar"
                  >
                    <Copy size={15} />
                  </button>
                </div>
                {pixCopiado && <p className="text-xs text-green-600 mt-1">Copiado!</p>}
              </div>
              <p className="text-[11px] text-gray-400 text-center">
                O código Pix expira em alguns minutos.
              </p>
              <button
                onClick={() => setPixModal(null)}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-4 py-2.5 rounded-xl"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
