# Legacy freight audit design

## Resultado da investigacao read-only

Nao ha infraestrutura generica adequada para auditar correcao manual futura de dados financeiros sensiveis de fretes.

`fretes_correcoes_auditoria` foi criada pela migration `033_cleanup_fretes_alfa_test_outliers.sql` para uma remediacao historica especifica: soft-cancel de 5 fretes de teste da Empresa Alfa. Ela preserva snapshot antes do cancelamento, mas nao modela uma correcao administrativa manual recorrente.

`funcionalidade_auditoria` e `publicar_matriz_funcionalidades()` mostram um bom padrao transacional para outro dominio, mas sao especificos do catalogo/matriz de funcionalidades. O uso best-effort de auditoria em alguns services/rotas tambem nao atende a alteracao financeira sensivel de frete, porque permitiria update sem trilha garantida.

Conclusao: HARD STOP estrutural para uso em producao do fluxo de recuperacao manual ate existir auditoria atomica.

## Por que `fretes_correcoes_auditoria` nao serve como esta

- Sem `empresa_id` dedicado.
- Sem `actor_user_id`.
- Sem `source`/interface.
- Sem `request_id`/correlation id.
- Sem `before` e `after` separados; possui apenas `snapshot`.
- Sem FK declarada para `fretes` ou `usuarios`.
- Sem RLS/policies declaradas na migration 033.
- `UNIQUE (frete_id, acao)` e util para uma remediacao idempotente, mas ruim para varias correcoes administrativas legitimas no mesmo frete.
- Nao distingue de forma estruturada migration historica, correcao manual de admin, importacao, suporte ou rollback.
- Nao garante atomicidade com o update de frete em fluxo de API.

## Status atuais do editor completo

| Status | Editavel hoje? | Risco | Recomendacao |
| --- | --- | --- | --- |
| `ativo` | Sim, via `PATCH /fretes/:id` e editor completo, se ownership e guardrails passarem. | Medio/alto: pode ser necessario operacionalmente, mas altera insumos financeiros. | Permitir somente por RPC auditada atomica, com reason obrigatorio e before/after. |
| `cancelado` | Sim hoje; a tela lista cancelados e permite abrir o modal de edicao. | Alto: preservacao historica tende a ser preferivel; pode reescrever dado de um registro que saiu dos agregados. | Bloquear alteracao financeira por padrao, salvo papel/fluxo excepcional auditado. |
| `finalizado` | Sim em tese pelo endpoint de update; a UI tambem tem acao de editar em linhas finalizadas. | Muito alto: altera resultado financeiro historico e relatorios. | Bloquear alteracao financeira por padrao; liberar apenas por fluxo formal de correcao/estorno auditado. |

A politica implementada neste gate permite correcao financeira somente para `ativo` e `pendente`. `cancelado` e `finalizado` retornam `frete_financial_correction_status_locked` e permanecem read-only para este fluxo.

## Migration implementada

Numero: `065_fretes_financeiro_auditoria.sql`.

Motivo: `063` permanece reservado para #416 e `064` para SEC-1; `065` estava livre no branch integrado.

### Schema proposto

```sql
CREATE TABLE public.fretes_financeiro_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frete_id uuid NOT NULL REFERENCES public.fretes(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  reason text NOT NULL,
  source text NOT NULL,
  request_id text NOT NULL,
  correction_type text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fretes_fin_aud_reason_chk CHECK (length(btrim(reason)) >= 8 AND length(reason) <= 500),
  CONSTRAINT fretes_fin_aud_source_chk CHECK (length(btrim(source)) >= 3 AND length(source) <= 64),
  CONSTRAINT fretes_fin_aud_request_id_chk CHECK (length(btrim(request_id)) >= 8 AND length(request_id) <= 128),
  CONSTRAINT fretes_fin_aud_correction_type_chk CHECK (length(btrim(correction_type)) >= 3 AND length(correction_type) <= 64)
);

CREATE INDEX idx_fretes_fin_audit_frete ON public.fretes_financeiro_auditoria (frete_id, created_at DESC);
CREATE INDEX idx_fretes_fin_audit_empresa ON public.fretes_financeiro_auditoria (empresa_id, created_at DESC);
CREATE UNIQUE INDEX idx_fretes_fin_aud_idempotency
  ON public.fretes_financeiro_auditoria (source, request_id);
```

Snapshots devem incluir somente campos relevantes:

- `modalidade_calculo`
- `toneladas`
- `valor_tonelada_km`
- `valor_frete`
- `km_inicial`
- `km_final`
- `status`

Nao guardar tokens, cookies, secrets ou payload bruto de sessao.

## RPC/transacao implementada

Criar uma RPC `public.corrigir_frete_financeiro_legacy(...)` com:

- `SECURITY INVOKER`.
- `search_path` fixo.
- `EXECUTE` revogado de `PUBLIC`, `anon` e `authenticated`.
- `EXECUTE` somente para `service_role`.
- Autorizacao HTTP mantida no backend.

Fluxo atomico:

1. Receber `frete_id`, patch permitido, `actor_user_id`, `reason`, `source`, `request_id`.
2. Validar `reason` obrigatorio.
3. `SELECT ... FOR UPDATE` do frete.
4. Validar `empresa_id`/ownership no backend antes da RPC ou dentro dela por parametro confiavel.
5. Montar `before_snapshot`.
6. Aplicar patch allowlisted ja preparado pela API; a formula canonica continua no backend JS.
7. Atualizar `fretes`.
8. Montar `after_snapshot`.
9. Inserir `fretes_financeiro_auditoria`.
10. Commit unico.

Nao aceitar desenho `UPDATE fretes` seguido de auditoria best-effort.

## RLS e grants

- Habilitar RLS na tabela de auditoria.
- Sem policies para `anon`/`authenticated` inicialmente; leitura e escrita via backend service role.
- Se houver leitura futura no painel, criar endpoint backend super-admin/admin-tenant com filtros por `empresa_id`; nao expor tabela diretamente.
- Revogar grants diretos de `anon`/`authenticated`.

## Testes propostos

- RPC grava update + auditoria em uma transacao.
- Falha no insert de auditoria faz rollback do update.
- `request_id` torna chamada idempotente quando enviado.
- `reason` vazio rejeita.
- `before_snapshot` e `after_snapshot` contem os campos exigidos.
- Nao persiste cookies/tokens/secrets.
- Admin comum nao corrige frete de outro tenant.
- `cancelado` e `finalizado` retornam `frete_financial_correction_status_locked`.

## Checklist visual posterior

- Desktop, intermediario e mobile web.
- Detalhe motorista com fixture legado ativo/pendente controlado.
- Tentar editar KM do legado.
- Ver `422` visivel e sem alert generico.
- CTA `Editar frete completo` aparece apenas quando campo financeiro nao e editavel inline.
- CTA abre o mesmo frete/contexto.
- Campo `245` fica destacado.
- Salvar permanece bloqueado sem valor valido.
- Cancelar fecha modal e preserva dado.
- Fixture com valor valido conhecido remove erro e permite salvar via fluxo auditado.

