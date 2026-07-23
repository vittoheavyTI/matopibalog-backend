# Go-live — Matriz de Decisão de Preços (para o responsável preencher)

> Documento de DECISÃO. Nenhum preço é alterado por este arquivo. A alteração de
> preço em produção é ação de produto do responsável, com confirmação explícita
> (o backend já exige confirmação 409 em plano já utilizado — ver §4).
>
> Estado: **preços comerciais PENDENTES de decisão** — enquanto não decididos, o
> go-live NÃO está pronto. Base: auditoria 2026-07-23.
>
> Docs relacionadas (mega-frente go-live):
> - Referência técnica do modelo: [`MODELO_COBRANCA.md`](MODELO_COBRANCA.md).
> - Como aplicar com segurança (preview → 409 → validar → rollback):
>   [`RUNBOOK_APLICACAO_PRECOS.md`](RUNBOOK_APLICACAO_PRECOS.md).
> - Dinheiro real (frente separada): [`RUNBOOK_GOLIVE_ASAAS.md`](RUNBOOK_GOLIVE_ASAAS.md).

## 1. Catálogo atual (valores de trabalho / placeholder)

| Plano | Categoria | Ativo | Modelo | Preço | Limite motoristas | Trial | Empresas |
|-------|-----------|-------|--------|-------|-------------------|-------|----------|
| Plano Básico Autônomo | autonomo | sim | fixo | R$ 149,99 | 1 | 7d | ~15 |
| Plano Básico | empresa | sim | fixo | R$ 149,90 | 5 | 7d | ~10 |
| Plano Profissional | empresa | sim | fixo | R$ 149,99 | 10 | 15d | ~2 |
| Plano Enterprise | empresa | sim | fixo | R$ 199,90 | 999 | 14d | 0 |
| Free Teste | ambos | **não** | fixo | R$ 0,00 | 2 | 7d | 0 |

> Contagens de empresas são majoritariamente contas de teste — não há cliente
> real pagante ainda (base 100% pré-produção).

## 2. Inconsistências da escada atual (por que precisa decisão)

1. **Escada achatada**: Básico (5 motoristas) R$ 149,90 vs Profissional (10) R$ 149,99 — **9 centavos** para o dobro da capacidade.
2. **Inversão autônomo × empresa**: Autônomo (1 motorista) R$ 149,99 > Básico empresa (5) R$ 149,90.
3. **Enterprise subprecificado**: motoristas ~ilimitados (999) por só R$ 50 acima do Profissional.

## 3. O que o sistema suporta (para embasar o modelo)

- **`fixo`**: `preco_mensal` é o valor digitado. ✓
- **`por_motorista`**: `preco_mensal = preco_por_motorista × limite_motoristas`
  (o backend é a autoridade; ignora `preco_mensal` mentiroso do cliente). ✓
- **Snapshot em faturas** (migration 030): fatura paga congela o preço — mudança
  de plano **não** altera faturas passadas; só recorrência/regularização futuras
  usam o novo valor. ✓
- **Confirmação 409** em plano já utilizado (§4). ✓

### ⚠️ Esclarecimento "por caminhão"
- **NÃO existe registro de veículos/frota** no sistema (nenhuma tabela
  `veiculos`/`caminhoes`/`frota`). O que existe é `motoristas` + `limite_motoristas`.
- Se **"por caminhão" = quantidade contratada** (slots fixos no plano): já é
  suportado hoje via `por_motorista` — é só o rótulo. O valor é por
  **capacidade contratada**, não por uso real.
- Se **"por caminhão" = frota física cadastrada** (contagem dinâmica de veículos
  reais da empresa): **NÃO é suportado** — exige nova frente (registro de veículos
  + hook de billing por contagem). Decidir antes de prometer esse modelo.

## 4. Como a alteração será aplicada (quando você decidir)

`PUT /painel-admin/planos/:id` com o novo preço:
- Plano **não** utilizado → aplica direto.
- Plano **já utilizado** → retorna **409** com o diff (preço atual → novo +
  nº de empresas afetadas). Só aplica com a flag de confirmação. **É a trava que
  garante que preço não muda por acidente.** (Frente #4 de billing, testada.)

Impacto é **forward-only**: nenhuma fatura paga muda.

### 4.1 Simular ANTES de aplicar (preview read-only)

`GET /painel-admin/planos/:id/impacto-preco?novo_preco=...` (super-admin, não grava)
mostra `preco_atual → preco_novo`, `empresas_afetadas`, `faturas_abertas` (não mudam),
`proximas_recorrencias` (usarão o valor novo) e um `aviso_snapshot`. Use para
conferir o valor derivado e o alcance antes do `PUT`. Passo a passo em
[`RUNBOOK_APLICACAO_PRECOS.md`](RUNBOOK_APLICACAO_PRECOS.md) §2–§3.

### 4.2 "O que acontece se eu mudar o preço agora?" (resumo)

| Pergunta | Resposta |
|---|---|
| Faturas **já pagas**? | Nada muda. `total_pago` e `pagas` no billing-health ficam iguais. |
| Faturas **abertas** (pendente/vencido)? | Não mudam — valor congelado no snapshot da fatura. O cliente paga o valor antigo. |
| **Recorrência do próximo mês**? | Passa a usar o valor novo (só contas ativas sem assinatura Asaas). |
| Assinatura Asaas já criada? | Segue cobrando o valor antigo até a frente futura de sincronização. |
| Como **validar**? | `billing-health.ok=true` + `total_pago` inalterado; conferir uma empresa afetada. |
| Como **rollback**? | Reaplicar o preço antigo (mesmo `PUT`, forward-only). |

## 5. Matriz para preencher (proposta de escada coerente — ajuste os números)

| Plano | Preço ATUAL | Preço NOVO (você) | Modelo NOVO | Limite | Racional |
|-------|-------------|-------------------|-------------|--------|----------|
| Autônomo | R$ 149,99 | __________ | fixo/por_motorista | 1 | piso; 1 motorista |
| Básico | R$ 149,90 | __________ | fixo/por_motorista | 5 | pequena frota |
| Profissional | R$ 149,99 | __________ | fixo/por_motorista | 10 | salto real de capacidade |
| Enterprise | R$ 199,90 | __________ | fixo/por_motorista | 999/def. | prêmio de valor |
| Free Teste | R$ 0,00 | manter inativo? | — | — | armadilha/placeholder |

**Decisões abertas:**
- [ ] Preços finais por plano.
- [ ] Modelo por plano (fixo vs por_motorista).
- [ ] Limites finais (principalmente Enterprise: manter 999 ou definir teto?).
- [ ] "Por caminhão" = quantidade contratada (ok hoje) ou frota física (nova frente)?
- [ ] Free Teste: manter inativo / arquivar?
- [ ] Trial padrão por plano.

## 6. Próximo passo
Preencher a coluna "Preço NOVO" (§5) e as decisões (§5). Com isso, o time prepara
o `PUT /planos` por plano, revisa o diff 409 e aplica com confirmação — parando
antes da aplicação em produção para aprovação final.
