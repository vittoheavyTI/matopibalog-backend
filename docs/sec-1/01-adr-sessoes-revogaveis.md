# ADR SEC-1 — Modelo de sessões revogáveis (access curto + refresh rotativo)

**Status:** Proposto (validação no Gate A) · **Data:** 2026-08-06 · **Contexto:** macrofrente SEC-1.

## Contexto e restrições reais (não teóricas)
- **Frontend** servido em `https://matopibalog.com.br` (GitHub Pages). **Backend** em `https://matopibalog-backend-production.up.railway.app` (Railway). São **sites cross-site** (eTLD+1 diferentes) → qualquer cookie de credencial precisa `SameSite=None; Secure` e o CORS precisa `Allow-Credentials` com origem específica.
- **App Flutter** (motorista) usa **Bearer + `flutter_secure_storage`**; cookies não se encaixam no modelo do app.
- Hoje (auditoria): JWT 7d stateless, sem sessão/revogação; web usa o JWT em `localStorage` (Bearer, `withCredentials:false`); logout só no cliente.
- Prioridade vinculante: **não quebrar login**, não deslogar indevidamente (429/5xx/rede), compatibilidade web+app, rollout reversível.

## Opções consideradas

### O1 — Bearer puro de curta duração, refresh no corpo (web guarda em localStorage)
- ✅ Simples; um único transporte; funciona igual web/app.
- ❌ O refresh (credencial de longa duração) ficaria em `localStorage` no web → **mesmo XSS-exposure de hoje** para o token mais sensível. Reduz TTL do access, mas não protege o refresh. **Rejeitado** para o web.

### O2 — Refresh em cookie HttpOnly (SameSite=None) para TUDO
- ✅ Web: refresh fora do alcance de JS/XSS.
- ❌ **App não usa cookie** de forma robusta; forçaria o app a um caminho artificial. ❌ Exige CSRF em todas as rotas se o access também fosse cookie. **Rejeitado** como modelo único.

### O3 — Híbrido transport-agnostic (ESCOLHIDO)
- **Access token = JWT curto (Bearer)**, idêntico para web e app, em **memória** (não em localStorage/prefs).
- **Refresh token = opaco, alta entropia, rotativo**, com **transporte por cliente**:
  - **Web:** cookie **HttpOnly; Secure; SameSite=None** no **domínio do backend** (Railway), enviado só para `/auth/refresh` e `/auth/logout` (path-scoped). JS/XSS não lê. As rotas de dados continuam **Bearer** (não-cookie) → **não são CSRF-áveis**; o CSRF fica restrito a `/auth/refresh`+`/auth/logout`, mitigado por (a) exigir origem/allowlist + método POST e (b) double-submit token opcional.
  - **App:** refresh em **`flutter_secure_storage`** (Keystore/Keychain), enviado explicitamente no corpo/header do `/auth/refresh`.
- ✅ Um **único modelo de sessão** no servidor; ✅ access idêntico nos dois clientes; ✅ refresh protegido conforme o melhor mecanismo de cada plataforma; ✅ compatível com o cross-site atual.

## Decisão
Adotar **O3** para o **modelo de sessão** (server-side `auth_sessions` + rotação de refresh com família e detecção de reuse; access JWT curto com `sid`; middleware valida a sessão). **Ressalva:** o **transporte web do refresh** (cookie cross-site na Railway × cookie same-site `api.matopibalog.com.br` × híbrido) fica **PENDENTE de prova empírica controlada** (ver adendo) — o backend é implementado **transport-agnostic** (adapters), sem fixar o transporte web e **sem** devolver refresh no body para o navegador.

## Parâmetros como **configuração por ambiente** (valores finais no Gate A)
Não fixar silenciosamente. Propostas iniciais fundamentadas (a ratificar no Gate A):
- `AUTH_ACCESS_TOKEN_TTL`: **10 min** (curto o suficiente para revogação rápida via expiração; refresh transparente cobre a UX).
- `AUTH_REFRESH_IDLE_TTL` (inatividade server-side): **web 30 min? / app 30 dias?** — **decisão de produto no Gate A** (o app precisa de sessão longa para motorista em campo; o painel admin, curta). Modelar **por `client_type`**.
- `AUTH_REFRESH_ABSOLUTE_TTL`: **30 dias** (web) / **90 dias** (app) — ratificar.
- Retenção de sessões revogadas/expiradas: **90 dias** para auditoria, depois limpeza.

## Claims do access token (JWT)
`sub`(uid) · `sid`(session id) · `jti` · `role` · `is_super_admin` · `token_use='access'` · `iss` · `aud` · `iat` · `exp`.
`empresa_id` **continua derivado no servidor** (tenant.js) — não é fonte de verdade no token.

## Middleware (novo fluxo, com medição)
Assinatura+`iss`+`aud`+`algorithms:['HS256']`+`exp`+`token_use`+`sid` → carrega sessão → valida `revoked_at IS NULL`, `idle_expires_at`, `absolute_expires_at`, usuário ativo, papel/tenant atuais → `req.user` de **fonte confiável** (sessão/DB), não só do token. Fundir com o lookup de `verificarEmpresa` para evitar query extra. **Sem cache que mantenha sessão revogada válida por período longo** (prioridade = revogação efetiva). Índice em `auth_sessions(id)` (PK) sustenta o lookup.

## Compatibilidade e rollout (2 gates)
- **Modo compatível** (`AUTH_REQUIRE_SESSION=false`, `AUTH_ALLOW_LEGACY_TOKENS=true`): novos logins emitem sessão (access curto + refresh); `verifyToken` aceita **tanto** token legado 7d (sem `sid`) **quanto** access novo (com `sid` → valida sessão). Nenhuma interrupção. Métrica distingue legado × novo.
- **Modo estrito** (`AUTH_REQUIRE_SESSION=true`, cutoff): exige `sid`+sessão válida; legados rejeitados após `AUTH_LEGACY_TOKEN_CUTOFF`. Só após web+app validados e app compatível distribuído.

## CORS / cookies (mudanças necessárias, Gate A)
- `/auth/refresh` e `/auth/logout` no web → `withCredentials:true` (cookie do backend). CORS: origem específica `https://matopibalog.com.br` + `Access-Control-Allow-Credentials: true`. As demais rotas seguem Bearer (`withCredentials:false`).
- Cookie de refresh: `HttpOnly; Secure; SameSite=None; Path=/auth`. Avaliar `__Host-`/partitioned onde suportado.

## Consequências
- ✅ Logout/troca de senha/bloqueio/mudança de papel revogam sessões efetivamente.
- ✅ Blast radius de XSS reduzido (access curto em memória; refresh fora do JS no web).
- ➕ +1 lookup de sessão por request (mitigado fundindo com tenant; índice PK).
- ➕ Complexidade de rotação/concorrência (tratada com single-flight + família + tolerância curta documentada).
- ➖ App exige nova versão compatível antes do modo estrito (não publicar sem gate).

## Secrets adicionais (criar só no Gate A, no Railway; nunca no frontend)
`AUTH_REFRESH_PEPPER` (pepper do hash do refresh) · possivelmente `AUTH_COOKIE_SECRET`/`AUTH_CSRF_SECRET`. `JWT_SECRET` reutilizado para o access (ou novo `AUTH_ACCESS_SECRET` — decidir no Gate A).

---

## Adendo (2026-08-06) — Evidência real do transporte web (item 5 do complemento vinculante)

**Fatos medidos no ambiente real:**
- Frontend `https://matopibalog.com.br` (eTLD+1 `com.br`) e API `https://matopibalog-backend-production.up.railway.app` (eTLD+1 `railway.app`) são **cross-site**.
- `server.js` já usa CORS com **origem específica** (`allowedOrigins` inclui `https://matopibalog.com.br`, nunca `*`) e **`credentials: true`**; `cookie-parser` ativo; o login já emite cookie `token` `{ httpOnly, secure, sameSite:'none', maxAge 7d }`. Ou seja, a infraestrutura de cookie credenciado cross-site **já existe** — o SPA só não a usa (`api.ts withCredentials:false`).
- **Teste exploratório (NÃO conclusivo):** `fetch(API + '/auth/me', { credentials:'include' })` **sem** `Authorization` → HTTP 401 e `document.cookie` vazio. ⚠️ **Este teste NÃO prova bloqueio de cookie cross-site**, porque: `document.cookie` não exibe cookies HttpOnly; o login atual do SPA usa `withCredentials:false` (o cookie pode nunca ter sido armazenado); a sessão do navegador estava degradada; e um 401 isolado **não distingue** cookie bloqueado × ausente × expirado. Serve apenas como sinal a investigar, não como conclusão.

**Classificação:** o transporte web definitivo está **PENDENTE DE PROVA EMPÍRICA CONTROLADA** (ver §"Teste controlado do cookie" abaixo). **Não implementar o transporte web definitivo antes do teste correto.** `api.matopibalog.com.br` (same-site) permanece a **opção recomendada, não a decisão final**. Em nenhuma hipótese o refresh token web será guardado em `localStorage`/`sessionStorage`/`IndexedDB` ou qualquer estado acessível a JavaScript.

### Teste controlado do cookie (requisito PRÉ-Gate A — a executar em homologação)
Roteiro (o agente NÃO insere senha; login feito pelo usuário/conta de homologação):
1. login com `credentials:'include'`; 2. confirmar resposta do login; 3. inspecionar **Set-Cookie no Network**; 4. confirmar armazenamento na aba **Application**; 5. conferir atributos (**HttpOnly/Secure/SameSite/Path/Domain/Max-Age**); 6. `/auth/me` sem `Authorization`; 7. `refresh` sem `Authorization`; 8. logout; 9. comprovar remoção do cookie; 10. repetir com **cookies de terceiros permitidos**; 11. repetir com **terceiros bloqueados**; 12. verificar **Chrome Issues**; 13. verificar **CORS/preflight**; 14. **não** usar `document.cookie` como prova. Se não houver conta/sessão de homologação disponível agora, o teste fica **registrado como requisito pré-Gate A** e a arquitetura de transporte **não** é declarada decidida.

**Opções para o Gate A (a decidir com o usuário):**
- **B (recomendada): API em subdomínio do próprio site** — `api.matopibalog.com.br` (custom domain no Railway, apontando o DNS na Hostinger). Front + API passam a ser **same-site** → cookie `Secure; SameSite=Lax|None` é **first-party** e confiável; CSRF mitigado por SameSite + verificação de origem. **Requer DNS/custom domain/cert = Gate A** (não alterar antes).
- **A: manter Railway + cookie cross-site** — só se comprovado confiável em teste controlado (login que seta o cookie + reenvio credenciado). Risco alto de bloqueio de terceiros; **não adotar sem prova**.
- **C: híbrido** — refresh no corpo também no web, guardado em memória volátil + re-login ao recarregar (sem persistência); pior UX, mas evita cookie e localStorage. Fallback se B não for viável.

**Impacto no andamento:** a **camada de sessão backend permanece transport-agnostic** (emite access curto + refresh; para o app o refresh vai no corpo → secure storage; para o web o transporte fica pendente do Gate A). **Task G (cliente web) fica limitada** à lógica de single-flight/interceptor/abstração de storage, sem fixar o transporte, até a decisão B/A/C no Gate A. Backend, Postgres, flags e app seguem normalmente.

---

## Adendo 2 (2026-08-06) — Hardening da migration 062 (complemento vinculante)
- **Sem relógio injetável**: `rotacionar_refresh_token` removeu `p_agora`; usa `now()` (transaction_timestamp). Nenhum timestamp/`used_at`/deadline/classificação vem do HTTP/frontend. Testes de limite são determinísticos ajustando `used_at` na MESMA transação (now() constante), sem sleep.
- **Janela de graça server-side + validada** em [0,300]s (NULL/inválida → `grace_invalido`); default de código 10s; valor final no Gate A. Ver `02-auditoria-retencao-e-graca.md`.
- **Auditoria append-only REAL** (`auth_event_audit`): triggers UPDATE/DELETE + TRUNCATE; service_role só INSERT+SELECT (42501 no resto) e não-owner; sem token/hash/cookie/Authorization/OTP/senha; limites de tamanho; campos nullable p/ eventos sem sessão. **Auditoria sobrevive ao resultado** (retorno estruturado; sem RAISE de domínio) e rola back junto em erro inesperado (sem auditoria enganosa).
- **Retenção**: sem purge automático nesta etapa; backend normal não limpa auditoria; proposta de purge controlado (papel de manutenção separado) no Gate A.
- **Mapeamento HTTP** (backend): ok→200, refresh_already_rotated→409, reuse_detected→401, expirado/revogado/sessao_invalida/invalido→401, erro SQL→500 sanitizado.
- Validado em Postgres real: **CI 45/45** (24 matriz + 21 auth).
