# Matopiba Log — FORENSIC BASELINE V9 (RBV9-2)

> Auditoria forense **read-only** do estado real, com evidências verificadas na sessão de **2026-08-19**.
> Documento detalhado — não precisa ser lido inteiro em todo chat. Para retomada rápida use o [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md).
> Nenhum código funcional, migration, dado, env, RLS ou storage foi alterado nesta macrofrente.

---

## 0. Fatos-âncora (verificados nesta sessão)

| Fato | Valor | Como foi verificado |
|------|-------|---------------------|
| `origin/main` HEAD | `2c36450ba8efaae0dd24f0ca533cf571d20e8841` — "Merge PR #432: copy fatura real production + valor pt-BR (F5B-2)", 2026-08-18 | `git fetch` + `git log origin/main` |
| Deploy produção (backend) | Railway service `matopibalog-backend`, deployment `2ff32276` **SUCCESS** (2026-08-19T00:23Z) | Railway `get-status` |
| Health produção | **HTTP 200** `{"status":"UP"}` em `https://api.matopibalog.com.br/health` (2026-08-19T11:22Z) | `curl` |
| Backend hosting | Railway (projeto `scintillating-magic` `672ab820…`), domínios `api.matopibalog.com.br` + `matopibalog-backend-production.up.railway.app` | Railway `list-domains` |
| Frontend hosting | GitHub Pages → `matopibalog.com.br` (DNS Hostinger) | CLAUDE.md + workflow `static.yml` |
| Banco | Supabase `rjahjogidyndphdxevom` (sa-east-1), PostgreSQL **17.6**, `ACTIVE_HEALTHY`, **62 tabelas públicas** | Supabase `list_projects`/`list_tables` |
| Repositório | monorepo `vittoheavyTI/matopibalog-backend` (backend + painel_web + app_android + database + firebase_backend + docs) | worktree |

### Dimensionamento do código (em `origin/main`)

| Camada | Métrica |
|--------|---------|
| Backend | 21 controllers · 21 routes · 54 arquivos de service · 3 jobs · **148** testes `*.test.js` · 14 testes-pg |
| Migrations (repo) | 59 arquivos `011 → 069` (gaps de numeração: 063; ver §7) |
| Frontend web | 36 páginas `.tsx` (+7 de teste) · 22 componentes |
| App Flutter | 19 telas · 7 services |
| CI (GitHub Actions) | 10 workflows |

---

## 1. Estado de segurança do Billing / Asaas (precedência #1 — produção)

**Confirmado DESARMADO** (env names via Railway OAuth — valores redigidos; contagens via SQL):

| Variável / fato | Estado verificado |
|-----------------|-------------------|
| `ASAAS_API_KEY` | **AUSENTE** da lista de env names do serviço backend ✅ |
| `ASAAS_WEBHOOK_TOKEN` | Presente ✅ |
| `BILLING_PROVIDER_MODE` | Presente (valor redigido; memória = `fake`) |
| `BILLING_PRODUCTION_ENABLED` | Presente (memória = `false`) |
| `BILLING_PRODUCTION_ALLOWLIST` | Presente (memória = vazia) |
| `BILLING_OUTBOX_ENABLED` | Presente (memória = `false`) |
| `billing_outbox` (linhas) | **0** ✅ |
| `faturas` com status `pago` | 6 |

Gate efetivo: `PRODUCTION_DISABLED`. Primeiro pagamento real (histórico, já reconciliado e desarmado): customer `cus_000194574257`, charge `pay_moeewnn1bslsyg9c` (R$5,00 PIX, RECEIVED), fatura local `3929afb5-…` = pago, webhook `PAYMENT_RECEIVED` processado. **Não tocar sem nova autorização** (`FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`).

**Crons Railway (3, todos SUCCESS, todos inertes/dry-run por design):**
- `vivacious-flow` — `0 6 1 * *` (gerarFaturasRecorrentes)
- `radiant-warmth` — `0 9 * * *` (expirarTrials, fixado `--dry-run`)
- `cron-notificacao-inadimplencia` — `0 8 * * *` (notificarInadimplencia, `--dry-run`)

---

## 2. Banco de dados — o que existe (autoridade sobre o repo)

**Domínios COM lastro em banco (tabelas + linhas reais):**

- **Operacional núcleo:** `usuarios`(38), `motoristas`(18), `fretes`(63), `despesas`(98), `abastecimentos`(46), `vales`(18), `empresas`(34), `configuracoes`(1).
- **Documentos:** `frete_documentos`(16); `documentos`(0, legado vazio).
- **ePOD/Ocorrências:** `frete_epod`(1), `frete_epod_evidencias`(10), `frete_ocorrencias`(1), `frete_ocorrencia_evidencias`(0).
- **Rastreamento leve:** `frete_localizacoes`(**964**), `frete_ultima_localizacao`(3), `frete_localizacao_estado`(3), `frete_localizacao_retencao`(0).
- **SEC-1 auth:** `auth_sessions`(54), `auth_refresh_tokens`(112), `auth_event_audit`(128); credencial GPS escopada `frete_tracking_credenciais`(30) + `frete_tracking_credencial_fretes`(52).
- **Comercial/Contratos:** `planos`(9), `faturas`(25), `propostas_comerciais`(8), `contratos_comerciais`(8), `contrato_signatarios`(16), `contrato_eventos`(27), `contrato_modelos`(8), `contrato_assinatura_desafios`(5), `modelo_contratos`(1, legado), `contratos`(0, legado).
- **Entitlements:** `funcionalidades`(21), `plano_funcionalidades`(111), `empresa_funcionalidades`(0), `funcionalidade_dependencias`(0), `funcionalidade_auditoria`(1).
- **Asaas/Billing:** `asaas_webhook_events`(46), `asaas_sync_estado`(5), `asaas_sync_tentativas`(9), `asaas_subscriptions` (via 022), `billing_outbox`(0), `solicitacoes_upgrade_plano`(1).
- **Promoções:** `promocoes`(1), `promocao_codigos`(2), `promocao_resgates`(0).
- **Auditoria financeira:** `fretes_correcoes_auditoria`(5), `faturas_correcoes_auditoria`(4), `fretes_financeiro_auditoria`(0).
- **Termos/LGPD:** `termos`(4), `termos_aceites`(22).
- **P1 escopo operacional (migration 067):** `grupos_empresariais`(0), `grupo_empresarial_empresas`(0), `unidades_operacionais`(0), `regioes_operacionais`(0), `regiao_operacional_unidades`(0), `usuario_operacional_memberships`(0), `operational_scope_auditoria`(0).

**Domínios SEM QUALQUER lastro em banco (verificado — 0 tabelas):**

- **FROTA / VEÍCULOS / COMPOSIÇÕES / PNEUS / MANUTENÇÃO / ODÔMETRO como entidade** — `fleet_tables = 0`.
- **ERP / Integration Hub** — 0 tabelas.
- **SSO / Entra ID / AD / OIDC / SCIM** — 0 tabelas, 0 env vars de identidade externa.
- **Dispatch / oferta / disponibilidade** — 0 tabelas.
- **Embarcador / Portal / Rede de parceiros / Cotação** — 0 tabelas.
- **Planejamento/aprovação de frete (oportunidade → aprovação → designação)** — 0 tabelas.
- **Route Intelligence / pedágio / combustível previsto** — 0 tabelas.

---

## 3. Camadas — observações forenses por área

### 3.1 Backend (Node/Express)
- 54 arquivos de service; forte concentração em **billing/comercial** (Asaas, contratação, upgrade, promoções, entitlements, situação comercial). Domínio operacional (frete/despesa/vale/abastecimento) é mais fino e legado.
- `impressoras.js` mantido como **stubs inócuos** (RCE removido — decisão histórica de segurança). OK.
- Webhook Asaas usa **token fixo no header** (`asaas-access-token`), **não HMAC** — decisão histórica documentada; aceitável para o provider, registrar como característica.

### 3.2 Frontend web (React 19 + Vite + Tailwind 4)
- **Realtime = polling.** Grep confirma `setInterval`/polling em `NotificacoesDropdown`, `useCarregamento`, `SessionTimeoutWatcher`, `GerenciamentoViagens`, `TorreControle`, `MinhasFaturas`, etc. **Nenhuma** assinatura Supabase Realtime / WebSocket / SSE encontrada. → Causa-raiz do gap **D-017** (lançamentos não propagam sem refresh). É **TECH_DEBT/ARQ**, não bug isolado.
- 36 páginas cobrindo cliente (Dashboard, GerenciamentoViagens, Motoristas, Relatorios, Rentabilidade, AcertoMotoristas, MinhasFaturas, TorreControle, Operacional) e super-admin (Painel*: Empresas, Planos, Billing, Financeiro, Contratos, Assinaturas, Funcionalidades, Promocoes, Usuarios, VisaoGeral, Relatorios, Notificacoes, TermosLGPD).
- **Mistura de domínios financeiros (D-035):** coexistem `PainelFinanceiro` (SaaS) e `Rentabilidade`/`AcertoMotoristas` (operacional do cliente). Separação lógica existe por página, mas precisa de auditoria fina de KPIs/services na Onda 1.

### 3.3 App Flutter
- 19 telas **motorista-centric** (add_frete, add_despesa, add_vale, add_abastecimento, detalhe_viagem, historico, situacao_comercial, minhas_faturas). Alinha-se ao modelo atual, mas **conflita com D-001/D-002** (frota-centric) — exigirá evolução de UX na Onda 2/3.
- Auth por **Bearer token** (cookie httpOnly não serve app). SEC-1 integrado (credencial GPS escopada validada em device — histórico).
- Scanner de documentos portado (PR #347) — falta paridade com o alvo de scanner avançado (crop/perspectiva/multipágina/OCR) descrito no prompt §16.

### 3.4 Supabase / RLS / Storage
- **RLS habilitado em 100% das 62 tabelas públicas** listadas. Tabelas backend-only (auth_*, contrato_assinatura_desafios, credenciais) documentam modelo "sem GRANT direto a authenticated". Bom sinal.
- Storage: buckets de evidências (`fretes-evidencias`) e contratação (histórico). Não auditado byte-a-byte nesta macrofrente.
- **Advisors de segurança/performance NÃO foram coletados nesta sessão** — ver TECH_DEBT TD-06.

### 3.5 CI (10 workflows)
`app-ci`, `backend-ci`, `frontend-ci`, `flutter-ci`, `billing-3a2-ci`, `billing-3a2-sandbox`, `p1-operational-scope-ci`, `pg-rpc-ci`, `sec1-e2e-browser`, `static`.
- `sec1-e2e-browser` é **flaky** (histórico: race no refresh, `parameter $5`) — TECH_DEBT.

---

## 4. Achados classificados

### BLOCKERS
_Nenhum BLOCKER de produção identificado nesta auditoria read-only._ (Produção UP, Asaas desarmado, RLS ligado, billing_outbox=0.)

### HIGHS
| ID | Achado | Evidência | Nota |
|----|--------|-----------|------|
| H-01 | Ausência total de domínio **Frota/Veículo/Composição/Pneu/Manutenção** — base para toda a direção V9 (D-001..D-005). | 0 tabelas; handoff V8 marca "Frota e Documentos" como próxima. | Não é defeito; é o maior gap estrutural. Onda 2. |
| H-02 | **Realtime inexistente** (só polling). Requisito sistêmico D-017/D-027. | Grep web sem WebSocket/Supabase channel. | Onda 1. |
| H-03 | App **motorista-centric** vs decisão **frota-centric**; sem check-in/check-out formal (KM/foto no formulário atual). | 19 telas; D-011. | Onda 1/2. |

### MEDIUMS
| ID | Achado | Nota |
|----|--------|------|
| M-01 | Mistura potencial de KPIs financeiro SaaS × operacional (D-035) a auditar por service. | Onda 1. |
| M-02 | Lançamentos ainda não são formalmente **append/audit-safe** com estados `pendente/aprovado/rejeitado/cancelado+motivo` (D-019) em todas as entidades. | Onda 1. |
| M-03 | P1 (grupos/filiais/escopo) implementado mas **inerte** (0 linhas, enforcement desativado). Fundação existe; falta ativar sob gate. | Onda 1/2. |
| M-04 | Entitlements `empresa_funcionalidades` = 0 linhas: overrides por empresa existem em schema mas sem uso real ainda. | Onda 1. |
| M-05 | Scanner do app aquém do alvo (crop/perspectiva/multipágina/OCR). | Onda 1. |

### LOWS
| ID | Achado | Nota |
|----|--------|------|
| L-01 | Gap de numeração de migration **063** (inexistente em repo e em `schema_migrations`). Cosmético. | — |
| L-02 | Migration **068** (RPC `iniciar_aquisicao_comercial_v2`) **não consta em `schema_migrations`**, porém a **RPC existe em produção** (verificado). Discrepância de tracking, não funcional. | Registrar. |
| L-03 | `documentos`(0), `modelo_contratos`(1), `contratos`(0) = tabelas **legado** superadas por `frete_documentos` e `contratos_comerciais`/`contrato_modelos`. | Limpeza futura. |
| L-04 | `CLAUDE.md` "Estado atual" datado 2026-06-07 — desatualizado vs realidade (billing/SEC-1/3A). | Doc drift. |

### TECH_DEBT
| ID | Item |
|----|------|
| TD-01 | `sec1-e2e-browser` flaky (race refresh). |
| TD-02 | Realtime por polling (custo de requests + latência). |
| TD-03 | App Flutter: scanner avançado, viewer PDF-first, paridade de campos com painel. |
| TD-04 | SQLs versionados antigos (`001_create_tables`, `full_setup`) desatualizados vs produção (conferir sempre o banco). |
| TD-05 | Worktrees locais: ~450 branches e dezenas de worktrees no ambiente do dev (higiene de repositório local). |
| TD-06 | Supabase **security/performance advisors** não coletados — executar leitura na Onda 0/1. |
| TD-07 | Smoke autenticado automatizado ausente (falta conta smoke) — herdado da Fatia 2. |

---

## 5. Documentação histórica relevante (fontes reconstruídas)

`docs/ARQUITETURA_OPERACIONAL_V8_HANDOFF.md` (baseline anterior — superada por esta V9), `ARQUITETURA_MACROFRENTES.md`, `ARQUITETURA_OPERACIONAL_3A1.md`, `ARQUITETURA_OPERACIONAL_3A2_BILLING.md`, `REALTIME_PROPOSTA.md`, `BILLING_PRODUCTION_AUTHORITY_MAP.md`, `GATE_3A1.md`, `MODELO_COBRANCA.md`, runbooks de golive/Asaas, `docs/sec-1/*`. O índice de memória do agente (`MEMORY.md`) reconstrói o backlog frente a frente (Billing v2 → 3A → SEC-1 → P1 → Asaas F0–F5D).

---

## 6. Reconciliação com a memória (correções)

- ✅ **069 aplicada** em produção (`20260816191747`) — confirma a correção da nota antiga "069 code-only".
- ✅ **Asaas desarmado** conforme F5D (`ASAAS_API_KEY` ausente; billing_outbox=0).
- ✅ **Deploy `2ff32276`** é o runtime atual (F5D), sobre `origin/main = 2c36450` (#432).
- ⚠️ **068** não rastreada em `schema_migrations` embora a RPC exista (L-02) — investigar tracking na Onda 0.

---

## 7. Migrations (repo) — sequência

`011..062, 064..069` presentes no repo (59 arquivos). **063 ausente** (nunca existiu). Aplicadas em produção conforme `schema_migrations` (topo: 069, 067, 066, 065, 064, 062, 061, 060, 059, 058, 057, 056, 055, 054…). RPC `iniciar_aquisicao_comercial_v2` viva (conteúdo da 068).

---

_Ver: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [DECISIONS](./DECISIONS.md) · [MASTER_LEDGER](./MASTER_LEDGER.md) · [ROADMAP](./ROADMAP.md)_
