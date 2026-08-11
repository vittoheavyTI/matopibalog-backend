# SEC-1 — Client Stabilization (2 blockers de tracking)

Gate de estabilização client-side após o E2E físico (PASS COM RELIABILITY BLOCKERS).
Sem deploy, sem Gate B, sem merge. Produção segue `6d1b4bf` com tracking OFF.

## BLOCKER 1 — Credencial operacional única por (session + device)

### Diagnóstico (provado no código)
- `location_tracking_service.dart::_startSession()` chamava `ApiService.issueTrackingCredential()`
  **incondicionalmente**, e era acionado por eventos FREQUENTES de foreground:
  - `finance_provider.dart:163` → `reconcileWithFretes(fretes)` a cada refresh da lista de fretes;
  - `detalhe_viagem_screen.dart` → `Timer.periodic(60s)` + reconcile pós-poll;
  - `home_screen.dart` / `detalhe_viagem_screen.dart` → `startForActiveTrips` em load/resume.
- Cada emissão inseria uma NOVA credencial (backend não revogava as anteriores) → **N credenciais
  válidas simultâneas** para a mesma sessão+device (observado: até 26 num único start). Viola
  `single_native_tracking_credential`.

### Correção (defesa em profundidade)
1. **Backend (autoridade, `trackingCredentialService.emitir`)**: ao emitir a nova credencial,
   revoga ATOMICAMENTE as anteriores ATIVAS da MESMA `session_id`+`device_id`
   (`issued_at < a recém-emitida`, `reason=reemitida_substituida`). Race-safe: a recém-emitida
   nunca é alvo; sob concorrência a mais nova sobrevive → converge para **1 ativa**. Sem migration
   (apenas UPDATE de `revoked_at`; compatível com a 064). Preserva scope imutável, anti-resurrection,
   renew CAS, teto absoluto, device binding, revogação por sessão.
2. **Flutter (redução de churn)**: `_startSession` só re-emite quando necessário — guard `shouldReuseCredential`
   reusa a credencial vigente enquanto (a) o nativo está ativo em modo credencial, (b) o ESCOPO
   (conjunto de viagens ativas, `scopeSignature`) não mudou, (c) falta > 2 min para o vencimento
   nominal. Mudança legítima de escopo (nova viagem) → assinatura diferente → nova emissão SEC-1
   (que substitui a anterior no backend). `stop()`/logout limpam o estado.

### Testes
- Backend (`tests/trackingCredentialService.test.js`, `node --test` 1254/1254): re-emissão → 1 ativa;
  5 emissões → 1 ativa; mudança de escopo rotaciona + anti-resurrection; unicidade por (session+device).
- Flutter (`test/tracking_single_credential_test.dart`): predicado puro `shouldReuseCredential` e
  `scopeSignature` (reuso em reconcile/resume; re-emite em mudança de escopo; nunca reusa em legacy).

## BLOCKER 2 — Gaps de captura em background/idle

### Diagnóstico (causa provada por código + contrato de plataforma)
- Categoria: **`timer_not_fired`**. O scheduler era `Handler(Looper.getMainLooper()).postDelayed(tick, 5min)`
  — um **timer local do processo**, NÃO uma fonte de wakeup. Sob Doze/App Standby (tela apagada,
  parado, desplugado) o SO suspende os wakeups de CPU do processo e o `postDelayed` só executa em
  janelas de manutenção do Doze (que crescem ~15→30→60min), gerando os gaps de **50-80min** observados.
  Um ForegroundService mantém o processo vivo, mas NÃO isenta timers `postDelayed` do Doze.
- `Doze` como fenômeno de plataforma explica o mecanismo; a **confirmação empírica no lifecycle/log
  nativo do device** pertence ao gate de revalidação física (não declarada aqui como fato de device).

### Correção
- Scheduler trocado para **`AlarmManager.setAndAllowWhileIdle`** (API 23+; `set` no fallback < 23),
  entregando um broadcast LOCAL (`ACTION_TICK`, não exportado) a um `BroadcastReceiver` dinâmico do
  serviço. `setAndAllowWhileIdle` é fonte de wakeup que dispara MESMO em Doze. Por ser `getBroadcast`
  (não `getService`), os ticks NÃO reentram no `onStartCommand` → o intent de redelivery segue sendo
  o START completo (recuperação de process-death preservada) e a rotação (`updateSelfIntent`) fica idêntica.
- `WakeLock` PARCIAL com teto de 60s durante o ciclo de captura/envio (o alarme só acorda a CPU
  brevemente; garante que a rede termine). Sem `SCHEDULE_EXACT_ALARM` (variante inexata; permissão
  já existente = `WAKE_LOCK`, FGS type `location`).
- Toda a lógica de captura/envio/fila/rotação/heartbeat foi **preservada** (blast radius mínimo).

### SLA de cadência (a validar no gate físico)
- **Em movimento** (tracking ativo, FGS vivo): envio conforme filtro operacional — ponto quando o
  deslocamento desde o último enviado ≥ `MIN_DISTANCE_METERS` (100m), a cada tick (~5min nominal).
- **Parado**: heartbeat nominal a cada `HEARTBEAT_MS` (15min). Em Doze profundo, `setAndAllowWhileIdle`
  é limitado pelo SO a ~1 disparo/9min → cadência efetiva parada ~**9–15min** (tolerância Android
  documentada). **Objetivo: eliminar os gaps arbitrários de 50-80min** — não prometer precisão por segundo.
- Não é rastreamento em tempo-real; o requisito é **confiabilidade operacional**.

### Offline
- A lógica de fila (`enqueue`/`flushQueue`/preservação em erro de rede via `classify`) **não foi
  alterada** por este gate. O teste físico de flush offline ficou INCONCLUSIVE no E2E (nenhum ponto
  capturado na janela por causa do gap de tick); com o scheduler corrigido, o tick passa a disparar
  em background/idle, viabilizando a captura offline → enfileiramento → flush na reconexão.
- Teste automatizado JVM do lifecycle da fila requer infra de teste Android (`android/app/src/test`),
  inexistente hoje → **follow-up**; a semântica de preservação está coberta por `classify()`/`flushQueue`.

## Fora de escopo (registrado, NÃO corrigido aqui)
- **Bug financeiro legado**: frete `2f820889` com `valor_tonelada_km=245` inválido bloqueia a
  finalização (422 semântico escondido por mensagem genérica; editor inline incompleto). Valor
  comercial correto desconhecido → NÃO inventar/alterar. Fora do SEC-1.
- **Localização/Torre (backlog, requisito futuro)**: localização enriquecida no painel (endereço/
  cidade/UF, idade do ponto, mapa, frescor/status), Torre atualizando sem F5 (realtime + polling
  fallback). NÃO implementar no fechamento SEC-1.
