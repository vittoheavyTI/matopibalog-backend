# Runbook — Primeiro pagamento real Asaas (one-shot avulso)

> Frente **Pagamento/Aquisição real**. Este runbook cobre F2A → F2B → F3 → F4.
> **Nunca** coloque segredo (`ASAAS_API_KEY`) neste documento nem em logs.

## Decisões fechadas (Jordão)

| # | Decisão | Valor |
|---|---|---|
| 1 | Empresa piloto | **Empresa Foxtrot Teste** (única `commercial_flow_version='v2'`, limpa) |
| 2 | Valor | **R$ 1,00** (`--valor-centavos=100`) — simbólico |
| 3 | Plano | Empresa Start (apenas informativo) |
| 4 | Tipo | **Cobrança avulsa one-shot** (NÃO assinatura) |
| 5 | Método | **PIX** |
| 6 | `ASAAS_API_KEY` | inserida manualmente pelo Jordão em **F2B** |
| 7 | Allowlist | **exatamente 1** empresa (Foxtrot) |
| 8 | Execução | **one-shot manual** (sem runner contínuo) |
| 9 | Pós-teste | **voltar a inerte** |
| 10 | Validação Asaas | Jordão (dashboard) |
| 11 | Rollback | desarmar flags + cancelar cobrança |

## Componentes

- Script: `backend/scripts/billing/asaas_production_one_shot_charge.mjs` (wrapper, dry-run por padrão)
- Núcleo testável: `backend/services/billing/asaasProductionOneShotCharge.js`
- Gate reusado: `backend/services/billing/billingProductionGate.js`
- Provider reusado: `backend/services/billing/asaasProductionProvider.js`
- Testes: `backend/tests/asaasProductionOneShotCharge.test.js`

O script **cria customer idempotente + 1 cobrança PIX avulsa** e **nunca cria subscription**. Não usa o outbox nem liga runner.

## Flags por estado (o gate é cumulativo/fail-closed)

| Env | Atual (inerte) | F2B (ARMED) | F3 (ACTIVE, janela) |
|---|---|---|---|
| `ASAAS_API_KEY` | ausente | **presente** (Jordão insere) | presente |
| `BILLING_PROVIDER_MODE` | ausente→`fake` | `asaas_production` | `asaas_production` |
| `BILLING_PRODUCTION_ENABLED` | ausente→false | `true` | `true` |
| `BILLING_PRODUCTION_ALLOWLIST` | vazia | `<id Foxtrot>` (1 só) | `<id Foxtrot>` |
| `BILLING_OUTBOX_ENABLED` | ausente→false | **`false`** (bloqueia) | **`true`** (só na janela) → depois `false` |

- Estado do gate: `DISABLED` → **`ARMED`** (F2B, escrita bloqueada por outbox off) → **`ACTIVE`** (F3, 1 flip de `BILLING_OUTBOX_ENABLED`).
- **`PRODUCTION_ASAAS_WRITES` NÃO é controle real** — não é lida por nenhum código; o gate a ignora. Não usar.

## F2A — script code-only (esta etapa)

- Script + testes + este runbook criados, **sem executar** e **sem tocar produção**.
- Dry-run seguro em qualquer lugar:
  ```bash
  node backend/scripts/billing/asaas_production_one_shot_charge.mjs --empresa-id=<uuid>
  ```
  Imprime gate, plano, validações que bloqueariam e abort criteria. **Não chama o Asaas.**

## F2B — armar production protegido (NÃO escreve)

1. Jordão insere `ASAAS_API_KEY` production no service `matopibalog-backend` (Railway).
2. Setar `BILLING_PROVIDER_MODE=asaas_production`, `BILLING_PRODUCTION_ENABLED=true`, `BILLING_PRODUCTION_ALLOWLIST=<id Foxtrot>`, **`BILLING_OUTBOX_ENABLED=false`**.
3. Confirmar `/health` OK e gate = **`PRODUCTION_ARMED`** (escrita bloqueada).
4. Confirmar `billing_outbox = 0` e nenhuma cobrança criada.
5. Rodar o **dry-run** apontando para a Foxtrot e conferir que `gate_permite_escrita=false` (outbox off) e o plano está correto.
6. Relatório e PARAR (aguardar autorização explícita da F3).

## F3 — primeiro pagamento one-shot (ISOLADA, autorização explícita)

1. Confirmar autorização + allowlist com **1** empresa (Foxtrot) + valor + `billing_outbox=0`.
2. `BILLING_OUTBOX_ENABLED=true` → gate **`PRODUCTION_ACTIVE`**.
3. Executar **uma** vez:
   ```bash
   node backend/scripts/billing/asaas_production_one_shot_charge.mjs \
     --execute --confirm-production-one-shot \
     --empresa-id=<id Foxtrot> --empresa-nome-esperado="Empresa Foxtrot Teste" \
     --valor-centavos=100
   ```
4. Capturar do log sanitizado: `customer_id`, `charge_id`, `charge_status`, `external_reference_charge`.
5. Jordão valida no **dashboard Asaas**: 1 customer + 1 cobrança PIX, valor/empresa corretos.
6. Conferir persistência local (se aplicável) e `billing_outbox=0`.
7. **`BILLING_OUTBOX_ENABLED=false`** (desarmar) — conforme decisão 9 (voltar a inerte).

## F4 — fechamento / reconciliação

1. Reconciliar Asaas ↔ sistema (`billingReconcileJob` / conferência manual).
2. Verificar **zero duplicidade** (externalReference único).
3. Validar dashboard Asaas + estado do sistema.
4. Confirmar `billing_outbox = 0`.
5. Testar/registrar o kill switch (rollback).
6. Documentar decisão final (voltar a inerte — decisão 9).

## Critérios de ABORTAR (a qualquer momento)

- allowlist com mais de uma empresa; empresa piloto ambígua; valor não confirmado;
- `billing_outbox` ≠ 0 antes; gate entrar em `ACTIVE` sem autorização; runner/cron contínuo ligado;
- Asaas retornar **commit incerto** / 5xx / timeout / 429;
- customer/cobrança duplicado; webhook não idempotente;
- qualquer segredo exposto; **qualquer cobrança criada antes da F3**.

## Rollback / kill switch

```
1. BILLING_OUTBOX_ENABLED=false            → gate volta a ARMED (bloqueia escrita)
2. BILLING_PROVIDER_MODE=fake (ou remover) → gate volta a DISABLED
3. BILLING_PRODUCTION_ENABLED=false
4. BILLING_PRODUCTION_ALLOWLIST=(vazia)
5. (se necessário) remover/rotacionar ASAAS_API_KEY  (Jordão; nunca exposto)
6. Cancelar a cobrança no painel Asaas (ou provider.cancelComponent(chargeId))
7. Confirmar billing_outbox=0 e que nova escrita é impossível (gate DISABLED/ARMED)
```
Qualquer um dos passos 1–4 **isoladamente** já bloqueia novas escritas (gate cumulativo).

## Evidências esperadas

- Log sanitizado do script (`customer_id`, `charge_id`, `charge_status`, `external_reference_charge`).
- Print/registro do painel Asaas (1 customer + 1 cobrança PIX).
- `billing_outbox=0` antes e depois.
- Estado final do gate documentado (voltou a inerte).
