# Macrofrente 3A-1 — Núcleo Comercial e Contratual — Checkpoint 1

> Documento de auditoria + primeiro incremento material. NÃO é deploy.
> Branch `feat/3a-1-core-comercial-contratual`, base `origin/main` = `567fcc6` (PR #413 / 2C-D).

## 1. Estado real do repositório

- `origin/main` = **`567fcc61`** — `Merge pull request #413 ... 2C-D estabilização administrativa`.
- Monorepo: `backend/`, `painel_web/`, `app_android/`, `database/`, `docs/`.
- Worktree isolado criado em `C:\Projetos\matopibalog-3a-1` a partir de `origin/main`
  (NÃO baseado na branch SEC-1). Nada em `matopibalog-sec-1` foi tocado.

## 2. Descoberta central: 3A-1 NÃO é greenfield

Ao contrário da premissa do prompt, **a maior parte do núcleo comercial/contratual
já existe, está conectada e testada em `main`** (migrations 053–061 + ~20 serviços de
domínio + rotas + páginas de painel + 103 arquivos de teste no backend).

### Já existe e está ligado (não reconstruir)

| Área (prompt) | Onde já vive em `main` | Status |
|---|---|---|
| Autoridade única de estado comercial (§4, §21) | `services/situacaoComercialDomainService.js` + `situacaoComercialService.js`; rota `GET /contratacao/situacao` | **Pronto e testado** |
| Resolver feature efetiva / entitlement (§12) | `services/entitlementDomainService.js`; `GET /painel-admin/entitlements/simular`, `/empresas/:id/entitlements` | **Pronto e testado** |
| Catálogo de features + plano×feature + override por cliente + add-ons + dependências + auditoria (§10, §11) | migration `060_catalogo_funcionalidades.sql` (`funcionalidades`, `plano_funcionalidades`, `empresa_funcionalidades`, `funcionalidade_dependencias`, `funcionalidade_auditoria`); `funcionalidadeService.js` / `funcionalidadeAdminService.js`; `GET/POST/PUT /painel-admin/funcionalidades*`, `funcionalidades-matriz`, `funcionalidades-auditoria` | **Pronto e testado** |
| Catálogo comercial (planos, preço, implantação, trial, capacidade, motorista extra) (§6, §7, §8) | tabela `planos` + migrations 044–047/059; `planoAdminService`, `planoPrecoService`, `planoComercialPatchService`; `GET/POST/PUT/DELETE /painel-admin/planos`, `impacto-preco`, `recomendar` | **Pronto e testado** |
| Contratos: proposta, contrato, signatários, eventos, snapshot imutável, hash SHA-256, cadeia de eventos tamper-evident, assinatura eletrônica interna OTP (§15, §16, §17) | migrations `053/054/055/056/057`; `contratacaoComercialService`, `assinaturaEletronicaInternaService`, `contratacaoStorageService`, `contratoGateService`, `contratoModeloService`; rotas `/contratacao/*` e `/painel-admin/empresas/:id/contratos/*` | **Pronto e testado** |
| Snapshot comercial imutável (§16) | `propostas_comerciais.snapshot JSONB` + `content_hash` (64 hex) congelados no aceite | **Pronto** |
| Página pública / catálogo (§13, §25) | `GET /planos/publicos` (whitelist: preço final, modelo cobrança, motorista extra, capacidade, trial, implantação, funcionalidades estruturadas) | **Pronto** |
| Trial respeitado (§4) | `situacaoComercialDomainService`: durante `trial_ativo`, `acoes.operar_escrita = true` mesmo com contrato pendente; trial só inicia após assinatura no fluxo v2 | **Correto — é a regra que o prompt pede** |
| Super Admin (front): Planos, Funcionalidades, Empresas, Planos Públicos | `painel_web/src/pages/PainelPlanos.tsx`, `PainelFuncionalidades.tsx`, `PainelEmpresas.tsx`, `PlanosPublicos.tsx` (com testes) | **Pronto** |

## 3. Lacunas reais identificadas (o verdadeiro escopo de 3A-1)

1. **Lista agregada (cross-tenant) de contratos no Super Admin (§18)** — só existia o
   DETALHE por empresa (`/painel-admin/empresas/:id/contratacao`). Faltava a visão
   "todos os clientes com contrato" + filtros. → **ENTREGUE neste checkpoint** (backend + testes).
2. **Página `PainelContratos.tsx` no painel_web (§18)** — inexistente. Consome o endpoint acima. → pendente (front).
3. **Fluxo comercial/contrato no app Flutter (§19)** — o app só tem `selecao_plano_screen`;
   falta a tela de situação comercial + assinatura. **Bloqueado por convivência com SEC-1** (ver §5).
4. **Texto público de implantação quando zero e catálogo de "benefícios" separado (§8, §9)** —
   parcial: `implantacao_rotulo` existe no snapshot; a página pública ainda não expõe um
   bloco de benefícios distinto das funcionalidades. → pendente (baixa complexidade).

## 4. PR #405 (`agent/app-contrato-autonomo`) — análise (§20)

- Base: `4d5a978` (pós-#404). Toca 6 arquivos do app: `plano_publico.dart`,
  `finance_provider.dart`, `app_shell.dart`, `home_screen.dart`, `selecao_plano_screen.dart`,
  `services/api_service.dart`.
- **Regra a NÃO reaproveitar (viola §4/§21):** `finance_provider.dart`
  `operacaoBloqueada => planoBloqueado || contratoObrigatorioPendente` — bloqueia a
  operação sempre que há contrato obrigatório pendente, **ignorando trial válido**.
  A autoridade correta (`situacaoComercialDomainService`, já em `main`) devolve
  `operar_escrita:true` durante `trial_ativo`. O app deve **consumir
  `GET /contratacao/situacao` → `acoes.operar_escrita`**, não re-derivar bloqueio no Flutter.
- **Reaproveitável seletivamente:** o padrão de gating do menu em `app_shell.dart` e a
  chamada de API de contrato — MAS reescritos sobre a autoridade backend.
- **Conflito com SEC-1:** `api_service.dart` e `selecao_plano_screen.dart` são alterados
  por AMBOS (SEC-1 muda 1246 linhas em `api_service.dart`). Reusar o app de #405 colide.
- **NÃO mergear #405.** Validação Android final de 3A-1 será RELEASE, não debug.

## 5. Blockers / convivência com SEC-1 (§23, §24, §31)

- **Colisão de numeração de migration:** SEC-1 (PR #414) adiciona
  `backend/migrations/062_auth_sessions_revogaveis.sql`. Portanto **3A-1 começa em 063+**.
  (Este checkpoint é aditivo e **não precisou de migration** — só usa tabelas já existentes.)
- **Arquivos compartilhados com SEC-1 a evitar** (blast radius, 47 arquivos): todo o
  subsistema de auth (`config/authConfig.js`, `controllers/authController.js`,
  `middlewares/auth*.js`, `routes/auth.js`, `services/auth/*`), `controllers/adminController.js`,
  `server.js`, e no cliente `painel_web/src/api.ts` + `app_android/lib/services/api_service.dart`
  + `app_android/lib/providers/auth_provider.dart`.
  → O incremento deste checkpoint vive em `routes/painel-admin.js` (NÃO tocado pelo SEC-1)
  e num serviço novo, portanto sem conflito.
- **Flutter fora do PATH** neste ambiente → `flutter analyze/test/build apk --release`
  (§28) não é validável localmente. Trabalho de app fica planejado, não implementado neste checkpoint.
- **Sem deploy** (Railway/Pages/main/migrations em banco compartilhado/secrets/Asaas/auth) — respeitado.

## 6. Incremento material entregue neste checkpoint

**Lista agregada de contratos para o Super Admin (§18).**

- `backend/services/contratosAdminListDomainService.js` — domínio **puro** (sem I/O):
  mapeia linha crua (contrato + joins empresa/proposta/signatários) → item canônico
  (cliente, empresa, plano, valor, status, assinado?, obrigatório, versão, hash + hash curto,
  datas de assinatura), aplica filtros (status/plano/cliente/período) e resumo por status.
  Reusa `STATUS_CONCLUIDOS` do `contratoGateService` — mesma definição de "assinado".
- `backend/routes/painel-admin.js` — novo `GET /painel-admin/contratos` (guard super-admin
  herdado; read-only; deploy-safe se tabelas ausentes → `migration_pendente`).
- `backend/tests/contratosAdminListDomain.test.js` — **13 testes** (mapeamento, joins ausentes,
  fallback de snapshot, filtros, período inclusivo, resumo, ordenação, entradas inválidas).

### Testes executados (baseline verde + novo)

- Baseline comercial (subconjunto): `situacaoComercialDomain`, `situacaoComercialService`,
  `entitlementDomain`, `funcionalidadeService`, `funcionalidadeAdmin`,
  `contratacaoComercialDomainService`, `calculadoraComercialService` → **78/78 pass**.
- Novo: `contratosAdminListDomain` → **13/13 pass**.
- `node --check` OK em `routes/painel-admin.js` e no serviço novo.
- Suíte completa do backend e `npm ci` não rodaram (node_modules não instalado no worktree) —
  a rodar antes de sair do Draft.

## 7. Próximos passos (dentro de 3A-1, mesmo PR)

1. `npm ci` no worktree + suíte backend completa (`node --test tests/*.test.js`) verde.
2. `PainelContratos.tsx` (front) consumindo `GET /painel-admin/contratos` (loading/empty/error/retry, filtros).
3. Página pública: bloco de benefícios + texto de implantação quando zero (§8, §9).
4. App (§19) — só quando a convivência com SEC-1 permitir tocar `api_service.dart` sem conflito,
   reescrevendo o gating sobre `GET /contratacao/situacao` (NÃO sobre a regra do #405).
5. Migrations aditivas a partir de **063**, se algum item exigir schema novo (testar em Postgres efêmero).
6. Atualizar o documento de Arquitetura Operacional (§32) ao fim da macrofrente.

## 8. Integração final com SEC-1 (§31)

Quando SEC-1 (#414) for mergeada em `main`: `fetch` → rebase/integração controlada →
resolver conflitos (esperados só em `server.js`/cliente se app for tocado) → repetir toda a
suíte → só então preparar o Gate de 3A-1. Sem force-push sem necessidade/autorização.
