# PILOT_READY_V1 — certificação técnica até os gates do OWNER

## 1. Objetivo e baseline

Preparar a jornada operacional do piloto com evidência reproduzível, sem merge,
deploy, escrita em produção, ativação comercial ou uso de dados reais.

- Baseline esperado e observado: `845289cb55cb7575e65eb08057b44c2a99e8621f`.
- Worktree: `C:\Projetos\worktree-pilot-ready-v1`.
- Branch: `feature/pilot-ready-v1`.
- Workspace legado preservado: `feat/app-rc-mascaras`, HEAD `539b164...`,
  arquivos locais não rastreados mantidos.
- PRs protegidas: #501 e #490, sem mutação por esta macrofrente.
- Escritas/mutações de produção: zero.

## 2. Escopo e cenários

O cenário técnico cobre gestor no painel web e motorista no Flutter, com backend
Express e Supabase como autoridades. O piloto real, participante, volume, dados,
duração e responsáveis permanecem no `OWNER_PILOT_GO_LIVE_GATE`.

Fluxos examinados: autenticação/sessão; tenant, permission, entitlement e scope;
criação/execução/finalização de fretes; lançamentos; documentos/ePOD; cálculos e
relatórios; diagnóstico/realtime; backup e recuperação. SEC-1, permissões P2,
escopo operacional, regras financeiras e envelope E3.8 foram preservados.

## 3. PILOT_READY_V1_AUDIT_FINDINGS_FROZEN

### PRV1-HIGH-01 — criação de frete duplicável após resposta perdida

- **Componente:** `POST /fretes`, painel e Flutter.
- **Causa:** os clientes não enviavam uma identidade estável da intenção; o
  serviço só usava `forcedId` no fluxo de campanhas.
- **Reprodução:** em harness isolado, create concluído + resposta descartada +
  retry sem chave deixou duas linhas. Concorrência tinha o mesmo risco.
- **Risco:** dois fretes, notificações duplicadas e efeitos operacionais/financeiros
  ambíguos.
- **Prioridade:** HIGH.
- **Arquivos:** schema/controller/service de fretes, painel de viagens e tela
  `AddFreteScreen`.
- **Correção preparada:** chave UUID estável nos dois clientes; hash SHA-256 da
  intenção canônica; unicidade persistente por tenant; replay só quando chave e
  hash conferem; payload divergente retorna 409; notificação apenas no primeiro
  insert.
- **Estado:** implementação e testes focais prontos; depende do
  `OWNER_SCHEMA_GATE` abaixo antes de merge/deploy.

### PRV1-HIGH-02 — “Novo Frete” ignorava a permissão efetiva

- **Componente:** menu Flutter e ação web.
- **Causa:** a visibilidade considerava apenas bloqueio comercial; o backend já
  exigia `freight.create`.
- **Evidência:** `AppShell` habilitava a ação com `!planoBloqueado`; o endpoint
  usa `requirePermission('freight.create')`. O painel também exibia a ação para
  quem tinha apenas `freight.view`.
- **Risco:** jornada oferecida e negada pelo backend; mensagens 403 evitáveis.
- **Prioridade:** HIGH.
- **Correção:** web e Flutter usam a permissão efetiva; o backend continua a
  autoridade. Não houve bypass por tipo de conta.
- **Estado:** RESOLVIDO_NO_CODIGO; aceite visual/físico pendente.

### PRV1-HIGH-03 — inventário de recuperação não cobria Storage atual

- **Componente:** runbook de backup/restore.
- **Causa:** documento histórico citava apenas `comprovantes` e um suposto bucket
  `avatars`; o produto passou a usar três buckets privados adicionais.
- **Evidência:** código/migrations usam `comprovantes`, `fretes-documentos`,
  `fretes-evidencias` e `fretes-odometro`; fotos de perfil ficam sob o prefixo
  `avatars/` de `comprovantes`.
- **Risco:** restauração parcial de documentos, ePOD, ocorrências e odômetros.
- **Prioridade:** HIGH.
- **Correção:** runbook, checklist recorrente e registro de backup reconciliados;
  privacidade, manifesto e checksums passaram a fazer parte da validação.
- **Estado:** documentação corrigida. Restore atual completo segue
  `NOT_EXECUTED/BLOCKED_BY_ENVIRONMENT`.

Nenhum BLOCKER foi confirmado. Achados posteriores que mudem essa classificação
devem ser adicionados sem reescrever o congelamento acima.

## 4. Contrato de idempotência preparado

`client_request_id` representa uma intenção de criação. Web e Flutter geram um
UUID por formulário/tela e o reutilizam após timeout ou resposta perdida. O
backend resolve motorista e tenant antes de construir a intenção.

A intenção canônica contém motorista, empresa, origem, destino, KM inicial,
valor/modalidade, tonelagem, recebedor solicitado, unidade explicitamente
solicitada e a opção de odômetro. Placa, unidade apenas derivada do motorista,
recebedor resolvido e status são snapshots mutáveis do contexto e não entram no
hash. Assim, uma alteração posterior nesses atributos não cria falso conflito,
enquanto uma unidade explicitamente solicitada diferente continua sendo outra
intenção. O hash é persistido e não muda quando o frete evolui. A constraint
única é escopada por `(empresa_id, client_request_id)`:

- mesma chave + mesmo hash no mesmo tenant: retorna o frete existente;
- mesma chave + hash diferente no mesmo tenant: 409;
- mesma chave em tenants diferentes: intenções independentes, sem leitura cruzada;
- chaves diferentes: fretes diferentes;
- corrida: a unicidade do banco escolhe uma linha; o perdedor relê no próprio tenant;
- replay: não emite nova notificação e só devolve a linha depois de revalidar
  permission na rota, tenant, ownership e scope operacional atuais.

O campo permanece opcional durante a janela de compatibilidade com clientes
antigos. Os clientes do piloto sempre o enviam. Chamadores legados sem chave
mantêm a semântica anterior e não recebem garantia de retry.

## 5. OWNER_SCHEMA_GATE — aprovado para criação e teste isolado

### Decisão registrada

O OWNER aprovou em 2026-10-16 a criação da migration 088 e sua validação somente
em PostgreSQL isolado. A decisão não autoriza merge, deploy, configuração real ou
aplicação em produção. Nenhum SQL desta migration foi executado em produção.

### SQL final

O conteúdo integral e executável está em
[`backend/migrations/088_freight_creation_idempotency.sql`](../../../backend/migrations/088_freight_creation_idempotency.sql).
A constraint foi corrigida para exigir explicitamente `creation_intent_hash IS
NOT NULL`; isso fecha a semântica SQL em que uma expressão `CHECK` avaliada como
`UNKNOWN` seria aceita. A migration também falha fechado quando encontra drift de
tipo/default/nullability, definição da constraint ou estrutura do índice.

### Impacto e compatibilidade

- Duas colunas nullable; sem backfill e sem alteração de linhas antigas.
- Índice parcial inclui apenas novas intenções identificadas.
- RLS, grants, policies, ownership, cálculos, status e envelope não mudam.
- Clientes antigos continuam criando sem chave durante a janela de compatibilidade.
- A criação do índice lê `fretes` e pode manter lock compatível com escritas por
  curto período; medir volume/tempo no gate antes da aplicação.

### Validação antes/depois

1. Registrar contagem de `fretes` e verificar duplicatas por tenant/chave.
2. Aplicar em ambiente isolado e rodar testes PG de constraint/unicidade/corrida.
3. Rodar testes backend de retry, conflito, tenant e notificação.
4. Confirmar RLS/policies/grants sem diff.
5. Em produção, se aprovado em gate separado, aplicar uma vez, conferir tracking,
   colunas, constraint, índice e contagem preservada.

### Rollback

Antes de deploy do backend, rollback é:

```sql
DROP INDEX IF EXISTS public.ux_fretes_empresa_client_request;
ALTER TABLE public.fretes
  DROP CONSTRAINT IF EXISTS fretes_creation_intent_pair_check,
  DROP COLUMN IF EXISTS creation_intent_hash,
  DROP COLUMN IF EXISTS client_request_id;
```

Depois que clientes gravarem chaves, preferir rollback do código mantendo as
colunas aditivas; remover dados/colunas exigiria novo gate e janela própria.

### Estado do gate

`APPROVED_FOR_ISOLATED_VALIDATION`. Merge/deploy e produção continuam bloqueados
até a prova PostgreSQL real e o CI do HEAD exato ficarem verdes.

## 6. Recuperação e continuidade

O inventário versionado agora cobre os quatro buckets reais e distingue público
legado de privados. A evidência de 2026-06-29 certifica apenas um dump histórico
do banco em PostgreSQL comum; não certifica o estado atual, Auth, Storage, ACLs
ou restore Supabase completo.

Não havia Docker, `psql`, `PG_TEST_URL` ou `DATABASE_URL` no ambiente local desta
execução. Portanto, restore atual com fixtures sintéticas ficou
`BLOCKED_BY_ENVIRONMENT`; nenhum dado real foi copiado e nenhuma restauração foi
tentada em produção.

## 7. Runbook operacional do piloto

- **API indisponível:** preservar `request_id/correlation_id`, não repetir ações
  sem chave, verificar `/health`, logs sanitizados e janela do incidente.
- **Sessão expirada:** reautenticar pelo fluxo SEC-1; não transformar 401/403 em
  sucesso local.
- **Upload incompleto:** manter o frete e reenviar somente o arquivo com a mesma
  identidade do upload; não recriar o frete.
- **Frete duplicado:** interromper efeitos seguintes, comparar tenant, motorista,
  horários e intenção; não apagar automaticamente; reconciliar com auditoria.
- **Finalização ambígua:** consultar o frete e envelope pelo request ID antes de
  repetir; não editar snapshot selado.
- **Divergência financeira:** bloquear correção automática, usar o fluxo auditado
  de correção com motivo/request ID e conferir lançamentos efetivados.
- **SSE indisponível:** usar refetch/polling já existente; SSE é invalidação, não
  fonte de verdade.
- **Suspeita cross-tenant:** suspender a ação, preservar request/correlation IDs,
  revisar scope/permission/tenant e escalar como incidente de segurança.

Mecanismos automáticos de reparo permanecem desarmados.

## 8. Evidência de testes

Classificação usada: `PASS_EXECUTED`, `PASS_CI_VERIFIED`, `DOCUMENTED_ONLY`,
`NOT_EXECUTED`, `BLOCKED_BY_ENVIRONMENT` e `FAILED`.

Evidência executada nesta branch:

- Backend focal: 34/34 (`PASS_EXECUTED`), incluindo reprodução original, retry
  sequencial, concorrência, conflito de payload, intenções distintas, isolamento
  por tenant, autorização atual do replay, compatibilidade `forcedId`, schema e
  notificação única.
- Backend completo: 2220/2220 (`PASS_EXECUTED`).
- Web focal: 2/2 (`PASS_EXECUTED`); suíte completa: 327/327
  (`PASS_EXECUTED`); build TypeScript/Vite concluído (`PASS_EXECUTED`).
- Flutter focal: 3/3 (`PASS_EXECUTED`); suíte completa: 145/145
  (`PASS_EXECUTED`); `flutter analyze --no-pub` sem issues.
- Banco da migration 088: prova PostgreSQL 17 dedicada no workflow
  `Freight Creation Idempotency 088 PG`; o resultado do HEAD exato é registrado
  na Draft PR. Restore sintético completo permanece `BLOCKED_BY_ENVIRONMENT`.
- Validação visual e aparelho físico: `NOT_EXECUTED`, reservados aos gates do OWNER.

## 9. Gates e limites

- `OWNER_SCHEMA_GATE`: **APROVADO PARA TESTE ISOLADO**, sem autorização de produção.
- `OWNER_VISUAL_GATE`: pendente para a ação web/Flutter.
- `OWNER_MOBILE_DEVICE_GATE`: pendente; nenhum APK foi publicado/distribuído.
- `OWNER_PRODUCTION_GATE`: pendente; zero mutações/deploys.
- `OWNER_MERGE_GATE`: pendente; a PR deve permanecer Draft.
- `OWNER_PILOT_GO_LIVE_GATE`: pendente; nenhum piloto real iniciado.

## 10. Critério de encerramento

Depois da aplicação em ambiente isolado e CI verde do HEAD exato, o estado pode
avançar para `CI_VALIDATED_PENDING_OWNER_VISUAL`. `ATIVO_PROD` e
`OPERATIONAL_PILOT_READY` não se aplicam a esta Draft PR.
