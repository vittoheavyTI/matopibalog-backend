# Portal do Embarcador V1 — PORTAL-A (fronteira, solicitação, handoff)

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados pelo integrator após o fechamento técnico.

- `MACROFRONT=E3_5_SHIPPER_PORTAL_V1` · fatia `PORTAL-A`
- `MIGRATION_REQUIRED=true` · `MIGRATION_FILE=080_shipper_portal_foundation.sql`
- `SHIPPER_PORTAL_PRODUCTION_MIGRATION_AUTHORIZED=false` — **não aplicada em lugar nenhum**
- `PRODUCTION_BUSINESS_WRITES=0`

## 1. Auditoria (§10) — o que existia antes

| Capacidade | Achado | Classificação |
|---|---|---|
| Entidade de cliente/embarcador | **Não existe** — zero tabelas de cliente/embarcador/remetente | `NEW_REQUIRED` |
| Dono da carga no Frete | **Não existe** — `fretes` não tem campo de cliente; origem/destino são texto livre | `NEW_REQUIRED` |
| Convite / onboarding externo | Não existe | `NEW_REQUIRED` |
| Identidade | Supabase Auth (`signInWithPassword`) + tabela `usuarios` | `REUSE_AS_IS` (senha) |
| Sessão SEC-1 | `auth_sessions.usuario_id` → **FK para `usuarios`** | `WRONG_BOUNDARY` se reusado para externo |
| Tenant | `middlewares/tenant.js` deriva `empresa_id` de `usuarios.empresa_id` | `WRONG_BOUNDARY` se reusado |
| Orchestrator (objetivo→Campanha) | `createObjective` completo, multi-origem | `REUSE_AS_IS` |
| Documentos / ePOD | `frete_documentos`, `frete_epod`, `frete_epod_evidencias` com `storage_path` e status | `REUSE_WITH_ADAPTER` (PORTAL-B) |
| Progresso operacional | `campaignProgressService` (projeção read-only) | `REUSE_WITH_ADAPTER` (PORTAL-B) |

### O achado que definiu a arquitetura

`middlewares/tenant.js` faz, para qualquer rota interna:

```
usuarios.empresa_id  →  req.empresa_id
```

Ou seja: **criar o embarcador como linha em `usuarios` com o `empresa_id` da
transportadora lhe daria, automaticamente, o tenant interno inteiro** — dashboard,
fretes, frota, financeiro. Exatamente o atalho que o §7 proíbe. Por isso a
identidade externa vive em tabelas próprias, **sem coluna `empresa_id`**, e o
acesso passa obrigatoriamente por um relacionamento explícito e revogável.

## 2. Modelo de fronteira

```
PLATAFORMA
 └── empresas (transportadora = tenant interno)
      └── usuarios (operador interno)          ← contexto INTERNO

 └── shipper_organizations (embarcador)         ← entidade própria, SEM empresa_id
      └── shipper_portal_users (contato)        ← contexto EXTERNO
      └── shipper_carrier_relationships ────────→ empresas
           (A FRONTEIRA: ativo/revogado)
           └── shipper_transport_requests
                └── shipper_transport_request_origins
                └── campaign_id ────────────────→ operation_campaigns
```

**Fórmula de autorização externa** (§76), aplicada em `shipperBoundaryService`:

```
identidade externa autenticada
  ∧ relacionamento ATIVO com aquela transportadora
  ∧ objeto pertence a esse relacionamento
```

Tenant sozinho **não basta** e nunca é usado sozinho: dois embarcadores da mesma
transportadora compartilham `empresa_id`, então o isolamento real vem de
`shipper_org_id` + `relationship_id` — filtrados **no servidor** (§78), nunca
escondendo linhas no React.

## 3. Identidade e credenciais

- **Senha**: continua sendo autoridade do Supabase Auth, igual ao login interno.
  Nada de sistema de senha caseiro (§18).
- **Sessão**: o portal emite JWT próprio de 8h com a claim discriminante
  `token_kind='shipper_portal'`. Não reusa `auth_sessions` porque a FK aponta
  para `usuarios` e alterá-la mexeria no SEC-1 (§83 proíbe).
- **Separação simétrica das credenciais**, ambas testadas:
  - token de portal → **rejeitado** pelo auth interno (`middlewares/auth.js`,
    inclusive no caminho legado `sessionsEnabled=false`, que faria `jwt.verify`
    puro e aceitaria o token sem essa checagem);
  - token interno → **rejeitado** pelo auth do portal.
- **Colisão de identidade** (§23): como os espaços são tabelas distintas, a mesma
  pessoa pode ser operadora interna de uma transportadora **e** contato de portal
  de um embarcador. Os contextos nunca somam privilégios — cada token carrega
  exatamente um contexto.
- **Revogação** (§21): `shipper_carrier_relationships.status='REVOKED'` corta o
  acesso na requisição seguinte, sem apagar identidade nenhuma. Testado.

## 4. Invariantes garantidos no BANCO (não só na aplicação, §89)

| Invariante | Mecanismo |
|---|---|
| Solicitação não aponta para relacionamento de outro embarcador da mesma transportadora | FK composta `(relationship_id, shipper_org_id, empresa_id)` |
| Autor da solicitação pertence ao embarcador da solicitação | FK composta `(created_by, shipper_org_id)` |
| Uma Campanha nunca é reivindicada por duas solicitações | índice único parcial em `campaign_id` |
| Campanha vinculada é da mesma transportadora | FK composta `(campaign_id, empresa_id)` |
| Um relacionamento por par (embarcador, transportadora) | índice único |
| `SUBMITTED` exige snapshot; `ACCEPTED` exige snapshot aceito | CHECK constraints |
| No máximo 1 convite pendente por (relacionamento, e-mail) | índice único parcial |
| Token de convite nunca em claro | só `token_hash`, único global |
| Aceite concorrente não duplica operação | RPC `shipper_request_accept` com `FOR UPDATE` |

## 4-bis. Correções do owner review (3 HIGHs)

A revisão do owner encontrou 3 HIGHs que o meu relatório anterior não tinha
detectado — corrigidos **antes** do gate:

### HIGH-01 — privilégio padrão do operador

O backfill dava `shipper_portal.requests.review` ao template `operador`. Isso
**não era uma decisão congelada**. Aceitar uma solicitação não é leitura: inicia
`solicitação → Operation Orchestrator → Campanha`. Política congelada agora
(`SHIPPER_PORTAL_DEFAULT_PERMISSION_POLICY_V1`):

| Template | Padrão |
|---|---|
| `administrador` | `manage` + `requests.review` |
| `gerente_frota` | `requests.review` |
| `operador` | **nenhuma** (default deny) |
| demais | default deny |

A empresa continua podendo conceder depois, pelos mecanismos que já existem
(template editável ou override por usuário). Efeito no DML técnico: **100 → 75
inserts**.

**Invariante para PORTAL-B** (§6): `shipper_portal.requests.review` autoriza
*revisar*. A ação de **aceitar** — que cria operação — também precisa satisfazer
a autoridade canônica exigida por `createObjective`. Nenhuma rota pode deixar a
permissão de portal contornar silenciosamente a autorização de Campaign.

### HIGH-02 — escrita parcial na criação da solicitação

Eram 3 escritas independentes: `INSERT DRAFT` → `INSERT origens` → `UPDATE
SUBMITTED`. Se a 2ª ou a 3ª falhasse, sobrava um **DRAFT parcial commitado** — e
um retry com o mesmo `client_request_id` encontrava esse rascunho e devolvia uma
solicitação incompleta como se estivesse pronta.

Agora é **uma transação** (`shipper_request_create_and_submit`), que também:
- monta o snapshot a partir das **mesmas** origens gravadas (impossível terminar
  com origens A e snapshot B);
- deriva `empresa_id` do relacionamento **dentro** da RPC (nunca aceita do cliente);
- converge criações concorrentes com o mesmo `client_request_id` para **uma**
  solicitação, capturando a violação de unicidade em vez de estourar 500.

### HIGH-03 — race cancel × accept

O cancelamento lia o status e depois atualizava **por id, sem condição de
estado**. Entre a leitura e a escrita, a transportadora podia aceitar — e o
cancelamento sobrescrevia uma decisão de negócio já tomada.

Agora `shipper_request_cancel` é RPC com `SELECT ... FOR UPDATE` na **mesma
linha** que `shipper_request_accept` disputa. Resultado provado em Postgres real:
exatamente um desfecho terminal; depois de aceita o portal não cancela; depois de
cancelada a transportadora não aceita; replay de cancelamento é idempotente e não
reescreve o instante original.

### HIGH-04 — semântica de quantidade/unidade (bug real)

O total somava quantidades **cruas**, sem normalizar unidade: `1000 kg + 1 ton`
produzia `1001` — um número sem significado nenhum.

Decisão congelada: **`SHIPPER_PORTAL_V1_QUANTITY_UNIT_MODEL=ONE_REQUEST_LEVEL_UNIT`**.
A solicitação tem **uma** unidade canônica; todas as origens herdam dela. Se uma
origem trouxer unidade explícita divergente, a criação é **recusada** — nunca
reinterpretada em silêncio. Portal V1 **não** converte kg↔ton: uma solicitação,
uma unidade, explícito (conversão é semântica do Campaign, não daqui).

Também congelado: `ORIGIN_QUANTITY_REQUIRED > 0` (antes `>= 0`) — uma origem com
quantidade zero não representa necessidade de transporte. Aplicado na validação
da aplicação **e** no `CHECK` do banco.

### PROOF-01 — a prova de concorrência estava fraca

O teste anterior exigia apenas `r1.ok || r2.ok` e contagem de linhas = 1. Isso
**não** provava o "sem 500" prometido para quem perde a corrida. Agora exige:
ambas as chamadas com sucesso, **mesmo id**, uma solicitação, um conjunto de
origens, `SUBMITTED`. Somado a um teste de replay com payload diferente, que
deve devolver a solicitação **original** sem reescrever o primeiro payload.

### HARDENING-01 — aceitante do convite

`accepted_by` referenciava `shipper_portal_users(id)` sem provar que o usuário
pertence ao **mesmo** embarcador do convite. Fechado com FK composta
`(accepted_by, shipper_org_id)` e `CHECK` exigindo `accepted_by` quando
`status='ACCEPTED'`.

## 5. Ciclo de vida da solicitação

`DRAFT → SUBMITTED → {ACCEPTED | REJECTED | CHANGES_REQUESTED} | CANCELLED`

> **Correção de overclaim (§31/§32):** `CHANGES_REQUESTED` existe no schema e a
> transportadora consegue defini-lo, mas **o embarcador ainda não tem como editar
> e reenviar** a solicitação a partir desse estado. Portanto:
> `SHIPPER_REVISION_AFTER_CHANGES_REQUESTED=PORTAL_B_REQUIRED`. O fluxo de
> change-request **não** está completo, e não deve ser reportado como tal. Não é
> bloqueador de migration — o schema já suporta.

- **Snapshot imutável** (§31/§88): `submitted_snapshot` congela o que foi
  declarado; `accepted_snapshot` congela o que foi aceito. Editar o cadastro do
  embarcador depois **não reescreve** a operação histórica.
- **Cancelamento** (§41): o embarcador só cancela antes da decisão. Depois que
  virou operação, cancelar é decisão da transportadora — o portal nunca cancela
  Campanha/Frete diretamente.

## 6. Handoff para o Operation Orchestrator (§36/§97/§120)

Duas fases, mesmo modelo já provado no Dispatch V1:

1. **Fase 1 (atômica, no banco)**: RPC `shipper_request_accept` decide o aceite
   com `SELECT ... FOR UPDATE`. Dois operadores clicando "Aceitar" juntos → só um
   vence. Relacionamento revogado bloqueia o aceite.
2. **Fase 2 (idempotente, aplicação)**: o snapshot aceito é traduzido 1:1 em
   `createObjective` — o **mesmo** Orchestrator canônico — e vinculado via RPC
   `shipper_request_link_campaign`, protegida por índice único. Se falhar, o
   aceite permanece válido e a conversão é retryable, sem duplicar operação.

**O operador não redigita nada**: carga, quantidade, origens, destino e janela
vêm do snapshot. Nenhum planejador paralelo, nenhuma validação duplicada.

## 7. Privacidade (§54/§106/§118/§119)

Projeções são **whitelist explícita** — nunca "objeto menos campos sensíveis".
O DTO do portal não contém `campaign_id`, `decided_by`, snapshots internos,
valores financeiros nem PII de motorista. Testado explicitamente contra uma lista
de campos proibidos.

## 8. Superfície de Data API

Zero. Nenhuma tabela do portal concede nada a `anon`/`authenticated` — **nem
`SELECT`**. RLS habilitado como defesa em profundidade (default-deny). Motivo
(§92): aqui convivem duas populações distintas e uma policy genérica de tenant
seria insuficiente para separar embarcadores dentro da mesma transportadora.
Tudo é backend-mediado.

## 9. Escopo desta fatia e o que fica para PORTAL-B

Aplicando §134 (dividir quando a auditoria mostra frente grande demais para um
PR seguro):

- **PORTAL-A (esta fatia)**: Slice A (identidade/fronteira externa) + Slice B
  (solicitação + handoff). É onde vive todo o risco de segurança.
- **PORTAL-B (próxima)**: Slice C (tracking, documentos, comprovantes) + Slice D
  (UX web do portal).

Motivo da divisão: construir 4 slices de UX sobre um modelo de fronteira ainda
não revisado seria risco desnecessário — e a frente termina em gate de owner de
qualquer forma (§94/§135: a migration precisa ser aplicada em produção **antes**
do merge).

## 10. Explicitamente fora de escopo

Partner Network (§148), Marketplace (§149), ERP (§150), Billing no portal
(§151), financeiro interno no portal (§152), ações de escrita da IA (§153).
Cotação/proposta comercial: **deferida** (`PORTAL_QUOTE_PROPOSAL_V1B`) — a
auditoria não encontrou autoridade canônica de preço/contrato embarcador↔
transportadora, e §42/§43 proíbem inventar um motor de cotação sem ela. Isso não
bloqueia o núcleo (solicitação, documentos, acompanhamento, comprovante).
