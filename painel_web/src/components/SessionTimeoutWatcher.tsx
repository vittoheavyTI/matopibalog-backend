import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Logout automático por inatividade (segurança: painel não fica aberto indefinidamente).
// Montado dentro do Layout, portanto ativo APENAS no painel autenticado — nunca em
// /login, /cadastro, /planos e demais rotas públicas (que ficam fora do Layout).
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;      // 30 min sem atividade → logout
const WARNING_BEFORE_MS = 2 * 60 * 1000;     // janela de aviso: 2 min antes do logout
const WARNING_AT_MS = IDLE_TIMEOUT_MS - WARNING_BEFORE_MS; // aviso aos 28 min
const ACTIVITY_THROTTLE_MS = 1000;           // reinicia timers no máx. 1x/s (evita reset a cada pixel)

// Eventos que contam como atividade do usuário.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export const SessionTimeoutWatcher: React.FC = () => {
  const { logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(WARNING_BEFORE_MS / 1000));

  // Refs para timers/estado, evitando closures obsoletas nos listeners.
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(0);
  const warningActiveRef = useRef<boolean>(false);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
    clearCountdown();
  }, [clearCountdown]);

  // Expira a sessão por inatividade: desloga pelo fluxo existente informando o
  // motivo 'idle'. O próprio logout grava o motivo (antes da chamada de rede),
  // limpa o token e o AuthContext redireciona ao /login.
  const handleExpire = useCallback(() => {
    warningActiveRef.current = false;
    clearTimers();
    logout('idle');
  }, [clearTimers, logout]);

  // Mostra o aviso e inicia a contagem regressiva visual dos 2 min finais.
  const startWarning = useCallback(() => {
    warningActiveRef.current = true;
    setSecondsLeft(Math.floor(WARNING_BEFORE_MS / 1000));
    setShowWarning(true);
    clearCountdown();
    countdownRef.current = setInterval(() => {
      setSecondsLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearCountdown]);

  // (Re)agenda os timers a partir de agora. Some com o aviso, se estiver aberto.
  const resetTimers = useCallback(() => {
    warningActiveRef.current = false;
    setShowWarning(false);
    clearTimers();
    warningTimerRef.current = setTimeout(startWarning, WARNING_AT_MS);
    logoutTimerRef.current = setTimeout(handleExpire, IDLE_TIMEOUT_MS);
  }, [clearTimers, startWarning, handleExpire]);

  // Registra os listeners de atividade uma única vez (instância única no Layout).
  useEffect(() => {
    const onActivity = () => {
      // Durante o aviso, atividade NÃO reinicia sozinha — o usuário escolhe
      // explicitamente "Continuar conectado" ou "Sair agora".
      if (warningActiveRef.current) return;
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      resetTimers();
    };

    ACTIVITY_EVENTS.forEach(evt =>
      window.addEventListener(evt, onActivity, { passive: true })
    );
    resetTimers(); // agenda inicial

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, onActivity));
      clearTimers();
    };
  }, [resetTimers, clearTimers]);

  const handleContinuar = () => {
    lastActivityRef.current = Date.now();
    resetTimers();
  };

  const handleSairAgora = () => {
    warningActiveRef.current = false;
    clearTimers();
    logout();
  };

  if (!showWarning) return null;

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Sessão prestes a expirar</h2>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-gray-600">
            Sua sessão expirará em <span className="font-semibold text-gray-900">{mm}:{ss}</span> por inatividade.
          </p>
        </div>
        <div className="px-6 py-4 bg-gray-50 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            onClick={handleSairAgora}
            className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Sair agora
          </button>
          <button
            onClick={handleContinuar}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            Continuar conectado
          </button>
        </div>
      </div>
    </div>
  );
};
