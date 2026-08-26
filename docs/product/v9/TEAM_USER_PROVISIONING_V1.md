# Team / User Provisioning V1 (`USR-001`) + `UX_FORM_001`

> Documento de frente. Fecha a lacuna registrada como
> `USR-001 = PROVISIONAMENTO_DE_EQUIPE_INCOMPLETO` e congela o padrão de
> formulário `UX_FORM_001 = FREIGHT_MODAL_PATTERN_V1`.

- `MACROFRONT=TEAM_USER_PROVISIONING_V1`
- `MIGRATION_REQUIRED=false` — nenhuma tabela, RPC ou coluna nova
- `BASE=main @ 59227e61`

## 1. O problema, dito com precisão

A arquitetura de permissões estava pronta desde a migration 072: templates por
empresa, overrides individuais, resolver único, RPCs guardadas contra deixar a
empresa sem administrador. Nove perfis baseline eram provisionados para **cada**
empresa — Administrador, Operador, Gerente de Frota, Gerente de Filial, Regional,
Nacional, Financeiro, Embarcador, Motorista.

E, mesmo assim, a empresa só conseguia criar administradores.

A auditoria encontrou a lacuna em três camadas, e as três precisavam cair juntas:

**Na tela.** O campo chamava-se "Nível" e tinha exatamente uma opção:
`<option value="admin">Administrador</option>`.

**No controller.** `createUsuario` recusava explicitamente:
`tipo === 'operador'` → *"Operador ainda não possui permissões no painel. Crie um
administrador."* A mensagem estava desatualizada desde a 072.

**Na API de permissões.** Todas as rotas de `routes/permissions.js` — inclusive
`GET /templates`, que só lista — exigiam `permissions.manage`. Quem tinha apenas
`users.manage` não conseguia nem **ver** os perfis para escolher um. Mesmo que a
tela oferecesse o seletor, ele viria vazio para o gerente delegado.

O efeito em produção era mensurável: **18 administradores e 20 motoristas, zero
operadores e zero gerentes**, em 25 empresas com os templates provisionados.

## 2. A separação de autoridade

Ler um perfil para **atribuir** e editar o que ele **significa** são coisas
diferentes:

| Ação | Autoridade |
|---|---|
| Listar perfis atribuíveis (`GET /admin/perfis-acesso`) | `users.manage` |
| Criar usuário com um perfil | `users.manage` |
| Trocar o perfil de um usuário (`PUT /admin/usuarios/:id/perfil-acesso`) | `users.manage` |
| Editar o que um perfil concede | `permissions.manage` (intocado) |

`routes/permissions.js` não foi afrouxado: continua exigindo `permissions.manage`
para tudo o que faz.

## 3. Não-escalação de privilégio

Separar as autoridades abre uma porta: alguém com `users.manage` poderia se
promover criando um administrador. A regra de contenção é única e vale no
servidor, tanto na listagem quanto na gravação:

> um ator só pode atribuir um perfil cujas permissões efetivas estejam
> **contidas** nas dele.

Consequências, todas testadas:

- um gerente com `users.manage` **não vê e não consegue atribuir** o perfil
  Administrador, nem o Financeiro (não tem financeiro para delegar);
- ele **consegue** criar Operador, que é subconjunto do que ele tem;
- um administrador de verdade **continua podendo** delegar administração (§16) —
  o conjunto dele contém o do template Administrador;
- super-admin não passa pela contenção, mas segue obrigado a escolher a
  empresa-alvo explicitamente.

Deliberadamente não há lista de perfis "perigosos": uma regra que dependa de
enumerar exceções erra em silêncio no dia em que a empresa criar um perfil novo.

A lista chega ao cliente **já filtrada** — e é reconferida na gravação, porque
filtro de tela não é controle de acesso.

## 4. Atomicidade da criação

A atribuição do template era `try/catch` marcado como *não-fatal*, com o
argumento de que o resolver cai no baseline por `stable_key` quando o ponteiro é
nulo. Isso era verdade **enquanto o único perfil possível era Administrador**:
o baseline por `tipo='admin'` coincidia com a intenção.

Passando a existir Operador e Gerente, deixou de ser. Um assignment que falhasse
produziria silenciosamente um usuário com **mais** acesso do que o pretendido.

Agora a atribuição faz parte do sucesso: se falhar, a criação inteira é desfeita
(linha em `usuarios` e identidade no Auth) e a resposta diz que nenhum acesso foi
criado. Não existe usuário provisionado pela metade.

## 5. `usuarios.tipo` — o que ele significa agora

`tipo` **não é mais o papel da pessoa**. É a classe da conta, mantida por
compatibilidade, e todo usuário interno nasce com `tipo='admin'`.

Isso não é preguiça: o middleware `isAdmin` exige `role === 'admin'` e guarda
**80 rotas** (dashboard, fretes, relatórios, admin…) em 11 pontos de código. Gravar
`tipo='operador'` criaria alguém que não abre nem o dashboard, por mais correto
que fosse seu perfil — o rótulo legado venceria a permissão efetiva. Corrigir
isso exigiria reescrever a autorização dessas rotas, o que é outra frente.

Então: `tipo` = "conta interna, não motorista"; `permission_template_id` = o que
a pessoa pode fazer. É a leitura que o modelo P2 já pressupõe.

**Dívida registrada — já fechada:** `isAdmin` deveria ser "usuário interno" e não "role admin".
Enquanto não for, o ponteiro de template não pode ficar nulo — é exatamente por
isso que a atomicidade acima é obrigatória, e não uma melhoria.

## 6. Idempotência

Não havia proteção contra duplo envio. Agora um e-mail já existente na empresa
converge para o usuário existente quando o mesmo `client_request_id` é repetido,
e devolve `409` quando é um e-mail repetido sem esse marcador — que é erro do
operador, e é dito como tal. A verificação acontece **antes** de qualquer escrita.

## 7. Invariantes preservadas

Nada disto foi reescrito; tudo já existia e continua valendo:

| Invariante | Onde |
|---|---|
| Último administrador (troca de perfil) | RPC `atribuir_template_guardando_ultimo_admin` |
| Último administrador (status/dados) | RPC `atualizar_usuario_guardando_ultimo_admin` |
| Último administrador (exclusão) | RPC `excluir_usuario_guardando_ultimo_admin` |
| Último administrador (override) | RPC `set_user_override_guardando_governanca` |
| Revogação de sessão | `revogar_sessoes_usuario`, disparada em bloqueio, inativação e troca de perfil |
| Isolamento de tenant | `verificarEmpresa` + conferência do alvo antes de agir |
| Super-admin com empresa explícita | `req.impersonating` obrigatório na criação |

As RPCs são `SECURITY DEFINER` e serializam a mudança no banco — é o que faz duas
ações concorrentes contra os últimos administradores não deixarem a empresa com
zero.

## 8. Escopo operacional

Produção tem **0 grupos, 0 unidades e 0 memberships**: nenhuma empresa configurou
sub-organização. Forçar um seletor de escopo vazio seria inventar uma pergunta
sem resposta (§42). O modelo canônico (`usuario_operacional_memberships`,
`estrutura_operacional.gerenciar`) continua sendo a autoridade, e a atribuição de
escopo segue na tela de Estrutura Operacional, onde sempre esteve.

Quando houver empresa com unidades configuradas, o seletor entra no modal de
usuário — a decisão está registrada, não implementada às cegas.

## 9. `UX_FORM_001 = FREIGHT_MODAL_PATTERN_V1`

O modal de "Novo Frete" virou a referência de formulário do painel:

```
overlay   fixed inset-0 bg-black/60, centralizado
container rounded-2xl, max-h-[90vh], flex flex-col   ← o corpo rola, não a página
cabeçalho p-5 border-b, título com ícone + botão fechar
corpo     p-5 overflow-y-auto space-y-4
rodapé    p-5 bg-gray-50 border-t, Cancelar + ação primária   ← sempre visível
campos    label xs bold uppercase; input rounded-lg; grade de 2 colunas
```

Extraído para `components/ModalFormulario.tsx` e adotado por **Usuário** e
**Motorista**.

**O Frete não foi refatorado**, e isso é decisão, não omissão: o modal dele vive
dentro de um arquivo de mais de 2.000 linhas, entrelaçado com cálculo de valores,
autocomplete de motorista e regras financeiras. Extraí-lo para arrumar a tela de
cadastro de usuário significaria mexer no fluxo de receita da transportadora —
risco desproporcional. O shell reproduz o comportamento dele; a convergência dos
três fica como **limpeza técnica**, não dívida de produto.

### O que mudou no modal de Usuário

Primeira dobra: nome, e-mail, celular e **perfil de acesso** — a tarefa real.
Foto e endereço, que antes ocupavam o topo e o meio do formulário, viraram
"Informações adicionais", recolhido. Senha personalizada foi para "Opções de
acesso", também recolhido: o padrão é o sistema gerar a temporária e exibi-la
**uma única vez**, comportamento que já existia e foi preservado.

O seletor de perfil mostra nome, descrição e um resumo em linguagem de negócio
("Esta pessoa poderá: Fretes e operação"). Nenhuma chave de permissão aparece —
a matriz é outra tela e outra autoridade.

### O que mudou no modal de Motorista

Só o alinhamento visual (§70). Nenhum campo, limite de plano ou invariante de
aprovação/bloqueio foi tocado. O ganho concreto: o modal não tinha rolagem
interna nem rodapé fixo, então em tela pequena o botão de cadastrar sumia da
vista.

## 10. Vocabulário

A tela diz **Perfil de acesso**. Não diz "template", "nível", "tipo",
"override" nem `permission_key` (§5/§107). `NO_NEW_ORTHOGRAPHY_DEBT=true`.

## 11. Limpeza

`PainelUsuarios.tsx` era código órfão — não importado em lugar nenhum — e foi
removido. A tela de equipe canônica é `Usuarios.tsx`, servindo tanto a empresa
(`/admins`) quanto o super-admin (`/painel-administrativo/usuarios`), com a
autoridade decidida no servidor.

## 12. O que esta frente NÃO faz

- Não cria um segundo sistema de papéis (§4): a autoridade continua sendo
  `permission_templates`.
- Não altera o que os perfis baseline concedem.
- Não implementa atribuição de escopo no modal (ver §8).
- Não corrige `isAdmin` (ver §5) — registrado como dívida.
- Não altera o status do Portal do Embarcador: `RBV9-INV-081` segue `IMPL_NV` e
  `OWNER_VISUAL_VALIDATION` segue `PENDING`.

## 13. Fecho em produção

| Item | Valor |
|---|---|
| PR principal | #481, `MERGE_SHA=a4cc17182409aa8e585ec68153693909f2fd2ac9` |
| PR de correção | #482, `MERGE_SHA=4483c19836b540429fd32a2f8ccbad64fdf90b9d` |
| CI | 4/4 verdes nas duas vezes, SEC-1 incluído |
| Deploy backend | Railway `df37142c` SUCCESS; anterior removido |
| Deploy frontend | bundle `index-BwplJnBU.js` publicado |
| Migration | nenhuma |

### O defeito que a certificação pegou

Depois do deploy do #481, a conferência do bundle publicado mostrou que a string
`Nível` ainda existia na tela. A investigação achou um defeito **da própria
frente**: o backend passou a devolver `perfil_acesso_nome`, e o mapeamento da
lista nunca leu o campo. Como `tipo` agora vale `admin` para todo usuário interno,
a coluna derivava dele e chamaria de **Administrador até quem fosse Operador** —
exatamente a confusão que esta frente veio eliminar. O modal de visualização tinha
o mesmo problema em silêncio: `editingUser.perfilAcessoNome` era sempre
`undefined`.

Corrigido no #482: a coluna passou a se chamar **Perfil de acesso** e mostra o
perfil real, com fallback para a classe da conta (motorista, super-admin não têm
template). A cor do badge também vem do perfil — roxo é a cor de administrador e
não pode pintar um Operador só porque `tipo=admin`. Dois testes travam a
regressão, e o principal foi verificado contra a versão sem a correção: falha.

A lição é específica: **acrescentar um campo no backend não é entregar a
informação**. O gate que pegou isso não foi o teste nem o CI — foi conferir o
artefato publicado.

### Certificação read-only

Produção idêntica antes e depois, sem nenhuma escrita:

| Medida | Valor |
|---|---|
| `usuarios` por tipo | 18 admin · 20 motorista |
| Usuários criados no período | **0** |
| `permission_templates` | 225 (inalterado) |
| `permission_template_permissions` | 3725 (inalterado) |
| `user_permission_overrides` | 8 (inalterado) |
| `auth_sessions` | 64 (inalterado) |
| Memberships operacionais | 0 — confirma a decisão da §8 |
| Usuários com ponteiro de template | 38 de 38 — **nenhum nulo** |

O último número importa: enquanto `isAdmin` for role-based, um ponteiro nulo é
uma exposição real. Hoje não há nenhum.

Uma observação de método: testar as rotas novas sem credencial devolve `401`, mas
isso **não prova** que elas existem — `verifyToken` roda antes do roteamento, e uma
rota inexistente devolve `401` igual. A evidência de deploy veio do SHA do
deployment no Railway e da inspeção do bundle publicado.

### Achado registrado, não corrigido

A coluna **Permissões** da lista ainda exibe chaves cruas em caixa alta
(`DASHBOARD`, `MOTORISTAS`, `RELATORIOS`) vindas do campo legado `permissoes`.
É anterior a esta frente e agora fica ao lado da coluna de perfil, o que torna o
contraste visível. Não foi tocado porque decidir o que a coluna deve mostrar — as
permissões efetivas resolvidas? o resumo do perfil? nada? — é decisão de produto,
não limpeza. Registrado para o owner decidir.
