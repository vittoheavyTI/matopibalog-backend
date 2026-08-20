# Matopiba Log — CONTEXT BRIDGE V9

> **Handoff compacto.** Leia este arquivo primeiro ao retomar em outro chat/agente. Os detalhes estão nos 4 documentos linkados no fim.
> Atualizado: **2026-08-19** (macrofrente RBV9, docs-only).

---

## O que é

**Matopiba Log** — SaaS de gestão de transportadoras (transportadoras, fazendas com frota própria, caminhoneiros autônomos). Monorepo `vittoheavyTI/matopibalog-backend`:
- **Backend:** Node.js + Express (`backend/`) — Railway
- **Web:** React 19 + Vite + Tailwind 4 (`painel_web/`) — GitHub Pages
- **App:** Flutter (`app_android/`)
- **Banco/Auth:** Supabase PostgreSQL 17

## Estado atual (verificado)

| | |
|---|---|
| `origin/main` | **`f43f009`** (PR #435 / Onda 1 — realtime SSE + lançamentos audit-safe, migration 070 aplicada). Marcos anteriores: `6c3cc4e` (RBV9+fiscal, PRs #433/#434), `2c36450` (PR #432 / F5B-2). |
| Deploy produção | Railway `matopibalog-backend` deploy `2ff32276` **SUCCESS** |
| Health | **HTTP 200** `{"status":"UP"}` em `https://api.matopibalog.com.br/health` |
| Banco | Supabase `rjahjogidyndphdxevom` · 62 tabelas públicas · RLS 100% |
| Asaas | **DESARMADO**: sem `ASAAS_API_KEY`, provider=fake, production=false, allowlist vazia, outbox=false, `billing_outbox`=0. **Não reativar sem autorização.** |
| Crons | 3 (faturas mensal, expirarTrials dry-run, inadimplência dry-run) — todos SUCCESS/inertes |

## Direção do produto (congelada em DECISIONS.md)

Matopiba vira **frota/operação-centric** (D-001): o eixo é o **veículo/composição** (D-002/D-003), motorista tem **vínculo temporal**. Frota/pneus/manutenção, planejamento+dispatch de frete, Route Intelligence, Portal do Embarcador, rede de parceiros, ERP Integration Hub e SSO/Entra ID são a expansão. Realtime e performance são requisitos **sistêmicos**. Financeiro operacional do cliente é **separado** do financeiro SaaS. Nenhum backlog desaparece (`DEFERRED ≠ DONE`).

## O que existe vs o que é novo (resumo)

- **Maduro/vivo (REUSE_AS_IS):** auth/SEC-1, entitlements por plano, SaaS billing/Asaas/contratos/promoções, ePOD/ocorrências, rastreamento leve, notificações/push, relatórios PDF com branding.
- **Refatorar/ativar:** lançamentos (audit-safe + realtime), separação financeira, ORG_SCOPE (grupos/filiais existem mas **inertes, 0 dados**), permissões (templates+overrides), auditoria unificada.
- **NEW (0 no banco):** **Frota/Veículos/Composições/Pneus/Manutenção**, Planejamento/Dispatch, Route Intelligence, Embarcador/Parceiros/Marketplace, ERP Hub, SSO/Entra.

## Macrofrente atual

**`CURRENT_MACROFRONT = ONDA1_REALTIME_LANCAMENTOS_AUDIT_SAFE`.**

A **RBV9 — Rebaseline V9** (docs-only) está **concluída** e inclui o **patch fiscal V9** (domínio `FISCAL_INVOICING`, decisões D-036..D-041, ledger FISC-001..020, track NFS-e). **Nenhum código/dado/env de produção alterado por estes docs.** A próxima macrofrente **funcional** é a **Onda 1 — Realtime + Lançamentos audit-safe**.

### Nota fiscal (não bloqueante)

Adequação de **CNAE/CNPJ/regime** do owner corre **em paralelo** e **NÃO bloqueia** o desenvolvimento técnico (`CNAE_BLOCKS_TECH_DEVELOPMENT=false`; `FISCAL_TECH_BUILD_ALLOWED=true`). O que fica bloqueado é a **emissão fiscal real** e o **go-live comercial pago** — gates `FISCAL_LEGAL_ENTITY_GATE` e `COMMERCIAL_PAID_GO_LIVE_GATE`. Entidade jurídica atual = **provisória**; troca futura = **cutover** (D-041). Certificado = `DEFERRED`.

## Como retomar em outro chat

1. Leia este arquivo + [DECISIONS](./DECISIONS.md).
2. Para o backlog completo com IDs estáveis → [MASTER_LEDGER](./MASTER_LEDGER.md) (`RBV9-INV-NNN`).
3. Para o plano de execução → [ROADMAP](./ROADMAP.md) (ondas, arquitetura-alvo, gap analysis, gates).
4. Para evidências detalhadas do estado real → [FORENSIC_BASELINE](./FORENSIC_BASELINE.md).
5. **Antes de implementar:** confirmar precedência (produção real > banco > repo/main > deploy > testes > docs). Verificar que algo "está implementado" no banco/deploy, não só no doc.

## Estado da Onda 1 (macrofrente atual)

**Onda 1 · Realtime + Lançamentos audit-safe — IMPLANTADA EM PRODUÇÃO (E1.6A incluída), aguardando validação visual do owner.** `STATUS = ONDA1_REALTIME_LANCAMENTOS_DEPLOYED_AWAITING_OWNER_VISUAL_VALIDATION`. PR #435 **MERGEADO** (`MERGE_SHA=f43f009`; base 4fe8e62). **Migration 070 APLICADA e RASTREADA** em produção (`schema_migrations`: `20260820033844 070_lancamentos_audit_safe_realtime`) via mecanismo canônico (`apply_migration`) — **0 escrita de dado de negócio** (PRE=POST: despesas 98 / abastecimentos 46 / vales 18; `lancamento_eventos`=0). Deploy backend Railway SUCCESS (`f43f009`, health 200, SSE anon 401, `/realtime/stats` anon 401, CORS preflight aceita `X-Client-Platform`, logs sem erro novo, `numReplicas=1`). Frontend GitHub Pages SUCCESS (bundle novo). App: código pronto/CI verde; sem pipeline de loja (compat legada preserva o APK antigo). Asaas inerte (nenhuma mudança de env).

**E1.6A (release safety, sem reabrir auditoria):** (1) **compat do APK legado** — observação/descrição obrigatória só para clientes NOVOS (header `X-Client-Platform`); legado não é quebrado (RBV9-INV-108, DEFERRED_REMOVAL). (2) **SSE connection safety** — limites por usuário/empresa + release no disconnect + `/realtime/stats` (super-admin). (3) **single-instance confirmado** no Railway (`numReplicas=1`) → bus in-memory permitido no escopo atual (RBV9-INV-107). (4) mutation coverage: creates/updates/transições publicam SSE; delete administrativo em cascata = recovery por refetch. Evento é invalidação (refetch canônico), nunca reverte a UI.

## Próximo passo recomendado

Após o migration gate da Onda 1: **Permissões (templates editáveis por empresa + overrides individuais)** — RBV9-INV-018, D-006/D-008/D-010; transversal, destrava dashboards por papel (D-007) e check-in/out (Onda 2). Ver ROADMAP §ONDA 1 (E1.5) e §Primeira macrofrente.

## Hard stops permanentes

Não reativar Asaas production, não escrever em produção, não ativar enforcement de escopo, não migrar infra — cada um tem gate próprio (ver DECISIONS §Gates). Este handoff não autoriza nenhuma dessas ações.

---

**Documentos canônicos V9:** [DECISIONS](./DECISIONS.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [ROADMAP](./ROADMAP.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)
