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

---

## 15. Correções pós-revisão adversarial do Codex (v2) — SUPERSEDE as seções 6/9/10 acima

A 1ª revisão adversarial classificou B-1 (BLOCKER) + H-1/H-2/H-3 (HIGH) + M-1..M-5. Esta
versão corrige todos. Diferenças em relação ao desenho inicial:

### 15.1 §B-1 — emissão TRI-STATE, fail-closed (fim do fallback silencioso)
`ApiService.issueTrackingCredential()` retorna **`disabled | credential | failed`**:
- **`disabled`** SOMENTE quando o backend prova flag OFF (**HTTP 404**) → fallback legacy
  (access token) **permitido**.
- **`credential`** → credencial recebida.
- **`failed`** (timeout/rede/5xx/409/403/payload inválido) → **NÃO** inicia com access token.
  O app marca `LocationTrackingStatus.failed` (observável) e o `reconcile` tenta de novo no
  próximo ciclo (sem loop agressivo). **Feature ON nunca cai para legacy por erro.**

### 15.2 §M-3 — emissão exige sessão SEC-1 (sid)
A emissão recusa token legado sem `sid` (`tracking_session_revoked`). `session_id` é
**NOT NULL** → vínculo canônico com `auth_sessions` (logout/revogação de sessão/dispositivo).

### 15.3 §M-1 — device binding obrigatório
`device_id` **NOT NULL** na credencial. O app gera um id **estável por instalação** (aleatório,
persistido no secure storage; sem fingerprint invasivo) e o envia em **todas** as chamadas via
`X-Tracking-Device` (emissão, telemetria, estado, renovação). Mismatch ⇒ `tracking_device_mismatch`.

### 15.4 §H-3 — vínculo canônico ao CONTEXTO OPERACIONAL (multi-viagem)
> **Correção pós-gate de incorporação:** a Verificação 0 provou **`driver_can_have_multiple_active_trips = TRUE`**
> (`services/freteService.js` trata explicitamente `>1 viagem ativa`; `fretesController.create` não
> impede; sem constraint de DB; a camada de localização opera com `MAX_FRETES_SESSAO=4`). O binding
> por-UMA-viagem seria **ambíguo** (rastrearia só a viagem de emissão). Modelo corrigido:

A **âncora** é **sessão SEC-1 + device** (NOT NULL). `frete_id` é **contexto de emissão**
(qual viagem disparou) — **NULLABLE**, `ON DELETE SET NULL` (apagar essa viagem não pode matar a
credencial que cobre as demais). A validação server-side checa, **a cada request**: credencial não
revogada; **teto absoluto**; sessão não revogada; motorista ativo; tenant; **device**; e
**`temViagemAtiva`** = o motorista tem **≥1 viagem ATIVA** (`{ativo,em_viagem,em_andamento}`). Sem
viagem ativa ⇒ `tracking_trip_inactive` **canônico** (não depende de hook). A telemetria (ramo
tracking) **faz fan-out para TODAS as viagens ativas do motorista** — mesmo modelo da sessão
(`buscarFretesEmAndamentoDoMotorista`). Isolamento: o resolvedor só retorna as **próprias** viagens
do motorista/empresa ⇒ credencial de A nunca grava em viagem de B (cross-driver/tenant bloqueado).
Fim/cancelamento da **última** viagem ⇒ sem viagem ativa ⇒ rejeitada; hook best-effort revoga.
**O app (Flutter/Kotlin) não muda:** já posta no endpoint de sessão; o fan-out é server-side.

### 15.5 §H-2 — teto absoluto (sem renovação perpétua)
Duas noções: `expires_at` (nominal) e **`max_expires_at`** (teto absoluto = `issued_at + MAX`).
Config `TRACKING_CREDENTIAL_MAX_LIFETIME_SECONDS` (default **604800 = 7 dias**), fail-closed
(`max ≥ ttl`). A renovação **nunca** ultrapassa o teto; além dele ⇒ `tracking_credential_max_lifetime`
(exige nova emissão por sessão SEC-1 — **nunca** access token).

### 15.6 §H-1 — renovação pós-expiração + ROTAÇÃO (CAS) + fila offline
- A credencial **expirada** (dentro do teto) **não** autentica telemetria, mas **pode rotacionar**:
  `POST …/sessao/renovar-credencial` revalida todos os vínculos canônicos e **troca o segredo**
  (gera token B). A troca é **CAS** (`UPDATE … WHERE credential_hash = <antigo> AND revoked_at IS
  NULL AND max_expires_at ≥ now`), impedindo duas credenciais válidas concorrentes (single-use real).
- **Kotlin:** ao receber `tracking_credential_expired`/`rotated`, chama renovação → atualiza
  `token=B` + expirações + **reemite o próprio start intent** (`updateSelfIntent`) para que o
  `START_REDELIVER_INTENT` passe a redeliver o token **atual** (recuperação em process death sem
  persistir segredo). Offline atravessando o `expires_at` (dentro do teto): reconecta → detecta
  expirado → renova → **fila intacta** → flush com B. Além do teto: **preserva a fila**, encerra e
  exige nova emissão pelo app.

### 15.7 §M-2/§8 — contrato semântico de erro + fila
Backend retorna códigos estáveis: `tracking_credential_expired | rotated | revoked |
max_lifetime | session_revoked | driver_blocked | tenant_mismatch | device_mismatch |
trip_inactive | trip_mismatch | invalid` (+ `tracking_unavailable` transitório). O Kotlin decide
por **código** (não status cru): `expired/rotated`→renovar (não descarta fila); definitivos→encerra;
`503/5xx/408/429`/rede→transitório (mantém fila). **A fila só remove um ponto em ingestão
confirmada (2xx)** — nunca por `stopSelf`. (Em `mode=session`/legacy o comportamento antigo é
preservado.)

### 15.8 §M-4 — FKs seguros
`session_id` e `frete_id`: **`ON DELETE CASCADE`** (antes `SET NULL`). Sessão ou viagem apagada ⇒
credencial some junto (nunca fica órfã com vínculo nulo).

### 15.9 §M-5 — teste do router real
`tests/trackingRouterOrder.test.js` carrega o `routes/fretes.js` REAL e prova estruturalmente que
o sub-router de telemetria é registrado **antes** do `verifyToken` global, a emissão fica **sob**
o `verifyToken`, e as rotas gerais também.

### 15.10 §16 (futuro) — caminho Strict
Quando o SEC-1 entrar em **Strict**, a credencial escopada será o **caminho oficial** do GPS. O
fallback por access token existe **apenas** no modo Compatible com a flag **OFF**. Nada no desenho
mantém o legacy como requisito futuro.

### 15.11 Testes (v2)
- **Backend `node --test`: 1250/1250, 0 falhas** (baseline real deste worktree = 1201 + 49 tracking).
  Cobre binding (viagem/device/sid), teto absoluto, rotação CAS, renovação pós-expiração, revogação
  por frete/sessão/motorista, contrato semântico, §23 (sobrevive à expiração do access), §27
  (privilégio), flag OFF, router real.
- **PG efêmero (064):** `tracking_credenciais.pgtest.mjs` — schema/NOT NULL/UNIQUE/CHECK(max≥exp≥issued)/
  RLS/grants/FK obrigatórios/**CASCADE** (sessão e frete)/revogação. **CI-gated** (sem Docker local).
- **Flutter:** `tracking_emissao_test.dart` (tri-state + header device) + analyze/test/build --release.
  **CI-gated** (sem Flutter local).
