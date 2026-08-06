# SEC-1 — Checkpoint A (Baseline) + Checkpoint B (Auditoria do modelo atual)

> Macrofrente **SEC-1 — Sessões Revogáveis e Endurecimento da Autenticação**.
> Branch: `feat/sec-1-sessoes-revogaveis` · Base: `origin/main` = `567fcc61864a1f4e6f5e469fb8171eb84ac0647d`.
> Documento read-only de auditoria. **Nenhuma edição de comportamento aqui.**

---

## 1. CHECKPOINT A — Baseline (revalidado, não presumido)

### 1.1 Git / repositório
- Repo canônico: `C:/Projetos/matopibalog-backend` (monorepo backend + `painel_web` + `app_android`).
- `origin/main` = **`567fcc6`** (merge do PR #413 / 2C-D). **Não avançou** desde o encerramento do 2C-D (0 commits novos).
- Worktree SEC-1: `C:/Projetos/matopibalog-sec-1` em `feat/sec-1-sessoes-revogaveis`, criado a partir de `567fcc6`, limpo.
- PRs abertos (nenhum conflita com SEC-1): #405 (app contrato autônomo — 3A), #272 (app scanner), #217 (sidebar tema escuro). Todos de app/estilo.
- Workflows em `main` para `567fcc6`: **4 CIs verdes** — Backend CI, Frontend CI, Deploy to GitHub Pages, PG RPC Tests.

### 1.2 Produção
- Backend Railway deploy = **`567fcc6`** (SUCCESS). `/health` = **200** `{"status":"UP"}`.
- GitHub Pages deploy (`github-pages`) = **`567fcc6`**. Site `matopibalog.com.br` no ar.
- **Tudo alinhado em `567fcc6`.**

### 1.3 Migrations (Supabase prod `rjahjogidyndphdxevom`)
- Última aplicada: **`061_matriz_publicacao_transacional`** (`20260805211416`).
- **Próxima migration SEC-1 = `062`.**

### 1.4 Runtimes / suítes
- Node **v24.18.0**, npm 11.16.0. `jsonwebtoken` **^9.0.2** (suporta `issuer`/`audience`/`algorithms` — necessário para o hardening).
- Backend: **103** arquivos `tests/*.test.js` (runner `node --test`). *(Contagem numérica total de casos a coletar em execução dedicada.)*
- Frontend: Vitest (memória 2C-D: ~57–67 casos) + `tsc -b` + `vite build`.
- Postgres RPC CI: service container efêmero (2C-D deixou o padrão em `.github/workflows/pg-rpc-ci.yml`).
- **Flutter NÃO está no PATH** deste ambiente (CLAUDE.md: precisa extrair o SDK manualmente). ⚠️ Constraint real: o código Dart pode ser escrito/analisado, mas `flutter test`/`analyze`/`build` exigem o SDK — a validação do app dependerá de ambiente com Flutter (ou do CI mobile / Codemagic).

---

## 2. CHECKPOINT B — Auditoria do modelo de autenticação atual

### 2.1 Visão geral (modelo hoje)
JWT **stateless de longa duração (7 dias)**, sem sessão no servidor, sem refresh, com logout apenas no cliente. Transporte duplo: cookie httpOnly (web, na teoria) e Bearer (app e, na prática, também web).

### 2.2 LOGIN — `backend/controllers/authController.js` → `exports.login`
- Autentica no Supabase Auth (`signInWithPassword`, client isolado `supabaseAuth`).
- Carrega perfil de `usuarios` (embed `empresas!usuarios_empresa_id_fkey`).
- Bloqueia `status === 'bloqueado'` → 403.
- **Assina JWT** (`jwt.sign`, HS256 default, `JWT_SECRET`) com claims:
  `{ uid, email, role: <usuarios.tipo>, is_super_admin }` e **`expiresIn: '7d'`**.
  - **Ausentes:** `sid`/`jti`/`iss`/`aud`/`token_use`/`empresa_id`.
- Grava **cookie `token`** `{ httpOnly, secure, sameSite:'none', maxAge 7d }` **e** devolve `token` no body (para o app Flutter).

### 2.3 MIDDLEWARE — `backend/middlewares/auth.js`
- `verifyToken`: token de **cookie `token`** OU **`Authorization: Bearer`** → `jwt.verify(token, JWT_SECRET)` → `req.user = decoded` (payload inteiro).
  - Sem token → **401**; inválido/expirado → **403** `{ error:'Token inválido ou expirado.' }`.
  - **Sem `issuer`/`audience`/`algorithms` explícitos** no verify (aceita o default; risco de algorithm confusion mitigável).
  - **NENHUMA consulta a sessão, NENHUMA verificação de revogação.** ← núcleo a mudar.
- `isAdmin`: `req.user.role === 'admin'`. `isSuperAdmin`: `req.user.is_super_admin === true`. **Ambos confiam no claim do token** (congelado por 7 dias).

### 2.4 TENANT — `backend/middlewares/tenant.js`
- `verificarEmpresa`: super-admin pode `?empresa_id=` (impersonar); caso contrário `empresa_id` é **derivado do DB por `uid`** (`select empresa_id from usuarios where id=uid`) a cada request.
- ✅ Bom: `empresa_id` **não** vem do token. Porém há **1 query extra por request tenant-scoped** — oportunidade de fundir com o lookup de sessão do novo middleware.

### 2.5 LOGOUT — `authController.logout` + web/app
- Backend: apenas `res.clearCookie('token')`. **Zero revogação server-side.**
- Web (`AuthContext.logout`): `POST /auth/logout` (best-effort) + `localStorage.removeItem('auth_token')` + limpa cache per-tenant. **Sem BroadcastChannel** (outras abas não deslogam).
- App (`auth_provider.logout`): limpa secure storage + prefs + remove push token. **Sem chamada de revogação.**
- 🔐 **Vetor central:** token copiado antes do logout **continua válido até 7 dias**. Idem em qualquer dispositivo.

### 2.6 INATIVIDADE — `painel_web/.../SessionTimeoutWatcher.tsx`
- **Só no cliente web:** 30 min ocioso → `logout('idle')`; aviso 2 min antes (aos 28 min). Montado dentro do Layout (só autenticado).
- App: sem timer de inatividade. Servidor: **sem conceito de idle**. 🔐 Inatividade não é aplicada pelo servidor.

### 2.7 ALTERAÇÕES DE CONTA
- **Trocar senha** (`trocarSenha`): atualiza no Supabase Auth + `senha_temporaria=false`. **Não invalida JWTs antigos** → sessões antigas seguem válidas. 🔐
- **Reset de senha**: `resetPasswordForEmail` (fluxo Supabase, fora do JWT do backend). Também não revoga JWTs.
- **Mudança de papel / bloqueio / arquivamento de empresa**: como `role`/`is_super_admin` estão congelados no JWT (7d), a mudança **só reflete após novo login/expiração**. `status='bloqueado'` é checado **no login**, não a cada request. 🔐
- Não há revogação administrativa de sessões.

### 2.8 ARMAZENAMENTO DO TOKEN
- **Web:** JWT em **`localStorage['auth_token']`** (Bearer). `api.ts` usa `withCredentials:false` → o cookie httpOnly do login **não é enviado** nas chamadas de API; o credential efetivo do SPA é o localStorage (exposto a XSS). 🔐 (O "httpOnly cookie" do CLAUDE.md está, na prática, ocioso para o SPA.)
- **App:** JWT em **`flutter_secure_storage`** (Keystore/EncryptedSharedPreferences) — ✅ já seguro; migra token legado de SharedPreferences texto-claro. Dados não sensíveis (nome/role/uid/empresa_tipo) em SharedPreferences só para UI.

### 2.9 INTERCEPTORS / TRATAMENTO DE ERRO
- **Web `api.ts`** (timeout 30s, Bearer de localStorage): interceptor de resposta —
  - **401**, ou **403** com body `{ error:'Token inválido ou expirado.' }`, **fora** de `/auth/me`, `/auth/login` e da tela `/login` → dispara `auth:unauthorized` (logout). ✅ 403 de negócio (com `message`) **não** desloga.
  - **429** → evento `api:rate-limited` (debounced), **não** desloga, **não** apaga token.
  - Erros **sem resposta** (timeout/cancel/rede) → **não** desloga, **não** faz retry.
  - `AuthContext` reconstrói "usuário mínimo" do JWT em falha transitória (429/offline/5xx) para não jogar no login.
- **App `api_service.dart` / `auth_provider`**: `ehFalhaTransitoriaAutoLogin(status) = status==0 || 429 || >=500` → mantém sessão; 401/403/4xx → encerra. *(Detalhe do retry/interceptor de request no app a confirmar na implementação da task H.)*

### 2.10 Papel do backend / Supabase
- `config/supabase.js` usa **`SUPABASE_SERVICE_KEY`** (service_role, RLS bypass). Novas tabelas de sessão: acesso **só pelo backend técnico** (REVOKE anon/authenticated).
- `JWT_SECRET` já é env no Railway (usado por sign/verify).

---

## 3. Achados de segurança revalidados (classificação)

| # | Achado | Classe |
|---|--------|--------|
| S1 | JWT 7 dias, **sem revogação server-side**; logout só no cliente | 🔐 alto (objetivo central) |
| S2 | Token copiado antes do logout continua válido até expirar | 🔐 alto |
| S3 | Troca/reset de senha **não** invalida sessões | 🔐 alto |
| S4 | Mudança de papel/bloqueio **não** reflete até relogin/expiração | 🔐 médio |
| S5 | Inatividade só no cliente (servidor não aplica) | 🔐 médio |
| S6 | Web: credential efetivo = JWT em `localStorage` (XSS) | 🔐 médio |
| S7 | `verifyToken` sem `issuer`/`audience`/`algorithms` explícitos | 🔐 baixo/médio |
| S8 | Sem `/auth/refresh`; sem rotação; sem detecção de reuse | 🔐 (habilita access curto) |
| A1 | App já usa secure storage p/ token (bom baseline) | ✅ |
| A2 | `empresa_id` derivado do DB, não do token (bom) | ✅ |
| A3 | Interceptors já não deslogam em 429/5xx/rede (preservar) | ✅ |

## 4. Mapa de impacto (fluxos tocados por SEC-1)
Login web/app · cadastro público (register/register-empresa) · confirmação de e-mail · reset de senha · troca de senha · logout web/app · inatividade · interceptors web/app · `ProtectedRoute` · guards do app · `verifyToken`/`isAdmin`/`isSuperAdmin`/`verificarEmpresa` · perfis (`/auth/me`) · superadmin · empresas/autônomos/motoristas · todas as APIs protegidas · uploads (foto/comprovantes) · push (token por login) · realtime/polling (usa Bearer) · jobs/cron (usam service_role, fora do fluxo de sessão de usuário) · testes backend/frontend/app · CIs.

## 5. Constraints conhecidas
- **Flutter fora do PATH** neste ambiente → app: escrever/analisar código sim; build/test dependem de ambiente com SDK (ou CI mobile).
- Hardware limitado (CLAUDE.md) → evitar builds longos desnecessários.
- Gates de produção (A e B) exigem autorização humana antes de migration compartilhada, secrets, merge, deploy e modo estrito.
