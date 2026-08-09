# SEC-1 - Gate A0 - API same-site

Status: Gate A0 em execucao controlada em 2026-08-09; DNS, Railway, HTTPS e
backend A0 ja validados.

Escopo: preparar a migracao do transporte web de refresh para API same-site em
`https://api.matopibalog.com.br`, sem alterar Railway compartilhado, DNS,
GitHub Pages, secrets, banco compartilhado ou producao.

## 1. HEAD

- HEAD de entrada auditado: `56c18e6dee81b81d9f63b4c3b200f2e0010bb6fc`.
- Branch: `feat/sec-1-sessoes-revogaveis`.
- PR: `#414`, aberto, draft, `NAO MERGEAR`.

## 2. origin/main

- `origin/main`: `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`.
- Drift desde o baseline historico informado: nao observado no refresh local de
  `2026-08-08`.

## 3. Railway atual

Auditado por `railway status`, configuracao versionada e health publico.

- Workspace: `vittoheavyti's Projects`.
- Projeto: `scintillating-magic`.
- Ambiente: `production`.
- Servico backend existente: `matopibalog-backend`.
- Dominio Railway atual: `https://matopibalog-backend-production.up.railway.app`.
- Regiao exibida: `sfo`.
- Service ID exibido: `f6ffc138-0901-4eae-9e97-69b86d583284`.
- Deployment ID exibido: `d3b9593f-6c53-4260-a088-ad3f449c4788`.
- Health endpoint: `/health`.
- Health atual: `200`, body `{"status":"UP",...}`.
- Deploy versionado: `backend/railway.toml`, Nixpacks, `npm install`,
  `node server.js`, restart `on_failure`, max retries `10`.
- Porta interna: `process.env.PORT || 3000`; Railway injeta `PORT`.
- Cron jobs visiveis no status: `cron-notificacao-inadimplencia`,
  `vivacious-flow`, `radiant-warmth`. Nao fazem parte do Gate A0.

Nao auditado sem painel/valores sensiveis:

- serverless state;
- replicas efetivas;
- custom domains existentes alem do dominio Railway exibido;
- lista completa de env vars de CORS/auth, porque comandos de variaveis podem
  expor secrets.

Esses itens exigem inspecao manual no Railway Dashboard antes da execucao.

## 4. DNS atual

Auditado por DNS read-only.

- Nameservers: `artemis.dns-parking.com`, `hermes.dns-parking.com`.
- Administracao inferida: Hostinger (`dns.hostinger.com` no SOA).
- TTL NS: `600`.
- Raiz `matopibalog.com.br`: A records GitHub Pages
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
  `185.199.111.153`, TTL `600`.
- `www.matopibalog.com.br`: CNAME `vittoheavyti.github.io`, TTL `600`.
- `api.matopibalog.com.br`: NXDOMAIN para CNAME e A no momento da auditoria.
- Conflito atual para `api`: nenhum registro A/AAAA/CNAME/TXT visivel.
- Impacto em GitHub Pages: nenhum se a alteracao ficar restrita a `api`.
  Nao alterar raiz, `www` ou CNAME do Pages.

## 5. Dominio proposto

- Novo dominio: `api.matopibalog.com.br`.
- Mesmo site registravel do frontend: `matopibalog.com.br`.
- Origens continuam diferentes:
  `https://matopibalog.com.br` e `https://api.matopibalog.com.br`.
- CORS continua obrigatorio.

## 6. Alteracoes Railway propostas

Executar somente apos autorizacao:

1. Adicionar `api.matopibalog.com.br` como custom domain no mesmo servico
   `matopibalog-backend`.
2. Nao criar segundo backend permanente.
3. Nao criar novo banco.
4. Manter `https://matopibalog-backend-production.up.railway.app` ativo durante
   transicao e rollback.
5. Esperar Railway emitir o certificado HTTPS.

Registros DNS exigidos pelo Railway:

- CNAME: `VALOR FORNECIDO PELO RAILWAY NO MOMENTO DA EXECUCAO`.
- TXT de verificacao: `VALOR FORNECIDO PELO RAILWAY NO MOMENTO DA EXECUCAO`.
- TTL sugerido: registrar se fornecido pelo Railway.
- Status de verificacao: registrar durante a execucao.

## 7. Alteracoes DNS propostas

Executar somente apos o Railway fornecer o alvo/verificacao:

- Criar somente os registros solicitados pelo Railway para
  `api.matopibalog.com.br`.
- CNAME: usar exatamente o nome/valor fornecido pelo Railway.
- TXT de verificacao: usar exatamente o nome/valor fornecido pelo Railway.
- TTL: usar o sugerido pelo Railway/Hostinger, se houver; registrar o valor
  efetivo aplicado.
- Nao alterar `matopibalog.com.br`.
- Nao alterar `www.matopibalog.com.br`.
- Nao alterar CNAME/Pages.

## 8. Alteracoes backend propostas/preparadas

Preparado no branch:

- `AUTH_REFRESH_COOKIE_SAMESITE` permite `none` ou `lax`.
- Default permanece `none`, preservando o comportamento atual ate autorizacao.
- O cookie web de refresh usa a configuracao em login e refresh.
- Mobile continua usando refresh no body, sem depender desse cookie.

Alteracao operacional futura, somente apos dominio/cert/health:

- Definir `AUTH_REFRESH_COOKIE_SAMESITE=lax` no backend aprovado.
- Manter `AUTH_WEB_ALLOWED_ORIGINS` com origens exatas aprovadas.

## 9. Cookie BEFORE / AFTER

BEFORE atual:

- Nome: `refresh_token`.
- `HttpOnly`.
- `Secure`.
- `SameSite=None`.
- `Path=/auth`.
- Host-only no dominio atual do backend Railway.
- Refresh nao vai no JSON web.

AFTER proposto para web same-site:

- Nome: `refresh_token`.
- `HttpOnly`.
- `Secure`.
- `SameSite=Lax`.
- `Path=/auth`.
- Host-only em `api.matopibalog.com.br`.
- Sem atributo `Domain`.
- Nao renomear para `__Host-` nesta etapa, porque o contrato atual usa
  `Path=/auth`.

## 10. CORS BEFORE / AFTER

BEFORE:

- `credentials: true`.
- Allowed origins por `AUTH_WEB_ALLOWED_ORIGINS` ou fallback local que inclui
  `FRONTEND_URL`.
- Fallback de producao esperado: `https://matopibalog.com.br`.
- Sem wildcard com credenciais.

AFTER:

- Continuar `credentials: true`.
- Permitir exatamente `https://matopibalog.com.br` e apenas origens oficiais
  realmente necessarias.
- Nao adicionar `www` por garantia; validar se e usado.
- Nao usar `*`.

## 11. CSRF BEFORE / AFTER

BEFORE:

- `/auth/refresh` valida `Origin` ou `Referer` contra `webOrigins`.
- Sem `Origin` e sem `Referer`: rejeicao segura.
- Origin invalido: `403 CsrfRejected`.

AFTER:

- Manter a mesma defesa.
- SameSite=Lax reduz dependencia de third-party cookie, mas nao substitui CSRF.
- E2E deve provar Origin valido, Origin invalido e ausencia de Origin/Referer.

## 12. VITE_API_URL BEFORE / AFTER

BEFORE:

- Deploy Pages usa `.github/workflows/static.yml`.
- Build injeta `VITE_API_URL` a partir de `${{ secrets.VITE_API_URL }}`.
- Fallback em codigo: `https://matopibalog-backend-production.up.railway.app`.
- CSP em `painel_web/index.html` permite o dominio Railway atual.

AFTER proposto:

- `VITE_API_URL=https://api.matopibalog.com.br`.
- Atualizar CSP `connect-src` para permitir a nova API antes do build/deploy.
- Executar somente depois de DNS, certificado e `/health=200`.

## 13. Impacto mobile

- Nenhuma alteracao de base URL mobile no Gate A0.
- App usa contrato mobile de refresh no body/secure storage.
- Artifact historico `app-release-apk` ID `9027994705`, do HEAD `d1239f9`,
  foi usado como evidencia anterior e permanece apenas como referencia historica.
- Artifact release mais recente no HEAD `56c18e6`: `app-release-apk`, ID
  `9029011799`, digest
  `sha256:70660ad8a93c6a29edfbb888565edc58f30b8e68c5938d7d58a9f67357e831d2`.
- O workflow GitHub produz build Flutter com `flutter build apk --release`,
  mas a configuracao Android atual usa `signingConfigs.getByName("debug")` para
  release. Nao alterar signing neste Gate; fechamento de signing mobile e assunto
  separado de SEC-1/mobile.
- Em 2026-08-09, o usuario reportou build Codemagic baixado, instalado e
  validado inicialmente como normal.

## 14. Ordem de execucao futura

A. Configurar custom domain no Railway.

B. Aplicar DNS `api.matopibalog.com.br` com valores fornecidos pelo Railway.

C. Esperar DNS e certificado.

D. Validar `https://api.matopibalog.com.br/health` sem alterar frontend.

E. Validar endpoints publicos nao destrutivos.

F. Configurar backend allowed origins/cookie conforme Gate aprovado.

G. Deploy controlado da branch/SHA aprovado, quando aplicavel.

H. Validar backend pelo novo dominio.

I. Alterar `VITE_API_URL` do frontend.

J. Build/deploy frontend.

K. Browser smoke autenticado.

Nunca inverter frontend apontando para dominio ainda nao funcional.

## 15. Downtime esperado

- Antes de alterar frontend: zero downtime esperado, pois o Pages continua
  apontando para o Railway atual.
- Depois de alterar frontend: risco limitado a propagacao DNS/cert/config.
  Por isso a troca de `VITE_API_URL` fica por ultimo.

## 16. Riscos

- Railway exigir CNAME/TXT especifico ainda desconhecido ate criar custom domain.
- Certificado demorar a emitir.
- Secret `VITE_API_URL` ou CSP ficarem divergentes.
- `www` ser usado por usuarios e precisar decisao explicita de origem CORS.
- E2E indicar que a simulacao same-site esta incorreta.
- Cookie antigo `SameSite=None` em navegadores pode coexistir ate nova emissao;
  logout/refresh devem limpar pelo mesmo nome/path/host.

## 17. Rollback

Se o problema ocorrer antes do frontend apontar para `api`:

- Nenhum impacto esperado; frontend segue no dominio Railway.

Se ocorrer depois:

1. Restaurar `VITE_API_URL` para
   `https://matopibalog-backend-production.up.railway.app`.
2. Restaurar cookie/CORS compativel anterior se necessario.
3. Redeploy frontend/backend em SHAs aprovados.
4. Manter ou remover custom domain depois, sem pressa.
5. Nao apagar DNS primeiro se a aplicacao ainda depender dele.

## 18. Validacoes

Executadas localmente nesta preparacao:

- Backend focado SEC-1 auth/cookie: `44/44` passou.
- Frontend build/typecheck: passou, com aviso conhecido de chunk grande.
- Frontend Vitest: `73/73` passou.
- E2E SEC-1 local: pulou por `DATABASE_URL` ausente, como esperado.

Validacoes obrigatorias em CI apos push:

- Backend full.
- Frontend tests.
- Frontend typecheck/build.
- PG RPC.
- Flutter CI.
- SEC-1 Browser E2E SAME-SITE.

## 19. E2E same-site local/CI

Preparado no branch:

- Frontend local HTTPS: `https://app.matopibalog.test`.
- API local HTTPS: `https://api.matopibalog.test`.
- Mesma site registravel, origens diferentes.
- PostgreSQL 16 efemero no CI.
- Migration 062 aplicada apenas no banco efemero do CI.
- Login web prova access no body e refresh ausente do JSON.
- Cookie esperado: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/auth`,
  host-only no host da API.
- Refresh prova cookie enviado, sem Bearer, rotacao e `no-store`.
- Duas abas provam `RefreshAlreadyRotated` recuperavel.
- Reuse fora da grace prova `RefreshReuseDetected`.
- Logout prova revogacao server-side e remocao de cookie.
- CSRF/CORS/cache permanecem cobertos.
- Fluxo com third-party cookies bloqueados deve continuar passando; se falhar,
  classificar como simulacao/arquitetura incorreta e parar.

## 20. Tudo que exige autorizacao

Autorizado para execucao A0 em 2026-08-09:

- Criar custom domain no Railway.
- Criar registros DNS `api.matopibalog.com.br` fornecidos pelo Railway.
- Alterar env vars Railway/shared, incluindo
  `AUTH_REFRESH_COOKIE_SAMESITE=lax` ou CORS oficial.
- Alterar GitHub secret `VITE_API_URL`.
- Alterar/deployar frontend Pages.
- Alterar CSP de producao para o novo dominio.

Segue exigindo autorizacao posterior fora do A0:

- Qualquer aplicacao de migration 062 em banco compartilhado.
- Qualquer merge do PR #414.

GATE A0 - EM EXECUCAO AUTORIZADA.

## 21. Execucao A0 - evidencias parciais

Executado em 2026-08-09, sem alterar raiz, `www`, MX, SPF, DKIM, DMARC,
nameservers, banco compartilhado, flags SEC-1 de sessao, Gate B, Asaas ou app
mobile.

Railway custom domain:

- Dominio: `api.matopibalog.com.br`.
- Service ID: `f6ffc138-0901-4eae-9e97-69b86d583284`.
- Domain ID: `63a563a2-f372-4875-9fb8-a44cdb599a9b`.
- Status Railway: `syncStatus=ACTIVE`.
- Verificacao Railway: `verified=true`.
- Certificado: `CERTIFICATE_STATUS_TYPE_VALID`,
  `CERTIFICATE_STATUS_TYPE_DETAILED_COMPLETE`.
- Certificado emitido para: `api.matopibalog.com.br`.
- Certificado SHA-256: `61b82bfc599581b34d55a7a97a23377dea6764eb76f9d6f72595d57ad82684af`.
- Validade informada: `2026-08-09T17:23:22Z` a `2026-11-07T17:23:21Z`.

DNS aplicado na Hostinger:

- CNAME `api` -> `k45k7l41.up.railway.app`, TTL `14400`.
- TXT `_railway-verify.api` -> `railway-verify=<mascarado>`, TTL `14400`.
- Propagacao observada em `artemis.dns-parking.com`,
  `hermes.dns-parking.com`, `1.1.1.1` e `8.8.8.8`.

HTTPS e endpoints:

- `https://api.matopibalog.com.br/health`: HTTP 200, TLS valido.
- `https://matopibalog-backend-production.up.railway.app/health`: HTTP 200.
- `GET /configuracoes/public`: HTTP 200 nos dois dominios, mesmo tamanho
  observado (`100773` bytes).
- `GET /planos/publicos`: HTTP 200 nos dois dominios, mesmo tamanho observado
  (`9691` bytes).

Backend A0 aplicado:

- Deployment ID apos variaveis A0: `83e272ca-73dd-42ee-9679-6046e90e52dd`.
- Service status: `SUCCESS`.
- `AUTH_REFRESH_COOKIE_SAMESITE=lax`.
- `AUTH_WEB_ALLOWED_ORIGINS=https://matopibalog.com.br`.
- `FRONTEND_URL=https://matopibalog.com.br` preservado.
- `AUTH_SESSIONS_ENABLED`, `AUTH_REQUIRE_SESSION` e
  `AUTH_REFRESH_ROTATION_ENABLED` nao foram ativados neste Gate.
- CORS preflight `OPTIONS /auth/login` com
  `Origin: https://matopibalog.com.br`: HTTP 204, `credentials=true`,
  `access-control-allow-origin` exato e sem wildcard.

Source frontend:

- `painel_web/index.html`: `connect-src` passou a permitir
  `https://api.matopibalog.com.br`, mantendo o dominio Railway antigo para
  rollback.
- `painel_web/src/api.ts`: fallback versionado passou a
  `https://api.matopibalog.com.br`.
- `painel_web/dist` nao deve ser commitado no PR.

Validacoes locais executadas:

- Backend full: `node --test`, `1200/1200` passou.
- Frontend tests: `npm.cmd test`, `73/73` passou.
- Frontend typecheck/build: `npm.cmd run build` com
  `VITE_API_URL=https://api.matopibalog.com.br`, passou.
- PG local: `npm.cmd run test:pg`, `3` testes pulados por `DATABASE_URL`
  ausente; validacao real fica no workflow PG com Postgres efemero.
- Flutter local: `flutter analyze` passou; `flutter test` passou (`59/59`).
  Build APK local nao e prova de Gate nesta maquina porque nao ha Android SDK
  local; o build Android valido fica no workflow `App CI`.
- SEC-1 E2E local: pulado por `DATABASE_URL` ausente; validacao real fica no
  workflow `SEC-1 Browser E2E` com Postgres efemero.

Pendencias para fechamento A0:

- Alterar secret GitHub `VITE_API_URL` para
  `https://api.matopibalog.com.br`.
- Push do commit A0 no PR `#414`.
- CI remoto verde: Backend, Frontend, PG RPC, App CI, SEC-1 Browser E2E.
- Deploy GitHub Pages via workflow oficial.
- Smoke de producao em `https://matopibalog.com.br`.
