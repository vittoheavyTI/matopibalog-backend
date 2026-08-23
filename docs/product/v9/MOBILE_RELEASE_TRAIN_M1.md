# Mobile Release Train M1 — Fechamento Técnico

> Documento de frente (Agent B / `MOBILE_M1_WRITER`). **Não** é fonte canônica: o
> `MASTER_LEDGER`, `ROADMAP`, `DECISIONS` e `CONTEXT_BRIDGE` seguem sob o
> orchestrator/integrator. Aqui fica a reconciliação técnica do trem de release M1.

- `MACROFRONT=MOBILE_RELEASE_TRAIN_M1`
- `MOBILE_M1_BASE_SHA=1a9330b48538de3276c3bad7461654ba5b2c0c52` (`origin/main`)
- `BRANCH=feature/mobile-release-train-m1`
- `WORKTREE=worktree-mobile-m1`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0`
- `AGENT_B_SCHEMA_AUTHORITY=NONE`

## 1. Auditoria DELTA (congelada)

Reconciliação do backlog real (`MASTER_LEDGER` §MOBILE_RELEASE_TRAIN_M1 e ROADMAP).
A maior parte do trem já estava **implementada** em macrofrentes anteriores (Onda 1,
P2, E1.4B) e só aguardava consolidação; o único item `ROADMAP_NOT_IMPLEMENTED` era o
**M1-008 (App Version Policy + in-app update)**.

| ID | Descrição | Estado antes | Ação nesta frente | Dependência |
|---|---|---|---|---|
| MOBILE-M1-001 | Realtime da tela de detalhe do frete (SSE auto-refresh) | `DONE` (Onda 1 · E1.7) | `DONE_VERIFIED` — `lib/services/realtime_service.dart` (reconnect + backoff + resume) + `detalhe_viagem_screen` | device |
| MOBILE-M1-002 | Paridade web↔app de lançamentos (criar/aprovar/rejeitar/cancelar) | `DONE` (Onda 1 · E1.2/E1.7) | `DONE_VERIFIED` — refetch por evento SSE; cancelado permanece visível | device |
| MOBILE-M1-003 | Enforcement de permissões V9 no app | `DONE` (P2) | `DONE_VERIFIED` — gate por permissão efetiva; redação financeira | device |
| MOBILE-M1-004 | Viewer interno PDF/imagem antes de ações externas | `DONE` (E1.4B) | `DONE_VERIFIED` — `document_viewer_service` + `document_preview_screen` | device |
| MOBILE-M1-005 | Scanner on-device multipágina (review/reorder/remove/retake + PDF local) | `DONE` (E1.4B) | `DONE_VERIFIED` — `document_scanner_service` + `document_pdf_service` + `document_scan_review_screen` | device |
| MOBILE-M1-006 | Upload idempotente/resiliente (`client_request_id`, retry seguro) | `DONE` (E1.4B) | `DONE_VERIFIED` — `document_upload_service` (id estável + classificação retryable) | device |
| MOBILE-M1-007 | Fluxo preview-first (salvar/compartilhar/abrir fora após prévia) | `DONE` (E1.4B) | `DONE_VERIFIED` — `document_preview_screen` | device |
| MOBILE-M1-008 | **App Version Policy + in-app update** | `ROADMAP_NOT_IMPLEMENTED` | **IMPLEMENTADO** (backend endpoint + serviço/UX/testes no app) | — |
| RBV9-INV-108 | Metadata de "Outro" (nome/descrição) consumida pelo app | `DONE` (E1.4B) | `DONE_VERIFIED` — `_DocumentoOutroMetadata` em `detalhe_viagem_screen` | device |
| MOBILE-FLEET-M1-001 | Motorista ver veículo/composição atual | — | `DEFERRED` — API não expõe leitura para o motorista (rotas `/fleet/*` exigem `fleet.view`/`fleet.manage`); um endpoint self-scope tocaria autoridade de permissão/escopo (shared-core, colisão potencial com #457). Fora do schema-free trivial. | authority |

Regra seguida: **não reimplementar o que já está pronto** (§7). Itens `DONE_VERIFIED`
permanecem com validação física pendente no aparelho (`ACCEPTANCE_EVIDENCE_PENDING`).

## 2. MOBILE-M1-008 — App Version Policy + in-app update (D-053)

### Backend (schema-free, público, sem banco)

- `GET /app/version-policy?platform=android&current_version=<v>` — rota **pública**
  read-only (o app precisa dela antes do login e na tela de update obrigatório).
- Fonte de autoridade **central** via env (`APP_ANDROID_MIN_VERSION`,
  `APP_ANDROID_RECOMMENDED_VERSION`, `APP_ANDROID_LATEST_VERSION`,
  `APP_ANDROID_STORE_URL`, `APP_ANDROID_RELEASE_NOTES`) com **defaults seguros**
  (`min = recommended = latest = 1.0.0`) → o gate nasce **inerte** e nunca bloqueia
  por engano. O owner endurece a política ajustando env no Railway, sem deploy nem
  migration.
- Arquivos: `backend/utils/appVersionPolicy.js`, `backend/routes/appVersion.js`,
  mount de 1 linha em `backend/server.js`, testes `backend/tests/appVersion.test.js`.

Contrato de resposta:

```json
{
  "platform": "android",
  "latest_version": "1.0.0",
  "recommended_version": "1.0.0",
  "minimum_supported_version": "1.0.0",
  "store_url": "https://play.google.com/store/apps/details?id=br.com.matopibalog.app",
  "release_notes": "",
  "update_severity": "none",
  "current_version": "1.0.0",
  "server_time": "..."
}
```

### App (Flutter)

- `lib/utils/version_compare.dart` — comparação **não-lexicográfica** (`1.10.0 > 1.9.0`),
  espelha o backend.
- `lib/services/app_version_policy_service.dart` — consome a política e **recomputa a
  severidade localmente** (autoridade defensiva do bloqueio); fail-safe: rede ruim →
  `unknown` (não bloqueia).
- `lib/widgets/app_update_gate.dart` — envolve o `home`:
  - `required` → tela de bloqueio controlado (explica o motivo, "Atualizar agora",
    "verificar novamente"; sem loop);
  - `recommended` → diálogo dispensável;
  - `optional` → SnackBar discreto;
  - `none`/`unknown` → nada.
- "In-app update": abre a ficha oficial da Play via `url_launcher` (padrão já usado no
  app). Update nativo da Play (`flexible`/`immediate`) fica como evolução — não bloqueia
  o M1 e evita risco de build com dependência nativa não compilável localmente (§40
  permite a ficha da loja como fallback).
- Testes: `test/version_compare_test.dart`, `test/app_version_policy_service_test.dart`
  (todos os estados de severidade, recomputo local vs servidor, fallback seguro).

Comparação de versão coberta explicitamente contra a armadilha lexicográfica (§42).

## 3. Mudanças de backend

- Somente **aditivas** e backward-compatible: um util puro, uma rota nova pública e um
  mount de 1 linha. Nenhum contrato existente alterado. `SCHEMA_CHANGES=0`.
- `PRODUCTION_BUSINESS_WRITES=0`, `ENV_CHANGED=false` (defaults no código; envs de
  produção são decisão do owner), `ASAAS_TOUCHED=false`, `BILLING_TOUCHED=false`,
  `FISCAL_TOUCHED=false`.

## 4. Build / Release Candidate

- Canal remoto canônico do PR: **GitHub Actions** (`.github/workflows/app-ci.yml` e
  `flutter-ci.yml`) — roda `flutter analyze`, `flutter test`, testes JVM nativos e
  `flutter build apk --release` (Flutter fixo `3.44.0`, Java 21), publicando o artifact
  `app-release-apk`. Serve como evidência de build remoto do M1.
- Codemagic (`codemagic.yaml`) permanece como pipeline oficial de distribuição
  consolidada; **não** é acionado por esta frente.
- Sem alteração de signing. Sem publicação na Play.

## 5. Versionamento

- `VERSION_BEFORE=1.0.0+1`. Sem bump nesta frente: a política nasce inerte
  (min=rec=latest=1.0.0) e o objetivo do M1-008 é a **infra** de política/atualização,
  não anunciar uma versão nova. O bump acompanha a decisão de release do owner.

## 6. Segurança

- Endpoint público read-only sem dado sensível; validação Zod de query; sem banco.
- App não guarda segredo; não bloqueia por falha de rede; sem download automático (a
  atualização exige ação explícita do usuário).

## 7. Deferidos

- `MOBILE-FLEET-M1-001` — depende de decisão de autoridade (leitura self-scope do
  motorista) tocando permission/scope core; fora do schema-free trivial e com risco de
  colisão com #457. `DEFERRED`.
- Update nativo Play (`flexible`/`immediate`) — evolução após o M1.
- `PHYSICAL_DEVICE_VALIDATION=PENDING_OWNER_DEVICE` (itens `DONE_VERIFIED` acima):
  `ACCEPTANCE_EVIDENCE_PENDING`, não `IMPLEMENTATION_INCOMPLETE`.
- `PLAY_PUBLICATION=NOT_AUTHORIZED`.

## 8. Release notes (M1)

**Implementado**
- Política de versão do app + experiência de atualização (obrigatória/recomendada/
  opcional) com abertura da loja oficial.

**Consolidado/validado (código pronto de macrofrentes anteriores; validação física
pendente)**
- Realtime da tela de detalhe; paridade de lançamentos web↔app; enforcement de
  permissões V9; viewer interno PDF/imagem; scanner multipágina; upload idempotente;
  fluxo preview-first; metadata de "Outro".

**Pendente de aparelho**
- Validação física dos fluxos acima em APK consolidado.
