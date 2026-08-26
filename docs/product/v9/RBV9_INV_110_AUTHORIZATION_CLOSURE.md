# `RBV9-INV-110` — fecho da autoridade legada `isAdmin` + `TEAM-UX-001`

> Delta de fechamento do `TEAM_USER_PROVISIONING_V1`. Fecha dois resíduos e não
> reabre a macrofrente.

- `RBV9_INV_110_AUDIT_FROZEN=true`
- `BASE=main @ 27d10039`
- `MIGRATION_REQUIRED=false` — nenhuma chave de permissão nova; tudo reusa o registry

## 1. O problema, dito com precisão

`isAdmin` verifica `req.user.role === 'admin'`. Desde o `TEAM_USER_PROVISIONING_V1`
(D-069), **todo usuário interno nasce com `tipo='admin'`** — Operador, Gerente e
Financeiro inclusive — porque o próprio `isAdmin` guardava rotas essenciais e
gravar outra classe criaria alguém que não abre nem o dashboard.

A consequência é direta: **`isAdmin` deixou de distinguir qualquer pessoa interna.**
Onde ele era a única autoridade, virou uma porta destrancada. Onde havia
`requirePermission` ao lado, virou ruído — e um `WRONG_DENY` esperando o dia em
que a classe de conta legada parar de ser universal.

Um perfil de acesso que não muda o que a pessoa consegue fazer não é um perfil de
acesso. Era isso que estava em jogo.

## 2. Inventário runtime

Contagem de **uso efetivo**, não de import. `contratacao.js` importava `isAdmin`
sem usar em nenhuma rota — import morto, removido.

### 2.1 `isAdmin` como middleware de rota

| Arquivo | Rotas | Cadeia anterior | Classe | Ação |
|---|---|---|---|---|
| `routes/painel-admin.js:62` | 52 | `verifyToken + isAdmin + isSuperAdmin` | **E** | `isAdmin` removido; `isSuperAdmin` é a autoridade |
| `routes/permissions.js:12` | 8 | `+ verificarEmpresa + requirePermission('permissions.manage')` | **A** | `isAdmin` removido |
| `routes/adminContratoModelos.js:9` | 7 | `verifyToken + isAdmin + isSuperAdmin` | **E** | `isAdmin` removido |
| `routes/adminTermos.js:11` | 6 | `verifyToken + isAdmin` (catálogo tem `isSuperAdmin` por rota) | 5×**E** + 1×**C** | ver §3.2 |
| `routes/relatorios.js:14,17,20,23` | 4 | `+ verificarEmpresa + verificarPlano + requirePermission('reports.*')` | **A** | `isAdmin` removido |
| `routes/dashboard.js:13` | 1 | `+ verificarEmpresa + verificarPlano + requirePermission('finance.operational.view')` | **A** | `isAdmin` removido |
| `routes/pagamentos.js:394` | 1 | `verifyToken + isAdmin + verificarEmpresa` | **C** | ver §3.3 |
| `routes/pagamentos.js:775` | 1 | `verifyToken + isAdmin + verificarEmpresa` | **C** | ver §3.4 |

`ISADMIN_RUNTIME_ROUTE_COUNT = 80` rotas, em **11 pontos de código**.

> Correção de registro: o documento do `TEAM_USER_PROVISIONING_V1` dizia "21 pontos
> de rota". Aquele número contava ocorrências textuais de `isAdmin` no repositório,
> não rotas guardadas. O número real de rotas é **80**; o de call sites de
> middleware é **11**. O documento anterior foi corrigido.

### 2.2 `role === 'admin'` inline como gate de acesso

Não aparecem numa busca por `isAdmin`, mas são a mesma autoridade legada.

| Local | Alcance | Classe | Ação |
|---|---|---|---|
| `controllers/lancamentoAcoesController.js:15` | 9 rotas dedicadas + 3 caminhos `PATCH` | **C — HIGH** | ver §3.1 |
| `routes/contratacao.js:66` (`permitirAssinaturaCliente`) | 16 rotas | **C** | ver §3.5 |
| `controllers/freteAcesso.js:14` (`ehAdmin`) | 3 ePOD + 1 ocorrências | **C** | ver §3.6 |
| `controllers/fretesController.js:465` (`corrigirFinanceiro`) | 1 | **A** | gate removido; rota já exige `finance.operational.manage` |
| `services/operationalScopeDomainService.js:181,182` | capability informativa | **A** | mantido — ver §5 |

### 2.3 Classificação consolidada

```
ISADMIN_REDUNDANT_COUNT        = 14 rotas + 2 gates internos   (A)
ISADMIN_WRONG_DENY_COUNT       = 0 em produção hoje            (B)
ISADMIN_WRONG_ALLOW_COUNT      = 6 superfícies                 (C)
ISADMIN_TRUE_INVARIANT_COUNT   = 0                             (D)
ISADMIN_SUPERADMIN_COUNT       = 64 rotas                      (E)
```

**Não existe `D`.** Nenhuma rota resultou num invariante de plataforma que
precisasse de "administrador da empresa" como conceito próprio: ou era capacidade
delegável, ou era super-admin. Isso é resultado da auditoria, não premissa — e a
ausência de `D` é o que permite fechar o item sem inventar uma permissão guarda-chuva.

`B = 0` merece leitura cuidadosa: **não** significa que os gates estavam certos.
Significa que hoje ninguém é negado porque **todo mundo interno carrega a classe
legada**. Cada `A` é um `WRONG_DENY` latente, que se materializaria no dia em que
`tipo` parasse de ser sempre `'admin'`. É por isso que remover o gate redundante
não é cosmético.

## 3. Os `WRONG_ALLOW`, um a um

### 3.1 HIGH — aprovar lançamento sem `launch.approve`

As rotas dedicadas já exigiam a chave certa:

```
POST /despesas/:id/aprovar   → requirePermission('launch.approve')
```

Mas o `PATCH /despesas/:id` é guardado por `launch.create` e, ao receber
`status: 'aprovado'`, **delegava para a mesma transição**, cujo único gate era
`role === 'admin'`.

Resultado: um **Operador** — que tem `launch.create` e **não** tem `launch.approve` —
aprovava, rejeitava e cancelava lançamentos, contornando a rota protegida. Vale para
despesas, abastecimentos e vales. Efeito financeiro real.

A correção põe a autoridade **na transição**, que é por onde os dois caminhos passam:

```js
const PERMISSAO_POR_STATUS = { aprovado: 'launch.approve', rejeitado: 'launch.reject', cancelado: 'launch.cancel' };
```

Sem entrada no mapa = negado por construção, em vez de cair num default permissivo.

Detalhe que obrigava cuidado: **o motorista tem `launch.create`**. Remover o gate
sem colocar a permissão certa o deixaria aprovar os próprios lançamentos. A troca
tinha de ser por chave, nunca por remoção.

### 3.2 Relatório de aceites de termos

`GET /admin-termos/empresas/:id/aceites` fazia `SELECT *` em `termos_aceites`, que
contém **`ip` e `user_agent` por usuário**. Com `isAdmin` no topo do router,
qualquer pessoa interna lia isso sobre todos os colegas.

Autoridade nova: **`users.view`** — é informação *sobre os usuários* da empresa, e o
Operador não tem essa chave no baseline. As rotas de catálogo continuam em
`isSuperAdmin`: termo é documento legal de plataforma.

### 3.3 Estado comercial da empresa

`GET /pagamentos/plano-status` expõe plano, situação e inadimplência.
Autoridade nova: **`finance.saas.view`** (baseline: Administrador e Financeiro).

**Mudança de comportamento consciente:** o resolver concede `finance.saas.view` ao
**dono de empresa autônoma** por dual-read legado, porque ele é o próprio dono e
sempre viu o financeiro da empresa. Com `isAdmin` ele era negado; agora passa. Não é
escalação — é a mesma informação que ele já obtinha em `/pagamentos/me/plano-status`,
que nunca teve `isAdmin`. Registrado aqui para não ser descoberto como surpresa.

### 3.4 HIGH — solicitar upgrade de plano

`POST /pagamentos/upgrade/solicitar` cria solicitação **+ cobrança + fatura**. Um
Operador podia comprometer a empresa financeiramente.

Autoridade nova: **`company.settings.manage`** — no baseline, só o Administrador.

### 3.5 Atos contratuais

`permitirAssinaturaCliente` guarda 16 rotas: iniciar contratação, aceitar contrato,
assinar, solicitar add-ons, cobrança de implantação. O gate era `role === 'admin'`,
então um Operador assinava em nome da empresa.

Autoridade nova: **`company.settings.manage`**, com a exceção do dono de autônoma
**preservada e agora explicada**: o cadastro self-service cria o usuário como
`tipo='motorista'`, e o template Motorista não concede — nem deve conceder —
capacidade administrativa; ele é o dono e precisa assinar o próprio contrato.
Motorista *vinculado* a uma transportadora não passa por nenhuma das duas portas.

### 3.6 Validar comprovação de entrega

`ehAdmin` guardava validar/rejeitar/aprovar evidência de ePOD e mudar status de
ocorrência. Autoridade nova: **`freight.manage`**.

Aqui o efeito prático é sutil e vale dizer com honestidade: Operador e Gerentes
**já tinham** `freight.manage`, então para os perfis baseline nada muda. O que muda é
que um **perfil customizado sem `freight.manage` deixa de passar só por ser interno** —
que é exatamente a promessa do modelo de perfis (§33).

## 4. O que **não** mudou

- **`isSuperAdmin` intocado.** Autoridade de plataforma continua separada e não foi
  enfraquecida em nenhum ponto.
- **`permissions.manage` intocado.** Remover `isAdmin` de `routes/permissions.js` não
  torna edição de template acessível a `users.manage` — a chave continua exigida.
- **Formato do token intocado.** `role` continua sendo emitido; o que caiu foi o uso
  dele como autoridade de produto. Redesenho de claim é outra frente (§27).
- **SEC-1 intocado.** Revogação de sessão segue o comportamento canônico.
- **Nenhuma permissão nova.** Todas as chaves usadas já existiam no registry.

### A classe de conta legada, onde permanece

`role === 'admin'` continua em usos que **não são autorização** — são discriminação
entre quem opera pelo painel e quem opera pelo app:

- `motorista_id` efetivo do lançamento (painel lança para outro; motorista lança para si);
- `status` inicial do lançamento (painel entra aprovado; motorista entra pendente);
- seleção de qual regra de *ownership* aplicar (empresa inteira vs. próprio registro);
- `billingProfile`, `trialV2Service`, filtros de escopo em `fretesController`.

Isso é o que o delta chama de `LEGACY_ACCOUNT_CLASS_CLEANUP` e fica como
`TECH_DEBT_NON_BLOCKING`: **nenhuma autorização sensível depende mais dele.**

## 5. Um caso que ficou como está, e por quê

`operationalScopeDomainService` deriva `can_manage_operational_structure` de
`role === 'admin'` no modo `LEGACY_COMPANY`. É **capability informativa** para a UI;
o servidor exige `estrutura_operacional.gerenciar` em `routes/operacional.js`, que o
P2.10 já havia limpado. Não há `WRONG_ALLOW`: quem vir o botão leva `403`.

Mantido porque corrigir aqui significa mexer no cálculo de escopo operacional — outro
domínio, com outro conjunto de testes — para resolver um botão que já não abre porta.
Registrado, não escondido.

## 6. `TEAM-UX-001` — chaves cruas fora da lista

A lista de equipe exibia `DASHBOARD`, `MOTORISTAS`, `RELATORIOS`, `CONFIGURACOES`:
chaves do campo legado `usuarios.permissoes`, em caixa alta.

Duas coisas erradas ao mesmo tempo. Primeiro, chave técnica não é informação de
usuário. Segundo — e pior — **aquilo nem descrevia o acesso real**: o efetivo vem de
template + overrides desde a migration 072, não daquele campo. A coluna mostrava um
dado obsoleto com aparência de autoridade.

`TEAM_UX_001 = REMOVE_RAW_PERMISSION_KEYS_FROM_NORMAL_LIST`.

A coluna foi **removida sem substituição** (§6): a informação de acesso da lista é o
**Perfil de acesso**, e uma segunda coluna decorativa seria pior que nenhuma. A tabela
foi de 6 para 5 colunas, o que também ajuda o layout estreito (§7) — sem introduzir
rolagem horizontal nova.

### O indicador de exceção

Quando a pessoa tem override individual, aparece **"2 ajustes de acesso"** (ou
"1 ajuste de acesso") logo abaixo do perfil — não em coluna própria, porque é um
**qualificador do perfil**, não um dado independente.

O backend passou a devolver `ajustes_de_acesso` numa consulta agregada, casando pelo
par `(usuário, empresa)` — o super-admin lista várias empresas e um override só conta
para o tenant a que pertence.

**Nenhuma chave aparece.** Saber que existe exceção é gestão de equipe; saber *qual*
chave foi ajustada é a tela de Perfis e Permissões, que exige `permissions.manage`.

### O detalhe continua acessível

No modal de edição, quando há ajustes, o texto informa quantos e leva à tela canônica
— link exibido **só para quem tem `permissions.manage`**, para não oferecer um caminho
que termina em acesso negado. **Nenhum segundo editor de permissões foi criado** (§5).

Vale registrar que nada foi perdido: a coluna antiga nunca mostrou os overrides reais.
O que saiu foi informação enganosa; o que entrou é a informação verdadeira, no lugar
com a autoridade certa.

## 7. As cinco perguntas de produto

| # | Pergunta | Antes | Agora |
|---|---|---|---|
| §62 | Operador passa em rota sensível só porque o token traz `role='admin'`? | **SIM** | **NÃO** |
| §63 | Gerente com permissão delegada é bloqueado por não ser Administrador? | NÃO | **NÃO** |
| §64 | Perfil customizado funciona pela capacidade, sem depender do nome? | parcialmente | **SIM** |
| §65 | A lista de equipe mostra chaves técnicas? | **SIM** | **NÃO** |
| §66 | Quem precisa entender exceções ainda consegue, sem poluir a listagem? | não havia | **SIM** |

## 8. Fecho em produção

| Item | Valor |
|---|---|
| PR | #484, `MERGE_SHA=a79a7c664a5814bee3ebfcf6429f9ffe47afcf76` |
| CI | 4/4 verdes na `main`; SEC-1 passou **sem rerun** |
| Deploy backend | Railway `72698a05` SUCCESS |
| Deploy frontend | bundle `index-8Hc3KmQ2.js` |
| Migration | nenhuma |
| Backend | 1965/1965 (eram 1950) |
| Web | 209/209 (eram 205) |

### Certificação read-only

Contrato sem credencial nas superfícies tocadas — todas `401`:
`/dashboard/summary`, `/relatorios/rentabilidade`, `/pagamentos/plano-status`,
`/pagamentos/upgrade/solicitar`, `/admin/permissions/templates`,
`/admin/perfis-acesso`, `/admin/termos/empresas/:id/aceites`, `/contratacao/status`,
`/fretes/:id/epod/aprovar-pendentes`, `/despesas/:id/aprovar` e `PATCH /despesas/:id`.

> Ressalva de método, a mesma do fecho anterior: **`401` não prova que a rota
> existe** — `verifyToken` roda antes do roteamento. A evidência de deploy veio do
> SHA do deployment no Railway e da inspeção do bundle publicado, onde a coluna
> `Permissões` não aparece mais e `ajustes de acesso` aparece.

Estado do banco, antes e depois:

| Medida | Valor |
|---|---|
| `usuarios` por tipo | 18 admin · 20 motorista (inalterado) |
| Usuários criados no período | **0** |
| `permission_templates` | 225 (inalterado) |
| `permission_template_permissions` | 3725 (inalterado) |
| `user_permission_overrides` | 8 (inalterado) |
| Ponteiro de template não nulo | 38 de 38 |
| `auth_sessions` | 64 → **66** |

As duas sessões novas **não são desta execução**: são logins web do próprio owner
(01:09 e 01:13 UTC de 2026-08-26, `client_type=web`). Nenhuma chamada desta
certificação foi autenticada — todas retornaram `401`. Registrado assim porque
`PRODUCTION_SESSION_WRITES=0` só é verdade sobre o que **este trabalho** fez, e a
contagem bruta da tabela mudaria de qualquer forma com o uso normal do sistema.

### Uma falha de CI que valeu a pena entender

`authorizationClosure.test.js` passava local (Node 24) e falhava no CI (Node 20).
A causa não era o teste: ele carregava `config/supabase` de verdade através de
`freteAcesso` e `requirePermission`, e `createClient` monta um `RealtimeClient` que,
**sem WebSocket nativo, lança na carga do módulo**. Node 24 tem WebSocket; Node 20
não. O dublê do cliente passou a valer para todo consumidor — que é o que já
deveria ser, já que nenhum destes testes deve tocar o banco. Verificado que
`@supabase/supabase-js` não é mais carregado, e o arquivo ficou 2x mais rápido.

A lição é a mesma que o fecho anterior registrou por outro caminho: **verde local
não é verde**. Aqui a diferença era a versão de runtime, não o cache.
