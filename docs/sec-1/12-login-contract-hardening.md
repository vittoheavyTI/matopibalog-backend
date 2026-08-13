# SEC-1 — Login Contract Hardening (dentro do #414)

Pacote pequeno de endurecimento derivado do laudo forense da sessão `client_type=web`
em UA Dart (ver o resultado forense da auditoria). **Sem deploy em produção neste gate.**
Não altera a compat do `guardTelemetria`.

> Contexto forense: o usuário confirmou ter aberto o app por volta de 11:28 -03, o que
> **explica a existência temporal** do login que criou `e396a155` (não é interação de
> background inexplicável). Isso **não explica** por que a sessão saiu `client_type=web`.
> A causa raiz do `web` permanece **PARTIAL** — daí a build identity (item CI) para o
> próximo teste provar qual binário está rodando.

## Motivação (achados que independem de "qual APK rodou")
1. App aceitava resposta de login **sem `refresh_token`** e seguia autenticado.
2. `setSessionTokens()` com refresh novo null/vazio **não apagava** o refresh antigo
   persistido → `currentRefreshToken()` o "ressuscitava" (família obsoleta).
3. Sessões mobile **sem `device_id`** → impossível provar fisicamente qual aparelho
   criou a sessão (device_id nulo em todas as sessões auditadas).
4. Backend **não ecoava** o `client_type` resolvido → o app não tinha como validar
   que a sessão saiu como `android`.

## Mudanças
### Backend
- `authController.login`: resposta passa a incluir `resolved_client_type` (web e mobile),
  sem segredo. Log sanitizado `[auth.login]` (`resolved_client_type`, `has_device_id`,
  `user_agent` truncado, `uid8`, `session_id`) — nunca token/refresh/senha.
- `freteLocalizacaoController.registrarSessao`: log `[freteLocalizacao:telemetria]` com
  `authKind` (`tracking` vs `session`) e `has_credential` — observabilidade para o E2E,
  **sem** tocar no guard.

### App (Flutter)
- `login()` envia `device_id` (estável, o mesmo da credencial) + `device_label`
  sanitizado; `client_type` via `expectedClientType` (fonte única).
- **Fail-closed**: `AuthProvider.login` só aceita a sessão se
  `isHealthyMobileLoginResponse` (resolved_client_type == esperado **E** refresh não
  vazio). Contrato "web" → erro claro, **nada persistido**.
- `setSessionTokens()` apaga o refresh persistido quando o novo é null/vazio.
- Helpers puros/testáveis: `isHealthyMobileLoginResponse`, `montarLoginBody`,
  `deveApagarRefreshPersistido`, `expectedClientType`.
- Tela **Perfil → Sobre/Diagnóstico** com build identity (versão, build, git SHA curto,
  device_id curto) + "Copiar diagnóstico". Fonte: `lib/config/build_info.dart`
  (`--dart-define`).

### Android
- `AndroidManifest`: `allowBackup=true` + `dataExtractionRules` + `fullBackupContent`.
- As regras excluem **todo o domínio `sharedpref`** (`<exclude domain="sharedpref"
  path="." />`) de backup em nuvem e de device-transfer, nos dois regimes (API<=31 e
  API 31+). **Por que o domínio inteiro, e não só `FlutterSecureStorage.xml`:**
  `AuthProvider.tryAutoLogin()` migra o token legado de `SharedPreferences['token']`
  para o secure storage; excluir só o arquivo do plugin deixaria o token legado
  restaurável via SharedPreferences e re-migrado — quebrando a garantia de "instalação
  limpa sem auth state restaurado". **Trade-off aceito:** preferências não críticas
  (ex.: tema) não sobrevivem a backup/restore; segurança e determinismo de sessão têm
  prioridade. O nome físico interno do arquivo do plugin **não** é usado.
- Trava estática: `test/backup_exclusion_test.dart` garante a exclusão `sharedpref
  path="."` nos dois regimes e que não se volta a depender do nome do arquivo do plugin.

### CI
- `app-ci.yml`: passo de identidade + `--dart-define=GIT_SHA/APP_VERSION/APP_BUILD_NUMBER`
  nos builds debug e release. O APK passa a carregar o SHA do commit.

## Testes
- Backend: `resolved_client_type` asserido nos testes de login web/mobile (suíte 1254/1254).
- App: `test/login_contract_hardening_test.dart` — web-shaped (rejeita), android-shaped
  (aceita), resolved ausente (rejeita, fail-closed), refresh vazio (rejeita), device
  binding presente em `montarLoginBody`, stale-refresh (`deveApagarRefreshPersistido`).

## COUPLING obrigatório para o próximo Checkpoint A
O APK novo **exige** um backend que ecoe `resolved_client_type`. O backend em produção
hoje (`6d1b4bf`) **não** ecoa. Portanto, o próximo teste físico exige implantar
**backend novo + APK novo juntos** — caso contrário o login mobile falha fail-closed.
Isso é intencional: o APK novo se recusa a rodar contra um backend que não confirma o
tipo resolvido.

## NÃO incluído (decisão própria depois)
- Nenhuma mudança em `guardTelemetria` (compat com clientes legados).
- Nenhum deploy, migration 065, Gate B, Strict ou merge.
