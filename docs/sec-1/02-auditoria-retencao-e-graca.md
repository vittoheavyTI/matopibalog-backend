# SEC-1 — Auditoria de auth, retenção e janela de graça (decisões pré-Gate A)

> Complementa a ADR. Documenta pontos que **não** viram rotina automática nesta etapa
> e que serão ratificados no **Gate A**.

## 1. `auth_event_audit` — append-only REAL
- **Imutável para a aplicação**: triggers bloqueiam `UPDATE`/`DELETE` (BEFORE … FOR EACH ROW) e `TRUNCATE` (BEFORE TRUNCATE FOR EACH STATEMENT) para **qualquer papel** (bypassrls não contorna trigger). `service_role` recebe só **INSERT + SELECT** (REVOKE UPDATE/DELETE/TRUNCATE) e **não é owner** (ALTER/DISABLE TRIGGER → 42501). Provado em Postgres real (CI 45/45).
- **Nunca armazena**: token, hash de token, cookie, header Authorization, OTP, senha, e-mail de login falho, stack trace completa, payload bruto. Campos textuais têm **limite de tamanho** (event≤64, motivo≤500, user_agent≤512, ip_hash≤128, etc.). `ip_hash` = IP **mascarado/hasheado**; `user_agent` reduzido.
- **Eventos sem sessão** (ex.: `login_falha`) são suportados: `usuario_id/empresa_id/session_id/refresh_family_id` são nullable.

## 2. Retenção (documentada; SEM rotina automática nesta etapa)
- **Append-only ≠ retenção infinita**, mas **não** criamos purge automático agora (decisão explícita no Gate A).
- **Nenhuma limpeza de `auth_event_audit` é executada pelo backend normal** (o `service_role` sequer tem DELETE/TRUNCATE). `limpar_sessoes_expiradas()` toca **só `auth_sessions`**, nunca a auditoria.
- **Proposta a ratificar no Gate A:**
  - **Período de retenção**: 180–365 dias online (a definir), depois arquivamento.
  - **Crescimento estimado**: eventos por login/refresh/logout/revogação. Refresh a cada ~`AUTH_ACCESS_TOKEN_TTL` (~10 min) por sessão ativa → estimar `sessões_ativas × (60/TTL_min) × 24 × dias` linhas; dimensionar antes de ligar refresh em produção.
  - **Índices**: já criados (`usuario_id`, `session_id`, `refresh_family_id`, `created_at`, `event`).
  - **Purge controlado futuro**: função `SECURITY DEFINER` executada por um **papel de manutenção separado** (não o backend), que **desabilita o trigger sob controle**, arquiva/expurga por faixa de `created_at`, e **audita a própria manutenção** (quem/quando/quantas linhas). NÃO implementado nesta etapa.

## 3. Janela de graça (rotação)
- **Somente server-side**: `p_grace_seconds` vem de **config do backend** (env), **nunca do frontend/token/tenant/usuário**. Validada **dentro da função** na faixa **[0, 300]s** (NULL/negativo/>300 → erro `grace_invalido`).
- **Fallback documentado**: default de código **10s** se a config estiver ausente (o backend resolve o valor antes de chamar a RPC; a RPC ainda revalida a faixa).
- **A aprovar no Gate A**: valor final (proposta 10s), mínimo/máximo. Não gravado no token; não alterável por tenant.
- **Relógio**: a RPC usa `now()` do PostgreSQL (transaction_timestamp) — **sem relógio injetável**. Nenhum `used_at`/deadline/classificação de colisão vem do HTTP.

## 4. Mapeamento de resultado → HTTP (backend, task F)
A RPC retorna resultado estruturado (auditoria sobrevive; sem RAISE de domínio). O backend mapeia:
`ok → 200` · `refresh_already_rotated → 409` · `reuse_detected → 401` · `expirado/revogado/sessao_invalida/invalido → 401` · falha SQL inesperada → **500 sanitizado**. A RPC nunca retorna hash/refresh aberto/pepper/cookie.
