# SEC-1 — Runbook do Gate A Compatible

Status: rascunho operacional para aprovação. Não executar em ambiente compartilhado sem Gate A aprovado.

## Escopo

Ativar SEC-1 em modo compatible:

- `AUTH_SESSIONS_ENABLED=true`
- `AUTH_REFRESH_ROTATION_ENABLED=true`
- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`

O modo strict fica fora do Gate A.

## Pré-condições obrigatórias

- PR #414 em draft, com HEAD aprovado e CI verde.
- Migration `062_auth_sessions_revogaveis.sql` validada em PostgreSQL efêmero.
- Nenhuma alteração pendente de `painel_web/dist` incluída sem auditoria de publicação.
- `origin/main` revalidado antes do Gate A.
- Conta/sessão de homologação disponível para prova web e mobile.
- Janela de observação definida antes de qualquer merge/deploy.

## Variáveis de ambiente

Valores propostos no Gate A, sem segredos no repositório:

- `JWT_SECRET`: já existente, obrigatório.
- `AUTH_SESSIONS_ENABLED=true`
- `AUTH_REFRESH_ROTATION_ENABLED=true`
- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`
- `AUTH_REFRESH_TOKEN_PEPPER`: novo segredo forte, backend-only.
- `AUTH_WEB_ALLOWED_ORIGINS`: origens oficiais do painel web, separadas por vírgula.
- `AUTH_ISSUER`: valor oficial do backend.
- `AUTH_AUDIENCE`: valor oficial dos clientes Matopiba.
- `AUTH_ACCESS_TOKEN_TTL_SECONDS`
- `AUTH_REFRESH_IDLE_TTL_SECONDS`
- `AUTH_REFRESH_ABSOLUTE_TTL_SECONDS`
- `AUTH_REFRESH_REUSE_GRACE_SECONDS`
- `AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS`

## Ordem de execução

1. Confirmar SHA do PR, SHA de `origin/main` e diff final.
2. Executar todas as suítes locais possíveis.
3. Confirmar CI verde: backend, frontend, PostgreSQL RPC e Flutter Android.
4. Aprovar Gate A.
5. Aplicar migration 062 no banco compartilhado aprovado.
6. Validar schema, RLS, grants e RPCs no banco alvo.
7. Configurar secrets/flags em modo compatible.
8. Fazer deploy do SHA aprovado.
9. Validar health e logs de startup com summary seguro de auth.
10. Executar validações web, mobile, admin e legacy.
11. Observar logs por janela definida.

## Provas web obrigatórias

- Login com `credentials: include`.
- `Set-Cookie` de `refresh_token` no Network.
- Cookie armazenado no navegador, com `HttpOnly`, `Secure`, `SameSite=None`, `Path=/auth`.
- `/auth/refresh` funciona sem Bearer antigo e retorna somente access token.
- Refresh rejeita Origin/Referer não autorizado.
- Logout revoga sessão e limpa cookie.
- `document.cookie` não é usado como prova de cookie HttpOnly.
- Registrar comportamento com cookies de terceiros permitidos e bloqueados.
- Verificar DevTools Issues e CORS/preflight.

## Provas mobile obrigatórias

- Login envia `client_type` `android`/`ios`.
- Refresh token recebido somente no canal mobile.
- Refresh persistido apenas em `flutter_secure_storage` quando `manterConectado=true`.
- 401/403 tenta refresh uma vez e não entra em loop.
- Logout limpa access e refresh.
- Sessão revogada retorna para login sem apagar sessão por falha offline/transitória.

## Rollback

Aplicação:

- Reverter flags para legacy:
  - `AUTH_SESSIONS_ENABLED=false`
  - `AUTH_REFRESH_ROTATION_ENABLED=false`
  - `AUTH_REQUIRE_SESSION=false`
  - `AUTH_ALLOW_LEGACY_TOKENS=true`
- Redeploy do SHA anterior se houver regressão de aplicação.

Banco:

- Preferir rollback lógico via flags quando a migration já recebeu dados.
- Não dropar tabelas com dados reais sem decisão explícita.
- Se a migration foi aplicada e não recebeu dados reais, seguir o bloco de reversão comentado na própria `062`.

Frontend/mobile:

- Web volta a depender apenas do access legado enquanto compatible/legacy estiver ligado.
- Mobile limpa refresh local em logout ou falha definitiva de sessão.

## Observabilidade

Verificar que logs não contêm:

- refresh token aberto;
- hash de refresh;
- cookie completo;
- Authorization header;
- senha, OTP ou segredo.

Eventos esperados em `auth_event_audit`:

- `sessao_criada`
- `refresh_sucesso`
- `refresh_colisao`
- `refresh_reuse`
- `sessao_revogada`
- `sessoes_usuario_revogadas`

## Hard stops

Parar antes de deploy/merge se ocorrer:

- CI vermelho;
- migration 062 falhando em banco efêmero;
- cookie web inviável sem decisão de arquitetura;
- CSRF/CORS inconclusivo;
- segredo ausente;
- drift material em auth/mobile/web;
- `painel_web/dist` não auditado quando necessário para publicação.
