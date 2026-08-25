# Portal do Embarcador V1 — PORTAL-B (acesso, revisão, acompanhamento, comprovantes)

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados após o fechamento técnico. Continuação de
> [SHIPPER_PORTAL_V1](./SHIPPER_PORTAL_V1.md) (PORTAL-A).

- `MACROFRONT=E3_5_SHIPPER_PORTAL_V1_PORTAL_B` · fatia `PORTAL-B`
- `MIGRATION_REQUIRED=true` · `MIGRATION_FILE=081_shipper_portal_b_revision_documents.sql`
- `OWNER_MIGRATION_GATE_SHIPPER_PORTAL_B_081=AUTHORIZED` — migration **aplicada em produção uma única vez** em 2026-08-25
- `PORTAL_B_STATUS=TECHNICALLY_CLOSED_IN_PRODUCTION` · `E3_5_STATUS=TECHNICALLY_CLOSED` · PR #477 `MERGE_SHA=75a39d0a6758e50cc198a65576a909bbce59446e`
- `MIGRATION_081_FROZEN=true` · `SHA256=285694fbfb4778d38eacdd5d3ac5d3da75ea80fd462ff1a2737d69de0711a53e` (50196 bytes)
- SHAs anteriores `1ee2f4aa…` e `25f78a50…` = **SUPERSEDED_NOT_AUTHORIZED**
- `BUSINESS_DML=0`

## 1. O que o PORTAL-A deixou pronto e o que faltava

PORTAL-A fechou com uma característica que precisa ser dita sem rodeio: entregou
**domínio e fronteira**, e **nenhuma rota HTTP**. Os serviços em
`services/shipperPortal/` não eram importados por nada, e nenhum embarcador
conseguia entrar. A única mudança viva em produção era a auth interna recusar
`token_kind='shipper_portal'`.

PORTAL-B liga isso a uma experiência real.

## 2. Auditoria delta (§8–§9)

| Pergunta | Achado | Consequência |
|---|---|---|
| O que existe e não está ligado a HTTP? | Os 3 serviços do portal, o middleware de token e as 5 RPCs da 080 | `WIRE_ONLY` — nada a reescrever |
| Primitivas de login/ativação externas? | Supabase Auth (senha) reusável; **não havia RPC de ativação de convite** | RPC nova |
| Documentos expostos com segurança? | Nenhum. `frete_documentos` é interno; ePOD é prova operacional | Precisa de autoridade nova |
| Existe autoridade de compartilhamento? | **Não existe em lugar nenhum do schema** | `NEW_REQUIRED` |
| Comprovante projetável sem schema? | `frete_epod_evidencias.status='aprovada'` basta para "aprovado"… | …mas §63 exige liberação explícita |
| Tracking mapeável sem adivinhar? | **Sim** — `freightExecutionStatus.js` já é o mapa congelado com UNKNOWN seguro | `REUSE_AS_IS` |
| Shell externo no frontend? | **Não** — só o shell interno, com `AuthContext` e `api.ts` acoplados ao tenant | Shell/cliente próprios |
| CHANGES_REQUESTED tem histórico? | **Não** — um único `submitted_snapshot` por solicitação | `NEW_REQUIRED` |

## 3. Por que houve migration

Duas lacunas, e só duas, exigiram schema:

**Histórico de submissão.** Reenviar sobrescreveria `submitted_snapshot` — e a
evidência exata que a transportadora avaliou ao pedir ajustes deixaria de
existir. §34/§35 proíbem destruir evidência de decisão. A tabela
`shipper_transport_request_submissions` é append-only e carrega a decisão **na
versão avaliada**, o que responde a pergunta que só o histórico responde: *o
aceite se refere a qual versão?*

**Visibilidade externa de documento.** Não havia nada no schema dizendo "este
documento pode ser visto pelo embarcador". Decidir por heurística (tipo do
documento, nome do arquivo, status do ePOD) seria adivinhar — e adivinhar aqui
significa vazar documento operacional para fora da transportadora.
`shipper_document_shares` é essa autoridade: explícita, revogável, com histórico.

O que **não** virou schema, por já existir: mapa de status de execução,
proveniência solicitação→campanha→fretes, storage privado com signed URL, e o
Supabase Auth como autoridade de senha.

## 4. Fronteira externa (o que mudou e o que não mudou)

Não mudou nada no modelo do PORTAL-A: identidade externa em tabelas próprias sem
`empresa_id`, acesso via relacionamento ATIVO, isolamento entre embarcadores da
mesma transportadora garantido por FKs compostas.

O que PORTAL-B acrescenta é a superfície, em dois namespaces que **nunca**
compartilham contexto:

| | Externa | Interna |
|---|---|---|
| Rota | `/portal/embarcador` | `/shipper-inbox` |
| Sessão | `token_kind='shipper_portal'` | sessão da transportadora |
| Middleware | `verifyPortalToken` | `verifyToken` + `verificarEmpresa` + `verificarPlano` |
| Autorização | identidade externa ∧ usuário ativo ∧ relacionamento ativo ∧ objeto do relacionamento | entitlement ∧ permissão efetiva ∧ escopo ∧ tenant |
| Cliente web | `portal/portalApi.ts` (instância própria) | `api.ts` |

O frontend do portal fica **fora** do `AuthProvider` interno: o embarcador não
dispara `/auth/me` da transportadora e não herda nada dela. As duas árvores
coexistem no mesmo navegador sem se misturar.

## 5. Invariante do aceite (congelada no owner review do PORTAL-A)

Aceitar exige `shipper_portal.requests.review` **e** `campaign.create`.

O motivo: aceitar não é "decidir sobre um registro" — cria uma operação real via
Operation Orchestrator. Sem a segunda permissão, o portal seria um caminho
lateral para criar campanha sem ter permissão de campanha.

`operador` continua sem nenhuma permissão de portal por padrão, incluindo a nova
`shipper_portal.documents.share`.

## 6. Revisão auditável

```
v1 enviada ──▶ transportadora pede ajustes ──▶ decisão carimbada NA v1
                                                      │
                          embarcador corrige ─────────┘
                                     │
                                     ▼
                              v2 enviada (v1 intacta)
                                     │
                          transportadora aceita ──▶ decisão carimbada NA v2
```

A RPC `shipper_request_revise_and_resubmit` trava a solicitação com `FOR UPDATE`
— a mesma linha que aceite, rejeição e cancelamento disputam. Existe uma ordem
serial única de desfechos. `expected_version` é controle otimista: se outra
pessoa da mesma empresa corrigiu enquanto a tela estava aberta, o reenvio falha
em vez de sobrescrever o trabalho dela.

`shipper_request_decide` (rejeitar/pedir ajustes) passou a ser atômica. Antes era
um UPDATE condicional na aplicação: protegia contra outra rejeição, mas concorria
com aceite e cancelamento **sem travar a linha**.

## 7. Acompanhamento

O portal não tem máquina de estados própria. `shipperTrackingService` projeta o
estado canônico em vocabulário externo, com uma ordem de autoridade explícita:
desfecho da solicitação > demanda residual > execução.

Dois cuidados que valem ser destacados:

- **Status desconhecido nunca vira "Em transporte"** — vira "Atualização em
  processamento". Fabricar progresso faria o embarcador acreditar que a carga
  saiu quando ninguém sabe se saiu.
- **Nada aparece por heurística.** A cadeia é `solicitação → campaign_id →
  campaign_trip_freights → fretes`. Um frete histórico com destino parecido não
  entra.
- **"Entregue" exige demanda residual zero** (ver 10b/HIGH-04). Quantidade
  cancelada não abate demanda, e entrega parcial tem estado próprio.

Campanha cancelada internamente **não** vira "Cancelada" para o embarcador:
cancelar planejamento interno não é uma decisão comunicada a ele.

## 8. Documentos e comprovantes

Três origens, e só três:

1. o embarcador enviou → `shipper_request_documents`
2. a transportadora liberou um documento → `shipper_document_shares` (`FRETE_DOCUMENTO`)
3. a transportadora liberou um comprovante → `shipper_document_shares` (`EPOD_EVIDENCIA`)

Projeção por whitelist, nunca "linha menos campos sensíveis". `storage_path`
jamais sai do backend. A URL assinada (300s) só é emitida **depois** da checagem
de fronteira sobre o objeto concreto. Revogar o compartilhamento para de assinar
imediatamente, e uma evidência que não esteja `aprovada` não é servida como
comprovante final mesmo se compartilhada.

## 9. Falha parcial na ativação (§21)

A ativação atravessa dois sistemas sem transação comum:

- **fase 1 (Auth, idempotente por e-mail):** cria ou reencontra a identidade;
- **fase 2 (banco, atômica):** `shipper_invitation_activate`.

Se a fase 2 falhar, sobra uma identidade de auth **sem vínculo de portal** — que
não autoriza nada (`loadPortalContext` exige linha em `shipper_portal_users`) e é
reencontrada na próxima tentativa com o mesmo convite. Não desfazemos a
identidade: se ela já existia antes, apagá-la destruiria uma conta legítima.

Detalhe de segurança que merece registro: quando o e-mail **já tem conta**, a
senha digitada no convite **não é aplicada**. Redefinir permitiria assumir o
controle de uma conta existente — inclusive a de um usuário interno da
transportadora — com um convite. A tela informa isso explicitamente.

## 10. Entrega de convite

Não há e-mail transacional de convite nesta fatia. O token em claro é devolvido
**uma vez**, na criação, ao usuário interno autorizado, que o repassa. Fingir
"e-mail enviado" sem provedor configurado seria mentir para o operador (§17).
Só o hash é persistido; o token nunca é logado.

## 10b. Owner review pré-DDL — os 5 HIGHs corrigidos

O owner revisou a frente antes da migration e apontou cinco pontos. Todos foram
corrigidos na própria 081 (que nunca foi aplicada), sem criar 082.

### HIGH-01 — ativação com conta já existente

O fluxo anterior fazia a coisa certa pela metade: não redefinia a senha (bom),
mas **vinculava a conta existente e emitia sessão só com o token do convite**.
Como o convite é uma credencial ao portador entregue manualmente, quem tivesse o
link passava a operar em nome de uma identidade cuja senha nunca provou conhecer
— e se essa identidade fosse a de um operador interno, o convite viraria um
caminho para entrar no lugar dele.

Congelado: `EXISTING_AUTH_IDENTITY_INVITE_POLICY_V1` = **token de convite E
autenticação da conta existente**. A senha digitada é verificada, nunca trocada.
Senha errada → ativação negada, convite continua `PENDING`, nada é vinculado.

### HIGH-02 — proveniência do compartilhamento agora é do banco

A elegibilidade do documento era validada só na aplicação. Para a tabela que
decide **o que sai da transportadora**, isso é frágil demais.

A linha agora carrega `request_id`, `campaign_id` e `frete_id` (todos `NOT
NULL`), e quatro FKs compostas fecham a cadeia:

```
request + campaign + empresa + org  →  shipper_transport_requests
campaign + frete   + empresa        →  campaign_trip_freights
documento + frete  + empresa        →  frete_documentos
evidência + frete  + empresa        →  frete_epod_evidencias
```

Compartilhar o documento do embarcador Y na solicitação do X passa a ser
impossível **mesmo que a aplicação tente**. Quatro índices de identidade
aditivos foram criados nas tabelas-fonte para dar ao PostgreSQL a chave
referenciável; nenhum altera semântica de negócio.

### HIGH-03 — histórico imutável e snapshot com autoridade do banco

Um gatilho impede alterar `snapshot`, `version`, autoria e instante de envio, e
proíbe `DELETE` — inclusive por `service_role`, que é justamente o caminho do
backend (proteger só contra `anon` seria proteger contra quem já não tem acesso).
A decisão é de mão única: `ACCEPTED` não vira `REJECTED`.

E `shipper_request_accept` **ignora** `p_accepted_snapshot`, usando a submissão
gravada. Antes dava para declarar "aceito: 999 t" sobre um envio de 100 t. A
assinatura foi preservada para o backend já implantado. Aceite e decisão exigem
carimbo em **exatamente uma** versão auditada — 0 linhas afetadas falha fechada.

### HIGH-04 — "entregue" deixa de ser "todos os fretes terminaram"

A regra anterior tratava `concluídos + cancelados === total` como entrega. Uma
operação com 30 t entregues e 70 t **canceladas** era anunciada ao cliente como
ENTREGUE, com 70 t da carga dele paradas.

Congelado: `EXTERNAL_DELIVERED_AUTHORITY` = **demanda residual do serviço
canônico de progresso**. Quantidade cancelada nunca abate demanda. Novo estado
`PARCIALMENTE_ENTREGUE`. Comprovante de viagem parcial não completa a operação.
Sem medição conclusiva (sem demanda declarada ou unidade incompatível), não se
afirma entrega.

O cálculo é o do `campaignProgressService`, reusado em **lote** (4 consultas
independentemente do número de operações) e sem escopo operacional fabricado —
o embarcador não tem escopo interno, e inventar um seria criar autoridade falsa.

### HIGH-05 — fluxo de documentos na web da transportadora

Havia endpoint para tudo e nenhuma tela. Agora, no detalhe da solicitação: ver e
abrir o que o embarcador anexou, **comparação explícita entre o envio anterior e
o atual** (a caixa de entrada dizia "confira o que mudou" sem permitir fazê-lo),
disponibilizar documento e comprovante, e revogar. Sem `documents.share`, o
operador continua revisando e a tela explica a ausência das ações.

## 10c. Escopo do intake (congelado)

`PORTAL_INBOUND_REQUEST_SCOPE_V1 = TENANT_LEVEL_INTAKE_BEFORE_OPERATION`.

Antes do aceite, a solicitação não tem unidade operacional interna — e pedir ao
embarcador que escolha uma filial da transportadora seria expor organização
interna a quem está de fora. Por isso a revisão é company-level (tenant +
entitlement + `requests.review`). No **aceite**, que cria operação, o escopo
operacional passa a ser exigido, junto de `campaign.create`.

## 10d. Delta final pré-DDL — 2 residuais

**RESIDUAL-01 — o branch de corrida contornava a prova de senha.** O caminho
normal (identidade achada na busca inicial) exigia `signInWithPassword`, mas o
caminho "`createUser` falhou com *já registrado* → reencontra" devolvia a
identidade direto. Bastava a conta já existir naquele instante para vincular o
portal a uma identidade alheia sem provar nada — o mesmo furo que o HIGH-01
fechou, por outra porta. Ter a prova em **duas cópias** foi justamente o que
permitiu que uma delas ficasse para trás; agora é uma função só, usada nos dois
caminhos.

Somado a isso, o id autenticado precisa ser o mesmo que será vinculado: se
divergir, falha fechada — escolher silenciosamente um dos dois vincularia o
portal a uma conta cuja senha talvez não tenha sido provada.

**RESIDUAL-02 — metadados de decisão sem decisão.** O gatilho protegia a decisão
já finalizada, mas deixava uma janela: com `decision IS NULL`, os campos
`decision_reason`, `decided_at` e `decided_by` podiam ser escritos e reescritos —
daria para gravar "decidido por Fulano em tal data" numa submissão que ninguém
decidiu. Agora os quatro campos nascem juntos, numa única transição: a primeira
decisão exige instante **e** autor; devolver ou recusar exige motivo (aceitar
não — inventar motivo de aceite seria fabricar conteúdo). Depois de decidida,
tudo congela.

## 11. Achado da revisão de janelas de falha (§152)

A revisão encontrou um vazamento real que eu mesmo havia introduzido, e vale
registrar porque a versão errada parecia a mais natural.

`cadastrarEmbarcador` procurava a organização pelo nome em
`shipper_organizations` **globalmente**, para reusar em vez de duplicar. O schema
permite que um embarcador se relacione com várias transportadoras (§22), então
reusar parecia certo. Só que o acesso do portal é **por organização**:
`loadPortalContext` devolve todos os relacionamentos ativos dela. Consequência:

1. a transportadora A, digitando um nome, descobriria que aquele embarcador
   existe e quantos contatos ativos ele tem — cadastrados pela B;
2. os contatos cadastrados pela B passariam a enxergar a A automaticamente.

Bastaria acertar o nome para se enxertar na base de outra transportadora.

**Correção:** a busca por embarcador existente é feita somente entre os que já
têm relacionamento com **esta** transportadora. Unificar organizações entre
transportadoras é uma decisão de produto que ninguém tomou — é Partner Network,
fora de escopo. O schema continua suportando N relacionamentos para quando essa
decisão existir. Dois testes congelam os dois lados: nome igual de outra
transportadora **não** reusa; nome igual dentro da própria **reusa**.

## 12. Testes

| Suíte | Contagem | Cobre |
|---|---|---|
| PG real 081 | 52 | histórico, 4 corridas de reenvio, ativação concorrente, **proveniência completa**, **imutabilidade do histórico**, **autoridade do snapshot**, **carimbo da versão**, **metadados de decisão**, permissão do operador |
| Backend 081B | 38 + 14 (ativação) | mapa de status, whitelist da linha do tempo, isolamento mesmo-transportadora, IDOR de documento/comprovante, varredura de chaves proibidas, separação de credenciais |
| Web portal | — | estados de carregamento/erro/vazio, correção pré-preenchida, idempotência do envio, ausência de jargão interno |
| Web caixa de entrada | — | aceite sem redigitação, motivo obrigatório, conversão pendente visível |

## 13. Fora de escopo (mantido)

Partner Network, Marketplace, ERP, Billing no portal, financeiro interno,
ações de escrita da IA, provider de rota novo. Cotação/proposta segue **deferida**
(`PORTAL_QUOTE_PROPOSAL_V1B`): não há autoridade canônica de preço
embarcador↔transportadora.

Envelope digital: **deferido** — não há artefato de fechamento estável hoje, e
construí-lo dentro do PORTAL-B seria inventar autoridade nova.

## 14. Fechamento em produção (2026-08-25)

`PORTAL_B_STATUS=TECHNICALLY_CLOSED_IN_PRODUCTION` · `E3_5_STATUS=TECHNICALLY_CLOSED`

### 14.1 Migration 081

Aplicada **exatamente uma vez**, na primeira e única tentativa, sob
`OWNER_MIGRATION_GATE_SHIPPER_PORTAL_B_081=AUTHORIZED` e
`MIGRATION_APPLY_MAX_ATTEMPTS=1`.

| | |
|---|---|
| `TRACKING_VERSION` | `20260825144011` |
| `TRACKING_NAME` | `081_shipper_portal_b_revision_documents` |
| `TRACKING_COUNT` | 1 |
| `APPLY_ATTEMPTS` | 1 |
| `SOURCE_SHA256` / bytes | `285694fbfb4778d38eacdd5d3ac5d3da75ea80fd462ff1a2737d69de0711a53e` · 50196 |

A fonte foi lida do commit certificado (`git cat-file`, nunca de buffer local
nem de cópia do prompt). A fidelidade da transferência foi **provada no próprio
servidor de produção antes do apply**, com um `SELECT digest(...)` read-only que
devolveu o SHA certificado — e o SQL registrado no tracking tem o mesmo hash.
Não é "conferido de olho": o que está no banco é byte a byte a fonte congelada.

### 14.2 Postcheck de schema

3 tabelas com **RLS habilitada** e **zero grant** a `anon`/`authenticated`
(`service_role` com autoridade). 2 colunas aditivas em
`shipper_transport_requests` (`integer NOT NULL DEFAULT 0`, `CHECK >= 0`).
As 7 funções certificadas presentes, todas `SECURITY DEFINER` com
`search_path=public` fixo e `EXECUTE` restrito a `postgres`/`service_role`.
Gatilho `shipper_submission_immutable` instalado `BEFORE UPDATE OR DELETE …
FOR EACH ROW`.

Proveniência conferida no catálogo — as 5 FKs compostas existem e fecham a
cadeia: `relationship → org/empresa`, `request → campanha/empresa/org`,
`campanha → frete/empresa`, `documento → frete/empresa`,
`evidência → frete/empresa`. Os 4 índices de identidade nas tabelas-fonte
existem sem drift de definição.

### 14.3 DML

`PRODUCTION_BUSINESS_DML_081=0`. Backfill histórico: **0 linhas** (não havia
solicitação em produção). DML técnica: **50 linhas**, exatamente o previsto pelo
cálculo JIT — `shipper_portal.documents.share` em 25 templates `administrador` e
25 `gerente_frota`; **`operador` continua com 0**, como congelado no owner review
do PORTAL-A (§42). `permission_template_permissions` 3675 → 3725, aditivo e
idempotente: nenhuma permissão preexistente foi apagada ou reescrita.

Baselines de negócio inalteradas (empresas 34, usuários 38, fretes 63, campanhas
0, `frete_documentos` 16, `frete_epod_evidencias` 10, `campaign_trip_freights` 0).

### 14.4 Merge e deploy

PR #477 → `MERGE_SHA=75a39d0a6758e50cc198a65576a909bbce59446e`, com CI 9/9 verde
no head exato `e2e36c0e` (PG 081 52/52 · PG 080 37/37 · backend 1940/1940 · web
186/186 · SEC-1). Deploy do backend (Railway) e do frontend (GitHub Pages) do
SHA exato do merge: **SUCCESS** nos dois.

Nota sobre a CI: ao marcar o PR como *ready*, o SEC-1 falhou uma vez na corrida
de refresh de duas abas (`sec1.spec.ts:587`, esperado `[200, 409]`, recebido
`[200, 200]`) — a instabilidade histórica conhecida desse teste. Antes de
re-rodar, a causalidade foi descartada por inspeção do diff: o PR **não toca**
os testes SEC-1, `middlewares/auth.js`, `routes/auth.js`, `AuthContext.tsx` nem
`api.ts`; o portal traz provider e cliente HTTP próprios. O mesmo head já havia
passado o SEC-1 antes. Re-run no head inalterado: verde.

### 14.5 Certificação em produção — read-only

A superfície HTTP do portal **passou a existir**: onde antes havia `404`, agora
há `401` sem credencial.

| Smoke | Resultado |
|---|---|
| `/health` | 200 |
| `/portal/embarcador/{contexto,inicio,solicitacoes,operacoes}` sem token | 401 |
| `/shipper-inbox/solicitacoes` sem auth interna | 401 |
| `GET /portal/embarcador/convite` com token inválido | 404 (sem vazamento) |
| `POST /portal/embarcador/login` com corpo vazio | 400 (valida antes de tocar o Auth) |
| Shell web (`matopibalog.com.br`) | 200 |

Nenhuma credencial real foi usada e nada foi escrito:
`PRODUCTION_AUTH_USERS_CREATED=0` · `PRODUCTION_INVITATIONS_CREATED=0` ·
`PRODUCTION_EMAILS_SENT=0` · `PRODUCTION_BUSINESS_WRITES=0`. Todas as tabelas de
negócio do portal seguem em 0 linhas; `auth.users` permanece em 38, o mesmo
número de usuários internos. Logs do deploy: só INFO de boot, `NEW_PRODUCTION_ERRORS=0`.

Sobre o shell: deep-links como `/portal/embarcador/entrar` retornam **HTTP 404**
servindo o `404.html` do próprio app, que restaura a rota via `spa-redirect.js`.
Isso é o padrão de SPA do GitHub Pages e **não é regressão do PORTAL-B** —
`/login`, `/planos`, `/cadastro` e `/dashboard` se comportam exatamente igual e
sempre se comportaram. No navegador, o link do convite abre normalmente.

### 14.6 O que isto **não** significa

- **Não** há embarcador usando o portal. Nenhuma organização, relacionamento,
  convite, usuário externo ou solicitação foi criada.
- `INVITE_DELIVERY=MANUAL_LINK`. **Não** existe envio de convite por e-mail;
  escrever "convite enviado por e-mail" seria falso.
- `OWNER_VISUAL_VALIDATION=PENDING`. Falta o owner validar visualmente login
  externo, criação de pedido, revisão, acompanhamento, documentos/comprovantes e
  caixa de entrada da transportadora. Por isso `RBV9-INV-081` vai a **`IMPL_NV`**,
  não a `IMPL_VAL`.
- Fechar E3.5 **não** cria Partner Network, rede de cotação nem Marketplace.
  Cotação/proposta segue deferida (`PORTAL_QUOTE_PROPOSAL_V1B`).

`BLOCKERS_OPEN=0` · `HIGHS_OPEN=0` · `RESIDUALS_OPEN=0`

## 15. Correção da aceitação visual (2026-08-25)

`PORTAL_V1_VISUAL_FINDINGS_FROZEN=true` · `MIGRATION_REQUIRED=false`

O pacote de aceitação visual (PR #479) levantou 0 BLOCKER, 5 HIGH, 6 MEDIUM,
3 LOW e 2 NOTE. Esta fatia fecha tudo o que é específico do Portal, **sem
schema**: as migrations 080 e 081 seguem intocadas, com os mesmos hashes que
estão em produção.

### 15.1 O padrão por trás dos achados

Dois grupos, e nenhum era falta de domínio:

**Informação que o backend produzia e a tela descartava.** O serviço de
acompanhamento sempre calculou `entrega: {solicitado, entregue, restante}` — com
o comentário, escrito lá, de que é "só o que o cliente entende: quanto da carga
dele chegou e quanto ainda falta" — e o portal nunca leu o campo. Do mesmo modo,
`derivarProximaAcao` tratava entrega parcial como operação em curso, mas os
filtros da home e da lista a excluíam. O resultado era o pior possível: um
embarcador com metade da carga por chegar via **"No momento, nenhuma ação é
necessária"**.

**Composição visual que não sobrevive a revisão de código.** O `Cartao` trazia
`bg-white` na base e aceitava `bg-amber-50` por `className`. Duas utilitárias da
mesma propriedade e mesma especificidade: quem vence é a ordem no CSS gerado, e
vencia o branco. Todo destaque do portal era renderizado branco, e o JSX
*parecia* certo.

### 15.2 O que mudou

| Achado | Correção |
|---|---|
| `VIS-01` | `Cartao` ganhou a prop `tom` (`neutro/atencao/erro/sucesso/informacao`). A cor é decidida **dentro** do componente: não existe mais como pedir destaque e receber branco. |
| `VIS-02` | Progresso de entrega na tela — *Carga solicitada / Já entregue / Ainda falta* —, sempre que o backend consegue medir. Nunca calculado no cliente. |
| `VIS-03` | `PARCIALMENTE_ENTREGUE` entrou no filtro da home (backend) e no de Transportes (frontend). Fica em "Em andamento", com tom de atenção. |
| `VIS-04` | No celular, conteúdo e ações deixam de disputar a mesma faixa: ações em linha própria, ação primária em largura total. |
| `VIS-14` | `min-w-0` no contêiner flex do cabeçalho. O nome do embarcador trunca; "Matopiba Log" e "Portal do Embarcador" permanecem. |
| `VIS-05` | `?enviada=1` passou a ser consumido: confirmação de envio + o que acontece a seguir, e a URL é limpa para o aviso não ressuscitar num F5. |
| `VIS-06` | Mapa de tons congelado por situação. Entrega parcial é **atenção**; cancelada é **encerrado** — deixaram de ser o mesmo cinza. |
| `VIS-07` | Seletor de arquivo próprio ("Escolher arquivo" / "Nenhum arquivo selecionado"), com o input nativo acessível por teclado. |
| `VIS-08` | Pré-visualização embutida reusando o `ArquivoPreviewModal` que já existia — nenhum segundo visualizador foi criado. Baixar e abrir em nova guia viraram secundários. Vale também na caixa de entrada. |
| `VIS-09` | O comparativo entre envios saiu da tela interna para `shared/comparacaoEnvios` e passou a valer para as duas pontas. Histórico externo agora é **crescente** (causa → correção) e marca o "Envio atual". |
| `VIS-10` | Vocabulário externo congelado em **pedido**. Navegação: **Início / Pedidos / Transportes / Documentos**, separadas por proveniência real (`tem_operacao`) — cada item em uma aba só. Aceito sem operação criada continua em Pedidos (§48). |
| `VIS-11` | `recentes` removido do payload: era calculado, trafegado e nunca renderizado. |
| `VIS-12` | Mostrar/ocultar senha no login e nas duas ativações. |
| `VIS-13` | `focus-visible` próprio, com anel que aparece sobre o verde escuro dos botões primários. |
| `NOTE-01` | Não tocado — é o shell do painel interno, fora do escopo do Portal V1. |
| `NOTE-02` | Comportamento conhecido e aceito do SPA no GitHub Pages. |

### 15.3 Compatibilidade

As rotas antigas (`/solicitacoes`, `/solicitacoes/nova`, `/operacoes`,
`/operacoes/:id`) redirecionam para as novas preservando id e querystring — um
link de convite ou um endereço salvo antes da renomeação continua funcionando,
inclusive com `?acao=corrigir` e `?enviada=1`.

### 15.4 Verificação

Regressão em `PortalCorrecoes.test.tsx`, verificando **comportamento** e não
string de classe — asserção sobre `className` foi exatamente o que deixou o
`VIS-01` passar despercebido. As provas que dependem de CSS real (fundo
computado, rolagem em 390 px) rodam no harness de navegador, com
`getComputedStyle`, e ficam registradas em
`portal-v1-owner-visual-after/medidas-after.json`.

`OWNER_VISUAL_VALIDATION` permanece **`PENDING`** e `RBV9-INV-081` permanece
**`IMPL_NV`**: a correção não substitui a revisão do owner.
