# Team / User Provisioning — correção da aceitação visual do owner

> Corrige os achados congelados na revisão do owner sobre o modal de usuário
> (super-admin e empresa). Não reabre `RBV9-INV-110`, a coluna de permissões da
> lista, nem a arquitetura de permissões.

- `TEAM_VISUAL_EDIT_FINDINGS_FROZEN=true`
- `BASE=main @ db9cf64e`
- `MIGRATION_REQUIRED=false`

## 1. Decisões congeladas

| Chave | Valor |
|---|---|
| `TEAM_ACCOUNT_PICKER` | `TYPEAHEAD_ON_DEMAND` |
| `TEAM_PROFILE_PICKER` | `COLLAPSED_SELECTION` |
| `TEAM_ACCESS_OPTIONS` | `ALWAYS_VISIBLE` |
| `TEAM_ADDITIONAL_INFO` | `ALWAYS_VISIBLE` |
| `TEAM_SUPERADMIN_EDIT` | `REQUIRED` |
| `TEAM_CEP_STANDARD` | `MASK_PLUS_AUTOFILL` |

## 2. `TEAM-FUNC-02` — o administrador que não via nenhum perfil

Este era o achado grave, e a causa não era permissão.

**Reproduzido contra produção antes de corrigir.** Na Empresa Alfa, um
Administrador legítimo — com `users.manage`, template `administrador`, tudo certo —
via **apenas "Financeiro"** na lista de perfis atribuíveis. Numa empresa com plano
menor, veria **zero**, que é exatamente a tela que o owner reportou.

### A causa

A contenção comparava as permissões **cruas** do template alvo, lidas de
`permission_template_permissions`, contra o **efetivo** do ator. São grandezas
diferentes: o efetivo passa por um gate de entitlement que nega, antes de qualquer
template, toda chave cuja funcionalidade a empresa não contratou.

O plano da Empresa Alfa não inclui `operation_campaign` nem `estrutura_operacional`.
Logo o efetivo do Administrador **não** tem `campaign.*` — mas o template
Administrador, cru, **tem**. `contido()` dava falso, e o administrador não conseguia
atribuir nem o próprio perfil:

| Perfil | Chaves que bloqueavam | Resultado |
|---|---|---|
| Administrador | 9 (`campaign.*`, `estrutura_operacional.gerenciar`, `integracoes_erp.gerenciar`, `acesso_corporativo_sso.gerenciar`) | sumia |
| Gerente de Frota | 6 (`campaign.*`) | sumia |
| Operador | 3 (`campaign.view/create/plan`) | sumia |
| Financeiro | 0 | aparecia |

O efeito era invertido: **quanto menor o plano, menos time a empresa conseguia
montar.** Uma empresa em plano básico não conseguia criar nenhum usuário.

### A correção

Comparar efetivo com efetivo. As permissões do template alvo passam pelo mesmo gate
de entitlement antes da comparação:

```js
function filtrarPorEntitlement(permissoes, entitlements) { … }
```

Uma capacidade que a empresa não contratou não é "acesso a mais" que o ator estaria
concedendo — ela não existe para ninguém naquela empresa, e não pode pesar na
contenção.

Aplicado nos **dois** pontos de decisão: listagem e gravação. Se divergissem, a tela
ofereceria o que o servidor recusa.

### O que NÃO afrouxou

A contenção real continua valendo, e há teste para isso: um gerente com
`users.manage` continua **sem** poder conceder o perfil Administrador, porque
`permissions.manage` e `finance.*` não são gated por entitlement. O relaxamento vale
só para o que a empresa não contratou — nunca para o que o ator não tem.

O resumo exibido na tela também passou a refletir o efetivo: prometer "vai gerenciar
frota" para uma empresa sem o módulo de frota seria mentir na tela.

## 3. `TEAM-FUNC-01` — trocar o perfil de quem já existe

O campo de perfil na edição era somente-leitura, com o texto *"Para trocar o perfil,
use a tela de Perfis e Permissões"*.

O conselho estava errado: aquela tela edita **o que um perfil concede**, não troca o
perfil de uma pessoa. Não havia caminho nenhum na interface — e o endpoint canônico
já existia desde o `TEAM_USER_PROVISIONING_V1`, com contenção, invariante de último
administrador e revogação de sessão. Faltava a UI chamá-lo.

Agora a edição usa o mesmo seletor da criação e chama
`PUT /admin/usuarios/:id/perfil-acesso`. O ponteiro **nunca** é gravado pela tela
(§35). Quando a troca esbarra no último administrador, o `409` do servidor aparece
junto do campo, com o texto que o próprio servidor mandou.

## 4. `TEAM-FUNC-03` — o CEP que "às vezes não funcionava"

Havia duas cópias idênticas de `buscarCep` (Usuários e Motoristas) e uma terceira
variação no modal de edição do motorista, que buscava no `onBlur` enquanto a criação
buscava no `onChange`. Quatro superfícies, três comportamentos.

E havia um bug que explica o "às vezes":

```js
const masked = maskCEP(e.target.value);
setNewUser({ ...newUser, cep: masked });   // grava o CEP
buscarCep(masked);                          // async, com `newUser` do closure
```

Quando a busca voltava, gravava `{ ...newUser, endereco, bairro, cidade }` usando o
`newUser` capturado **antes** da digitação — e o CEP recém-digitado desaparecia do
campo. Não era instabilidade do ViaCEP: era estado obsoleto.

`components/CampoCepEndereco.tsx` resolve estruturalmente: o componente nunca monta
o objeto inteiro, entrega um **patch**, e o pai aplica com updater funcional. O que a
busca preenche não pode mais apagar o que a pessoa digitou.

Também ganhou o que faltava (§26): CEP inexistente e falha de rede agora **dizem** o
que aconteceu, mantendo os campos editáveis. Antes, um CEP inválido não produzia
sinal nenhum — a pessoa esperava um preenchimento que nunca vinha.

Número e complemento continuam sendo de quem conhece o endereço (§25).

## 5. `TEAM-VIS-01` — o seletor de conta

Era um `<select size={5}>` com todas as contas renderizadas permanentemente sob a
busca. Com 25 empresas já era uma parede; e a lista nunca fechava, então mesmo depois
de escolher a pessoa continuava olhando para as outras opções.

Agora: campo de busca compacto → resultados sob demanda → **fecha ao escolher** →
estado selecionado com "Alterar conta".

Uma nota sobre escala (§9): a lista de contas já vem carregada em memória, então o
filtro é local e **não** há requisição por tecla — um debounce aqui seria latência
sem ganho. O que se evita é *renderizar* centenas de linhas, e é isso que o corte por
`LIMITE_RESULTADOS` faz.

O deep-link com conta pré-selecionada (§10) continua funcionando: quando a conta vem
travada pelo fluxo, o campo aparece como leitura e a busca não abre.

## 6. `TEAM-VIS-02` — o seletor de perfil

Todos os perfis ficavam expandidos permanentemente. Agora é o padrão de qualquer
campo de escolha: mostra o selecionado, abre sob demanda, fecha ao escolher, com
"Alterar perfil". A busca interna só aparece acima de 6 perfis (§16) — uma caixa de
busca sobre quatro opções é ruído.

## 7. `TEAM-VIS-03` / `TEAM-VIS-04` — as seções recolhíveis

"Opções de acesso" e "Informações adicionais" nasciam **fechadas**. O efeito era que
a pessoa não via que existia senha temporária nem campo de endereço: precisava
adivinhar que havia um "Mostrar" para clicar.

A prop `recolhivel` foi **removida do componente**, não apenas dos usos — assim
ninguém a reintroduz por engano. Esconder campo atrás de um clique só se paga quando
o campo é raro; estes não são.

## 8. `TEAM-VIS-05` — o super-admin que não conseguia corrigir

"Dados do usuário" continua sendo um modo de leitura, mas agora tem a ação **Editar
usuário** no rodapé, para quem tem `users.manage`. É a diferença entre poder
corrigir o cadastro de um cliente e ter que explicar por telefone como ele se
corrige.

A edição do super-admin roda em contexto **explícito** da conta do usuário: as
chamadas levam `?empresa_id=` da empresa dele (§29/§49), nunca por pertencimento
acidental.

### Campos e limites

Editável: nome, telefone, status, foto, CEP/endereço e **perfil de acesso**.

**E-mail permanece somente-leitura**, e a razão é concreta (§32): `usuarios.email` é
espelho da identidade no Supabase Auth. Não existe hoje mutação canônica que troque
as duas coisas de forma atômica, e gravar só a tabela produziria um usuário que
aparece com um e-mail no painel e entra com outro — pior que não permitir.

**Conta vinculada é imutável** (§33). Mover alguém da empresa A para a B por este
modal levaria junto lançamentos, fretes e histórico; não é edição de cadastro, é
migração de dados.

## 9. `TEAM-FUNC-04` — encontrar o editor de permissões

A separação conceitual continua intacta (§44):

| Ação | Onde | Autoridade |
|---|---|---|
| Atribuir/trocar perfil de uma pessoa | modal de usuário | `users.manage` |
| Editar o que um perfil concede | Perfis e Permissões | `permissions.manage` |
| Ajustes individuais | Perfis e Permissões | `permissions.manage` |

O que faltava era descoberta. Junto do perfil selecionado aparece **"Editar
permissões do perfil"** — um link para a tela canônica, já apontando para o perfil e
a conta certos, exibido **só** para quem tem `permissions.manage`. Não é um segundo
editor (§53); é um ponteiro.

Exceção individual continua chamada de **"ajustes individuais de acesso"**, nunca de
"editar perfil" (§52).

## 10. Um formulário só (§4/§57)

Super-admin e empresa usam o **mesmo** componente. A única diferença é o campo de
conta: no contexto de empresa ele não existe, porque a empresa já é conhecida (§58).
Tudo depois da conta — perfil, seções, CEP, rodapé, validação — é idêntico.

`UX_FORM_001 = FREIGHT_MODAL_PATTERN_V1` preservado.

## 11. Trocar de conta invalida o perfil (§55/§56)

Se o super-admin escolhe a conta A, seleciona um perfil dela e depois troca para a
conta B, o perfil escolhido é **limpo** e a lista recarrega para a nova conta. Um
`template_id` estrangeiro nunca é submetido — e o servidor recusaria de qualquer
forma, tratando template de outra empresa como inexistente.

## 12. Acessibilidade que apareceu no caminho

Dois defeitos reais encontrados enquanto se escrevia os testes:

- o modal não era um `dialog` — nenhuma tecnologia assistiva sabia que havia um
  diálogo aberto. Agora tem `role="dialog"`, `aria-modal` e nome acessível;
- o campo "Conta vinculada" tinha rótulo sem `id` associado, então era anunciado
  como campo sem nome.

## 13. O que esta frente NÃO faz

- Não reabre `RBV9-INV-110` nem a decisão da coluna de permissões (`TEAM-UX-001`).
- Não altera a arquitetura de permissões, o registry ou os baselines.
- Não cria um segundo editor de permissões.
- Não permite editar e-mail nem mover usuário de empresa.
- Não toca no Portal do Embarcador: `RBV9-INV-081` segue `IMPL_NV`.
- Não inicia a E3.6.

## 14. Fecho em produção

| Item | Valor |
|---|---|
| PR | #486, `MERGE_SHA=5f4708f0c6ab66bcb87456c84da766812cf48a2c` |
| CI | 4/4 verdes na `main`; SEC-1 sem rerun |
| Frontend | bundle `index-iCm7Pmll.js` |
| Migration | nenhuma |
| Backend | 1969/1969 (eram 1965) |
| Web | 229/229 (eram 209) |

### Certificação read-only

`/health` 200. Contrato sem credencial em `401` nas rotas tocadas:
`/admin/perfis-acesso`, `PUT /admin/usuarios/:id/perfil-acesso`, `/admin/usuarios`
e `PUT /admin/usuarios/:id`.

Deploy do frontend verificado por inspeção do bundle — que é a prova útil, já que
`401` não distingue rota existente de inexistente: `Selecionar perfil de acesso`,
`Alterar perfil`, `Alterar conta`, `Editar permissões do perfil`, `CEP não
encontrado` e `Editar usuário` estão presentes; o gate `Ocultar` das seções não
aparece mais.

Banco inalterado: 38 usuários (0 criados hoje), 225 templates, 3725 permissões de
template, 8 overrides, 38/38 com ponteiro de template.

`PRODUCTION_USER_WRITES=0` · `PRODUCTION_PERMISSION_WRITES=0`

### Pacote visual

17 cenas em `team-correcoes-visual/`, cobrindo o fluxo do super-admin, o da
empresa, a edição com troca de perfil e o mobile 390×844. Medidas objetivas:
nenhuma cena com overflow horizontal, nenhuma com rodapé oculto, nenhuma com
modal maior que a tela; lista de contas aberta apenas na cena de busca e lista de
perfis apenas nas quatro cenas em que foi aberta de propósito.

`TEAM_OWNER_VISUAL_VALIDATION=PENDING_OWNER_FINAL_REVIEW`.

### Nota de método

Duas rodadas da suíte web acusaram falhas que não se reproduziram isoladas — eu
havia deixado o Playwright rodando em paralelo. Rodada sozinha: 229/229. Fica
registrado porque é o mesmo tipo de erro do `git stash` concorrente do fecho
anterior: paralelizar o que disputa recurso produz vermelho falso e custa
investigação à toa.
