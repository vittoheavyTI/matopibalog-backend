# Arquitetura Operacional V8 - Handoff

Este documento nao substitui historico anterior. Ele registra o estado atual para
compor a futura Arquitetura Operacional V8.0.

## P1 Grupos / Filiais / Escopos

| Item | Estado |
| --- | --- |
| PR #419 | DEPLOYADO |
| Migration 067 | DEPLOYADO |
| Grupos empresariais | IMPLEMENTADO |
| Empresa-grupo | IMPLEMENTADO |
| Unidades operacionais | IMPLEMENTADO |
| Regioes operacionais | IMPLEMENTADO |
| Memberships local/regional/global | IMPLEMENTADO |
| Membership corporativo global | IMPLEMENTADO |
| RLS/FORCE/grants | CI VALIDADO / DEPLOYADO |
| Rollout legacy/configured/enforced | IMPLEMENTADO |
| Enforcement automatico | DESATIVADO POR SEGURANCA |
| Dados operacionais reais | PENDENTE DE GATE |

## Billing 3A-2

| Item | Estado |
| --- | --- |
| Migration 065 | DEPLOYADO |
| Migration 066 | DEPLOYADO |
| Outbox | IMPLEMENTADO / CI VALIDADO |
| Runner | IMPLEMENTADO / DESATIVADO POR SEGURANCA |
| Reconcile | IMPLEMENTADO / CI VALIDADO |
| Fake provider | CI VALIDADO |
| Sandbox provider | SANDBOX VALIDADO |
| Billing-health | IMPLEMENTADO |
| Trial preservado | CI VALIDADO |
| Implantacao/mensalidade separadas | CI VALIDADO |
| Create idempotency recovery | IMPLEMENTADO / CI VALIDADO |
| Response lost after commit | CI VALIDADO |
| Add-on mensal por composicao | IMPLEMENTADO / CI VALIDADO |
| Add-on sem aceite explicito | FAIL-CLOSED |
| Suspensao vs cancelamento | SEPARADO / CI VALIDADO |

## Asaas Production

| Item | Estado |
| --- | --- |
| Production provider | IMPLEMENTADO |
| Production gate cumulativo | IMPLEMENTADO / CI VALIDADO |
| User-Agent Asaas | IMPLEMENTADO |
| externalReference recovery | IMPLEMENTADO |
| Fonte canonica do segredo | IMPLEMENTADO (`ASAAS_API_KEY_ENV_ONLY`) |
| Allowlist production | IMPLEMENTADO |
| Billing runner production | DESATIVADO POR SEGURANCA |
| Asaas production secret | PENDENTE DE GATE |
| Customer production | PENDENTE DE GATE |
| Subscription production | PENDENTE DE GATE |
| Charge production | PENDENTE DE GATE |
| Webhook production | PLANEJADO |
| Final activation | PENDENTE DE GATE |

Hard stop atual:

`FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`

## Roadmap

1. Fechar go-live financeiro controlado com uma empresa piloto.
2. Observar production financeiro.
3. Proxima macrofrente estrutural: Frota e Documentos.

Frota e Documentos ainda nao deve ser implementada neste PR. Escopo futuro:
motorista, veiculo, implemento, composicao, documentos e vencimentos.
