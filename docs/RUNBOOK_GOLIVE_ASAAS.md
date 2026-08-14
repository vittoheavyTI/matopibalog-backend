# Runbook - Go-live Financeiro / Asaas Production

Estado deste runbook: arquitetura preparada, Asaas production desligado.

Este documento substitui o runbook historico de 22/07/2026 para o caminho 3A-2.
Ele nao autoriza dinheiro real. O proximo gate unico e:

`FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`

## Autoridade Canonica

O motor canonico de cobranca nova e:

`billing_outbox -> billingOutboxRunner -> billingOutboxWorker -> billingOrchestratorService -> provider`

Rotas legadas de `/pagamentos` permanecem como compatibilidade/sandbox e continuam
bloqueadas por `bloquearSeNaoSandbox`. Elas nao sao o motor de production.

## Fonte Canonica da Credencial

`PRODUCTION_SECRET_AUTHORITY = ASAAS_API_KEY_ENV_ONLY`

A chave production deve existir somente em variavel protegida do runtime. A chave
legada em `configuracoes.dados.integracao_asaas.apiKey` segue existindo para o
mundo sandbox/legado, mas nao e autoridade para o provider production 3A-2.

Nunca copiar, imprimir ou commitar chave production.

## Gate Cumulativo

Production write so pode acontecer quando todos forem verdadeiros:

- `BILLING_OUTBOX_ENABLED=true`
- `BILLING_PROVIDER_MODE=asaas_production`
- `BILLING_PRODUCTION_ENABLED=true`
- `BILLING_PRODUCTION_ALLOWLIST` contem o UUID da empresa piloto
- `ASAAS_API_KEY` esta presente no runtime
- a operacao e elegivel pelo orquestrador 3A-2

Qualquer item ausente ou invalido resulta em fail-closed.

Estados exibidos em billing-health:

- `PRODUCTION_DISABLED`: default seguro, sem production armado
- `SANDBOX`: provider sandbox configurado
- `PRODUCTION_BLOCKED`: modo production pedido, mas falta trava/secret/allowlist
- `PRODUCTION_ARMED`: production configurado, mas runner OFF
- `PRODUCTION_ACTIVE`: todas as travas ativas

## Allowlist

`BILLING_PRODUCTION_ALLOWLIST` recebe UUIDs de empresas separados por virgula.

Allowlist vazia significa zero write Asaas production. Empresa fora da allowlist
tambem significa zero write.

Primeiro go-live deve conter uma unica empresa piloto.

## Runner

`RUNNER_ENTRYPOINT = backend/scripts/billing/outbox_runner.mjs`

`RUNNER_HOST = Railway cron/service dedicado ou execucao one-shot operacional`

`RUNNER_DEFAULT_STATE = OFF`

`RUNNER_KILL_SWITCH = BILLING_OUTBOX_ENABLED=false`

Nao deixar runner legado e runner 3A-2 criando cobrancas ao mesmo tempo. O caminho
canonico e o outbox; os caminhos legados seguem sandbox-only.

## Reconcile

`backend/scripts/billing/reconcile_periodico.mjs`

O reconcile periodico enfileira eventos idempotentes de `reconciliacao`; ele nao
chama Asaas diretamente. O runner do outbox processa a convergencia.

Cadencia inicial recomendada para production: manual/one-shot no primeiro pagamento.
Automacao periodica so apos observacao do piloto.

## Webhook Production

URL:

`https://api.matopibalog.com.br/pagamentos/webhook/asaas`

Autenticacao:

header `asaas-access-token` igual a `ASAAS_WEBHOOK_TOKEN`.

Eventos minimos:

- `PAYMENT_CREATED`
- `PAYMENT_RECEIVED`
- `PAYMENT_CONFIRMED`
- `PAYMENT_OVERDUE`
- `PAYMENT_DELETED`
- `PAYMENT_REFUNDED`

O webhook e idempotente por `asaas_webhook_events` e hash canonico. Eventos
duplicados, replay e out-of-order devem convergir sem marcar pagamento falso.

Nao registrar secret production neste PR.

## Trial

Trial e respeitado integralmente.

Mesmo com contrato, customer, assinatura ou pagamento, mensalidade nao pode vencer
antes de `trial_ends_at`. Pagamento nao encurta trial.

## Implantacao e Mensalidade

Implantacao e mensalidade sao separadas:

- implantacao R$ 0 nao cria cobranca ficticia
- valor vem de snapshot/catalogo comercial vigente
- contrato historico nao e recalculado
- `BILLING_IMPLANTACAO_TIMING` controla quando cobrar implantacao

## Primeiro Pagamento Controlado

Somente no `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`:

1. escolher uma empresa piloto e confirmar UUID;
2. conferir `billing-health.ok`;
3. inserir `ASAAS_API_KEY` production no runtime protegido;
4. configurar allowlist com somente a empresa piloto;
5. ligar `BILLING_PRODUCTION_ENABLED=true`;
6. ligar `BILLING_PROVIDER_MODE=asaas_production`;
7. ligar runner de forma controlada;
8. processar um unico evento;
9. observar customer/subscription/charge, webhook e reconcile;
10. desligar imediatamente se qualquer sinal sair do esperado.

## Rollback / Kill Switch

Ordem de desligamento:

1. `BILLING_OUTBOX_ENABLED=false`
2. `BILLING_PRODUCTION_ENABLED=false`
3. remover empresa da `BILLING_PRODUCTION_ALLOWLIST`
4. voltar `BILLING_PROVIDER_MODE=fake` ou remover a variavel
5. manter registros locais para auditoria

Cobranças reais ja criadas devem ser tratadas no painel/API Asaas por autorizacao
financeira especifica.

## Incidente

Em caso de erro:

- nao apagar faturas;
- nao apagar outbox;
- congelar runner;
- coletar billing-health;
- reconciliar estado local x Asaas;
- registrar decisao operacional antes de qualquer cancelamento/estorno real.

## Estado Atual

`PAYMENT_PRODUCTION_READINESS = ENGINEERING_READY_FOR_PRODUCTION_GATE`

`PRODUCTION_ASAAS_WRITES = 0`

`PRODUCTION_BILLING_RUNNER_ENABLED = false`
