# Runbook — Aplicação controlada de preços comerciais

> Documento **operacional** versionado. Ler inteiro antes de agir. Este runbook
> **não altera preço nenhum** — descreve o procedimento seguro para quando o
> responsável trouxer a tabela final de preços.
>
> Pré-requisito de negócio: preços comerciais **decididos** em
> [`GOLIVE_PRECOS_MATRIZ.md`](GOLIVE_PRECOS_MATRIZ.md). Enquanto não houver tabela
> final, **não aplicar**.
>
> Base: `main` após a mega-frente go-live (PRs #312/#313). Auditoria 2026-07-23.

---

## 0. Ordem mental

1. **Preço** (catálogo) é independente de **dinheiro real** (Asaas production).
   Alterar preço em **sandbox** não cobra ninguém. Ativar Asaas production é uma
   frente **separada** — ver [`RUNBOOK_GOLIVE_ASAAS.md`](RUNBOOK_GOLIVE_ASAAS.md).
2. Toda alteração de preço é **forward-only**: nenhuma fatura já emitida muda
   (snapshot — ver [`MODELO_COBRANCA.md`](MODELO_COBRANCA.md) §6).
3. O backend já tem a trava: plano **já utilizado** exige **confirmação 409**.

---

## 1. Baseline (tirar ANTES de qualquer mudança)

Todas as leituras abaixo são **read-only**. Guardar a saída (é o ponto de rollback lógico).

- **Planos**: `GET /painel-admin/planos` → salvar `id`, `nome`, `preco_mensal`,
  `modelo_cobranca`, `preco_por_motorista`, `limite_motoristas`, `ja_utilizado`.
- **Empresas por plano**: `GET /painel-admin/empresas` (ou `/assinaturas`).
- **Faturas / gate financeiro**: `GET /painel-admin/billing-health` → guardar
  `totais` (total, pagas, total_pago, abertas) e `ok`.
- **Snapshot de saúde**: confirmar `ok=true` e contadores críticos zerados
  (ver §Observabilidade).

> Dica: exportar o JSON de cada endpoint para arquivo datado. É o baseline de
> comparação pós-mudança.

---

## 2. Simular o impacto (preview read-only) — **novo nesta frente**

Antes de aplicar, para **cada** plano a mudar:

```
GET /painel-admin/planos/:id/impacto-preco?novo_preco=299.90
GET /painel-admin/planos/:id/impacto-preco?novo_modelo=por_motorista&novo_preco_por_motorista=100&novo_limite_motoristas=10
```

Retorna, sem gravar nada:

| Campo | Uso na decisão |
|---|---|
| `preco_atual` / `preco_novo` | confere o valor derivado (em `por_motorista`, é unitário × quantidade) |
| `mudou_preco` | `false` = nada muda (evita PUT à toa) |
| `empresas_afetadas` | quantas contas usam o plano |
| `faturas_abertas` | faturas abertas dessas empresas — **NÃO mudam** (snapshot) |
| `proximas_recorrencias` | ativas sem assinatura Asaas — passam a usar o novo valor |
| `aviso_snapshot` | texto pronto para a decisão |

**Critério de ir/não-ir:** o `preco_novo` bate com a tabela final? O
`empresas_afetadas` e `proximas_recorrencias` são o que você espera? Se sim, seguir.

---

## 3. Aplicar (quando o preço estiver decidido)

Um plano por vez. `PUT /painel-admin/planos/:id`:

- Plano **fixo**: `{ "preco_mensal": <valor> }`.
- Plano **por_motorista**: `{ "modelo_cobranca": "por_motorista",
  "preco_por_motorista": <unitário>, "limite_motoristas": <quantidade> }`
  (o `preco_mensal` é derivado pelo backend; não enviar valor mentiroso).

Comportamento:
- Plano **não** utilizado → aplica direto (200).
- Plano **já** utilizado e preço **mudou** → **409** com o diff
  (`preco_atual → preco_novo`, `empresas_afetadas`). **Nada é aplicado.**
  Reenviar com `{ ..., "confirmar_reprecificacao": true }` para confirmar.
- Renomear / mudar categoria / arquivar / inativar **não** dispara 409 (o gate é
  sobre **dinheiro** mudando).

> A trava 409 é no **backend**, não no modal — um `curl` ou painel desatualizado
> não fura mudança de preço de plano em uso.

---

## 4. Validar (logo após aplicar)

- `GET /painel-admin/planos` → o plano mostra `preco_mensal` novo (e
  `preco_por_motorista`/`limite` coerentes se `por_motorista`).
- `GET /painel-admin/billing-health` → `ok` continua `true`; `totais.total_pago`
  e `pagas` **inalterados** (nenhuma fatura passada mudou).
- Conferir uma empresa afetada: `faturas` já emitidas continuam com o valor antigo
  (snapshot). Só a **próxima** recorrência/regularização usará o novo valor.

---

## 5. Rollback

Como é **forward-only**, reverter é aplicar o **preço antigo** de volta
(mesmo `PUT`, com o valor do baseline §1, confirmando 409 se necessário).

- Nenhuma fatura precisa ser "desfeita" — as emitidas nunca mudaram.
- Se uma recorrência **já foi gerada** com o preço novo entre a mudança e o
  rollback, essa fatura específica carrega o valor novo no snapshot; decidir
  caso a caso (cancelar/regerar é operação de billing, com autorização).

---

## 6. Sandbox primeiro, produção depois

1. **Sandbox**: aplicar os preços, rodar §4, validar a próxima recorrência
   (o cron sandbox-gated + allowlist já roda `0 6 1 * *`; ver
   [`RUNBOOK_GOLIVE_ASAAS.md`](RUNBOOK_GOLIVE_ASAAS.md)).
2. **Produção (catálogo)**: repetir o `PUT` em produção. Isso muda **só o
   catálogo** — continua **não cobrando de verdade** enquanto o ambiente Asaas
   for `sandbox` (fail-closed).
3. **Dinheiro real**: só depois, na frente separada de ativação do Asaas
   production (🔴 hard stop, autorização explícita).

---

## 7. Observabilidade de go-live (o que olhar)

Fonte única: `GET /painel-admin/billing-health` (read-only, super-admin).

**Críticos** (derrubam `ok=false` — investigar antes do go-live):

| Sinal | Significado |
|---|---|
| `faturas_sem_asaas_id` | reserva órfã **aberta** (cobrança local sem Asaas) |
| `faturas_abertas_sem_link` | cliente sem como pagar |
| `duplicidade` | mesma empresa/origem/período > 1 (nunca deveria ocorrer) |
| `suspensas_com_fatura_paga` | sinal do bug de reativação (deveria ser 0) |
| `webhook_com_erro` | eventos Asaas não processados |
| `categoria_incompativel` | autônomo em plano de empresa (ou vice-versa) |

**Informativos** (não derrubam `ok` — olho de operação, adicionados na mega-frente):

| Sinal | Significado |
|---|---|
| `vencidas` | inadimplência a acompanhar |
| `faturas_canceladas_sem_asaas_id` | órfãs já canceladas (inofensivas) |
| `suspensas_sem_fatura` | conta travada sem caminho de regularização |
| `empresa_sem_plano` | conta ativa/trial sem plano vinculado |
| `plano_inativo_ou_arquivado` | conta cobrável apontando p/ plano off (recorrência pula) |
| `trial_vencido_sem_fatura` | trial vencido ainda sem regularização (transitório) |
| `assinatura_asaas_ativa` | contas que o motor recorrente pula de propósito |
| `suspension_reason_inconsistente` | suspensa sem motivo registrado |

**Cron recorrente**: verificação da execução (esperada `0 6 1 * *`, 1ª em 01/08)
está documentada em [`RUNBOOK_GOLIVE_ASAAS.md`](RUNBOOK_GOLIVE_ASAAS.md) (seção de
verificação do cron) — conferir faturas criadas, webhooks recebidos e ausência de
duplicidade após cada rodada.

---

## 8. Checklist final de aplicação

- [ ] Tabela de preços final aprovada (`GOLIVE_PRECOS_MATRIZ.md` preenchida).
- [ ] Baseline salvo (planos, empresas, billing-health).
- [ ] `impacto-preco` conferido por plano — `preco_novo` bate com a tabela.
- [ ] `PUT` aplicado plano a plano; 409 confirmado conscientemente onde apareceu.
- [ ] Pós-validação: `billing-health.ok=true`, `total_pago`/`pagas` inalterados.
- [ ] Faturas emitidas conferidas: valor antigo preservado (snapshot).
- [ ] Sandbox validado antes de produção.
- [ ] Dinheiro real (Asaas production) **NÃO** ativado aqui — frente separada.
