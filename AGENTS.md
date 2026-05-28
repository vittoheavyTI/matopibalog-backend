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
