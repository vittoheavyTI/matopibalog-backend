import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Estado de ERRO recuperável de carregamento — PERSISTENTE (não é só toast) e
// com ação "Tentar novamente". Nunca deve ser confundido com estado vazio.
export const ErroCarregamento: React.FC<{ mensagem?: string | null; onTentar: () => void; compacto?: boolean }> = ({ mensagem, onTentar, compacto }) => (
  <div className={`flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-red-100 bg-red-50/60 ${compacto ? 'p-6' : 'p-10'}`} role="alert">
    <AlertTriangle className="text-red-500" size={compacto ? 24 : 32} />
    <p className="text-sm font-semibold text-red-800">{mensagem || 'Não foi possível carregar os dados.'}</p>
    <button
      onClick={onTentar}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 active:scale-95"
    >
      <RefreshCw size={15} /> Tentar novamente
    </button>
  </div>
);
