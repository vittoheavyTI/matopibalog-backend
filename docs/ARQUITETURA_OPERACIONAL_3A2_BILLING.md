# Arquitetura Operacional — Billing Automático / Asaas (3A-2)

> Complementa `ARQUITETURA_OPERACIONAL_3A1.md`. Empilhado sobre 3A-1 (núcleo
> comercial/contratual). **NÃO implementa deploy, merge, secret ou write em Asaas
> PRODUÇÃO.** O modo real permitido é apenas SANDBOX, gated (adapter plugado no Gate).

---

## 1. Princípio central: automático, backend é autoridade

O fluxo financeiro é AUTOMÁTICO, disparado por mudança de estado comercial, não por
cliques do Super Admin. A operação normal não depende de "configurar assinatura" /
"sincronizar" manuais — estes existem só como **contingência/reconciliação/suporte**.

Fluxo: cliente → plano → trial → contrato → **customer** → **assinatura** → **cobrança**
→ pagamento → **webhook** → fatura local → estado financeiro → situação comercial →
acesso/bloqueio → upgrade/downgrade → add-ons → cancelamento.

O **estado local é a autoridade** para as telas — não consultamos o Asaas a cada
render. O Asaas é o provedor externo; o webhook + reconciliação mantêm o local coerente.

## 2. Modelo de dados

- `empresas.asaas_customer_id`, `asaas_subscription_id`, `billing_status`,
  `next_due_date`, `billing_updated_at`, `implantacao_cobrada`.
- `faturas` (cobranças locais) — status, valor, vencimento.
- `asaas_webhook_events` — **idempotência de webhook** (event_id UNIQUE, insert-or-claim,
  hash-divergence, reclaim de stale via compare-and-swap, `next_retry_at`, erros sanitizados).
- `empresa_funcionalidades` (add-ons faturáveis: `preco_mensal_centavos`, `billing_component_id`).

**Migration nova:** `066_billing_outbox.sql`. A `065` fica reservada ao #417.

## 3. Componentes 3A-2 (novos, `backend/services/billing/`)

| Componente | Papel |
|---|---|
| `billingPolicyConfig` | Políticas CONFIGURÁVEIS (implantação timing, prazo de graça, provider_mode). Default explícito conservador (`nao_cobrar`, graça 5d, `fake`). Sem hardcode financeiro. `production` proibido. |
| `billingOrchestratorDomainService` (puro) | Cérebro: dado o estado comercial + billing local + política, planeja ações IDEMPOTENTES (garantir_customer, garantir_assinatura com 1º venc = trial_end, cobrar_implantacao por política, garantir_addon). |
| `fakeAsaasProvider` | Provider em memória (mesmo contrato do real) com injeção de falhas (timeout/429/5xx) para E2E offline. |
| `billingWebhookApplyDomainService` (puro) | Máquina de estados de fatura tolerante a fora-de-ordem + idempotente (não regride estado por evento atrasado; correção terminal de estorno/cancelamento sempre aplica). |
| `billingReconcileDomainService` (puro) | Motor único de reconciliação (customer/subscription/charge ausentes ou defasados). Usado pela automação e pela contingência. |
| `billingInadimplenciaDomainService` (puro) | Overdue → recomendação comercial. Trial preserva a operação; pós-trial aplica graça configurável. |
| `billingOrchestratorService` (I/O) | `ensureBillingStateComDeps`: lock por empresa (idempotência concorrente), retry só transitório, provider injetável (fake/sandbox, nunca produção). Executor idempotente. |
| `billingAdminViewDomainService` (puro) | Linha de estado financeiro por empresa para o Super Admin (IDs mascarados, inadimplência derivada, último webhook). |

## 4. Regras canônicas honradas (com testes)

- **Trial não é cancelado por pagamento/contrato/assinatura** (§13/§47). A situação
  comercial (3A-1) é a autoridade do trial; o billing não a altera.
- **1ª mensalidade nunca antes de `trial_end`** (§14) — `calcularPrimeiroVencimento` /
  `primeiroVencimentoMensalidade`.
- **Idempotência** (§10/§48): `ensureBilling` 10x concorrentes → 1 customer/1 assinatura
  (lock por empresa). Webhook duplicado 20x → 1 efeito (§49).
- **Fora de ordem** (§21/§50): evento atrasado não regride estado mais novo.
- **Implantação** por política configurável (§15): imediato/fim_trial/primeira_fatura/nao_cobrar.
- **Add-ons** (§16): componente idempotente por add-on; remoção cessa a obrigação.
- **Retry** (§22) só para transitórios; 4xx de negócio não repete.
- **Reconciliação** (§23/§51): recupera mapeamentos/cobranças sem duplicar.
- **Inadimplência** (§30/§31/§32) alimenta a autoridade comercial; sem `if(overdue)` espalhado.

## 5. Endpoints (Super Admin) — READ/PLAN (sem write Asaas)

- `GET /pagamentos/billing/overview/:empresa_id` — estado financeiro consolidado (§36).
- `POST /pagamentos/billing/ensure-plan/:empresa_id` — plano de billing (dry-run).
- `POST /pagamentos/billing/reconciliar-plan/:empresa_id` — divergências (dry-run).

Execução REAL (criar customer/assinatura/cobrança no sandbox) é o **Gate 3A-2 sandbox**:
o adapter real de sandbox é plugado com prova de ambiente; enquanto não plugado, o
`selecionarProvider` falha explicitamente (nunca cai em produção).

Webhook: `POST /pagamentos/webhook/asaas` (existente) — token fixo fail-closed +
`asaasWebhookService` idempotente (reutilizado; a state machine 3A-2 formaliza as transições).

## 6. Frontend / App

- Super Admin › **Billing** (`PainelBilling`): overview por empresa + ações dry (plano/reconciliar).
- App: consome a **situação comercial** (3A-1) como autoridade (mensalidade, implantação,
  trial, regularização). NÃO duplica engine de billing no Flutter (§57).

## 6.1 Automação real (evento → outbox → worker → provider)

O fluxo NÃO depende de clique. Um **outbox** (migration 066 `billing_outbox`) converte
mudança comercial em evento; um **worker** processa e chama `ensureBillingState`.

- **Trigger** (`billingTriggers.emitirEventoBilling`) — ponto único; enfileira idempotente
  (`dedupe_key`). Ligado em: **contrato assinado** (`routes/contratacao.js`) e **webhook
  processado** (`routes/pagamentos.js`). Demais gatilhos (trial iniciado/finalizado, plano/
  add-on alterado, cancelamento) usam o mesmo `emitirEventoBilling` nos respectivos pontos.
- **Outbox** (`billingOutboxRepository`) — `enfileirar` (INSERT ON CONFLICT (dedupe_key) DO
  NOTHING → idempotência de enfileiramento) + `reivindicarProximo` (UPDATE ... WHERE status
  RETURNING → **claim CAS**, 1 worker por evento) + `marcarProcessado/Falhou` (backoff; esgotou
  → `dead`/manual_attention).
- **Worker** (`billingOutboxWorker.processarOutbox`) — job/contingência: `POST
  /pagamentos/billing/processar-outbox` (super-admin). Mesma engine para automático e manual (§14).
- **Idempotência multi-processo (§8)**: `dedupe_key` UNIQUE + claim CAS + conditional-update dos
  mapeamentos (`asaas_customer_id IS NULL`). Provado no `tests-pg/billing_outbox.pgtest.mjs`
  (Postgres real, CI) e no E2E in-memory (lógica do worker).

## 6.2 Status de implementação e teste (§30)

| Item | Implementado | Testado FAKE (local) | Testado CI PG | Testado SANDBOX | Pendente PRODUÇÃO |
|---|:--:|:--:|:--:|:--:|:--:|
| Política configurável + guard produção | ✅ | ✅ | — | — | (produção proibida) |
| Orquestrador (customer/subscription/implantação/add-on) | ✅ | ✅ | — | ❌ | ✅ |
| Trial preservado / 1ª mensalidade = trial_end | ✅ | ✅ | — | ❌ | ✅ |
| Webhook state machine (dup/out-of-order) | ✅ | ✅ | — | ❌ | ✅ |
| Reconciliação (motor) + reconcile periódico | ✅ | ✅ | — | ❌ | ✅ |
| Inadimplência (trial/graça) | ✅ | ✅ | — | — | ✅ |
| Outbox + trigger + worker + **runner automático** | ✅ | ✅ | — | ❌ | ✅ |
| **Idempotência multi-processo (dedupe + claim CAS)** | ✅ | ✅ (lógica) | ✅ **`billing-3a2-ci` (Postgres 16 real)** | ❌ | ✅ |
| Migration 066 aplica em Postgres | ✅ | — | ✅ **`billing-3a2-ci`** | — | ✅ |
| Adapter real Asaas SANDBOX | ✅ (código + contract test) | ✅ (http fake) | — | ❌ **BLOCKER** | ✅ |
| E2E Asaas SANDBOX externo | ✅ (script + workflow protegido) | — | — | ❌ **BLOCKER** | — |

**PG concurrency: ELIMINADO como blocker.** O workflow `billing-3a2-ci.yml` roda NA BRANCH
(push/dispatch) com Postgres 16 efêmero: aplica migrations até 066 e executa
`billing_outbox.pgtest.mjs` — **enfileirar 10x mesmo dedupe_key → 1 linha; claim CAS concorrente
→ 1 vencedor; privilégios anon/authenticated negados** (verde). Billing fake: 101/101.

**BLOCKER externo ÚNICO restante:** este ambiente **não possui `ASAAS_SANDBOX_API_KEY`** → a
**E2E Asaas sandbox real = NOT RUN**. Todo o código (adapter, runner, outbox, reconcile) está
implementado e testado fake/contract + PG CI; a E2E sandbox roda no workflow protegido
`billing-3a2-sandbox.yml` (environment `sandbox` + secret `ASAAS_SANDBOX_API_KEY`, fail-closed).
**Nunca testado contra Asaas real.**

## 6.3 Reconcile CONVERGENTE + config estrita (revisão)

- **Orquestrador = função de convergência** (não só create-if-missing): cria customer/assinatura
  ausentes; **`atualizar_assinatura_valor`** quando o valor esperado difere de
  `empresas.billing_valor_mensal` (plano alterado); **cria/remove componente de add-on** por
  convergência (ativo sem componente → criar; inativo com componente → remover);
  **`cancelar_assinatura`** quando a conta é cancelada. **No-op quando já convergente** (idempotente).
- **Reconcile periódico** seleciona por estado: `trial_finalizado`, `customer_ausente`,
  `subscription_ausente`, `cancelamento_pendente`, `revalidar`. Assim eventos de
  plano/add-on/cancelamento **perdidos** convergem sem depender do histórico.
- Colunas de convergência (migration 066): `empresas.billing_valor_mensal`, `empresas.assinatura_cancelada`.
- **Config do runner fail-closed** (`billingRunnerConfig`): `BILLING_OUTBOX_ENABLED` só `true`/`false`;
  intervalo/lote inválido ou fora da faixa → `BillingRunnerConfigurationError` (sem clamp). O
  runner/scripts falham ANTES de processar se a config for inválida.
- **E2E automático real:** os testes exercitam o **tick** do runner (sem chamada manual ao worker).

## 7. Reservado para o Gate 3A-2 (sandbox → produção)

- Adapter real de Asaas sandbox conformando ao contrato do provider (createCustomer/
  Subscription/Charge/cancel/get) — reusa `garantirCustomer/garantirAssinatura` existentes.
- Disparo automático (outbox/gatilho) em: contratação criada, contrato assinado, trial
  iniciado/finalizado, plano alterado, add-on alterado, cancelamento, retorno de webhook (§25).
- E2E Asaas sandbox com fixtures sintéticas (§45), datas controladas (§46).
- Produção só após Gate sandbox estável + autorização explícita (§66).
