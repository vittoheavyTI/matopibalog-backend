# Auditoria horizontal de regressões — V9 (2026-09-01)

**Macrofrente:** `V9_PRODUCT_REGRESSION_STABILIZATION`
**Base:** `origin/main` = `cb505ac47e1801565951c89bc2161d9238b74048`
**Branch:** `fix/v9-product-regression-stabilization`
**Roadmap:** `PAUSED_FOR_STABILIZATION` — nenhuma macrofrente funcional nova.
**PR #490 (ERP Hub):** `HOLD_DO_NOT_MERGE`, convertido para *draft*, código intocado.

---

## Por que esta frente existe

O owner viu, em produção, dois itens da Sidebar acesos ao mesmo tempo. Isso não é
um detalhe de cor: é o produto dando **duas respostas para "onde eu estou"**. E
passou por CI verde — o que diz algo mais incômodo que o bug em si: **nada, em
nenhuma suíte, exercitava a navegação renderizada como um contrato.** A auditoria
partiu do estado atual do produto, não do diff recente; o histórico do git serviu
só para atribuir cada achado depois de encontrado.

Escopo honesto do que foi feito e do que não foi, para o owner não presumir mais
cobertura do que existe:

| Superfície | Como foi auditada |
|---|---|
| Sidebar, active state, menu × rota × permissão | **Comportamental** — Sidebar renderizada por persona e por rota; matriz menu/rota extraída do `App.tsx` |
| Estado comercial (trial/plano/contrato/fatura) | **Comportamental** — matriz completa exercitada como função pura + pack visual com fixtures |
| Abas por query string, deep link, back/forward | **Comportamental** — vitest + Playwright |
| Layout/responsivo (1440/1024/390) | **Medido** — `scrollWidth <= clientWidth`, CTA dentro da viewport |
| Operação, Portal Embarcador, Super Admin | **Leitura de código + matriz de rotas.** Não houve varredura visual estado a estado — ver *Cobertura não atingida* |
| Backend/autorização | **Não alterado.** Continua a autoridade; usado como referência de verdade |

---

## Achados

`AUDIT_FINDINGS_FROZEN=true`

| ID | Superfície | Classificação | Severidade | Reprodução | Esperado | Real | Causa raiz | Origem | Lacuna de teste | Correção |
|---|---|---|---|---|---|---|---|---|---|---|
| **REG-001** | Sidebar / Financeiro | `REGRESSION` | **BLOCKER** | Logar como admin com contrato obrigatório pendente e abrir `/minhas-faturas?aba=contratacao` | Um item de navegação ativo | **Dois** itens verdes: "Faturas / Regularização" e "Contratação" | Dois `NavLink` para o **mesmo pathname** (`/minhas-faturas`); o `isActive` do react-router compara pathname e **ignora a query string**. Somado a isso, duplicidade de arquitetura de informação: Faturas/Regularização já é o hub que contém "Plano e contratação" | `e9727d2` (2026-08-17, reorganização da sidebar) | Nenhum teste renderizava a Sidebar. `Sidebar.test.tsx` não existia | Entrada financeira **única** com badge condicional; item "Contratação" removido |
| **BUG-002** | Contratação / autoridade de UI | `EXISTING_BUG` | **MEDIUM** | Código: `useContratacaoStatus` gateava por `role === 'admin'`; a "salvaguarda" da Sidebar exigia `role !== 'admin'` | Autoridade de UI espelhando a do backend; nenhum ramo inalcançável | Gate de frontend com critério **próprio**, e um bloco de UI **provadamente morto** | O hook filtrava por `role === 'admin'` — critério legado, diferente do backend, que libera `/contratacao/status` para `company.settings.manage` **ou** empresa `tipo='autonomo'`. Como `pendenciaObrigatoria` só era buscado para `role === 'admin'`, a salvaguarda da Sidebar (`role !== 'admin' && contratacaoPendente`) **nunca podia renderizar** | `c4ea452` (2026-08-02) | Hook sem teste; a salvaguarda nunca foi exercitada | Hook consulta para todo não-super-admin e deixa o **servidor** decidir (403 → estado neutro); bloco morto removido |
| **BUG-005** | Faturas / copy comercial | `EXISTING_BUG` | **HIGH** | Plano `ativo` + contrato obrigatório pendente | Dizer que o plano está ativo **e** que a operação segue restrita | "Plano ativo — Seu plano está ativo." enquanto a mesma tela pedia assinatura e o backend bloqueava as escritas | A matriz comercial era um IIFE dentro do `render`: impossível de exercitar, e tratava `status` como se fosse a única dimensão. **Plano ativo** e **uso operacional liberado** eram tratados como a mesma coisa | `384879a` (2026-07-04); virou contraditório com `c4ea452` | Matriz comercial sem nenhum teste | Matriz extraída para `utils/planoStatusCopy.ts` (função pura) com `operacaoLiberada` explícito; copy diz as duas coisas |
| **BUG-003** | Rotas × menu | `EXISTING_BUG` | **MEDIUM** | Sem `campaign.view`, abrir `/campanhas-escoamento` pela URL | "Acesso restrito" honesto | Tela renderizava vazia (backend nega os dados) | Menu escondia por permissão, mas a **rota não tinha `PermissionRoute`**. Mesma assimetria em `/relatorios/torre-controle` | `28fd339` e equivalentes | Nenhum teste cruzava menu com rota | `PermissionRoute` adicionado às duas, com a **mesma** permissão do item de menu |
| **BUG-004** | Configurações / abas | `EXISTING_BUG` | **MEDIUM** | Entrar em `/configuracoes?aba=perfil` pelo menu do usuário e clicar em Voltar | Voltar sai da aba "Meu perfil" | URL volta para `/configuracoes`, mas a aba **continua** em "Meu perfil" — Voltar parece não fazer nada | A query string era lida só numa direção (efeito que só tratava `aba === 'perfil'`), e trocar de aba não atualizava a URL | anterior a esta frente | Página sem teste de abas | Sincronização nos dois sentidos: a URL é a fonte da verdade e trocar de aba atualiza o histórico |
| **DEBT-101** | Rotas órfãs (super-admin) | `KNOWN_ACCEPTANCE_DEBT` | LOW | `/painel-administrativo/visao-geral` e `/painel-administrativo/relatorios` existem e não têm item de menu | — | Alcançáveis só por URL direta | Páginas preservadas por compatibilidade quando o menu foi reorganizado | `e9727d2` | — | **Não corrigido**: remover rota é decisão de produto, não de estabilização. Registrado |
| **DEC-201** | Guarda de `/minhas-faturas` | `PRODUCT_DECISION_NEEDED` | — | — | — | — | Ver abaixo | — | — | Deliberadamente **não** guardada |

### DEC-201 — por que `/minhas-faturas` NÃO recebeu `PermissionRoute`

Era o passo "óbvio" depois do BUG-003, e teria criado um beco sem saída novo.

O item de menu é gateado por `finance.saas.view`. Guardar a rota com a mesma
permissão pareceria simétrico — mas o **CTA do banner global** aponta para
`/minhas-faturas?aba=contratacao`, e quem chega por ali pode ser exatamente quem
**não** tem `finance.saas.view`.

Quão real é esse usuário, sendo preciso: pelos *templates* do baseline,
`finance.saas.view` acompanha Administrador e Financeiro, então o caso não aparece
na configuração padrão. Ele é alcançável por **override individual** — remover
`finance.saas.view` de um administrador que mantém `company.settings.manage`. É
raro, não impossível; e o custo de errar é assimétrico: guardar a rota faria o
único caminho de assinatura desse usuário terminar em "Acesso restrito", trocando
um bug de coerência por um bloqueio comercial real.

O dono de conta autônoma não cai nesse caso: o resolver concede
`finance.saas.view` a ele por bypass legado (`permissionResolver.js`).

Fica registrado como decisão explícita, não como omissão.

---

## REG-001 — decisão de produto aplicada

`FINANCIAL_SIDEBAR_SINGLE_ENTRY = true`

- A Sidebar tem **um** item financeiro: **Faturas / Regularização**.
- Com contrato obrigatório pendente, **o mesmo item** ganha indicador âmbar e o
  selo "Ação necessária". Sinalização virou **propriedade do item**, não item novo
  — o padrão vale para qualquer item futuro, não só este.
- O CTA específico de assinatura continua levando a `/minhas-faturas?aba=contratacao`
  a partir do banner global e dos cards. A aba é derivada da URL, então deep link,
  reload e Voltar/Avançar funcionam.

### Exceção de acesso (§5)

Auditada — e aqui uma **correção da minha própria leitura inicial**, porque ela
mudava a gravidade do achado.

Eu havia classificado o BUG-002 como HIGH descrevendo um dono de conta autônoma
(`tipo='motorista'`) obrigado a assinar e sem caminho para assinar. Ao montar as
fixtures do pack visual descobri que `role` vem de `/auth/me.tipo` e que o
**`ProtectedRoute` já barra todo `role !== 'admin'`** antes de qualquer tela do
painel. Ou seja: esse usuário não chega à Sidebar nem ao banner — ele usa o app,
não o painel web. O cenário de "beco sem saída" que eu descrevi **não existe no
painel web**, e a salvaguarda da Sidebar era inalcançável por essa razão também.

O que resta é real, mas menor: um gate de UI com **autoridade própria**, diferente
da do servidor, e um bloco de código **morto**. Reclassificado para MEDIUM.

Matriz efetiva de quem pode assinar, dentro de quem alcança o painel web
(`role === 'admin'`):

| Situação | Caminho para assinar |
|---|---|
| Tem `finance.saas.view` (Administrador, Financeiro, autônomo dono) | Item **Faturas / Regularização** com badge |
| Não tem `finance.saas.view`, mas o backend permite contratar | **Banner global** do Layout, com CTA "Assinar contrato" |
| Não tem nem um nem outro | Backend nega; não há ação a oferecer |

Nenhum fallback novo foi criado, e nenhum segundo item de menu — a preferência do
owner em §5 foi seguida.

## Matriz de estado comercial

Exercitada como função pura (`utils/planoStatusCopy.ts`) e no pack visual com
fixtures. Nenhuma cobrança, nenhum Asaas, nenhuma escrita.

| trial | plano | contrato obrigatório | Título | Tom | `operacaoLiberada` |
|---|---|---|---|---|---|
| — | ativo | não | Plano ativo | ok | **true** |
| — | ativo | **pendente** | Plano ativo — assinatura do contrato pendente | atenção | **false** |
| ativo | trial | não | Período de teste | neutro | **true** |
| ativo | trial | **pendente** | Período de teste — assinatura do contrato pendente | atenção | **false** |
| expirado | trial | qualquer | Período de teste expirado | crítico | **false** |
| — | suspenso | — | Conta suspensa (com/sem link de pagamento) | crítico | **false** |
| — | expirado/bloqueado | — | Plano expirado / bloqueado | crítico | **false** |
| — | desconhecido | — | Status do plano | neutro | **false** (não inventa liberação) |

Invariantes provadas: contrato obrigatório pendente **nunca** convive com
`operacaoLiberada`; operação liberada implica tom não-alarmante; nenhuma combinação
alcançável fica sem copy; status desconhecido não inventa liberação.

---

## Dívida conhecida — reconferida

| ID | Estado | Observação |
|---|---|---|
| STAB-001 Fleet burden | `UNCHANGED` | Não tocado |
| STAB-002 Route standalone UX | `UNCHANGED` | Não tocado |
| STAB-003 searchable company selector | `UNCHANGED` | Não tocado |
| STAB-004 Billing vs Financeiro | `UNCHANGED` | Dois itens no menu super-admin, rotas distintas, sem colisão de active state |
| STAB-005 Acerto driver-centered | `UNCHANGED` | Não tocado |
| STAB-006 legacy pt-BR sweep | `UNCHANGED` | Toda string tocada nesta frente saiu em pt-BR correto; nenhum sweep de legado |
| FIN-001 company Financeiro | `UNCHANGED` | Não tocado |

Nenhuma piorou; nenhuma virou bloqueante.

---

## Cobertura não atingida (dito explicitamente)

Para o owner calibrar a revisão, o que **não** foi coberto nesta passagem:

- **Portal do Embarcador e Portal do Parceiro**: não entraram no pack visual. Rodam
  em shells próprios (`/portal/embarcador/*`, `/portal/parceiro/*`) com autenticação
  distinta, e montar fixtures para eles seria uma frente por si.
- **Super Admin**: matriz de rotas conferida; estados visuais não varridos.
- **Operação (Fretes, Campanhas, Orchestrator, Dispatch, Rota, Frota)**: navegação e
  permissões conferidas; formulários e estados internos não varridos visualmente.
- **UX_FORM_001 (padrão de modal de frete/usuário)**: inspecionado por leitura, sem
  regressão aparente; **não** exercitado por teste nesta frente.

Isso não é um pedido de mais escopo agora — é a fronteira honesta do que a evidência
desta frente sustenta.

---

## `PRODUCT_REGRESSION_GATE_V1` (proposta)

REG-001 passou por CI verde. O gate abaixo existe para que essa classe não volte a
passar. É deliberadamente pequeno: cada item é condicional ao que o PR toca, para
não virar imposto sobre PR que não mexe em UI.

| Disparo | Exigência | Já existe? |
|---|---|---|
| PR muda navegação (Sidebar/rotas) | Matriz menu × rota × permissão verde (`NavegacaoMatriz.test.tsx`) | ✅ criado aqui |
| PR muda navegação | `ONE_PRIMARY_NAV_ITEM_ACTIVE` — nenhuma rota acende dois itens | ✅ criado aqui |
| PR muda navegação | Nenhum destino de menu repetido, nem por pathname | ✅ criado aqui |
| PR muda UI | Pack visual em **1440 e 390** com `scrollWidth <= clientWidth` | ✅ criado aqui |
| PR muda UI | CTA primário visível e dentro da viewport | ✅ criado aqui |
| PR muda menu | Teste por persona (permissão efetiva, **não** `role`) | ✅ criado aqui |
| PR muda estado comercial | Matriz semântica: nenhum estado que bloqueia a operação se comunica como liberado | ✅ criado aqui |
| Sempre | Suíte completa backend + web | já existia |

Regras de conduta que o gate assume:

1. **Autoridade de UI espelha o backend.** Um gate de frontend que usa critério
   diferente do servidor é um bug esperando acontecer — foi exatamente o BUG-002.
2. **Esconder no menu não é autorizar.** Se o menu esconde por permissão, a rota
   guarda pela **mesma** permissão — salvo decisão registrada, como a DEC-201.
3. **Validação visual do owner continua separada.** O gate mede o que é mensurável;
   não substitui o olho do owner.

---

## Produção

Somente leitura. `PRODUCTION_DDL=0`, `PRODUCTION_BUSINESS_WRITES=0`,
`ENV_CHANGED=false`, `MIGRATION_REQUIRED=false`. Nenhum deploy.
