# Gate 3A-1 — Integração com SEC-1 e plano de execução/deploy

> Preparado ANTES de o SEC-1 (#414) entrar em `main`. **Não executar o deploy agora.**
> Base do ensaio: SEC-1 `HEAD = 2648e00` · 3A-1 `HEAD = 4d7b924` (#415).
> O ensaio ocorreu em worktree isolado `C:\Projetos\matopibalog-integration-sec1-3a1`
> (branch local `integration/sec1-3a1-rehearsal`, **não pushada**). Nenhuma branch
> oficial foi alterada.

---

## 1. Resultado do ensaio de integração (SEC-1 + 3A-1)

Árvore simulada = SEC-1 `2648e00` + merge da branch 3A-1 (commits `20f0a8a`, `0a77c38`,
`124e507`, `fe4180e`, `e336660`, `4d7b924`).

### Conflitos: **ZERO** (Categoria A — sem conflito, para todos os arquivos)
3A-1 e SEC-1 tocam conjuntos de arquivos **disjuntos**. O `git merge` foi limpo, sem
marcadores, sem paths não-mesclados.

| Área | SEC-1 altera | 3A-1 altera | Interação |
|---|---|---|---|
| Auth backend (`authConfig`, `authController`, `authSession*`, `middlewares/auth*`, `routes/auth`, `services/auth/*`, `server.js`) | Sim | **Não** | Nenhuma |
| `controllers/adminController.js` | Sim | Não | Nenhuma |
| `routes/painel-admin.js` | **Não** | Sim (endpoints de contratos) | Nenhuma |
| `services/*` comercial + `tests/*` | Não | Sim (novos arquivos) | Nenhuma |
| `painel_web/src/api.ts`, `package(-lock).json` | Sim | Não | Nenhuma |
| `painel_web/src/App.tsx`, `Sidebar.tsx`, `pages/PainelContratos*` | Não | Sim | Nenhuma |
| `app_android/lib/services/api_service.dart`, `providers/auth_provider.dart` | Sim | **Não** | Só composição (ver §2) |
| `app_android/lib/services/contratacao_api_service.dart`, `models/situacao_comercial.dart`, `screens/*`, `test/*` | Não | Sim | Ver §2 |
| `.github/workflows/flutter-ci.yml` | Não | Sim (novo) | Nenhuma |

### Semântico (Categoria C) — 1 achado, resolvido/preparado
O app 3A-1 compõe sobre a API pública do `ApiService` (SEC-1). Confirmado na árvore SEC-1:
- `ApiService.baseUrl` (getter público) e `ApiService.currentSessionToken()` **existem**.
- `currentSessionToken()` devolve o `_sessionToken` em memória, **rotacionado** pelo SEC-1
  (atualizado em `setSessionTokens`); fallback ao secure storage só em sessão persistente;
  sessão `memoryOnly` **não** cria persistência paralela (SEC-1 apaga as chaves de storage);
  `logout`/revogação zeram o token → chamadas 3A-1 seguem sem `Authorization` → **fail-open
  para consulta** (nunca operam com token antigo).
- **Achado:** sob os access tokens **curtos** do SEC-1, o GET direto do `ContratacaoApiService`
  poderia cair em `SituacaoComercial.desconhecida()` só porque o access expirou.
- **Resolução preparada (patch pós-SEC-1, §3):** em 401/403, chamar uma vez a
  `ApiService.refreshAccessTokenResult()` (autoridade de refresh do SEC-1) e repetir a chamada.
  **Não** entra no #415 agora porque `refreshAccessTokenResult()` **só existe no SEC-1**
  (aplicar após o merge, senão o #415 não compila contra `main`).

### Migrations (§12): consistentes
`053–061` (comercial) + `062_auth_sessions_revogaveis` (SEC-1) coexistem, ordenadas, sem
duplicidade de número. **3A-1 não adiciona migration.** Próximo número livre = **063**.

---

## 2. Composição do app com SEC-1 (evidências)

`ContratacaoApiService` (3A-1) → `ApiService.currentSessionToken()` + `ApiService.baseUrl`.
- Usa o access token correto e **rotacionado** (lê fresh a cada chamada).
- Não duplica auth nem refresh; não armazena token; não lê storage legado indevidamente.
- Funciona em `memoryOnly` e em sessão persistente.
- `logout`/revogação → sem token → não continua operando; tela comercial fail-open (read-only).

---

## 3. PATCH pós-SEC-1 (aplicar SOMENTE após #414 estar em `main`)

Arquivo: `app_android/lib/services/contratacao_api_service.dart`. Adiciona refresh-and-retry
reusando a autoridade do SEC-1. Validado na árvore de ensaio (SEC-1 + 3A-1).

```dart
// Novo helper privado:
static Future<http.Response> _authedGet(String path) async {
  Future<http.Response> enviar() async {
    final token = await ApiService.currentSessionToken();
    return http.get(_uri(path), headers: _headers(token))
        .timeout(const Duration(seconds: 15));
  }
  final resp = await enviar();
  if (resp.statusCode != 401 && resp.statusCode != 403) return resp;
  final refresh = await ApiService.refreshAccessTokenResult(); // só existe no SEC-1
  if (!refresh.refreshed) return resp;
  return enviar();
}
// getSituacaoComercial() e getStatusContratacao() passam a usar _authedGet(...).
```

---

## 4. Gate 3A-1 — runbook de execução (NÃO executar agora)

Pré-condição: **SEC-1 (#414) mergeado em `main` e estável** (Gate B fechado).

1. **Atualizar #415 contra o novo `main`**
   - `git -C C:\Projetos\matopibalog-3a-1 fetch origin`
   - Integração controlada: `git merge origin/main` (esperado: **0 conflitos**, conforme ensaio)
     ou `git rebase origin/main` se preferir histórico linear. Sem force-push destrutivo.
2. **Aplicar o patch pós-SEC-1** (§3) e commitar em #415.
3. **Regressão completa**
   - Backend: `cd backend && npm ci && node --test tests/*.test.js` (SEC-1 + comercial + 3A-1).
   - Frontend: `cd painel_web && npm ci && npm test && npm run build`.
   - Flutter (CI): `flutter analyze && flutter test && flutter build apk --release`.
   - Postgres: **nenhuma migration nova**; 062 do SEC-1 já aplicada no Gate do SEC-1.
4. **Deploy backend (Railway)** → aguardar redeploy → **smoke API**:
   - `/health` 200; `GET /planos/publicos` 200; `GET /contratacao/situacao` autenticado;
   - `GET /painel-admin/contratos` e `/contratos/:id` como super-admin (200) e negados p/ comum (403).
5. **Deploy frontend (GitHub Pages)** → **smoke admin/público**:
   - Login; `/painel-administrativo/contratos` (lista/detalhe); `/painel-administrativo/planos`
     e `/funcionalidades`; página pública `/planos` reflete o catálogo.
6. **APK release** (o app mudou) → publicar/distribuir o artifact `app-release-apk`.
7. **Smoke app**: login (SEC-1) → "Minha conta" (situação comercial) → trial/contrato/CTA;
   refresh de token durante uso; logout revoga sessão.
8. **Observação**: logs Railway (só 2xx/3xx esperados nas rotas comerciais; nenhuma escrita
   inesperada em contrato/plano); verificar ausência de tempestade de refresh.

### Rollback (por SHA)
- Backend/Front: reverter o merge de deploy para `main` anterior ao Gate 3A-1
  (`git revert -m 1 <merge_sha>` ou redeploy do SHA anterior no Railway/Pages).
- App: republicar o APK release anterior. Nenhuma migration a reverter (3A-1 não adiciona).
- Feature-safe: os endpoints/páginas de 3A-1 são aditivos; desabilitar o item de menu
  "Contratos" no Sidebar é um mini-rollback de UI se necessário.

---

## 5. Ordem segura de deploy (resumo)
SEC-1 estável em main → atualizar #415 → patch pós-SEC-1 → CI completa → backend → smoke API
→ frontend → smoke admin/público → APK release → smoke app → observação. Rollback por SHA.

## 6. O que permanece proibido até o Gate
Deploy de produção, merge de #415, aplicação de migration em banco compartilhado, alteração de
secret, início do Asaas/3A-2, alteração do SEC-1/#414.
