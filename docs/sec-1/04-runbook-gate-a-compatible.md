# SEC-1 - Runbook do Gate A Compatible

Status: preparado para Gate A Compatible apos conclusao do Gate A0 em
2026-08-09. Nao executar em ambiente compartilhado sem autorizacao explicita do
Gate A. PR #414 permanece draft / NAO MERGEAR.

## Escopo

Ativar SEC-1 em modo compatible:

- `AUTH_SESSIONS_ENABLED=true`
- `AUTH_REFRESH_ROTATION_ENABLED=true`
- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`

Fora do Gate A:

- Gate B / strict.
- `AUTH_REQUIRE_SESSION=true`.
- `AUTH_ALLOW_LEGACY_TOKENS=false`.
- `AUTH_LEGACY_TOKEN_CUTOFF`.
- invalidacao deliberada de tokens legacy.
- merge do PR #414.
- 3A, Asaas, mudancas comerciais ou mudanca de base URL mobile.

## Pre-condicoes obrigatorias

- PR #414 em draft, com HEAD aprovado e CI verde.
- `origin/main` revalidado antes do Gate A.
- Gate A0 concluido em producao:
  - frontend `https://matopibalog.com.br`;
  - API `https://api.matopibalog.com.br`;
  - `VITE_API_URL=https://api.matopibalog.com.br`;
  - cookie web `HttpOnly; Secure; SameSite=Lax; Path=/auth`, host-only, sem
    `Domain`.
- Migration `062_auth_sessions_revogaveis.sql` validada em PostgreSQL efemero
  no CI.
- Nenhuma alteracao pendente de `painel_web/dist` incluida sem auditoria de
  publicacao.
- Conta/sessao controlada disponivel para provas web, mobile e admin.
- Token legacy valido capturado antes da ativacao, sem registrar o valor.
- Janela de observacao definida antes de qualquer deploy/ativacao.

## Variaveis de ambiente

Valores propostos no Gate A, sem segredos no repositorio. Valores atuais devem
ser confirmados no Railway antes da execucao; o relatorio deve registrar apenas
`AUSENTE`, `TRUE`, `FALSE` ou `PRESENTE` para variaveis sensiveis.

| VAR | Valor atual esperado pre-Gate A | Valor compatible aprovado | Sensivel? | Onde configurar | Rollback |
| --- | --- | --- | --- | --- | --- |
| `JWT_SECRET` | Existente no Railway | Manter valor atual | Sim | Railway backend env | Manter valor atual; nao rotacionar no Gate A |
| `AUTH_REFRESH_TOKEN_PEPPER` | ausente | novo segredo forte backend-only | Sim | Railway backend env | Manter armazenado; nao expor; desabilitar via flags |
| `AUTH_SESSIONS_ENABLED` | ausente ou `false` | `true` | Nao | Railway backend env | `false` |
| `AUTH_REFRESH_ROTATION_ENABLED` | ausente ou `false` | `true` | Nao | Railway backend env | `false` |
| `AUTH_REQUIRE_SESSION` | ausente ou `false` | `false` | Nao | Railway backend env | `false` |
| `AUTH_ALLOW_LEGACY_TOKENS` | ausente ou `true` | `true` | Nao | Railway backend env | `true` |
| `AUTH_REFRESH_COOKIE_SAMESITE` | `lax` desde Gate A0 | `lax` | Nao | Railway backend env | `lax` |
| `AUTH_WEB_ALLOWED_ORIGINS` | `https://matopibalog.com.br` | `https://matopibalog.com.br` | Nao, mas operacional | Railway backend env | Voltar ao valor anterior aprovado |
| `AUTH_TOKEN_ISSUER` | default possivel | `matopibalog` | Nao | Railway backend env | Voltar ao valor anterior |
| `AUTH_TOKEN_AUDIENCE` | default possivel | `matopibalog-clients` | Nao | Railway backend env | Voltar ao valor anterior |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | default `600` se ausente | `600` | Nao | Railway backend env | Voltar ao valor anterior |
| `AUTH_REFRESH_IDLE_TTL_SECONDS` | nao usar default `1800` em producao | `604800` | Nao | Railway backend env | Voltar ao valor anterior |
| `AUTH_REFRESH_ABSOLUTE_TTL_SECONDS` | default `2592000` se ausente | `2592000` | Nao | Railway backend env | Voltar ao valor anterior |
| `AUTH_REFRESH_REUSE_GRACE_SECONDS` | default `10` se ausente | `10` | Nao | Railway backend env | Voltar ao valor anterior |
| `AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS` | default `60` se ausente | `60` | Nao | Railway backend env | Voltar ao valor anterior |
| `VITE_API_URL` | `https://api.matopibalog.com.br` | `https://api.matopibalog.com.br` | Nao secreto, mas configura deploy web | GitHub Actions secret Pages | Nao voltar ao Railway salvo rollback explicito |

Nao adicionar previews, localhost ou origens extras automaticamente em producao.

## Politica TTL Compatible

Nao usar `AUTH_REFRESH_IDLE_TTL_SECONDS=1800` em producao.

Politica aprovada:

- `AUTH_ACCESS_TOKEN_TTL_SECONDS=600`
- `AUTH_REFRESH_IDLE_TTL_SECONDS=604800`
- `AUTH_REFRESH_ABSOLUTE_TTL_SECONDS=2592000`
- `AUTH_REFRESH_REUSE_GRACE_SECONDS=10`
- `AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS=60`

Racional:

- access curto: 10 minutos;
- idle de 7 dias preserva comportamento historico proximo ao JWT legado;
- absolute de 30 dias limita a sessao;
- sessao continua revogavel server-side;
- `manterConectado=false` continua memory-only no mobile.

Obrigatorio provar que `idle <= absolute` e que a rotacao usa o menor limite
entre expiracao do refresh e `absolute_expires_at`.

## Ordem segura de execucao

1. Confirmar SHA do PR, SHA de `origin/main`, status e PR draft.
2. Corrigir runbook Gate A.
3. Confirmar CI verde: backend, frontend, PostgreSQL RPC, Browser E2E e Flutter.
4. Capturar baseline de producao sem expor secrets.
5. Capturar token legacy valido antes da ativacao, sem registrar o valor.
6. Confirmar alvo Supabase/Postgres correto.
7. Aplicar migration 062 no banco compartilhado aprovado.
8. Validar schema, RLS, grants, append-only audit e RPCs.
9. Gerar e configurar pepper forte backend-only.
10. Configurar variaveis compatible.
11. Deployar exatamente o SHA aprovado do PR #414.
12. Validar `/health`, startup auth summary e logs sem segredo.
13. Executar provas legacy, web SEC-1, refresh, duas abas, reuse controlado,
    logout, sessoes, admin e mobile release.
14. Observar producao.
15. Documentar resultado e manter PR draft.

Se Railway agrupar env change e redeploy, documentar a sequencia real e manter
rollback equivalente.

## Migration 062

Migration autorizada para Gate A:

- `backend/migrations/062_auth_sessions_revogaveis.sql`

Antes:

- confirmar project/database alvo;
- confirmar ausencia de `auth_sessions`, `auth_refresh_tokens`,
  `auth_event_audit` e RPCs SEC-1, ou parar se houver estado inesperado.

Depois:

- tabelas existem;
- PKs, FKs, constraints e indexes existem;
- RLS `ENABLE` e `FORCE`;
- `anon` e `authenticated` sem acesso indevido;
- `service_role` com permissao necessaria:
  - `auth_sessions`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`;
  - `auth_refresh_tokens`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`;
  - `auth_event_audit`: `SELECT`, `INSERT`, sem `UPDATE`, `DELETE` ou
    `TRUNCATE`.

## Audit append-only

Provar com fixture controlado, sem dados reais:

- `UPDATE auth_event_audit` bloqueado;
- `DELETE auth_event_audit` bloqueado;
- `TRUNCATE auth_event_audit` bloqueado.

Remover fixture se a prova deixar sujeira indevida. Se um evento auditavel for
necessario para evidencia, registrar apenas ids e contagens, nunca payload
sensivel.

## RPCs

Confirmar existencia e permissoes de:

- `criar_sessao_auth`
- `rotacionar_refresh_token`
- `revogar_sessao_auth`
- `revogar_sessoes_usuario`
- `limpar_sessoes_expiradas`

`EXECUTE` somente para o papel backend autorizado. Nao conceder `anon` ou
`authenticated`.

## Prova legacy critica

Usar token legacy capturado antes da ativacao.

Depois de Compatible:

- legacy legitimo continua autenticando;
- token SEC-1 malformado com `sid` presente e `jti` ausente nao sofre downgrade
  para legacy e e rejeitado.

Nao registrar tokens no relatorio.

## Provas web obrigatorias

- Novo login em browser real depois da ativacao.
- Access token novo contem contrato SEC-1: `sub`, `uid`, `sid`, `jti`,
  `token_use=access`, `iss`, `aud`, `exp`.
- Duracao de access em torno de 600 segundos.
- Cookie `refresh_token` provado via Network/Application:
  - `HttpOnly`;
  - `Secure`;
  - `SameSite=Lax`;
  - `Path=/auth`;
  - host-only em `api.matopibalog.com.br`;
  - sem `Domain`.
- Refresh token nao aparece em localStorage.
- Refresh token nao aparece no JSON web.
- Nao usar `document.cookie` como prova de cookie HttpOnly.
- `/auth/refresh` usa cookie, sem Bearer de refresh, retorna novo access,
  rotaciona refresh e usa `Cache-Control: no-store`.
- CORS/CSRF continuam exatos.

A arquitetura do Gate A0 nao depende de third-party cookie; portanto, cookies
de terceiros permitidos/bloqueados nao sao dependencia operacional do Gate A.

## Duas abas

Validar concorrencia real ou automatizada:

- Tab A e Tab B na mesma sessao;
- uma refresh vence;
- a outra pode receber `RefreshAlreadyRotated`;
- nenhuma logout indevido;
- sessao continua valida;
- proximas chamadas funcionam.

## Reuse

Usar somente cenario controlado.

Provar:

- reapresentacao fora da grace gera `RefreshReuseDetected`;
- familia/sessao e revogada conforme contrato;
- nao executar na sessao operacional do usuario.

## Logout e sessoes

WEB:

- `POST /auth/logout`;
- revogacao server-side;
- cookie limpo;
- access/refresh subsequentes rejeitados conforme contrato;
- novo login depois funciona.

Sessoes:

- listar sessoes;
- revogar sessao individual;
- `logout-all`;
- sessao estrangeira nao pode ser revogada;
- auditoria correspondente existe.

## Status de usuario

Com fixture controlado, sem alterar usuario produtivo operacional:

- bloqueio/desativacao real revoga sessoes;
- mudanca autorizativa de role revoga sessoes conforme contrato;
- alteracao de senha revoga sessoes conforme contrato;
- restaurar fixture quando necessario.

## Mobile release

Validacao mobile deve usar APK release, nao `app-debug.apk`.

Preferir artifact release do HEAD atual. Se o HEAD atual tiver apenas mudanca
documental desde o ultimo artifact funcional, registrar equivalencia de source.

Executar:

- `flutter analyze`
- `flutter test`
- `flutter build apk --release`

Nao alterar `signingConfig` neste Gate.

Validar no release:

- login;
- sessao criada;
- refresh mobile no canal correto;
- secure storage;
- `manterConectado=true`;
- minimizar/reabrir;
- fechar/reabrir;
- refresh;
- offline/online;
- logout remoto;
- reabrir sem sessao apos logout.

Tambem validar:

- `manterConectado=false`;
- usar normalmente;
- provocar refresh;
- fechar completamente;
- reabrir;
- nao auto-logar.

Nao mudar base URL mobile neste Gate.

## Admin / regressao

Validar autenticado:

- dashboard;
- empresas;
- usuarios;
- planos;
- contratos/rotas existentes relevantes;
- demais telas administrativas sensiveis.

Prioridade: funcionamento, sem alteracoes destrutivas de dados.

## Auditoria

Confirmar eventos esperados, usando fixtures quando necessario:

- `sessao_criada`
- `refresh_sucesso`
- `refresh_colisao`
- `refresh_reuse`
- `sessao_revogada`
- `sessoes_usuario_revogadas`

## Zero segredos em logs

Logs nao podem conter:

- refresh plaintext;
- refresh hash;
- pepper;
- cookie completo;
- Authorization header;
- JWT completo;
- senha;
- OTP;
- service key.

Se aparecer qualquer segredo: incidente. Parar e corrigir antes de declarar
Gate A PASS.

## Observacao

Apos ativacao, observar:

- health;
- 5xx;
- 401/403 anomalos;
- 409 refresh collisions;
- 429;
- CORS;
- CSRF;
- latencia;
- login;
- refresh;
- logout;
- mobile.

Nao tratar respostas esperadas de testes negativos como incidente.

## Rollback autorizado

Se houver regressao critica, primeiro rollback logico:

- `AUTH_SESSIONS_ENABLED=false`
- `AUTH_REFRESH_ROTATION_ENABLED=false`
- `AUTH_REQUIRE_SESSION=false`
- `AUTH_ALLOW_LEGACY_TOKENS=true`

Manter:

- `api.matopibalog.com.br`;
- A0 publicado;
- migration 062 instalada se recebeu qualquer dado real;
- pepper armazenado sem exposicao.

Restaurar backend SHA anterior somente se necessario. Nao dropar tabelas com
dados reais sem decisao explicita.

## Criterio Gate A PASS

Gate A so pode ser declarado concluido se:

- migration 062 aplicada;
- schema/RLS/grants validados;
- audit append-only validado;
- RPCs e permissoes validadas;
- pepper presente;
- backend no SHA aprovado;
- `authMode=compatible`;
- novo login SEC-1 funcionando;
- legacy anterior continua funcionando;
- cookie Lax same-site funciona;
- refresh funciona;
- duas abas funciona;
- logout funciona;
- mobile release funciona;
- admin regression funciona;
- audit funciona;
- zero segredo em logs;
- producao estavel;
- CI completa verde.

Mesmo com Gate A PASS, PR #414 continua draft / NAO MERGEAR.
