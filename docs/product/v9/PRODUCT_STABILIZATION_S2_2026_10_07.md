# S2 — Super Admin / Team / Permissões — fechamento técnico pré-merge

`FINAL_STATUS=S2_BEHAVIORAL_STABILIZATION_CLOSED`

`BRANCH=stabilization/s2-superadmin-team-permissions`
`BASE_MAIN=6043df89a656f95e26150e6484b4ad16e3d6b767`
`PR=496`
`PR_HEAD=9abc76d1b630e773d675bc51ceaa79f38cdb0bb4`
`MERGE_SHA=d76838a0045e5c220ce5dd666d7fadc6dd1a2f58`
`SCOPE=S2_SUPER_ADMIN_TEAM_PERMISSIONS`
`PRODUCTION_WRITES=0`
`MIGRATIONS=0`
`PRODUCT_CODE_CORRECTIONS=0`

Este fechamento converte a S2 de `STATIC_AUDIT_FROZEN_NOT_BEHAVIORALLY_CERTIFIED`
para `S2_BEHAVIORAL_STABILIZATION_CLOSED`. O PR #496 foi marcado Ready e mergeado
em `main` mantendo exatamente o HEAD autorizado. O deploy Railway e GitHub Pages
foram validados após o merge.

## Findings congelados

| ID | Classificação final | Evidência |
|---|---|---|
| `S2-LOW-01` | `CLOSED_BY_MEASUREMENT` | `PainelMotoristas`, `PainelTermosLGPD`, `Operacional`, `PainelAssinaturas` e `ModelosContrato` medidos por Playwright em 1440x900, 1024x768 e 390x844, sem overflow global. |
| `S2-INFO-01` | `NO_FINDING` | Menu/rotas continuam coerentes: item visível tem rota declarada e guardas compatíveis. |
| `S2-INFO-02` | `NO_FINDING` | `PainelAssinaturas` é aba de `PainelFinanceiro` (`?aba=assinaturas`), com deep link, refresh e histórico do navegador preservados. |
| `DEBT-101` | `OPEN_ACCEPTED_DEBT` | `/painel-administrativo/visao-geral` e `/painel-administrativo/relatorios` permanecem sem item de menu, mas funcionam como deep links e não reproduzem quebra visual. Não foi criado menu automaticamente. |

Não há `BLOCKER`, `HIGH` ou `MEDIUM` real aberto em S2 neste branch.

## Matriz comportamental S2

Rotas medidas:

- `/`
- `/painel-administrativo/empresas`
- `/painel-administrativo/usuarios`
- `/painel-administrativo/motoristas`
- `/painel-administrativo/operacional`
- `/painel-administrativo/financeiro`
- `/painel-administrativo/financeiro?aba=assinaturas`
- `/painel-administrativo/termos-lgpd`
- `/painel-administrativo/termos-lgpd#modelos`
- `/perfis-permissoes`
- `/admins`
- `/painel-administrativo/visao-geral`
- `/painel-administrativo/relatorios`

Viewports:

- desktop `1440x900`
- tablet `1024x768`
- mobile `390x844`

Contratos medidos:

- `documentElement.scrollWidth <= clientWidth + 1`
- exatamente um item primário ativo para rotas navegáveis
- DEBT-101 tratado como deep link funcional, sem exigir nav ativo
- sem vazamento de rede externa nas fixtures
- rota protegida S2 sem sessão redireciona para login
- admin interno sem `is_super_admin` não acessa painel administrativo
- `users.manage` sem `permissions.manage` não expõe editor de perfis
- `PainelAssinaturas` preserva `?aba=assinaturas` em deep link, reload e back/forward

## Correções aplicadas

Nenhuma correção de código produto foi necessária para S2.

Alterações deste branch:

- novo harness Playwright S2 em `painel_web/tests-e2e-visual/s2.visual.spec.ts`
- timeout do webServer visual ampliado de `120_000` para `240_000`, para o build local Windows
- estabilização temporal estreita em dois testes existentes de `Usuarios`, após o run completo expor sensibilidade a carga local; os mesmos testes já passavam em execução focada e passaram novamente na suíte completa
- atualização documental deste fechamento

## Gates locais

| Gate | Resultado |
|---|---|
| Backend `node --test` | `2032/2032 PASS` |
| Frontend foco S2 | `66/66 PASS` na primeira rodada focada |
| Frontend completo | primeira rodada: `294/296`, duas falhas temporais em testes que passaram focados; após estabilização: `296/296 PASS` |
| Build web | `PASS` com aviso local de Node `20.18.0` vs Vite `20.19+` recomendado |
| SEC-1 browser local | `SKIPPED` pela guarda do spec no ambiente local |
| Visual pack | `88/88 PASS` |
| Visual S2 dentro do pack | `43/43 PASS` |
| PR #496 CI no HEAD exato | Frontend `SUCCESS`, SEC-1 Browser `SUCCESS` |
| Main CI pós-merge | Frontend `SUCCESS`, SEC-1 Browser `SUCCESS`, GitHub Pages `SUCCESS` na rerun do mesmo merge SHA |
| Railway deploy | `SUCCESS`, deployment `479b0fe2-1404-4508-aa3a-24d62edc602a`, commit `d76838a0045e5c220ce5dd666d7fadc6dd1a2f58`, 1 réplica `RUNNING` |
| Smokes produção read-only | `/health` 200 em `api.matopibalog.com.br` e domínio Railway; `/configuracoes/public` 200; `/planos/publicos` 200; `/auth/me` 401 sem auth; `/painel-admin/empresas` 401 sem auth |
| Logs pós-deploy | Startup normal; consulta HTTP 5xx pós-deploy sem novas entradas |

## Fora de escopo preservado

Não houve toque em PR #490, S3, S4, DB-SEC-1, ERP Hub, Asaas, billing, Campaign,
Dispatch, Partner Network, migrations, DDL Supabase ou produção.

`NEXT_SAFE_ACTION=nenhuma ação técnica obrigatória; S2 fechada.`
