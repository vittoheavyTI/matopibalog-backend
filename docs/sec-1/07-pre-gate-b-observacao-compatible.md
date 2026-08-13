# SEC-1 Pre-Gate-B - Observacao Compatible

Data: 2026-08-09 20:39 -03:00
Atualizacao documental: 2026-08-09 pos-CI final do HEAD `ef93af7104bad1db2df719e63f2cd4da648c0c12`

PR: #414 (`feat/sec-1-sessoes-revogaveis`)
HEAD: `ef93af7104bad1db2df719e63f2cd4da648c0c12`
Base conhecida: `main` em `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`
Estado da PR: aberta, draft, nao mergeada.

## Preflight

- `origin/main` permanece em `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`.
- `HEAD` local/remoto permanece em `ef93af7104bad1db2df719e63f2cd4da648c0c12`.
- Drift de `34cf0b4e25756782a2db9fae17de46f6a1f3e403` ate `ef93af7104bad1db2df719e63f2cd4da648c0c12`: somente documentacao apos o codigo funcional SEC-1.
- Residuos locais conhecidos continuam fora do escopo: `painel_web/dist`, registrants Flutter e `500`.

## PR body

Body da PR #414 atualizado para refletir:

- Gate A0 concluido.
- Gate A Compatible concluido.
- Migration 062 aplicada.
- Producao em Compatible:
  - `sessions=true`
  - `rotation=true`
  - `require=false`
  - `allowLegacy=true`
  - `SameSite=Lax`
  - sem cutoff legado
- Deployment final: `a1bafb7e-fe99-43ab-a962-536078a70e7b`.
- Gate B pendente / nao autorizado.
- PR draft / nao mergear.

## APK release

Artifact release correto confirmado no GitHub Actions para o HEAD atual:

- Workflow run: `31342485778`
- Artifact: `app-release-apk`
- Artifact ID: `9046355612`
- Artifact digest: `sha256:3e175f5099c6bae7dbf6619157052fac6e7f4d3be122ec7a949a35d4949d8594`
- Source SHA: `ef93af7104bad1db2df719e63f2cd4da648c0c12`
- Artifact expira em: `2026-08-16T23:50:26Z`
- Arquivo interno: `app-release.apk`
- Bytes do APK: `57312055`
- SHA-256 do APK: `54D0681EC1E436C49213C26BABAE659343D274496446FDE15A35BA84B50A2205`

Checklist manual real: pendente de retorno do usuario.

Se esta atualizacao documental gerar novo HEAD doc-only, o APK acima permanece a evidencia release correta para o codigo funcional SEC-1 ja validado no HEAD `ef93af7104bad1db2df719e63f2cd4da648c0c12`; novo build nao e necessario apenas por correcao documental.

## Observacao Compatible

Deploy operacional final:

- Railway deployment: `a1bafb7e-fe99-43ab-a962-536078a70e7b`
- Status: `SUCCESS`
- Health `https://api.matopibalog.com.br/health`: 200
- Health dominio Railway antigo: 200
- `/planos/publicos`: 200

Janela observada ate este relatorio:

- Desde primeiro Compatible funcional: inferior a 24h.
- Desde deployment final `a1bafb7e`: aproximadamente 1.13h.

Resultado: janela ainda insuficiente para liberar Gate B.

## Metricas Railway agregadas

Janela consultada: ultimas 24h disponiveis via Railway CLI.

- Total HTTP observado: 21
- 200: 3
- 201: 3
- 401: 1
- 404: 14
- 5xx: 0
- 403: 0
- 409: 0
- 429: 0
- Latencia media: 927.57 ms
- Latencia maxima: 6762 ms
- Deployment nos logs HTTP: `a1bafb7e-fe99-43ab-a962-536078a70e7b`

Incidente observado:

- 14 erros `ENOENT /painel_web/dist/index.html` por acesso ao root do backend; nao classificado como erro auth/session.

## Metricas Supabase agregadas

`auth_sessions`:

- total: 3
- ativas: 1
- revogadas: 2
- por client type: web 2, android 1
- classificacao sintetica:
  - android synthetic_gate_a: total 1, ativa 0, revogada 1
  - web synthetic_gate_a: total 1, ativa 0, revogada 1
  - web non_synthetic: total 1, ativa 1, revogada 0

`auth_refresh_tokens`:

- total: 5
- usados: 2
- revogados: 4
- eventos de reuse: 1

`auth_event_audit` por evento/resultado:

- `gate_a_fixture:ok`: 1
- `sessao_criada:ok`: 3
- `refresh_sucesso:ok`: 2
- `sessao_revogada:ok`: 2
- `refresh_reuse:reuse_detected`: 1

## Auditoria de segredos

Padroes auditados em logs recentes:

- `Authorization`
- `Bearer`
- `refresh_token`
- `cookie`
- `pepper`
- `token_hash`
- JWT completo
- `senha`
- OTP
- service-role key

Resultado:

- Nenhum segredo aberto observado.
- Hits encontrados foram apenas configuracao segura/redigida:
  - `refreshCookieSameSite: 'lax'`
  - `hasPepper: true`

## Legacy residual

Estado observado:

- Web real ja possui sessao SEC-1 ativa: sim, 1 sessao web non-synthetic ativa.
- Admin real ja possui sessao SEC-1: parcialmente inferido pelo login web real/admin no Gate A; nao ha contador separado por area admin.
- Aplicativo real ja possui sessao SEC-1: nao comprovado. Ha trafego Android real no deployment final, mas a unica sessao Android SEC-1 registrada foi sintetica e ja revogada.
- Integracao/API dependente de JWT legacy: nao comprovada pelos dados atuais; tambem nao ha instrumentacao agregada suficiente para quantificar todo uso legacy legitimo.
- Usos legacy legitimos remanescentes: nao quantificados com seguranca sem capturar JWT aberto.
- Hipotese principal: parte do uso legacy pode vir de usuarios/apps que ainda nao fizeram novo login apos Gate A.

Conclusao: legado residual ainda nao esta suficientemente inventariado para Gate B.

### Atualizacao read-only - 2026-08-09 21:44 -03

Producao Compatible revalidada sem alteracao de flags:

- `AUTH_SESSIONS_ENABLED=true`
- `AUTH_REFRESH_ROTATION_ENABLED=true`
- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`
- `AUTH_REFRESH_COOKIE_SAMESITE=lax`
- `AUTH_LEGACY_TOKEN_CUTOFF`: ausente
- pepper/JWT/Supabase: presentes, sem valores impressos neste relatorio

Health/readiness:

- `https://api.matopibalog.com.br/health`: 200
- `https://matopibalog-backend-production.up.railway.app/health`: 200
- `https://api.matopibalog.com.br/planos/publicos`: 200
- Deployment operacional continua `a1bafb7e-fe99-43ab-a962-536078a70e7b`, status `SUCCESS`.

Logs Railway agregados, janela 3h:

- Total HTTP observado: 35
- 200: 13
- 201: 7
- 401: 1
- 404: 14
- 5xx: 0
- 403: 0
- 409: 0
- 429: 0
- Latencia media: 1392.57 ms
- Latencia maxima: 7396 ms
- Top paths benignos/esperados: `/health`, `/fretes/localizacao/sessao`, `/planos/publicos`.
- Linhas app: 35
- `ENOENT /painel_web/dist/index.html`: 14, fora do escopo auth/session.
- CORS: 0
- CSRF: 0
- Padrões de segredo em logs app: 0
- Evento `refresh_reuse`: 1 linha informativa, correspondente a prova controlada anterior.

Metricas Supabase agregadas, sem IDs:

- `android_real_session_created=false`
- Android real nao sintetico: total 0, ativo 0, revogado 0.
- Android sintetico/fixture: total 1, ativo 0, revogado 1.
- Web real nao sintetico: total 1, ativo 1, revogado 0.
- Web sintetico/fixture: total 1, ativo 0, revogado 1.
- Refresh tokens: total 5, usados 2, revogados 4, reuse detectado 2.
- Ultimo refresh observado: 2026-08-09T22:05:57Z, ainda proveniente das provas controladas do Gate A.

Inventario estatico legacy/clientes:

- Web real usa `localStorage.auth_token` como access Bearer e `/auth/refresh` por cookie; ja ha uma sessao SEC-1 web real ativa.
- Admin real compartilha o mesmo cliente web e middleware `verifyToken`; ha inferencia operacional, mas sem contador separado por area admin.
- Android release usa refresh SEC-1 (`/auth/mobile/refresh`) e armazena refresh em secure storage.
- Android ainda possui migracao de token legado antigo salvo em preferencias para secure storage; portanto usuario que nao relogar pode continuar operando como legacy ate novo login/refresh no APK correto.
- `LocationTrackingService` Android envia Bearer do secure storage; a dependencia e do access token atual do app, nao uma integracao externa separada.
- Rotas de integracoes admin usam `verifyToken`; o Bearer externo observado em teste Clicksign e token de API de terceiro, nao JWT legacy Matopiba.
- Jobs/workers auditados (`gerarFaturasRecorrentes`, `expirarTrials`, `notificarInadimplencia`) sao execucoes one-shot internas e nao apareceram como clientes HTTP/JWT legacy.

Conclusao desta atualizacao: Gate B permanece **NO-GO temporario** ate retorno manual do APK release correto e aparicao/verificacao de sessao Android real nao sintetica, ou ate inventario legacy residual demonstrar ausencia de dependencia legitima.

## Strict isolado

Ambiente isolado CI:

- Run Browser E2E: `31342485748`
- Head SHA: `ef93af7104bad1db2df719e63f2cd4da648c0c12`
- Resultado: PASS
- O teste sobe API/front isolados com:
  - `AUTH_SESSIONS_ENABLED=true`
  - `AUTH_REFRESH_ROTATION_ENABLED=true`
  - `AUTH_REQUIRE_SESSION=true`
  - `AUTH_ALLOW_LEGACY_TOKENS=false`
  - `AUTH_REFRESH_COOKIE_SAMESITE=lax`

Cobertura do Browser E2E:

- cookie web same-site
- refresh web
- duas abas
- logout
- CSRF/CORS/cache
- `RefreshAlreadyRotated` recuperavel
- `RefreshReuseDetected` definitivo

Testes Node locais de auth/SEC-1:

- Comando: `node --test tests/authConfig.test.js tests/authSession.test.js tests/authSessionEndpoints.test.js tests/sessionService.test.js tests/authLoginPerfil.test.js`
- Resultado: 65/65 PASS
- Cobre modo Strict, rejeicao legacy, token hibrido/malformado, sessao revogada, fail-closed, refresh web/mobile, logout e listagem/revogacao de sessoes.

Mobile release/CI:

- Run Flutter: `31342485778`
- Resultado: PASS
- Inclui `flutter pub get`, `flutter analyze`, `flutter test`, `flutter build apk --debug`, `flutter build apk --release` e upload de `app-release-apk`.

Teste Flutter local:

- Tentativa local de `flutter test test/sec1_mobile_auth_test.dart` excedeu timeout no Windows e foi encerrada. Evidencia principal usada: CI verde no HEAD atual.

## Cutoff

`AUTH_LEGACY_TOKEN_CUTOFF` nao foi configurado.

Plano recomendado antes de Gate B:

- Nao usar cutoff agora.
- Preferir corte imediato somente quando a observacao confirmar que web/admin/app reais estao em SEC-1 e que nao ha integracoes legitimas dependentes de JWT legacy.
- Se o app real ou integracoes ainda dependerem de legacy, usar relogin coordenado ou novo ciclo de observacao antes de `allowLegacy=false`.

## Rollback Strict proposto

Se Gate B for executado futuramente e precisar rollback:

- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`

Isso retorna para Compatible, nao para Legacy total.

## GO / NO-GO

Resultado atual: **NO-GO temporario para Gate B**.

Motivos:

- Janela de observacao Compatible ainda menor que 24h.
- Validacao manual real do APK release ainda pendente.
- App real Android ainda nao comprovado em SEC-1.
- Legacy residual ainda nao quantificado com seguranca.

Gate A Compatible permanece aprovado e operacional. Gate B Strict nao foi iniciado.

## Pre-Gate-B Final - 2026-08-09 22:16 -03

Resultado manual do APK release correto:

- `manual_release_validation=PASS`
- APK validado pelo usuario: GitHub Actions run `31342485778`, artifact `app-release-apk`, artifact ID `9046355612`.
- Source SHA funcional do APK: `ef93af7104bad1db2df719e63f2cd4da648c0c12`.
- APK: `57312055` bytes.
- SHA-256: `54D0681EC1E436C49213C26BABAE659343D274496446FDE15A35BA84B50A2205`.
- Resultado percebido pelo usuario: sem regressao aparente.
- Esta e validacao operacional humana, nao prova isolada de cada endpoint.

Estado do PR no fechamento:

- HEAD documental atual antes deste fechamento: `2648e00eb87fe230e10e1872531f6912aea38718`.
- SHA funcional validado: `ef93af7104bad1db2df719e63f2cd4da648c0c12`.
- Drift do SHA funcional ate o HEAD documental: somente documentacao SEC-1.
- PR #414 permanece draft, aberta e nao mergeada.

Compatible em producao:

- Deployment operacional: `a1bafb7e-fe99-43ab-a962-536078a70e7b`.
- Tempo em Compatible desde deployment final ate a coleta: aproximadamente 2.75h.
- `AUTH_SESSIONS_ENABLED=true`
- `AUTH_REFRESH_ROTATION_ENABLED=true`
- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`
- `AUTH_REFRESH_COOKIE_SAMESITE=lax`
- `AUTH_LEGACY_TOKEN_CUTOFF`: ausente

Health:

- `https://api.matopibalog.com.br/health`: 200
- `https://matopibalog-backend-production.up.railway.app/health`: 200

Observacao HTTP, janela 1h:

- Total HTTP: 88
- Caminho real app Flutter (`Dart`) com status 200:
  - `/auth/login`: 2
  - `/auth/me`: 14
  - `/fretes`: 10
  - `/despesas`: 10
  - `/abastecimentos`: 10
  - `/vales`: 10
  - `/fretes/localizacao/sessao`: 3 respostas 201
- `/auth/mobile/refresh`: 0 observado.
- `/auth/refresh`: 0 observado.
- Logs app relevantes na janela: apenas `ENOENT /painel_web/dist/index.html` residual, fora do escopo auth/session.
- CORS/CSRF: sem erros observados.
- Vazamento de segredo em logs app: 0 hits em auditoria de padroes.

Supabase agregado apos validacao manual:

- `android_real_session_created=false`
- Android `client_type=android` nao sintetico: total 0, ativo 0, revogado 0.
- App Flutter real criou sessoes SEC-1 nao sinteticas, mas registradas como `client_type=web`:
  - total 2
  - ativas 1
  - revogadas 1
  - primeira criacao aproximada: 2026-08-10T00:56:04Z
  - ultima criacao aproximada: 2026-08-10T00:58:19Z
  - ultima atividade aproximada: 2026-08-10T00:58:19Z
- Web real nao sintetico total acumulado: 3, ativas 2, revogadas 1.
- Evento `sessao_criada` web acumulado: 4, ultimo em 2026-08-10T00:58:19Z.
- Evento `sessao_criada` android acumulado: somente fixture anterior do Gate A.
- Evento `refresh_sucesso` android acumulado: somente fixture anterior do Gate A.

Interpretacao Android/app:

- O APK release correto atingiu o backend e executou login real com User-Agent de app Flutter (`Dart`) no deployment correto.
- Isso prova que o app real consegue autenticar e criar sessao SEC-1 nao sintetica.
- Porem a sessao foi persistida como `client_type=web`, nao `android`.
- Como `client_type=web` retorna refresh por cookie e nao `refresh_token` no JSON mobile, nao houve evidencia de refresh mobile real persistido pelo app.
- Portanto a arquitetura SEC-1 foi exercitada pelo app, mas o contrato Android/mobile ainda nao esta comprovado como correto para Gate B Strict.

Legacy residual pratico:

- Web real usa SEC-1 e possui sessoes reais nao sinteticas.
- Admin real compartilha o cliente web e middleware `verifyToken`; permanece inferido por uso operacional, sem contador separado por area admin.
- App real usa SEC-1, mas com classificacao `web`; isso impede fechar a prova Android/mobile.
- Nao foi encontrado consumidor legitimo conhecido que necessite do formato JWT legacy em scripts, workers, integracoes, automacoes ou clientes API auditados.
- Tokens legacy remanescentes podem ser tratados como sessoes antigas ainda nao relogadas, salvo evidencia contraria; o unico bloqueio pratico atual nao e integracao externa, e sim a comprovacao Android/mobile correta.

Strict isolado:

- Backend CI: PASS
- Frontend CI: PASS
- PG RPC Tests: PASS
- SEC-1 Browser E2E same-site: PASS
- App CI Flutter release: PASS
- Strict isolado ja validado em CI, sem ativacao em producao.

Rollback Strict documentado:

- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`
- Retorna para Compatible, nao para Legacy total.

### Decisao Pre-Gate-B Final

Resultado: **NO-GO objetivo para Gate B**.

Blocker unico:

- Sessao real do app Flutter foi criada em SEC-1, mas como `client_type=web`; ainda nao ha `client_type=android` nao sintetico nem refresh mobile real observado.

Menor acao necessaria para fechar:

- No APK release correto, executar **logout -> novo login** no app e informar o horario aproximado.
- Depois disso, reconsultar read-only:
  - `android_real_session_created=true/false`
  - sessao `client_type=android` ativa/revogada
  - `refresh_real_observed=true/false`

Se apos logout -> novo login o app continuar criando sessao `web`, o bloqueio deixa de ser evidencia pendente e passa a ser divergencia funcional do contrato mobile que deve ser corrigida antes do Gate B Strict.
