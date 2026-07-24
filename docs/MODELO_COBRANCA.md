# Modelo de Cobrança — Matopiba Log (referência técnica)

> Documento de **referência**. Não altera nada. Descreve, com precisão de campo e
> de fluxo, como o preço de um plano vira valor de fatura hoje. Serve para embasar
> a decisão de preços comerciais (ver [`GOLIVE_PRECOS_MATRIZ.md`](GOLIVE_PRECOS_MATRIZ.md))
> e a aplicação segura (ver [`RUNBOOK_APLICACAO_PRECOS.md`](RUNBOOK_APLICACAO_PRECOS.md)).
>
> Base: `main` após a mega-frente de go-live (PRs #312/#313). Auditoria 2026-07-23.

---

## 1. Os campos do plano (tabela `planos`)

| Campo | Tipo | Papel |
|-------|------|-------|
| `id` | uuid | identificador |
| `nome` | text | rótulo comercial |
| `categoria` | text | `empresa` \| `autonomo` \| `ambos` — a quem o plano se destina (CHECK migration 025) |
| `ativo` | bool | aparece no app/cadastro (`/planos/publicos` filtra `ativo=true`) |
| `arquivado_em` | timestamptz \| null | fora da visão principal do painel; arquivar também seta `ativo=false` (migration 027) |
| `ja_utilizado` | bool | marca durável de "já foi atribuído a alguma empresa" — base da trava de exclusão e da confirmação 409 |
| `modelo_cobranca` | text | `fixo` \| `por_motorista` (migration 029) |
| `preco_mensal` | numeric(10,2) | **o valor final cobrado** (ver §2) |
| `preco_por_motorista` | numeric(10,2) \| null | unitário, só em `por_motorista` |
| `limite_motoristas` | int | teto de motoristas (também é a quantidade contratada em `por_motorista`) |
| `dias_trial` | int | dias de teste |
| `recursos` | jsonb | lista de features (informativo) |

---

## 2. Regra central: `preco_mensal` é sempre o valor final

Decisão de produto (não reinterpretar) — implementada em
[`backend/services/planoPrecoService.js`](../backend/services/planoPrecoService.js):

- **`modelo_cobranca = 'fixo'`** → `preco_mensal` é o valor **digitado**.
  `preco_por_motorista` é forçado a `null`.
- **`modelo_cobranca = 'por_motorista'`** → `preco_mensal` é **derivado** pelo
  backend como `preco_por_motorista × limite_motoristas`. O `preco_mensal` que o
  cliente enviar é **ignorado** e recalculado.

**O backend é a autoridade.** A conta é feita **em centavos inteiros** (para não
herdar erro de float — ex.: `149.90 * 3 = 449.70000000000005`), e valor com mais
de 2 casas decimais é **recusado**, nunca arredondado.

Travas de sanidade (política, ajustável sem migration):
- unitário `> 0`; quantidade inteira `≥ 1`;
- `limite_motoristas = 999` é **sentinela de ilimitado** e é recusado em
  `por_motorista` (ilimitado × unitário não faz sentido);
- teto de quantidade = 200; teto de valor final = R$ 500.000,00.

Fronteira com o banco (migration 029): o banco garante o invariante **estrutural**
(por_motorista sempre com unitário > 0 e quantidade ≥ 1); o serviço guarda a
**política** (sentinela, tetos, casas decimais).

---

## 3. "Por motorista" = capacidade **contratada**, não uso real

Ponto que causa confusão comercial e precisa ficar explícito:

> Em `por_motorista`, o valor é `preco_por_motorista × limite_motoristas`.
> `limite_motoristas` é a **quantidade contratada** (o teto do plano), **não** a
> contagem de motoristas ativos da empresa naquele mês.

Ou seja: a cobrança **não** é dinâmica por uso. Uma empresa no plano "R$ 100 × 10"
paga R$ 1.000,00 mesmo que só tenha 6 motoristas cadastrados. Isso é intencional
e coerente com "plano com capacidade contratada".

---

## 4. "Por caminhão": três significados possíveis — só um existe hoje

Auditoria de schema (2026-07-23): **não há tabela de veículos/frota** no sistema.
Não existe `veiculos`, `caminhoes` nem `frota`; o que existe é `motoristas` +
`limite_motoristas`. Consequência para o rótulo comercial "por caminhão":

| Interpretação | Suportado hoje? | O que é |
|---|---|---|
| **A. Slot contratado** ("compro 10 posições") | ✅ Sim | É exatamente o `por_motorista` de hoje — muda só o **rótulo** na UI. Nenhuma lógica nova. |
| **B. Motorista ativo** (conta quem está cadastrado) | ⚠️ Não como cobrança | Existe a contagem de motoristas (`planoLimiteService`), mas o billing **não** a usa como base de preço. Seria um novo modelo dinâmico. |
| **C. Frota física real** (veículos cadastrados da empresa) | ❌ Não existe | Exige nova frente inteira (ver §5). Não prometer esse modelo sem construí-lo. |

**Recomendação:** se o objetivo comercial é "cobrar por caminhão" no sentido de
**capacidade contratada** (A), basta renomear o rótulo no painel/app — a lógica
de `por_motorista` já entrega isso. Só decidir o texto.

---

## 5. Se um dia quiserem frota física real (B/C) — plano técnico

Não implementar agora; registrar o tamanho da frente para decisão consciente:

1. **Tabela `veiculos`** (placa, tipo, empresa_id, ativo, criado_em) + índice único de placa por empresa.
2. **Contagem ativa** e histórico/snapshot mensal (para congelar a base de cobrança do mês).
3. **Hook de billing**: `faturaRecorrenteDomainService` passaria a derivar o valor
   da contagem de veículos do período — com snapshot da quantidade na fatura.
4. **App/painel**: cadastro e gestão de veículos; exibição da base cobrada.
5. **Migração** de dados e **UX** de transição (empresas que hoje são `por_motorista`).
6. **Testes**: contagem, snapshot congelado, borda (0 veículos, veículo removido no meio do mês).

Custo: comparável a uma frente de billing completa. É decisão de produto, não de código.

---

## 6. Snapshot: por que mudar preço não mexe em fatura já emitida

Cada fatura carrega um **snapshot** da composição do preço no momento da emissão
(migration 030): `plano_nome_snapshot`, `modelo_cobranca_snapshot`,
`preco_unitario_snapshot`, `quantidade_snapshot`, e o `valor` final.

- O `valor` da fatura vem de `plano.preco_mensal` **no ato da criação** e **nunca
  é recalculado** depois. Não existe caminho de código que reescreva `faturas.valor`
  a partir do plano atual — o webhook (`paymentDomainService`) só mapeia **status**
  (pago/vencido/cancelado), jamais valor.
- Logo, **alterar o preço de um plano não altera nenhuma fatura já emitida** —
  paga ou aberta. O novo preço só aparece na **próxima** recorrência/regularização.

Isso é o que torna a reprecificação **forward-only** e segura. Ver o efeito
quantificado antes de aplicar: `GET /painel-admin/planos/:id/impacto-preco`
(ver [`RUNBOOK_APLICACAO_PRECOS.md`](RUNBOOK_APLICACAO_PRECOS.md)).

---

## 7. Quais fluxos leem o preço — e de onde

| Fluxo | Origem do valor | Snapshot? |
|---|---|---|
| Fatura **recorrente** (`faturaRecorrenteDomainService`) | `plano.preco_mensal` no ato | sim |
| Fatura de **regularização** (`regularizacaoDomainService`) | `plano.preco_mensal` no ato | sim |
| **Trial vencido** (`jobs/expirarTrials`) | gera regularização → `plano.preco_mensal` no ato | sim |
| **Upgrade** (`upgradeRequestService`) | `plano.preco_mensal` do plano-alvo no ato | sim |
| **Webhook** Asaas (`asaasWebhookService`/`paymentDomainService`) | **não toca valor** — só status | — |
| App/Painel **Minhas Faturas** | lê `faturas.valor` (nunca o plano atual) | lê snapshot |
| **Cron** recorrente (`jobs/gerarFaturasRecorrentes`) | idem recorrente; sandbox-gated + allowlist | sim |
| **billing-health** | read-only; agrega faturas/empresas, não cobra | — |

Invariante comum: **quem já virou fatura usa `faturas.valor`; quem ainda vai virar
usa `plano.preco_mensal` do momento da emissão.**

---

## 8. Categoria × tipo de empresa

- `categoria` do plano é validada na criação/edição (`empresa`/`autonomo`/`ambos`).
- No vínculo empresa↔plano, `categoriaCompativelComTipo` (guard do PR #304) impede
  autônomo em plano de empresa e vice-versa.
- `billing-health` sinaliza `categoria_incompativel` (crítico) e, desde a
  mega-frente, também `empresa_sem_plano` e `plano_inativo_ou_arquivado`
  (informativos) — ver [`RUNBOOK_APLICACAO_PRECOS.md`](RUNBOOK_APLICACAO_PRECOS.md) §Observabilidade.

---

## 9. Modelo comercial "base + capacidade inclusa + extra" (FASE 2 — estrutura, sem valores)

> **Estado:** estrutura criada (migration 038 + `calculadoraComercialService.js`),
> **nenhum valor comercial aplicado** ao catálogo. Os campos existem e o cálculo
> está testado; preencher preços é frente à parte, com autorização.

Os dois modelos do §2 (`fixo` e `por_motorista`) **não** descrevem um plano com
uma **base que já inclui N motoristas** e um **preço só para o excedente**. Ex.:
*Empresa Start = R$ 299,90 já com 5 inclusos; o 6º motorista custa +R$ 100,00.*
Para isso, a `planos` ganhou campos **aditivos** (migration 038):

| Campo | Papel |
|-------|-------|
| `capacidade_inclusa` | motoristas/caminhões cobertos pela base (`NULL` → cai para `limite_motoristas`, compat legado) |
| `preco_motorista_extra` | unitário do extra acima da capacidade inclusa (`NULL` → plano não admite extra: autônomo/fixo) |
| `limite_negociacao` | teto self-service; acima → sob proposta (`NULL` → usa o global de 40 do serviço) |
| `requer_negociacao` | o plano é "sob proposta" (41+), sem preço de tabela |

Regras (em [`backend/services/calculadoraComercialService.js`](../backend/services/calculadoraComercialService.js), **puro, em centavos inteiros**):

- `qtd ≤ capacidade_inclusa` → total = base (sem extras);
- `qtd > capacidade_inclusa` e há extra → total = base + `(qtd − inclusa) × extra`;
- sem `preco_motorista_extra` e `qtd > inclusa` → plano **não acomoda** (o
  recomendador aponta outro plano);
- `qtd > 40` (global, sobrescrevível) → **`requer_negociacao`**, sem preço de tabela.

`recomendarPlano({ planos, quantidade, planoAtualId })` compara o custo real (base
+ extras) entre os planos candidatos e devolve o **mais barato**, a **economia**
frente ao plano atual e a **mensagem**. Empate de preço desempata pela **maior
capacidade inclusa** (mais folga pelo mesmo valor) — não muda preço, só a sugestão.

`preco_mensal` continua sendo o **valor final da BASE**; o extra é somado por fora
pelo backend (autoridade). O snapshot comercial (`montarSnapshotComercial`) congela
`capacidade_contratada`, `capacidade_inclusa`, `extras_qtd`, `extra_unitario` e o
`plano_recomendado_id` no ato — mesma filosofia forward-only do §6.

---

## 10. Taxa de implantação/aquisição (FASE 4 — estrutura, sem valores)

> **Estado:** estrutura criada (migration 039 + `implantacaoDomainService.js`),
> **nenhum valor aplicado** (`valor_implantacao` NULL em todos os planos). Serviço
> **não fiado** a rota/job ainda (código morto de propósito) — não cobra sozinho.

Taxa **única** de aquisição, **separada da mensalidade**, cobrada de **empresas**
na entrada. Campos (migration 039, aditivos):

| Campo | Onde | Papel |
|-------|------|-------|
| `valor_implantacao` | `planos` | valor da taxa (NULL/0 = plano sem implantação) |
| `implantacao_isenta` | `faturas` | marca a implantação como dispensada |
| `implantacao_isencao_motivo` / `implantacao_isento_por` | `faturas` | auditoria da isenção |

Regras (em [`backend/services/implantacaoDomainService.js`](../backend/services/implantacaoDomainService.js), **puro**):

- **Autônomo é isento por regra** (tipo empresa ou categoria do plano = `autonomo`);
- fatura **separada**: `origem='implantacao'`, `periodo_referencia` NULL (não é
  competência mensal), snapshot do plano congelado;
- **idempotência lifetime**: `client_request_id = 'implantacao:<empresa_id>'` (sem
  mês) contra o índice único da migration 021 → **no máximo uma implantação por
  empresa, para sempre**. Cobrança e isenção **compartilham a mesma chave**;
- **isenção manual** do super-admin (ou promoção que zera a taxa) = fatura
  `valor 0`, `status 'cancelado'`, `implantacao_isenta=true` + autoria — fica no
  domínio de status válido (sem inventar `isento`), não infla receita e bloqueia
  recobrança;
- **aberta a desconto por promoção**: `avaliarImplantacao` aceita `valorEfetivo`
  (já com desconto); `0` vira isenção. O motor de promoções (FASE 5) o calcula.

Nada de Asaas/cobrança real aqui — só a decisão e o payload lógico.
