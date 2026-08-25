import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePortalAuth } from './PortalAuthContext';

// Shell do Portal do Embarcador. Visual e navegacionalmente distinto do painel
// interno (§27/§77): nenhuma navegação da transportadora aparece aqui, e o
// embarcador nunca vê Frota, Financeiro, Campanhas ou qualquer conceito interno.
//
// Navegação curta de propósito (§78). Documentos e comprovantes NÃO viram uma
// aba própria: eles pertencem a uma operação específica, e uma lista global
// deles seria só uma segunda tabela dizendo a mesma coisa — exatamente a
// "planilha disfarçada" que o produto não deve virar. O acesso rápido ao
// comprovante fica no Início, que é onde a pessoa procura depois da entrega.
const ITENS = [
  { para: '/portal/embarcador', rotulo: 'Início', fim: true },
  { para: '/portal/embarcador/solicitacoes', rotulo: 'Solicitações', fim: false },
  { para: '/portal/embarcador/operacoes', rotulo: 'Operações', fim: false },
];

export default function PortalLayout() {
  const { usuario, embarcador, transportadoras, transportadoraAtiva, selecionarTransportadora, sair } = usePortalAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const navigate = useNavigate();

  function encerrar() {
    sair();
    navigate('/portal/embarcador/entrar', { replace: true });
  }

  const classeItem = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-emerald-700 text-white' : 'text-emerald-50 hover:bg-emerald-700/60'
    }`;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-800 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex flex-1 items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-emerald-50 hover:bg-emerald-700 sm:hidden"
              aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto((v) => !v)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Matopiba Log</p>
              <p className="truncate text-xs text-emerald-100">
                Portal do Embarcador{embarcador?.nome ? ` · ${embarcador.nome}` : ''}
              </p>
            </div>
          </div>

          {/* Seletor de transportadora só aparece quando há mais de uma (§16):
              com uma só, escolher seria trabalho sem decisão. */}
          {transportadoras.length > 1 && (
            <label className="flex items-center gap-2 text-xs">
              <span className="sr-only">Transportadora</span>
              <select
                className="rounded-lg border border-emerald-600 bg-emerald-700 px-2 py-1.5 text-sm text-white"
                value={transportadoraAtiva?.relationship_id || ''}
                onChange={(e) => selecionarTransportadora(e.target.value)}
                aria-label="Selecionar transportadora"
              >
                {transportadoras.map((t) => (
                  <option key={t.relationship_id} value={t.relationship_id}>{t.nome}</option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-emerald-100 sm:inline">{usuario?.nome}</span>
            <button
              type="button"
              onClick={encerrar}
              className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-700"
            >
              Sair
            </button>
          </div>
        </div>

        <nav aria-label="Navegação do portal" className="mx-auto max-w-5xl px-4 pb-3">
          <ul className={`gap-2 sm:flex ${menuAberto ? 'block space-y-1' : 'hidden sm:flex'}`}>
            {ITENS.map((item) => (
              <li key={item.para}>
                <NavLink to={item.para} end={item.fim} className={classeItem} onClick={() => setMenuAberto(false)}>
                  {item.rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
