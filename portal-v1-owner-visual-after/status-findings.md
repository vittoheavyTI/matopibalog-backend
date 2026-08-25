# Estado final de cada achado — VIS-01 … VIS-14

Fonte: [`portal-v1-owner-visual/findings.md`](https://github.com/vittoheavyTI/matopibalog-backend/pull/479)
(PR #479, congelado como `PORTAL_V1_VISUAL_FINDINGS_FROZEN=true`).

| ID | Sev. | Status | Como está provado |
|---|---|---|---|
| VIS-01 | HIGH | **FIXED** | `Cartao` com prop `tom`; a cor é decidida dentro do componente. `getComputedStyle` em navegador: **0 de 48** destaques semânticos renderizados brancos (antes, todos). |
| VIS-02 | HIGH | **FIXED** | `ProgressoEntrega` lê `entrega.{solicitado,entregue,restante}` do backend. Teste: mostra 500 t / 700 t; e **não** renderiza nada quando o backend manda `null`. |
| VIS-03 | HIGH | **FIXED** | `PARCIALMENTE_ENTREGUE` incluído no filtro de `em_andamento` (backend) e no de Transportes (frontend). Teste com um único pedido parcial: aparece na home, aparece na lista, e a frase "nenhuma ação é necessária" **não** aparece. |
| VIS-04 | HIGH | **FIXED** | Abaixo de `sm`, conteúdo e ações em linhas separadas; ação primária em largura total. Cena `07-inicio-ativo-mobile`. |
| VIS-05 | MEDIUM | **FIXED** | `?enviada=1` consumido: confirmação + próximo passo, e a URL é limpa para não ressuscitar num F5. Dois testes (com e sem o parâmetro). |
| VIS-06 | MEDIUM | **FIXED** | Mapa de tons congelado. Testes garantem que entrega parcial ≠ cancelada e que os cinco estados "em curso" não usam o tom de encerrado. |
| VIS-07 | MEDIUM | **FIXED** | `SeletorArquivo` com rótulo próprio; input nativo `sr-only`, acessível por teclado. Teste confere o texto em pt-BR e que o input continua sendo `type=file`. |
| VIS-08 | MEDIUM | **FIXED** | Pré-visualização reusando o `ArquivoPreviewModal` existente — **nenhum segundo visualizador foi criado**. Teste: abre `dialog` e `window.open` **não** é chamado. Vale também na caixa de entrada. |
| VIS-09 | MEDIUM | **FIXED** | Comparação extraída para `shared/comparacaoEnvios`, usada pelas duas pontas. Histórico externo agora crescente, com "Envio atual" marcado. Teste cobre a direção da diferença e a ausência de nome de campo do banco. |
| VIS-10 | MEDIUM | **FIXED** | Vocabulário externo congelado em **pedido**; navegação Início/Pedidos/Transportes/Documentos separada por `tem_operacao`. Testes garantem que nenhum item aparece nas duas abas e que o aceito-sem-operação fica em Pedidos. |
| VIS-11 | LOW | **FIXED** | `recentes` removido do payload e do tipo. |
| VIS-12 | LOW | **FIXED** | `CampoSenha` com alternância no login e nas duas ativações. Teste verifica o `type` do input e o `aria-pressed`. |
| VIS-13 | LOW | **FIXED** | `focus-visible` próprio, com anel branco e halo escuro para aparecer sobre o verde dos botões primários. Teste verifica que a ação primária declara o estilo. |
| VIS-14 | HIGH | **FIXED** | `min-w-0` no contêiner flex do cabeçalho. Medida: **0 de 30** cenas com `scrollWidth > clientWidth` em 390 px (antes, 625 vs 390). O nome do embarcador trunca; produto e contexto permanecem. |
| NOTE-01 | NOTE | **NOT_APPLICABLE** | Shell do painel interno (ortografia e faixa lateral), não Portal V1. Fora de escopo por decisão explícita. |
| NOTE-02 | NOTE | **NOT_APPLICABLE** | Deep-link do SPA no GitHub Pages devolvendo 404 e restaurando a rota — comportamento conhecido e aceito. |

**BLOCKERS=0 · HIGHS=0 · MEDIUMS=0 · LOWS=0 em aberto.** Nenhum achado ficou
`DEFERRED`.

## Uma coisa que vale registrar

Três dos cinco HIGH não eram falta de domínio: o backend já produzia a
informação certa e a camada de apresentação a descartava. O `entrega` vinha com
um comentário explicando que era "quanto da carga dele chegou e quanto ainda
falta", e nunca foi lido. O `derivarProximaAcao` tratava entrega parcial como
operação em curso, e os filtros ao lado a excluíam.

Os outros dois eram invisíveis em revisão de código: `bg-amber-50` perdendo para
`bg-white` por ordem no CSS, e `flex-1` sem `min-w-0`. Nos dois casos o JSX
parecia correto. Por isso os testes novos verificam **comportamento e medida** —
asserção sobre string de `className` foi exatamente o que deixou o VIS-01 passar.
