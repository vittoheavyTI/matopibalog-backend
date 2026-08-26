# Partner Network V1 — E3.6A (rede privada de parceiros)

> Fundação da rede privada: relacionamentos explícitos, fronteira Partner
> Lite / Partner Client, e compartilhamento de lacuna de capacidade de Campanha
> com resposta operacional. **Sem preço, sem adjudicação, sem marketplace.**

- `E36A_AUDIT_FROZEN=true`
- `BASE=main @ bd146840`
- `RBV9-INV-082` — permanece `IN_PROGRESS` até a migration ser aplicada

## 1. Auditoria delta (congelada)

| # | Pergunta | Resposta | Classe |
|---|---|---|---|
| A | Alguma tabela de parceiro/rede já existe? | **Não** — nem no código nem em produção (`partner%` = 0 tabelas) | `NEW` |
| B | As primitivas de identidade externa do Portal são generalizáveis? | **Sim, o padrão** — `token_hash` + `expires_at` + ativação única + índice parcial de pendência. Mas em tabelas próprias | `REUSE` (padrão) + `NEW` (tabelas) |
| C | Que `token_kind` existem hoje? | Um: `shipper_portal` | `EXTEND` |
| D | Como o `verifyToken` interno barra identidade externa? | Rejeita `token_kind` externo **antes** do `jwt.verify`, nos dois caminhos (SEC-1 ligado e legado) | `EXTEND` |
| E | Como o tenant deriva `empresa_id`? | De `usuarios.empresa_id`; `?empresa_id=` só para super-admin | — |
| F | Que serviço produz o `capacity_gap`? | **Ver §2 — não é o que o nome sugere** | `DEFERRED` |
| G | Como se resolve o plano aprovado atual? | `operation_campaigns.approved_plan_version_id` + `campaignProgressService` (que também dá `replan.status`) | `REUSE` |
| H | Que campos podem ser compartilhados? | Ver §6 | — |
| I | Existe autoridade canônica de preço/adjudicação? | **Não.** `PORTAL_QUOTE_PROPOSAL_V1B` está deferida pela mesma razão, e nenhuma decisão posterior mudou isso | `DEFERRED` |
| J | Que convenção de permissão/entitlement seguir? | `permissionRegistry` com `entitlementCodigo`; `funcionalidades`/`plano_funcionalidades`/`empresa_funcionalidades` | `EXTEND` |
| K | Que realtime pode ser reusado? | SSE em `routes/realtime.js` (interno). Externo fica em polling (§56) | `REUSE` + `DEFERRED` |
| L | Que primitivas de correlação/auditoria reusar? | `client_request_id` com índice único **parcial** (migration 018) e o padrão de evento append-only de `lancamento_eventos` (actor/source/reason/metadata/occurred_at) | `REUSE` |

### Sobre §58 e a correlação da E1.5

O prompt pede reusar `request_id` / `correlation_id` / `operation_id` /
`causation_id`. **Essas colunas não existem no schema.** O que existe e é
canônico é `client_request_id` (idempotência, índice único parcial) mais
`metadata jsonb` nos eventos. É isso que esta frente usa — reusar o que existe é
melhor que inventar quatro colunas que nada mais preenche.

## 2. `capacity_gap` — o achado da auditoria

O prompt (§22) manda usar o `capacity_gap` "já produzido pela stack
determinística". Auditando a produção desse valor:

```js
// campaignService.js — cenário do planejador
capacity_gap_quantity: hardExceptions
  ? sortedDemands.reduce((sum, d) => sum + Number(d.target_quantity || 0), 0)
  : 0,
```

Duas coisas erradas para o nosso uso:

1. **Não é o residual.** Se houver *qualquer* exceção `HARD_CONSTRAINT`, o valor
   é a soma de **todas** as demandas — não o que ficou sem cobertura. Uma
   campanha 90% planejada com um bloqueio devolveria 100% como "lacuna".
2. **Soma unidades diferentes.** `d.target_quantity` é somado cru, sem passar por
   `toKg`. Demandas em `ton` e `kg` viram um número só, sem significado.

Compartilhar isso com parceiros seria pedir capacidade para um número inventado.

**Este campo não é consumido por nenhuma superfície** (nem API, nem tela) — é um
metadado interno de cenário. Então não há regressão em não usá-lo, e esta frente
**não o altera**: mexer no planejador determinístico é outra frente, com outros
testes. Fica registrado como `CAMPAIGN_SCENARIO_CAPACITY_GAP_IMPRECISO`.

**A fonte usada aqui é `campaignProgressService`**, que tem a fórmula canônica
num lugar só:

- `remaining = max(0, target − completed)` — cancelado **não** abate a demanda,
  porque a carga do cliente continua precisando ser transportada;
- unidade preservada, com `compatible: false` para unidade fora do domínio de
  massa (não há conversão inventada);
- `known: false` distinto de zero — `UNKNOWN != ZERO` (§30);
- `replan.status`, que é o que torna a detecção de obsolescência possível (§31).

## 3. Fronteira: Lite vs Client

Uma organização parceira é **uma identidade lógica**, que opera de duas formas:

| | Partner Lite | Partner Client |
|---|---|---|
| Tenant Matopiba | não tem | tem o **próprio** |
| Identidade | externa, tabela própria **sem `empresa_id`** | `usuarios` do tenant dele |
| Autenticação | `token_kind='partner_portal'` | login normal do produto |
| Acesso ao tenant do solicitante | **nenhum** | **nenhum** |
| Frota/motoristas/histórico | não aplicável | ficam no tenant dele, sem duplicar |

O motivo de a identidade Lite **nunca** ser um `usuario` é concreto e foi o mesmo
que guiou a E3.5: `middlewares/tenant.js` deriva `req.empresa_id` de
`usuarios.empresa_id`. Inserir o parceiro ali lhe daria o tenant do solicitante
inteiro.

**Conversão Lite → Client** (§13) não é implementada nesta fatia, mas o schema a
permite sem reescrever histórico: a organização parceira ganha
`linked_empresa_id`, e todo o histórico (relacionamento, oportunidades,
respostas) aponta para a **organização**, não para a forma dela.

O vínculo com uma empresa Matopiba é **sempre explícito** — nunca por nome,
domínio de e-mail, telefone ou semelhança de CNPJ (§14).

## 4. Relacionamento privado

Ciclo: `INVITED → ACTIVE → SUSPENDED → REVOKED`.

O relacionamento é **do solicitante**: `partner_relationships(empresa_id,
partner_organization_id)`. A empresa A não enxerga a rede da empresa B, suas
relações, seus convites, suas oportunidades ou as respostas que recebeu.

Um parceiro convidado **não consegue enumerar os outros** convidados da mesma
oportunidade (§17) — cada destinatário lê apenas a própria linha de share.

**Revogação corta acesso imediatamente**: leitura de oportunidade, resposta nova
e revisão de resposta. O histórico permanece auditável.

## 5. Modelo de compartilhamento

O caminho feliz começa **dentro da Campanha** (§24): quando há lacuna residual
real, aparece a ação "Buscar capacidade na rede". O operador não redigita carga,
origem, destino, quantidade, unidade ou janela — tudo isso já existe.

O que se pede a mais é só o que não dá para derivar (§25): **quais parceiros**,
**prazo de resposta** e uma **mensagem opcional**.

## 6. O snapshot compartilhado

Uma oportunidade compartilhada é um **snapshot imutável**. Endpoints de parceiro
nunca fazem *read-through* no tenant do solicitante.

**Compartilhado:** descrição da carga, origem(ns), destino, quantidade ainda
necessária, unidade, janela de coleta/entrega, restrições operacionais
declaradas, prazo de resposta.

**Nunca compartilhado por padrão:** preço interno do frete, margem, dados
financeiros de motorista, premissas de combustível, estrutura de custo, os outros
parceiros, inventário de frota, dados pessoais de motorista, documentos privados,
permissões, lista de usuários, diagnósticos crus.

A procedência (campanha, versão do plano, item de demanda, versão do snapshot,
autor, `client_request_id`) é **persistida** para prova, mas **não vai** no
payload externo — o parceiro recebe um identificador opaco da oportunidade.

## 7. Obsolescência (§31/§32)

O snapshot é história e **não é reescrito**. Mas o share tem estado próprio:

| Estado | Significado |
|---|---|
| `CURRENT` | vale como pedido atual |
| `SUPERSEDED` | um share mais novo da mesma origem o substituiu |
| `WITHDRAWN` | o solicitante retirou |
| `STALE_SOURCE` | a campanha replanejou ou o residual mudou |

Antes de aceitar qualquer resposta, o servidor **revalida** o estado da fonte.
Uma oportunidade obsoleta não vira trabalho executável por acidente.

## 8. Resposta do parceiro

Permitido nesta fatia: `AVAILABLE`, `PARTIALLY_AVAILABLE`, `DECLINED`, com
`capacity_quantity`, janela de disponibilidade e nota opcional.

**Proibido:** preço, tarifa, R$/ton, R$/km, comissão, taxa, valor de acerto.

Revisão é **append-only**: cada envio cria uma revisão nova, e a resposta atual é
a projeção determinística da última. Nada é sobrescrito.

Validação no servidor: relacionamento ativo · destinatário confere · oportunidade
aberta e `CURRENT` · prazo · quantidade > 0 · quantidade ≤ lacuna compartilhada ·
**mesma unidade** · nenhum id estrangeiro.

## 9. Autorização

```
Interno:  ENTITLEMENT ∧ PERMISSÃO ∧ ESCOPO ∧ TENANT
Externo:  IDENTIDADE_EXTERNA ∧ RELACIONAMENTO_ATIVO ∧ SHARE_EXPLÍCITO ∧ ESTADO_DO_SHARE
```

Sem atalho por nome de papel (D-072).

Entitlement: `partner_network`, `DEFERRED_DEFAULT_DENY` — sem mapeamento
comercial de plano e **sem override de empresa em produção**.

Permissões: `partner_network.view`, `partner_network.manage`,
`partner_network.share` e `partner_network.respond`.

Baseline: Administrador e Gerente de Frota recebem as operacionais; **Operador é
`DEFAULT_DENY`** para gestão e compartilhamento, e a empresa pode delegar depois
por template editável. Nenhuma permissão financeira é concedida.

## 10. O que E3.6A **não** faz

Não declara vencedor · não aloca viagem · não cria frete · não cria vencedor de
Dispatch · não cria acerto com parceiro · não cria fatura, evento de billing,
evento fiscal ou evento de ERP · não constrói marketplace, busca pública de
transportadora, ranking, score ou preço.

`E36B_PRICE_AND_AWARD_PRODUCT_DECISION_GATE=PENDING`.
