# PILOT_ACCEPTANCE_V1 — certificação integrada

## Estado e limites

Esta macrofrente certifica, com o nível de prova disponível, a jornada piloto entre backend, PostgreSQL, painel web e Flutter. Ela depende da Draft PR #509 e parte do commit `92539abca568708687fea89e1de630f6d1784ee0`, com `origin/main` observado em `845289cb55cb7575e65eb08057b44c2a99e8621f`.

O resultado técnico é `TECHNICALLY_CLOSED_PENDING_OWNER_GATES` quando todos os checks do HEAD da Draft PR estiverem verdes. Isso não libera piloto, produção, merge ou deploy.

```text
RECOVERY_STATUS=BLOCKED_BY_RECOVERY
RECOVERY_DECISION=DEFERRED_BY_OWNER
PRODUCTION_DATABASE_WRITES=NOT_AUTHORIZED
PRODUCTION_MIGRATION_088=NOT_AUTHORIZED
PR509_MERGE=NOT_AUTHORIZED
```

O ambiente de produção foi usado somente nas leituras já autorizadas da frente anterior. Nenhuma fixture, migration, upload ou escrita desta certificação foi executada nele.

## Ambiente e níveis de prova

O cenário usa somente identidades e dados sintéticos: Fazenda Piloto (tenant A), um gestor, um operador restrito, um motorista e fretes sintéticos; tenant B independente para negativas de isolamento. O navegador bloqueia rede externa e intercepta a API. A migration 088 é exercitada em PostgreSQL 17 descartável no GitHub Actions pelo harness seguro da #509. O workflow SEC-1 usa PostgreSQL 16 descartável.

| Nível | Resultado | Limite da prova |
| --- | --- | --- |
| UNIT / COMPONENT / CONTRACT | PASS | Backend, web e Flutter executados localmente. |
| INTEGRATION_PG | PASS na #509; reexecução obrigatória no CI desta PR | PostgreSQL real descartável; não equivale a Supabase completo. |
| API_E2E | NOT_EXECUTED para a jornada completa | Não foi montado um Supabase isolado completo com Auth, RLS e Storage. |
| WEB_E2E | PASS_WITH_INTERCEPTED_API | Chromium real, viewport móvel e nenhuma rede externa. |
| FLUTTER_WIDGET | PASS | Testes host/contrato; sem emulador ou dispositivo. |
| FLUTTER_INTEGRATION | NOT_EXECUTED | APK release é produzido no CI para o gate físico. |
| OWNER_DEVICE | PENDING | Exige aparelho físico do owner. |
| PRODUCTION_VALIDATION | BLOCKED | Depende de recovery, migration, deploy e autorização futuros. |

## Achados congelados

`PILOT_ACCEPTANCE_V1_FINDINGS_FROZEN`

### PAV1-HIGH-01 — continuidade da intenção após resposta perdida

- **Componente:** painel web e Flutter.
- **Reprodução:** enviar uma criação; perder a resposta; fechar e reabrir o modal ou reconstruir a tela; reenviar os mesmos dados.
- **Evidência anterior:** a chave vivia apenas no `ref` do modal web ou na instância da tela Flutter. A remontagem gerava outro UUID.
- **Consequência:** uma criação concluída no servidor podia ser repetida como nova intenção, contornando a convergência da migration 088.
- **Severidade:** HIGH.
- **Causa:** ciclo de vida da chave menor que o ciclo de vida da operação ambígua.
- **Correção:** memória de processo/aba associada ao fingerprint canônico do payload; limpeza somente após sucesso completo; mensagens explícitas de resultado incerto; preservação dos status HTTP no cliente Flutter.
- **Testes:** unidade web, contrato Flutter e Playwright PA-022/047/054.
- **Boundary:** cliente → API de criação; nenhuma mudança de schema, finanças, RLS ou autoridade.
- **Estado:** RESOLVED.

Não foi comprovado BLOCKER. Nenhum MEDIUM/LOW justificou mudança nesta frente.

## Matriz PA-001 a PA-055

`PASS` significa que o comportamento exigido foi comprovado no nível indicado na coluna Evidência. Não significa uma jornada completa contra produção ou Supabase real.

| Caso | Status | Evidência |
| --- | --- | --- |
| PA-001 | PASS | SEC-1 browser e componentes de rota/autorização. |
| PA-002 | PASS | Backend SEC-1, interceptor web e testes mobile de refresh. |
| PA-003 | PASS | Middleware/rotas backend e boundaries web. |
| PA-004 | PASS | Contrato backend `freight.create`. |
| PA-005 | PASS | Playwright `pilot_acceptance.visual.spec.ts`, screenshot sanitizado. |
| PA-006 | PASS | Rotas protegidas e testes de permissão backend. |
| PA-007 | PASS | Resolver de entitlement/permissão efetiva. |
| PA-008 | PASS | Testes de ownership/tenant backend. |
| PA-009 | PASS | Testes de `operationalScope` e unidade autorizada. |
| PA-010 | PASS | Replay reautoriza permissão, ownership e escopo atuais. |
| PA-011 | PASS | Contrato de criação + INTEGRATION_PG da 088. |
| PA-012 | PASS | Retry sequencial no backend e INTEGRATION_PG. |
| PA-013 | PASS | Concorrência real no PostgreSQL 17 descartável. |
| PA-014 | PASS | Hash divergente retorna conflito. |
| PA-015 | PASS | Mesma chave em tenants diferentes permanece isolada. |
| PA-016 | PASS | UUID inválido rejeitado por schema/contrato. |
| PA-017 | PASS | Cliente legado sem chave coberto no harness da 088. |
| PA-018 | PASS | Replay publica uma única notificação. |
| PA-019 | PASS | Replay falha fechado após revogação. |
| PA-020 | PASS | Placa/unidade derivada alteradas não geram falso conflito. |
| PA-021 | PASS | Intenções distintas criam fretes distintos. |
| PA-022 | PASS | Playwright e memória de intenção web/Flutter. |
| PA-023 | PASS | Ownership do motorista e tenant em testes backend. |
| PA-024 | PASS | Contratos existentes de despesa e vínculo. |
| PA-025 | PASS | Contratos existentes de abastecimento. |
| PA-026 | PASS | Contratos existentes de vale/adiantamento. |
| PA-027 | PASS | Máquina de estados de lançamentos. |
| PA-028 | PASS | Auditoria, rejeição e cancelamento. |
| PA-029 | PASS | Idempotência de lançamento/documento existente. |
| PA-030 | PASS | Consulta e atualização de estado em componentes/contratos. |
| PA-031 | PASS | `freteDocumentos` e contrato mobile v2. |
| PA-032 | PASS | MIME/tipo inválido rejeitados antes do upload. |
| PA-033 | PASS | Ownership e tenant impedem acesso cruzado. |
| PA-034 | PASS | Flutter preserva o frete criado e reenvia somente a foto. |
| PA-035 | PASS | `client_request_id` de documento permanece estável. |
| PA-036 | PASS | Falha de metadata remove somente o objeto enviado; corrida converge. |
| PA-037 | BLOCKED | Supabase Storage/RLS real não foi exercitado; contratos e URLs assinadas têm cobertura isolada. |
| PA-038 | PASS | Gate `freight.finish` e fluxo autorizado. |
| PA-039 | PASS | Finalização sem permissão retorna rejeição. |
| PA-040 | PASS | Lançamentos pendentes não compõem estado realizado/final. |
| PA-041 | PASS | Regressão financeira e comissões no backend completo. |
| PA-042 | PASS | Envelope E3.8, hash e projeções autorizadas. |
| PA-043 | PASS | Contratos idempotentes de transição/finalização. |
| PA-044 | PASS | Legado retorna `LEGACY_NO_FORMAL_ENVELOPE`. |
| PA-045 | PASS | Relatório de fechamento e auditoria unificada. |
| PA-046 | PASS | Redação financeira para motorista e perfis sem permissão. |
| PA-047 | PASS | Web e Flutter classificam a criação como ambígua e preservam a chave. |
| PA-048 | PASS | Interceptor web e refresh/logout mobile. |
| PA-049 | PASS | 403 preservado e tratado como definitivo/negado. |
| PA-050 | PASS | 409 preservado, exibido como conflito e sem bypass. |
| PA-051 | PASS | Mesma intenção reutiliza a chave após 5xx/rede. |
| PA-052 | PASS | SSE usado como sinal; estado canônico vem do refetch. |
| PA-053 | PASS | Reconnect recarrega progresso; listeners são encerrados. |
| PA-054 | PASS | Mensagens web/Flutter explicam resultado incerto e retentativa segura. |
| PA-055 | PASS | Repair playbook permanece dry-run; execução é bloqueada por política. |

Resumo da matriz: `PASS=54`, `FAIL=0`, `NOT_EXECUTED=0`, `BLOCKED=1`. As limitações por nível de prova permanecem explícitas e impedem interpretar a soma como aprovação de produção.

## Evidências executadas

- Backend focal: 109/109.
- Backend completo: 2.220/2.220.
- Frontend focal: 25/25; utilitário de intenção: 3/3.
- Frontend completo: primeira execução 327/328, com timeout de um teste antigo sob carga; repetição isolada do arquivo: 5/5. O CI em Node 22 é o gate final da suíte.
- Build web: PASS; o Node local 20.18 emitiu aviso de versão do Vite, mas concluiu. CI usa Node 22.
- Playwright piloto: 2/2 em Chromium real, sem rede externa.
- Flutter analyze: PASS, 0 issues.
- Flutter completo: 148/148 após remover uma reformatação semântica nula que quebrava uma asserção textual preexistente.
- Flutter focal final: 6/6.
- PostgreSQL 17 / migration 088: 10/10 no HEAD da #509; o workflow desta frente reexecuta o mesmo harness descartável.
- SEC-1 browser: workflow dedicado com PostgreSQL 16 descartável.

Comandos de reprodução:

```powershell
cd backend
node --test
node --test --test-concurrency=1 tests-pg/freight_creation_idempotency_088.pgtest.mjs

cd ..\painel_web
npm test
npm run build
npx playwright test pilot_acceptance.visual.spec.ts -c tests-e2e-visual\playwright.config.ts

cd ..\app_android
flutter analyze --no-pub
flutter test --no-pub
```

O comando PostgreSQL exige exclusivamente o guard e o banco descartável documentados em `backend/tests-pg/freight_creation_idempotency_088.pgtest.mjs`. Ausência de isolamento deve falhar fechado.

## Evidência visual sanitizada

- [PA-005 — criação ausente sem permissão](evidence/pilot_acceptance_v1/pa-005-sem-criacao-mobile.png)
- [PA-022 — fluxo reconciliado em viewport móvel](evidence/pilot_acceptance_v1/pa-022-reconciliado-mobile.png)
- Artefato CI: `pilot-acceptance-browser-evidence`, retenção de 14 dias.

As imagens usam exclusivamente fixtures sintéticas. Elas são evidência automatizada e não representam `OWNER_VISUAL_APPROVED`.

## Alterações realizadas

- Web: continuidade da intenção em memória da aba por fingerprint; limpeza após sucesso; mensagem explícita para timeout/rede; teste de remount.
- Flutter: continuidade da intenção em memória do processo; cliente HTTP injetável no POST de frete; status HTTP e ambiguidade preservados; mensagem de reconciliação; testes de rebuild, sucesso, 401/403/409/500 e transporte.
- Playwright: PA-005 e PA-022/047/054 em navegador real, viewport móvel, screenshots e bloqueio de rede externa.
- CI: backend completo, migration 088 em PostgreSQL 17, frontend/test/build/browser, SEC-1 em PostgreSQL 16 e Flutter analyze/test/APK release.
- Schema, migration 088, matemática financeira, SEC-1, RLS e autoridades de negócio não foram alterados.

## Roteiro de aceitação web do owner

Executar somente em ambiente isolado que contenha a 088 e fixtures sintéticas:

1. Abrir o painel em notebook, largura intermediária e modo móvel.
2. Entrar como gestor do tenant A; confirmar lista e contexto operacional.
3. Entrar como operador sem `freight.create`; confirmar ausência de **Novo Frete** e rejeição da API se a rota for chamada diretamente.
4. Criar um frete sintético; confirmar retorno, lista e ausência de duplicata.
5. Simular resposta perdida, fechar/reabrir o modal, repetir os mesmos dados e confirmar o mesmo frete.
6. Alterar os dados após a falha e confirmar uma nova intenção ou conflito coerente.
7. Consultar frete, lançamentos, finalização, envelope e relatório conforme permissões.
8. Tentar IDs do tenant B; confirmar 403/404 sem conteúdo cruzado.
9. Conferir loading, vazio, erro, mensagens em português, botões e scroll horizontal.

Resultado esperado: jornada coerente com a matriz, sem rede de produção e sem dados reais. Registrar `OWNER_VISUAL_GATE=APPROVED` somente por decisão humana.

## Roteiro de aceitação Flutter do owner

Usar o artefato CI `pilot-acceptance-release-apk`; não usar build debug:

1. Instalar manualmente em aparelho de teste autorizado.
2. Validar login, restauração e expiração de sessão.
3. Confirmar fretes autorizados e ausência de dados de outro motorista/tenant.
4. Confirmar **Novo Frete** com permissão e sua ausência sem permissão.
5. Criar com foto de odômetro e dados sintéticos.
6. Interromper a rede depois do envio; confirmar mensagem de resultado incerto.
7. Reabrir a tela com os mesmos dados e tocar em salvar; confirmar que não duplica.
8. Exercitar despesa, abastecimento, vale, anexo, scanner e comprovante.
9. Conferir navegação, loading, erros e privacidade financeira.
10. Registrar versão do APK, aparelho, Android e resultado observado.

`OWNER_MOBILE_DEVICE_GATE=PENDING` até essa execução física.

## Limitações e próxima ação segura

- Storage/RLS/Auth reais do Supabase não foram reproduzidos integralmente; PA-037 permanece `BLOCKED`.
- Não houve API_E2E completo da jornada contra uma pilha Supabase isolada.
- Não houve Flutter integration em emulador nem aceitação física.
- Recovery continua `BLOCKED_BY_RECOVERY`; a migration 088 continua ausente e não autorizada em produção.
- Os checks do HEAD da Draft PR são o gate técnico final desta frente.

Próxima ação segura: revisar a Draft PR, baixar os artefatos sanitizados e o APK release, executar os roteiros humanos em ambiente isolado e manter qualquer operação de produção bloqueada até os gates independentes de recovery, migration, deploy, visual, dispositivo, merge e go-live.
