# PRODUCT STABILIZATION S4 — External Portals / Auth / Cross-token / Cross-tenant

Data: 2026-09-05  
Branch: `stabilization/s4-external-portals-auth`  
Base canônica: `origin/main` pós-S1 em `f8cbd109a9a91c0f9e0a8ca77ef971be12395422`

## Reconciliação S1

- PR #491 está merged/closed na main usada como base.
- PR #490 permanece fora de escopo para S4: não foi mesclado, não foi usado como base e não deve ser tocado.
- Deep-link SPA em GitHub Pages foi reconciliado: o HTTP inicial pode responder `404` por desenho do Pages, mas `public/404.html` salva a URL original em `sessionStorage.redirect`, `index.html` carrega `/spa-redirect.js`, e o script restaura `pathname/search/hash` via `history.replaceState`. Portanto: `S1_BROWSER_DEEPLINK_SUPPORT=SUPPORTED_BY_404_HTML_PLUS_SPA_REDIRECT`.

## Escopo auditado

Documentos canônicos lidos antes de classificar achados:

- `docs/product/v9/SHIPPER_PORTAL_V1.md`
- `docs/product/v9/SHIPPER_PORTAL_V1_PORTAL_B.md`
- `docs/product/v9/PARTNER_NETWORK_V1.md`
- `docs/product/v9/TEAM_USER_PROVISIONING_V1.md`
- `docs/product/v9/PRODUCT_REGRESSION_AUDIT_2026_09_01.md`
- `docs/product/v9/PRODUCT_STABILIZATION_BOARD_2026_09_01.md`
- `docs/product/v9/DECISIONS.md`
- `docs/product/v9/MASTER_LEDGER.md`

Superfícies inspecionadas:

- Backend externo: `backend/routes/shipperPortal.js`, `backend/routes/partnerPortal.js`, `backend/middlewares/shipperPortalAuth.js`, `backend/middlewares/partnerPortalAuth.js`.
- Backend interno: `backend/middlewares/auth.js`, `backend/routes/shipperInbox.js`, `backend/routes/partnerNetwork.js`.
- Serviços de fronteira: `backend/services/shipperPortal/*`, `backend/services/partnerNetwork/*`.
- Frontend externo/interno: `painel_web/src/App.tsx`, `painel_web/src/api.ts`, `painel_web/src/contexts/AuthContext.tsx`, `painel_web/src/portal/*`, `painel_web/src/partner/PartnerApp.tsx`.

## Achados congelados antes de correção

### S4-MEDIUM-01 — Partner Lite mantém token local após revogação/bloqueio respondido como 403

O backend do Partner Lite revalida a identidade externa a cada requisição e retorna `403` quando o parceiro está bloqueado/removido. Isso é correto no servidor e impede acesso real. No frontend, porém, `painel_web/src/partner/PartnerApp.tsx` limpa `matopibalog_partner_token` apenas em `401`. Resultado: após bloqueio/revogação, o usuário pode permanecer com token morto no navegador e cair em erro de carregamento, em vez de resetar a sessão externa e voltar para `/portal/parceiro/entrar`.

Classificação: MEDIUM. Não há bypass de autorização; há estado de sessão externo incorreto e UX ruim em revogação.

Correção planejada: tratar `401` e `403` do cliente externo do parceiro como encerramento de sessão local, sem afetar `auth_token` interno nem `matopibalog_portal_token` do embarcador.

### S4-TEST-GAP-01 — Matriz HTTP completa de token cruzado ainda não está explícita em um teste único

Há cobertura existente para:

- token externo recusado no `verifyToken` interno;
- token interno recusado nos portais;
- parceiro bloqueado revogado na hora;
- usuário/relacionamento do embarcador revalidado por serviço de fronteira.

Lacuna: a matriz HTTP S4 pedida deve ficar explícita em uma prova pequena com os endpoints internos críticos e os dois portais externos.

Classificação: TEST_GAP. Sem evidência de bypass no código auditado.

Correção planejada: adicionar teste HTTP local que comprove:

- `shipper_portal`, `partner_portal` e `future_external_domain` são recusados em rotas internas críticas;
- token interno é recusado no portal do embarcador e no portal do parceiro;
- token de parceiro é recusado no portal do embarcador;
- token de embarcador é recusado no portal do parceiro;
- tokens externos não carregam `empresa_id`/papel interno.

### S4-TEST-GAP-02 — Sessões externas separadas no frontend precisam de teste direto para Partner Lite

O código usa chaves distintas:

- interno: `auth_token`;
- portal embarcador: `matopibalog_portal_token`;
- portal parceiro: `matopibalog_partner_token`.

Há comentários e cobertura ampla para o portal do embarcador; falta teste direto do Partner Lite garantindo que logout/erro de sessão externo não apaga sessão interna nem sessão do embarcador.

Classificação: TEST_GAP.

Correção planejada: adicionar teste Vitest focado no cliente externo do parceiro.

### S4-MEDIUM-02 — RESOURCE_FORBIDDEN_MUST_NOT_INVALIDATE_PARTNER_SESSION

A primeira correção de S4 passou a encerrar a sessão local do Partner Lite em
qualquer `401` ou `403`. Isso fechou o caso de parceiro bloqueado/revogado, mas
também apagaria `matopibalog_partner_token` quando o usuário continua legítimo e
apenas um recurso específico foi negado.

Autoridade congelada:

- `SESSION_INVALIDATION`: `401` de credencial/sessão inválida; `403` somente
  quando o backend retorna um `code` canônico que represente identidade, sessão ou
  relação do parceiro inválida/revogada.
- `RESOURCE_FORBIDDEN`: `403` de autorização/recurso não encerra a sessão global
  do Partner Lite.
- `UNKNOWN`: `code` ausente ou desconhecido nunca deve ser reinterpretado
  automaticamente como `SESSION_INVALIDATION`.

Classificação: MEDIUM. Não há bypass de autorização; o risco é derrubar uma
sessão externa válida por uma negativa de recurso.

Correção planejada: o backend deve devolver `code` canônico seguro nos caminhos
de autenticação relevantes, sem vazar detalhes sensíveis; o frontend deve decidir
por `status + code`, nunca por texto de mensagem, e remover somente
`matopibalog_partner_token`.

## Achados não confirmados como falha

- Portal do Embarcador não revalida usuário/relacionamento no middleware, mas os serviços de fronteira (`loadPortalContext`) são chamados nas operações externas e revalidam `shipper_portal_users.status = active` e relacionamento `ACTIVE`. A cobertura existente prova revogação/usuário desativado por serviço.
- Partner Lite não carrega `empresa_id` no token externo e revalida `partner_portal_users` a cada request no middleware.
- Frontend roteia `/portal/embarcador/*` e `/portal/parceiro/*` fora do `AuthProvider` interno.
- Cliente HTTP do embarcador é separado de `src/api.ts`, usa `withCredentials: false` e chave própria.
- Cliente HTTP do parceiro é separado de `src/api.ts` e usa chave própria.

## Produção / secrets

S4 não executa escrita real, convite real, login com usuário real, download real, mutation real nem dump de secrets. A validação de billing fica restrita a evidência já registrada e checagens sem impressão de valores secretos.

## Correções aplicadas após o freeze

- `painel_web/src/partner/PartnerApp.tsx`: o cliente externo do Partner Lite agora encerra a sessão local em `401` e apenas em `403` com `code` canônico de identidade/sessão/relação inválida ou revogada; `403` de recurso preserva a sessão global do parceiro. A remoção continua restrita a `matopibalog_partner_token`.
- `backend/middlewares/partnerPortalAuth.js`: respostas de autenticação do Partner Lite passam a expor `code` canônico seguro (`sessao_invalida`, `credencial_portal_parceiro_invalida` ou o `PartnerNetworkError.code` já saneado pelo domínio), sem basear a decisão em texto de mensagem.
- `backend/tests/externalPortalAuthHttp.test.js`: adicionada matriz HTTP S4 cobrindo token externo em rota interna, token interno em portal externo, token de parceiro no portal do embarcador, token de embarcador no portal do parceiro e ausência de claims internas nos tokens externos.
- `painel_web/src/partner/PartnerAuthBoundary.test.ts`: adicionada cobertura direta da chave de sessão externa do parceiro e dos status que limpam sessão.
- `painel_web/tests-e2e-visual/visual.spec.ts`: adicionada cobertura Playwright para o comportamento de navegador do Partner Lite em `403`, provando que `SESSION_INVALIDATION` limpa só a sessão do parceiro, `RESOURCE_FORBIDDEN` preserva o token do parceiro, e em ambos os casos não há navegação interna nem rede externa não controlada.
- `backend/tests/partnerPortalAuthHttp.test.js`: ajuste determinístico de parser para aceitar CRLF na migration 082 sem alterar migration aplicada.

## Verificação local

- `node --test --test-concurrency=1 @tests/*.test.js`: `2028/2028` passed.
- `node --test tests/externalPortalAuthHttp.test.js tests/partnerPortalAuthHttp.test.js tests/partnerNetworkBoundary.test.js tests/shipperPortalBoundary.test.js tests/shipperPortalB.test.js`: `114/114` passed.
- `npx vitest run src/partner/PartnerAuthBoundary.test.ts src/portal/PortalPortal.test.tsx src/portal/PortalAtivacao.test.tsx src/portal/PortalCorrecoes.test.tsx`: `45/45` passed.
- `npm run build` em `painel_web`: passed. Observações já existentes: Node local `20.18.0` abaixo do recomendado pelo Vite `20.19+`; chunk principal acima de 500 kB.
- `npm run test:e2e:visual`: `44/44` passed.
- `npm run test:e2e:sec1`: `1` skipped por `DATABASE_URL` ausente.
- `npm test` em `painel_web`: `293/296` passed; falhas fora do escopo S4 em `PainelEmpresas.test.tsx` e `UsuariosCorrecoes.test.tsx`.
- `backend npm run test:pg`: não executado localmente porque `DATABASE_URL_PRESENT=false`; os próprios arquivos `tests-pg` exigem banco efêmero de CI e vários falham deliberadamente em CI sem essa variável.

## Fechamento em produção

Data: 2026-10-06

Status final: `S4_TECHNICALLY_CLOSED_IN_PRODUCTION`.

- PR #492: merged em 2026-10-06T22:22:08Z.
- `FINAL_HEAD=81b045e8cde4a0e5063f74db8cdd094f3ec5aee0`.
- `MERGE_SHA=be9be5ef53da68cc4c94a75d7cbde775233c4476`.
- `BASE_MAIN=f8cbd109a9a91c0f9e0a8ca77ef971be12395422`.
- Main CI no `MERGE_SHA`: Backend CI `SUCCESS`, Frontend CI/build `SUCCESS`, SEC-1 Browser E2E `SUCCESS`, GitHub Pages `build-and-deploy` `SUCCESS`.
- Railway backend: deployment `c0356113-e27a-43e1-985a-6741676d97e1` `SUCCESS`, `commitHash=be9be5ef53da68cc4c94a75d7cbde775233c4476`, branch `main`, 1 réplica rodando, 0 crashed, 0 warnings/críticas.
- Smoke read-only em produção: `/health` 200; `/auth/me`, `/portal/embarcador/contexto`, `/portal/parceiro/oportunidades`, `/rede-parceiros/parceiros` e `/shipper-inbox/solicitacoes` negaram acesso sem credencial ou com credencial inválida via 401/403.
- Logs pós-deploy: somente boot/configuração informativa; `NEW_PRODUCTION_ERRORS=0`.
- Escritas de produção executadas por S4: `PRODUCTION_BUSINESS_WRITES=0`, `PRODUCTION_AUTH_USERS_CREATED=0`, `PRODUCTION_INVITATIONS_CREATED=0`, `PRODUCTION_EMAILS_SENT=0`, `MIGRATIONS_APPLIED_BY_S4=0`.
- PR #490 permanece fora de escopo: `PR490_TOUCHED=false`.
- `OWNER_VISUAL_VALIDATION=PENDING`: validação visual humana dos fluxos externos segue pendente e não reabre o fechamento técnico.
