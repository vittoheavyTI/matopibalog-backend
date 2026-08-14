# P1 - Tenancy Impact Map

Base inicial da macrofrente: `e30e883965f3a75052b7469765da9657230a5566`.

## Autoridades separadas

- `empresa_id`: entidade legal, ownership e tenant legado.
- `grupo_id`: visao corporativa opcional entre empresas autorizadas.
- `unidade_operacional_id`: unidade/filial operacional apenas em `motoristas` e `fretes`.
- Objetos filhos de frete derivam escopo pelo frete; P1 nao duplica unidade em despesas, abastecimentos, vales, ePOD, ocorrencias ou tracking.

## Rollout seguro

`empresas.operational_scope_mode` controla a transicao:

- `legacy`: comportamento anterior, sem dependencia de tabelas P1.
- `configured`: unidades e memberships podem ser preparados; usuarios administrativos continuam sem lockout.
- `enforced`: memberships passam a ser autoridade operacional.

A primeira unidade muda a empresa de `legacy` para `configured`, mas nao bloqueia outros admins. Enforcement exige acao explicita e a RPC valida que admins ativos possuem membership.

## Modelo P1

- `grupos_empresariais`: agrupamento corporativo.
- `grupo_empresarial_empresas`: empresas pertencentes ao grupo; uma empresa nao fica ativa em dois grupos ao mesmo tempo.
- `unidades_operacionais`: filial/base/unidade dentro de uma empresa.
- `regioes_operacionais`: agrupamento de unidades dentro da mesma empresa.
- `regiao_operacional_unidades`: vinculo regiao-unidade com FK composta por empresa.
- `usuario_operacional_memberships`: LOCAL, REGIONAL ou GLOBAL por empresa; GLOBAL corporativo por grupo.
- `operational_scope_auditoria`: trilha append-only das mutacoes estruturais.

## Integridade no banco

- FKs compostas impedem membership empresa A apontar para unidade/regiao da empresa B.
- Regiao-unidade exige mesma empresa nos dois lados.
- Unidade/regiao com `grupo_id` exige vinculo empresa-grupo existente.
- Apenas uma unidade default ativa por empresa.
- Unicidade de memberships ativos cobre LOCAL, REGIONAL, GLOBAL empresa e GLOBAL grupo.

## Mutacoes atomicas

As operacoes sensiveis rodam por RPC transacional:

- criar/alterar grupo;
- vincular/arquivar empresa no grupo;
- criar/alterar unidade e default;
- criar/alterar regiao;
- definir unidades da regiao;
- criar/alterar/revogar membership;
- ativar enforcement.

Auditoria fica na mesma transacao. Erro significa rollback completo.

## Autoridade administrativa

- `PLATFORM_SUPER_ADMIN`: administra plataforma.
- `GLOBAL_COMPANY_ADMIN`: administra toda a empresa.
- `GLOBAL_CORPORATE_ADMIN`: administra empresas/unidades autorizadas do grupo.
- `REGIONAL_MANAGER`: delega apenas subconjunto da propria regiao.
- `LOCAL_MANAGER`: delega apenas a propria unidade.

Regra geral: `delegated_scope` deve ser subconjunto de `actor_effective_scope`. Usuario comum nao pode trocar `empresa_id` via query.

## Modulos tocados

| Area | Classificacao | Acao |
| --- | --- | --- |
| Fretes | Implementado | Filtro por escopo operacional e contexto visual; escrita deriva unidade autorizada. |
| Relatorios | Implementado | Rentabilidade, acerto, ficha de viagem e torre aplicam escopo operacional. |
| Motoristas | Preparado por schema | `unidade_operacional_id` e a origem operacional canonica do motorista. |
| Financeiro operacional | Derivado | Despesas, abastecimentos e vales continuam derivados do frete. Sem coluna duplicada em P1. |
| ePOD/Ocorrencias | Derivado | Escopo deriva do frete vinculado. Sem coluna duplicada em P1. |
| Tracking/SEC-1 | Intacto | Arquitetura SEC-1 nao foi alterada. Escopo de tracking segue por viagem/frete. |
| Billing/Asaas | Fora de escopo funcional | Billing permanece OFF; P1 nao ativa cobranca. |
| Contratos/3A | Fora de escopo funcional | Nenhuma alteracao de contrato, PR #415 ou #416. |

## Interfaces

- Backend `/operacional`.
- Painel web `Operacao`.
- Seletor de contexto operacional responsivo.
- Header `X-Operational-Unit-Id` e validacao server-side.
- `selected_unit_id` e `effective_filter_unit_ids` separados de `authorized_unit_ids`.

## Gates mantidos

- Sem DDL em producao nesta etapa.
- Sem ativar billing.
- Sem deploy automatico.
- Sem merge.
