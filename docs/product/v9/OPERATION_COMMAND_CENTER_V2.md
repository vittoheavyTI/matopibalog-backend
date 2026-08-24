# Operation Command Center V2 (Torre de Controle Operacional V2)

> Documento de frente (Claude / `OPERATION_COMMAND_CENTER_V2_WRITER`). **Não** é fonte
> canônica: `ROADMAP`, `MASTER_LEDGER`, `CONTEXT_BRIDGE`, `DECISIONS` e
> `PARALLEL_EXECUTION_BOARD` seguem sob o orchestrator/integrator.

- `MACROFRONT=OPERATION_COMMAND_CENTER_V2`
- `BASE_SHA=4576d1762badf6577938688121c57352b2b8ba61`
- `BRANCH=feature/operation-command-center-v2`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0` · `CLAUDE_SCHEMA_AUTHORITY=NONE`

## 1. Princípio — sistema de atenção, não relatório

A Torre V2 evolui a Torre existente para responder rápido: **o que precisa de
atenção, por quê, qual viagem/motorista/veículo, onde está a evidência e qual tela
abrir**. Reutiliza o engine determinístico existente — não reconstrói.

## 2. Engine canônico de atenção

`utils/torreControle.js` permanece a **fonte única** de classificação (níveis
`critico/atencao/ok/informativo` preservados; constantes de localização no backend).
Evoluções desta frente (aditivas, sem mudar comportamento de nível):
- **`attention_code`** estruturado por item (§40): `OCORRENCIA_ATRASO`,
  `OCORRENCIA_CRITICA`, `OCORRENCIA_ABERTA`, `COMPROVANTE_RECUSADO`,
  `COMPROVACAO_PENDENTE`, `SEM_COMPROVANTE`, `DADOS_INCOMPLETOS`,
  `LOCALIZACAO_ATENCAO`, `CONCLUIDO`, `EM_ANDAMENTO`, `PENDENTE`, `CANCELADO`,
  `INFORMATIVO` — habilita filtros e IA.
- **Mascaramento financeiro** (§26/§27): `montarTorreControle({...,financialVisibility})`
  — sem visibilidade, `valor_frete` é **omitido** (não 0/mascarado no cliente) e
  "valor do frete" sai das pendências expostas.

`services/commandCenterService.js` centraliza o **carregamento + classificação**
(reuso pelo endpoint web E pela tool de IA — não duplica regras, §12/§72), aplicando
tenant/escopo no boundary de query (scope-before-data, §34) e queries em lote (sem
N+1, §58).

## 3. Endpoint

`GET /relatorios/torre-controle` (evoluído, sem rota nova — §102). Auth existente:
`verifyToken + isAdmin + verificarEmpresa + verificarPlano + requirePermission('reports.operational.view')`.
Novo contrato de resposta (aditivo):
`{ generated_at, capabilities, financial_visibility, resumo, attention_summary, itens, periodo, limite_aplicado }`.

- **capabilities** (§30): `can_view_freight`, `can_view_fleet`,
  `can_view_operational_finance`, `can_view_documents` — do resolver efetivo, sem role hardcode.
- **financial_visibility**: `finance.operational.view` efetiva (ou super-admin).
  `freight.view`/`reports.operational.view` **não** concedem financeiro.
- **attention_summary**: contagem por `attention_code`.

## 4. Segurança / escopo / tenant

- Tenant do contexto do servidor; super-admin pode selecionar empresa (comportamento
  existente). Escopo operacional aplicado antes da exposição (§33/§34).
- Financeiro mascarado no **backend** (campo ausente), não só no CSS (§27/§86).
- Fleet: `can_view_fleet` reflete `fleet.view`; enriquecimento por item de Fleet
  fica `DEFERRED_PRODUCT` (batched join dedicado) — a Torre não vaza detalhe Fleet
  a quem não tem `fleet.view` (§23) porque não expõe Fleet nesta versão.

## 5. Integração IA (read-only)

Nova tool `operation.command_center.summary` (registrada no AI Copilot V1, provider
inalterado/inerte — §73/§104). Permissão `reports.operational.view`; reusa o serviço
canônico (§72), devolve contagens + `attention_summary` + top-N de atenção com campos
seguros (sem valor financeiro, sem PII sensível, sem URL assinada). A Torre oferece
"Perguntar ao assistente" (evento `ai:open` com pergunta sugerida).

## 6. Frontend

`pages/TorreControle.tsx`: deep links já existentes preservados (ver viagem/ocorrência/
comprovante/localização, §45); valor do frete só renderiza quando presente
(finance-aware); botão "Perguntar ao assistente".

## 7. Realtime / performance

Realtime SSE existente da Torre preservado (arquitetura congelada Node SSE — §49). Limite
de 1000 fretes com `limite_aplicado` (§59/§60); filtros de status/data/motorista antes
do limite (query), `nivel` pós-classificação. Sem N+1 (lote por IDs).

## 8. Testes

Backend: `torreControle.test.js` (16, preservado), `commandCenterEngine.test.js`
(attention_code + mascaramento financeiro + prioridade), `aiCommandCenterTool.test.js`
(permissão/tenant/finance/top-N). AI existentes atualizados p/ a nova tool.

## 9. Deferidos (não são defeitos de V2) — §117

Integração Campaign-B (isolada no Codex, §5/§103), enriquecimento Fleet por item,
reconhecimento persistente de atenção, SLA/notificações, inbox de exceções com schema,
analytics de pneu, ações de escrita da IA.

`OWNER_VISUAL_VALIDATION=PENDING`.
