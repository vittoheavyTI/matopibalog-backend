# SEC-1 Pre-Gate-B - Observacao Compatible

Data: 2026-08-09 20:39 -03:00

PR: #414 (`feat/sec-1-sessoes-revogaveis`)
HEAD: `878b64e58a3ecfbba40844cb49bcfceff248c2eb`
Base conhecida: `main` em `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`
Estado da PR: aberta, draft, nao mergeada.

## Preflight

- `origin/main` permanece em `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`.
- `HEAD` local/remoto permanece em `878b64e58a3ecfbba40844cb49bcfceff248c2eb`.
- Drift de `34cf0b4e25756782a2db9fae17de46f6a1f3e403` ate `878b64e58a3ecfbba40844cb49bcfceff248c2eb`: somente documentacao.
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

Artifact release confirmado no GitHub Actions:

- Workflow run: `31339688594`
- Job: `93311312629`
- Artifact: `app-release-apk`
- Artifact ID: `9045522177`
- Artifact digest: `sha256:d2bd38bd39480455703362576fa6cf58897b70a842fe832193bc844a7a1a7ece`
- Source SHA: `878b64e58a3ecfbba40844cb49bcfceff248c2eb`
- Artifact expira em: `2026-08-16T22:40:55Z`
- Arquivo interno: `app-release.apk`
- Bytes do APK: `57312055`
- SHA-256 do APK: `ED9827AE73A8D1C5F280D39F6B0CD6559285499D01C7EA26BF8BA93128189DFD`

Checklist manual real: pendente de retorno do usuario.

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

## Strict isolado

Ambiente isolado CI:

- Run Browser E2E: `31339688555`
- Job: `93311312518`
- Head SHA: `878b64e58a3ecfbba40844cb49bcfceff248c2eb`
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

- Run Flutter: `31339688594`
- Job: `93311312629`
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
