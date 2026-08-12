# SEC-1 — Credential storm hardening (Checkpoint A v3 follow-up)

Estado do gate anterior (aceito):

- `AUTH / DEVICE / REFRESH / TRACKING path = PASS`
- `credential_storm = FAIL` (blocker funcional único)
- `native_start_ack_race = PROVEN` (race arquitetural)
- Produção restaurada em `6d1b4bf` — Tracking OFF / Compatible / Strict OFF.
- Migration `064 = aplicada em produção desde 2026-08-11`; `065 = ausente / não autorizada`.

## Diagnóstico (laudo read-only)

Evidência empírica das 3 credenciais da sessão de teste (`3708b8a0-…`):

| # | issued | estado | last_used_at | revogada em | motivo |
|---|--------|--------|--------------|-------------|--------|
| 1 | `18:29:50.565` | revogada | `18:29:53.427` (USADA) | `18:29:53.169` | reemitida_substituida |
| 2 | `18:29:53.169` | revogada | `null` (nunca usada) | `18:30:12.157` | reemitida_substituida |
| 3 | `18:30:12.157` | ATIVA | `18:37:59.718` | — | — |

Global: **29 linhas, 1 ativa, 28 revogadas** (todas `reemitida_substituida`).

Duas causas convergentes:

1. **`native_start_ack_race`** — `MainActivity.'start'` chamava `LocationTrackingService.start()`
   (=`startForegroundService`, assíncrono) e devolvia `result.success(true)` **antes** de
   `onStartCommand` marcar o serviço vivo. Um reconcile imediato (mesmo escopo) via
   `isActive` lia "não vivo", concluía "morto" e **reemitia — revogando a credencial #1 que o
   serviço estava usando** (cred #1 `last_used 18:29:53.427` > revoked `18:29:53.169`).

2. **Premissa falsa "backend deduplica"** — `trackingCredentialService.emitir()` sempre faz
   `INSERT` de uma linha nova e só depois revoga as anteriores. Repetir a emissão gera churn e
   revoga a credencial corrente. Caminhos `scopeSignature=null` (`startForActiveTrips` por
   contagem) nunca reusavam → emitiam sempre.

## Correção

### Máquina de estados nativa (Fase 3)

`STOPPED / STARTING / RUNNING / TERMINAL` (`LocationQueueLogic.NativeTrackingState`), exposta
pelo MethodChannel `trackingState` (substitui `isActive`):

- `markStarting()` é chamado **sincronamente** em `start()`, antes de `startForegroundService`
  → fecha a janela da ack-race.
- `onStartCommand` → `RUNNING` só após inicialização operacional aceita (`stateAfterStart`).
- Erro/permissão/credencial morta → `TERMINAL`; parada limpa → `STOPPED`.
- **Fail-safe de startup travado:** `reportedState` faz downgrade de um `STARTING` mais velho
  que `STARTING_MAX_AGE_MS = 30_000ms` (relógio **monotônico** `elapsedRealtime`) para
  `TERMINAL`. Rede de segurança, não cadência normal; sem `Future.delayed`/sleep.
- **Process-death:** estado estático perdido volta a `STOPPED` (nunca `RUNNING`) → fail-safe.

O Flutter trata `STARTING` e `RUNNING` como **vivos** → não reemite nessa janela.

### Reconciliação centralizada por IDs (Fase 4)

`reconcileWithFretes(ids, reason)` é a **única** via que decide emitir/reusar/recuperar, sempre
a partir do conjunto canônico de IDs. Os 3 call-sites antes `scopeSignature=null` — todos com
acesso à lista de fretes — foram convertidos:

| Call-site | Antes | Agora | reason |
|---|---|---|---|
| Home "Ativar" | `startForActiveTrips(count)` | `reconcileWithFretes(finance.fretes)` | `manualEnable` |
| Detalhe "Ativar" | `startForActiveTrips(count)` | `getFretes()` → `reconcileWithFretes` | `manualEnable` |
| AddFrete (pós-criação) | `startForActiveTrips(count)` | `getFretes()` → `reconcileWithFretes` | `tripStarted` |

`startForActiveTrips` virou **ensure-liveness**: se o nativo está vivo → nada a fazer; caso
contrário **não** fabrica escopo nem emite (a reconciliação canônica recupera). A regra
server-side (`scope real = snapshot server-side das viagens elegíveis`) permanece intacta.

### Observabilidade sanitizada (Fase 3)

Cada decisão registra `AppLogger.action('tracking_emission', …)` com **motivo enumerado**
(`login_reconcile`/`finance_reconcile`/`trip_started`/`manual_enable`/`native_recovery`),
`native_state`, `result` (`reuse|issue|recover|failed|stop|ensure_noop`), `scope_count` e
**hashes curtos não sensíveis** de scope/device/sessão. Nunca token/credential/hash sigiloso.
Permite provar a origem de qualquer emissão no próximo Checkpoint A sem ADB/inferência temporal.

## Testes

- Dart (`tracking_single_credential_test`): `classifyStartDecision` (reuse/recover/issue),
  parse/liveness do estado tri-state, e a **aceitação** `emit#1 → STARTING → reconcile →
  reconcile ⇒ 1 emissão`; mesmo escopo → 0; nova viagem → +1; escopo-null não reusa.
- JVM (`LocationQueueLogicTest`): `stateAfterStart`, `reportedState` (STARTING dentro/fora do
  limite), `nativeStateIsAlive`.
- Corrigidos comentários/testes que afirmavam "backend deduplica".

## Limpeza da rodada física (pendente, próximo gate — NÃO agora)

Sessão `3708b8a0-…` e 1 credencial ativa seguem vivas (auditadas, sem write). Antes de novo
Tracking ON: revogar pelo **fluxo normal** (logout/stop) e comprovar `sessão anterior
revogada` + `refresh family anterior revogada` + `0 tracking credentials operacionais ativas`.
Nunca DELETE manual.

## Não incluído / não autorizado

Sem migration 065, sem deploy, sem Tracking ON, sem merge #414, sem Checkpoints B–G. Runtime só
será declarado fixado após novo teste físico.
