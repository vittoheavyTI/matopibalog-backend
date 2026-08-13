# SEC-1 — Sobreposição com PR #405 (app) e CI mobile

## 1. Diff semântico de `app_android/lib/services/api_service.dart`
- **main (567fcc6):** contém os métodos de auth do app: `setSessionToken` / `clearSessionToken`, `login`, `getMe` / `getMeDetalhado`, além dos métodos de negócio.
- **PR #405** (`agent/app-contrato-autonomo`, "NÃO MERGEAR sem validar Flutter"): **1 hunk** em `api_service.dart` (`@@ -420,+420,21 @@`) que **adiciona apenas** `static Future<Map<String,dynamic>?> getContratacaoStatus()` (status de contratação/contrato). **Não altera, não remove e não toca** nenhum método de auth (`login`/`token`/`getMe`/`refresh`/`logout`/`setSessionToken`).
- **SEC-1** vai alterar/adicionar os métodos de **auth/refresh** do app (ex.: armazenamento do refresh em secure storage, chamada a `/auth/mobile/refresh`, single-flight, renovação do access) — em **regiões diferentes** do arquivo (topo/serviço de token), longe da linha ~420.

## 2. Conflito e risco
- **Risco de conflito de merge: BAIXO.** #405 mexe em região não-auth (linha ~420); SEC-1 mexe nos métodos de auth (outra região). O git tende a mesclar sem conflito, mas por ser o MESMO arquivo, um merge/rebase futuro deve ser revisado manualmente.
- **Lógica válida a preservar de #405:** `getContratacaoStatus()` — não deve ser perdida numa reconciliação. SEC-1 **não** copia, **não** remove e **não** altera esse método.

## 3. Estratégia (sem tocar em #405)
- **Não** fechar, **não** alterar, **não** cherry-pick de #405.
- SEC-1 mantém os commits do app **isolados** (só arquivos de auth), facilitando reconciliação futura.
- Ao reabrir/mergear #405 depois do SEC-1: rebase de #405 sobre a main pós-SEC-1; como as regiões não colidem, deve aplicar limpo; revisar `api_service.dart` manualmente.
- **Aviso adicionado ao corpo/《comentário》da PR #414.**

## 4. CI mobile (workflow `.github/workflows/app-ci.yml`)
- Isolado, SHA-pinned: `actions/checkout@11d5960…` (v4), `actions/setup-java@cf277c60…` (v4, Temurin 21), `subosito/flutter-action@1a449444…` (v2), `actions/upload-artifact@ea165f8d…` (v4).
- **Flutter fixo 3.24.5** (Dart 3.5.x; casa com `sdk >=3.0.0 <4.0.0`), **Java 21** (igual ao Codemagic; o Codemagic usa `flutter: stable` flutuante — aqui é fixo).
- Passos: `flutter pub get` · `flutter analyze` · `flutter test` · `flutter build apk --debug` · artifact do APK debug. **Sem keystore, sem signing real, sem publicação, sem secrets de loja.**
- **Baseline**: o 1º run nesta branch roda com o app **idêntico a 567fcc6** (SEC-1 ainda não alterou o app) → é o baseline. Após as alterações de auth do app, o mesmo workflow re-executa no HEAD.
- Registrar do baseline: versões (Flutter/Dart/Java/Gradle), analyze, testes, build, duração, artifact.
