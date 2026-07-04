import React, { useState, useEffect } from 'react';
import { Receipt, AlertCircle, ExternalLink } from 'lucide-react';
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
}

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  pago:     { label: 'Pago',     color: 'bg-green-100 text-green-800'  },
  vencido:  { label: 'Vencido',  color: 'bg-red-100 text-red-800'      },
  cancelado:{ label: 'Cancelado',color: 'bg-gray-100 text-gray-800'    },
  estornado:{ label: 'Estornado',color: 'bg-purple-100 text-purple-800'},
};

export const MinhasFaturas: React.FC = () => {
  const { user } = useAuth();
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [planoStatus, setPlanoStatus] = useState<PlanoStatus | null>(null);
  const [erroPlano, setErroPlano] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    setErro(null);
    setErroPlano(null);
    setFaturas([]);
    setPlanoStatus(null);

    const carregarDados = async () => {
      const [resultadoFaturas, resultadoPlano] = await Promise.allSettled([
        api.get(`/pagamentos/cobrancas/${user.uid}`),
        api.get('/pagamentos/plano-status'),
      ]);

      if (resultadoFaturas.status === 'fulfilled') {
        const dados: Fatura[] = resultadoFaturas.value.data || [];
        // Ordenar por due_date antes de separar próxima/histórico
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

      setLoading(false);
    };

    carregarDados();
  }, [user?.uid]);

  const proximaFatura = faturas.find(f => f.status === 'pendente' || f.status === 'vencido');
  const historico     = faturas.filter(f => f !== proximaFatura);
  const requerRegularizacao = ['suspenso', 'expirado', 'bloqueado'].includes(planoStatus?.status || '') || planoStatus?.trial_expirado;

  const obterBannerPlano = () => {
    const status = planoStatus?.status;
    if (status === 'ativo') return {
      titulo: 'Plano ativo',
      texto: 'Seu plano está ativo.',
      classes: 'bg-green-50 border-green-200 text-green-800',
    };
    if (status === 'trial') {
      const data = planoStatus?.trial_ends_at
        ? new Date(planoStatus.trial_ends_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : null;
      return planoStatus?.trial_expirado ? {
        titulo: 'Período de teste expirado',
        texto: data ? `Seu teste expirou em ${data}.` : 'Seu período de teste expirou.',
        classes: 'bg-red-50 border-red-200 text-red-800',
      } : {
        titulo: 'Período de teste',
        texto: data ? `Seu teste expira em ${data}.` : 'Sua empresa está no período de teste.',
        classes: 'bg-blue-50 border-blue-200 text-blue-800',
      };
    }
    if (status === 'suspenso') return {
      titulo: 'Plano suspenso',
      texto: 'Regularize sua situação para recuperar o acesso aos recursos operacionais.',
      classes: 'bg-red-50 border-red-200 text-red-800',
    };
    if (status === 'expirado') return {
      titulo: 'Plano expirado',
      texto: 'Seu plano expirou. Verifique suas faturas ou entre em contato com o suporte.',
      classes: 'bg-red-50 border-red-200 text-red-800',
    };
    if (status === 'bloqueado') return {
      titulo: 'Plano bloqueado',
      texto: 'Seu acesso operacional está bloqueado. Entre em contato com o suporte.',
      classes: 'bg-red-50 border-red-200 text-red-800',
    };
    return {
      titulo: 'Status do plano',
      texto: status ? `Status atual: ${status}.` : 'Status não informado.',
      classes: 'bg-gray-50 border-gray-200 text-gray-700',
    };
  };

  const bannerPlano = planoStatus ? obterBannerPlano() : null;

  return (
    <div className="space-y-6 pb-20 px-6">

      <div className="flex items-center gap-3">
        <Receipt className="text-blue-600" size={28} />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Minhas Faturas</h2>
          <p className="text-gray-500 text-sm">Acompanhe as faturas da sua empresa</p>
        </div>
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

      {!loading && bannerPlano && (
        <div className={`rounded-xl border p-5 ${bannerPlano.classes}`}>
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold">{bannerPlano.titulo}</h3>
              <p className="text-sm mt-1">{bannerPlano.texto}</p>
              {planoStatus?.plano && (
                <p className="text-xs mt-2 opacity-80">
                  {planoStatus.plano.nome} · R$ {Number(planoStatus.plano.preco_mensal).toFixed(2)}/mês · até {planoStatus.plano.limite_motoristas} motoristas
                </p>
              )}
            </div>
          </div>
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
              ? 'Entre em contato com o suporte para emissão da cobrança.'
              : 'Quando uma cobrança for emitida, ela aparecerá aqui.'}
          </p>
        </div>
      )}

      {!loading && !erro && faturas.length > 0 && (
        <>
          {proximaFatura ? (
            <div className={`rounded-xl p-6 border-2 shadow-sm ${
              proximaFatura.status === 'vencido'
                ? 'border-red-300 bg-red-50'
                : 'border-yellow-300 bg-yellow-50'
            }`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                {proximaFatura.status === 'vencido' ? '⚠️ Fatura Vencida' : 'Próxima Fatura'}
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-3xl font-bold text-gray-800">
                    R$ {Number(proximaFatura.valor).toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    Vencimento:{' '}
                    {proximaFatura.due_date
                      ? new Date(proximaFatura.due_date + 'T00:00:00').toLocaleDateString('pt-BR')
                      : '—'}
                  </div>
                </div>
                <span className={`self-start sm:self-auto px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${statusMap[proximaFatura.status]?.color}`}>
                  {statusMap[proximaFatura.status]?.label}
                </span>
              </div>
              {proximaFatura.invoice_url && (
                <div className="mt-4">
                  <a
                    href={proximaFatura.invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white rounded-xl font-bold text-sm transition-colors"
                  >
                    <ExternalLink size={16} /> Pagar fatura
                  </a>
                  <p className="text-[11px] text-gray-400 mt-2">Os pagamentos são processados em ambiente seguro pelo Asaas.</p>
                </div>
              )}
            </div>
          ) : (
            <div className={`rounded-xl p-5 border text-sm font-medium ${
              requerRegularizacao
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-green-50 border-green-200 text-green-700'
            }`}>
              {requerRegularizacao
                ? 'Não há fatura pendente disponível. Entre em contato com o suporte para regularizar.'
                : '✅ Nenhuma fatura pendente. Tudo em dia!'}
            </div>
          )}

          <div>
            <h3 className="text-base font-semibold text-gray-700 mb-3">Histórico</h3>
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
                        <th className="p-4 border-b">Vencimento</th>
                        <th className="p-4 border-b">Tipo</th>
                        <th className="p-4 border-b">Valor</th>
                        <th className="p-4 border-b">Status</th>
                        <th className="p-4 border-b">Pago em</th>
                        <th className="p-4 border-b">Fatura</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {historico.map(f => {
                        const st = statusMap[f.status] || { label: f.status, color: 'bg-gray-100 text-gray-800' };
                        return (
                          <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-4 text-sm text-gray-700">
                              {f.due_date
                                ? new Date(f.due_date + 'T00:00:00').toLocaleDateString('pt-BR')
                                : '—'}
                            </td>
                            <td className="p-4 text-sm text-gray-500">{f.tipo_pagamento || '—'}</td>
                            <td className="p-4 text-sm font-bold text-gray-800">
                              R$ {Number(f.valor).toFixed(2)}
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${st.color}`}>
                                {st.label}
                              </span>
                            </td>
                            <td className="p-4 text-sm text-gray-500">
                              {f.pago_em
                                ? new Date(f.pago_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                                : '—'}
                            </td>
                            <td className="p-4 text-sm">
                              {f.invoice_url ? (
                                <a
                                  href={f.invoice_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1 font-medium ${
                                    f.status === 'pendente' || f.status === 'vencido'
                                      ? 'text-green-700 hover:text-green-800'
                                      : 'text-blue-600 hover:text-blue-700'
                                  }`}
                                >
                                  <ExternalLink size={14} />
                                  {f.status === 'pendente' || f.status === 'vencido' ? 'Abrir fatura' : 'Ver fatura'}
                                </a>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
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
        </>
      )}
    </div>
  );
};
