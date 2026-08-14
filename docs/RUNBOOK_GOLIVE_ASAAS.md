# Runbook - Go-live Financeiro / Asaas Production

Estado deste runbook: #420 merged, codigo production provider deployado e
financeiro production desligado pelo gate.

Este documento nao autoriza dinheiro real. O proximo gate unico e:

`FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`

Estado canonico apos o correction pass:

`PAYMENT_PRODUCTION_READINESS = READY_FOR_CONTROLLED_FIRST_PAYMENT`

`PRODUCTION_ASAAS_WRITES = 0`

`PRODUCTION_BILLING_RUNNER_ENABLED = false`

Estado apos gate de integracao:

- PR #420: MERGED.
- Production deployment: codigo de readiness financeiro em `main`.
- Asaas Production: `PRODUCTION_DISABLED`.
- `ASAAS_API_KEY`: ausente.
- `BILLING_OUTBOX_ENABLED`: ausente/OFF.
- `BILLING_PROVIDER_MODE`: ausente, resolvido como `fake`.
- `BILLING_PRODUCTION_ENABLED`: ausente/OFF.
- `BILLING_PRODUCTION_ALLOWLIST`: ausente/vazia.

Leitura de candidatos atual: nenhuma empresa `commercial_flow_version='v2'`
tecnicamente elegivel foi encontrada em producao. O primeiro piloto continua
pendente de escolha humana no `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`.

## Autoridade Canonica

O motor canonico de cobranca nova e:

`billing_outbox -> billingOutboxRunner -> billingOutboxWorker -> billingOrchestratorService -> provider`

Rotas legadas de `/pagamentos` permanecem como compatibilidade/sandbox e continuam
bloqueadas por `bloquearSeNaoSandbox`. Elas nao sao o motor de production.

## Fonte Canonica da Credencial

`PRODUCTION_SECRET_AUTHORITY = ASAAS_API_KEY_ENV_ONLY`

A chave production deve existir somente em variavel protegida do runtime. A chave
legada em `configuracoes.dados.integracao_asaas.apiKey` segue existindo para
sandbox/legado, mas nao e autoridade para o provider production 3A-2.

Nunca copiar, imprimir, logar ou commitar chave production.

## Gate Cumulativo

Production write so pode acontecer quando todos forem verdadeiros:

- `BILLING_OUTBOX_ENABLED=true`
- `BILLING_PROVIDER_MODE=asaas_production`
- `BILLING_PRODUCTION_ENABLED=true`
- `BILLING_PRODUCTION_ALLOWLIST` contem o UUID da empresa piloto
- `ASAAS_API_KEY` esta presente no runtime
- a operacao e elegivel pelo orquestrador 3A-2

Qualquer item ausente ou invalido resulta em fail-closed antes do adapter HTTP.

## Headers Asaas

Todo provider Asaas deve enviar explicitamente:

- `access_token`
- `Content-Type: application/json`
- `User-Agent: MatopibaLog/1.0 (Node.js; <environment>)`

A documentacao oficial Asaas exige `User-Agent` para novas contas raiz e recomenda
identificacao explicita da aplicacao.

## Create Idempotency Recovery

Customer, subscription e payment usam `externalReference` para reconciliacao.

Fluxo obrigatorio para creates:

1. consultar por `externalReference`;
2. se existir, reutilizar;
3. se nao existir, fazer POST;
4. se o POST retornar timeout, 408, 429 ou 5xx, consultar novamente;
5. se o recurso apareceu, tratar como sucesso reconciliado;
6. so permitir retry externo se o recurso realmente nao apareceu.

Referencias canonicas:

- customer: `empresa.id`
- subscription mensal: `matopiba:billing:v1:subscription:monthly:<empresa_id>`
- implantacao: `matopiba:billing:v1:charge:implantation:<empresa_id>`

Isso cobre response lost after commit, worker restart, reconcile posterior e eventos
outbox equivalentes.

## Trial

Trial e respeitado integralmente.

Mesmo com contrato, customer, assinatura, pagamento ou add-on aceito, a mensalidade
nao pode vencer antes de `trial_ends_at`. Pagamento nao encurta trial.

## Implantacao e Mensalidade

Implantacao e mensalidade sao separadas:

- implantacao R$ 0 nao cria cobranca ficticia;
- valor vem de snapshot/catalogo comercial vigente;
- contrato historico nao e recalculado;
- `BILLING_IMPLANTACAO_TIMING` controla quando cobrar implantacao;
- create de implantacao e idempotente por externalReference canonica.

## Add-on Monthly Composition

Add-on mensal nao e payment avulso.

Modelo canonico atual:

`mensalidade_base + soma(add-ons mensais aceitos e vigentes) = valor mensal da subscription`

Se o add-on for removido, o historico de payments anteriores permanece. A remocao
significa nao compor proximos ciclos.

Nunca deletar payment recebido/confirmado como simples efeito de desabilitar
funcionalidade.

## Add-on Acceptance Authority

Add-on com impacto financeiro so pode entrar no billing quando houver aceite
comercial explicito e auditavel.

Autoridade real:

- `empresa_funcionalidades.contrato_id` ou `aditivo_id` vinculado a
  `contratos_comerciais.status` concluido: `plenamente_assinado`, `assinado` ou
  `aceito_manualmente`;
- `empresa_funcionalidades.status='ativa'`;
- `vigencia_inicio`/`vigencia_fim` vigentes, quando preenchidos;
- `preco_mensal_centavos > 0`.

`aprovado_por` sozinho nao autoriza cobranca de add-on com impacto financeiro.
Ausencia de contrato/aditivo concluido significa fail-closed: zero billing do
adicional. O campo `preco_mensal_centavos` representa o valor mensal TOTAL
negociado do add-on; `quantidade` e escopo/auditoria e nao multiplica o preco.
Quantidade nula e aceita como nao aplicavel; quantidade invalida falha fechada.

## Subscription Update Effective Date

Update de valor da subscription deve preservar cobrancas pendentes ja geradas:

`updatePendingPayments=false`

Pelo contrato oficial Asaas, alteracoes de valor/metodo afetam cobrancas futuras;
para alterar pendentes ja geradas seria necessario enviar `updatePendingPayments=true`,
o que e proibido neste fluxo padrao.

## Cancellation vs Suspension

DELETE de subscription e cancelamento permanente da recorrencia e pode afetar
cobrancas pendentes/overdue vinculadas.

Regra Matopiba:

- `suspensa_financeiramente`: nao deleta subscription;
- inadimplencia temporaria: nao deleta subscription;
- `cancelada`/`cancelado`: pode cancelar subscription de forma definitiva;
- cancelamento definitivo exige auditoria comercial e nao e rollback silencioso.

## Reconcile

`backend/scripts/billing/reconcile_periodico.mjs`

O reconcile periodico enfileira eventos idempotentes de `reconciliacao`; ele nao
chama Asaas diretamente. O runner do outbox processa a convergencia e o provider
faz lookup por `externalReference` antes de criar.

Cadencia inicial recomendada para production: manual/one-shot no primeiro pagamento.
Automacao periodica so apos observacao do piloto.

## Webhook Production

URL:

`https://api.matopibalog.com.br/pagamentos/webhook/asaas`

Autenticacao:

header `asaas-access-token` igual a `ASAAS_WEBHOOK_TOKEN`.

O webhook e idempotente por `asaas_webhook_events` e hash canonico. Eventos
duplicados, replay e out-of-order devem convergir sem marcar pagamento falso.

## Primeiro Pagamento Controlado

Somente no `FINAL_ASAAS_PRODUCTION_ACTIVATION_GATE`:

1. escolher uma empresa piloto e confirmar UUID;
2. conferir `billing-health` e pendencias conhecidas;
3. inserir `ASAAS_API_KEY` production no runtime protegido;
4. configurar `BILLING_PRODUCTION_ALLOWLIST` com somente a empresa piloto;
5. ligar `BILLING_PROVIDER_MODE=asaas_production`;
6. ligar `BILLING_PRODUCTION_ENABLED=true`;
7. executar runner manual/one-shot, batch 1, um evento por vez;
8. observar customer/subscription/charge, webhook e reconcile;
9. desligar `BILLING_OUTBOX_ENABLED` imediatamente apos o evento se nao houver
   autorizacao para manter processamento;
10. parar se ocorrer `ASAAS_COMMIT_UNCERTAIN` e reconciliar por `externalReference`
    antes de qualquer nova tentativa.

## Rollback / Kill Switch

Ordem de desligamento:

1. `BILLING_OUTBOX_ENABLED=false`
2. `BILLING_PRODUCTION_ENABLED=false`
3. remover empresa da `BILLING_PRODUCTION_ALLOWLIST`
4. voltar `BILLING_PROVIDER_MODE=fake` ou remover a variavel
5. manter registros locais para auditoria

Cobrancas reais ja criadas devem ser tratadas no painel/API Asaas por autorizacao
financeira especifica.

## Incidente

Em caso de erro:

- nao apagar faturas;
- nao apagar outbox;
- congelar runner;
- coletar billing-health;
- reconciliar estado local x Asaas;
- registrar decisao operacional antes de qualquer cancelamento/estorno real.

## Referencias Oficiais Asaas

- Authentication / User-Agent: https://docs.asaas.com/docs/authentication
- List subscriptions by externalReference: https://docs.asaas.com/reference/list-subscriptions
- List payments by externalReference: https://docs.asaas.com/reference/list-payments
- Update subscription / updatePendingPayments: https://docs.asaas.com/reference/update-existing-subscription
- Remove subscription: https://docs.asaas.com/reference/remove-subscription
- Delete payment: https://docs.asaas.com/reference/delete-payment
