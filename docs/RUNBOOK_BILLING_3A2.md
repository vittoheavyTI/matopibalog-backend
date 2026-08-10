# Runbook operacional — Billing 3A-2

> Operação/investigação sem expor secrets. NÃO deployar/mergear/ativar produção
> nesta frente. O modo real permitido é sandbox (gated).

## Regras de ouro
- Nunca logar `ASAAS_API_KEY`, `Authorization`, token de webhook, dados de cartão,
  Pix sensível, CPF/CNPJ completo, e-mail/telefone sem necessidade, JWT. Erros do
  provedor são sanitizados (`asaasWebhookEventRepository.sanitizar`).
- IDs externos (customer/subscription/payment) são dados de integração: o Super
  Admin NÃO os digita livremente; só via fluxo controlado.

## Cenário: webhook parado / eventos acumulando
1. Verificar `asaas_webhook_events` por `status='failed'` com `next_retry_at` no passado.
2. Conferir se o endpoint `/pagamentos/webhook/asaas` responde 401 (token) ou 500.
3. Reprocessar via reconciliação (contingência): `POST /pagamentos/billing/reconciliar-plan/:empresa_id`
   (dry) → aplicar reparo no Gate/sandbox. Idempotente: reprocessar não duplica.

## Cenário: Asaas indisponível (timeout/5xx/429)
- O executor faz retry só para transitórios com backoff limitado (sem loop infinito).
- Ações ficam pendentes; a reconciliação idempotente completa quando o provedor volta.
- Não segurar transação SQL longa em volta do Asaas (padrão pending → externo → persistir).

## Cenário: cobrança duplicada suspeita
1. `GET /pagamentos/billing/overview/:empresa_id` — ver última cobrança + status.
2. Reconciliar (dry) para detectar `cobranca_local_faltando`/`status_defasado`.
3. Idempotência garante 1 efeito por event_id; duplicidade real indica evento com
   `event_id` distinto — investigar no provedor (sandbox) sem expor IDs completos.

## Cenário: mapping quebrado (customer/subscription órfão)
- `reconciliar-plan` sinaliza `customer_mapping_ausente`/`subscription_local_orfa`.
- Reparo: gravar mapping (se o provider tem o objeto) ou recriar (idempotente).

## Reconciliação (motor único)
- `billingReconcileDomainService.reconciliar({ local, remoto })` — mesmo motor da
  automação e da contingência manual. Sempre idempotente.

## Rollback / desativar automação sem apagar dados
- Definir `BILLING_PROVIDER_MODE=fake` (ou remover o adapter sandbox) → nenhuma
  chamada externa; o núcleo continua planejando/observando (dry).
- Reverter o deploy por SHA (Railway/Pages) sem tocar em dados: 3A-2 não adiciona
  migration; as colunas/tabelas usadas já existiam.
- Menu "Billing" pode ser ocultado no Sidebar como mini-rollback de UI.

## Investigação sem expor secrets
- Usar `overview`/`reconciliar-plan` (IDs mascarados). Nunca colar API key/token em
  logs, tickets ou PRs. Erros do provedor já vêm sanitizados.
