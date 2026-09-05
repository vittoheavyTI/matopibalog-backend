# ERP Integration Hub V1 — E3.7A (fundação provider-agnostic)

> Macrofrente: `E3_7A_ERP_INTEGRATION_HUB_FOUNDATION_AND_CENSUS`
> Estado: **`E37A_TECHNICALLY_CLOSED_SCHEMA_FREE`** (2026-09-01)
> Base: `main` = `cb505ac4` (pós-#489, E3.6A). Owner: ChatGPT.
> Precedência de leitura: produção real > banco > repo/main > deploy > testes > docs.

## O que esta fatia É e o que NÃO é

E3.7A entrega a **fundação** do ERP Integration Hub: provider-agnostic, **schema-free**
e **totalmente inerte em produção**. Não é integração com nenhum ERP específico, não é
Sankhya/TOTVS/Omie/SAP, não é import em massa, não é sync real, não é UI de configuração
de cliente, não é webhook de provider real, não é ativação de ERP, não é promessa
comercial e não é cobrança.

Invariantes de produção desta frente (todos verificados):

```
ERP_HUB_PROVIDER_REAL_CALLS        = 0
ERP_HUB_PRODUCTION_BUSINESS_WRITES = 0
ERP_HUB_ENV_CHANGES                = 0
MIGRATION_REQUIRED                 = false   (nenhuma DDL, nenhum gate de migration)
```

## Fase Zero — proveniência da migration 080 (pré-requisito)

Antes de qualquer coisa schema-dependent, o achado aberto no encerramento da #489 foi
fechado por **auditoria forense read-only** (sem tocar no 080 aplicado):

| Item | Valor |
|------|-------|
| `M080_REPO_SHA` (blob LF do git, 34881 bytes) | `fef45f5030930c40eef00b7e83c2a6292d7d5c91597d85bf27adb546418f7791` |
| `M080_TRACKING_SHA` (`schema_migrations` v`20260825005339`, 34854 chars) | `a06c310b9cac86e596375621b595eb26831ce0a3f0f596a2a4f5227722d8c7f0` |
| SHA whitespace-stripped (repo) == (tracking) | `0dc94157b9558dc600b675f37d1e0abb1c2dfd5951de17b2104bb3f961c3128b` (**idêntico**) |
| `M080_PROVENANCE_CLASS` | **1 — BYTE_ONLY_DIFFERENCE** |
| `M080_SCHEMA_EQUIVALENCE` | EQUIVALENT (6 tabelas `shipper_*` com RLS + 5 funções conferidas em prod) |
| `M080_ACTION_REQUIRED` | **NONE** |

Prova decisiva: removendo apenas whitespace (`\s`, sem lowercase), o arquivo do repo e o
statement de produção são **byte-idênticos** — todo token SQL, literal, identificador,
ordem e comentário conferem. A diferença de 27 bytes é puro whitespace (newline final +
normalização de indentação do tool do Supabase ao gravar o statement). **A cadeia é
segura**; nenhuma migration corretiva é necessária e o 080 aplicado não deve ser editado.

## Auditoria (E37A_AUDIT_FROZEN=true) — não inventar um segundo ERP

| Componente existente | Papel | Autoridade | Decisão |
|---|---|---|---|
| `services/routeIntelligence/*` (config/gateway/providers/errors/service) | Padrão provider-agnostic mais recente (default disabled) | — | **REUSE_WITH_ADAPTER** (molde do provider ERP) |
| `services/ai/*` (providerGateway, config, toolRegistry) | Fundação de IA provider-agnostic read-only | — | REUSE (referência secundária) |
| `migrations/066_billing_outbox.sql` + `services/billing/billingOutboxRepository.js` | Outbox crash-safe (dedupe UNIQUE, claim CAS, backoff→dead, `sanitizarErro`) | service_role | **REUSE_WITH_ADAPTER** (molde do outbox ERP) |
| `utils/integrationsCrypto.js` (AES-256-GCM, `INTEGRATIONS_SECRET_KEY`) | Segredo de integração em repouso | — | **REUSE_AS_IS** (credenciais futuras) |
| `utils/webhookHash.js` | Idempotência de webhook inbound | — | REUSE_AS_IS (inbound futuro) |
| `services/entitlementDomainService.js` `resolverEntitlement` | Nega `integracoes_erp` por `nao_implementada` (status != disponivel) | backend | **REUSE_AS_IS — NÃO ALTERAR** |
| `permissionRegistry` `integracoes_erp.gerenciar` (governance, entitlement `integracoes_erp`) | Autoridade da superfície interna de ERP | backend | **REUSE_AS_IS** (não inventar chave nova) |
| `funcionalidades.integracoes_erp` (migration 069, `status_ciclo_vida='em_breve'`) | Entitlement canônico ERP do Portal Cliente | banco | **REUSE_AS_IS — NÃO MUDAR status** |
| `routes/integracoes.js` (super-admin, tabela `configuracoes` global id=1) | Credenciais de plataforma (asaas/clicksign/…) | isSuperAdmin | **DO_NOT_REUSE** (escopo plataforma ≠ tenant) |
| External ids ad-hoc (`empresas.asaas_subscription_id`, `faturas.*`, `asaas_webhook_events.asaas_payment_id`) | Identidade externa espalhada | — | **DO_NOT_REUSE como padrão → NEW_REQUIRED** (mapa genérico) |
| E1.5 Verifiability | Diagnóstico read-only | — | REUSE (idioma de diagnóstico) |

`erp_api`/`webhooks_empresariais` (seed, módulo `erp`, `status_ciclo_vida='planejada'`,
ocultos) são catálogo-roadmap separado; a funcionalidade **canônica** do Portal é
`integracoes_erp`.

## Census (read-only, agregado — sem nomes de cliente)

`ERP_PROSPECT_CENSUS_SOURCE = TECHNICAL_SIGNALS_ONLY`. As três dimensões são separadas
deliberadamente (elegibilidade comercial ≠ configuração técnica ≠ uso observado):

| Dimensão | Resultado |
|---|---|
| **COMMERCIAL_ELIGIBILITY** (`integracoes_erp` em planos) | 1 plano `opcional_paga` (Growth), 2 `incluida` (Scale/Enterprise), 4 `indisponivel` — bate com a regra congelada |
| **TECHNICAL_CONFIGURATION** | **0** overrides ERP de empresa · **0** conexões/outbox/mapping ERP (tabelas não existem) · `billing_outbox` vazio |
| **OBSERVED_USAGE** | **0** (não há tabela nem fluxo ERP) |
| Referência (external id ad-hoc) | 5/34 empresas com `asaas_subscription_id` |

Conclusão: ERP é **comercialmente elegível** em alguns planos, mas **tecnicamente não
implementado** e sem qualquer configuração/uso. Nenhum sinal técnico indica que uma
empresa "quer ERP".

## Arquitetura (schema-free)

Princípio **D-023**: o domínio Matopiba nunca se acopla ao schema/API de um fornecedor.

```
DOMÍNIO → ENVELOPE CANÔNICO → OUTBOX → PROVIDER ADAPTER → ERP externo   (outbound)
ERP externo → PROVIDER ADAPTER → INPUT CANÔNICO → validação → serviço    (inbound)
```

`backend/services/erpHub/`:

- **`config.js`** — `ERP_PROVIDER_MODE = disabled | fake`. Default `disabled`. **Não existe
  modo real** nesta frente: é *estruturalmente* impossível chamar um ERP externo. Sem secret,
  sem mudar env do Railway.
- **`errors.js`** — `ErpProviderError` tipado (`DISABLED`, `NOT_CONFIGURED`,
  `UNSUPPORTED_CAPABILITY`, `INVALID_ENVELOPE`, `TIMEOUT`, `RATE_LIMIT`, `UPSTREAM_ERROR`,
  `INVALID_RESPONSE`) com `userMessage` segura; `detail` interno nunca vaza.
- **`capabilities.js`** — vocabulário `send | lookup | reconcile`. **Capability desconhecida
  ≠ suportada.**
- **`canonicalEnvelope.js`** — `schema_version` (=1), `event_id`, `request_id`,
  `correlation_id`, `empresa_id`, `entity_type`, `entity_id`, `event_type`, `occurred_at`,
  `source`, `payload`, `metadata`. **Sanitização recursiva** remove qualquer chave sensível
  (jwt/senha/token/secret/cookie/refresh/credential/authorization). `entity_type` é validado
  por forma, **não por enum** (escopo de entidades diferido). `validateEnvelope` é
  **fail-closed**: chave sensível ⇒ `ok:false`.
- **`idempotency.js`** — `ERP_IDEMPOTENCY_EVENT_AUTHORITY = CANONICAL_INTENT_FINGERPRINT`:
  identidade da entidade **+ fingerprint canônico do `payload`**. Estável entre retries,
  distinta entre revisões legítimas. Exclui `event_id`/`request_id`/`correlation_id`/
  `occurred_at`/`metadata` (tentativa ≠ evento).
- **`reconcile.js`** — `NOT_FOUND | PENDING | SUCCEEDED | FAILED | UNKNOWN`. Invariantes:
  **UNKNOWN nunca vira SUCCEEDED**; só `NOT_FOUND` autoriza reenvio por padrão, e `FAILED`
  exige evidência explícita (`retry_safe:true`) do provider.
- **`providers/disabledErpProvider.js`** — default de produção: capabilities `[]`, toda
  operação lança `DISABLED`. **Nunca finge sucesso.**
- **`providers/fakeErpProvider.js`** — fake determinístico em memória (testes). Sem rede,
  sem segredo, sem escrita de negócio.
- **`erpProviderGateway.js`** — ponto único. Ordem: **modo disabled ⇒ `DISABLED`**; só então
  valida capability (`UNSUPPORTED_CAPABILITY`); normaliza reconcile. Os dois diagnósticos
  nunca colapsam.
- **`outboxContract.js`** — aceita **somente envelope canônico válido**; `empresa_id` e
  `event_type` são lidos do envelope (autoridade única). Dedupe é **composto por
  `(empresa_id, dedupe_key)` na própria camada**. Máquina de estados
  `pending→processing→processed|failed→dead` com **lease** (`claim_id`, `claimed_at`,
  `lease_expires_at`), **reclaim** após expiração e **recusa de claim obsoleto**
  (`stale_claim`). Em memória, com assinatura async compatível com um repositório SQL
  futuro. **Sem runner ativo.**
- **`externalIdentityContract.js`** — mapa genérico `(provider, empresa_id, entity_type,
  internal_entity_id) → external_entity_id`, tenant/provider-safe, unicidade nos **dois
  sentidos**, identidade imutável com rebind auditável (exige motivo) que **valida tudo antes
  de mutar** — nunca sequestra o external de outro internal nem deixa estado parcial.
- **`diagnostics.js`** + **`routes/erpHub.js`** — `GET /erp-hub/status` read-only, gated por
  `verifyToken + verificarEmpresa + requirePermission('integracoes_erp.gerenciar')`.
  Devolve estado inerte; `display_status = "em_preparacao"` — **nunca "conectado"/"sincronizando"**.

### Persistência diferida — por quê

Outbox e mapa de identidade externa **exigiriam schema** para serem crash-safe em produção,
mas: (a) nada os exercita nesta frente (provider disabled), (b) o schema do outbox depende de
**quais entidades canônicas** compõem V1, e isso é decisão de produto que não deve ser
inventada. Por isso os **invariantes** foram definidos e testados aqui contra implementações
em memória, e a materialização em tabela (no idioma provado do `billing_outbox`/066) fica para
a próxima fatia, sob gate próprio.

Estado declarado, com a precisão que ele merece: **`CRASH_SAFE_CONTRACT_DEFINED`**, e não
"production crash-safe". A *semântica* de recuperação existe e está provada (lease com
expiração, reclaim determinístico, recusa de claim obsoleto); a *durabilidade* não existe —
sem persistência, um crash do processo perde a fila inteira. O `GET /erp-hub/status` reporta
exatamente esse valor, para que ninguém leia mais garantia do que há.

## Hardening de contrato pré-merge (revisão do owner, PR #490 R2)

Nove achados da revisão do contrato foram fechados **dentro da própria E3.7A**, sem migration,
sem schema e sem provider real. Todos eram defeitos de contrato que só apareceriam quando
alguém confiasse neles:

| # | Achado | Correção |
|---|---|---|
| HIGH-01 | Chave de idempotência era a identidade da **entidade**, então duas revisões legítimas da mesma entidade colapsavam e a segunda era descartada em silêncio | Autoridade única declarada: `CANONICAL_INTENT_FINGERPRINT` (identidade + fingerprint canônico do payload). Estável em retry, distinta entre revisões |
| HIGH-02 | Dedupe do outbox indexava só por `dedupe_key`; a segurança de tenant dependia de o *caller* ter embutido `empresa_id` na chave | Índice composto `(empresa_id, dedupe_key)` **na camada**; `duplicate` só devolve item do próprio tenant |
| HIGH-03 | `rebind` deletava o índice antigo antes de validar e não checava se o novo external já pertencia a outro internal → **sequestro de identidade** e índice corrompido | Valida tudo → decide → só então muta. Colisão devolve `conflict_external_already_bound` e ambos os mapeamentos seguem íntegros |
| HIGH-04 | `claimNext` movia para `processing` sem lease; worker morto travava o item para sempre | Lease com expiração + `claimToken`; reclaim determinístico após expirar; `markProcessed`/`markFailed` recusam **claim obsoleto** |
| HIGH-05 | `safeToRetry(FAILED)` era `true`: uma falha de transporte após o ERP já ter aplicado o efeito autorizaria reenvio e **duplicaria efeito de negócio** | `FAILED` nega por padrão; só com evidência explícita `retry_safe:true` do provider |
| HIGH-06 | Provider desligado devolvia `UNSUPPORTED_CAPABILITY` (lista vazia), dizendo "não sei fazer" quando a verdade era "estou desligado" | Ordem corrigida: disabled ⇒ `DISABLED`; capability só é avaliada para provider disponível |
| MEDIUM-01 | O teste da rota injetava a permissão no efetivo e afirmava 200 para tenant — mas `integracoes_erp.gerenciar` tem `entitlementCodigo`, e o resolver nega **antes** de template/override enquanto o ERP é `em_breve`. Provava um acesso que ninguém tem | Teste passa a usar o `computeEffectivePermissions` **real** e provar a matriz verdadeira. Nenhuma permissão nova, nenhuma precedência relaxada |
| MEDIUM-02 | `validateEnvelope` devolvia `ok:true` com `contemChaveSensivel:true` ao lado — dependia de todo caller conferir um segundo campo | **Fail-closed**: chave sensível ⇒ `ok:false`, `motivo:'chave_sensivel_detectada'`. Detecção estrutural recursiva, não regex sobre JSON |
| MEDIUM-03 | `enqueue` aceitava payload arbitrário, furando a cadeia canônica | Só envelope canônico válido; `empresa_id`/`event_type` lidos do envelope (autoridade única) |

> **Supersedido pela R3**: `HIGH-01` (a autoridade `CANONICAL_INTENT_FINGERPRINT` quebrava em
> A→B→A) e `HIGH-05` (a política existia, mas o outbox não a aplicava) foram revistos abaixo.
> Os demais sete achados da R2 permanecem fechados como registrado.

`sanitizeError` também foi revisto: cobre `Bearer`, chaves com prefixo (`sk_`/`api_`…),
segredo em query string e hash longo, e **sanitiza antes de truncar** (truncar primeiro podia
cortar um token ao meio e deixar o fragmento escapar). Escopo honesto: é higiene de log, não
DLP — a regra primária continua sendo nunca passar segredo ao Hub.

## Hardening de contrato pré-merge (revisão do owner, PR #490 R3)

A R2 corrigiu cada contrato isoladamente. A R3 fechou as **interações entre eles** — sete
achados em que dois contratos individualmente corretos, combinados, produziam comportamento errado.

| # | Achado | Correção |
|---|---|---|
| R3-HIGH-01 | `PAYLOAD_FINGERPRINT_IS_NOT_EVENT_OCCURRENCE_IDENTITY` — usar o fingerprint do intent como IDENTIDADE quebra em **A→B→A**: a terceira ocorrência tem payload idêntico à primeira, seria descartada como replay e o ERP ficaria parado em B | Duas autoridades distintas. `ERP_EVENT_IDENTITY=LOGICAL_EVENT_ID` (chave = `provider\|empresa_id\|event_id\|schema_version`, **nunca o payload**) e `ERP_INTENT_FINGERPRINT=CONFLICT_GUARD`. Mesmo `event_id` + mesma intenção = replay idempotente; intenção diferente = **IDEMPOTENCY_CONFLICT** |
| R3-HIGH-02 | `OUTBOX_PROVIDER_AND_DEDUPE_AUTHORITY_INCOMPLETE` — provider entrava só por convenção e o outbox aceitava uma `dedupeKey` inventada pelo caller como autoridade | `OUTBOX_PROVIDER_AUTHORITY=EXPLICIT`: `enqueue({ provider, envelope })`, e a camada **deriva** chave, fingerprint e índice `(empresa_id, provider, event_id)`. Tenants e providers nunca colidem |
| R3-HIGH-03 | `OUTBOX_ENVELOPE_SNAPSHOT_IS_MUTABLE_BY_REFERENCE` — o item guardava a referência do caller e devolvia `{...item}` (shallow), então mutar o envelope original **depois** da validação reescrevia a fila | Clone profundo na entrada, `deepFreeze` interno, clone profundo em toda leitura. O que foi validado é o que será enviado |
| R3-HIGH-04 | `FAILED_RETRY_POLICY_NOT_ENFORCED_BY_OUTBOX` — `safeToRetry(FAILED)=false` vivia num helper que a máquina **não consultava**: `markFailed` + backoff vencido reabria SEND sozinho | A política passou para dentro da máquina. Falha de SEND sem evidência **não reabre SEND** — reabre RECONCILE. Só `retrySafe:true` / `evidence.retry_safe===true` libera reenvio |
| R3-HIGH-05 | `EXPIRED_PROCESSING_MUST_RECONCILE_BEFORE_RESEND` — lease vencido devolvia o item **para envio**; um worker morto depois de o ERP aplicar o efeito produzia um segundo envio | `ERP_OUTBOX_AMBIGUOUS_RECOVERY=RECONCILE_BEFORE_RESEND`. Trabalho tipado (`CLAIM_FOR_SEND` × `CLAIM_FOR_RECONCILE`); lease vencido só libera RECONCILE. O resultado do reconcile está no contrato: SUCCEEDED→`processed`; NOT_FOUND→SEND autorizado; PENDING/UNKNOWN→reconciliar de novo (com teto); FAILED→bloqueado sem evidência. Contadores `send_attempts` × `reconcile_attempts` separados |
| R3-MEDIUM-01 | `INBOUND_ENVELOPE_VALIDATION_NOT_SYMMETRIC_WITH_BUILDER` — havia duas definições de "envelope válido"; e `{ ...envelope, authorization: 'Bearer …' }` passava porque a varredura de segredo só olhava `payload`/`metadata` | `BUILD_AND_VALIDATE_CONSTRAINTS=SYMMETRIC`: o builder normaliza e **submete o resultado ao mesmo `validateEnvelope`**, que ganhou forma **fechada** (campo top-level inesperado invalida), todos os bounds, `occurred_at` como data real e teto de tamanho serializado |
| R3-MEDIUM-02 | `DEEP_PAYLOAD_MUST_NOT_BE_SILENTLY_TRUNCATED` — profundidade excedida virava `null` sem erro: dado sumia, e dois payloads distintos podiam gerar o mesmo fingerprint truncado | `DEPTH_LIMIT_EXCEEDED=INVALID_ENVELOPE`. Uma única regra de profundidade (`LIMITS.MAX_PAYLOAD_DEPTH`) compartilhada por builder, validator e fingerprint, mais recusa explícita de conteúdo não-JSON-safe (BigInt, function, symbol, `NaN`/`Infinity`, `Date`/`Map`, `undefined` em array) |

Consequência de escopo: `enqueue` mudou de assinatura (`{ envelope, dedupeKey }` → `{ provider, envelope }`)
e o outbox ganhou `recordReconcile`. Nada disso é persistido nesta fatia — são invariantes que o
schema de E3.7B apenas materializa.

### ERP_DIAGNOSTICS_AUTHORITY

`EFFECTIVE_PERMISSION('integracoes_erp.gerenciar')`, com a precedência
`ENTITLEMENT → OVERRIDE → TEMPLATE → DEFAULT_DENY` **preservada**. Consequência real, hoje:

| Ator | Resultado |
|---|---|
| Anônimo | `401` |
| Tenant com template que concede, entitlement técnico negado (`em_breve`) | **`403`** |
| Tenant com override `allow` explícito, entitlement negado | **`403`** (entitlement vence) |
| Tenant sem template / `tipo=admin` sozinho | `403` (classe de conta não autoriza — D-072) |
| Super-admin | `200`, inerte |
| Cenário futuro: ERP `disponivel` + concedido pelo plano | `200` |

Ou seja: **a rota de diagnóstico não abre acesso operacional de ERP**. Enquanto o ERP for
`em_breve`, só a autoridade de plataforma enxerga o diagnóstico.

## Decisões devolvidas ao owner (não bloqueiam a arquitetura-base)

- **`ERP_CANONICAL_ENTITY_SCOPE_DECISION_NEEDED`** — qual o primeiro conjunto de entidades
  canônicas (ex.: parceiro, frete, documento). Sem isso não se materializa o schema do outbox/mapa.
- **`E36B_STATUS = DEFERRED_UNTIL_OPERATIONAL_EVIDENCE`** (herdado) — sem preço/adjudicação da
  rede antes de evidência operacional real.
- Ativar provider real / criar secret / habilitar ERP para clientes = **fatia futura sob
  autorização explícita** (E3.7B).

## Testes

- **BACKEND_FOCUSED**: `tests/erpHubFoundation.test.js` (83) + `tests/erpHubRoute.test.js` (8)
  = **91/91 verdes**. Cobrem, por COMPORTAMENTO: envelope (forma fechada v1, segredo no topo e
  aninhado, bounds simétricos build↔validate provados por varredura, `occurred_at` como data real,
  teto serializado, profundidade que recusa em vez de truncar, conteúdo não-JSON-safe);
  idempotência (`event_id` preservado em retry, **A→B→A = três ocorrências distintas**, chave
  independente do payload, mesma ocorrência com intenção diferente ⇒ conflito, isolamento
  tenant/provider, bump de schema, o que compõe e o que não compõe a intenção);
  `DISABLED` × `UNSUPPORTED_CAPABILITY`; outbox (provider explícito, dedupe derivado,
  isolamento cruzado tenant×provider, imutabilidade do snapshot em entrada/retorno/read model,
  `FAILED` sem evidência não reabre SEND nem depois do backoff, `retry_safe` reabre,
  lease vencido ⇒ RECONCILE, **crash após o ERP aceitar ⇒ reconcile SUCCEEDED ⇒ exatamente 1
  `send` contado**, NOT_FOUND ⇒ reenvio liberado, PENDING/UNKNOWN nunca, claim obsoleto,
  terminais imutáveis, tetos de send e de reconcile); external identity; reconcile;
  `sanitizeError`; autoridade da rota pelo resolver **real**; e invariantes arquiteturais
  (sem supabase, sem I/O de rede) mais inércia funcional do modo default.
- **BACKEND_FULL** (`node --test "tests/*.test.js"`): **2105 pass / 1 fail**. A única falha local é
  um artefato de CRLF do checkout Windows num teste que parseia `082_*.sql` por regex
  `)\nLANGUAGE` (`git ls-files --eol` ⇒ `i/lf w/crlf`) — o blob no git é LF e casa, então fica
  **verde no CI** (Linux/LF). Não é regressão desta frente, não foi tocado aqui e segue
  registrado como *pre-existing local harness issue*.
- **SEC1**: 71/71 verdes.

## Git / produção

- Branch `feature/e3-7-erp-integration-hub-a`, worktree dedicada, staging seletivo.
- **Sem migration → PR não fica draft por gate de migration.** Merge em `main` aguarda o owner.
- Produção: apenas G0 read-only. `PRODUCTION_DDL=0`, `PRODUCTION_BUSINESS_WRITES=0`,
  `PRODUCTION_EXTERNAL_CALLS=0`, `ENV_CHANGED=false`.
