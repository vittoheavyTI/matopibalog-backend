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
  por forma, **não por enum** (escopo de entidades diferido).
- **`idempotency.js`** — chave determinística `provider|empresa|entity_type|entity_id|
  event_type|schema_version` (tenant-safe; nunca inclui event_id/timestamp).
- **`reconcile.js`** — `NOT_FOUND | PENDING | SUCCEEDED | FAILED | UNKNOWN`. Invariante:
  **UNKNOWN nunca vira SUCCEEDED**; só `NOT_FOUND`/`FAILED` autorizam reenvio.
- **`providers/disabledErpProvider.js`** — default de produção: capabilities `[]`, toda
  operação lança `DISABLED`. **Nunca finge sucesso.**
- **`providers/fakeErpProvider.js`** — fake determinístico em memória (testes). Sem rede,
  sem segredo, sem escrita de negócio.
- **`erpProviderGateway.js`** — ponto único; seleciona pelo modo, valida capability **antes**
  de chamar o adapter, normaliza reconcile.
- **`outboxContract.js`** — máquina de estados `pending→processing→processed|failed→dead`,
  claim, backoff, `sanitizeError`, tenant isolation — implementação **em memória** com
  assinatura async compatível com um repositório SQL futuro. **Sem runner ativo.**
- **`externalIdentityContract.js`** — mapa genérico `(provider, empresa_id, entity_type,
  internal_entity_id) → external_entity_id`, tenant/provider-safe, identidade imutável com
  rebind auditável (exige motivo). Em memória; persistência diferida.
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

## Decisões devolvidas ao owner (não bloqueiam a arquitetura-base)

- **`ERP_CANONICAL_ENTITY_SCOPE_DECISION_NEEDED`** — qual o primeiro conjunto de entidades
  canônicas (ex.: parceiro, frete, documento). Sem isso não se materializa o schema do outbox/mapa.
- **`E36B_STATUS = DEFERRED_UNTIL_OPERATIONAL_EVIDENCE`** (herdado) — sem preço/adjudicação da
  rede antes de evidência operacional real.
- Ativar provider real / criar secret / habilitar ERP para clientes = **fatia futura sob
  autorização explícita** (E3.7B).

## Testes

- **BACKEND_FOCUSED**: `tests/erpHubFoundation.test.js` (envelope/sanitização/versionamento;
  provider disabled fail-safe; fake adapter; capability desconhecida/não suportada;
  idempotência; outbox retry/backoff→dead + máquina de estados + tenant isolation; external
  identity colisão/tenant-safe/rebind; reconcile UNKNOWN≠SUCCEEDED; arquitetural: nenhuma
  camada importa supabase nem faz I/O de rede) + `tests/erpHubRoute.test.js` (401/403/200 inerte,
  super-admin). **26/26 verdes.**
- **BACKEND_FULL** (`node --test`): **2042 pass**; a única falha local é um artefato de CRLF do
  checkout Windows num teste que parseia `082_*.sql` por regex `)\nLANGUAGE` — o blob no git é LF
  e casa, então **verde no CI** (Linux/LF); não é regressão desta frente.

## Git / produção

- Branch `feature/e3-7-erp-integration-hub-a`, worktree dedicada, staging seletivo.
- **Sem migration → PR não fica draft por gate de migration.** Merge em `main` aguarda o owner.
- Produção: apenas G0 read-only. `PRODUCTION_DDL=0`, `PRODUCTION_BUSINESS_WRITES=0`,
  `PRODUCTION_EXTERNAL_CALLS=0`, `ENV_CHANGED=false`.
