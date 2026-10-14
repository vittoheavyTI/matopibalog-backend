# MATOPIBA LOG — REPORTING PRODUCTS V1
## FORMAL DIGITAL ENVELOPE PDF & FREIGHT CLOSURE REPORT

**Macrofront**: `REPORTING_PRODUCTS_V1`  
**Objetivo**: Avançar o macrorequisito RBV9-INV-091 após o fechamento técnico do E3.8.  
**Status da Onda**: `IMPLEMENTED_IN_DRAFT_PR` (Aguardando revisão independente de Draft PR)  
**Produção Writes**: 0 (zero)  
**Migrations Criadas**: 0 (zero)  

---

### 1. Contexto e Invariantes de Produto

Em conformidade com:
- **D-022**: O Envelope Digital é a unidade formal de encerramento do frete.
- **D-029**: Relatórios e PDFs são produtos probatórios e operacionais de primeira classe, não capturas de tela.
- **D-020**: Dados operacionais coletados devem permanecer auditáveis e acessíveis conforme autorização e escopo.
- **E3.8**: `NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE=true` ativo em produção via trigger prospectiva e RPC canônica `e38_finalize_frete_with_envelope`.

---

### 2. Distinção Rígida entre os Dois Produtos

| Critério | Produto A: Envelope Digital Formal | Produto B: Relatório de Fechamento de Frete |
| :--- | :--- | :--- |
| **Natureza** | Peça probatória formal e selada (Snapshot imutável) | Relatório operacional consolidado de viagem |
| **Fonte Canônica** | `public.frete_envelopes_digitais` via `GET /fretes/:id/envelope-digital` | Backend consolidado via `GET /fretes/:id/relatorio-fechamento` |
| **Chancela de Integridade** | Hash criptográfico SHA-256 (`envelope_hash`) selado no encerramento | Não possui selo de imutabilidade; reflete apuração corrente |
| **Fretes Legados (sem envelope)** | **PROIBIDO FABRICAR**. Retorna/exibe `LEGACY_NO_FORMAL_ENVELOPE` com diálogo orientador e encaminhamento ao Relatório Operacional | **DISPONÍVEL**. Consolida lançamentos, dados de frete e documentos existentes |
| **Visibilidade Financeira** | Respeita estritamente redação por perfil (motorista `commission_only`, operador sem `finance.operational.view`) | Respeita estritamente redação por perfil (`finance_redacted: true`) |
| **Identificador no PDF** | Selado em `sealed_at` com integridade auditável | Gerado em `gerado_em` como documento operacional |

---

### 3. Implementação e Arquitetura

#### Backend
- `backend/controllers/fretesController.js`:
  - `getEnvelopeDigital`: corrigido para incluir `envelope_hash`, `motorista_nome` e `placa` na projeção e resposta.
  - `getRelatorioFechamento`: novo endpoint canônico que valida tenant e escopo, consolida lançamentos operacionais (`despesas`, `abastecimentos`, `vales`), contagem e status de documentos e ePOD, situação do envelope formal, e aplica regras de apuração financeira e comissão conforme vínculo (autônomo vs vinculado), com redação fail-closed de campos financeiros confidenciais quando o operador carece de `finance.operational.view`.
- `backend/routes/fretes.js`: registrado `GET /:id/relatorio-fechamento` protegido por `requirePermission('freight.view')`.
- `backend/tests/freteDigitalEnvelope.test.js`: 18 testes automatizados dedicados cobrindo autorização, isolamento multi-tenant (403), projeção de hash/motorista/placa, fretes legados e redação financeira.

#### Frontend
- `painel_web/src/utils/reportingFormatters.ts`: centralização de formatadores puros de moeda BRL, data/hora sem desvio de fuso horário UTC (`yyyy-MM-dd`), quilometragem, tonelagem, modalidade e geradores determinísticos de nome de arquivo.
- `painel_web/src/utils/formalEnvelopePdf.ts`: gerador do Envelope Digital Formal com cabeçalho de integridade probatória, tabelas estruturadas, resumo de auditoria E3.8 e paginação "Página X de Y".
- `painel_web/src/utils/freightClosurePdf.ts`: gerador do Relatório de Fechamento Operacional com disclaimer de distinção, apuração de lançamentos e resumo financeiro.
- `painel_web/src/pages/GerenciamentoViagens.tsx`: superfície de operações atualizada com dois botões dedicados e estilizados no accordion ("Envelope Digital" e "Relatório de Fechamento"), modal in-app acessível para estado legado sem envelope formal, e tratamento sem chamadas `alert()` nativas.
- `painel_web/src/utils/reportingProducts.test.ts`: 10 testes unitários Vitest cobrindo formatadores e contratos de geração de PDF.
- `painel_web/tests-e2e-visual/s4_reporting_products.visual.spec.ts`: validação responsiva automatizada no Playwright cobrindo desktop (1440x900), tablet (1024x768) e mobile (390x844) sem overflow horizontal.

---

### 4. Bateria de Verificação Executada

- **Backend Unit & Regression**: 18/18 testes de envelope e 2.188/2.188 testes da suíte completa aprovados (`node --test`).
- **Frontend Unit**: 10/10 testes em `reportingProducts.test.ts` aprovados (`vitest run`).
- **Frontend Build**: `tsc -b && vite build` aprovado com código de saída 0.
- **Responsivo/Visual Playwright**:
  - `1440x900`: PASS (`scrollWidth <= clientWidth + 1`)
  - `1024x768`: PASS (`scrollWidth <= clientWidth + 1`)
  - `390x844`: PASS (`scrollWidth <= clientWidth + 1`)
  - Defeitos visuais abertos: 0
