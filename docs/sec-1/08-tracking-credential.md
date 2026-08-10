# SEC-1 · 08 — Credencial Operacional Escopada de Rastreamento (GPS / Torre de Controle)

> **Status:** implementado em branch temporária isolada `fix/sec1-tracking-credential`
> (base = HEAD do #414, `60e8f9e`). **NÃO deployado, NÃO mergeado. Gate B NÃO executado.**
> Rollout **Compatível**: feature flag `TRACKING_SCOPED_CREDENTIAL_ENABLED` **default OFF**.

## 1. Problema (blocker do Gate B)

O serviço nativo Android (`LocationTrackingService.kt`) recebia **um snapshot único** do
*access token* de usuário no `onStartCommand` (`EXTRA_TOKEN`) e o mantinha em memória
para sempre. Quando o access token expirava/rotacionava (SEC-1: access curto + refresh
rotativo), o serviço **não recebia o novo token**; o endpoint de localização respondia
`401`; e o serviço executava `stopSelf()`. Resultado: **a Torre de Controle parava de
receber pontos** durante a viagem.

Auditoria (Codex) confirmou:
`gps_access_token_rotates=false`, `native_service_receives_new_token=false`,
`native_service_can_refresh=false`, `tracking_survives_access_expiry=false`.

## 2. Root cause

O serviço nativo usava a **autenticação de UI/usuário** (access token) como credencial
operacional de telemetria. Autenticação de UI e capacidade operacional de enviar
localização estavam **acopladas**. O serviço nativo não participa (e não deve participar)
da rotação SEC-1 nem deve carregar um refresh token.

## 3. Decisão — Opção C: credencial operacional escopada

Separar **autenticação de UI** da **capacidade mínima de enviar telemetria de uma viagem**.
A credencial de rastreamento:

- **NÃO é** access token geral, refresh token, sessão web, refresh SEC-1 duplicado nem
  bypass de autenticação;
- autoriza **apenas** telemetria de localização do **próprio motorista/empresa**;
- é **opaca** (CSPRNG, 256 bits), **revogável** e **expira server-side**;
- é **independente** do access token: sobrevive à expiração/rotação do access e ao
  app em background sem interação de UI.

## 4. Formato da credencial

`mtk1.<base64url(32 bytes CSPRNG)>` — token **opaco**, sem dados legíveis (uid/frete).

- **Armazenamento:** só o **HMAC-SHA-256(pepper, "tracking:"||token)** (hex) vai ao banco
  (`credential_hash`). O token aberto **nunca** é persistido nem logado.
- **Domain separation:** o prefixo `"tracking:"` no HMAC separa o domínio do hashing do
  refresh SEC-1 (mesmo token+pepper ⇒ hashes diferentes). Reusa o mesmo `pepper` do SEC-1.
- **Por que opaco + HMAC (e não JWT):** exige revogação **imediata** (server-side); um JWT
  stateless não revogável seria inaceitável (§3 do mandato). O modelo espelha o do refresh
  SEC-1 (opaco + HMAC + registro revogável).

## 5. Modelo de dados — migration `064_frete_tracking_credenciais.sql`

Tabela `frete_tracking_credenciais` (aditiva, reversível):
`id, empresa_id (FK empresas, CASCADE), motorista_id (FK usuarios, CASCADE),
session_id (FK auth_sessions, SET NULL), frete_id (FK fretes, SET NULL), device_id,
credential_hash (UNIQUE), issued_at, expires_at, last_used_at, revoked_at,
revoked_reason, created_at, updated_at`, com `CHECK(expires_at >= issued_at)`.
**RLS ENABLE+FORCE**; sem policy ⇒ nega anon/authenticated; `service_role` (backend) CRUD.

### Numbering (§21) — decisão

O HEAD do #414 termina em **062**. A **063** está **reservada ao #416** (3A-2, congelada,
não mergeada). Para **não criar conflito silencioso**, esta migration usa **064** (posterior
a ambas). O **gap 063 é seguro**: o applier de teste (`tests-pg/apply_schema.mjs`) e a
aplicação em produção (Supabase) usam **lista explícita de arquivos** — **não há runner
que exija contiguidade** ou quebre com gaps. **#416 não é tocado.**

## 6. Escopo (least privilege) e threat model

A credencial autoriza **somente** as rotas mínimas de telemetria:
`POST /fretes/localizacao/sessao`, `POST /fretes/localizacao/sessao/estado` e
`POST /fretes/localizacao/sessao/renovar-credencial`. **Rejeitada** em qualquer outra
rota (`/auth/me`, `/admin/*`, faturas, fretes gerais, etc.) — provado por teste (§27).

- **Tenant isolation:** a telemetria só escreve nos fretes ATIVOS **do próprio motorista**
  na **própria empresa** (`empresa_id`/`motorista_id` da credencial + resolvedor canônico).
  Empresa A nunca envia por empresa B; motorista A nunca por motorista B; a credencial
  nunca atinge a viagem de terceiros.
- **Vínculo:** se o motorista muda de empresa ou é desvinculado ⇒ `tracking_scope_forbidden`.
- **Replay/abuso:** a mesma credencial autentica várias amostras GPS legítimas (uso repetido
  legítimo ≠ replay). Proteções: revogação imediata, expiração, escopo por empresa/motorista,
  e a idempotência já existente dos pontos (dedupe por janela de `captured_at`).

## 7. Middleware e não-ampliação de privilégio (§9)

As rotas de telemetria vivem num **sub-router dedicado** montado **antes** do
`router.use(verifyToken, …)` global — assim `verifyToken` **não** roda nelas (uma credencial
opaca não é JWT e seria rejeitada por ele). O guard `criarGuardTelemetria` aceita:

- **Ramo tracking** (flag ON + header `X-Tracking-Credential`): valida a credencial, seta
  `req.user`/`req.empresa_id`/`authKind='tracking'` e **aplica o MESMO `verificarPlano`** do
  ramo de sessão — **não amplia privilégio**.
- **Ramo sessão** (default / flag OFF): `verifyToken → verificarEmpresa → verificarPlano`,
  **idêntico ao fluxo atual**.

`verifyToken` **não foi alterado**. A credencial **nunca** é válida globalmente.

## 8. Emissão

`POST /fretes/localizacao/credencial` — autenticado por **sessão SEC-1 normal**, só para
**motorista** com **viagem apta** (resolvedor canônico reusado). Retorna o token aberto
**uma vez** no corpo (nunca logado) + `expires_at`. Com a flag **OFF** responde `404
tracking_disabled` ⇒ o app cai no fluxo compatível (access token).

## 9. Ciclo de vida, idle/absolute e expiração (§4, §5, §6)

- **Emissão:** só usuário autenticado/autorizado ao iniciar/retomar rastreamento legítimo.
- **Uso:** só telemetria da(s) viagem(ns) ativa(s) do motorista.
- **Expiração:** `expires_at` server-side; TTL configurável `TRACKING_CREDENTIAL_TTL_SECONDS`
  (default **24h**, faixa 15min–30d).
- **Renovação (viagens longas):** `POST …/sessao/renovar-credencial` **tracking-only** —
  re-valida (não revogada, não expirada, motorista/sessão válidos) e **estende** `expires_at`
  (mantém o mesmo token → intent nativo estável). **Nunca** entrega refresh SEC-1 ao nativo.
- **§5 (crucial):** a expiração **natural** do access/idle/absolute da sessão de UI **não**
  interrompe o tracking (o domínio **não** olha idle/absolute da sessão). Só a **revogação
  explícita** (logout/admin) invalida — via `auth_sessions.revoked_at`.

### Revogação (§15/§16/§17)
- **Logout:** `authSessionController.logout` revoga a sessão; adicionalmente revoga a
  credencial da sessão (best-effort). A validação já rejeitaria via sessão revogada.
- **Admin:** motorista com `status != 'ativo'` ⇒ `driver_blocked`; sessão/dispositivo
  revogado ⇒ `credential_revoked`.
- **Fim/cancelamento de viagem:** `fretesController.finalizar`/`delete` revogam a credencial
  quando o motorista não tem mais viagem ativa (best-effort). Token reutilizado depois ⇒
  `credential_revoked`.

## 10. Serviço nativo (Android/Flutter)

- **Flutter** (`location_tracking_service.dart`): ao iniciar, tenta `issueTrackingCredential()`.
  Se disponível ⇒ entrega ao nativo `mode='tracking'`, `token=<credencial>`, `expiresAt`.
  Se indisponível (flag OFF / sem viagem / falha) ⇒ **fallback** `mode='session'` com o access
  token (comportamento atual).
- **Kotlin** (`LocationTrackingService.kt`): em `mode=tracking` envia `X-Tracking-Credential`;
  em `mode=session` envia `Authorization: Bearer` (como hoje). `START_REDELIVER_INTENT`
  preserva a credencial na morte do processo (sem gravar segredo em disco). Renova
  proativamente (< 1h para expirar), tracking-only.

### Códigos e `stopSelf` (§12)
`stopSelf()` **só** em erros **definitivos**: `401/403` (credencial inválida/expirada/revogada,
motorista bloqueado, fora de escopo) e `409` (sem viagem apta = fim do rastreamento).
Transitórios (`503/5xx/408/429`/rede) **não** param nem apagam a fila.

## 11. Offline (§13)
A fila existente (SharedPreferences) é preservada: rede cai ⇒ pontos locais retidos; rede
volta ⇒ sincroniza. Rotação/expiração do access de UI **não** interfere na fila.

## 12. Feature flag & rollback (§10/§36)
- `TRACKING_SCOPED_CREDENTIAL_ENABLED` (default **OFF**): OFF ⇒ comportamento atual 100%
  preservado (emissão responde 404; guard ignora o header e usa sessão).
- **Rollback backend:** flag OFF ⇒ volta ao fluxo compatível. **Rollback app:** APK release
  anterior. Não desfaz Gate A0, same-site, migration 062, rotação de refresh nem o fix de
  `client_type`.

## 13. Testes
- **Backend (node --test):** `trackingCredentialDomain`, `trackingCredentialCrypto`,
  `trackingConfig`, `trackingCredentialService` (emitir/validar/renovar/revogar/throttle/
  unicidade; **§23** sobrevive à expiração do access), `trackingGuard` (§23 HTTP, **§27**
  privilégio, flag OFF, não-ampliação, renovar tracking-only).
- **PG efêmero:** `tests-pg/tracking_credenciais.pgtest.mjs` (schema/UNIQUE/CHECK/RLS/grants/
  FK/SET NULL/CASCADE/revogação).
- **Flutter:** `flutter analyze` + `flutter test` + `flutter build apk --release`.

## 14. Gate
Esta implementação **remove o blocker** antes do Gate B, mas **não** executa o Gate B nem
declara GO. `AUTH_REQUIRE_SESSION` permanece OFF; legado permanece ON. Decisão GO/NO-GO só
após revisão independente do Codex sobre esta branch.
