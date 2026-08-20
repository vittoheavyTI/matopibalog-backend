# Asaas Production — Primeiro Pagamento Real Controlado

> Documento de fechamento (postmortem/runbook) da frente **Pagamento/Aquisição real**.
> Cobre o ciclo completo **F0 → F5D**: auditoria, armar produção protegida, primeira cobrança
> real controlada, pagamento PIX, reconciliação por webhook e **desarme final**.
>
> **Escopo:** documentação. **Nunca** inclua segredo (`ASAAS_API_KEY`), token ou dado
> sensível desnecessário neste documento nem em logs.
>
> Runbook procedural complementar (F2A→F4): [`asaas-production-one-shot-runbook.md`](./asaas-production-one-shot-runbook.md).

---

## 1. Status final

`FINAL_STATUS = ASAAS_PRODUCTION_PILOT_FULLY_DISARMED`

- Primeiro ciclo real de cobrança no **Asaas Production** validado **ponta a ponta** e, em
  seguida, **desarmado com segurança**.
- Nenhuma cobrança recorrente, nenhuma `subscription`, nenhuma segunda cobrança.
- Runtime final rodando com o ambiente inerte (gate `PRODUCTION_DISABLED`), `health 200`.

| Dimensão | Estado final |
|---|---|
| Gate de produção | `PRODUCTION_DISABLED` (fail-closed) |
| `ASAAS_API_KEY` | **ausente** (removida após o piloto) |
| `ASAAS_WEBHOOK_TOKEN` | mantida |
| `BILLING_PROVIDER_MODE` | `fake` |
| `BILLING_PRODUCTION_ENABLED` | `false` |
| `BILLING_PRODUCTION_ALLOWLIST` | vazio |
| `BILLING_OUTBOX_ENABLED` | `false` |
| Runner de outbox | desligado |
| Deployment do cutover final | `2ff32276` (SUCCESS) |

---

## 2. Escopo validado

- ✅ Criação idempotente de **customer** real no Asaas Production.
- ✅ Criação controlada de **1 cobrança avulsa PIX** real (allowlist de uma única empresa).
- ✅ **Pagamento real** do PIX liquidado no Asaas (`RECEIVED`).
- ✅ **Webhook real** `PAYMENT_RECEIVED` recebido e processado de forma idempotente.
- ✅ **Fatura local** criada e reconciliada para `pago` por `asaas_id`.
- ✅ **Desarme final** completo, com cutover do runtime carregando o env inerte.
- ✅ Gate cumulativo fail-closed comprovado em cada estágio (`DISABLED → BLOCKED → ARMED → ACTIVE`).

## 3. Escopo NÃO validado (fora desta frente)

- ❌ Aquisição comercial completa (fluxo de contratação/conversão automática).
- ❌ Cobrança **recorrente** / `subscription` em produção.
- ❌ **Runner/outbox** de produção operando com fila e reconciliação automática.
- ❌ Conversão automática trial → pago.
- ❌ Gestão multiempresa de pagamentos reais (allowlist > 1).
- ❌ Tela/admin de *billing production health*.

---

## 4. Linha do tempo técnica

| Fase | Descrição |
|---|---|
| **F0** | Auditoria read-only do gate de produção e do plano por fatias. Sistema safe-inert por design. |
| **F1** | Preparação/runbook inerte: definição de piloto, allowlist e rollback (sem tocar produção). |
| **F2A** | Script one-shot de cobrança avulsa PIX (dry-run por padrão), mergeado e **inerte**. |
| **F2B** | `PRODUCTION_ARMED` com escrita bloqueada (`ASAAS_API_KEY` + flags; `outbox=false`). |
| **F3A** | Hardening do runtime do one-shot (cliente REST sem WebSocket, dry-run seguro no Windows). |
| **F3B** | Primeira execução real → falha HTTP 400 (valor abaixo do mínimo); reconciliação. |
| **F4** | Retry a R$5,00 → **charge criada** (`PENDING`), reconciliada; `CHARGE_FOUND_DO_NOT_REPEAT`. |
| **F5A** | Harness read-only de certificação do estado de pagamento. |
| **F5B** | Sync local idempotente → **fatura local visível** ("Minhas Faturas"); copy corrigida. |
| **F5C** | Pagamento PIX real + webhook `PAYMENT_RECEIVED` → fatura local `pago` (reconciliado). |
| **F5D** | **Desarme final**: flags inertes, remoção do segredo e cutover do runtime. |

---

## 5. PRs e commits relevantes

| PR | Tema | Merge SHA |
|---|---|---|
| #427 | Script one-shot de cobrança avulsa PIX (F2A) | `cfb7c59` |
| #428 | Hardening do runtime one-shot (F3A) | `fe3bee4` |
| #429 | `--reconcile` + log 4xx sanitizado + normalização `cpfCnpj` | `1ed9a51` |
| #430 | Harness read-only de certificação Asaas (F5A) | `027785d` |
| #431 | Sync local idempotente de fatura one-shot (F5B-1A) | `8771faf` |
| #432 | Copy correta para fatura real production + valor pt-BR (F5B-2) | `2c36450` |

**Cutover final do runtime (desarme):** deployment **`2ff32276`** (`reason=redeploy`, sobre `2c36450`), status `SUCCESS`. Este redeploy fez o processo recarregar o ambiente final (sem `ASAAS_API_KEY`).

> Observação operacional: no dia do desarme a fila de build do Railway ficou temporariamente
> travada (deploys presos em `QUEUED`/`BUILDING`). A limpeza dos deploys presos + um único
> redeploy limpo resolveram sem afetar o deployment saudável que servia tráfego.

---

## 6. Artefatos reais

| Artefato | Valor |
|---|---|
| Empresa piloto (Foxtrot Teste) | `bc54e9a6-b54b-4ed2-9b7a-3833edebded6` |
| Customer Asaas (produção) | `cus_000194574257` |
| Charge Asaas (produção) | `pay_moeewnn1bslsyg9c` |
| Valor | **R$ 5,00** |
| Tipo | **PIX** (avulsa) |
| Status Asaas final | `RECEIVED` |
| `subscription` | `false` |
| Segunda cobrança | `false` |
| Fatura local | `3929afb5-6f81-4efb-b4fb-4b8c9ba8d199` |
| Status fatura local | `pago` (`asaas_raw_status=RECEIVED`) |
| Evento webhook | `PAYMENT_RECEIVED` — `processed` (idempotente, `attempts=1`, sem erro) |
| `billing_outbox` | `0` |

---

## 7. Runbook seguro (como repetir no futuro)

Executar **somente** com autorização explícita, allowlist única e este runbook em mãos.

**Pré-condições:**
1. Gate na ordem correta: `PRODUCTION_DISABLED → BLOCKED → ARMED → ACTIVE`. Só há escrita
   real quando **todos** os requisitos coexistem: `BILLING_PROVIDER_MODE=asaas_production`
   **+** `BILLING_PRODUCTION_ENABLED=true` **+** `BILLING_OUTBOX_ENABLED=true` **+**
   allowlist não-vazia com a empresa alvo **+** `ASAAS_API_KEY` presente **+** operação elegível.
2. **Allowlist única** (uma empresa por piloto).
3. **Valor mínimo R$ 5,00** (o Asaas rejeita cobranças abaixo disso com HTTP 400).
4. Chave PIX ativa e cobrança PIX habilitada na conta Asaas de produção.

**Execução:**
5. **Dry-run obrigatório antes de qualquer `--execute`.** Conferir plano (empresa correta,
   valor, `writes_planned`).
6. Um único `--execute` controlado. **Nunca** repetir se o commit ficou incerto
   (5xx/timeout/429) — rodar `--reconcile` (read-only) primeiro.
7. Após pagamento, confirmar reconciliação (webhook → fatura `pago`).

**Encerramento:**
8. **Desarme final obrigatório** (seção 9) após validar o ciclo.

---

## 8. Falhas encontradas e correções

| Sintoma | Causa raiz | Correção / aprendizado |
|---|---|---|
| Primeira cobrança HTTP 400 | Valor **R$ 1,00 abaixo do mínimo Asaas (R$ 5,00)** | Usar valor ≥ R$ 5,00; #429 passou a logar o corpo 4xx sanitizado. |
| Customer criado, sem charge | `createCustomer` passou, `createCharge` falhou (400 do valor) | Estado parcial esperado; `--reconcile` distingue `CUSTOMER_ONLY_NO_CHARGE`. |
| Diagnóstico difícil do 400 | Núcleo só expunha `err.message` | #429 adicionou `http_status` + `failed_step` + `errors[].code/description`. |
| `cpfCnpj` mascarado no POST | Empresa guarda CNPJ com máscara | #429 normaliza para apenas dígitos antes do POST; o customer foi aceito. |
| Crash no Windows (dry-run) | `@supabase/supabase-js` abre Realtime/WebSocket (handles pendentes) | #428: cliente REST (PostgREST/axios) sem WebSocket para o one-shot. |
| Fatura não aparecia no painel | One-shot só criava a charge no Asaas, sem linha local | #431: sync local idempotente cria/atualiza a fatura por `asaas_id`. |
| Sync antigo não servia | Era **subscription-based** e **sandbox-gated** | Cobrança avulsa production não era coberta; novo caminho por `asaas_id`. |
| Copy "sandbox/sem valor real" | Texto fixo assumia sandbox | #432: copy condicional por `origem`; cobrança real mostra "cobrança real via Asaas". |
| Webhook não atualizava fatura | Webhook casa a fatura **apenas por `asaas_id`** | A fatura local precisa existir por `asaas_id` **antes** do pagamento. |

---

## 9. Desarme final

Estado de segurança atingido e verificado no runtime (deployment `2ff32276`):

- `ASAAS_API_KEY` **removida** (ausente na lista de variáveis).
- `ASAAS_WEBHOOK_TOKEN` **mantida** (o webhook pode receber retries históricos sem risco de
  criar cobrança).
- `BILLING_PROVIDER_MODE = fake`
- `BILLING_PRODUCTION_ENABLED = false`
- `BILLING_PRODUCTION_ALLOWLIST` = vazio
- `BILLING_OUTBOX_ENABLED = false`
- Runner de outbox: **off**
- Gate final: **`PRODUCTION_DISABLED`** (fail-closed; não `ARMED`, não `ACTIVE`)
- `health = 200`

> Nota sobre cutover: variáveis de ambiente só entram no **boot** do processo. Alterar/remover
> variáveis persiste a config, mas o runtime só passa a valer o env novo após um deploy/redeploy
> bem-sucedido. Por isso o desarme exigiu o redeploy `2ff32276` para efetivar no processo vivo.

**Rollback / rearme:** rearmar exige **nova autorização explícita** + reinserir `ASAAS_API_KEY`
+ reativar as flags na ordem do gate + allowlist única. Qualquer flag ausente mantém o
sistema bloqueado (fail-closed).

---

## 10. Checklist para o próximo piloto

- [ ] Autorização explícita registrada.
- [ ] Empresa piloto definida; **allowlist = 1**.
- [ ] Conta Asaas de produção: chave PIX ativa + cobrança PIX habilitada.
- [ ] Valor **≥ R$ 5,00**.
- [ ] Gate revisado na ordem `DISABLED → BLOCKED → ARMED → ACTIVE`.
- [ ] **Dry-run** conferido antes do `--execute`.
- [ ] Fatura local existente por `asaas_id` **antes** do pagamento (para o webhook casar).
- [ ] Webhook do Asaas apontando para produção com o token correto.
- [ ] `--reconcile` (read-only) após qualquer falha ou commit incerto — **nunca** repetir cego.
- [ ] Reconciliação confirmada (webhook → fatura `pago`).
- [ ] **Desarme final** aplicado e cutover do runtime verificado (`gate PRODUCTION_DISABLED`, `health 200`).

---

## 11. Próximas frentes recomendadas

1. **Fluxo comercial/faturas real integrado** para um piloto oficial (contratação → cobrança → fatura).
2. Desenho de **outbox/runner de produção** com fila e reconciliação automática.
3. Tela/admin de **billing production health** (visibilidade do gate e das faturas reais).
4. **Política de rearmar/desarmar** produção (quem autoriza, allowlist, janela, rollback).
