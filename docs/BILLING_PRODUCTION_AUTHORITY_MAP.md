# Billing Production Authority Map

Estado: preparado para PR de go-live, Asaas production desligado.

| Componente | Autoridade atual | Sandbox/production | Pode escrever Asaas? | Quem inicia | Flag/trava | Legado/atual | Acao necessaria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/pagamentos/clientes` | `configuracoes.integracao_asaas` | sandbox-only | Sim, apenas sandbox | super-admin manual | `bloquearSeNaoSandbox` | legado | manter compatibilidade; nao usar para production |
| `/pagamentos/cobrancas` | `configuracoes.integracao_asaas` | sandbox-only | Sim, apenas sandbox | super-admin manual | `bloquearSeNaoSandbox` | legado | manter bloqueado em production |
| `/pagamentos/faturas-recorrentes/gerar` | `faturaRecorrenteService` | sandbox-only | Sim, apenas sandbox | super-admin manual | `bloquearSeNaoSandbox` | legado | nao usar como motor production |
| `/pagamentos/asaas-sync/processar` | `asaasSubscriptionService` | sandbox-only | Sim, apenas sandbox | super-admin manual | `bloquearSeNaoSandbox` | legado/sync | manter como sandbox/contingencia |
| `billing_outbox` | DB outbox 066 | agnostico | Nao, apenas fila | triggers/reconcile | `dedupe_key`/status | atual 3A-2 | motor canonico de eventos |
| `billingTriggers` | dominio comercial | agnostico | Nao | contrato/webhook/reconcile | dedupe por tipo/competencia | atual 3A-2 | manter unico ponto de entrada |
| `billingOutboxRunner` | runner 3A-2 | fake/sandbox/production gated | Indiretamente | Railway/manual | `BILLING_OUTBOX_ENABLED` | atual 3A-2 | production OFF ate gate final |
| `billingOrchestratorService` | plano canonico | fake/sandbox/production gated | Sim via provider | worker | `BILLING_PROVIDER_MODE` + gate | atual 3A-2 | autoridade canonica de cobranca |
| `FakeAsaasProvider` | memoria/testes | fake | Nao | testes/CI | provider_mode fake | atual 3A-2 | base de regressao |
| `AsaasSandboxProvider` | Asaas sandbox | sandbox | Sim sandbox | worker/sandbox E2E | host sandbox + env sandbox | atual 3A-2 | manter E2E sandbox |
| `AsaasProductionProvider` | Asaas production | production | Sim, somente gated | worker | gate cumulativo | atual go-live | usar apenas no gate final |
| `billingProductionGate` | env runtime | production | Decide se pode | orquestrador | outbox+provider+enabled+allowlist+secret | atual go-live | fail-closed |
| `billing-health` | painel admin | read-only | Nao | super-admin | auth admin | atual | expor estado sem segredo |
| `asaasWebhookService` | webhook Asaas | sandbox/production | Nao cria cobranca | Asaas | token webhook + idempotencia | atual | receber evento e convergir local |
| `billingReconcileJob` | safety net | agnostico | Nao direto | cron/manual | dedupe diario | atual 3A-2 | enfileirar, nao cobrar diretamente |
| `configuracoes.integracao_asaas.apiKey` | config historica | sandbox/legado | Sim em rotas sandbox | rotas antigas | sandbox gate | legado | nao e fonte production canonica |
| `ASAAS_API_KEY` | env protegida | production | Sim gated | provider production | gate cumulativo | atual go-live | inserir so no gate final |

Decisao: o unico motor production sera 3A-2 outbox/orquestrador/provider. Caminhos
legados permanecem bloqueados em production e nao devem criar cobranca real.
