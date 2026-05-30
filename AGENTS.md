# Diagnostics & Environment

## System Specs (critical — very limited hardware)
- **CPU**: Intel Core i3-2328M @ 2.20GHz (dual-core, ~2011 era)
- **RAM**: 7.5 GB total (~1.6 GB free typically)
- **OS**: Windows (PowerShell 5.1)
- **Running processes**: 200+

## Why commands "freeze" or "travar"

1. **Vite 8 startup is heavy** — takes 7–21s to compile on this hardware.
2. **Timeout kills long processes** — `npm run dev` / `node server.js` get killed when bash tool timeout expires. **Must always use `Start-Process`** to run servers in background.
3. **Low free RAM** (~1.6 GB) — heavy operations cause swapping/system-wide freeze.
4. **PowerShell `curl` is broken** — actually `Invoke-WebRequest`, use `try { Invoke-WebRequest -Uri ... }` instead.

## How to run servers (never freeze again)

```powershell
# Frontend (background, no timeout)
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "node_modules\vite\bin\vite.js" -WorkingDirectory "<project>\painel_web"

# Backend (background, no timeout)
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "<project>\backend"

# Verify
try { $r = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 5; Write-Output "OK $($r.StatusCode)" } catch { Write-Output "FAIL" }
```

## Project Structure
- Frontend: `painel_web/` (Vite 8 + React 19 + TypeScript 6 + Tailwind 4)
- Backend: `backend/` (Express)
- Ports: Frontend 5173, Backend 3000
- Admin login: `admin@choferlog.com.br` / `Admin@123!`
- Persistence: localStorage keys prefixed `choferlog_`
- Netlify site: `d827f06f-7185-48a4-bd9c-252e18a3272f` (dazzling-fudge-f38a2c.netlify.app)
- Netlify token: `nfp_pLWxbgbp4PiXptne6V99wRH5F6Ker98628e2`

## Session History (May 28, 2026)

### PainelPlanos página em branco (Sprint 1)
- **Problem**: `PainelPlanos.tsx` showed blank page when clicking Planos in painel-administrativo
- **Root cause**: `setPlanos(res)` saved the full Axios response object instead of `res.data`
- **Fix**: Added `res.data || []`, try/catch with toast error handling, and `ErrorBoundary` component
- **Also**: Added `public/_redirects` for Netlify SPA routing (prevents 404 on direct URL access)
- **Files touched**: `src/pages/PainelPlanos.tsx`, `src/components/ErrorBoundary.tsx` (new), `src/App.tsx`, `public/_redirects` (new)

### PDF Report Reorganization (Sprint 2)
- **Problem**: PDF report was disorganized — all lancamentos were grouped by trip instead of by type
- **What changed**: Detailed breakdown in PDF now has 4 sections per motorista:
  1. **FRETES REALIZADOS** — full columns: Data, Rota, Placa, KM Inicial, KM Final, Distância, Média, Frete, Status, Quem Recebeu
  2. **ABASTECIMENTOS** — Data, Posto, Litros, Valor, Pagador
  3. **VALES / ADIANTAMENTOS** — Data, Descrição, Valor, Pagador
  4. **OUTRAS DESPESAS** — Data, Descrição, Valor, Pagador
- Applied to BOTH `generatePDF()` and `generatePDFSelected()` functions
- **Files touched**: `src/pages/Relatorios.tsx`

### Dashboard Cards & Trip Completion (Sprint 2)
- **Dashboard**: Summary cards now have icons (DollarSign, TrendingUp, Fuel, Truck) and colored borders (blue, green, orange, purple)
- **Trip Completion**: `handleFinalizarViagem` now shows a confirmation modal with financial summary (Total Fretes, Comissão, Deduções, Saldo Líquido) before finalizing
- **Files touched**: `src/pages/Dashboard.tsx`, `src/pages/GerenciamentoViagens.tsx`

### On-Screen Trip Preview (Sprint 2)
- **Problem**: Expanded trip preview only showed KM cards
- **Fix**: Added 2 rows of info cards — row 1: Data, Placa, Valor Frete, Status, Quem Recebeu; row 2: KM Inicial, KM Final, Distância, Média Consumo
- **Files touched**: `src/pages/Relatorios.tsx`

### Session 30/05/2026 — Login Config Sync + 3 Bug Fixes
- **Problem**: Login page desconfigurada, localStorage vazio, footer não salvava, API overwrite
- **Root cause 1**: `loadConfigFromApi()` sobrescrevia localStorage com dados do servidor após login
- **Root cause 2**: Footer Color/Opacity sliders não chamavam `localStorage.setItem` no onChange
- **Root cause 3**: Hook `useLoginConfig` não escrevia defaults no localStorage
- **Fixes** (commit `45e3d0c`):
  1. `Configuracoes.tsx:334-364` — removidos TODOS `localStorage.setItem` de `loadConfigFromApi` (agora só setState)
  2. `Configuracoes.tsx:917,928` — adicionado `localStorage.setItem` nos onChanges de footer color/opacity
  3. `useLoginConfig.ts:33-46` — hook agora escreve valores padrão se chave não existir
- **Hook criado**: `useLoginConfig.ts` (commit `780d9dd`) — lê as 25 chaves de config do localStorage
- **Login.tsx refatorado**: removidos ~40 linhas de estado+useEffect, agora usa hook
- **Configuracoes refatorado**: useEffect inicial usa hook em vez de leituras manuais
- **Arquivos tocados**: `Login.tsx`, `Configuracoes.tsx`, `useLoginConfig.ts` (novo), `AuthContext.tsx`
- **MEMORIA.md**: Arquivo completo (`MEMORIA.md`) com toda a memória do projeto para transferência via rede (192.168.1.8)

### Pending Tasks
- Rename project folder from `app-chofer log` to `APP-MATOPIBALOG`
- Update VS Code
- Connect GitHub repo to Render for backend deploy (rootDir=backend, start=node server.js)
