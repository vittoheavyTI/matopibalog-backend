# MEMÓRIA COMPLETA DO PROJETO — MATOPIBA LOG

> Criado em: 30/05/2026
> Notebook servidor: 192.168.1.8 (Windows, i3-2328M, 7.5GB RAM)
> Stack: Vite 8 + React 19 + TypeScript 6 + Tailwind 4 + Express

---

## 1. CONEXÃO VIA REDE (outro notebook acessando este)

```powershell
# No notebook servidor (192.168.1.8), compartilhar a pasta via SMB:
# 1. Abra "Propriedades" da pasta APP-CHOFERLOG > "Compartilhamento" > "Compartilhar"
# 2. Adicionar "Todos" com permissão de leitura/gravação
#
# No notebook cliente, acessar:
# \\192.168.1.8\APP-CHOFERLOG
# Ou mapear como unidade Z:
net use Z: \\192.168.1.8\APP-CHOFERLOG /persistent:yes
```

---

## 2. PROJETO — ESTRUTURA

```
C:\Users\Jordão Vittor\Documents\APP-CHOFERLOG\APP-CHOFER LOG\
├── painel_web/          ← Frontend (Vite 8 + React 19 + TS 6)
│   ├── src/
│   │   ├── pages/       ← Login.tsx, Configuracoes.tsx, Dashboard.tsx, etc.
│   │   ├── components/  ← Layout.tsx, Sidebar.tsx, ProtectedRoute.tsx, etc.
│   │   ├── contexts/    ← AuthContext.tsx
│   │   ├── hooks/       ← useLoginConfig.ts (CRIADO em 30/05)
│   │   ├── utils/       ← masks.ts, etc.
│   │   ├── api.ts       ← Axios instance + interceptors
│   │   └── types/       ← Definições TS
│   ├── public/
│   │   ├── 404.html     ← SPA redirect via <meta refresh>
│   │   └── _redirects   ← Netlify SPA routing
│   └── .env             ← VITE_API_URL=https://matopibalog-api.onrender.com
│
├── backend/             ← Express API
│   ├── server.js
│   ├── controllers/     ← configController.js, authController.js, etc.
│   ├── routes/          ← config.js, auth.js, etc.
│   ├── .env             ← Supabase + JWT credentials
│   └── render.yaml      ← Config Render deploy
│
├── .opencode/           ← Config opencode
│   └── skills/          ← Skills instaladas (3)
│       ├── devops-github-actions-troubleshooting/
│       ├── react-component-restoration-css-precision-state-sync/
│       └── ui-ux-pro-max/
│
├── app_android/         ← App Flutter (descontinuado?)
├── database/            ← Scripts SQL
├── firebase_backend/    ← Firebase cloud functions
├── setup/               ← Scripts de setup
├── cmd/                 ← CLI tools
└── AGENTS.md            ← Instruções para o opencode
```

---

## 3. CONFIGURAÇÕES DE ACESSO

### Frontend (painel_web)
- **Dev**: `http://localhost:5173`
- **Produção**: `https://matopibalog.com.br` (GitHub Pages)
- **GitHub Pages fallback**: `https://vittoheavyTI.github.io/matopibalog-backend/`
- **Netlify (desativado, sem créditos)**: `https://dazzling-fudge-f38a2c.netlify.app`
- **Admin login**: `admin@choferlog.com.br` / `Admin@123!`

### Backend (backend)
- **Dev**: `http://localhost:3000`
- **Produção**: `https://matopibalog-api.onrender.com` (NÃO IMPLANTADO AINDA)
- **Supabase**: `https://rjahjogidyndphdxevom.supabase.co`
- **JWT Secret**: `dc28024f-3b47-460e-897f-98802ed4a5ee`

### Netlify (créditos esgotados)
- **Site ID**: `d827f06f-7185-48a4-bd9c-252e18a3272f`
- **Token**: `nfp_pLWxbgbp4PiXptne6V99wRH5F6Ker98628e2`

---

## 4. localStorage — CHAVES UTILIZADAS

### Prefixed with `choferlog_`

| Chave | Onde é escrita | Onde é lida |
|-------|---------------|-------------|
| `choferlog_token` | AuthContext.login() | api.ts interceptor, AuthContext |
| `choferlog_user` | AuthContext.login() | AuthContext |
| `choferlog_company` | Configuracoes handleSaveCompany | Configuracoes, Relatorios, ResumoMotorista |
| `choferlog_printers` | Configuracoes | Configuracoes |
| `choferlog_login_logo` | Configuracoes saveImageSettings | useLoginConfig hook |
| `choferlog_login_logo_scale` | Configuracoes saveImageSettings | useLoginConfig hook |
| `choferlog_login_logo_y` | Configuracoes saveImageSettings | useLoginConfig hook |
| `choferlog_login_bg` | Configuracoes saveImageSettings | useLoginConfig hook |
| `choferlog_login_bg_scale` | Configuracoes saveImageSettings | useLoginConfig hook |
| `choferlog_login_bg_y` | Configuracoes saveImageSettings | useLoginConfig hook |
| `choferlog_login_footer` | Configuracoes handleSaveFooter | useLoginConfig hook |
| `choferlog_contact_phone` | Configuracoes handleSaveFooter | useLoginConfig hook |
| `choferlog_contact_email` | Configuracoes handleSaveFooter | useLoginConfig hook |
| `choferlog_footer_color` | Configuracoes handleSaveFooter + onChange | useLoginConfig hook |
| `choferlog_footer_opacity` | Configuracoes handleSaveFooter + onChange | useLoginConfig hook |
| `choferlog_footer_font_size` | Configuracoes onChange | useLoginConfig hook |
| `choferlog_footer_bold` | Configuracoes onClick | useLoginConfig hook |
| `choferlog_footer_font_family` | Configuracoes onChange | useLoginConfig hook |
| `choferlog_footer_width` | Configuracoes handleSaveFooter + mouseup | useLoginConfig hook |
| `choferlog_footer_height` | Configuracoes handleSaveFooter + mouseup | useLoginConfig hook |
| `choferlog_card_scale` | Configuracoes onChange/mouseup | useLoginConfig hook |
| `choferlog_card_x` | Configuracoes mouseup | useLoginConfig hook |
| `choferlog_card_y` | Configuracoes mouseup | useLoginConfig hook |
| `choferlog_card_color` | Configuracoes onChange | useLoginConfig hook |
| `choferlog_card_opacity` | Configuracoes onChange | useLoginConfig hook |
| `choferlog_input_bg` | Configuracoes onChange/handleSaveFooter | useLoginConfig hook |
| `choferlog_input_border` | Configuracoes onChange/handleSaveFooter | useLoginConfig hook |
| `choferlog_logo` (sidebar) | Sidebar saveLogo | Sidebar, ResumoMotorista, Relatorios |
| `choferlog_logo_scale` (sidebar) | Sidebar saveLogo | Sidebar |
| `choferlog_logo_y` (sidebar) | Sidebar saveLogo | Sidebar |
| `chofer_config` | Configuracoes syncConfigToServer | — (cópia completa p/ servidor) |
| `choferlog_integracoes` | Integracoes | Integracoes |
| `choferlog_integracao_config_*` | Integracoes | Integracoes |

---

## 5. HISTÓRICO DE COMMITS (30 mais recentes)

```
45e3d0c fix: 3 bugs - loadConfigFromApi no longer writes to localStorage, footer sliders persist, hook writes defaults
ba58080 Restaurar arquivos corrompidos e rebuild
547597c Corrigir persistência dos valores padrão no localStorage
780d9dd feat: centralize login config reading in useLoginConfig hook
e8b2956 fix: restore login card without scrollbars, fix footer layout, fix 404 redirect, add login links
e6bb6be Responsividade login, sincronizar config servidor, rota publica
c269b8a Corrigir loop no logout e SPA routing no GitHub Pages
a4b8bc2 Corrigir loop infinito de recarregamento e erros de build (41 erros TS)
77570ff Adicionar matopibalog.com.br ao CORS
84d7709 Corrigir base URL para domínio personalizado
ce1794e Refatorar app Flutter: Provider, validacao, URL Render, fallback camera
ffe2a06 Fix GitHub Actions workflow + GitHub Pages config
357cecc Resolver conflito - manter versão do GitHub
581a734 Update static.yml
da9f5e0 Corrigir workflow - usar vite build
3a7eb2c Merge branch 'main' of https://github.com/vittoheavyTI/matopibalog-backend
a54ff31 Adicionar .env com URL do backend
e5ca315 Enhance GitHub Pages deployment workflow
ec6ebdd Atualização completa - 28/05/2026: Painel Admin, Planos, Onboarding, Pagamentos, Integrações, Dashboard
d16c153 Add descricao/recursos fields to planos POST/PUT
a1b43b4 Adiciona .gitignore, remove node_modules do tracking
2593497 Backend Matopiba Log
```

---

## 6. SKILLS INSTALADAS no opencode

### 6.1 devops-github-actions-troubleshooting
- **Arquivo**: `.opencode/skills/devops-github-actions-troubleshooting/SKILL.md`
- **Foco**: GitHub Actions, CI/CD, Netlify API deploy, troubleshooting build/deploy
- **Comandos-chave**:
  - Build: `npx vite build` (NÃO `npm run build` — tsc -b é pesado)
  - Netlify deploy via API direta (PowerShell script no SKILL.md)
  - Servidores: sempre usar `Start-Process -NoNewWindow`
  - Timeout build: 180s

### 6.2 react-component-restoration-css-precision-state-sync
- **Arquivo**: `.opencode/skills/react-component-restoration-css-precision-state-sync/SKILL.md`
- **Foco**: Layout breaks, overflow, state sync localStorage ↔ servidor
- **Padrões**: Diagnosticar componente escondido, CSS exploded, config não sincronizando
- **Arquivos comuns**: Login.tsx, Configuracoes.tsx, Layout.tsx, Sidebar.tsx

### 6.3 ui-ux-pro-max
- **Arquivo**: `.opencode/skills/ui-ux-pro-max/SKILL.md`
- **Foco**: Design system, cores, tipografia, UX guidelines
- **Uso**: Requer Python. Comando: `python3 skills/ui-ux-pro-max/scripts/search.py <query> --design-system`

---

## 7. MUDANÇAS RECENTES (Sessão 30/05/2026)

### 7.1 Criação do hook `useLoginConfig.ts` (commit 780d9dd)
- **Arquivo**: `painel_web/src/hooks/useLoginConfig.ts`
- **O que faz**: Hook que lê TODAS as 25 chaves `choferlog_*` do localStorage de forma centralizada
- **Por que**: Unificar a leitura entre Login.tsx e Configuracoes.tsx, substituindo leituras manuais duplicadas
- **Mudanças associadas**:
  - Login.tsx: removeu ~40 linhas de estado + useEffect de config, agora usa `useLoginConfig()`
  - Configuracoes.tsx: substituiu leituras manuais de localStorage pelo hook no useEffect inicial

### 7.2 Login.tsx — Restauração do card (commit e8b2956)
- Removeu `overflow: auto`, `overflowY: auto`, `maxHeight: 90dvh` do card
- Removeu `Math.min(cardScale, 150)` e `maxHeight: 200px` do logo
- Adicionou `overflow: hidden` + `height: 100vh` no container
- Adicionou links "Criar conta" e "Esqueceu a senha?"
- Footer: `flexWrap: nowrap` + `whiteSpace: nowrap`
- Removeu media query que escondia footer em mobile

### 7.3 Loop de logout (commit c269b8a)
- api.ts: removeu `window.location.href` no 401, agora dispara evento `auth:unauthorized`
- AuthContext: listener do evento limpa token/user sem reload
- ProtectedRoute/Layout: removeu `navigate('/login')` duplicado
- 404.html: trocou `location.replace()` por `<meta http-equiv="refresh">`

### 7.4 Correção dos 3 bugs (commit 45e3d0c)

**BUG 1 — loadConfigFromApi sobrescrevia localStorage:**
- Removidas TODAS as 22 linhas de `localStorage.setItem(...)` dentro de `loadConfigFromApi()`
- Agora a função APENAS chama `setState()`, nunca escreve no localStorage
- Isso impede que dados do servidor sobrescrevam personalizações locais

**BUG 2 — Footer Color/Opacity não salvavam automaticamente:**
- `onChange` do Footer Color agora chama `localStorage.setItem('choferlog_footer_color', v)`
- `onChange` do Footer Opacity agora chama `localStorage.setItem('choferlog_footer_opacity', v.toString())`
- Antes só atualizavam estado React, sem persistir

**BUG 3 — Hook não escrevia defaults no localStorage:**
- Adicionadas 14 linhas que verificam cada chave e escrevem o valor padrão se não existir
- Garante que `localStorage.getItem()` nunca retorne `null` para chaves de configuração

---

## 8. ESTADO ATUAL DOS ARQUIVOS CRÍTICOS

### Login.tsx (painel_web/src/pages/Login.tsx)
- 212 linhas
- Usa `useLoginConfig()` para TODAS as configurações visuais
- Formulário: email, password, showPassword, error, loadingLocal
- Footer estático (sem handles de redimensionamento)
- Sem loading spinner (configLoaded removido)
- Sem chamada de API

### Configuracoes.tsx (painel_web/src/pages/Configuracoes.tsx)
- ~1265 linhas
- Abas: empresa, impressora, aparencia
- Preview interativo com drag + resize do card
- `loadConfigFromApi()` — APENAS setState, NUNCA localStorage.setItem
- Footer Color/Opacity — salvam no onChange agora
- Botão "Salvar" para footer salva TUDO no localStorage + sync ao servidor

### useLoginConfig.ts (painel_web/src/hooks/useLoginConfig.ts)
- 77 linhas
- Lê 25 chaves do localStorage com fallback para defaults
- Escreve defaults se chave não existe (BUG 3 corrigido)
- Executa uma vez no mount

### AuthContext.tsx (painel_web/src/contexts/AuthContext.tsx)
- 78 linhas
- `logout()`: remove APENAS `choferlog_token` e `choferlog_user`
- `login()`: escreve APENAS `choferlog_token` e `choferlog_user`
- Listener `auth:unauthorized`: limpa token/user sem reload
- NUNCA toca em chaves de configuração

### api.ts (painel_web/src/api.ts)
- 28 linhas
- Interceptor request: adiciona Bearer token
- Interceptor response (401): remove token/user, dispara `auth:unauthorized`
- BaseURL: `import.meta.env.VITE_API_URL || 'http://localhost:3000'`

### 404.html (painel_web/public/404.html)
- Redirect via `<meta http-equiv="refresh" content="0; url=/" />`
- Sem JavaScript `location.href`

### Backend render.yaml (backend/render.yaml)
```yaml
services:
  - type: web
    name: matopibalog-api
    env: node
    rootDir: backend
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: SUPABASE_URL
        value: https://rjahjogidyndphdxevom.supabase.co
      - key: SUPABASE_SERVICE_KEY
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: FRONTEND_URL
        value: https://matopibalog.com.br
      - key: NODE_ENV
        value: production
```

---

## 9. INSTRUÇÕES PARA RODAR O PROJETO

### Frontend (painel_web)
```powershell
cd "C:\Users\Jordão Vittor\Documents\APP-CHOFERLOG\APP-CHOFER LOG\painel_web"
npm install
npx vite  # ou: Start-Process -NoNewWindow -FilePath "node" -ArgumentList "node_modules\vite\bin\vite.js"
# Acessar: http://localhost:5173
```

### Backend (backend)
```powershell
cd "C:\Users\Jordão Vittor\Documents\APP-CHOFERLOG\APP-CHOFER LOG\backend"
npm install
node server.js  # ou: Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js"
# API em: http://localhost:3000
```

### Build para produção
```powershell
cd "C:\Users\Jordão Vittor\Documents\APP-CHOFERLOG\APP-CHOFER LOG\painel_web"
npx vite build  # NÃO use npm run build (tsc -b trava)
# Saída: dist/
```

---

## 10. PENDÊNCIAS

- [ ] **Backend Render**: Conectar repositório `vittoheavyTI/matopibalog-backend` no Render dashboard, configurar rootDir=backend, startCommand=node server.js. Colocar SUPABASE_SERVICE_KEY e JWT_SECRET como secrets.
- [ ] **DNS**: CNAME `matopibalog.com.br` → `vittoheavyTI.github.io` já configurado? Verificar SSL (pode levar horas para propagar).
- [ ] **Renomear pasta**: de `APP-CHOFERLOG\APP-CHOFER LOG` (com espaço) para `APP-MATOPIBALOG` (sem espaço).
- [ ] **Atualizar VS Code**: pendente.
- [ ] **Sidebar logo keys**: Sidebar usa `choferlog_logo` (sem `login_`), Login usa `choferlog_login_logo`. São propositalmente diferentes. Verificar se a Sidebar está lendo/escrevendo as chaves corretas.

---

## 11. DEPLOY PIPELINE

### GitHub Actions
- Workflow em `.github/workflows/static.yml`
- Trigger: push na branch `main`, path `painel_web/**`
- Passos: checkout → setup Node 22 → npm ci → npx vite build → deploy para GitHub Pages
- URL: `https://vittoheavyTI.github.io/matopibalog-backend/` (ou domínio customizado)

### Netlify (sem créditos no momento)
- API deploy script no SKILL devops (PowerShell, ~90 linhas)
- URL: `https://dazzling-fudge-f38a2c.netlify.app`
- Token: `nfp_pLWxbgbp4PiXptne6V99wRH5F6Ker98628e2`
- Site ID: `d827f06f-7185-48a4-bd9c-252e18a3272f`

---

## 12. CONFIG DO OPENCODE

### Global (C:\Users\Jordão Vittor\.config\opencode\opencode.jsonc)
```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

### Local (.opencode/ no projeto)
- Skills em `.opencode/skills/`
- opencode node_modules em `.opencode/node_modules/`
- AGENTS.md na raiz do projeto com instruções de ambiente

---

# 13. ESTADO ATUAL — 2026-06-04 (Sessão Claude Code)

> ⚠️ A partir daqui o conteúdo SUBSTITUI / atualiza as seções acima quando houver conflito.
> Seções 1–12 são mantidas como histórico. As decisões e arquivos abaixo são os atuais.

## 13.1 Infraestrutura atual (atualizada)

| Componente | Onde | URL |
|---|---|---|
| Backend | **Railway** (não mais Render) | https://matopibalog-backend-production.up.railway.app |
| Frontend | GitHub Pages via Actions | https://matopibalog.com.br |
| Banco + Auth | Supabase | https://rjahjogidyndphdxevom.supabase.co |
| Repositório | GitHub monorepo | vittoheavyTI/matopibalog-backend |
| Node.js | 20+ (forçado no Railway) | |
| E-mail | Resend via Supabase SMTP (recuperação) | sem envio direto pelo backend ainda |

**Pipeline:** push na `main` → Railway redeploy (~2 min) + GitHub Actions build do frontend (~4 min).

## 13.2 Autenticação — estado atual

### JWT
Payload atual (após login): `{ uid, email, role, is_super_admin }` — válido por 7 dias.

### Web
- Token via **httpOnly cookie** (`secure`, `sameSite: 'none'`)
- AuthContext lê `GET /auth/me` na montagem para restaurar sessão
- ProtectedRoute aguarda `loading` terminar antes de redirecionar
- Interceptor de 401 em `api.ts` **ignora** `/auth/me` e `/auth/login` (evita logout imediato)
- Evento `auth:unauthorized` só age após carregamento inicial (loadingRef)

### App Flutter
- Token via **`Authorization: Bearer`** no header
- Backend aceita cookie OU Bearer (middleware `verifyToken` em `backend/middlewares/auth.js`)
- Login retorna `token` no body (linha 178 do authController) para o Flutter salvar em SharedPreferences

## 13.3 Multi-tenant + Super-admin (NOVO)

### Conceito
- **Admin comum** (`is_super_admin = false`): dono de uma empresa, só vê/gerencia dados dela.
- **Super-admin** (`is_super_admin = true`): dono do sistema, vê tudo, pode impersonar.

### Quem é super-admin
- Campo `is_super_admin` BOOLEAN na tabela `usuarios` (default false)
- Usuário marcado: **`vittoheavymetal@gmail.com`** (Jordão Vittor, id `f8b239d1-7f7d-4de5-81ea-f8b1c161cad2`)
- SQL para marcar:
  ```sql
  UPDATE usuarios SET is_super_admin = TRUE WHERE email = 'vittoheavymetal@gmail.com';
  ```

### Backend — middlewares
Em `backend/middlewares/auth.js`:
- `verifyToken` — aceita cookie OU Bearer
- `isAdmin` — exige `role === 'admin'`
- **`isSuperAdmin`** — exige `req.user.is_super_admin === true`, senão 403

Em `backend/middlewares/tenant.js`:
- **`verificarEmpresa`** — injeta `req.empresa_id` do usuário logado
- Admin pode impersonar via `?empresa_id=` se tiver `role === 'admin'` (deveria ser restrito a super-admin, hoje está aberto a qualquer admin — pendência)

### Backend — proteção de rotas
- `/painel-admin/*` → `router.use(verifyToken, isAdmin, isSuperAdmin)` — **só super-admin**
- `/admin/motoristas` (GET) → `verificarEmpresa` + filtro por empresa (super-admin vê tudo)
- `/admin/motoristas/pendentes`, `/approve`, `/block` → **AINDA SEM** filtro por empresa (pendência)

### Frontend — proteção de rotas
- `SuperAdminRoute.tsx` (componente novo) — redireciona admin comum para `/`
- `App.tsx` — todas as rotas `/painel-administrativo/*` usam `SuperAdminRoute`
- `Sidebar.tsx` — menu "Painel Admin." só renderiza se `user?.is_super_admin === true`
- `AuthContext.tsx` — interface `User` inclui `is_super_admin?: boolean`

## 13.4 Sistema de empresas + código de convite (NOVO)

### Banco — tabela `empresas`
Colunas adicionadas:
- `codigo_convite TEXT NOT NULL UNIQUE` (formato `MATO-XXXXXX`)
- `tipo TEXT DEFAULT 'transportadora' CHECK (tipo IN ('transportadora', 'autonomo'))`

### Helper centralizado (NOVO)
Arquivo `backend/services/empresaService.js` — exporta `criarEmpresaCompleta({ nome, cnpj, email_contato, telefone, plano_id, planoAlias, tipo })`:
1. Resolve plano (por id, alias ou nome; default "Plano Básico")
2. Gera `codigo_convite` único (5 tentativas)
3. Calcula `trial_started_at` + `trial_ends_at` (default 7 dias)
4. Insere empresa com todos os campos preenchidos
5. Retorna `{ empresa, error }`

### Quem usa o helper
- `authController.registerEmpresa` (cadastro público) — cria empresa via helper + cria usuário admin
- `painel-admin.js POST /empresas` (painel super-admin) — cria empresa via helper (sem admin ainda — Passo D pendente)
- `authController.register` (cadastro de motorista) — **ainda usa lógica inline** para criar empresa autônoma (pode migrar depois)

### Fluxo de cadastro de motorista
- Com `codigo_convite` válido → vincula à empresa
- Com código inválido → 400 com mensagem clara
- Sem código → cria empresa autônoma própria + motorista vinculado

### Endpoints novos
- `GET /configuracoes/codigo-convite` — empresa vê o código dela
- `POST /configuracoes/codigo-convite/regenerar` — regenera código

### Painel Configurações
Em `Configuracoes.tsx` aba "Dados da Empresa" — bloco com código de convite + botões "Copiar" e "Regenerar".

## 13.5 Mudanças nos controllers/rotas (resumo)

### `backend/controllers/authController.js`
- `register` — 3 fluxos: com código, código inválido, autônomo (cria empresa própria)
- `register` — captura erro do insert em `usuarios` e faz **rollback no Auth** se falhar
- `register` — `tipo` default mudou de `'proprietario'` para `'motorista'` (constraint da tabela)
- `login` — perfil ausente em `usuarios` retorna **409** ("Perfil incompleto, contate o suporte") em vez de 500
- `login` — JWT inclui `is_super_admin`
- `login` — resposta do body inclui `token` e `is_super_admin`
- `registerEmpresa` — usa `criarEmpresaCompleta`

### `backend/controllers/adminController.js`
- `getAllMotoristas` — filtra por `usuarios.empresa_id` se não for super-admin; super-admin pode passar `?empresa_id=`

### `backend/controllers/configController.js`
- Novos endpoints `getCodigoConvite` e `regenerarCodigoConvite`

### `backend/server.js`
- `app.set('trust proxy', 1)` adicionado (Railway proxy reverso, corrige express-rate-limit)

## 13.6 Frontend — arquivos críticos atuais

### `painel_web/src/contexts/AuthContext.tsx`
- Interface `User` inclui `is_super_admin?: boolean`
- `loadingRef` evita race condition no logout imediato
- Listener `auth:unauthorized` só age após loading terminar

### `painel_web/src/components/SuperAdminRoute.tsx` (NOVO)
Componente que redireciona admin comum logado para `/` se a rota exige super-admin.

### `painel_web/src/components/Sidebar.tsx`
- Importa `useAuth`
- Menu "Painel Admin." só renderiza com `user?.is_super_admin`

### `painel_web/src/api.ts`
- Interceptor de 401 ignora `/auth/me` e `/auth/login`
- BaseURL: Railway

### `painel_web/src/App.tsx`
- Importa `SuperAdminRoute`
- Rotas `/painel-administrativo/*` usam `SuperAdminRoute`

### `painel_web/src/pages/CadastroPublico.tsx`
- Toast de sucesso simplificado (4s, sem contagem regressiva, com X)
- `useEffect` com cleanup (sem bug do `setTimeout` no JSX)

### `painel_web/src/pages/Login.tsx`
- Modal "Esqueceu senha" usa `onMouseDown` no overlay (não fecha em clique de autocomplete)
- Rodapé sem `maxWidth: 600px`; `gap: 10px`; spans com `whiteSpace: nowrap`

### `painel_web/src/pages/Configuracoes.tsx`
- Bloco de código de convite na aba "Dados da Empresa"
- Rodapé preview com spans `whiteSpace: nowrap`

### `painel_web/src/pages/PainelPlanos.tsx`
- `recursosToString` helper para evitar React error #31 quando `recursos` vem como JSONB array/objeto

### `painel_web/src/pages/Motoristas.tsx`
- Query usa `motoristas` com `usuarios!inner(...)` e filtro por `empresa_id`

## 13.7 App Flutter — estado atual

### `app_android/lib/config.dart`
- `apiBaseUrl = 'https://matopibalog-backend-production.up.railway.app'`

### `app_android/lib/screens/cadastro_screen.dart`
- Campo **opcional** "Código da empresa" com hint "deixe vazio se autônomo"
- Envia `codigo_convite` no payload (apenas se preenchido)

### `app_android/lib/services/api_service.dart`
- Token salvo em SharedPreferences e enviado como Bearer

### Pendências Flutter
- Rebranding choferlog → matopibalog (parcial)
- Refresh token (pós-Farmshow)
- Máscaras de CPF, telefone, placa (pacote `mask_text_input_formatter`)

## 13.8 Banco — SQLs já executados (não rodar de novo)

```sql
-- Código de convite + tipo na tabela empresas
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codigo_convite TEXT UNIQUE;
UPDATE empresas SET codigo_convite = 'MATO-' || UPPER(SUBSTRING(REPLACE(id::text,'-',''),1,6)) WHERE codigo_convite IS NULL;
ALTER TABLE empresas ALTER COLUMN codigo_convite SET NOT NULL;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'transportadora' CHECK (tipo IN ('transportadora','autonomo'));

-- Super-admin
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE NOT NULL;
UPDATE usuarios SET is_super_admin = TRUE WHERE email = 'vittoheavymetal@gmail.com';
```

## 13.9 Histórico de commits relevantes desta sessão (2026-06-03/04)

```
e67f2f8 fix(rodapé): largura do rodapé real bate com o preview
63a7128 fix(Login): modal de recuperação não fecha ao clicar em autocomplete
7c164c1 fix(CadastroPublico): simplificar toast de sucesso
436295d fix(CadastroPublico): caixa de sucesso com contagem regressiva e botão X
4859177 refactor(empresas): unificar criação via criarEmpresaCompleta
b6356be feat(empresas): adicionar helper criarEmpresaCompleta
0aae94c fix(PainelPlanos): corrigir React error #31 ao renderizar recursos
1bd8d71 feat(segurança): restringir Painel Admin a super-admin no frontend
5a3af4e feat(segurança): bloquear rotas /painel-admin para não super-admin
9db4b9e feat(segurança): isolamento multi-tenant na lista de motoristas
9e1d200 feat(auth): incluir is_super_admin na resposta do login
f4f80b7 feat(auth): cadastro por código de convite + suporte a autônomo
0e5992a fix(register): corrigir tipo padrão de 'proprietario' para 'motorista'
03eb5b9 fix(backend): corrigir erro 500 no login e cadastro de usuários
a34514a fix(auth): aceitar Bearer token para app mobile
```

## 13.10 Pendências engatilhadas (em ordem de prioridade)

1. **Filtrar `/admin/motoristas/pendentes` por empresa** (vaza dados entre empresas)
2. **Validar ownership em `/admin/motoristas/:id/approve` e `/block`** (admin pode aprovar motorista de outra empresa)
3. **Restringir `?empresa_id=` no `tenant.js` apenas para super-admin** (hoje qualquer admin pode impersonar)
4. **Passo C de empresas**: envio de e-mail Resend (fire-and-forget) em `criarEmpresaCompleta` para `vittoheavymetal@gmail.com` — campos: nome, email_contato, plano, codigo_convite, data cadastro, trial até
5. **Passo D de empresas**: painel admin cria admin junto + dropdown de plano no form
6. **Padronizar campo `recursos` de planos como JSONB-array** (banco já é JSONB, mas inputs mandam string; helpers no front normalizam para exibir)
7. **Padronização de máscaras** (criar `maskMoeda` e `maskPlaca`, aplicar em CadastroPublico/PainelEmpresas/Motoristas/PainelPlanos/Flutter)
8. **App Flutter**: rebranding completo, máscaras, refresh token
9. **Defesa de profundidade**: `recursos` normalizado no backend (POST/PUT planos)

## 13.11 Credenciais e contas de teste

- **Super-admin**: `vittoheavymetal@gmail.com` (Jordão Vittor)
- **Admin comum**: `admin@matopibalog.com.br` (Administrador)
- Outras contas admin na tabela `usuarios` (todas com `is_super_admin = false`)

## 13.12 Onde encontrar o quê

| Tarefa | Arquivo |
|---|---|
| Adicionar middleware de segurança | `backend/middlewares/auth.js` ou `tenant.js` |
| Criar empresa | `backend/services/empresaService.js` |
| Rota privada super-admin | `backend/routes/painel-admin.js` |
| Rota empresa logada | `backend/routes/admin.js` |
| Cadastro motorista (com código/autônomo) | `backend/controllers/authController.js` `register` |
| Cadastro empresa público | `backend/controllers/authController.js` `registerEmpresa` |
| Tela de configurações da empresa | `painel_web/src/pages/Configuracoes.tsx` |
| Tela do código de convite | `Configuracoes.tsx` aba "Dados da Empresa" |
| Sidebar do app | `painel_web/src/components/Sidebar.tsx` |
| Rota frontend super-admin | `painel_web/src/components/SuperAdminRoute.tsx` |
| Contexto auth web | `painel_web/src/contexts/AuthContext.tsx` |
| Cadastro Flutter | `app_android/lib/screens/cadastro_screen.dart` |
| URL backend Flutter | `app_android/lib/config.dart` |

