# Runbook — Promoções / Tickets / Códigos de campanha

> **Estado:** motor criado (migration 040 + `promocaoDomainService.js`, puro e
> testado) **e endpoints super-admin fiados** (`routes/painel-admin.js`, adaptadores
> finos sobre o serviço puro). **Nenhuma promoção real cadastrada**, migration
> **não aplicada** — os endpoints respondem **503** ("não provisionado") até a 040
> ser aplicada. Painel entra na fase seguinte. Nada de Asaas/cobrança real.

## Endpoints super-admin (todos sob `/painel-admin`, guardados por `isSuperAdmin`)

| Método | Rota | Papel |
|--------|------|-------|
| `GET` | `/planos/recomendar?quantidade=&planoAtualId=` | recomenda plano mais barato (FASE 3) |
| `POST` | `/promocoes` | criar campanha |
| `GET` | `/promocoes` | listar campanhas (com códigos) |
| `PATCH` | `/promocoes/:id` | ativar/desativar, editar datas/limites |
| `POST` | `/promocoes/:id/codigos` | gerar código/ticket |
| `POST` | `/promocoes/validar` | validar código (preview, read-only) |
| `POST` | `/promocoes/:id/aplicar` | aplicar **manual** a uma empresa (auditoria) |

Enquanto a migration 040 não é aplicada, os endpoints de promoção retornam
**503** de forma amigável (sem quebrar o painel).

## Modelo (3 tabelas — migration 040)

| Tabela | Papel |
|--------|-------|
| `promocoes` | a **campanha**: tipo de desconto, janela (`data_inicio`/`data_fim`), `ativo`, `limite_usos_total`, `uso_unico_por_empresa`, `plano_alvo_id` (NULL = todos) |
| `promocao_codigos` | os **códigos/tickets** da campanha (1 compartilhado, ou N tickets de feira), com `limite_usos` e `ativo`. Índice único **case-insensitive** em `upper(codigo)` |
| `promocao_resgates` | **auditoria** imutável por uso: empresa, quem aplicou, `manual`, `alvo`, `preco_original`, `preco_final`, `desconto_valor`, `motivo`, `fatura_id` |

## Tipos de promoção (`promocoes.tipo`)

| Tipo | Campo usado | Efeito |
|------|-------------|--------|
| `desconto_percentual_mensalidade` | `percentual` | % de desconto na mensalidade |
| `desconto_fixo_mensalidade` | `valor` | desconto fixo na mensalidade (não fica < 0) |
| `preco_promocional` | `valor` (+`duracao_meses`) | mensalidade vira um preço fixo por período |
| `desconto_percentual_implantacao` | `percentual` | % na taxa de implantação |
| `desconto_fixo_implantacao` | `valor` | desconto fixo na implantação |
| `isencao_implantacao` | — | implantação vai a 0 (usa a isenção da FASE 4) |
| `trial_estendido` | `dias_trial_extra` | soma dias ao trial |

Todo cálculo é em **centavos inteiros** (`aplicarPromocao`, reaproveita
`planoPrecoService.paraCentavos`).

## Regras de resgate (`avaliarResgate`)

1. **Automático** (cadastro/checkout): promoção precisa estar `ativo` e **dentro da
   janela**; o código precisa existir, estar ativo e ter usos restantes.
2. **Manual** (super-admin): **fura janela e `ativo`** (aplicar após o fim da
   campanha) — mas **não** fura `limite_usos_total`, limite do código nem uso único.
3. **Uso único por empresa**: se a campanha marca, uma empresa só resgata uma vez.
4. **Plano-alvo**: se definido, só vale para o plano escolhido.

## Auditoria (quem criou / quem aplicou)

- `promocoes.criado_por` → super-admin que criou a campanha.
- `promocao_resgates.aplicado_por` → super-admin que aplicou (NULL = self-service).
- `promocao_resgates` congela `preco_original`/`preco_final`/`desconto_valor` no ato
  (snapshot forward-only, mesma filosofia das faturas).

## Ticket de feira — fluxo pretendido (fases seguintes)

1. Super-admin cria campanha (`isencao_implantacao` ou `%` na mensalidade) com
   janela do evento e `limite_usos_total`.
2. Gera 1 código (`FEIRA2026`) compartilhado **ou** N tickets únicos.
3. No cadastro, o cliente informa o código → `avaliarResgate` valida → preço
   promocional exibido (original × final) → snapshot no resgate/fatura.
4. Após a feira, o super-admin ainda pode aplicar **manualmente** a uma empresa.

## Aplicar em produção (quando autorizado)

1. Rodar a migration 040 no Supabase SQL Editor (cria as 3 tabelas vazias).
2. Rodar o bloco de validação read-only do fim da migration.
3. Só então cadastrar campanhas pelos endpoints do super-admin (fase seguinte).

**Não** aplicar preços comerciais nem ativar Asaas production nesta frente.
