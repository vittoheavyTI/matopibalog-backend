# Scripts de Confiabilidade — Nível 1

Camada de diagnóstico **prod-safe** e **read-only** para o Matopiba Log.
Localização: `backend/scripts/reliability/`.

## Princípios

- **Token só por variável de ambiente, nunca hardcoded, nunca impresso** (logs mostram `present (hidden)` ou `AUSENTE`).
- **Dry-run é o padrão** em qualquer script que possa criar dados.
- **Nenhum DELETE / DDL / migration** nestes scripts.
- **Service key nunca é obrigatória** no caminho default — o schema-check é opt-in.
- Exit code **0** (ok / SKIP tolerado) ou **1** (FAIL), para uso em CI.

## Scripts

| Script | Cria dados? | Token | Prod-safe | npm |
|---|---|---|---|---|
| `smoke_health.mjs` | Não | — | Sim | `npm run smoke:health` |
| `reliability_report.mjs` | Não | — | Sim | `npm run reliability` |
| `check_db_schema.mjs` | Não (read-only) | service key (opt-in) | Sim | `node scripts/reliability/check_db_schema.mjs` |
| `smoke_idempotencia_lancamentos.mjs` | **Sim** (modo real) | `MATOPIBA_TOKEN` | dry-run sim | `npm run smoke:idempotencia:dry` |

### `smoke_health.mjs`
Verifica `GET /health` (200/`UP`), ausência do header `x-powered-by` e que `GET /fretes` sem token responde `401`. Não usa token.

### `reliability_report.mjs`
Roda os módulos nível 1 (health + schema opt-in), agrega e grava
`tmp/reliability_report.json` e `tmp/reliability_report.md` (pasta **não versionada**).
Não inclui o smoke de idempotência (esse cria dados).

### `check_db_schema.mjs` (opt-in)
Só executa se `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` estiverem no ambiente
(senão, SKIP). Confirma a coluna `client_request_id` em `despesas`,
`abastecimentos` e `vales` via SELECT read-only. Índices únicos parciais são
reportados como SKIP com o SQL de verificação manual.

### `smoke_idempotencia_lancamentos.mjs`
Valida a idempotência do backend (PR #175). **Dry-run por padrão.** O modo real
exige `MATOPIBA_TOKEN` e **cria** lançamentos (use conta de teste, valor baixo,
marcador `[smoke]`). Limpeza é manual (sem DELETE no backend).

## Variáveis de ambiente

| Var | Usada por | Obrigatória |
|---|---|---|
| `MATOPIBA_API_URL` | todos | não (default: produção Railway) |
| `MATOPIBA_TOKEN` | idempotência (modo real) | só no envio real |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | check_db_schema | só para habilitar o schema-check |

> Nunca commitar `.env` nem valores reais. A service key é altamente sensível —
> use apenas em ambiente local confiável, jamais em CI compartilhado ou em log.

## Exemplos

```bash
cd backend
npm run smoke:health
npm run reliability
npm run smoke:idempotencia:dry

# schema-check (opt-in)
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/reliability/check_db_schema.mjs

# idempotência real (cria dados — conta de teste)
MATOPIBA_TOKEN=... node scripts/reliability/smoke_idempotencia_lancamentos.mjs --endpoint=despesas --valor=1.00
```
