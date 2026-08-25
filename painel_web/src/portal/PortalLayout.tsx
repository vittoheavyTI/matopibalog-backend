import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePortalAuth } from './PortalAuthContext';
import { FOCO } from './PortalUI';

// Shell do Portal do Embarcador. Visual e navegacionalmente distinto do painel
// interno (§27/§77): nenhuma navegação da transportadora aparece aqui, e o
// embarcador nunca vê Frota, Financeiro, Campanhas ou qualquer conceito interno.
//
// NAVEGAÇÃO (VIS-10). Antes eram "Solicitações" e "Operações", e as duas
// listavam o MESMO pedido — "Solicitações" não filtrava nada. Agora a divisão é
// por fase real da vida do pedido, e cada item aparece em exatamente um lugar:
//
//   Pedidos      → antes de existir operação (em análise, ajustes, aceito sem
//                  operação criada) e os que terminaram sem virar transporte
//   Transportes  → o que virou operação de verdade e dá para acompanhar
//   Documentos   → arquivos de todos os pedidos, reunidos
//
// "Documentos" ganhou aba própria porque o embarcador procura um comprovante
// pelo arquivo ("cadê o canhoto?"), não pelo pedido que o originou — e antes
// isso exigia lembrar em qual pedido ele estava.
const ITENS = [
  { para: '/portal/embarcador', rotulo: 'Início', fim: true },
  { para: '/portal/embarcador/pedidos', rotulo: 'Pedidos', fim: false },
  { para: '/portal/embarcador/transportes', rotulo: 'Transportes', fim: false },
  { para: '/portal/embarcador/documentos', rotulo: 'Documentos', fim: false },
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
    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${FOCO} ${
      isActive ? 'bg-emerald-700 text-white' : 'text-emerald-50 hover:bg-emerald-700/60'
    }`;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-emerald-800 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          {/* `min-w-0` aqui é o que faz o `truncate` abaixo funcionar (VIS-14).
              Sem ele, `flex-1` mantém `min-width: auto`, o contêiner nunca
              encolhe abaixo do conteúdo, e um nome de cooperativa comprido
              empurrava a página inteira para 625px de largura num aparelho de
              390px — rolagem horizontal em TODA tela autenticada. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              className={`rounded-lg p-2 text-emerald-50 hover:bg-emerald-700 sm:hidden ${FOCO}`}
              aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto((v) => !v)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <div className="min-w-0">
              {/* Produto e contexto ficam legíveis sempre; quem cede espaço é o
                  nome do embarcador, que é a informação mais longa e a que ele
                  já conhece de cor (§25). */}
              <p className="text-sm font-semibold leading-tight">Matopiba Log</p>
              <p className="text-xs text-emerald-100">
                <span className="whitespace-nowrap">Portal do Embarcador</span>
                {embarcador?.nome && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="inline-block max-w-full truncate align-bottom" title={embarcador.nome}>
                      {embarcador.nome}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Seletor de transportadora só aparece quando há mais de uma (§16):
              com uma só, escolher seria trabalho sem decisão. */}
          {transportadoras.length > 1 && (
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span className="sr-only">Transportadora</span>
              <select
                className={`max-w-[12rem] truncate rounded-lg border border-emerald-600 bg-emerald-700 px-2 py-1.5 text-sm text-white ${FOCO}`}
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

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden max-w-[10rem] truncate text-xs text-emerald-100 sm:inline">{usuario?.nome}</span>
            <button
              type="button"
              onClick={encerrar}
              className={`rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 ${FOCO}`}
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
