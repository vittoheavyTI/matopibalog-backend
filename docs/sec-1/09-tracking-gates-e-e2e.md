# SEC-1 · 09 — Tracking Credential: Gates Externos, Matriz E2E e Pedido de Push

> Branch `fix/sec1-tracking-credential` · base `60e8f9e` (#414). **Não pushado, não mergeado,
> Gate B NÃO executado.** Este doc prepara os gates de CI e a validação E2E.

## 1. Gates externos (o que precisa rodar e onde)

| Gate | Workflow | Dispara por | Observação |
|---|---|---|---|
| Backend `node --test` | `backend-ci.yml` | `backend/**` | Já verde localmente (ver §3). |
| PG efêmero migration 064 | `pg-rpc-ci.yml` | `backend/migrations/**`, `backend/tests-pg/**` | Postgres 16 service container; aplica pré-bootstrap+060+061+062+**064** e roda `tests-pg/*.pgtest.mjs`. **Sem custo, isolado, destruído ao fim. Não toca Supabase.** |
| Flutter analyze + test | `app-ci.yml` | `app_android/**` | Flutter 3.44.0 / Java 21, runner efêmero. |
| Kotlin compile + APK **release** | `app-ci.yml` | `app_android/**` | `flutter build apk --release`; **sem keystore/signing real**; artefato `app-release-apk`. |

Todos são **somente CI**: nenhum faz deploy, publica loja, aplica migration em Supabase
compartilhado, muda flag de produção ou toca DNS/Pages. `pg-rpc-ci` e `backend-ci` têm
`permissions: contents: read`.

## 2. Matriz E2E (automatizado × manual)

| # | Cenário | Cobertura automatizada | Manual (device/Torre) |
|---|---|---|---|
| 1 | Iniciar viagem → scoped ativo | emissão (service/guard/Dart tri-state) | abrir app, iniciar viagem |
| 2 | App em background | — (comportamento do ForegroundService) | ✔ roteiro |
| 3 | Access UI expira, GPS continua | `trackingCredentialService` §23 + `trackingGuard` §23 (HTTP) | ✔ confirmar na Torre |
| 4 | Torre recebe pontos | persistência canônica (registrarSessao) | ✔ olhar Torre |
| 5 | Tracking credential expira → renew | `renovar` rotação CAS + Kotlin RENEW | ✔ (TTL longo → difícil manual) |
| 6 | GPS continua após renew | `validar` token B após rotação | ✔ |
| 7 | Offline atravessa expires_at → reconecta → renova → fila íntegra | `flushQueue` drain+requeue + RENEW; service renew pós-expiração | ✔ roteiro (avião/túnel) |
| 8 | Logout interrompe | `revogarDaSessao` + `session_revoked` canônico | ✔ |
| 9 | Fim da viagem interrompe | `trip_inactive` canônico + `revogarDoFrete` | ✔ |
| 10 | Device errado rejeita | domain/service/guard `device_mismatch` | — |
| 11 | Viagem errada rejeita | domain/service `trip_mismatch`; telemetria escopada ao frete | — |
| 12 | Além do teto absoluto → exige nova emissão (não usa access token) | service `max_lifetime`; Kotlin para+preserva fila | ✔ |

**Roteiro manual final** (device Android release + Torre): executar 1→12, confirmando na
Torre a chegada de pontos em 3/4/6, a parada em 8/9/12, e a fila sincronizada em 7. Nenhum
logout espontâneo; nenhum ponto após encerramento.

## 3. Estado local dos gates (2026-08-10)

- **Backend:** `node --test` = **PASS** (reproduzido; ver relatório). `node --check` limpo em
  todos os módulos alterados.
- **PG 064:** **não executável localmente** (sem Docker/psql). `node --check` OK; skip verificado.
  → depende de `pg-rpc-ci`.
- **Flutter/Kotlin:** **não executável localmente** (Flutter fora do PATH). Revisão manual feita;
  **compilação NÃO-PROVADA** até `app-ci`.

## 4. Pedido de GATE DE PUSH (aguarda autorização explícita)

- **Branch a publicar:** `fix/sec1-tracking-credential` (2 commits sobre `60e8f9e`:
  `51a7cea` + `e0dec8a` + o commit de hardening de concorrência).
- **Remote:** `origin` (repositório `vittoheavyTI/matopibalog-backend`). Sem upstream ainda.
- **Comando previsto:** `git push -u origin fix/sec1-tracking-credential` (feature branch;
  **NÃO** `main`).
- **Workflows disparados pelo push da branch:** nenhum — os workflows rodam em `pull_request`
  para `main` e `push` para `main`/`workflow_dispatch`. Um **push de branch** (sem PR) **não**
  dispara `backend-ci`/`app-ci`/`pg-rpc-ci` automaticamente. Para rodá-los sem abrir PR:
  usar **`workflow_dispatch`** em cada workflow apontando para a branch.
- **Alternativa (se quiser CI automático):** abrir um **PR draft** da branch para `main` —
  isso dispara os 3 workflows por `pull_request`. **Não** mergeia nada; é só para o CI.
- **Garantias:** nenhum passo faz deploy (Railway só redeploya em `push` para `main`),
  nenhum aplica migration em Supabase, nenhum muda flag de produção. APK é `--release` sem
  signing real, **não publicado**.

**Opções para você decidir:**
1. `git push -u origin fix/sec1-tracking-credential` **+ `workflow_dispatch`** dos 3 workflows na branch (CI puro, sem PR).
2. `git push` **+ PR draft** para `main` (CI automático via `pull_request`, sem merge).
3. Não pushar ainda.

Após autorização, assumo: push → acompanhar `app-ci`/`pg-rpc-ci` → corrigir falhas → re-push →
até PASS de PG 064 / analyze / test / Kotlin compile / APK release, ou hard stop externo real.
Registrarei do APK: source SHA, run, artifact ID, nome, bytes, **SHA-256**.
