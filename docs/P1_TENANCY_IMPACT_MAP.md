# P1 - Tenancy Impact Map

Base auditada: `e30e883965f3a75052b7469765da9657230a5566`.

## Estado anterior

- `empresa_id` era a unica autoridade horizontal para tenant, entidade legal, filtros operacionais e relatorios.
- `backend/middlewares/tenant.js` resolvia o tenant do usuario por `usuarios.empresa_id`; super-admin podia impersonar via `empresa_id`.
- Nao havia modelo produtivo de grupos empresariais, filiais ou unidades operacionais.
- As migrations produtivas aplicadas terminavam em `066_billing_outbox`; a proxima migration livre e `067`.

## Modelo P1

- `grupos_empresariais`: agrupamento opcional entre empresas.
- `grupo_empresarial_empresas`: vinculo empresa-grupo sem substituir `empresa_id`.
- `unidades_operacionais`: unidade/filial operacional dentro da empresa.
- `regioes_operacionais`: agrupamento operacional de unidades.
- `usuario_operacional_memberships`: escopo LOCAL, REGIONAL ou GLOBAL por usuario.
- `operational_scope_auditoria`: trilha de alteracoes sensiveis.

O modelo e aditivo. Nenhuma tabela existente perde `empresa_id`.

## Regra de compatibilidade

- Empresa sem unidade ativa continua em modo `LEGACY_COMPANY`.
- Linhas antigas com `unidade_operacional_id = null` permanecem validas.
- Ao criar a primeira unidade, ela vira `is_default = true`.
- Escopo de unidade padrao pode incluir linhas legadas sem unidade.
- Empresa com unidades ativas e usuario sem membership entra em `NO_ACCESS`.

## Modulos tocados

| Area | Classificacao | Acao |
| --- | --- | --- |
| Fretes | Implementado | Filtro por escopo operacional em listagem, detalhe e operacoes administrativas; escrita deriva unidade autorizada. |
| Relatorios | Implementado | Rentabilidade, acerto, ficha de viagem e torre aplicam escopo operacional. |
| Motoristas | Preparado por schema | Migration adiciona `unidade_operacional_id`; fluxo funcional nao foi alterado alem da derivacao em fretes. |
| Financeiro operacional | Preparado por schema | Tabelas de despesas, abastecimentos e vales recebem `unidade_operacional_id` quando existirem. |
| Tracking | Preparado por schema | Tabelas de localizacao recebem `unidade_operacional_id`; SEC-1 permanece sem alteracao funcional. |
| Billing/Asaas | Fora de escopo funcional | Billing permanece OFF; P1 nao ativa cobranca. |
| Contratos/3A | Fora de escopo funcional | Nenhuma alteracao de contrato, PR #415 ou #416. |

## Interfaces

- Nova rota backend `/operacional`.
- Nova tela web `Operacao`.
- Novo seletor de contexto operacional no cabecalho.
- O seletor envia `X-Operational-Unit-Id`; o backend valida contra o membership efetivo.

## Gates mantidos

- Sem DDL em producao nesta etapa.
- Sem ativar billing.
- Sem deploy automatico.
- Sem mexer em migrations 064, 065 ou 066.
