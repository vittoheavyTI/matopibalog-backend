# MATOPIBA LOG — REPORTING PRODUCTS V1
## FORMAL DIGITAL ENVELOPE PDF & FREIGHT CLOSURE REPORT

- **Macrofront**: `REPORTING_PRODUCTS_V1`
- **Objetivo**: Avançar o macrorequisito RBV9-INV-091 após o fechamento técnico do E3.8 com reconciliação estrita de autoridades financeiras e visibilidade de motorista.
- **Status da Macrofrente**: `ATIVO_PROD`
- **Fechamento Técnico**: `REPORTING_PRODUCTS_V1_TECHNICALLY_CLOSED = true`
- **Aceitação Visual do Owner**: `REPORTING_PRODUCTS_V1_OWNER_VISUAL = PASS`
- **PR #507**: `CLOSED / MERGED` (`MERGED_AT=2026-10-15T04:48:30Z`)
- **Authorized PR Head**: `81ed7f47b660ba1c17872063032060d60d194b18`
- **Merge Commit SHA**: `1a45765dbe4ecb475b77c7d616f24a73297f5b08`
- **Main CI**: `4/4 SUCCESS` (no commit `1a45765dbe4ecb475b77c7d616f24a73297f5b08`)
- **Deploy Automático Railway**: ID `9f53f49c-2177-4af8-9137-4fcb6c005e43` (`SUCCESS`, commit `1a45765`, branch `main`, backend `ONLINE`, 1/1 réplicas)
- **Produção Writes**: 0 (zero)
- **Database Mutations**: 0 (zero)
- **Migrations Criadas**: 0 (zero)
- **Manual Deployments**: 0 (zero)
- **Merges**: 1 (PR #507 em `main`)

---

### 1. Contexto e Invariantes de Produto

Em conformidade com:
- **D-022**: O Envelope Digital é a unidade formal de encerramento do frete.
- **D-029**: Relatórios e PDFs são produtos probatórios e operacionais de primeira classe, não capturas de tela.
- **D-020**: Dados operacionais coletados devem permanecer auditáveis e acessíveis conforme autorização e escopo.
- **D-009 / D-043**: Política de visibilidade financeira do motorista segregada em `commission_only`, `commission_plus_base` e `full_freight_financial`.
- **E3.8**: `NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE=true` ativo em produção via trigger prospectiva e RPC canônica `e38_finalize_frete_with_envelope`.

---

### 2. Distinção Rígida entre os Dois Produtos

| Critério | Produto A: Envelope Digital Formal | Produto B: Relatório de Fechamento de Frete |
| :--- | :--- | :--- |
| **Natureza** | Peça probatória formal e selada (Snapshot imutável) | Relatório operacional consolidado de viagem |
| **Fonte Canônica** | `public.frete_envelopes_digitais` via `GET /fretes/:id/envelope-digital` | Backend consolidado via `GET /fretes/:id/relatorio-fechamento` |
| **Chancela de Integridade** | Hash criptográfico SHA-256 (`envelope_hash`) selado no encerramento | Não possui selo de imutabilidade; reflete apuração corrente |
| **Fretes Legados (sem envelope)** | **PROIBIDO FABRICAR**. Retorna/exibe `LEGACY_NO_FORMAL_ENVELOPE` com diálogo orientador e encaminhamento ao Relatório Operacional | **DISPONÍVEL**. Consolida lançamentos, dados de frete e documentos existentes |
| **Visibilidade Financeira** | Respeita estritamente redação por perfil (`driver_financial_visibility_mode` e `finance.operational.view`) | Respeita estritamente redação por perfil no backend com fail-closed |
| **Identificador no PDF** | Selado em `sealed_at` com integridade auditável | Gerado em `gerado_em` como documento operacional |

---

### 3. Reconciliação de Autoridades Financeiras e Correções de Revisão Independente

Na passagem de correção da revisão independente (PR #507), foram sanadas as quatro não conformidades identificadas:

#### HIGH-001 / HIGH-001B — Autoridade Financeira e Fórmula Canônica de Resultado
- **Eliminação de duplicação**: Removidas regras ad-hoc em `fretesController.js`.
- **Reuso de autoridades canônicas**:
  - `backend/utils/agregacaoFinanceiraFretes.js`: reuso de `STATUS_LANCAMENTO_EFETIVADO` (`['aprovado', 'finalizado']`) e `STATUS_LANCAMENTO_NAO_COMPOE` (`['cancelado', 'rejeitado']`). Lançamentos `pendente`, `rejeitado` e `cancelado` nunca compõem totais financeiros realizados.
  - `backend/utils/rentabilidadeFrete.js`: reuso de `calcularRentabilidadeFrete` para apuração do resultado operacional direto da viagem (`receita_realizada - custos_diretos`), preservando o princípio de que despesas operacionais pagas pelo motorista não deixam de ser custos diretos do frete.
  - `backend/utils/acertoMotorista.js`: reuso de `calcularAcertoMotoristas` para apuração do saldo do motorista (`comissao + reembolsos - vales/adiantamentos`).
- **Nomenclatura honesta**: Substituição de "resultado da empresa" por rótulos verdadeiros: `Resultado operacional` e `Saldo do motorista`.

#### HIGH-002 — Política de Visibilidade Financeira do Motorista (Fail-Closed)
- Integração estrita com `backend/services/permissions/driverFinancialRedaction.js` e `resolverDriverFinancialVisibilityMode`:
  - `commission_only`: omite valor bruto do frete, valor ton/km, resultado operacional da empresa e decomposição interna de custos da transportadora; preserva os valores de acerto do motorista (valor da comissão, percentual, despesas pagas pelo motorista a reembolsar e saldo do motorista).
  - `commission_plus_base`: expõe valor base do frete e comissão; omite decomposição interna de despesas da transportadora/empresa e resultado operacional.
  - `full_freight_financial`: expõe projeção financeira autorizada completa.
- **Fail-closed**: Em caso de falha de consulta de autoridade (`ensureEffective`), a projeção financeira é omitida por padrão (`restricted: true`, fail-closed seguro).

#### HIGH-003 — Autorização Multidomínio Campo a Campo (Cross-Domain Field-Level Authority)
O endpoint consolidado `GET /fretes/:id/relatorio-fechamento` compõe múltiplas autoridades independentes campo a campo:
1. `freight.view`: autoriza o acesso ao relatório de frete em si (linha de base da viagem). Não confere acesso implícito aos demais domínios.
2. `launch.view`: autoriza a inspeção de linhas e detalhes operacionais de lançamentos (`despesas`, `abastecimentos`, `vales`).
   - Se `launch.view=false`, o endpoint retorna `{ restricted: true, despesas: [], abastecimentos: [], vales: [] }`, suprimindo descrições, postos, litros, status e IDs operacionais.
   - O gerador de PDF renderiza tabela explícita com o aviso `Informações restritas para este perfil (permissão launch.view ausente)`, sem emitir tabelas vazias que sugiram ausência de lançamentos.
3. `documents.view`: autoriza os metadados dos documentos fiscais (`total`, `tipos`).
   - O bypass incondicional por perfil (`|| isDriver`) foi removido; se `documents.view=false`, retorna `{ total: null, tipos: [], restricted: true }`.
   - O gerador de PDF renderiza `Informações restritas para este perfil (permissão documents.view ausente)` em vez de falsos totais como "0 documentos".
4. `finance.operational.view`: autoridade financeira independente desacoplada de `launch.view`.
   - Um usuário com `finance.operational.view` pode visualizar indicadores financeiros agregados (`receita_realizada`, `custos_diretos`, `resultado_operacional`) mesmo quando linhas individuais de lançamentos estão ocultas.
5. `EPOD_AUTHORITY_REVIEW=PASS`: os campos de comprovação digital de entrega (ePOD) utilizam o modelo canônico de posse e escopo do frete (`buscarFreteComAcesso`), expondo apenas dados de status e recebedor sem criar novo domínio de permissão desnecessário.
6. **Fail-Closed Total**: Se a chamada a `ensureEffective` falhar por erro de rede ou serviço, todas as três autoridades cruzadas falham fechadas (`hasLaunchView=false`, `hasDocumentsView=false`, `hasFinanceView=false`), garantindo `UNKNOWN != ALLOW`.

#### MEDIUM-001 — Gate Visual Estendido no Playwright
- `painel_web/tests-e2e-visual/s4_reporting_products.visual.spec.ts` estendido para cobrir todos os 10 critérios exigidos nos três viewports (1440x900, 1024x768, 390x844):
  1. Linha/accordion de frete finalizado visível e expandida.
  2. Botão "Envelope Digital" visível.
  3. Botão "Relatório de Fechamento" visível.
  4. Bounding boxes dos botões contidos dentro da viewport horizontal.
  5. Estado formal do envelope com selo E3.8 ativo verificado.
  6. Estado `LEGACY_NO_FORMAL_ENVELOPE`: clique exibe diálogo explicativo `#modal-aviso-envelope` sem fabricação retroativa de PDF.
  7. Estado desabilitado/loading (`Gerando...`) determinístico verificado via promessa interceptada.
  8. Estado de falha de API visível em diálogo `#modal-erro-reporting`.
  9. Diálogos e botões de ação sem transbordamento horizontal.
  10. Violações de rede externa = 0 (`EXTERNAL_NETWORK_REQUESTS_ALLOWED=0`).

#### MEDIUM-002 — Eliminação de Alerts Nativos
- Todas as mensagens de erro nos handlers de relatório em `GerenciamentoViagens.tsx` foram convertidas para o componente modal in-app acessível (`#modal-erro-reporting`), eliminando completamente chamadas a `alert()` nativo do navegador.

---

### 4. Bateria de Verificação Executada

- **Testes Focados Backend**: 35/35 testes aprovados em `backend/tests/freteDigitalEnvelope.test.js` cobrindo cenários A a J e CROSS-DOMAIN 1 a 8 (`node --test`).
- **Testes Focados Frontend**: 14/14 testes aprovados em `painel_web/src/utils/reportingProducts.test.ts` (`vitest run`), comprovando tolerância a `lancamentos.restricted` e `documentos_fiscais.restricted` sem crash e sem recalcular linhas no cliente.
- **Testes Visuais Playwright**: 3/3 cenários aprovados em `s4_reporting_products.visual.spec.ts` (Desktop 1440x900, Tablet 1024x768, Mobile 390x844) com zero violações de rede externa.
- **Suíte Completa Backend**: Aprovada (`node --test`).
- **Build Frontend**: `tsc -b && vite build` aprovado sem erros de tipagem nem falhas de empacotamento.

---

### 5. Evidência Remota de Merge, CI e Deploy em Produção

- **PR #507**:
  - `STATE = CLOSED / MERGED`
  - `MERGED_AT = 2026-10-15T04:48:30Z`
  - `AUTHORIZED_PR_HEAD = 81ed7f47b660ba1c17872063032060d60d194b18`
  - `MERGE_SHA = 1a45765dbe4ecb475b77c7d616f24a73297f5b08`
- **Main CI (Commit 1a45765dbe4ecb475b77c7d616f24a73297f5b08)**: `4/4 SUCCESS`
  - Backend CI: SUCCESS (Run ID: 38683407271)
  - Frontend CI: SUCCESS (Run ID: 38683407286)
  - SEC-1 Browser E2E: SUCCESS (Run ID: 38683407275)
  - Deploy to GitHub Pages: SUCCESS (Run ID: 38683407326)
- **Deploy Automático Railway**:
  - `DEPLOYMENT_ID = 9f53f49c-2177-4af8-9137-4fcb6c005e43`
  - `commitHash = 1a45765dbe4ecb475b77c7d616f24a73297f5b08`
  - `branch = main`
  - `status = SUCCESS`
  - `backend state = ONLINE`
  - `replicas = 1/1 running`
  - `warnings = 0`, `criticals = 0`, `recent failures = 0`
  - *Nota de governança*: O merge disparou o deploy automático normal da Railway. Não houve deploy manual (`MANUAL_DEPLOYMENTS=0`).
  - *Invariantes de Auth no boot*:
    - `authMode = strict`
    - `sessionsEnabled = true`
    - `rotationEnabled = true`
    - `requireSession = true`
    - `allowLegacy = false`
    - `legacyCutoff = null`
- **Estado de Schema / Migrations**:
  - `SCHEMA_CHANGE = false`
  - `MIGRATION_CREATED = false`
  - O PR #507 não introduziu migrações.
  - Catálogo de migrações em produção preservado no topo:
    - `20261011204500` — `086_e38_formal_envelope_enforcement`
    - `20261010172936` — `087_auth_sessions_per_client_idle`
    - `20261009125633` — `085_unified_audit_digital_envelope`

---

### 6. Aceitação Visual do Owner (OWNER_VISUAL_VALIDATION = PASS)

A validação visual pelo OWNER foi concluída com aprovação (`PASS`) após ciclos iterativos de correção e verificação:
1. **User scroll ownership**: rolagem da página preservada sob controle do usuário sem saltos forçados.
2. **Persistência de estado de accordions**: accordions de viagens mantêm seu estado de expansão/recolhimento após interações.
3. **Responsividade desktop e mobile**: comportamento íntegro e legível nos viewports testados (desktop, tablet e mobile).
4. **Ausência de artefatos visuais de dados**: zero ocorrências de `undefined`, `null` ou `NaN` visíveis na interface.
5. **Dados de cabeçalho do motorista**: exibição correta e formatada das informações de motorista e veículo.
6. **Relatório financeiro interno completo**: apuração com decomposição correta para perfis autorizados (`finance.operational.view`).
7. **Envelope formal monopágina**: formatação concisa em página única para o envelope formal selado.
8. **Relatório operacional em fretes legados**: sucesso na geração do relatório de fechamento para fretes anteriores a E3.8.
9. **Indisponibilidade determinística de envelope formal em legados**: exibição clara do diálogo orientador `LEGACY_NO_FORMAL_ENVELOPE` sem simulação de selo.
10. **Tratamento de erro determinístico de API**: diálogo `#modal-erro-reporting` acionado em falhas sem uso de `alert()` nativo.

---

### 7. Relação com RBV9-INV-091

A macrofrente `REPORTING_PRODUCTS_V1` conclui com sucesso a primeira fatia de produtos de relatório formal:
- **Formal Digital Envelope PDF**: `ATIVO_PROD`
- **Freight Closure Report PDF**: `ATIVO_PROD`

O macrorequisito **RBV9-INV-091** no MASTER_LEDGER permanece como **PARTIAL**, pois o escopo completo daquele item de inventário abrange relatórios adicionais futuros (espelho, histórico veículo/manutenção, consumo).
