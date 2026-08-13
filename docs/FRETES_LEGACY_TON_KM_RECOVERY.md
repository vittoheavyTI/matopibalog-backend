# Fretes legado tonelada/km: recuperacao segura

## Escopo

Este runbook descreve a recuperacao segura para fretes `tonelada_km` antigos cujo `valor_tonelada_km` ficou incompatível com as regras operacionais atuais.

O escopo desta frente e UX/API de recuperacao com auditoria atomica. Ela nao corrige linhas historicas automaticamente, nao altera limites de banco e nao faz deploy/merge.

## Guardrails mantidos

- `VALOR_TONELADA_KM_MAX = 10`.
- Formula canonica: `toneladas * (km_final - km_inicial) * valor_tonelada_km`.
- `km_final` precisa ser maior que `km_inicial`.
- `valor_frete` total permanece limitado pelo teto operacional existente.
- Finalizacao continua falhando em `422` quando o frete atual e incompatível.
- Nao existe autocorrecao de escala. Valores como `245`, `250`, `150` ou `450` nao sao divididos automaticamente por `1000`, `100` ou qualquer outro fator.

## Comportamento esperado

Quando uma edicao rapida tenta salvar um frete legado `tonelada_km` com valor acima do limite atual, o backend retorna `422` com payload estruturado:

```json
{
  "error": "frete_operational_limit",
  "field": "valor_tonelada_km",
  "current_value": 245,
  "max_value": 10,
  "message": "..."
}
```

O painel mostra um diagnostico visual de dado legado incompatível e oferece o CTA **Editar frete completo**. O editor completo abre o mesmo frete, sem sugerir valor comercial e sem transformar automaticamente o numero antigo.

A recuperacao so ocorre quando um operador com permissao no painel informa manualmente um valor comercial valido e um motivo. O painel usa `POST /fretes/:id/correcao-financeira`, enviando somente `fields`, `reason` e `request_id`; `source` e `correction_type` sao definidos pelo backend e validados por allowlist na RPC. O update do frete e o insert em `fretes_financeiro_auditoria` acontecem na mesma transacao.

O `request_id` do painel e estavel para retry da mesma intencao de correcao ate o ACK de sucesso. A RPC serializa a chave idempotente antes do lookup; duas chamadas concorrentes com o mesmo `source/request_id` retornam replay seguro, com somente uma mutacao/auditoria.

Para evitar stale read, o backend calcula o patch no JS canonico e envia tambem o `before_snapshot` esperado. A RPC bloqueia a linha, monta o snapshot atual sob lock e rejeita divergencia com `frete_financial_correction_concurrent_change`; o painel refaz o fetch e nao reaplica patch antigo silenciosamente.

Correcoes financeiras sao permitidas somente para fretes ainda operacionais: `ativo` e `pendente`. Fretes `finalizado` e `cancelado` permanecem read-only para este fluxo, retornando `frete_financial_correction_status_locked`.

No app Android, a finalizacao recebe a mensagem semantica do backend e informa que a correcao deve ser feita no painel por um administrador. O motorista nao recebe campo para editar valor financeiro.

## Dados conhecidos da auditoria

Auditoria aceita antes desta implementacao:

- 9 fretes `tonelada_km` identificados.
- 8 outliers legados acima de `10`.
- 7 cancelados.
- 1 finalizado.
- 0 ativos.
- 1 registro atual em escala valida.
- `commercial_correct_value_known = false`.

A migration `033` foi tratada como limpeza de sintoma em `valor_frete` materializado alto, nao como remediacao completa da classe de dados.

## Auditoria atomica

A migration `065_fretes_financeiro_auditoria.sql` cria a tabela `fretes_financeiro_auditoria` com RLS forçada, sem acesso direto para `anon`/`authenticated`, e `service_role` limitado a `SELECT`/`INSERT`.

`actor_user_id` permanece como FK nullable para `public.usuarios`; `actor_auth_uid` preserva o UID autenticado como snapshot de auditoria quando o perfil publico ainda nao existe.

Snapshots registram somente:

- `modalidade_calculo`
- `toneladas`
- `valor_tonelada_km`
- `valor_frete`
- `km_inicial`
- `km_final`
- `status`

Nao sao gravados tokens, cookies, secrets ou payloads brutos.

O caso finalizado inconsistente `829e1bd7` permanece sem alteracao por decisao de escopo: nao ha mudanca de dado historico neste gate.

## Proibicoes desta frente

- Nao executar updates diretos no Supabase.
- Nao adicionar `CHECK valor_tonelada_km <= 10` no banco.
- Nao fazer deploy.
- Nao fazer merge.
- Nao tocar SEC-1, PR #414, PR #415, PR #416 ou Asaas.
