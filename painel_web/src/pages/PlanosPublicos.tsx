import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Truck, X } from 'lucide-react';
import api, { newClientRequestId } from '../api';
import { mensagemErro } from '../utils/mensagemErro';
import { useLoginConfig } from '../hooks/useLoginConfig';
import { useAuth } from '../contexts/AuthContext';
import { PlanosVitrine } from '../components/PlanosVitrine';
import { normalizarRecursos } from '../utils/planosCatalogo';
import type { PlanoPublico } from '../utils/planosCatalogo';

// Fallback local mínimo — usado APENAS se a API pública falhar, para a página de
// planos não ficar em branco. O backend (/planos/publicos) é a fonte principal.
// Os ids aqui são aliases legados (não-UUID) e navegam via ?plano=<alias>.
const PLANOS_FALLBACK: PlanoPublico[] = [
  { id: 'basico', nome: 'Plano Básico', descricao: 'Para pequenas frotas', preco_mensal: 49.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 3, dias_trial: 7, recursos: ['Gestão de fretes', 'Relatórios básicos', 'Suporte via email'] },
  { id: 'profissional', nome: 'Plano Profissional', descricao: 'Para frotas em crescimento', preco_mensal: 99.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: 10, dias_trial: 7, recursos: ['Gestão de fretes + despesas', 'Relatórios avançados', 'Suporte prioritário', 'App motorista'] },
  { id: 'empresarial', nome: 'Plano Enterprise', descricao: 'Para operações completas', preco_mensal: 199.9, modelo_cobranca: 'fixo', preco_por_motorista: null, limite_motoristas: null, dias_trial: 7, recursos: ['Motoristas ilimitados', 'Todas as funcionalidades', 'Suporte 24h'] },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PlanosPublicos: React.FC = () => {
  const navigate = useNavigate();
  // Reaproveita a logomarca global configurável (mesma fonte do Login, via
  // /configuracoes/public). Sem exigir login: o endpoint é público.
  const { loginLogo, loginLogoScale, loginLogoY, configLoading } = useLoginConfig();
  // Detecta sessão para decidir o destino do CTA. `user` é null para visitante
  // (rota pública dentro do AuthProvider). NÃO buscamos o plano atual aqui.
  const { user } = useAuth();
  const [planos, setPlanos] = useState<PlanoPublico[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  // Plano escolhido por um usuário logado — abre o modal de upgrade. Visitante
  // nunca passa por aqui (vai direto ao /cadastro).
  const [planoUpgrade, setPlanoUpgrade] = useState<PlanoPublico | null>(null);
  // Estado do envio da solicitação de upgrade (admin comum).
  const [enviando, setEnviando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);
  // 409 (regularização necessária / upgrade pendente): mostra CTA para faturas.
  const [acaoRegularizar, setAcaoRegularizar] = useState<{ message: string; redirect: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    // Catálogo público leva ao cadastro de empresa (/cadastro): só planos de
    // empresa ou "ambos". Autônomo usa o app. Filtro por categoria, nunca por nome.
    api.get('/planos/publicos?categoria=empresa')
      .then((res) => {
        if (!vivo) return;
        const lista: PlanoPublico[] = (res.data?.planos || []).map((p: any) => ({
          ...p,
          preco_mensal: Number(p.preco_mensal) || 0,
          // Defesa: plano antigo pode não trazer o campo. Qualquer coisa que não
          // seja 'por_motorista' é fixo, e sem unitário não há composição.
          modelo_cobranca: p.modelo_cobranca === 'por_motorista' ? 'por_motorista' : 'fixo',
          preco_por_motorista: p.preco_por_motorista != null ? Number(p.preco_por_motorista) : null,
          recursos: normalizarRecursos(p.recursos),
        }));
        setPlanos(lista.length ? lista : PLANOS_FALLBACK);
      })
      .catch(() => {
        if (!vivo) return;
        setErro('Não foi possível carregar os planos agora. Exibindo valores de referência.');
        setPlanos(PLANOS_FALLBACK);
      })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, []);

  function irParaCadastro(plano: PlanoPublico) {
    // UUID real → plano_id; alias de fallback → ?plano= (compat legado).
    const q = UUID_RE.test(plano.id)
      ? 'plano_id=' + encodeURIComponent(plano.id)
      : 'plano=' + encodeURIComponent(plano.id);
    navigate('/cadastro?' + q);
  }

  // CTA do card: visitante segue para o cadastro público (fluxo atual, intacto);
  // usuário logado abre o modal de upgrade — nunca cai no /cadastro (a empresa
  // e o admin já existem).
  function aoEscolherPlano(plano: PlanoPublico) {
    // Plano sob negociação: nunca entra no self-service (o componente já não
    // dispara este callback para ele; esta guarda cobre qualquer outra via).
    if (plano.requer_negociacao) return;
    if (user) {
      setErroModal(null);
      setAcaoRegularizar(null);
      setPlanoUpgrade(plano);
    } else {
      irParaCadastro(plano);
    }
  }

  function fecharModal() {
    if (enviando) return; // não fecha no meio do envio
    setPlanoUpgrade(null);
    setErroModal(null);
    setAcaoRegularizar(null);
  }

  // Confirmação do modal.
  // - Super-admin: gerencia planos pelo painel (não usa o endpoint de solicitação,
  //   que é do admin da empresa). Comportamento preservado.
  // - Admin comum: chama POST /pagamentos/upgrade/solicitar → o backend cria a
  //   solicitação + a cobrança sandbox + a fatura. O plano NÃO muda aqui: só após
  //   o pagamento confirmado (webhook). Em sucesso, vai para /minhas-faturas.
  async function confirmarUpgrade() {
    if (!planoUpgrade) return;

    if (user?.is_super_admin) {
      setPlanoUpgrade(null);
      navigate('/painel-administrativo/planos');
      return;
    }

    setEnviando(true);
    setErroModal(null);
    setAcaoRegularizar(null);
    try {
      const { data } = await api.post('/pagamentos/upgrade/solicitar', {
        plano_novo_id: planoUpgrade.id,
        client_request_id: newClientRequestId(),
      });
      // 201 (novo) e 200 (idempotente) são sucesso: conduz à fatura/pagamento.
      setPlanoUpgrade(null);
      navigate(data?.redirect || '/minhas-faturas');
    } catch (err: any) {
      const status = err?.response?.status;
      const d = err?.response?.data;
      if (import.meta.env.DEV) console.error('[PlanosPublicos] solicitar upgrade falhou', { status });
      // 409: precisa regularizar / já há upgrade pendente → orienta às faturas.
      if (status === 409 && (d?.regularizacaoNecessaria || d?.upgradePendente)) {
        setAcaoRegularizar({
          message: d.message || 'Regularize suas faturas para continuar.',
          redirect: d.redirect || '/minhas-faturas',
        });
      } else {
        // 400/403/422/502 e demais: usa a mensagem amigável do backend.
        setErroModal(mensagemErro(err, 'Não foi possível solicitar o upgrade. Tente novamente.'));
      }
    } finally {
      setEnviando(false);
    }
  }

  // Rótulo do botão primário do modal.
  const ehSuperAdmin = user?.is_super_admin === true;
  const upgradeCtaLabel = ehSuperAdmin
    ? 'Gerenciar planos'
    : (enviando ? 'Gerando cobrança...' : 'Confirmar upgrade');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          {configLoading ? (
            // Placeholder de altura fixa enquanto a config carrega: evita o flash
            // fallback→logo e mantém a posição dos cards estável.
            <div className="h-20 mb-4" />
          ) : loginLogo ? (
            <div className="flex items-center justify-center mb-4">
              <img
                src={loginLogo}
                alt="Matopiba Log"
                style={{
                  transform: `scale(${loginLogoScale / 100}) translateY(${loginLogoY}px)`,
                  transformOrigin: 'center',
                }}
                className="max-h-20 max-w-full object-contain"
              />
            </div>
          ) : (
            // Fallback idêntico ao anterior quando não há logomarca configurada.
            <div className="flex items-center justify-center gap-2 mb-4">
              <Truck className="text-blue-600" size={32} />
              <h1 className="text-3xl font-bold text-gray-900">Matopiba Log</h1>
            </div>
          )}
          <p className="text-xl text-gray-600">Planos para todos os tamanhos de frota</p>
        </div>

        {erro && (
          <div className="max-w-2xl mx-auto mb-8 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 text-center">{erro}</div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-16">Carregando planos...</div>
        ) : (
          // Vitrine compartilhada (mesma fonte visual do cadastro público). CTA
          // depende da sessão; negociação renderizada por último e não-clicável.
          <PlanosVitrine
            planos={planos}
            onEscolher={aoEscolherPlano}
            ctaLabel={user ? 'Solicitar upgrade' : 'Começar Agora'}
          />
        )}

        <div className="text-center mt-12">
          <p className="text-gray-500">
            Já tem cadastro?{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">Fazer Login</Link>
          </p>
        </div>
      </div>

      {/* Modal de upgrade — só para usuário logado. Admin comum: ao confirmar, o
          backend cria a solicitação + a cobrança sandbox + a fatura; o plano NÃO
          muda aqui (só após o pagamento confirmado). Super-admin: vai ao painel de
          planos. Não chama Supabase/Asaas direto; não promete plano ativo. */}
      {planoUpgrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={fecharModal}
        >
          <div
            className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Fechar"
              disabled={enviando}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 disabled:opacity-40"
              onClick={fecharModal}
            >
              <X size={20} />
            </button>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Solicitar upgrade</h3>
            <p className="text-gray-600 mb-4">
              Você escolheu o <span className="font-semibold text-gray-900">{planoUpgrade.nome}</span>.{' '}
              {ehSuperAdmin
                ? 'Gerencie os planos das empresas pelo painel administrativo.'
                : 'Ao confirmar, geramos a cobrança; você conclui o pagamento em Minhas Faturas. O plano muda só após o pagamento confirmado.'}
            </p>

            {erroModal && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">
                {erroModal}
              </div>
            )}

            {acaoRegularizar ? (
              <div className="flex flex-col gap-2">
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
                  {acaoRegularizar.message}
                </div>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
                  onClick={() => { const destino = acaoRegularizar.redirect; setPlanoUpgrade(null); navigate(destino); }}
                >
                  Ver faturas / regularização
                </button>
                <button
                  type="button"
                  className="w-full py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition-colors"
                  onClick={fecharModal}
                >
                  Fechar
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={enviando}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={confirmarUpgrade}
                >
                  {upgradeCtaLabel}
                </button>
                <button
                  type="button"
                  disabled={enviando}
                  className="w-full py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition-colors disabled:opacity-60"
                  onClick={fecharModal}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
