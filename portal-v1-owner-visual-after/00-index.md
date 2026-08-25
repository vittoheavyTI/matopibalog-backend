# Portal do Embarcador V1 — pacote "depois" da correção

> Continuação de [`portal-v1-owner-visual/`](https://github.com/vittoheavyTI/matopibalog-backend/pull/479),
> que segue como evidência do estado anterior. Aqui estão só as cenas **afetadas**
> pelos achados, mais as telas que passaram a existir — regerar as 85 capturas
> originais não provaria nada além de gastar o seu tempo.
>
> Gerado com o mesmo harness contido: nenhum dado de produção foi criado, lido ou
> tocado. As telas são o código de produção; só as respostas de API são fixtures.

| | |
|---|---|
| Base | `fix/portal-v1-owner-visual-acceptance` sobre `main` @ `fd5965d8` |
| Migration | **nenhuma** — 080 e 081 intocadas |
| Cenas | 15 |
| Capturas | 30 (1440×900 e 390×844) |
| Escritas em produção | 0 |

## Provas objetivas (`medidas-after.json`)

Não são "está melhor na minha opinião" — são medidas do navegador:

| Verificação | Antes | Depois |
|---|---|---|
| Destaques semânticos renderizados **brancos** | `rgb(255,255,255)` em todos | **0 de 48** |
| Cenas com **rolagem lateral** em 390 px | `scrollWidth=625` vs `client=390` | **0 de 30** |
| Entrega parcial visível na home | ausente | presente, com tom de atenção |
| Entrega parcial na lista de transportes | ausente | presente |
| Quanto já foi entregue / quanto falta | não exibido | exibido |

## O que olhar em cada cena

### `07-inicio-ativo` · Início com atividade
O bloco "Precisa da sua atenção" agora tem **fundo âmbar de verdade**, e
"Comprovantes disponíveis" tem verde. No celular, compare com a versão anterior:
o título do pedido não quebra mais uma palavra por linha, e a ação primária
ocupa a largura toda.

### `07b-inicio-entrega-parcial` · Início com **só** uma entrega parcial
**A cena que mais importa.** Antes, este embarcador via os três blocos vazios e a
frase "No momento, nenhuma ação é necessária" — com metade da carga por chegar.
Agora o pedido aparece em "Em andamento", o bloco fica em tom de atenção e o
texto diz que parte da carga ainda está a caminho.

### `13-pedido-enviado` · Logo após enviar
Confirmação explícita ("Pedido enviado com sucesso") e o que acontece a seguir.
Antes a tela apenas trocava, sem resposta nenhuma a quem clicou.

### `20-ajustes-solicitados` · A transportadora pediu ajustes
O bloco de aviso agora é visivelmente um aviso. Botão "Corrigir pedido" junto do
motivo, em largura total no celular.

### `22-historico-envios` · Histórico com comparativo
Ordem **cronológica**: envio 1, o motivo do ajuste, envio 2. O envio atual está
marcado, e **"O que mudou neste envio"** lista as diferenças — o mesmo
comparativo que a transportadora sempre teve. Confira a direção: 850 t → 800 t é
uma redução, e é assim que precisa aparecer.

### `33-tracking-entrega-parcial` · Entrega parcial
**Carga solicitada 1.200 t · Já entregue 500 t · Ainda falta 700 t.** O número
vem do backend; a tela não calcula nada. "Ainda falta" fica em âmbar enquanto
houver resto.

### `34-tracking-entregue` · Entrega concluída
Mesmo bloco, com `Ainda falta 0 t` — verdadeiro, sem alarme desnecessário.

### `35-comprovante-preview` · Comprovante em pré-visualização
Abre **dentro da tela**. Baixar e abrir em nova guia viraram secundários. A URL
assinada continua sendo pedida no clique — o modelo de autorização não mudou.

### `40-documentos-do-pedido` · Documentos de um pedido
Comprovante, documentos da transportadora e os seus, diferenciados. O seletor de
arquivo agora é **"Escolher arquivo / Nenhum arquivo selecionado"**, em vez do
"Choose File" que vinha do navegador.

### `43-duas-transportadoras` · Seletor de transportadora
Continua utilizável no celular, agora sem competir por espaço com o nome.

### `50-conteudo-longo` · Estresse de layout
O caso que quebrava tudo: nome de cooperativa comprido. Agora ele **trunca**, e
"Matopiba Log" + "Portal do Embarcador" permanecem legíveis. Sem rolagem lateral.

### `70-aba-pedidos` / `71-aba-transportes` · A separação nova
O mesmo conjunto de dados nas duas abas. Repare que **nenhum item aparece nas
duas**: "Pedidos" tem o que ainda está sendo decidido (incluindo o aceito cuja
operação ainda não foi criada) e "Transportes" tem só o que virou operação real.

### `72-aba-documentos` · Aba nova
Todos os arquivos de todos os pedidos, agrupados por origem, cada um com link
para o pedido de onde veio.

### `62-inbox-detalhe` · Caixa de entrada da transportadora
Mudou pouco de propósito — já estava bem. O que mudou: abrir um documento do
embarcador agora usa a mesma pré-visualização do portal externo.

## O que este pacote NÃO decide

`OWNER_VISUAL_VALIDATION` continua **`PENDING`** e `RBV9-INV-081` continua
**`IMPL_NV`**. Corrigir os achados não substitui a sua revisão — e segue valendo
que nenhum embarcador real usou o portal ainda, que o convite é entregue por link
manual, e que o fluxo ponta a ponta com dados verdadeiros nunca rodou.

Veja [`status-findings.md`](./status-findings.md) para o estado final de cada
achado, um a um.
