import React, { useEffect, useState } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import { PlanosVitrine } from './PlanosVitrine';
import { normalizarRecursos } from '../utils/planosCatalogo';
import type { PlanoPublico } from '../utils/planosCatalogo';
import { useLoginConfig } from '../hooks/useLoginConfig';
import { montarLinkComercial } from '../utils/contatoComercial';
import { mensagemErro } from '../utils/mensagemErro';

// Comparador de planos embutido na aba "Plano e contratação".
//
// REGRA DESTA FRENTE (decisão do proprietário): escolher/solicitar um plano usa a
// AQUISIÇÃO EXPLÍCITA (POST /contratacao/iniciar), que cria uma proposta/contrato
// SEM cobrança e SEM tocar Asaas/Billing. NÃO usa o caminho pago
// (/pagamentos/upgrade/solicitar) e NÃO altera empresa.plano_id sozinho: o teste
// real de planos maiores continua via super-admin no painel. O trial não é
// encurtado. ERP/SSO aparecem como "Em breve" (matriz do catálogo), sem preço.
export const ComparadorPlanos: React.FC = () => {
  const { user } = useAuth();
  const { contactEmail, contactPhone, whatsappSuporte } = useLoginConfig();
  const [planos, setPlanos] = useState<PlanoPublico[]>([]);
  const [planoAtualId, setPlanoAtualId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const categoria = user?.empresa_tipo === 'autonomo' ? 'autonomo' : 'empresa';

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    Promise.all([
      api.get(`/planos/publicos?categoria=${categoria}`).catch(() => ({ data: { planos: [] } })),
      api.get('/contratacao/status').catch(() => ({ data: {} })),
    ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(([planosRes, statusRes]: [any, any]) => {
        if (!vivo) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const brutos: any[] = planosRes?.data?.planos || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lista: PlanoPublico[] = brutos.map((p: any) => ({
          ...p,
          preco_mensal: Number(p.preco_mensal) || 0,
          modelo_cobranca: p.modelo_cobranca === 'por_motorista' ? 'por_motorista' : 'fixo',
          preco_por_motorista: p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
          recursos: normalizarRecursos(p.recursos),
        }));
        setPlanos(lista);
        setPlanoAtualId(statusRes?.data?.plano_id || null);
        if (!lista.length) setErro('Nenhum plano disponível para comparação agora.');
      })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [categoria]);

  async function escolher(plano: PlanoPublico) {
    if (plano.requer_negociacao) return;
    if (plano.id === planoAtualId) { setAviso('Este já é o seu plano atual.'); setSucesso(null); return; }
    setEnviando(plano.id);
    setAviso(null);
    setSucesso(null);
    setErro('');
    try {
      await api.post('/contratacao/iniciar', { plano_id: plano.id });
      setSucesso(`Plano ${plano.nome} escolhido. Geramos uma proposta/contrato para você assinar quando quiser — nenhuma cobrança foi feita e seu teste segue ativo.`);
      try {
        const { data } = await api.get('/contratacao/status');
        if (data?.plano_id) setPlanoAtualId(data.plano_id);
      } catch { /* mantém o valor anterior */ }
    } catch (err) {
      setAviso(mensagemErro(err, 'Não foi possível registrar a escolha agora.'));
    } finally {
      setEnviando(null);
    }
  }

  const canal = montarLinkComercial(
    { whatsapp: whatsappSuporte, email: contactEmail, telefone: contactPhone },
    { assunto: 'Interesse no plano Enterprise - Matopiba Log', mensagem: 'Olá! Tenho interesse no plano Enterprise do Matopiba Log.' }
  );

  if (loading) {
    return <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-500">Carregando planos...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">Comparar planos</h3>
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 text-blue-800 rounded-xl p-3.5 text-sm">
          <Info size={18} className="mt-0.5 shrink-0" />
          <span>
            <b>Nenhuma cobrança é feita agora</b> e seu teste gratuito <b>não é encurtado</b>. Ao escolher um plano,
            geramos uma proposta/contrato para assinar quando quiser; o pagamento é uma etapa separada. Recursos de
            ERP e Acesso corporativo (SSO) aparecem como <b>"Em breve"</b> — em preparação, sem contratação automática.
          </span>
        </div>
        {sucesso && (
          <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3.5 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />{sucesso}
          </div>
        )}
        {aviso && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3.5 text-sm">{aviso}</div>}
        {erro && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3.5 text-sm">{erro}</div>}
      </div>
      {planos.length > 0 && (
        <PlanosVitrine
          planos={planos}
          onEscolher={escolher}
          planoSelecionadoId={planoAtualId}
          ctaSelecionadoLabel="✓ Plano atual"
          ctaLabel={(p) => (enviando === p.id ? 'Registrando...' : 'Escolher este plano')}
          negociacaoCta="Falar sobre Enterprise"
          negociacaoHint="Frotas acima de 40 motoristas — sob proposta personalizada."
          negociacaoHref={canal.href}
          negociacaoExterno={canal.externo}
          negociacaoTelHref={canal.telHref}
        />
      )}
    </div>
  );
};
