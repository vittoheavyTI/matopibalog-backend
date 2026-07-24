# Runbook — Sync automático Asaas (SANDBOX) + Checkout comercial

> **Estado:** implementado e **validado em sandbox** (2026-07-24). Migrations
> 038–042 aplicadas. Asaas **production PROIBIDO** (hard stop) — este runbook é
> só para sandbox. Nada aqui cria cobrança real.

## Princípio

O **Matopiba Log é a fonte da verdade** do plano/preço/capacidade. O **Asaas é
processador/agendador**. O Asaas **não tem "plano global"** → o sync é no nível de
**assinatura por empresa** (`asaasSubscriptionService` cria 1 assinatura por
empresa, `value = plano.preco_mensal`, `externalReference = empresa_id`).

Toda alteração de preço é **forward-only**: o sync ajusta o **valor futuro** da
assinatura (`updatePendingPayments=false`); **nunca** altera fatura já emitida/paga.

## Tabelas (migration 042)

| Tabela | Papel |
|--------|-------|
| `asaas_sync_estado` | fila por empresa: `status` (pendente/sincronizado/erro), `valor_alvo`, `valor_sincronizado`, `tentativas` |
| `asaas_sync_tentativas` | auditoria append-only: `acao`, `valor_antes`/`valor_depois`, `resultado`, `ambiente`, sem PII |

## Endpoints (super-admin; base = Railway, **não** o site GitHub Pages)

`https://matopibalog-backend-production.up.railway.app`

| Método | Rota | O quê |
|--------|------|-------|
| `GET` | `/pagamentos/asaas-sync/estado` | observabilidade da fila |
| `POST` | `/pagamentos/asaas-sync/marcar` | `{ plano_id }` → marca empresas do plano como pendentes |
| `POST` | `/pagamentos/asaas-sync/processar` | `{ limite }` → processa a fila (**sandbox-gated**) |

Auth do painel: **Bearer** em `localStorage['auth_token']` (não cookie). Ex.:
```js
fetch(B + '/pagamentos/asaas-sync/estado', { headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') } })
```

## Marcação automática

Ao **editar o preço** de um plano (`PUT /painel-admin/planos/:id`), as empresas
cobráveis (ativo/trial, não arquivadas) daquele plano são marcadas `pendente`
com `valor_alvo = novo preço` (best-effort; se a 042 não existir, ignora sem
quebrar a edição).

## Decisão do processamento (`asaasSyncDomainService.avaliarSync`)

- sem assinatura + cadastro completo → **criar**; cadastro incompleto → **erro** (sem reserva órfã);
- assinatura com valor divergente → **atualizar_valor** (forward-only);
- valor já bate → **pular** (idempotente);
- plano gratuito / `requer_negociacao` / conta não cobrável → **pular**.

## Procedimento E2E (validado 2026-07-24)

1. **Pré-check:** `SELECT dados->'integracao_asaas'->>'environment' FROM configuracoes WHERE id=1;` → `sandbox`.
2. **Marcar:** editar o preço de um plano de empresa com empresas → conferir `asaas_sync_estado` (`pendente`).
3. **billing-health:** `GET /painel-admin/billing-health` → `sync_asaas_pendente > 0`, `ok=true`.
4. **Processar:** `POST /pagamentos/asaas-sync/processar {limite:5}` → `sincronizadas > 0`; conferir `asaas_sync_tentativas` (antes/depois, `ambiente=sandbox`).
5. **Idempotência:** rodar `/processar` de novo → `processadas: 0` (fila sem pendentes) → não duplica.
6. **Gate financeiro:** `faturas` segue `20 / 5 / 604,78 / 2` — o sync **não** cria fatura local nem toca paga.

Resultado real da validação: 1× `atualizar_valor` (149,90→299,90) + 2× `criar`, todos `ok`, `ambiente=sandbox`, gate intacto.

## Checkout com código promocional

1. Super-admin cria campanha + código (painel Promoções ou `POST /painel-admin/promocoes` + `/codigos`).
2. Prévia pública: `POST /planos/validar-promocao { codigo, plano_id }` → `preco_original` × `preco_promocional`.
3. Cadastro com `codigo_promocional` → grava **resgate pendente** (`fatura_id` NULL) com snapshot.
4. Na **1ª fatura** (regularização/trial), `regularizacaoService` aplica o desconto (`ajustarValorPorResgate`) e **consome** o resgate (`fatura_id` preenchido). Forward-only; nunca toca fatura emitida.

## Observabilidade (billing-health — todos informativos, não derrubam `ok`)

`sync_asaas_pendente`, `sync_asaas_erro`, `assinatura_asaas_desatualizada`,
`empresa_sem_assinatura_esperada`, `empresa_com_assinatura_mas_plano_invalido`,
+ os comerciais (`implantacao_pendente`, `promocoes_ativas/expiradas`, `empresas_sob_negociacao`, `empresas_acima_capacidade`, …).

## Hard stops (mantidos)

- **Asaas production PROIBIDO** — o `bloquearSeNaoSandbox` responde 403 se `environment != sandbox`.
- Sem cobrança real, sem DELETE de dado financeiro, sem tocar fatura paga/emitida, sem recalcular fatura emitida.
- Go-live production é **frente separada** (com autorização explícita).

## Próxima frente recomendada

**Cobrança de extras por empresa:** hoje o sync usa `plano.preco_mensal` (base).
Falta persistir "quantos motoristas a empresa contratou" para o valor incluir os
extras (`base + (qtd − capacidade_inclusa) × preco_motorista_extra`). O
`calculadoraComercialService` já calcula; falta o campo por empresa + o hook na
geração de fatura/sync. Depois disso, go-live Asaas production.
