# Operation Orchestrator V1 — objetivo → plano → aprovação (E3.1/E3.2)

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados pelo integrator após o fechamento técnico.

- `MACROFRONT=OPERATION_ORCHESTRATOR_V1`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0`
- `ORCHESTRATOR_AUDIT_FROZEN=true`

## 1. Auditoria — o que já existia antes desta frente

Campaign-A/B/C e Dispatch V1 já entregam praticamente todo o pipeline determinístico
E3.1/E3.2 (`OBJECTIVE → NORMALIZE → VALIDATE → RESOURCE_SNAPSHOT → CAPACITY_PLAN →
TRIP_PLAN → SCENARIOS → HUMAN_APPROVAL → DISPATCH_READY → MATERIALIZATION →
EXECUTION → VERIFY`). Nada disso foi reconstruído — só composto.

| Estágio do pipeline | Estado antes desta frente | Onde |
|---|---|---|
| Normalize/Validate | `ALREADY_IMPLEMENTED` | `campaignService.js` (normalizers + `CampaignError`) |
| Resource snapshot | `ALREADY_IMPLEMENTED` | `loadPlanningData`/`buildResourceCandidates`, congelado em `campaign_plan_versions.resource_snapshot` |
| Capacity plan / Trip plan / Scenarios | `ALREADY_IMPLEMENTED` | `planCampaign` — planner guloso determinístico v1; único cenário `own_capacity_only`, correto por design (D-032/§28 — sem Partner Network ainda) |
| Human approval + imutabilidade | `ALREADY_IMPLEMENTED` | `approvePlan`/`rejectPlan`; linha do plano aprovado nunca é mutada |
| Dispatch ready | `ALREADY_IMPLEMENTED` | Campaign-C `dispatchEligibilityService`/`campaignProgressService.readiness` |
| Materialização | `ALREADY_IMPLEMENTED` | Campaign-B `campaignMaterializationService` |
| Execução | `ALREADY_IMPLEMENTED` | Campaign-C `campaignProgressService` (projeção read-only sobre Frete canônico) |
| Verify | `ALREADY_IMPLEMENTED` | Verifier registry + invariantes de campaign/dispatch |
| **Sinal de replanejamento (advisory)** | `ALREADY_IMPLEMENTED` | Campaign-C `campaignProgressService.deriveReplan` — `REPLAN_REQUIRED_BY_INVARIANT` / `REPLAN_RECOMMENDED`, com `reason_code`/`affected_trip_ids`/`suggested_next_step` |
| Fleet como dado de sistema | `ALREADY_IMPLEMENTED` | `loadPlanningData` já consome `fleet_assets`/`vehicle_compositions`/`driver_vehicle_assignments`/`maintenance_events`/`asset_documents` — nunca pediu duplicação manual |
| Tenant/scope/permission/entitlement | `ALREADY_IMPLEMENTED` | `operationalScope` + `campaign.*` (sem atalho de role) |
| **Criação do objetivo (UX web)** | `WRONG_UX` | 4 passos desconectados: `POST /` (campanha) → `PUT /locations` + `PUT /demands` (1 origem/1 destino fixos) → `POST /plans` → `POST /plans/:id/approve`. Nenhum resumo de capacidade antes de gerar; nada derivado automaticamente. |
| **`next_action` determinístico** | `NOT_IMPLEMENTED` | Sinais já existiam espalhados (`campaign.status`, `plan.status`, exceções, `health`/`replan`/`readiness`); nada os compunha em UM campo acionável. |
| **Replan APÓS aprovação** (execução já iniciada) | `NOT_IMPLEMENTED` — deferido conscientemente | Ver §5. |
| Rede de parceiros / cenário externo | `DEFERRED_BY_DESIGN` | Não existe Partner Network ainda; `own_capacity_only` é o único cenário correto hoje. |

Nenhuma duplicação foi encontrada (`AUDIT_DUPLICATED=none`) e nenhuma fronteira errada no
backend (`AUDIT_WRONG_BOUNDARY=none`) — o único `WRONG_UX` real está na tela web de criação.

## 2. O que esta frente adiciona (schema-free, tudo composição)

### 2.1 `operationOrchestratorService.js` (novo, ~230 linhas)

- `deriveNextAction(...)` — função pura, sem acesso a banco, que mapeia
  `campaign.status` + `plan.status` mais recente + exceções abertas + `health`/`replan`/
  `readiness` (já computados pelo Campaign-C) para um `next_action` único e determinístico:
  `COMPLETE_MISSING_OBJECTIVE`, `GENERATE_PLAN`, `REVIEW_CAPACITY_GAP`,
  `REVIEW_BLOCKING_EXCEPTION`, `APPROVE_PLAN`, `REPLAN_REQUIRED`, `READY_FOR_DISPATCH`,
  `READY_FOR_MATERIALIZATION`, `REVIEW_EXECUTION_EXCEPTION`, `EXECUTION_IN_PROGRESS`,
  `CAMPAIGN_COMPLETE`, `CAMPAIGN_CANCELLED`. Nenhuma regra nova: é composição pura dos
  sinais que já existiam.
- `getCampaignOrchestration(...)` — compõe `campaignService.getCampaign` +
  `campaignService.getPlan` + `campaignProgressService.getCampaignProgress`, devolve o
  resumo do objetivo (carga/quantidade/origem/destino/janela) + `next_action` +
  `plan_summary` + `progress_summary`. Read-only.
- `createObjective(...)` — fluxo guiado (§13/§57-58 do prompt): um único payload
  (`name`, `cargo_name`, `target_quantity`, `quantity_unit`, `origin`, `destination`,
  `priority?`, `planned_start?`, `planned_end?`, `operational_unit_ids?`) encadeia
  `createCampaign → replaceLocations → replaceDemands → generatePlan` — os MESMOS
  quatro passos que o manager já fazia manualmente, agora numa chamada. Idempotente pelo
  mesmo `client_request_id` (se a campanha já passou de `DRAFT`/`PLANNING`, o replay
  devolve o estado atual em vez de tentar reexecutar passos já concluídos).

### 2.2 Rotas novas (read-only + a própria criação guiada, sem nova permissão)

- `POST /operation-campaigns/objective` — gate `campaign.manage` (a mais restritiva
  dentre os passos que compõe; nunca concede mais do que o fluxo granular já permite a
  quem tem `create`+`manage`+`plan`).
- `GET /operation-campaigns/:campaignId/orchestration` — gate `campaign.view` (mesmo
  nível de `/progress`).

### 2.3 Web — fluxo guiado único

`OperationCampaigns.tsx`: o card "Nova campanha" + o formulário "Salvar base" (locais)
+ o botão avulso "Gerar plano" viram **um único formulário "Novo objetivo"** — nome, o
que transportar, de onde, para onde, quanto — que já entrega o plano gerado. Janela,
prioridade e unidade operacional ficam num bloco "Avançado" recolhido por padrão (§59).
Um banner "O que fazer agora" (reusa `next_action` da orquestração) substitui a leitura
obrigatória de uma tabela grande antes de qualquer decisão (§33/§36). Corrigido de
quebra: reabrir uma campanha já aprovada agora recarrega o plano automaticamente (antes
o plano só aparecia se você tivesse acabado de clicar em "Gerar plano" na mesma sessão).

## 3. Teste do produto final (o critério do prompt)

> "Se uma empresa precisa movimentar uma grande quantidade de carga, o colaborador está
> declarando o objetivo ou está preenchendo uma planilha disfarçada?"

Antes: 4 telas/ações sequenciais, 1 origem e 1 destino fixos, nenhum resumo antes de
gerar. Depois: **uma tela**, 5 campos essenciais (nome, carga, quantidade, origem,
destino), plano gerado automaticamente com capacidade/gap já calculados, e um banner
dizendo exatamente o que fazer a seguir. O colaborador declara objetivo — quantidade,
origem, destino, janela — nunca digita distância, preço de diesel, ID de motorista/
veículo ou número de viagens (provado pelo teste de regressão de entrada mínima).

## 4. `next_action` — precedência determinística

Sem plano aprovado: `CANCELLED` (terminal) > objetivo incompleto
(`COMPLETE_MISSING_OBJECTIVE`) > plano `READY_FOR_REVIEW` com bloqueio de capacidade
(`REVIEW_CAPACITY_GAP`) > outro bloqueio duro (`REVIEW_BLOCKING_EXCEPTION`) > pronto
para aprovar (`APPROVE_PLAN`) > objetivo pronto mas sem plano ainda (`GENERATE_PLAN`).

Com plano aprovado (usa o `replan`/`readiness`/`health` do Campaign-C, sem recalcular
nada): replanejamento exigido pelo invariante (`REPLAN_REQUIRED`) > viagem bloqueada
(`REVIEW_BLOCKING_EXCEPTION`) > viagem pronta para oferta/designação
(`READY_FOR_DISPATCH`) > viagem pronta para virar frete (`READY_FOR_MATERIALIZATION`) >
replan recomendado sem pendência de despacho (`REVIEW_EXECUTION_EXCEPTION`) > tudo
concluído (`CAMPAIGN_COMPLETE`) > em execução sem pendência (`EXECUTION_IN_PROGRESS`).

## 5. Deferido conscientemente (não é falha — é escopo)

- **Replan APÓS aprovação** (gerar uma v2 reconciliada enquanto v1 já tem viagens
  materializadas/em execução): o **sinal advisory já existe e é sólido**
  (`deriveReplan`, Campaign-C) — o que falta é a **ação**. `generatePlan` hoje bloqueia
  qualquer nova versão assim que `campaign.status==='APPROVED'`. Implementar a ação
  corretamente exige decidir como viagens já concluídas/em execução da v1 continuam
  contando para a meta quando a v2 é aprovada (mudar `approved_plan_version_id` troca
  qual `plan_version_id` a projeção de progresso enxerga) — um problema de reconciliação
  de execução parcial, não um detalhe de UI. Implementar isso apressadamente dentro
  desta mesma frente arriscaria quebrar a imutabilidade do plano aprovado ou a
  contabilidade de progresso sem dupla contagem (§23/§77) — ambos invariantes já
  provados e protegidos por teste. Fica como próxima fatia dedicada, com o mesmo rigor
  aplicado ao resto desta macrofrente.
- **Route Intelligence dentro do fluxo de planejamento** (distância/duração/combustível
  automáticos por viagem planejada): não é um estágio do pipeline canônico de 12 passos
  e o provider de produção continua `disabled` por padrão; adicionar chamadas por
  viagem também precisa de um orçamento de N+1 pensado com cuidado. Deferido — zero
  regressão, `PRODUCTION_ROUTE_PROVIDER_CALLS=0` mantido.
- Multi-origem/multi-destino no fluxo guiado: o backend já suporta N demandas via
  `replaceDemands`; o fluxo guiado novo cobre o caso comum (1 origem, 1 destino) e o
  usuário avançado continua com os endpoints granulares para múltiplas pernas.

## 6. Segurança / qualidade

- `campaign.manage`/`campaign.view` — nenhuma permissão nova; o gate do fluxo guiado é
  deliberadamente a mais restritiva dos passos que ele compõe (sem escalonamento).
- Tenant sempre pelo `empresa_id` do servidor; `operationalScope` idêntico ao já usado
  em toda a superfície de Campaign.
- `AI_WRITE_TOOLS=0`; nenhuma tool de IA nova nesta frente (a leitura já existente,
  `operation.campaign.progress`, cobre o necessário).
- Backend: 1852/1852 (0 fail, +19 novos). Web: `tsc -b` sem erros; suíte de
  `OperationCampaigns.test.tsx` verde (testes existentes adaptados ao fluxo novo +
  2 testes novos: entrada mínima e banner de próxima ação).
