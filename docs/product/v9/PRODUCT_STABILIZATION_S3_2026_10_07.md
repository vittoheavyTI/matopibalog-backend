# S3 — Núcleo operacional e formulários — fechamento técnico pré-merge

`FINAL_STATUS=S3_BEHAVIORAL_STABILIZATION_CLOSED`

`BRANCH=stabilization/s3-operational-forms`
`BASE_MAIN=f859f5cc102d108ec8b067246b00568eac8cbe4a`
`SCOPE=S3_OPERATIONAL_FORMS`
`PRODUCTION_WRITES=0`
`MIGRATIONS=0`
`PRODUCT_CODE_CORRECTIONS=0`

Este fechamento converte a S3 de `STATIC_AUDIT_FROZEN_NOT_BEHAVIORALLY_CERTIFIED`
para `S3_BEHAVIORAL_STABILIZATION_CLOSED`. A rodada mediu comportamento real do
frontend com Playwright, fixtures locais e sentinela de rede externa, sem criar
frete, campanha, despacho, ativo de frota, usuário, motorista ou parceiro real.

## Findings congelados

| ID | Classificação final | Evidência |
|---|---|---|
| `S3-LOW-01` | `CLOSED_BY_MEASUREMENT` | Fretes, Campanhas de Escoamento, Operation Orchestrator/Dispatch, Route Intelligence, Frota, Estrutura Operacional, Motoristas, Usuários e Rede de Parceiros foram medidos em 1440x900, 1024x768 e 390x844, sem overflow global. |
| `S3-INFO-01` | `CLOSED_BY_MEASUREMENT` | `ModalFormulario` permanece aplicado em `Motoristas`, `Usuarios` e `RedeParceiros`; o fluxo mobile abre modal em vez de formulário gigante inline. |

Não há `BLOCKER`, `HIGH` ou `MEDIUM` real aberto em S3 neste branch.

## Matriz comportamental S3

Rotas medidas:

- `/relatorios/viagens` — Fretes
- `/campanhas-escoamento` — Campanhas de Escoamento
- `/campanhas-escoamento` — Operation Orchestrator e painel de Dispatch como subfluxos acoplados
- `/rota` — Route Intelligence
- `/frota` — Frota
- `/operacional` — Estrutura Operacional
- `/motoristas` — UX_FORM_001
- `/admins` — UX_FORM_001
- `/rede-parceiros` — UX_FORM_001

Viewports:

- desktop `1440x900`
- tablet `1024x768`
- mobile `390x844`

Contratos medidos:

- `documentElement.scrollWidth <= clientWidth + 1`
- exatamente um item primário ativo para rotas navegáveis
- fixtures locais para dados operacionais
- estado vazio de Frota
- estado de erro recuperável de Frota
- fallback de Route Intelligence sem provedor externo
- execução de campanha e painel de Dispatch sem write real
- `ModalFormulario` em Motoristas, Usuários e Rede de Parceiros
- bloqueio de requisições externas
- bloqueio de writes de negócio inesperados

## Correções aplicadas

Nenhuma correção de código produto foi necessária para S3.

Alterações deste branch:

- novo harness Playwright S3 em `painel_web/tests-e2e-visual/s3.visual.spec.ts`
- inclusão de `s2.visual.spec.ts` e `s3.visual.spec.ts` no `testMatch` do pack visual
- atualização documental deste fechamento

Durante a primeira execução, `/operacional` falhou porque a fixture do harness não
casava o endpoint real `/configuracoes/portal-governanca`; o produto recebia `{}` e
mostrava corretamente o estado de recurso sem plano/permissão. A fixture foi
ajustada para o endpoint real e a matriz S3 passou em seguida. Isso foi
classificado como `TEST_HARNESS_FIX`, não finding de produto.

## Gates locais

| Gate | Resultado |
|---|---|
| Frontend foco S3 | `33/33 PASS` |
| Frontend completo | `296/296 PASS` |
| Typecheck + build web | `PASS` com aviso local de Node `20.18.0` vs Vite `20.19+` recomendado e aviso de chunk grande |
| Backend `node --test` | `2030/2030 PASS` |
| Visual S3 focado | `29/29 PASS` |
| Visual S2+S3 parcial após ajuste inicial do matcher | `72/72 PASS` |
| Visual pack completo | `117/117 PASS` |
| Isolamento de rede externa | `PASS` |
| Writes de negócio pelo pack S3 | `0` |
| SEC-1 browser local | `SKIPPED` pela guarda do spec no ambiente local |

## Fora de escopo preservado

Não houve toque em PR #490, S1, S2, S4, DB-SEC-1, ERP Hub, SaaS Billing, Asaas,
Partner Portal, Portal do Embarcador, migrations, DDL Supabase ou produção.

`NEXT_SAFE_ACTION=abrir PR draft de S3 e aguardar autorização humana para Ready/merge/deploy.`
