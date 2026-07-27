import React from 'react';
import { Lock, Receipt, LifeBuoy } from 'lucide-react';
import { useLoginConfig } from '../hooks/useLoginConfig';
import { montarLinkComercial } from '../utils/contatoComercial';

interface PlanoBloqueadoCardProps {
  /** Mensagem real vinda do backend (middleware verificarPlano). */
  message: string;
  /** Ação do botão principal — normalmente navegar para /minhas-faturas. */
  onRegularizar: () => void;
  className?: string;
}

/**
 * Card de UX exibido quando uma tela operacional recebe 403 de plano bloqueado /
 * período de teste expirado (middleware verificarPlano). Mostra a mensagem real do
 * backend e oferece o caminho de regularização (Minhas Faturas). É apenas
 * apresentação: NÃO altera nenhuma regra de bloqueio, tenant ou permissão.
 *
 * O contato de suporte usa a config pública existente (contactEmail/contactPhone
 * via /configuracoes/public): vira link clicável (mailto/tel) quando houver; sem
 * canal, mantém o texto neutro de sempre.
 */
export const PlanoBloqueadoCard: React.FC<PlanoBloqueadoCardProps> = ({ message, onRegularizar, className }) => {
  const { contactEmail, contactPhone, whatsappSuporte } = useLoginConfig();
  const suporte = montarLinkComercial(
    { whatsapp: whatsappSuporte, email: contactEmail, telefone: contactPhone },
    { assunto: 'Suporte - Matopiba Log', mensagem: 'Olá! Preciso de ajuda com minha conta no Matopiba Log.' }
  );
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-8 max-w-xl mx-auto text-center ${className || ''}`}>
      <div className="mx-auto w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
        <Lock size={26} className="text-red-500" />
      </div>
      <h3 className="text-xl font-bold text-gray-800 mb-2">Sua empresa está suspensa ou bloqueada</h3>
      <p className="text-sm text-gray-600 mb-1">{message}</p>
      <p className="text-sm text-gray-500 mb-6">
        Acesse Faturas / Regularização para regularizar o plano e voltar a operar.
      </p>
      <button
        onClick={onRegularizar}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white rounded-xl font-bold text-sm transition-colors"
      >
        <Receipt size={16} /> Ir para Faturas / Regularização
      </button>
      {suporte.disponivel ? (
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-gray-500 mt-4">
          <LifeBuoy size={14} /> Precisa de ajuda?{' '}
          <a href={suporte.href!} {...(suporte.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="text-green-700 hover:underline font-semibold">
            Falar com o suporte
          </a>
          {suporte.telHref && (
            <>
              {' · '}
              <a href={suporte.telHref} className="text-green-700 hover:underline font-semibold">Ligar</a>
            </>
          )}
        </p>
      ) : (
        <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-4">
          <LifeBuoy size={14} /> Se precisar de ajuda, entre em contato com o suporte.
        </p>
      )}
    </div>
  );
};
