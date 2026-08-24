# Campaign-D — Orchestrator Completion V1 (replan, rota, multi-origem)

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados pelo integrator após o fechamento técnico.

- `MACROFRONT=CAMPAIGN_D_ORCHESTRATOR_COMPLETION_V1`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0`
- Fecha os três itens conscientemente deferidos pelo PR #473 (Operation Orchestrator V1):
  replan pós-aprovação, Route Intelligence integrada ao planejamento, multi-origem no
  fluxo guiado.

## 1. Auditoria delta — por que schema-free foi possível

A migration 076 (Campaign-A) já continha, sem uso até agora, exatamente os primitivos de
concorrência necessários para um replan seguro:

- `campaign_plan_versions_campaign_version_key` UNIQUE `(campaign_id, version_number)`
- `campaign_plan_versions_one_review_key` UNIQUE `(campaign_id)` WHERE `status='READY_FOR_REVIEW'`
- `campaign_plan_versions_one_approved_key` UNIQUE `(campaign_id)` WHERE `status='APPROVED'`
- `campaign_plan_versions.superseded_by` (coluna de lineage, nunca preenchida até agora)
- `campaign_approvals_one_approve_key` UNIQUE `(plan_version_id, action)` WHERE `action='APPROVE'`

Isso significa: **o banco já garante, por construção, que nunca existem duas versões
`APPROVED` simultâneas para a mesma campanha** — a única coisa que faltava era o código de
aplicação usar essa garantia na ORDEM certa (superar a antiga antes de promover a nova) e
gerar a versão nova sobre a demanda residual, não a meta inteira de novo.

`campaignMaterializationService.loadApprovedContext` **já** rejeitava materializar contra
um plano que não é `campaign.approved_plan_version_id` — essa defesa já existia. O único
gap real de segurança encontrado (não uma race de banco, uma omissão de aplicação): as
RPCs de Dispatch (`dispatch_round_create`) verificam que a viagem pertence ao
`(campaign_id, plan_version_id)` informado e está `PLANNED`, mas nunca verificam se esse
`plan_version_id` ainda é o aprovado corrente — corrigido na camada de aplicação
(`dispatchService.assertCurrentApprovedPlan`), reaproveitando exatamente a mesma regra que
a materialização já usava. Sem essa correção, um replan aprovado não impediria abrir uma
nova designação/oferta sobre uma viagem "zumbi" da versão superada — o pior caso seria uma
rodada de Dispatch "zumbi" nunca convertida em Frete (a materialização já bloqueava isso),
mas fechado mesmo assim por completude defensiva.

## 2. Parte A — Replan pós-aprovação

### 2.1 Classificação de comprometimento (nunca adivinha)

Cada viagem planejada da versão aprovada corrente cai em EXATAMENTE uma categoria
(`campaignReplanService.classifyTrip`):

| Categoria | Quando | Efeito no residual |
|---|---|---|
| `EXECUTED` | Frete materializado com status concluído | Reduz o residual (nunca replanejar) |
| `COMMITTED` | Frete materializado em execução, **ou** rodada de Dispatch `ASSIGNED` com materialização ainda pendente (§12: gap real de duas fases do Dispatch V1) | Reduz o residual (protegido, nunca duplicado) |
| `CANCELLED` | Frete materializado cancelado | Não reduz — quantidade volta ao residual por omissão |
| `UNCOMMITTED` | Viagem bloqueada/cancelada no plano, ou só a sugestão default do planejador guloso sem nenhuma ação real de Dispatch/materialização | Não reduz — livre para o replan substituir |
| `UNKNOWN` | Link materializado sem Frete correspondente, Frete com status fora do mapeamento conhecido, ou rodada de Dispatch `OPEN` (motoristas ainda respondendo) | **Bloqueia o replan inteiro** — `blocking_replan_exception`, humano revisa |

`residual = meta − executado − comprometido` por linha de `campaign_demands` (nunca abaixo
de zero); sem dupla contagem porque cada viagem contribui para no máximo uma dessas somas.

### 2.2 Geração (`generateReplan`) e aprovação (`approvePlan` estendido)

- `generateReplan` reusa o MESMO planejador determinístico (`campaignService.planCampaign`
  via `persistPlanVersion`, extraído do `generatePlan` original) sobre as demandas
  residuais apenas. Nunca toca `campaign.status` (permanece `APPROVED` — a versão antiga
  continua sendo a autoridade corrente até este rascunho ser explicitamente aprovado).
  Snapshot imutável do cálculo fica em `campaign_plan_versions.assumptions.replan_snapshot`
  (contagens por categoria + motivo + timestamp), sem coluna nova.
- `approvePlan` (o MESMO endpoint que já existia, `POST /plans/:planId/approve`) agora
  detecta quando `campaign.approved_plan_version_id` já aponta para uma versão diferente
  da que está sendo aprovada — nesse caso, **primeiro** supera a versão antiga
  (`status='SUPERSEDED'`, `superseded_by=<nova>`), **depois** promove a nova. A ordem
  inversa violaria `campaign_plan_versions_one_approved_key`; a ordem correta é a mesma
  usada no teste de concorrência real (§4).
- `rejectPlan` também foi corrigido: rejeitar um rascunho de replan **nunca** tira a
  campanha de `APPROVED` (isso invalidaria a execução já em curso sob a versão antiga) —
  só campanhas sem plano aprovado nenhum (fluxo original do Campaign-A) voltam para
  `PLANNING`.

### 2.3 UX (web)

Banner "Replanejar restante" aparece quando `next_action` é `REPLAN_RECOMMENDED` ou
`REPLAN_REQUIRED`. Preview mostra meta original, já concluído, já comprometido,
cancelado/liberado e o residual — antes de exigir o motivo e confirmar. Depois de gerado,
o painel "Plano" existente (reaproveitado sem nenhuma duplicação) já mostra o rascunho com
o botão "Aprovar" de sempre, porque a orquestração aponta `plan_summary` para a versão mais
recente automaticamente.

## 3. Parte B — Route Intelligence dentro do planejamento

`operationOrchestratorService.getCampaignOrchestration` deriva os pares origem→destino
únicos das demandas atuais (deduplicados — no máximo 1 chamada por par distinto, nunca
N+1) e chama `routeEstimateService.estimateRoute` diretamente — reaproveita o
`RouteProviderGateway` já existente, nenhum adapter novo. Com o provider desabilitado
(estado atual de produção), cada chamada resolve instantaneamente para
`route_source=UNAVAILABLE` sem nenhuma chamada externa real
(`PRODUCTION_ROUTE_PROVIDER_CALLS=0` continua verdadeiro). O resultado aparece no resumo
do objetivo (web) como "Origem → Destino · Distância: não disponível" (ou o valor real, se
um provider algum dia for habilitado) — nunca redigitado pelo usuário, nunca um zero
fabricado. `/rota` não foi tocada.

## 4. Prova de concorrência real (Postgres, não mockada)

`backend/tests-pg/campaign_d_replan_concurrency.pgtest.mjs` prova, com conexões Postgres
reais (não mock), exatamente o que este fechamento depende:

1. Tentar aprovar a versão nova **sem** superar a antiga primeiro é rejeitado pelo índice
   único `campaign_plan_versions_one_approved_key` (23505) — nunca corrompe silenciosamente.
2. Duas conexões concorrentes executando a sequência CORRETA (superar antiga → promover
   nova) simultaneamente — simulando um duplo-clique real no botão "Aprovar" — nunca
   deixam 0 nem 2 versões `APPROVED` para a mesma campanha; o resultado final é sempre
   exatamente 1 versão aprovada, com `superseded_by` e `approved_plan_version_id`
   coerentes.

## 5. Parte C — Multi-origem no fluxo guiado

`origins[]` é a autoridade única de quantidade — cada origem carrega a própria meta; o
total exibido é sempre **derivado** (soma), nunca redigitado pelo usuário (§61). Backend
já suportava N demandas via `replaceDemands`/`replaceLocations` (usado pelos endpoints
granulares desde o Campaign-A); o fluxo guiado (`createObjective`) agora aceita
`origins: [{name, target_quantity, quantity_unit?, unidade_operacional_id?}]` (1..N) com
1 destino compartilhado (V1 — múltiplos destinos continuam pelos endpoints granulares).
Origem duplicada (mesmo nome, case-insensitive) é rejeitada com erro claro antes de
qualquer escrita. Web: "+ Adicionar origem" progressivo, 1 linha por padrão.

## 6. Segurança / qualidade

- Nenhuma permissão nova: replan reusa `campaign.plan` (gerar) + `campaign.approve`
  (aprovar, mesmo endpoint de sempre); orquestração/rota continuam em `campaign.view`.
- Tenant sempre pelo `empresa_id` do servidor; nenhuma superfície nova de IDOR.
- pt-BR revisado manualmente em todas as strings novas.
- Backend: suíte completa 0 fail (+58 testes novos entre `campaignReplanService.test.js`,
  extensões a `operationOrchestratorService.test.js` e `dispatchService.test.js`). Web:
  `tsc -b` limpo, suíte de `OperationCampaigns.test.tsx` verde. PG: 2 testes novos de
  concorrência real, validados em CI (não é possível rodar Postgres localmente nesta
  sessão).
- `AI_WRITE_TOOLS=0`; nenhuma tool de IA nova.
- `FLEET_UX_DEBT`/`ROUTE_STANDALONE_UX_DEBT`/`ACERTO_UX_DEBT`/`BILLING_UX_DEBT`/
  `FINANCEIRO_PRODUCT_DEBT`/`LEGACY_ORTHOGRAPHY_DEBT` = todos `DEFERRED_ACCEPTANCE_BASELINE`
  (nenhum tocado nesta frente).

## 7. Perguntas finais do produto (com evidência)

1. **"Depois de uma operação já parcialmente executada, o gestor consegue replanejar
   apenas o que falta sem duplicar o que já aconteceu?"** Sim — provado pelo teste de
   integração que gera um replan sobre 100 de meta com 30 executado + 20 comprometido e
   confirma que o novo plano soma exatamente 50, nunca 100 nem 80.
2. **"Com várias origens, o gestor declara os locais e quantidades ou precisa construir
   viagens manualmente?"** Declara — `origins[]` no mesmo formulário guiado único, sem
   nenhuma tela adicional.
3. **"A rota é enriquecida pelo sistema quando possível, ou o operador precisa adivinhar
   distância, consumo e combustível?"** Enriquecida automaticamente a partir de
   origem/destino já conhecidos; nunca pede esses dados, nunca inventa um valor quando
   indisponível.
