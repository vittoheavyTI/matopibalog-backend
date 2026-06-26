---
name: "DEVOPS + GITHUB ACTIONS + TROUBLESHOOTING SPECIALIST"
description: "GitHub Actions, CI/CD pipelines, Netlify/Vercel deploys, Node.js backend ops, Windows/PowerShell devops, troubleshooting deployment failures"
---

# DEVOPS + GITHUB ACTIONS + TROUBLESHOOTING SPECIALIST

Comprehensive devops and troubleshooting guide for the MATOPIBA LOG project (Vite 8 + React 19 + TypeScript 6 + Tailwind 4 + Express backend).

---

## 🔧 ENVIRONMENT

### Hardware Constraints
| Spec | Value |
|------|-------|
| CPU | Intel Core i3-2328M @ 2.20GHz |
| RAM | 7.5 GB total (~1.6 GB free) |
| OS | Windows (PowerShell 5.1) |
| Processes | 200+ running |

### Bash Timeout Rules
- `npm run build` → max 180s (Vite 8 is heavy)
- `npx vite build` → use 180s timeout
- Servers → **never** run with bash timeout; use `Start-Process -NoNewWindow`
- Netlify CLI → often hangs; prefer **Netlify API direct deploy** (see below)

---

## 📦 BUILD

### Frontend Build
```powershell
# Always use vite directly (tsc -b has pre-existing TS errors)
npx vite build
# Timeout: 180000ms minimum
```

### Build Failure Checklist
| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `tsc -b` fails with TS6133 | Pre-existing unused imports | Use `npx vite build` instead of `npm run build` |
| `PARSE_ERROR: has already been declared` | Duplicate `const` in same scope | Convert duplicate to `let` or remove |
| `Build failed` with no detail | Try `npx vite build` with longer timeout | Increase timeout to 180s |
| Various TS errors | `skipLibCheck: true` in tsconfig | Already configured |
| Module not found | Missing import | Check `package.json` for dependency |

---

## 🌐 NETLIFY DEPLOY

### Always use the API-based deploy (not Netlify CLI)
Netlify CLI hangs on this machine. Use the API deploy script:

```powershell
$token = "<TOKEN_REMOVIDO>"
$siteId = "d827f06f-7185-48a4-bd9c-252e18a3272f"
$distPath = "$PWD\dist"

function Get-Sha1Hash($path) {
  $sha1 = [System.Security.Cryptography.SHA1CryptoServiceProvider]::new()
  $stream = [System.IO.File]::OpenRead($path)
  $hashBytes = $sha1.ComputeHash($stream); $stream.Close()
  return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()
}

$fileManifest = @{}; $fileMap = @{}
Get-ChildItem $distPath -Recurse -File | ForEach-Object {
  $relPath = $_.FullName.Substring($distPath.Length + 1) -replace '\\', '/'
  $hash = Get-Sha1Hash $_.FullName
  $fileManifest[$relPath] = $hash; $fileMap[$hash] = $_.FullName
}

$body = @{ files = $fileManifest } | ConvertTo-Json -Depth 10
$r = Invoke-WebRequest -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys" -Method Post -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 30
$deploy = $r.Content | ConvertFrom-Json
$deployId = $deploy.id

foreach ($reqHash in $deploy.required) {
  if ($fileMap.ContainsKey($reqHash)) {
    $contentBytes = [System.IO.File]::ReadAllBytes($fileMap[$reqHash])
    Invoke-WebRequest -Uri "https://api.netlify.com/api/v1/deploys/$deployId/files/$reqHash" -Method Put -Body $contentBytes -ContentType "application/octet-stream" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 60 | Out-Null
  }
}

Start-Sleep -Seconds 5
for ($i = 0; $i -lt 10; $i++) {
  $r = Invoke-WebRequest -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys/$deployId" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 10
  $deploy = $r.Content | ConvertFrom-Json
  if ($deploy.state -eq "ready") { break }
  Start-Sleep -Seconds 3
}

if ($deploy.state -eq "ready") {
  $pubBody = @{ actions = @{ restore = @{} } } | ConvertTo-Json
  Invoke-WebRequest -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys/$deployId/restore" -Method Post -Body $pubBody -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 30 | Out-Null
  Write-Output "Publicado: https://dazzling-fudge-f38a2c.netlify.app"
} else { Write-Output "State: $($deploy.state)" }
```

### Deploy Verification
```powershell
try {
  $r = Invoke-WebRequest -Uri "https://dazzling-fudge-f38a2c.netlify.app/" -UseBasicParsing -TimeoutSec 15
  Write-Output "Status: $($r.StatusCode)"
  if ($r.Content -match 'src="(/assets/[^"]+\.js)"') {
    $jsUrl = "https://dazzling-fudge-f38a2c.netlify.app$($Matches[1])"
    $js = (Invoke-WebRequest -Uri $jsUrl -UseBasicParsing -TimeoutSec 20).Content
    Write-Output "JS size: $($js.Length) bytes"
    Write-Output "Has ErrorBoundary: $($js.Contains('ErrorBoundary'))"
  }
} catch { Write-Output "FAIL: $_" }
```

### SPA Routing (_redirects)
File must be at `public/_redirects` (copied to `dist/` during build):
```
/* /index.html 200
```

---

## 🚨 COMMON ISSUES & TROUBLESHOOTING

### Blank Page on Route
| Check | What to Look For |
|-------|-----------------|
| Browser Console (F12) | Any red errors? |
| ErrorBoundary wrapping | Component wrapped in `<ErrorBoundary>`? |
| API `.data` access | `setState(res.data)` not `setState(res)`? |
| Missing icon import | `lucide-react` icon renamed? |
| Dynamic Tailwind class | Template literal in className? |

### Netlify Deploy Issues
| Symptom | Fix |
|---------|-----|
| JS URL returns HTML (498 bytes) | `_redirects` catching assets; check file exists in deploy |
| No files in deploy | Use API file-manifest method (above), not zip |
| CLI hangs | Never use `netlify deploy`; always use API script |
| `_redirects` not working | File must be in `dist/` directory at root level |

### Netlify API Deploy Debugging
```powershell
# Check published deploy
$site = (Invoke-WebRequest -Uri "https://api.netlify.com/api/v1/sites/$siteId" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
Write-Output "Published: $($site.published_deploy.id) | Created: $($site.published_deploy.created_at)"

# List recent deploys
$deploys = (Invoke-WebRequest -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys?per_page=5" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
```

---

## 🐍 POWERSCRIPT COMMANDS REFERENCE

### Common Operations
```powershell
# Check if file exists
Test-Path -LiteralPath "path\to\file"

# Read file (prefer Read tool, but for raw output)
Get-Content "file" -Raw

# Output formatted JSON
$obj | ConvertTo-Json -Depth 10

# Find text in files (prefer Grep tool)
Select-String -Path "*.ts" -Pattern "pattern"

# Get directory listing
Get-ChildItem -Path "." -Recurse -File

# Sleep/wait
Start-Sleep -Seconds 5

# Try/catch with Invoke-WebRequest
try { $r = Invoke-WebRequest -Uri "$url" -UseBasicParsing -TimeoutSec 10 } catch { Write-Output "Error: $_" }
```

### Git Operations
```powershell
git status
git add -A
git commit -m "message"
git push origin main
```

---

## 🚧 GITHUB ACTIONS (future setup)

When setting up GitHub Actions, use these patterns:

```yaml
# Basic Vite build + Netlify deploy
name: Deploy Frontend
on:
  push:
    branches: [main]
    paths: ['painel_web/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: painel_web
      - run: npx vite build
        working-directory: painel_web
      - uses: nwtgck/actions-netlify@v3
        with:
          publish-dir: painel_web/dist
          production-branch: main
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

---

## 📁 PROJECT REFERENCE

```yaml
frontend: painel_web/
  build: npx vite build (NOT npm run build)
  port: 5173
  stack: Vite 8 + React 19 + TypeScript 6 + Tailwind 4
backend: backend/
  port: 3000
  stack: Express
netlify:
  site_id: d827f06f-7185-48a4-bd9c-252e18a3272f
  token: <TOKEN_REMOVIDO>
  url: https://dazzling-fudge-f38a2c.netlify.app
admin_login:
  email: admin@choferlog.com.br
  password: <SENHA_REMOVIDA>
persistence: localStorage (prefix: choferlog_)
```
