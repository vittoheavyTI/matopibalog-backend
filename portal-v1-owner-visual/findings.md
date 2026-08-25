# Portal do Embarcador V1 — achados da preparação visual

> Levantados sobre o código de produção em `main` @ `fd5965d8`. **Nada foi
> corrigido.** Onde o problema envolve intenção de produto ou troca visual, deixo
> alternativas em vez de decidir por você (§43).
>
> Leia depois de olhar o [`00-index.md`](./00-index.md) e formar sua própria
> impressão — senão eu envieso o que você vai ver.

## Resumo

| Severidade | Qtd. |
|---|---|
| BLOCKER | 0 |
| HIGH | 5 |
| MEDIUM | 6 |
| LOW | 3 |
| NOTE | 2 |

Os cinco HIGH se dividem em dois tipos, e nenhum é falta de domínio:

- **Informação que existe e não chega à tela** (`VIS-02`, `VIS-03`): o backend
  calcula quanto falta entregar e trata entrega parcial como operação em curso —
  com comentário escrito dizendo isso — e a camada de apresentação descarta os
  dois. É a última milha.
- **Composição visual** (`VIS-01`, `VIS-04`, `VIS-14`): destaque de cor que não
  pinta, texto espremido no celular e rolagem lateral com nome comprido. Todos
  invisíveis em revisão de código, porque o JSX *parece* certo.

Nenhum dos cinco compromete dado ou fronteira de segurança — a auditoria do
PORTAL-B já cobriu isso. São defeitos de o cliente **entender** o que está vendo.

Os identificadores (`VIS-nn`) são só nomes estáveis para você poder citar um
achado; não seguem a ordem de severidade.

Escopo: apenas Portal V1. Débito não relacionado (Frota, Rota, Acerto, Billing,
Financeiro, ortografia legada do painel) ficou de fora deliberadamente (§42).

---

## HIGH

### VIS-01 · Os cartões de destaque do portal são renderizados brancos

**Telas:** Início (`07`), detalhe com ajustes (`20`), correção (`21`), recusa
(`23`), comprovante (`35`), conteúdo longo (`50`) — mobile e desktop.

**Observação.** O código pede destaque âmbar no bloco "Precisa da sua atenção" e
em "A transportadora pediu ajustes" (`border-amber-200 bg-amber-50`), vermelho na
recusa (`bg-red-50`) e verde no comprovante (`border-emerald-200`). **Nenhum
aparece.** Medido com `getComputedStyle` em 390px:

```
inicio-ativo         "Precisa da sua atenção…"          → rgb(255, 255, 255)   ← branco
ajustes-solicitados  "A transportadora pediu ajustes…"  → rgb(255, 255, 255)   ← branco
conteudo-longo       "A transportadora pediu ajustes…"  → rgb(255, 255, 255)   ← branco
inbox-grupos         "Ajustes reenviados (1)…"          → oklch(0.979 …)       ← cor aplicada
```

A última linha é o controle: o mesmo tipo de destaque **funciona** no lado da
transportadora. A diferença é que lá o bloco é um `<section>` com as classes
direto, e no portal ele passa pelo componente `Cartao`, cuja classe base já traz
`bg-white`/`border-slate-200`. Duas utilitárias de mesma propriedade e mesma
especificidade: quem vence é a ordem no CSS gerado, não a intenção de quem
escreveu — e vence `bg-white`.

**Por que importa.** É a hierarquia visual inteira do portal. O bloco que deveria
gritar "isto depende de você" fica idêntico ao cartão de histórico passivo, e o
bloco de recusa perde a sinalização de gravidade. Some com o §22 (abaixo) e o
Início vira uma pilha de cartões brancos equivalentes. Também é o tipo de defeito
que passa despercebido em revisão de código: o JSX *parece* certo.

**Direção proposta.** Uma decisão de arquitetura de componente, sua:
- **(a)** `Cartao` deixa de trazer cor na base e cada chamador declara a sua;
- **(b)** `Cartao` ganha uma prop `tom` (`neutro | atencao | erro | sucesso`) e a
  cor deixa de ser passada por `className` solta;
- **(c)** manter `className` mas resolver o conflito na composição (ex.: `tailwind-merge`).

A **(b)** é a que impede o problema de voltar, porque tira do chamador a chance de
passar uma classe que será silenciosamente descartada.

---

### VIS-02 · "Entrega parcial" não diz quanto falta — e o dado existe

**Tela:** `33-tracking-entrega-parcial`.

**Observação.** O backend calcula e envia, no mesmo payload do detalhe:

```js
entrega: { unidade, solicitado, entregue, restante, concluida }
```

com o comentário — dele, não meu — *"Só o que o cliente entende: quanto da carga
dele chegou e quanto ainda falta."*

O frontend **não declara esse campo no tipo `Detalhe` e nunca o lê**. Busca por
`entrega` em `src/portal/` só encontra o título "Comprovante de entrega".

Resultado na tela: o embarcador vê o selo "Entrega parcial", a linha do tempo
"Parte da carga foi entregue" e **"Total: 1.200 t"** — o total *pedido*. Não há
nenhum número dizendo quanto chegou nem quanto resta.

**Por que importa.** Para quem tem carga parada, "quanto falta" é a pergunta. A
tela responde "parte" e manda a pessoa ligar para a transportadora — que é
exatamente o telefonema que o portal existe para evitar. E o §22 do seu roteiro
pede justamente a demanda residual visível.

**Direção proposta.** Exibir `entrega.entregue` / `entrega.restante` no Resumo
quando `entrega != null`. Fica a decisão de quando mostrar: só em entrega
parcial, ou sempre que o backend conseguir medir (o que também dá "0 de 1.200 t
entregues" durante o transporte). Sugiro sempre que `entrega != null` — o
progresso é útil antes do fim —, mas isso muda o tom de todas as telas de
acompanhamento, então é chamada sua.

---

### VIS-03 · Uma operação parcialmente entregue some do Início e da aba "Operações"

**Telas:** `07-inicio-ativo`, `08-lista-solicitacoes` (por contraste).

**Observação.** Dois filtros independentes omitem `PARCIALMENTE_ENTREGUE`:

*Backend*, `shipperTrackingService.js` — o resumo do Início:
```js
const emAndamento = itens.filter((i) => [
  EM_ANALISE, ACEITA, EM_PLANEJAMENTO, AGENDADA, EM_TRANSPORTE,
].includes(i.status_externo));          // PARCIALMENTE_ENTREGUE ausente
```

*Frontend*, `PortalLista.tsx` — o que a aba "Operações" mostra:
```js
const EM_OPERACAO = new Set([
  'ACEITA','EM_PLANEJAMENTO','AGENDADA','EM_TRANSPORTE','ENTREGUE',
  'COMPROVANTE_DISPONIVEL','ATUALIZACAO_EM_PROCESSAMENTO',
]);                                      // PARCIALMENTE_ENTREGUE ausente
```

O mesmo arquivo de backend afirma o contrário em `derivarProximaAcao`, com
comentário explícito: *"Entrega parcial ainda é operação em curso do ponto de
vista do cliente: parte da carga dele continua esperando"* — e devolve a ação
"Acompanhar operação". A intenção está escrita; os filtros não a seguem.

**Consequência concreta.** Um embarcador cuja única operação está parcialmente
entregue abre o Início e encontra os três blocos vazios — o que cai no texto
**"No momento, nenhuma ação é necessária."** Metade da carga dele não chegou. Na
aba "Operações", o pedido também não aparece. Ele só o encontra em "Solicitações"
ou por link direto.

Agrava: `resumoInicio` monta um bloco `recentes`, que seria a rede de segurança
para casos assim — e `PortalInicio.tsx` **nunca o renderiza** (ver VIS-11).

**Direção proposta.** Incluir `PARCIALMENTE_ENTREGUE` nos dois filtros. A
pergunta de produto que sobra é se ele merece um bloco próprio no Início
("Entrega incompleta") em vez de se misturar a "Em andamento" — eu não decidiria
isso sozinho, porque muda o peso relativo dos blocos.

---

### VIS-04 · No celular, o Início quebra o texto palavra a palavra

**Telas:** `mobile/07-inicio-ativo-mobile.png`, `mobile/43-duas-transportadoras-mobile.png`.

**Observação.** No bloco "Comprovantes disponíveis", o título do pedido é
renderizado assim, uma palavra por linha:

```
Algodão
em
pluma
.
Armazém
de
Luís
Eduardo
```

e a linha de referência quebra em `SOL- / 2026- / 0004 / · 320 / t · / atualizado
/ em / 23/08/2026`. Sem rolagem horizontal (`scrollWidth == clientWidth == 390`) —
o texto está espremido, não vazando.

**Causa.** Em `LinhaOperacao` (`PortalInicio.tsx`) o item é
`flex flex-wrap items-center justify-between`, com o texto em `min-w-0 flex-1` e o
par selo+botão num `flex` sem largura mínima. Como o grupo de ações não força a
quebra de linha, ele fica na mesma faixa e o texto encolhe até a largura de uma
palavra. Repare que "Em andamento" — o único item **sem** botão — não quebra.
Quanto mais ação, pior a legibilidade.

**Por que importa.** É a primeira tela do portal, no dispositivo que um produtor
rural mais usa, e o que fica ilegível é justamente o que identifica a carga.
Contraste com `mobile/20-ajustes-solicitados-mobile.png`, que é o mesmo conteúdo
em outro layout e fica ótimo — o portal sabe fazer isso, só não aqui.

**Direção proposta.** Empilhar texto e ações abaixo de `sm:` (ações em linha
própria, largura total), como já ocorre no detalhe. Não mexi porque envolve
decidir se no celular o botão vira largura total ou fica alinhado à direita — e
isso é escolha visual sua.

---

### VIS-14 · Nome longo de embarcador força rolagem lateral em toda a página (390 px)

**Tela:** `mobile/50-conteudo-longo-mobile.png`. Medida em `medidas.json`.

**Observação.** Com um nome de empresa realista e comprido — *"Cooperativa
Agroindustrial dos Produtores de Grãos do Oeste Baiano e Sul do Piauí"* — a
página inteira passa a rolar na horizontal:

```
cena "conteudo-longo"   scrollWidth = 625   clientWidth = 390   → estoura 235 px
elementos que vazam (right = 625):
  div.flex.flex-1              "☰ Matopiba Log · Portal do Embarcador…"
  div.min-w-0                  idem
  p.text-sm.font-semibold      "Matopiba Log"
  p.truncate.text-xs           "Portal do Embarcador · Cooperativa Agroi…"
```

Nas outras seis cenas medidas, `scrollWidth == clientWidth == 390` — o layout do
portal é sólido; o problema é exclusivo do cabeçalho com texto longo.

**Causa.** Em `PortalLayout.tsx` o `div.min-w-0` que envolve o nome está dentro de
um `div.flex.flex-1` que **não** tem `min-w-0`. Em flexbox, `flex-1` não encolhe
abaixo do conteúdo enquanto `min-width` for `auto`, então o `truncate` do
parágrafo nunca chega a agir: há espaço "de sobra" segundo o cálculo do flex, e a
sobra vira largura de página.

**Por que importa.** Pelo seu próprio critério (§35), rolagem horizontal em fluxo
essencial no celular é `VISUAL_HIGH` — e aqui ela contamina **todas** as telas
autenticadas, porque o cabeçalho é comum a todas. Cooperativas e grupos do agro
costumam ter exatamente esse tipo de razão social, então não é um caso de
laboratório.

**Direção proposta.** Acrescentar `min-w-0` ao contêiner flex do cabeçalho, para
o `truncate` que já está lá passar a funcionar. É correção de uma classe, mas fica
com você porque envolve decidir o que truncar primeiro no celular — o nome do
embarcador, o rótulo "Portal do Embarcador", ou ambos.

---

## MEDIUM

### VIS-05 · Enviar o pedido não confirma nada

**Tela:** `13-pedido-enviado`.

Ao enviar, o portal navega para
`/portal/embarcador/operacoes/{id}?enviada=1`. O parâmetro `enviada` **nunca é
lido** — `PortalOperacao` só consome `acao`. Não há toast, faixa ou frase
dizendo "pedido enviado": a tela simplesmente troca. Quem clicou em "Enviar
pedido" com receio de ter clicado duas vezes não recebe resposta.

Falta também o "o que acontece a seguir" (§15): há o selo "Em análise" e a linha
do tempo, mas nenhuma frase do tipo *"A transportadora vai analisar e responder
por aqui. Você recebe a resposta nesta tela."*

O `?enviada=1` no código é a evidência de que a confirmação foi pensada e ficou
pelo caminho.

**Direção:** consumir `enviada=1` e mostrar confirmação + próximo passo. Formato
(faixa fixa ou toast temporário) é escolha sua.

---

### VIS-06 · Cinco situações diferentes com o mesmo selo cinza

**Telas:** `30`, `31`, `33`, `36`, `08`.

`PortalUI.TOM` mapeia cor para: ajustes (âmbar), recusada (vermelho), cancelada,
entregue/comprovante (verde), em transporte (azul), processando. Ficam **sem
mapa**, caindo no cinza padrão: `EM_ANALISE`, `ACEITA`, `EM_PLANEJAMENTO`,
`AGENDADA` e `PARCIALMENTE_ENTREGUE`.

O efeito colateral que me incomoda: **"Entrega parcial" fica visualmente idêntico
a "Cancelada"** — um estado vivo, com carga a caminho, com a mesma aparência de um
estado morto.

A favor do desenho atual: o rótulo textual está sempre presente, então nada
depende só de cor (§38 satisfeito). Isso é acerto, não sorte.

**Direção:** dar tom próprio ao menos a `PARCIALMENTE_ENTREGUE` (atenção, não
sucesso), e decidir se os estados "em curso" merecem um tom neutro distinto do
tom dos "encerrados". É calibragem visual — sua.

---

### VIS-07 · O botão de anexar arquivo aparece em inglês

**Telas:** `13`, `20`, `22`, `33`, `36`, `40`.

"Choose File / No file chosen" no envio de documento. É o `<input type="file">`
nativo: o texto vem do **navegador**, não do app — num Chrome em português sai
"Escolher arquivo". Por isso não é BLOCKER.

Mas continua sendo um achado: o app não controla essa string, ela não é
traduzível, e é o único ponto do portal onde o idioma escapa das suas mãos. O
padrão usual é esconder o input e acionar por um `<label>`/botão próprio ("Escolher
arquivo do computador"), que também permite estados de arrastar-e-soltar.

---

### VIS-08 · O comprovante não tem pré-visualização

**Tela:** `35-comprovante-disponivel`, `40-documentos-lista`.

Abrir qualquer arquivo pede a URL assinada no clique e chama `window.open` — nova
aba, sem miniatura nem visualização embutida. Seu §28 pedia preview primeiro,
download depois.

O comprovante costuma ser uma foto de canhoto: uma miniatura resolveria a
pergunta "é este mesmo?" sem tirar a pessoa da tela. A arquitetura atual (URL
curta pedida no clique) é boa e não impede isso.

**Direção:** miniatura para imagem, visualizador embutido para PDF, mantendo
"Abrir" como ação secundária. Tem custo — decisão sua se cabe agora.

---

### VIS-09 · O embarcador não vê o que mudou entre os envios; a transportadora vê

**Telas:** `22-historico-envios` (externo) vs `62-inbox-detalhe` (interno).

No lado da transportadora existe um bloco **"O QUE MUDOU NO ENVIO 2"** com o
comparativo item a item (`Quantidade total: 850 t → 800 t`). Excelente.

No portal do embarcador, o histórico lista os envios com "Total: 800 t · 2 locais"
e "Total: 850 t · 2 locais" em cartões separados — a comparação fica por conta da
cabeça de quem lê. A função `diferencas()` que produz o comparativo existe só na
tela interna.

Some a isso uma inconsistência de ordem **dentro da mesma tela**: o histórico vem
do mais novo para o mais antigo (Envio 2 acima do Envio 1, seguindo a ordem do
backend), enquanto "Andamento", logo abaixo, é cronológico crescente. Ler a
correção de cima para baixo mostra o resultado antes da causa: o motivo do ajuste
está no Envio 1, no fim.

**Direção:** reusar a mesma ideia de comparativo no portal, ou inverter a ordem do
histórico externo para casar com "Andamento". As duas coisas são independentes.

---

### VIS-10 · "Solicitações" e "Operações" mostram o mesmo pedido, e o vocabulário alterna

**Telas:** `08-lista-solicitacoes`, `09-lista-operacoes-vazia`.

"Solicitações" não filtra nada — lista tudo, inclusive o que já virou transporte.
"Operações" filtra por estado. Então o mesmo item aparece nas duas abas, sem que
a diferença esteja explicada em lugar nenhum.

No vocabulário, a mesma coisa é chamada de três formas: a navegação diz
**Solicitações**, os textos dizem **pedido** ("Você ainda não pediu nenhum
transporte", "Enviar pedido", "Nenhum pedido ainda") e o botão diz **"Pedir um
transporte"**. Internamente faz sentido (solicitação → operação); para quem está
de fora, é a mesma coisa com nomes diferentes.

**Direção:** ou uma palavra só na fala com o cliente ("pedido"), com a navegação
distinguindo por fase ("Meus pedidos" / "Em transporte"), ou manter os dois nomes
e explicar a diferença. Terminologia de produto — sua.

---

## LOW

### VIS-11 · `recentes` é calculado, trafegado e nunca exibido

`resumoInicio` monta `recentes: itens.slice(0, 5)` e o tipo `Resumo` em
`PortalInicio.tsx` declara o campo — mas nenhum JSX o usa. Payload morto. Só
seria inofensivo se não fosse justamente o que salvaria o caso do VIS-03.

### VIS-12 · Sem "mostrar senha" no login e na ativação

**Telas:** `01`, `03`, `04`. Os campos de senha não têm alternância de
visibilidade. No celular, digitar às cegas uma senha existente (o caso do `04`,
onde ela precisa acertar a senha que já usa) é onde mais dói. O app Flutter já
tem esse controle — a web do portal, não.

### VIS-13 · Foco de teclado sem estilo próprio nos botões

Os campos de texto têm `focus:ring-1 focus:ring-emerald-600` explícito; os botões
não declaram estilo de foco e ficam com o padrão do navegador. Funciona, mas o
anel padrão sobre o verde escuro dos botões primários tem contraste fraco. Não
consegui capturar estado de foco de forma confiável em screenshot — vale um teste
manual navegando só de Tab.

---

## NOTE (contexto, não são defeitos do Portal V1)

### NOTE-01 · Sidebar do painel interno aparece nas cenas da transportadora

Nas capturas `60`–`67` a lateral mostra "OPERACAO" sem acento e, no celular, uma
faixa de ícones de ~80 px sempre presente. Isso é o shell do painel, não o Portal
V1 — está no enquadramento apenas porque a caixa de entrada vive dentro dele.
Fora de escopo por §42; registro para você não confundir com achado do portal.

### NOTE-02 · Deep-links do portal respondem HTTP 404 (e está correto)

`/portal/embarcador/entrar` devolve 404 e serve o `404.html` do app, que restaura
a rota via `spa-redirect.js`. É o padrão de SPA do GitHub Pages, idêntico para
`/login`, `/planos` e `/dashboard`. No navegador o link do convite abre normal.
Já registrado no fechamento do PORTAL-B; repito aqui porque, sendo o convite
entregue por link manual, é a primeira coisa que parece quebrada quando não é.

---

## O que está bem resolvido

Não é cortesia — é para você saber onde **não** gastar tempo:

- **O formulário de pedido** (`10`, `11`, `12`) passa no teste que importa: parece
  declarar uma necessidade, não preencher o banco da transportadora. Nenhum ID
  interno, distância, diesel, veículo, motorista ou número de viagens. Multi-origem
  continua compacto com três locais e o total é derivado, nunca digitado.
- **A ativação com conta existente** (`04`) — o ponto mais fácil de errar do fluxo —
  diz que a conta já existe, pede a senha atual, afirma que ela não será trocada e
  esconde o "repita a senha". Está certo em todos os detalhes.
- **O detalhe da operação no celular** (`mobile/20`) é exemplar: motivo legível,
  CTA grande, resumo alinhado.
- **A caixa de entrada da transportadora** (`61`, `62`) é organizada por decisão, o
  comparativo entre envios existe, e aceitar é um clique sem redigitar nada.
- **A ausência de permissão** (`65`) explica o motivo e o caminho, em vez de
  desabilitar um ícone em silêncio.
- **Nenhum dado interno vaza** para o embarcador: sem motorista, placa, valor de
  frete ou vocabulário de campanha em nenhuma das 37 cenas.
- **Todo estado de carregamento, erro e vazio existe** e é acionável — nunca uma
  tela branca.
