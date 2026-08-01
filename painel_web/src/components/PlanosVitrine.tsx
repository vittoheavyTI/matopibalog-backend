import React from 'react';
import { Check } from 'lucide-react';
import type { PlanoPublico } from '../utils/planosCatalogo';
import { limiteLabel, composicaoLabel, ordenarVitrine } from '../utils/planosCatalogo';

// Componente COMPARTILHADO da vitrine de planos. Fonte única do visual dos cards
// usada tanto na página de upgrade (PlanosPublicos) quanto no cadastro público
// (CadastroPublico), para que aquisição inicial e upgrade NUNCA divirjam em
// ordem, destaque, tratamento de Enterprise, preço e seleção.
//
// É PURAMENTE APRESENTACIONAL: recebe a lista já carregada e um callback de
// escolha; não faz fetch, não conhece auth, billing, Asaas nem promoções.
// Tipos e helpers de ordenação/rótulo vivem em utils/planosCatalogo.

interface PlanosVitrineProps {
  planos: PlanoPublico[];
  // Chamado ao escolher um plano self-service (o Enterprise nunca dispara isto).
  onEscolher: (plano: PlanoPublico) => void;
  // Rótulo do CTA dos cards self-service. String fixa ou função por plano/destaque.
  ctaLabel: string | ((plano: PlanoPublico, destaque: boolean) => string);
  // Quando definido, o card correspondente aparece SELECIONADO (uso no cadastro).
  planoSelecionadoId?: string | null;
  // Rótulo do CTA quando o card está selecionado (default "✓ Plano selecionado").
  ctaSelecionadoLabel?: string;
  // Enterprise / sob negociação — textos padronizados com a página de upgrade.
  negociacaoCta?: string;
  negociacaoHint?: string;
  // Canal comercial do CTA do Enterprise. Quando `negociacaoHref` existe, o CTA
  // vira um link real (wa.me/mailto); senão, mostra um estado claramente NÃO
  // clicável ("Canal comercial em configuração"). `negociacaoExterno` abre em
  // nova aba (WhatsApp). `negociacaoTelHref` é a opção secundária "Ligar".
  negociacaoHref?: string | null;
  negociacaoExterno?: boolean;
  negociacaoTelHref?: string | null;
  negociacaoIndisponivelLabel?: string;
}

// Grade de cards da vitrine. O destaque "Mais Popular" cai no 2º card (índice 1)
// quando há 3+ planos; como a negociação fica sempre por último, o destaque
// nunca cai sobre ela.
export const PlanosVitrine: React.FC<PlanosVitrineProps> = ({
  planos,
  onEscolher,
  ctaLabel,
  planoSelecionadoId = null,
  ctaSelecionadoLabel = '✓ Plano selecionado',
  negociacaoCta = 'Fale com o comercial',
  negociacaoHint = 'Para frotas acima de 40 motoristas — contratação sob negociação.',
  negociacaoHref = null,
  negociacaoExterno = false,
  negociacaoTelHref = null,
  negociacaoIndisponivelLabel = 'Canal comercial em configuração',
}) => {
  const ordenados = React.useMemo(() => ordenarVitrine(planos), [planos]);
  const idxDestaque = ordenados.length >= 3 ? 1 : -1;

  return (
    <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
      {ordenados.map((plano, idx) => {
        const destaque = idx === idxDestaque;
        const selecionado = planoSelecionadoId != null && plano.id === planoSelecionadoId;
        const label = typeof ctaLabel === 'function' ? ctaLabel(plano, destaque) : ctaLabel;
        return (
          <div
            key={plano.id}
            className={`relative bg-white rounded-2xl shadow-lg p-8 flex flex-col transition-transform hover:scale-105 ${
              selecionado ? 'ring-2 ring-green-500 shadow-xl' : destaque ? 'ring-2 ring-blue-500 shadow-xl' : ''
            }`}
          >
            {destaque && !selecionado && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-semibold">Mais Popular</div>
            )}
            {selecionado && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-1 rounded-full text-sm font-semibold">Selecionado</div>
            )}
            <h3 className="text-2xl font-bold text-gray-900 mb-2">{plano.nome}</h3>
            <p className="text-gray-500 mb-6">{plano.descricao}</p>
            <div className="mb-1">
              {plano.requer_negociacao ? (
                <span className="text-3xl font-bold text-gray-900">Sob negociação</span>
              ) : (
                <>
                  <span className="text-4xl font-bold text-gray-900">R$ {plano.preco_mensal.toFixed(2)}</span>
                  <span className="text-gray-500">/mês</span>
                </>
              )}
            </div>
            {composicaoLabel(plano) && (
              <p className="text-sm text-gray-500 mb-1">{composicaoLabel(plano)}</p>
            )}
            {plano.dias_trial ? (
              <p className="text-sm text-green-600 font-medium mb-6">{plano.dias_trial} dias de teste grátis</p>
            ) : <div className="mb-6" />}
            {!plano.requer_negociacao && (
              <p className="text-sm text-emerald-700 font-medium mb-4">
                {(plano.valor_implantacao || 0) <= 0
                  ? 'Implantação grátis'
                  : `Implantação R$ ${Number(plano.valor_implantacao).toFixed(2)}`}
              </p>
            )}
            <ul className="space-y-3 mb-8 flex-1">
              <li className="flex items-center gap-2 text-gray-800 font-semibold">
                <Check size={18} className="text-green-500 shrink-0" />
                {/* Plano sob negociação não tem teto de tabela — o limite_motoristas
                    é um placeholder (ex.: 999). Mostrar "Motoristas sob medida" em
                    vez de "Até 999 motoristas". NÃO altera o dado, só o rótulo. */}
                <span>{plano.requer_negociacao ? 'Motoristas sob medida' : limiteLabel(plano.limite_motoristas)}</span>
              </li>
              {plano.recursos.map((f) => (
                <li key={f} className="flex items-center gap-2 text-gray-700">
                  <Check size={18} className="text-green-500 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {plano.requer_negociacao ? (
              <div className="w-full">
                {negociacaoHref ? (
                  // Canal configurado → CTA é um link REAL (wa.me/mailto).
                  <a
                    href={negociacaoHref}
                    {...(negociacaoExterno ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="block w-full py-3 rounded-xl text-white font-semibold text-center bg-amber-600 hover:bg-amber-700 transition-colors"
                  >
                    {negociacaoCta}
                  </a>
                ) : (
                  // Sem canal → estado claramente NÃO clicável (não parece botão).
                  <div className="w-full py-3 rounded-xl text-center bg-gray-100 text-gray-500 font-medium cursor-default select-none">
                    {negociacaoIndisponivelLabel}
                  </div>
                )}
                {negociacaoTelHref && (
                  <a href={negociacaoTelHref} className="block mt-2 text-sm text-amber-700 hover:underline text-center font-medium">
                    Ligar
                  </a>
                )}
                <p className="mt-2 text-xs text-gray-500 text-center">{negociacaoHint}</p>
              </div>
            ) : (
              <button
                type="button"
                className={`w-full py-3 rounded-xl text-white font-semibold transition-colors ${
                  selecionado ? 'bg-green-600 hover:bg-green-700' : destaque ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-800 hover:bg-gray-900'
                }`}
                onClick={() => onEscolher(plano)}
              >
                {selecionado ? ctaSelecionadoLabel : label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
