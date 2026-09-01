# Board da onda de estabilização V9 — 2026-09-01

**Macrofrente:** `V9_PRODUCT_STABILIZATION_WAVE_V1`
**Base:** `origin/main` = `cb505ac47e1801565951c89bc2161d9238b74048`
**PR em curso:** #491 (draft) — **só S1**
**PR #490 (ERP Hub):** `OPEN_DRAFT_HOLD_DO_NOT_MERGE`, HEAD `51961d3e` intocado
**Roadmap:** `PAUSED_FOR_STABILIZATION`

Este board **agrega** a onda. Não substitui
[`PRODUCT_REGRESSION_AUDIT_2026_09_01.md`](./PRODUCT_REGRESSION_AUDIT_2026_09_01.md),
que continua sendo o registro detalhado da primeira rodada.

| Slice | Escopo | Estado |
|---|---|---|
| **S1** | Shell / Navegação / Comercial | `IN_PROGRESS_PR491` — corrigido |
| **S2** | Super Admin / Team / Permissões | `FINDINGS_FROZEN` — auditado, **não corrigido** |
| **S3** | Núcleo operacional e formulários | `FINDINGS_FROZEN` — auditado, **não corrigido** |
| **S4** | Portais externos | `FINDINGS_FROZEN` — auditado, **não corrigido** |

`STABILIZATION_SECURITY_BLOCKER` = **nenhum**. Detalhe em *Segurança*, abaixo.

---

## S1 — Shell / Navegação / Comercial (corrigido no #491)

| ID | Superfície | Classe | Sev. | Repro | Esperado | Real | Causa raiz | Lacuna de teste | Correção | Schema | Decisão | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| REG-001 | Sidebar | `REGRESSION` | BLOCKER | `/minhas-faturas?aba=contratacao` | 1 item ativo | 2 itens ativos | Dois `NavLink` para o mesmo pathname; `isActive` ignora query string | Sidebar sem teste | Entrada financeira única + badge no próprio item | não | não | **FIXED** (rodada 1) |
| S1-HIGH-01 | Faturas / Contratação | `EXISTING_BUG` | **HIGH** | Persona só de contratação abre `?aba=contratacao` | Assinar sem tocar em finanças | 2 GETs financeiros **+ 1 POST** de sincronização (write que chama o provedor) no mount, para qualquer persona e qualquer aba | O mount carregava a área financeira incondicionalmente; a rota não guardada (DEC-201) foi lida como "liberar a contratação", mas liberava o **hub inteiro** | Nenhum teste media I/O por persona | I/O financeiro só na área financeira e só com `finance.saas.view`; aba Faturas some sem a permissão; `?aba=faturas` forçado cai na contratação | não | não | **FIXED** |
| S1-HIGH-02 | Layout + Faturas | `EXISTING_BUG` | **HIGH** | Contrato pendente nas duas telas | Mesmo sentido | Duas lógicas independentes: banner do Layout hardcoded, `resolverBannerPlano` na página. A correção do BUG-005 alcançou só uma | Copy comercial sem autoridade única | `utils/commercialAccountState.ts`: um resolvedor semântico, duas superfícies derivadas | não | não | **FIXED** |
| S1-HIGH-03 | `GET /pagamentos/faturas/:id/pix` | `EXISTING_BUG` | **HIGH** | Usuário autenticado da empresa **sem** `finance.saas.view`, com um id de fatura | 403 | 200 com o QR/copia-e-cola da fatura | Rota só com `verifyToken`. O isolamento de tenant **existe** no corpo (compara `usuarios.empresa_id`), mas não há checagem de permissão — ao contrário de todas as rotas irmãs | Sem teste de autorização nessa rota | **NÃO aplicada** — ver nota abaixo | não | **sim** | **REPORTED** |
| BUG-002 | Hook de contratação | `EXISTING_BUG` | MEDIUM | leitura de código | Autoridade espelhando o backend | Gate próprio (`role==='admin'`) + bloco morto na Sidebar | Critério legado divergente do servidor | Hook sem teste | Hook alinhado ao servidor; comentário corrigido para a conclusão final da auditoria | não | não | **FIXED** |
| BUG-003 | Rotas × menu | `EXISTING_BUG` | MEDIUM | URL direta sem permissão | Acesso restrito | Tela vazia | Menu gateado, rota não | Sem teste cruzado | `PermissionRoute` alinhado | não | não | **FIXED** (rodada 1) |
| BUG-004 | Configurações | `EXISTING_BUG` | MEDIUM | Voltar de `?aba=perfil` | Sai da aba | Aba não muda | Query string lida num sentido só | Sem teste de abas | URL como fonte da verdade nos dois sentidos | não | não | **FIXED** (rodada 1) |
| S1-LOW-01 | Hook de contratação | `EXISTING_BUG` | LOW | Carregar qualquer página | 1 requisição | 3 `GET /contratacao/status` simultâneos (Layout + Sidebar + MinhasFaturas) | Cada montagem busca por conta própria | — | Dedupe do que está **em voo** (sem cache de resultado, para não servir estado velho no gate comercial) | não | não | **FIXED** |
| DEC-201 | Guarda de `/minhas-faturas` | `PRODUCT_DECISION_NEEDED` | — | — | — | — | — | — | Rota segue sem guarda; a autorização passou a ser **por área** dentro dela | não | registrada | **RESOLVIDA por S1-HIGH-01** |
| DEBT-101 | Rotas órfãs super-admin | `KNOWN_ACCEPTANCE_DEBT` | LOW | `/painel-administrativo/visao-geral`, `.../relatorios` | — | Sem item de menu | Reorganização do menu preservou as páginas | — | Não corrigido — remover rota é decisão de produto | não | sim | **OPEN** |

### S1-HIGH-03 — por que a correção NÃO foi aplicada aqui

É uma lacuna real de autorização e a correção é de uma linha (`verificarEmpresa` +
`requirePermission('finance.saas.view')`, igual às rotas irmãs). Mesmo assim, não a
apliquei, por três razões que se somam:

1. **O consumidor não é só a web.** `app_android` chama esse endpoint em
   `minhas_faturas_screen.dart`. A tela é gateada por `auth.isAutonomo`, e o
   autônomo dono recebe `finance.saas.view` pelo bypass legado do
   `permissionResolver` — então a correção *deveria* ser inócua. "Deveria" não é
   "está provado": não tenho como exercitar o app em device nesta frente, e um 403
   no fluxo de pagamento do autônomo seria pior que a lacuna.
2. **A alcançabilidade é baixa.** Listar faturas já exige `finance.saas.view`; para
   explorar isto é preciso conhecer o UUID de uma fatura, que não é enumerável por
   essa via. Não é um caminho aberto, é uma porta sem tranca num corredor fechado.
3. **Esta frente foi definida como não tocando o backend.** Mudar autoridade de
   servidor sem o teste de device correspondente contradiz o próprio critério que
   venho aplicando: autoridade não se mexe para fazer tela passar — nem para
   fechar um relatório.

Não é tenant leak (o isolamento por empresa está no corpo da rota) e não move
dinheiro. Fica registrado como **HIGH aberto**, com a correção pronta para ser
autorizada junto de um teste do app.

### Autoridade dos endpoints (auditada, §3)

| Endpoint | Auth | Permissão | Tenant | Efeito | Quem deve usar |
|---|---|---|---|---|---|
| `GET /pagamentos/cobrancas/:id` | token | `finance.saas.view` | `verificarEmpresa` | leitura | Administrador, Financeiro, autônomo dono |
| `GET /pagamentos/plano-status` | token | `finance.saas.view` | `verificarEmpresa` | leitura | idem |
| `POST /pagamentos/minhas-faturas/sincronizar` | token | `finance.saas.view` | `verificarEmpresa` | **write + chamada ao provedor**, gate sandbox | idem |
| `GET /pagamentos/faturas/:id/pix` | token | **nenhuma** ⚠️ | no corpo | leitura + consulta ao provedor | *deveria* ser quem tem `finance.saas.view` |
| `GET /contratacao/status` | token | `company.settings.manage` **ou** empresa `tipo='autonomo'` | `verificarEmpresa` | leitura, fail-open | quem trata do contrato |
| `GET /contratacao/minha` | token | idem | `verificarEmpresa` | leitura | idem |
| `POST /pagamentos/upgrade/solicitar` | token | `company.settings.manage` | `verificarEmpresa` | **write + cobrança**, gate sandbox | Administrador |

Congelado: **`CONTRACT_ACCESS_IS_NOT_FINANCE_ACCESS = true`**.
`FINANCE_SAAS_ACCESS` = `finance.saas.view`;
`CONTRACT_ACCESS` = a autoridade que o backend já usa (`company.settings.manage` ou
autônomo). Nenhuma permissão nova foi criada, e `role === 'admin'` não é autoridade
em lugar nenhum da correção.

`CONTRACT_TAB_AUTO_FINANCE_SYNC = false`, testado.

### Observação sobre `POST /minhas-faturas/sincronizar`

Um **write** que chama o provedor externo é autorizado por uma permissão de
**leitura** (`finance.saas.view`). Está tenant-escopado e sob gate de sandbox, e o
efeito é apenas reconciliar as cobranças da própria empresa — então não classifiquei
como defeito de segurança. Mas é uma incoerência de nomenclatura de autoridade, e
redesenhar billing está fora desta onda. Registrado como
`PRODUCT_DECISION_NEEDED` para a frente que revisar billing.

### Copy do contrato pendente — a verdade exata (§11)

A copy anterior desta frente **exagerava**, e isso foi corrigido junto:

- `verificarPlano` libera **sempre** GET/HEAD/OPTIONS → **leitura nunca é bloqueada**.
- Contrato obrigatório pendente bloqueia escrita em contas **legadas**. Em contas
  `v2`, quem decide é `situacao.acoes.operar_escrita`, e uma conta v2 ativa com
  contrato pendente **continua escrevendo**.
- `/contratacao/status` **força** `pendencia_obrigatoria: false` durante
  `trial_ativo`/`trial_expirando`. Logo "trial ativo + pendência obrigatória" não
  chega ao frontend; durante o trial o contrato é a **próxima ação**, não um bloqueio.

A copy passou a dizer *"algumas ações podem ficar restritas... a consulta continua
liberada"* — verdadeiro em todos os casos — em vez de escolher um extremo.
`PRODUCT_DECISION_NEEDED`: expor `pode_operar` em `/contratacao/status` (o dado já é
calculado ali) permitiria uma frase exata em vez de uma frase prudente.

---

## S2 — Super Admin / Team / Permissões (`FINDINGS_FROZEN`, não corrigido)

| ID | Superfície | Classe | Sev. | Achado | Status |
|---|---|---|---|---|---|
| S2-LOW-01 | `PainelMotoristas`, `PainelTermosLGPD`, `Operacional`, `PainelAssinaturas`, `ModelosContrato` | `EXISTING_BUG` (risco) | LOW | Tabelas sem contêiner `overflow-x`. Risco de rolagem horizontal em 390px — **detectado estaticamente, não confirmado por medição**: essas telas não estão no pack visual | OPEN |
| S2-INFO-01 | Menu super-admin × rotas | — | — | **Sem achado.** Todos os itens apontam para rotas declaradas; nenhum destino repetido; nenhum item visível exigindo permissão ausente | — |
| S2-INFO-02 | `PainelAssinaturas` | — | — | **Sem achado.** Não é órfã: é a aba `?aba=assinaturas` de `PainelFinanceiro` | — |
| DEBT-101 | Rotas órfãs | `KNOWN_ACCEPTANCE_DEBT` | LOW | `visao-geral` e `relatorios` sem item de menu | OPEN |

---

## S3 — Núcleo operacional e formulários (`FINDINGS_FROZEN`, não corrigido)

| ID | Superfície | Classe | Sev. | Achado | Status |
|---|---|---|---|---|---|
| S3-INFO-01 | UX_FORM_001 | — | — | **Sem regressão.** `ModalFormulario` segue aplicado em `Motoristas`, `Usuarios` e `RedeParceiros`; nenhum retorno a formulário gigante | — |
| S3-LOW-01 | Telas operacionais | — | LOW | Nenhuma tela operacional está no pack visual: overflow, primeira dobra, estados vazios/erro/loading **não foram medidos** | OPEN |

---

## S4 — Portais externos (`FINDINGS_FROZEN`, não corrigido)

| ID | Superfície | Classe | Sev. | Achado | Status |
|---|---|---|---|---|---|
| S4-INFO-01 | Isolamento cross-portal | — | — | **Sem achado, e bem defendido.** Claim discriminante `token_kind` obrigatória verificada nos dois lados (`shipper_portal` × `partner_portal`), com testes de recusa cruzada já existentes em `partnerPortalAuthHttp.test.js` | — |
| S4-INFO-02 | Navegação do Portal do Embarcador | — | — | **Sem achado.** `Início` usa `end`; `Pedidos`/`Transportes`/`Documentos` são disjuntos. A classe do REG-001 não existe aqui | — |
| S4-LOW-01 | Portais | — | LOW | Nenhum estado visual dos portais foi medido (login, vazio, erro, mobile, convite expirado). Exigem fixtures de auth próprias | OPEN |

---

## Cobertura — o que este board sustenta e o que não

Sendo explícito, porque a rodada anterior foi cobrada justamente por isso:

- **S1 está coberto por comportamento medido**: personas, I/O por permissão, matriz
  semântica nas duas superfícies, navegação, e pack visual em 1440/1024/390 com
  isolamento de rede provado.
- **S2/S3/S4 foram auditados por leitura de código, matriz de rotas e varredura
  estática** — não por exercício visual estado a estado. Onde não medi, o achado
  está classificado como *risco* (`S2-LOW-01`) ou como *não medido*
  (`S3-LOW-01`, `S4-LOW-01`), nunca como "verificado e limpo".
- Os `INFO` são conclusões positivas que eu de fato verifiquei (isolamento de token,
  navegação dos portais, UX_FORM_001, coerência do menu super-admin).

Para converter os `LOW` de "não medido" em evidência, o caminho é estender o pack
visual com fixtures por domínio de auth — trabalho de S2/S3/S4, não deste PR.

---

## Segurança

`STABILIZATION_SECURITY_BLOCKER` = **nenhum**.

Procurei especificamente por tenant leak, auth bypass, aceitação de token
cross-portal, write indevido de dinheiro e corrupção de dados. O único achado da
família é o **S1-HIGH-03** (rota de Pix sem checagem de permissão) — que **não** é
tenant leak, **não** move dinheiro e tem alcançabilidade baixa. Está reportado
acima, com a correção pronta e a razão de não tê-la aplicado sem um teste do app.

---

## Produção

Somente leitura. `PRODUCTION_DDL=0`, `PRODUCTION_BUSINESS_WRITES=0`,
`PRODUCTION_EXTERNAL_CALLS_FROM_VISUAL_TESTS=0` (provado pela sentinela do pack, com
controle negativo), `ENV_CHANGED=false`, `MIGRATION_REQUIRED=false`.
