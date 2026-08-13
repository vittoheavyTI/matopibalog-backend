# Arquitetura Operacional — Núcleo Comercial e Contratual (3A-1)

> Documento mestre do estado REAL do núcleo comercial/contratual do Matopiba Log.
> Serve para tutoriais, treinamento, marketing, suporte e planejamento.
> Complementa (não substitui) `ARQUITETURA_MACROFRENTES.md` e as decisões já registradas.
> **3A-1 NÃO implementa cobrança financeira (Asaas) — isso é a macrofrente 3A-2.**
>
> **Billing automático (3A-2):** o fluxo financeiro (customer/assinatura/cobrança/webhook/
> reconciliação/inadimplência/upgrade/downgrade/cancelamento/add-ons), sua automação
> (trigger → outbox → worker), políticas configuráveis e o adapter Asaas sandbox estão
> documentados em `ARQUITETURA_OPERACIONAL_3A2_BILLING.md` + `RUNBOOK_BILLING_3A2.md`.
> A situação comercial (seção 5 abaixo) permanece a autoridade que o billing ALIMENTA
> (inadimplência) e RESPEITA (trial nunca cancelado por pagamento).

---

## 1. Visão geral

O ciclo comercial vai de **catálogo público → cadastro → contrato → trial gratuito →
decisão de conversão → conta ativa**, com um **catálogo administrável** (Super Admin) e
uma **autoridade única de estado comercial** no backend consumida por painel e app.

Camadas (regra "ponta a ponta"): **Banco → Domain Service (puro) → API → Autorização →
Front/App → UX → Teste → CI**.

---

## 2. Catálogo comercial (planos)

Tabela `planos` + migrations 044–047/059. Administrado em **Super Admin › Planos**
(`PainelPlanos`, endpoints `/painel-admin/planos*`).

| Campo | Significado | Autoridade |
|---|---|---|
| `nome`, `descricao`, `categoria` (público-alvo) | Identidade e alvo (autonomo/empresa/ambos) | Comercial |
| `preco_mensal` | **Valor final** cobrado (qualquer modelo deriva dele) | Comercial (backend) |
| `modelo_cobranca` (`fixo`/`por_motorista`) | Como o preço é formado | Comercial |
| `preco_motorista_extra` | Valor por motorista adicional | Comercial |
| `capacidade_inclusa` / `limite_motoristas` | Capacidade e teto self-service | Comercial |
| `dias_trial` | Duração do período de teste | Comercial |
| `valor_implantacao` | Aquisição/implantação (0 = grátis) | Comercial |
| `requer_negociacao` | Enterprise/sob proposta | Comercial |
| `visivel_cadastro` | Aparece na vitrine/cadastro | Comercial |
| `matriz_funcionalidades_versao` | Versão da matriz p/ snapshot | Sistema |

**Valores auditados no catálogo real (2026-08-10, leitura Supabase):** Autônomo Solo
R$ 99,90 (cap 1, trial 7); Autônomo + Admin R$ 149,90 (cap 1, trial 7);
Empresa Start R$ 299,90 (cap 5, extra R$ 100, self-service 40, trial 14);
Empresa Essencial R$ 499,90 (cap 10, extra R$ 90); Empresa Growth R$ 799,90
(cap 20, extra R$ 80); Empresa Scale R$ 1.199,90 (cap 40, extra R$ 70);
Enterprise sob negociação. O app não possui fallback local hardcoded: exibe apenas
o catálogo retornado por `/planos/publicos`.

### Implantação/aquisição (ponta a ponta)
`valor_implantacao` no catálogo → `/planos/publicos` → vitrine pública (`PlanosVitrine`)
e app. Quando 0, a UI exibe "Grátis" (rótulo derivado; o snapshot guarda
`implantacao_rotulo`). Editar no Super Admin muda o resultado consumido pelas interfaces.

---

## 3. Funcionalidades, entitlements e add-ons

Migration `060_catalogo_funcionalidades.sql`:

- `funcionalidades` — catálogo (codigo, nome, descrições, categoria, `status_ciclo_vida`
  técnico, `modelo_cobranca`, `visivel_publicamente`, plataformas, ordem).
- `plano_funcionalidades` — **matriz plano × feature** (`disponibilidade`:
  incluida/opcional_paga/indisponivel/em_breve/sob_negociacao; `exibir_no_card`; texto).
- `empresa_funcionalidades` — **overrides/add-ons por cliente** (origem plano/adicional/
  cortesia/beta/negociacao; `preco_mensal_centavos`; vigência início/fim; `aprovado_por`;
  `motivo`). Registra o **preço comercial** do adicional — 3A-1 **não** cobra.
- `funcionalidade_dependencias` (requer/conflita) e `funcionalidade_auditoria`.

**Super Admin › Funcionalidades e Add-ons** (`PainelFuncionalidades`, endpoints
`/painel-admin/funcionalidades*`, `funcionalidades-matriz`, `funcionalidades-auditoria`,
`empresas/:id/entitlements`): abas Catálogo, Matriz por plano, Clientes (overrides) e
Auditoria.

### Autoridade de entitlement efetivo (§12/§13)
`entitlementDomainService.resolverEntitlement` responde **"empresa X pode usar feature Y?"**
considerando plano + feature padrão + override + ocultação + status. Backend é a
autoridade; front/app **não** replicam a regra. Simulação: `/painel-admin/entitlements/simular`.

### Benefícios e escopos (IA / ERP / AD)
Benefícios são **funcionalidades administráveis** (não hardcoded em JSX/Dart), exibidas
com rótulos Incluído/Adicional/Em breve/Sob consulta. Regras comerciais conhecidas
(a modelar/ativar via matriz): **IA em todos os planos com escopo diferenciado**;
**ERP via API a partir de Growth**; **domínio/AD a partir de Scale**. Enquanto uma feature
não está `visivel_publicamente`, não aparece nos cards.

---

## 4. Contratos e assinatura eletrônica

Migrations 053–057. Modelo:

- `propostas_comerciais` — proposta + **snapshot comercial imutável (JSONB)** + valores.
- `contratos_comerciais` — contrato (status, `template_version`, `content_hash` SHA-256,
  `obrigatorio`, caminhos de storage, hashes de documento/assinado/certificado).
- `contrato_signatarios` — cada instância de assinatura (papel cliente/matopiba/…,
  status, `assinado_em`, método, email mascarado, hashes de evidência sanitizados).
- `contrato_eventos` — **trilha tamper-evident** (cadeia `prev_hash`/`event_hash`).
- `contrato_assinatura_desafios` — **OTP interno** (HMAC-SHA256, expiração, tentativas).

### Snapshot imutável (§16)
No aceite, o snapshot congela plano/valores/trial/capacidade/motorista extra. Alterar o
plano depois **não** reescreve contratos emitidos — provado em
`tests/contratoSnapshotImutavel.test.js` (gera snapshot → muda plano → snapshot intacto;
detalhe do contrato lê o snapshot, não o plano vigente).

### Fluxos de assinatura
- **Cliente (app/web):** `/contratacao/contratos/:id/assinatura/desafio` → `/confirmar`
  (OTP por e-mail) ou `upload-assinado` (PDF). Papel `cliente`.
- **Matopiba (Super Admin):** `/painel-admin/empresas/:id/contratos/:id/assinatura-matopiba/*`,
  `aceitar-manual`, `reenviar-assinatura`, `obrigatorio` (toggle do gate).

### Super Admin › Contratos (3A-1, NOVO)
- `GET /painel-admin/contratos` — **lista agregada cross-tenant** (cliente, empresa, plano,
  valor, status, assinado?, obrigatório, versão, hash) + filtros status/plano/cliente/período
  + resumo. Read-only, super-admin, deploy-safe.
- `GET /painel-admin/contratos/:id` — **detalhe**: snapshot congelado, hashes probatórios,
  signatários (status/timestamps) e timeline de eventos.
- Front: página `PainelContratos` (`/painel-administrativo/contratos`), com filtros,
  estados loading/empty/error/retry e modal de detalhe.
- Domínio puro `contratosAdminListDomainService` (map/filtros/resumo/detalhe), reusando
  `STATUS_CONCLUIDOS` do gate — mesma definição de "assinado".

---

## 5. Estado comercial canônico e regra de trial

`situacaoComercialDomainService` (puro) + `situacaoComercialService` (I/O). Exposto em
**`GET /contratacao/situacao`** (fonte única para painel e app).

Situações canônicas: `aguardando_assinatura`, `trial_ativo`, `trial_expirando`,
`trial_expirado_aguardando_decisao`, `trial_encerrado_sem_contratacao`,
`conversao_aguardando_pagamento`, `ativa`, `suspensa_financeiramente`,
`bloqueada_administrativamente`, `cancelada`, `legado`.

### Regra canônica de trial (§16) — obrigatória
- **Trial é gratuito**: nenhuma cobrança durante o teste.
- **Trial ativo → `operar_escrita = true`**, mesmo com contrato pendente. Pagamento,
  contrato ou aceite antecipado **não** encerram o trial.
- **Contrato obrigatório pendente sozinho não bloqueia trial válido**; quando há
  `trial_ends_at` futuro, o backend preserva `operar_escrita=true` e expõe
  `assinar_contrato=true` como próxima ação, sem encerrar o teste.
- Fim do trial exige **decisão explícita**; "não continuar" não gera dívida.
- **Bloqueio duro** (administrativo/segurança/fraude/jurídico) nunca é removido por pagamento.
- Contas **legado** (`commercial_flow_version` ≠ v2) seguem o caminho antigo.

Prova anti-regressão: `tests/trialMatrizCanonica.test.js` (matriz de estados).
**Esta é a lógica correta que substitui o anti-padrão do PR #405**
(`operacaoBloqueada = ... || contratoObrigatorioPendente`).

---

## 6. Página pública

`GET /planos/publicos` (sem auth, whitelist) devolve preço final, modelo de cobrança,
motorista extra, capacidade, trial, implantação, `recursos` e **funcionalidades
estruturadas** por plano. `PlanosPublicos` + `PlanosVitrine` renderizam os cards com
rótulos; fallback para `recursos`. Alteração no Super Admin reflete na API e nos cards
sem edição de código.

---

## 7. App (autônomo/cliente)

- `ContratacaoApiService` — serviço comercial **separado** que compõe sobre
  `ApiService.currentSessionToken()`/`baseUrl` (não toca `api_service.dart`; não duplica
  auth/refresh; compatível com a evolução do SEC-1).
- `models/situacao_comercial.dart` — espelha `/contratacao/situacao`; o app lê
  **`podeOperar`** (autoridade backend), não infere bloqueio localmente.
- `screens/situacao_comercial_screen.dart` ("Minha conta"): plano, trial (dias restantes),
  status do contrato, CTA de assinatura (abre a rota web oficial `/contratacao`, onde a
  assinatura é concluída por OTP), banner de bloqueio só quando o backend nega escrita.
  Fail-open em falha de rede.
- Validação: `flutter analyze` + `flutter test` + `flutter build apk --release`
  (workflow `flutter-ci.yml`; artifact `app-release-apk`). Validação final é **RELEASE**.

---

## 8. Banco / migrations

3A-1 **não criou migration nova nesta rodada** — usa as tabelas 053–061 já existentes.
As alterações diretas tentadas nas migrations históricas `041_catalogo_comercial.sql` e
`046_implantacao_gratis_lancamento.sql` foram revertidas; os arquivos permanecem como
histórico versionado. Auditoria read-only no Supabase confirmou que o histórico gerenciado
em `supabase_migrations.schema_migrations` usa versões timestamped e já contém até
`062_auth_sessions_revogaveis`; não houve escrita no banco e não foi criada migration
corretiva porque não há prova de dado comercial errado no catálogo real.

Se uma migration futura desta frente for necessária, ela deve respeitar a ordem real já
ocupada: **062** e **064** pertencem ao SEC-1, **065** pertence ao #417, e **066** pertence
ao billing 3A-2. Toda migration desta frente deve ser aditiva, idempotente, testada em
Postgres efêmero, **nunca aplicada em banco compartilhado** aqui.

---

## 9. Autorização (APIs Super Admin)

Todos os endpoints `/painel-admin/*` passam por `verifyToken → isAdmin → isSuperAdmin`.
Matriz provada por testes HTTP: sem token → 401; token inválido/comum/admin-de-empresa
→ 403; super-admin → passa. UUID inválido → 400; inexistente → 404.

---

## 10. Reservado para 3A-2 (NÃO implementar em 3A-1)

3A-1 **registra** valor/obrigação comercial (add-ons, implantação, mensalidade no snapshot)
mas **não**: cria customer/subscription/charge Asaas, recebe pagamento, processa webhook
financeiro, nem bloqueia por inadimplência Asaas. Interfaces já preparadas para 3A-2:

- `empresa_funcionalidades.preco_mensal_centavos` / `billing_component_id` (add-on faturável).
- `propostas_comerciais` / snapshot com mensalidade + implantação separadas.
- `situacaoComercialDomainService.montarPagamentosIniciais` (conciliação de faturas iniciais
  por origem) — pronto para receber o status real de pagamento vindo de 3A-2.
- `conversao_aguardando_pagamento` / `decisao_pos_trial='continuar'` — pontos de entrada da
  cobrança real.

---

## 11. Convivência com SEC-1 (PR #414)

SEC-1 (sessões revogáveis) ainda não está em `main`; produção contém código do SEC-1 fora do
`main`. Por isso 3A-1 **não** é deployada/mergeada antes do SEC-1. Arquivos compartilhados
evitados por 3A-1: subsistema de auth, `adminController.js`, `server.js`, `painel_web/src/api.ts`,
`app_android/lib/services/api_service.dart`, `auth_provider.dart`. O app de 3A-1 compõe sobre a
API pública do `ApiService` em vez de alterá-la. Quando SEC-1 entrar em `main`: fetch → rebase
controlado → resolver conflitos → repetir toda a suíte → manter #415 Draft até o Gate 3A-1.

---

## 12. Estado real desta revisão (2026-08-10)

### IMPLEMENTADO
- Catálogo público sem fallback local de preços: página `/planos` e cadastro consomem somente
  `/planos/publicos`; falha de API mostra indisponibilidade, não valores de referência.
- Textos fixos de "grátis no lançamento" removidos das telas comerciais; a UI deriva a
  isenção do valor `valor_implantacao`.
- Trial v2 preservado mesmo com contrato obrigatório pendente: `operar_escrita=true` durante
  trial válido e assinatura pendente como próxima ação.
- Migrations 041/046 preservadas como histórico; auditoria do banco foi somente leitura e
  nenhuma migration corretiva foi criada sem prova de dado comercial errado.

### TESTADO
- Backend full: `node --test tests/*.test.js` — 1162 testes PASS.
- Frontend full serial: `npm.cmd test -- --run --no-file-parallelism --maxWorkers=1` —
  75 testes PASS. A execução paralela padrão apresentou uma falha intermitente em
  `PainelFuncionalidades.test.tsx`; o arquivo isolado passou 9/9.
- Frontend build/typecheck: `npm.cmd run build` — PASS.

### PENDENTE INTEGRAÇÃO SEC-1
- Rebase/integração após #414 entrar em `main`.
- Repetir backend full, frontend full, build web e validação Flutter depois da integração.

### PENDENTE PRODUÇÃO
- Não mergeado.
- Não deployado.
- Flutter local não validado nesta máquina: `flutter` não está disponível no PATH.
