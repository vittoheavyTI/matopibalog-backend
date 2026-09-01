# Partner Network V1 — E3.6A (rede privada de parceiros)

> Fundação da rede privada: relacionamentos explícitos, fronteira Partner
> Lite / Partner Client, e compartilhamento de lacuna de capacidade de Campanha
> com resposta operacional. **Sem preço, sem adjudicação, sem marketplace.**

- `E36A_AUDIT_FROZEN=true`
- `BASE=main @ bd146840`
- `RBV9-INV-082` — permanece `IN_PROGRESS` até a migration ser aplicada

## 1. Auditoria delta (congelada)

| # | Pergunta | Resposta | Classe |
|---|---|---|---|
| A | Alguma tabela de parceiro/rede já existe? | **Não** — nem no código nem em produção (`partner%` = 0 tabelas) | `NEW` |
| B | As primitivas de identidade externa do Portal são generalizáveis? | **Sim, o padrão** — `token_hash` + `expires_at` + ativação única + índice parcial de pendência. Mas em tabelas próprias | `REUSE` (padrão) + `NEW` (tabelas) |
| C | Que `token_kind` existem hoje? | Um: `shipper_portal` | `EXTEND` |
| D | Como o `verifyToken` interno barra identidade externa? | Rejeita `token_kind` externo **antes** do `jwt.verify`, nos dois caminhos (SEC-1 ligado e legado) | `EXTEND` |
| E | Como o tenant deriva `empresa_id`? | De `usuarios.empresa_id`; `?empresa_id=` só para super-admin | — |
| F | Que serviço produz o `capacity_gap`? | **Ver §2 — não é o que o nome sugere** | `DEFERRED` |
| G | Como se resolve o plano aprovado atual? | `operation_campaigns.approved_plan_version_id` + `campaignProgressService` (que também dá `replan.status`) | `REUSE` |
| H | Que campos podem ser compartilhados? | Ver §6 | — |
| I | Existe autoridade canônica de preço/adjudicação? | **Não.** `PORTAL_QUOTE_PROPOSAL_V1B` está deferida pela mesma razão, e nenhuma decisão posterior mudou isso | `DEFERRED` |
| J | Que convenção de permissão/entitlement seguir? | `permissionRegistry` com `entitlementCodigo`; `funcionalidades`/`plano_funcionalidades`/`empresa_funcionalidades` | `EXTEND` |
| K | Que realtime pode ser reusado? | SSE em `routes/realtime.js` (interno). Externo fica em polling (§56) | `REUSE` + `DEFERRED` |
| L | Que primitivas de correlação/auditoria reusar? | `client_request_id` com índice único **parcial** (migration 018) e o padrão de evento append-only de `lancamento_eventos` (actor/source/reason/metadata/occurred_at) | `REUSE` |

### Sobre §58 e a correlação da E1.5

O prompt pede reusar `request_id` / `correlation_id` / `operation_id` /
`causation_id`. **Essas colunas não existem no schema.** O que existe e é
canônico é `client_request_id` (idempotência, índice único parcial) mais
`metadata jsonb` nos eventos. É isso que esta frente usa — reusar o que existe é
melhor que inventar quatro colunas que nada mais preenche.

## 2. `capacity_gap` — o achado da auditoria

O prompt (§22) manda usar o `capacity_gap` "já produzido pela stack
determinística". Auditando a produção desse valor:

```js
// campaignService.js — cenário do planejador
capacity_gap_quantity: hardExceptions
  ? sortedDemands.reduce((sum, d) => sum + Number(d.target_quantity || 0), 0)
  : 0,
```

Duas coisas erradas para o nosso uso:

1. **Não é o residual.** Se houver *qualquer* exceção `HARD_CONSTRAINT`, o valor
   é a soma de **todas** as demandas — não o que ficou sem cobertura. Uma
   campanha 90% planejada com um bloqueio devolveria 100% como "lacuna".
2. **Soma unidades diferentes.** `d.target_quantity` é somado cru, sem passar por
   `toKg`. Demandas em `ton` e `kg` viram um número só, sem significado.

Compartilhar isso com parceiros seria pedir capacidade para um número inventado.

**Este campo não é consumido por nenhuma superfície** (nem API, nem tela) — é um
metadado interno de cenário. Então não há regressão em não usá-lo, e esta frente
**não o altera**: mexer no planejador determinístico é outra frente, com outros
testes. Fica registrado como `CAMPAIGN_SCENARIO_CAPACITY_GAP_IMPRECISO`.

**A fonte usada aqui é `campaignProgressService`**, que tem a fórmula canônica
num lugar só:

- `remaining = max(0, target − completed)` — cancelado **não** abate a demanda,
  porque a carga do cliente continua precisando ser transportada;
- unidade preservada, com `compatible: false` para unidade fora do domínio de
  massa (não há conversão inventada);
- `known: false` distinto de zero — `UNKNOWN != ZERO` (§30);
- `replan.status`, que é o que torna a detecção de obsolescência possível (§31).

## 3. Fronteira: Lite vs Client

Uma organização parceira é **uma identidade lógica**, que opera de duas formas:

| | Partner Lite | Partner Client |
|---|---|---|
| Tenant Matopiba | não tem | tem o **próprio** |
| Identidade | externa, tabela própria **sem `empresa_id`** | `usuarios` do tenant dele |
| Autenticação | `token_kind='partner_portal'` | login normal do produto |
| Acesso ao tenant do solicitante | **nenhum** | **nenhum** |
| Frota/motoristas/histórico | não aplicável | ficam no tenant dele, sem duplicar |

O motivo de a identidade Lite **nunca** ser um `usuario` é concreto e foi o mesmo
que guiou a E3.5: `middlewares/tenant.js` deriva `req.empresa_id` de
`usuarios.empresa_id`. Inserir o parceiro ali lhe daria o tenant do solicitante
inteiro.

**Conversão Lite → Client** (§13) não é implementada nesta fatia, mas o schema a
permite sem reescrever histórico: a organização parceira ganha
`linked_empresa_id`, e todo o histórico (relacionamento, oportunidades,
respostas) aponta para a **organização**, não para a forma dela.

O vínculo com uma empresa Matopiba é **sempre explícito** — nunca por nome,
domínio de e-mail, telefone ou semelhança de CNPJ (§14).

## 4. Relacionamento privado

Ciclo: `INVITED → ACTIVE → SUSPENDED → REVOKED`.

O relacionamento é **do solicitante**: `partner_relationships(empresa_id,
partner_organization_id)`. A empresa A não enxerga a rede da empresa B, suas
relações, seus convites, suas oportunidades ou as respostas que recebeu.

Um parceiro convidado **não consegue enumerar os outros** convidados da mesma
oportunidade (§17) — cada destinatário lê apenas a própria linha de share.

**Revogação corta acesso imediatamente**: leitura de oportunidade, resposta nova
e revisão de resposta. O histórico permanece auditável.

## 5. Modelo de compartilhamento

O caminho feliz começa **dentro da Campanha** (§24): quando há lacuna residual
real, aparece a ação "Buscar capacidade na rede". O operador não redigita carga,
origem, destino, quantidade, unidade ou janela — tudo isso já existe.

O que se pede a mais é só o que não dá para derivar (§25): **quais parceiros**,
**prazo de resposta** e uma **mensagem opcional**.

## 6. O snapshot compartilhado

Uma oportunidade compartilhada é um **snapshot imutável**. Endpoints de parceiro
nunca fazem *read-through* no tenant do solicitante.

**Compartilhado:** descrição da carga, origem(ns), destino, quantidade ainda
necessária, unidade, janela de coleta/entrega, restrições operacionais
declaradas, prazo de resposta.

**Nunca compartilhado por padrão:** preço interno do frete, margem, dados
financeiros de motorista, premissas de combustível, estrutura de custo, os outros
parceiros, inventário de frota, dados pessoais de motorista, documentos privados,
permissões, lista de usuários, diagnósticos crus.

A procedência (campanha, versão do plano, item de demanda, versão do snapshot,
autor, `client_request_id`) é **persistida** para prova, mas **não vai** no
payload externo — o parceiro recebe um identificador opaco da oportunidade.

## 7. Obsolescência (§31/§32)

O snapshot é história e **não é reescrito**. Mas o share tem estado próprio:

| Estado | Significado |
|---|---|
| `CURRENT` | vale como pedido atual |
| `SUPERSEDED` | um share mais novo da mesma origem o substituiu |
| `WITHDRAWN` | o solicitante retirou |
| `STALE_SOURCE` | a campanha replanejou ou o residual mudou |

Antes de aceitar qualquer resposta, o servidor **revalida** o estado da fonte.
Uma oportunidade obsoleta não vira trabalho executável por acidente.

## 8. Resposta do parceiro

Permitido nesta fatia: `AVAILABLE`, `PARTIALLY_AVAILABLE`, `DECLINED`, com
`capacity_quantity`, janela de disponibilidade e nota opcional.

**Proibido:** preço, tarifa, R$/ton, R$/km, comissão, taxa, valor de acerto.

Revisão é **append-only**: cada envio cria uma revisão nova, e a resposta atual é
a projeção determinística da última. Nada é sobrescrito.

Validação no servidor: relacionamento ativo · destinatário confere · oportunidade
aberta e `CURRENT` · prazo · quantidade > 0 · quantidade ≤ lacuna compartilhada ·
**mesma unidade** · nenhum id estrangeiro.

## 9. Autorização

```
Interno:  ENTITLEMENT ∧ PERMISSÃO ∧ ESCOPO ∧ TENANT
Externo:  IDENTIDADE_EXTERNA ∧ RELACIONAMENTO_ATIVO ∧ SHARE_EXPLÍCITO ∧ ESTADO_DO_SHARE
```

Sem atalho por nome de papel (D-072).

Entitlement: `partner_network`, `DEFERRED_DEFAULT_DENY` — sem mapeamento
comercial de plano e **sem override de empresa em produção**.

Permissões: `partner_network.view`, `partner_network.manage`,
`partner_network.share` e `partner_network.respond`.

Baseline: Administrador e Gerente de Frota recebem as operacionais; **Operador é
`DEFAULT_DENY`** para gestão e compartilhamento, e a empresa pode delegar depois
por template editável. Nenhuma permissão financeira é concedida.

## 10. O que E3.6A **não** faz

Não declara vencedor · não aloca viagem · não cria frete · não cria vencedor de
Dispatch · não cria acerto com parceiro · não cria fatura, evento de billing,
evento fiscal ou evento de ERP · não constrói marketplace, busca pública de
transportadora, ranking, score ou preço.

`E36B_PRICE_AND_AWARD_PRODUCT_DECISION_GATE=PENDING`.

## 11. Owner review — correção R2 (HIGH-09..15)

Segunda rodada de revisão. A migration 082 **não** havia sido aplicada, então ela
foi corrigida **no lugar** — sem 083. Os sete achados têm um fio comum: em cada
um, a promessa estava escrita no código e o mecanismo não a sustentava.

### HIGH-09 — o e-mail do convite é a autoridade

`INVITATION_EMAIL_IS_AUTHORITATIVE=true`

A ativação fazia `email: body.email || convite.email`. O corpo **substituía** o
alvo, então quem tivesse o link — uma credencial ao portador, entregue à mão —
informava a própria conta, provava posse dela e entrava no lugar do convidado. A
prova de senha continuava acontecendo e provava a identidade errada.

Agora `body.email` só **confirma** (divergir é 403), e existe um preflight
não-consumidor, `partner_network_preflight_invitation`, que valida token,
expiração e situação do relacionamento **antes** de qualquer identidade nascer no
Supabase Auth. Um convite morto deixou de produzir conta nova em produção.

O preflight usa a **mesma matriz** da RPC de ativação, `ACTIVE` inclusive: o
reconvite legítimo (uma segunda pessoa da mesma organização parceira) precisa
passar nos dois, ou o segundo acesso seria impossível de conceder. Duas
autoridades divergindo é a classe de erro que este achado é.

### HIGH-10 — o contrato de saída da RPC

O serviço lia `linha.relationship_id` e `linha.partner_organization_id`; a RPC
devolve `out_*`. Os dois campos chegavam `undefined`, viravam claims ausentes no
JWT, e o próprio `verifyPartnerToken` recusava a sessão recém-emitida. A ativação
inteira estava quebrada e a bateria passava — porque nenhum teste ia da RPC até o
token. A leitura agora é estrita (campo ausente = erro, nunca fallback), e o
teste HTTP atravessa RPC → serviço → `POST /portal/parceiro/ativar` → JWT →
`GET /eu`.

### HIGH-11 — estado e evento são a mesma decisão

`PARTNER_NETWORK_AUDIT_IS_TRANSACTIONAL_ONLY=true`

`UPDATE` seguido de `registrarEvento()` são duas transações. O UPDATE commitava
sozinho: uma revogação podia valer sem registro de quando nem por quem — e
"provar depois" é o único uso de um log de auditoria.

Duas RPCs novas — `partner_network_set_relationship_status` e
`partner_network_withdraw_opportunity` — travam a linha, validam a transição,
mudam o estado e gravam o evento na mesma transação. A máquina de estados passou
a viver **no banco**, não só no JavaScript. E o gravador de evento avulso foi
**removido**: mantê-lo exportado manteria a armadilha, porque ele parece
suficiente.

### HIGH-12 — autorização antes de idempotência

A RPC de resposta resolvia `client_request_id` **primeiro** e retornava. Isso
transformava um id de requisição conhecido numa chave-mestra de leitura: devolvia
200 com id e revisão depois da revogação, com a organização errada, com a fonte
obsoleta ou com o prazo vencido. Um replay não pode ser mais poderoso que a
chamada original.

Ordem congelada: destinatário → organização → relacionamento → **ator** →
oportunidade → prazo → fonte → idempotência → escrita.

`p_partner_user_id` deixou de ser rótulo livre (§9): precisa existir, estar
`ATIVO` e pertencer à mesma organização. `partner_client` continua **fora** da
E3.6A — a coluna existe para não reescrever a tabela depois, e a porta segue
fechada até haver decisão.

### HIGH-13 — a auto-correção precisa persistir

A RPC marcava `STALE_SOURCE`, gravava o evento e dava `RAISE EXCEPTION`. O RAISE
aborta a transação e leva as duas escritas junto: o comentário prometia "marca o
estado para a próxima leitura chegar honesta" e o banco não guardava nada. A
oportunidade seguia `CURRENT` para sempre, recusando cada resposta com o mesmo
erro e sem nunca contar por quê.

Agora devolve `out_result='SOURCE_STALE'` e **commita**: zero resposta inserida,
estado e evento persistidos. O serviço converte em HTTP 409 — a recusa continua
recusa, mas deixa rastro.

### HIGH-14 — todos os pedidos, ou nenhum

`SHARE_RECIPIENT_POLICY_V1=ALL_REQUESTED_OR_FAIL`

Pedir `[A, B, C]` com B revogado compartilhava com A e C, devolvia 201 e
informava "2 destinatários" — um número que ninguém lê como "faltou o B". O
operador acreditava ter pedido capacidade a três parceiros; a lacuna que ele dava
por coberta continuava aberta, e a descoberta vinha tarde.

A lista é normalizada (nulos fora, duplicatas colapsadas, ordenada por id), todos
os pedidos são travados nessa ordem estável **antes** de qualquer decisão, e
todos precisam existir, ser da empresa e estar `ACTIVE`. Qualquer um inválido
reprova a operação inteira: zero oportunidade, zero destinatário, zero evento.

O teste que afirmava o contrário — *"share ignora parceiro revogado e mantém o
ativo"* — consagrava o defeito e foi substituído.

Idempotência de share também endureceu: mesma chave com campanha ou plano
diferente agora é `partner_share_idempotency_conflict`, nunca o share anterior
devolvido em silêncio.

### HIGH-15 — uma identidade, várias redes

`PARTNER_MULTI_NETWORK_LOGIN_V1=EXPLICIT_CONTEXT_SELECTION`

O login resolvia por `maybeSingle()` sobre `auth_user_id`, e essa chamada
**falha** com mais de uma linha. Duas linhas para a mesma identidade não são
corrupção: são o caso normal de quem é parceiro de duas transportadoras com o
mesmo e-mail. Na prática, aceitar o segundo convite **quebrava o login do
primeiro**, com erro de servidor e sem explicação.

As duas saídas fáceis estão descartadas por decisão:

- `auth_user_id` **não** vira único global — isso proibiria o segundo convite
  legítimo, com a rede da empresa B negando acesso porque a A convidou antes;
- nenhuma linha é escolhida em silêncio — a pessoa entraria na rede errada sem
  saber.

Com 0 vínculos ativos: nega. Com 1: emite a sessão direto. Com mais de 1:
`requires_context_selection=true` e **apenas** os contextos daquela identidade.
A escolha vai para `POST /portal/parceiro/contexto`, que prova a senha de novo e
exige que o vínculo pertença ao `auth_user_id` autenticado. Um token, um
contexto: o da rede A não alcança a B.

Nada liga duas organizações automaticamente — nem por e-mail, CNPJ, nome ou
domínio. Cada vínculo nasce de um convite explícito.

A tela de escolha mostra o nome da **organização parceira**, nunca o da
transportadora solicitante: o portal inteiro é construído sobre "nada do
solicitante sai daqui", e uma tela que aparece *antes* de existir sessão não é
lugar para abrir exceção.

### Resíduos fechados

- **`REPLAN_RPC_ERROR_HANDLING`** — `approvePlan` usava `try/catch` em volta de
  `supabase.rpc()`. O client não lança em erro de RPC: resolve com
  `{ data, error }`. Função ausente, sem permissão ou com exceção voltavam por
  `error` e o `catch` nunca era alcançado — o único aviso existente era
  inalcançável na prática, e a marcação podia estar quebrada em produção
  indefinidamente sem uma linha de log. Agora lê `{ error }` e registra. Segue
  não-fatal de propósito: a autoridade final é a revalidação da fonte dentro da
  transação da resposta.
- **`PARTNER_AUTH_METADATA_DOMAIN`** — o serviço compartilhado gravava
  `portal_embarcador: true` em qualquer conta que criasse, inclusive as de
  parceiro. A marca ficava simplesmente falsa. O metadata passou a ser
  parametrizado (`userMetadata`), com o default preservando a E3.5 e o parceiro
  usando `partner_portal: true`. **Metadata não é autoridade** — é proveniência;
  nenhum caminho de autorização lê dali.

### Fora de escopo, ainda em aberto

- `PARTNER_CLIENT_UX_DECISION_NEEDED=DEFERRED`
- `E36B_PRICE_AND_AWARD_PRODUCT_DECISION_GATE=PENDING`
- `CAMPAIGN_SCENARIO_CAPACITY_GAP_IMPRECISO=TECH_DEBT_SEPARATE_NOT_FIXED` (§2)
