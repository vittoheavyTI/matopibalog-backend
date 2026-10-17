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

# PILOT_ACCEPTANCE_V1_HARDENING_CLOSURE

## Escopo e achados reproduzidos

Esta revisão parte do HEAD `175c7811554e86a99e1a2b0fee8ab690a61c005c` da Draft PR #510. As quatro hipóteses foram verificadas contra o código, sem usar o relatório anterior como autoridade:

- `PAV1-REVIEW-HIGH-02=CONFIRMED`: `Config.apiBaseUrl` continha o endpoint Railway de produção e o workflow gerava um APK release com a identidade comercial e assinatura debug.
- `PAV1-REVIEW-HIGH-03=CONFIRMED`: web e Flutter mantinham uma única intenção somente em memória, sem persistência entre reinícios, sem escopo de ator/tenant e sem suporte a múltiplas pendências.
- `PAV1-REVIEW-GAP-04=CONFIRMED`: não havia servidor HTTP real exercitando o serviço canônico sobre PostgreSQL real.
- `PAV1-REVIEW-GAP-05=CONFIRMED`: não existe Supabase Auth/RLS/Storage isolado disponível. Docker e Supabase CLI não estão disponíveis no executor local, e o CI desta frente possui PostgreSQL comum, não a pilha Storage oficial.

A migration 088, matemática financeira, comissões, E3.8, SEC-1, RLS e grants não foram alterados.

## Segurança do APK de homologação

A configuração Flutter agora usa exclusivamente `--dart-define`, sem endpoint default. `APP_ENV`, `API_BASE_URL` HTTPS e a atestação `HOMOLOGATION_BACKEND_VERIFIED` formam o contrato. Em homologação, qualquer host `.up.railway.app` é recusado. Sem backend de staging aprovado, o artefato usa `https://homologacao.invalid` e `HOMOLOGATION_BACKEND_VERIFIED=false`; ele é instalável para inspeção de UI, mas bloqueia toda criação de frete.

O workflow executa um preflight negativo, compila com `MATOPIBA_HOMOLOGATION_BUILD=1`, verifica o manifesto do APK e procura o endpoint Railway anterior no arquivo final. A identidade Android passa a ser `br.com.matopibalog.app.homologation`, o nome apresentado é `Matopiba Log Homologacao` e um banner visível mostra `HOMOLOGACAO`. O application ID comercial permanece como default dos builds de produção fora desse fluxo. `versionCode=1` e `versionName=1.0.0` permanecem inalterados.

A assinatura release continua sendo a chave debug do projeto: `APK_SIGNING_TYPE=TEST_DEBUG_KEY`. Isso atende somente ao artefato de homologação e não constitui assinatura comercial, publicação ou prontidão de loja. `google-services.json` não integra o repositório; o build mantém o fallback já existente sem Firebase/push. As permissões Android e as integrações de câmera, scanner, localização e notificações não foram ampliadas.

## Continuidade mínima e escopada da intenção

Web e Flutter passaram de uma única entrada em memória para um registro de até oito intenções, com expiração de 72 horas e limpeza individual. Cada registro contém somente:

- UUID da requisição;
- SHA-256 do payload canônico;
- SHA-256 do par tenant+usuário;
- timestamps;
- estado `prepared|ambiguous|created`;
- ID do frete confirmado, quando aplicável.

Não são persistidos rota, valor, placa, unidade, documentos, fotos, token, permissões ou payload bruto. A web usa armazenamento da origem para sobreviver a reload/encerramento da aba; o Flutter usa `flutter_secure_storage`. Logout mantém apenas os metadados opacos e a sessão seguinte só os encontra se tenant e usuário atuais produzirem o mesmo scope hash. A expiração remove registros antigos.

Uma intenção de conteúdo diferente cria outra entrada sem substituir a anterior. Sucesso remove somente a intenção correspondente. Após o servidor confirmar a criação, o ID do frete permanece até foto/documentos e efeitos seguintes terminarem; um retry após falha de upload reusa esse frete e não repete `POST /fretes`. 401/403/409 permanecem rejeições definitivas; falha de transporte, timeout e HTTP 5xx preservam a intenção como resultado ambíguo. O backend continua revalidando permissão, tenant, ownership e escopo em cada replay.

## API E2E isolada

`backend/tests-pg/pilot_acceptance_api_e2e.pgtest.mjs` sobe um servidor Express real em porta efêmera, usa o serviço canônico `createFreight`, envia HTTP real com `fetch` e persiste em PostgreSQL 17 real. O adaptador de teste implementa somente a superfície Supabase usada pelo serviço e não entra no código de produção.

O harness falha fechado antes de conectar quando falta habilitação, o host é remoto, o banco administrativo não é `postgres`, a porta/usuário divergem ou existem opções na URL. Depois da conexão ele exige PostgreSQL 17 recém-iniciado, superusuário esperado, endereço privado, layout oficial do container, um único banco conectável e zero relações de usuário. Só então cria um banco aleatório no namespace `pilot_api_e2e_<nonce>`; o cleanup remove somente esse banco validado.

A autenticação desse teste é `SYNTHETIC_TEST_AUTH`, declarada e limitada ao processo efêmero. Portanto ele prova HTTP, validação, serviço, concorrência, persistência, tenant, permissão e idempotência, mas não prova Supabase Auth nem SEC-1 real. SEC-1 continua no workflow separado com PostgreSQL 16.

## Matriz INT-001 a INT-028

| Caso | Resultado | Nível e evidência | Limitação |
| --- | --- | --- | --- |
| INT-001 | PASS | API_E2E_PG: insert confirmado e retry convergem | Auth sintética |
| INT-002 | PASS | Playwright: primeiro POST abortado após envio | API interceptada |
| INT-003 | PASS | Playwright: modal fecha e reabre | API interceptada |
| INT-004 | PASS | Unit web: novo ref/rota recupera registro | Componente |
| INT-005 | PASS | Playwright: reload completo preserva UUID | API interceptada |
| INT-006 | PASS | Unit web: reconstrução com storage persistido | Processo real do browser não reiniciado no CI |
| INT-007 | PASS | Flutter host: reconstrução recupera intenção | Sem emulador |
| INT-008 | PASS | Flutter host: nova leitura do secure storage | Sem reinício físico |
| INT-009 | PASS | Web/Flutter unit: intenção B não substitui A | Cliente |
| INT-010 | PASS | Web/Flutter unit: duas pendências distintas | Cliente |
| INT-011 | PASS | Web/Flutter unit: concluir B preserva A | Cliente |
| INT-012 | PASS | Web/Flutter unit: usuário B recebe scope distinto | Identidade sintética |
| INT-013 | PASS | Web/Flutter unit + API_E2E_PG tenant B | Auth sintética no E2E |
| INT-014 | PASS | Backend/SEC-1 regressão + preservação escopada | Não é Supabase Auth E2E |
| INT-015 | PASS | API_E2E_PG revoga `freight.create` e recebe 403 | Auth sintética |
| INT-016 | PASS | Serviço/backend existente: derivados não entram no hash | Regressão focal |
| INT-017 | PASS | API_E2E_PG: mesma chave/payload divergente retorna 409 | Auth sintética |
| INT-018 | PASS | Unit: payload distinto cria entrada distinta; igual reutiliza | Sem botão de descarte inseguro |
| INT-019 | PASS | Flutter: ID confirmado persiste após criação | Falha de upload simulada por contrato |
| INT-020 | PASS | Flutter/web: retry com ID confirmado pula novo POST | Host/componente |
| INT-021 | PASS | Flutter: 401/403/409 definitivos; 500 ambíguo | Cliente HTTP |
| INT-022 | PASS | Web/Flutter: rede mantém UUID e não cria outro automaticamente | Host/Playwright |
| INT-023 | PASS | CI inspeciona APK e recusa endpoint Railway anterior | Artefato de CI |
| INT-024 | PASS | Preflight sem configuração retorna erro | Build guard |
| INT-025 | PASS | Workflow compila apenas identidade de homologação | Workflow dedicado |
| INT-026 | PASS | Manifesto, label e banner `HOMOLOGACAO` | Sem aceite humano |
| INT-027 | PASS | Registro contém somente hashes/UUID; scan de diff/APK | Sem credencial comercial |
| INT-028 | PENDING_CI | Regressões forcedId/comissão/E3.8/SEC-1 no HEAD final | Depende do CI final |

Resumo provisório antes do CI final: `PASS=27`, `FAIL=0`, `BLOCKED=0`, `PENDING_CI=1`.

## PA-037 — Storage/RLS

`PA-037=BLOCKED_BY_ENVIRONMENT`.

Foram preservados os testes existentes de contrato, MIME, signed URL, metadata, falha parcial e cleanup do objeto recém-enviado. Não foram executados bucket público/privado, policies de `storage.objects`, negativa anônima/cross-tenant nem expiração real de signed URL em uma pilha Supabase isolada. PostgreSQL comum ou simulação do SDK não foram apresentados como prova de Storage/RLS.

## Roteiro humano revisado

O owner não deve instalar o APK anterior da primeira certificação. O único artefato elegível para inspeção é `pilot-acceptance-homologation-safe-apk`, identificado pelo application ID de homologação, label próprio, banner vermelho e backend deliberadamente indisponível. Sem endpoint isolado atestado, login e operações reais permanecem `BLOCKED_BY_STAGING_ENDPOINT`.

Quando um endpoint isolado for aprovado, gerar novo APK com o mesmo application ID de homologação, URL HTTPS e `HOMOLOGATION_BACKEND_VERIFIED=true`; verificar login, expiração/revogação, duas intenções ambíguas, reinício do processo/aparelho, upload inicial, retry somente do upload, câmera/scanner e ausência de dados cross-tenant. Aceite físico continua decisão exclusiva do owner.

## Validação e change set do fechamento

Validação local no executor Windows:

- backend completo: 2.220/2.220;
- migration 088 focal sem PostgreSQL local: guard 15/15; execução real reservada ao serviço PostgreSQL 17 do CI;
- API E2E: guard negativo aprovado; execução HTTP+PostgreSQL real reservada ao serviço PostgreSQL 17 do CI;
- web focal: 5/5;
- Playwright piloto: 2/2, com reload completo e rede externa bloqueada;
- build web: aprovado; o Node 20.18 local emitiu aviso de versão mínima do Vite, enquanto o CI usa a versão de `.nvmrc`;
- Flutter: 153/153 e `flutter analyze` sem achados;
- frontend completo local: 324/330 na execução conjunta por seis timeouts em três arquivos sob saturação do executor; os mesmos três arquivos passaram 24/24 isoladamente com timeout ampliado. A execução Linux do CI permanece autoridade da regressão completa.

Arquivos alterados ficam limitados ao workflow desta macrofrente, ao novo harness PostgreSQL, à configuração/identidade e continuidade Flutter, à continuidade web, aos testes correspondentes e a este documento. Migration 088 e código de autenticação/negócio do backend não foram modificados.

Commits de implementação:

- `61893b4` — `fix(pilot): harden apk and freight intent continuity`;
- `61d76c0` — `test(pilot): add real HTTP PostgreSQL acceptance E2E`.

O resultado do CI do HEAD publicado será registrado após o push, sem reescrever a evidência histórica acima.

## Gates preservados

`OWNER_VISUAL_GATE=PENDING`

`OWNER_MOBILE_DEVICE_GATE=PENDING`

`OWNER_MIGRATION_088_GATE=PENDING`

`OWNER_MERGE_GATE=PENDING`

`OWNER_PRODUCTION_DEPLOY_GATE=PENDING`

`OWNER_PILOT_GO_LIVE_GATE=PENDING`
`RECOVERY_STATUS=BLOCKED_BY_RECOVERY`

Nenhum APK foi distribuído, nenhum serviço foi criado e nenhuma operação de produção foi executada.
