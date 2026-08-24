# Campaign-C — Operational Progress + Dispatch Readiness

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados pelo integrator após o fechamento técnico.

- `MACROFRONT=CAMPAIGN_C_OPERATIONAL_PROGRESS_AND_DISPATCH_READINESS`
- `BASE_SHA=21f14752d8a52243736d285f7875e7b9f3d571cb`
- `PR=469` · `MERGE_SHA=95fcded985470d059519008562a99fdb8dac3fd1`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0` · `DISPATCH_WRITES=false` · `PRODUCTION_BUSINESS_WRITES=0` · `AI_WRITE_TOOLS=0`

## 1. Objetivo
Depois que Campaign-B liga o plano aprovado a fretes reais (`campaign_trip_freights`),
faltava responder duas perguntas sem escrever nada: **"como está indo a execução desta
campanha?"** e **"quem está elegível para cobrir a demanda que falta?"**. Campaign-C
responde as duas como projeção read-only, sem inventar autoridade nova — quem manda no
estado de execução continua sendo o Frete canônico.

## 2. Progresso operacional (`campaignProgressService`)
Deriva tudo do plano aprovado + `campaign_trip_freights` + status canônico do Frete
(nenhuma tabela nova, nenhum estado paralelo):
- **Mapeamento CONGELADO** Frete→bucket de execução (`freightExecutionStatus.js`):
  `pendente/ativo/em_viagem/em_andamento→IN_EXECUTION`, `finalizado→COMPLETED`,
  `cancelado→CANCELLED`; qualquer status fora desse vocabulário → `UNKNOWN`, **nunca**
  silenciosamente `IN_EXECUTION`/`COMPLETED`.
- **Sem dupla contagem**: cada viagem planejada cai em exatamente 1 bucket
  (`not_materialized` xor `materialized{completed|cancelled|in_execution|unknown}` xor
  `blocked` pelo planner).
- **Quantidade em toneladas**, separada por estágio: `target/planned/materialized/
  completed/cancelled/remaining`, com `coverage.incompatible_units` quando a unidade do
  frete foge do domínio de massa (nunca converte às cegas).
- **Saúde determinística** (`ON_TRACK/ATTENTION/CRITICAL/COMPLETED/NO_EXECUTION_YET`) e
  **replanejamento** (`REPLAN_NOT_NEEDED/REPLAN_RECOMMENDED/REPLAN_REQUIRED_BY_INVARIANT`),
  ambos com `reason_code`/evidência — sem score mágico.
- `GET /operation-campaigns/:id/progress` sob `campaign.view`.

## 3. Elegibilidade determinística (`dispatchEligibilityService`)
Responde "quem está elegível **agora**" para uma viagem planejada não materializada, sem
ofertar/designar/travar/expirar nada:
- **Bloqueios** (→ `INELIGIBLE`) espelham exatamente a materialização canônica: motorista
  inativo/ausente, recurso inativo/ausente, recurso fora do escopo operacional do usuário,
  sem vínculo temporal motorista↔recurso ativo (`driver_vehicle_assignments`).
- **Capacidade**: só compara quando os dois lados (capacidade do recurso × exigida pela
  viagem) são conhecidos; senão `UNKNOWN` — nunca infere por tipo de veículo.
- **Documentos/manutenção**: geram só `warning` (`ELIGIBLE_WITH_WARNINGS`), nunca um
  bloqueio fabricado a partir de um dado incompleto.
- **Compatibilidade de rota é sempre `UNKNOWN`** — Route Intelligence V1 não carrega
  restrição de caminhão; alegar compatibilidade seria inventar segurança.
- **Sem score mágico**: ordenação estável por categoria objetiva (elegível > com aviso >
  desconhecido > inelegível; depois capacidade desc; depois id estável).
- **Bounded**: top-N determinístico (default 25, máx 100), sem cross-product, sem N+1
  (recursos/documentos/manutenção carregados em lote via `.in()`).
- `GET /operation-campaigns/:id/plans/:planId/trips/:tripId/eligibility` sob
  `campaign.manage` (mais restritiva que `campaign.view` — expõe candidatos individuais).

## 4. Dispatch readiness (leitura, não ação)
`trips_detail[].readiness` classifica cada viagem: `READY_FOR_DIRECT_ASSIGNMENT`,
`READY_FOR_OFFER_DISPATCH`, `BLOCKED`, `ALREADY_ASSIGNED`, `ALREADY_EXECUTING`,
`COMPLETED`. **Não existe** designação, oferta, aceite, expiração ou lock de
concorrência — isso é Dispatch real (`RBV9-INV-031`), **CLOSED em produção** desde a
frente Dispatch V1 (PR #471, migration 079). Ver [DISPATCH_V1](./DISPATCH_V1.md).

## 5. Torre de Controle (`commandCenterService.carregarCampaignAttention`)
Aditivo e defensivo: reusa a **mesma** `campaignProgressService` (nunca recalcula saúde
por conta própria), roda só nas campanhas `APPROVED` do escopo (top-N=25), só entra na
lista quando `ATTENTION`/`CRITICAL`/replanejamento pendente, nunca expõe valor
financeiro, e uma campanha com erro (`try/catch` por item) não derruba a Torre inteira.
Gated por capability `can_view_campaign` (= `campaign.view` efetivo, com entitlement).

## 6. Realtime (`freightRealtimeSignal.js`)
Sinal mínimo e best-effort ao finalizar/cancelar frete: reusa o `realtimeBus` (SSE por
empresa) já existente — **sem WebSocket novo**. `try/catch` em volta de um `emit`
síncrono que já tem seu próprio `try/catch` interno; uma falha de publicação nunca
falha a mutação canônica do Frete. O cliente web reconecta e refaz o fetch canônico
(evento é só um "algo mudou", nunca a fonte de verdade).

## 7. IA (read-only)
Tool `operation.campaign.progress`: reusa `campaignProgressService`/`listCampaigns`
diretamente (nunca acessa banco), `campaign.view` + entitlement `operation_campaign`,
sem lista de campanhas → sem PII, sem valor financeiro, sempre retorna evidência
(`snapshot_at`). `AI_WRITE_TOOLS=0`.

## 8. Web (`OperationCampaigns.tsx`)
Seção "Execução da campanha": cards de progresso (meta/planejado/materializado/em
execução/concluído/cancelado/restante), barra de % concluído, banner de
replanejamento, tabela de viagens (rota/qtd/materialização/execução/prontidão/atenção)
com drawer de elegibilidade por viagem bloqueada/não materializada. Reusa o hook SSE
já existente (`useLancamentosRealtime`) com refresh debounced (600ms) + fallback de
polling a cada 60s. **Sem** botão de designar/ofertar/aceitar/cancelar oferta — só
navegação (`Atualizar`, deep link do frete) e leitura.

Dois bugs reais corrigidos durante a validação desta frente (não eram problema de
ambiente/teste):
1. **Deep link morto**: o link do frete usava `href="#/relatorios/viagens"` num app
   `BrowserRouter` — nunca navegava. Trocado por `<Link to="/relatorios/viagens?frete=
   <id>">`, reusando o contrato de query param já estabelecido pela Torre de Controle
   (`TorreControle.tsx` → `linkOperacional`) e lido por `GerenciamentoViagens.tsx`.
2. **Leak de timer no unmount**: o debounce do refresh SSE (`setTimeout` em `useRef`)
   não era limpo ao desmontar o componente — um sync agendado pouco antes de sair da
   tela ainda disparava `fetch`+`setState` num componente já desmontado. Corrigido com
   cleanup em `useEffect`.

## 9. Validação
- Backend: `1793/1793` (0 fail), inclui 46 testes novos desta frente
  (`campaignProgressService`, `dispatchEligibilityService`, `freightExecutionStatus`,
  `freightRealtimeSignal`, `aiCampaignProgressTool`, `commandCenterCampaignAttention`).
- Web: `26/26` arquivos / `135/135` testes (0 fail); suíte completa rodada 2x em
  paralelo para confirmar estabilidade — 1 flake transitório observado num arquivo
  **não relacionado** (`CatalogoPublicoErro.test.tsx`, ambiente sob carga, não
  reproduzido na segunda rodada).
- Build: `tsc -b && vite build` sem erros.
- CI do PR: 3/3 verde (Backend, Frontend, SEC-1).
- Deploy: Railway `585549fa-5d3d-4e70-899a-4b3727d753a4` `SUCCESS` + GitHub Pages no
  mesmo SHA.
- Smokes pós-deploy (read-only): `/health` 200; `/operation-campaigns/:id/progress`,
  `/eligibility`, Torre de Controle e `/ai/chat` → 401 sem auth; frontend 200; logs de
  deploy/HTTP sem erro novo.

## 10. Deferidos / não cobertos nesta frente
- **Benchmark formal em 10/100/500 viagens não medido** — sem harness de carga contra
  banco real disponível nesta sessão. Evidência estrutural (não substitui benchmark):
  contagem de query é **O(1) em relação a N** — recursos/documentos/manutenção são
  carregados em lote via `.in()`, nunca em loop por viagem.
- Teste HTTP dedicado de 401/403 para as 2 rotas novas não escrito; usam o mesmo
  middleware (`requireCampaignPermission`) já coberto para as demais rotas de
  campanha, e o smoke pós-deploy confirmou 401 sem auth.
- Owner visual validation da UI web pendente (padrão desta macrofrente — não bloqueia
  o fechamento técnico).
- Dispatch real (`RBV9-INV-031`) **CLOSED** pela frente Dispatch V1 — ver [DISPATCH_V1](./DISPATCH_V1.md). Owner visual validation continua fora de escopo.
