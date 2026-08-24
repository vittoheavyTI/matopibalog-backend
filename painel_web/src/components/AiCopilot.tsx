import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, X, Plus, Sparkles, Info } from 'lucide-react';
import api from '../api';

// Copiloto Operacional (AI Copilot V1) — painel/drawer read-only.
// Estado efêmero na memória do componente (sem persistência, §40). Se o assistente
// estiver desabilitado (§34/§56), mostra estado verdadeiro sem spam de erro.

type Papel = 'user' | 'assistant';
type Mensagem = { role: Papel; content: string; evidence?: Evidencia[]; warnings?: string[] };
type Evidencia = { tool?: string; label?: string; entity_type?: string; snapshot_at?: string };
type Capabilities = { enabled: boolean; provider_available: boolean; read_only: boolean; capabilities?: { name: string; description: string }[] };

const SUGESTOES = [
  'Quais fretes precisam de atenção?',
  'Resuma minha frota.',
  'Como está minha capacidade de motoristas?',
];

export const AiCopilot: React.FC = () => {
  const [aberto, setAberto] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [entrada, setEntrada] = useState('');
  const [carregando, setCarregando] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    api.get('/ai/capabilities')
      .then(({ data }) => { if (vivo) setCaps(data); })
      .catch(() => { if (vivo) setCaps({ enabled: false, provider_available: false, read_only: true }); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (aberto) setTimeout(() => inputRef.current?.focus(), 50);
  }, [aberto]);

  // Outras telas (ex.: Torre de Controle) podem abrir o assistente via evento,
  // opcionalmente pré-preenchendo uma pergunta sugerida.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setAberto(true);
      const q = (e as CustomEvent).detail?.question;
      if (typeof q === 'string' && q) setEntrada(q);
    };
    window.addEventListener('ai:open', onOpen);
    return () => window.removeEventListener('ai:open', onOpen);
  }, []);

  useEffect(() => { fimRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [mensagens, carregando]);

  const enviar = useCallback(async (texto: string) => {
    const msg = texto.trim();
    if (!msg || carregando) return;
    const historico = mensagens.map((m) => ({ role: m.role, content: m.content }));
    setMensagens((prev) => [...prev, { role: 'user', content: msg }]);
    setEntrada('');
    setCarregando(true);
    try {
      const { data } = await api.post('/ai/chat', { message: msg, history: historico });
      setMensagens((prev) => [...prev, {
        role: 'assistant',
        content: data?.answer || 'Não consegui responder agora.',
        evidence: Array.isArray(data?.evidence) ? data.evidence : [],
        warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      }]);
    } catch {
      setMensagens((prev) => [...prev, { role: 'assistant', content: 'O assistente está indisponível no momento.' }]);
    } finally {
      setCarregando(false);
    }
  }, [carregando, mensagens]);

  const novaConversa = () => setMensagens([]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(entrada); }
  };

  // Launcher flutuante (sempre visível no painel autenticado).
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir assistente"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-3 shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <Bot size={20} />
        <span className="hidden sm:inline text-sm font-semibold">Assistente</span>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Assistente operacional">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAberto(false)} aria-hidden="true" />
          <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2 text-gray-900">
                <Bot size={20} className="text-emerald-700" />
                <h2 className="text-base font-bold">Copiloto Operacional</h2>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={novaConversa} aria-label="Nova conversa" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><Plus size={18} /></button>
                <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X size={18} /></button>
              </div>
            </header>

            <div className="flex-1 overflow-auto px-4 py-3 space-y-3" aria-live="polite">
              {caps && !caps.enabled && (
                <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                  <Info size={16} className="mt-0.5 shrink-0" />
                  O assistente ainda não está habilitado. As demais funções do sistema seguem normais.
                </div>
              )}

              {caps?.enabled && mensagens.length === 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-gray-500"><Sparkles size={16} /> Perguntas sugeridas</p>
                  {SUGESTOES.map((s) => (
                    <button key={s} type="button" onClick={() => enviar(s)} className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">{s}</button>
                  ))}
                  <p className="pt-1 text-xs text-gray-400">O assistente é somente de consulta: ele explica e resume, mas não executa ações.</p>
                </div>
              )}

              {mensagens.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-900'}`}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.warnings && m.warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                        {m.warnings.map((w, j) => <li key={j}>⚠ {w}</li>)}
                      </ul>
                    )}
                    {m.evidence && m.evidence.length > 0 && (
                      <div className="mt-2 border-t border-gray-200 pt-1.5 text-[11px] text-gray-500">
                        {m.evidence.map((e, j) => <div key={j}>{e.label || e.tool}</div>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {carregando && <div className="text-sm text-gray-400" aria-label="Pensando">Consultando…</div>}
              <div ref={fimRef} />
            </div>

            {caps?.enabled && (
              <div className="border-t border-gray-200 p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={entrada}
                    onChange={(e) => setEntrada(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    placeholder="Pergunte sobre sua operação…"
                    aria-label="Mensagem para o assistente"
                    className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => enviar(entrada)}
                    disabled={carregando || !entrada.trim()}
                    aria-label="Enviar"
                    className="rounded-xl bg-emerald-700 p-2.5 text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
};
