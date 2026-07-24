# Runbook — Higiene das assinaturas Asaas SANDBOX (opcional)

> Documento operacional. Ler inteiro antes de agir. **Não cancela nada** — descreve
> o procedimento caso o responsável decida limpar assinaturas sandbox legadas.
>
> 🔴 **Cancelar assinatura no Asaas (mesmo sandbox) é hard stop**: exige autorização
> explícita do responsável. Arquivar a empresa no Matopiba **NÃO** cancela a
> assinatura no Asaas — são coisas independentes.
>
> Base: mega-frente de higiene operacional, 2026-07-24.

---

## 1. O que existe hoje (sandbox)

Duas assinaturas Asaas **sandbox** conhecidas, ambas em contas **KEEPER**:

| Empresa | Papel | Assinatura sandbox |
|---|---|---|
| INFRA TRANSP TESTE | keeper (teste) | ativa |
| MATOPIBA ASSINATURA SANDBOX 01 | keeper (E2E) | ativa |

O `billing-health` mostra `assinatura_asaas_ativa=2` — é **informativo**, não um problema.
O motor de recorrência **pula** contas com `asaas_subscription_id` de propósito
(a própria assinatura cobraria), então elas não geram fatura recorrente duplicada.

## 2. Recomendação

**Manter as duas.** Fazem parte da estratégia de teste/E2E sandbox validada. Não
há custo real (sandbox não cobra dinheiro). Cancelá-las removeria cobertura de teste.

Só considere cancelar se o responsável decidir aposentar esses cenários de teste.

## 3. SE decidir limpar (com autorização explícita)

Pré-condição: são KEEPERS — confirme com o responsável que os cenários de teste
podem ser aposentados. Não é limpeza de rotina.

Passos (por assinatura):
1. **Baseline**: `GET /painel-admin/billing-health` (guardar `assinatura_asaas_ativa`
   e o gate de faturas) + listar as faturas locais da empresa.
2. **Confirmar sandbox**: `configuracoes.dados.integracao_asaas.environment === 'sandbox'`.
   Nunca rode isto em production.
3. **Cancelar no Asaas** via painel/API autorizada (endpoint sandbox), 1 por vez.
   Isto é ação no Asaas — 🔴 hard stop, autorização explícita.
4. **Reconciliar local**: limpar `empresas.asaas_subscription_id` da empresa
   (UPDATE — hard stop de SQL, script à parte) para o billing-health refletir.
5. **Validar**:
   - `assinatura_asaas_ativa` caiu no billing-health;
   - **faturas locais NÃO quebraram** (as já emitidas seguem com seu snapshot/valor);
   - `ok` continua `true`, gate financeiro inalterado.

## 4. Relação com o arquivamento de empresas

Arquivar uma empresa (migration 037 / painel) é **independente** da assinatura Asaas:
- arquivar **não** cancela a assinatura;
- por isso o script 037 **exclui do arquivamento automático** qualquer candidato
  com `asaas_subscription_id` (Bloco C, hard stop) — para não deixar uma assinatura
  órfã apontando para uma conta fora da operação.

Como as duas assinaturas sandbox estão em **keepers**, elas não entram no
arquivamento de qualquer forma.

## 5. Resumo

- Estado atual: 2 assinaturas sandbox em keepers → **manter** (recomendado).
- Cancelar = decisão de produto + hard stop (Asaas + SQL).
- Arquivar empresa ≠ cancelar assinatura.
- Nada a fazer nesta frente sem autorização explícita.
