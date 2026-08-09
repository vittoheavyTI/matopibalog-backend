# SEC-1 Gate A - Compatible em producao

Data: 2026-08-09 19:07 -03:00

PR: #414 (`feat/sec-1-sessoes-revogaveis`)
Head validado: `34cf0b4e25756782a2db9fae17de46f6a1f3e403`
Base: `main` em `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`
Status da PR durante o gate: aberta, draft, nao mergeada.

## Escopo executado

- Migration `062_auth_sessions_revogaveis` aplicada no Supabase `rjahjogidyndphdxevom`.
- Pepper configurado no Railway sem exposicao de valor.
- Backend da PR publicado por upload local controlado no Railway.
- Modo Compatible ativado:
  - `AUTH_SESSIONS_ENABLED=true`
  - `AUTH_REFRESH_ROTATION_ENABLED=true`
  - `AUTH_REQUIRE_SESSION=false`
  - `AUTH_ALLOW_LEGACY_TOKENS=true`
  - `AUTH_REFRESH_COOKIE_SAMESITE=lax`
  - `AUTH_LEGACY_TOKEN_CUTOFF` ausente

## Deployments relevantes

- `06e09a5f-e4b2-470f-b44e-b8f57c7a7e33`: upload local da PR com sessoes ainda desligadas; sucesso.
- `6d966293-effd-4321-bf90-a43b5a25cba9`: redeploy automatico de variaveis a partir de `main`; nao usado como estado final.
- `74755e4b-e869-4ddb-b950-d74d9a00b0e6`: upload local da PR com Compatible ativo; sucesso e validacao funcional do Gate A.
- `a1bafb7e-fe99-43ab-a962-536078a70e7b`: upload local final do mesmo pacote/codigo para deixar o deployment mais recente em `SUCCESS`; estado final operacional.

Observacao operacional: dois deployments locais intermediarios sem `/backend` no pacote ficaram `FAILED` e nao assumiram trafego.

## Validacoes

### Infra e configuracao

- `https://api.matopibalog.com.br/health`: 200.
- `https://matopibalog-backend-production.up.railway.app/health`: 200.
- `https://api.matopibalog.com.br/planos/publicos`: 200.
- Logs de boot: `authMode='compatible'`, `sessionsEnabled=true`, `rotationEnabled=true`, `requireSession=false`, `allowLegacy=true`, `hasPepper=true`.
- CORS preflight de `https://matopibalog.com.br`: 204, `Access-Control-Allow-Origin=https://matopibalog.com.br`, credentials habilitado.

### Compatibilidade legado

- Token legado pre-ativacao continuou aceito em `/auth/me`: 200.
- Endpoint protegido admin com token legado: 200.
- Token hibrido/malformado com `sid` sem contrato SEC-1 valido: 401.

### Web

- Login real no painel web em `https://matopibalog.com.br/`: sucesso, dashboard carregado.
- Refresh web sintetico por cookie em `/auth/refresh`: 200.
- Resposta web contem access token e nao contem `refresh_token` no JSON.
- `Set-Cookie` do refresh web validado com `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/auth`.
- Access token emitido pelo refresh web aceito em `/auth/me`: 200.
- Logout da sessao web sintetica: 200.
- Access token da sessao web sintetica apos logout: 401.

### Mobile/Android

- Sessao Android sintetica criada pelo servico SEC-1.
- `/auth/mobile/refresh`: 200.
- Resposta mobile contem access token, refresh token e expiracao.
- Access token rotacionado aceito em `/auth/me`: 200.
- `/auth/sessions` com access token rotacionado: 200.
- Logout da sessao Android sintetica: 200.
- Access token Android apos logout: 401.
- Reuso do refresh antigo apos rotacao: 401.

### Banco e auditoria

Contagens agregadas apos os testes:

- `auth_sessions`: total 3, ativas 1, revogadas 2.
- `auth_sessions` por tipo: web 2, android 1.
- `auth_refresh_tokens`: total 5.
- `auth_event_audit`: total 9.
- Eventos auditados: `sessao_criada` 3, `refresh_sucesso` 2, `sessao_revogada` 2, `refresh_reuse` 1.

## Conclusao do Gate A

Gate A Compatible aprovado em producao.

O sistema esta em modo compativel: sessoes revogaveis e refresh rotation ativos para novos logins/sessoes, mantendo tokens legados aceitos. Nao houve ativacao do modo estrito, nao houve cutoff legado e a PR #414 permanece draft/nao mergeada.
