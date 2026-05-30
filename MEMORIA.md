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
