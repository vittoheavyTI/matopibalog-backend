# Dispatch V1 — designação/oferta atômica (RBV9-INV-031)

> Documento de fechamento (Claude, owner execution). PR #471, `MERGE_SHA=16418114480f7afe650efbb493e1c2ccb0450b16`.
> `OWNER_MIGRATION_GATE_DISPATCH_079=CLOSED` — migration 079 aplicada em produção 2026-08-24
> sob autorização explícita do owner, aplicação única (`MIGRATION_APPLY_MAX_ATTEMPTS=1`, sem retry).

- `MACROFRONT=DISPATCH_V1`
- `MIGRATION_APPLIED=079_dispatch_v1_atomic_offers` · `TRACKED_VERSION=20260824164023`
- `MIGRATION_SHA256=a5f7cb3722e297a45842de0c0813b9ae6b0248c5ab49d7f1317391eba199d3c9`
- `PRODUCTION_BUSINESS_WRITES=0` (backfill técnico de permissão é o único DML: +75 linhas em
  `permission_template_permissions`, 50 `campaign.dispatch` + 25 `campaign.dispatch_respond`)
- `REAL_DISPATCH_IMPLEMENTED=true` · `OFFER_SYSTEM_IMPLEMENTED=true` · `AI_WRITE_TOOLS=0`
- `D-033` (Disponibilidade/Despacho estilo Uber) **implementada** — ambos os modos (designação
  direta + oferta a elegíveis), primeiro aceite válido vence, lock concorrência-safe.

## 1. Objetivo

Transformar a prontidão determinística do Campaign-C (`dispatch readiness`) em autoridade real:
o manager designa um candidato diretamente, ou abre uma rodada de oferta para múltiplos
candidatos elegíveis, e **o primeiro aceite válido vence atomicamente** — sem parceiro externo,
sem marketplace, sem dinheiro, sem preço dinâmico.

## 2. Decisão arquitetural — duas fases, nunca uma transação só

`fretes.motorista_id` é `NOT NULL` e `freightCreationService` exige motorista **ativo** antes do
insert — não existe "frete materializado sem motorista" no sistema hoje. Por isso Dispatch V1
opera em duas fases explicitamente separadas, e a materialização em `fretes` **não** acontece
dentro da mesma transação Postgres que decide o vencedor:

- **Fase 1 (atômica, DB-transacional):** as RPCs `dispatch_round_create` (modo `DIRECT`) e
  `dispatch_offer_accept` (modo `OFFER`) decidem o vencedor e gravam `candidate_driver_id` /
  `candidate_asset_id` / `candidate_composition_id` em `campaign_planned_trips` — tudo dentro de
  uma única transação Postgres, serializada por `pg_advisory_xact_lock` (ver §3).
- **Fase 2 (idempotente, aplicação, não transacional com a fase 1):** o backend converge o
  vencedor para o frete real chamando `materializeSingleTrip` — o **mesmo** `materializeOne()` /
  `freightCreationService` do Campaign-B, reaproveitado via um novo export, nunca duplicado. Não
  existe tabela paralela de "assignment": o vencedor já decidido na fase 1 é o único dado que a
  fase 2 precisa para criar o frete.

**Por que a fase 2 não pode reabrir a decisão do vencedor:** o `dispatch_round_create` fecha a
janela entre o accept e a materialização exigindo explicitamente que a viagem ainda não tenha
`candidate_driver_id`/`candidate_asset_id`/`candidate_composition_id` setados (não apenas
`status='PLANNED'`, que sozinho não muda até a materialização completar) — sem esse check, uma
segunda rodada poderia ser criada nessa janela assíncrona. Esse é um gap real encontrado durante
o design (não estava no schema inicial) e fechado antes de qualquer teste. Se a fase 2 falhar
(erro transitório, timeout), o vencedor já está gravado de forma imutável na fase 1; a resposta
ao manager carrega `materialization_error` sem nunca mascarar ou desfazer a decisão atômica —
retry da fase 2 é idempotente (`ON CONFLICT`/checagem de `campaign_trip_freights` existente) e
seguro.

## 3. Atomicidade — prova real (Postgres, não mockada)

`dispatch_claim_planned_trip` (interna, sem GRANT a ninguém — só chamada de dentro das RPCs
públicas) usa `pg_advisory_xact_lock(hashtext('dispatch_trip:' || planned_trip_id))` para
serializar **qualquer** caminho concorrente que tente decidir o executor da mesma viagem
planejada: DIRECT-vs-DIRECT, OFFER-vs-OFFER e DIRECT-vs-OFFER. `dispatch_offer_accept` usa
`SELECT ... FOR UPDATE` na linha da rodada para serializar accept-vs-accept e accept-vs-cancel
dentro da mesma rodada de oferta; um índice único parcial (`status='ACCEPTED'` por `round_id`) é
uma segunda rede de segurança no nível de banco, além da serialização transacional.

`backend/tests-pg/dispatch_v1_079.pgtest.mjs` — 16 testes, todos verdes em CI contra
`postgres:16` real (workflow dedicado "Dispatch V1 079 Atomic Offers PG"), cobrindo:

- **2 motoristas aceitam a mesma rodada simultaneamente** → exatamente 1 sucesso determinístico.
- **Cancelar vs. aceitar concorrentes** → nunca round `ASSIGNED` com offer `CANCELLED` (ou o
  inverso).
- **Designação direta vs. aceite de oferta concorrentes na mesma viagem** → no máximo uma
  designação.
- Idempotência de criação/aceite por `request_id`, expiração determinística (lida em tempo real
  na RPC, self-heal preguiçoso sem cron), revalidação de elegibilidade no accept (motorista
  inativo, vínculo motorista-recurso trocado), isolamento de tenant, e o invariante "sem segunda
  rodada para viagem já reclamada" do §2.

Um bug real de PL/pgSQL foi encontrado e corrigido durante essa prova: `dispatch_offer_accept`
tentava gravar `status='EXPIRED'` e depois `RAISE EXCEPTION` na mesma invocação — a exceção
desfazia (rollback) o UPDATE anterior, comportamento padrão do PL/pgSQL. A propriedade que
importa (oferta expirada nunca é aceita) nunca esteve quebrada; só a gravação cosmética do status
era descartada. A persistência de `EXPIRED` ficou exclusivamente a cargo do self-heal em
`dispatch_round_create`.

## 4. Schema (migration 079)

- `dispatch_rounds` / `dispatch_offers` — "necessidade (planned trip não materializado) →
  candidatos convidados → exatamente um vencedor". Índice único parcial: no máximo 1 rodada
  `OPEN` por viagem planejada; no máximo 1 oferta `ACCEPTED` por rodada.
- RPCs `SECURITY DEFINER`, **service_role-only**: `dispatch_round_create`, `dispatch_offer_accept`,
  `dispatch_offer_decline`, `dispatch_round_cancel`. `dispatch_claim_planned_trip` é interna e
  **não recebe GRANT nenhum** (confirmado em produção pós-apply: só o owner `postgres` aparece no
  ACL, zero `service_role`/`authenticated`/`anon`).
- RLS habilitado nas duas tabelas; `authenticated` recebe só `SELECT` (mais restrito que o padrão
  de `campaign_trip_freights`, que dava CRUD completo) — a única superfície de escrita real são
  as RPCs, nunca o Data API direto. Confirmado em produção: `authenticated`=SELECT-only,
  `service_role`=CRUD completo, `anon`=nenhum grant.
- DML técnico: backfill idempotente de `campaign.dispatch` (administrador/gerente_frota) e
  `campaign.dispatch_respond` (motorista) em `permission_template_permissions`, mesmo idioma da
  076 (`ensure_operation_campaign_template_permissions_for_empresa`).

## 5. Backend — aplicação

- `dispatchService.js`: revalida elegibilidade no momento da mutação (reusa
  `dispatchEligibilityService`, nunca duplica scoring), intercepta destinatários pedidos pelo
  manager com quem está realmente elegível agora, chama a RPC certa, converge o vencedor via
  `materializeSingleTrip` (best-effort), publica sinal realtime (reusa o SSE bus existente) e
  notifica (reusa `notificacaoService`, best-effort).
- Manager: `campaign.dispatch` (mais restritiva que `campaign.manage`) em
  `/operation-campaigns/:id/plans/:planId/trips/:tripId/dispatch/*`.
- Motorista: `campaign.dispatch_respond` (default-allow no baseline do motorista) em
  `/dispatch/my-offers`, `/dispatch/offers/:id/accept`, `/dispatch/offers/:id/decline` —
  identidade sempre do token, ownership revalidada dentro da RPC.
- IA: `operation.dispatch.status` read-only. `AI_WRITE_TOOLS=0`.
- Verifier: 5 invariantes novos (`dispatch.round.one_winner.v1`,
  `dispatch.round.one_active_per_trip.v1`, `dispatch.winner.canonical_assignment.v1`,
  `dispatch.offer.no_accept_after_expiry.v1`, `dispatch.offer.tenant_match.v1`) — diagnóstico
  read-only, `repair=DISABLED_BY_POLICY`.

## 6. Web — manager

Estende o drawer de elegibilidade do Campaign-C (`OperationCampaigns.tsx`, botão renomeado "Ver
elegibilidade"→"Despachar") com designação direta, criação de rodada de oferta (seleção múltipla
ou todos os elegíveis por padrão), cancelamento de rodada aberta e exibição do estado da rodada.

## 7. App (Flutter) — motorista

Tela "Ofertas de viagem" (menu lateral): lista ofertas do motorista com contexto
(origem/destino/carga) e Aceitar/Recusar. Um 409 no accept (outro motorista venceu, ou expirou)
vira mensagem clara. **Validado só via CI** (Flutter analyze/test/build APK, ambos verdes) —
`OWNER_DEVICE_VALIDATION=PENDING`. Nenhuma validação física em aparelho foi realizada nesta
frente.

## 8. Produção — certificação read-only (2026-08-24)

Migration 079 aplicada uma única vez (`MIGRATION_APPLY_MAX_ATTEMPTS=1`, sem retry necessário).
Postcheck: tracking correto (079 presente 1x; 076/077/078 continuam presentes 1x cada); 12
índices + 16 FKs + RLS habilitado + 2 policies nas 2 tabelas novas; grants exatamente como
projetado (§4); `dispatch_rounds=0`/`dispatch_offers=0`; `empresas`/`usuarios`/`fretes`/
`operation_campaigns`/`campaign_planned_trips`/`campaign_trip_freights` estáveis
(zero escrita de negócio). Deploy: Railway backend SUCCESS + GitHub Pages SUCCESS no mesmo
`MERGE_SHA`. Certificação read-only pós-deploy: `/health` 200; rotas manager/driver de Dispatch
401 sem auth; `/ai/capabilities` 401 sem auth; `AI_WRITE_TOOLS` ausente (default disabled); logs
de deploy limpos (startup normal, zero erro novo). **Nenhuma rodada/oferta real foi criada** para
"provar" produção — a prova de atomicidade já foi feita via Postgres real em CI (§3); criar dado
de negócio real exigiria uma campanha/viagem planejada real, que não existe hoje
(`operation_campaigns=0`).

## 9. Deferido (fora do V1)

Rede de parceiros, marketplace, oferta a transportadora externa, preço dinâmico/leilão,
procurement de push provider dedicado, restrição de rota por caminhão (Route Intelligence V1 não
carrega isso — permanece `UNKNOWN` honesto), ações de escrita da IA, dispatch autônomo sem
supervisão, validação física em aparelho (`OWNER_DEVICE_VALIDATION=PENDING`), owner visual
validation da UI web/manager em produção.
