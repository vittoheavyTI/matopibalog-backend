import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Botão de copiar com feedback visível e acessível (aria-live). Estados:
//   idle → "Copiar código" · copiando → "Copiando…" (desabilitado) ·
//   copiado → check + "Copiado!" + status "Código de convite copiado" ·
//   erro → texto normal + status "Não foi possível copiar o código".
// Volta ao normal após ~2s. Impede operações concorrentes (guarda `copiando`).
// Não afirma sucesso antes da Promise resolver. Fallback sem dependência quando
// navigator.clipboard não existe. Não muta nada no backend.

type Estado = 'idle' | 'copiando' | 'copiado' | 'erro';

async function escreverNaAreaDeTransferencia(texto: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(texto);
    return;
  }
  // Fallback (sem dependência): textarea temporária + execCommand.
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  if (!ok) throw new Error('Falha ao copiar (fallback).');
}

export const BotaoCopiarCodigo: React.FC<{ codigo: string | null; className?: string }> = ({ codigo, className }) => {
  const [estado, setEstado] = useState<Estado>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function copiar() {
    if (!codigo || estado === 'copiando') return; // impede concorrência / clique duplo
    setEstado('copiando');
    try {
      await escreverNaAreaDeTransferencia(codigo);
      setEstado('copiado');
      setStatusMsg('Código de convite copiado');
    } catch {
      setEstado('erro');
      setStatusMsg('Não foi possível copiar o código');
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setEstado('idle'); setStatusMsg(''); }, 2000);
  }

  const rotulo = estado === 'copiando' ? 'Copiando…' : estado === 'copiado' ? 'Copiado!' : 'Copiar código';
  return (
    <>
      <button
        type="button"
        onClick={copiar}
        disabled={!codigo || estado === 'copiando'}
        aria-label="Copiar código de convite"
        className={className || 'px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium text-sm transition-colors disabled:opacity-40 inline-flex items-center gap-1.5'}
      >
        {estado === 'copiado' ? <Check size={15} /> : <Copy size={15} />}
        {rotulo}
      </button>
      {/* Toast visual no MESMO padrão do projeto (fixed top-right), com role=status +
          aria-live para leitores de tela. Verde = sucesso; vermelho = erro. */}
      {statusMsg && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-2xl text-sm font-bold text-white ${estado === 'erro' ? 'bg-red-600' : 'bg-green-600'}`}
        >
          {statusMsg}
        </div>
      )}
    </>
  );
};
