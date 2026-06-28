# Runbook de Backup e Restore — Matopiba Log

> **Data:** 2026-06-28
> **Versão:** 1.0
> **Status:** Esboço inicial — pendente de primeiro teste real.

---

## 1. Objetivo

Este runbook documenta os procedimentos manuais de backup e restauração do Matopiba Log
para garantir continuidade operacional antes e durante o primeiro cliente real.

**Não automatiza nada.** A automação (backup diário, cron, GitHub Action) fica para
uma fase posterior, após a validação manual do processo.

> ⚠️ **Cache não substitui backup.** O cache (CDN/HTTP, cache offline do app,
> respostas em memória) apenas **acelera leitura** — ele NÃO é cópia de segurança
> e some/expira sem aviso. A **fonte de verdade** é sempre o **banco (Supabase)**
> e o **Storage (buckets)**. Um restore completo precisa recuperar **banco +
> arquivos do Storage + variáveis de ambiente** — nenhum cache reconstrói esses dados.

---

## 2. O que precisa ser protegido

### 2.1 Banco de dados (crítico)

| Item | Localização | Risco se perdido |
|------|-------------|------------------|
| Tabelas de negócio | Supabase (PostgreSQL) | Perda total de fretes, despesas, abastecimentos, vales, motoristas, empresas |
| Usuários e autenticação | Supabase (Auth + public.usuarios) | Perda de acesso de todos os usuários |
| Faturas e cobranças | Supabase (public.faturas) | Perda de controle de billing |
| Configurações | Supabase (public.configuracoes + empresas.config_empresa) | Perda de personalização e integrações |
| Termos LGPD | Supabase (public.termos, public.termos_aceites) | Perda de aceites legais |

### 2.2 Storage (crítico)

| Bucket | Conteúdo | Risco se perdido |
|--------|----------|------------------|
| `comprovantes` | Fotos de despesas e abastecimentos | Evidência financeira irrecuperável. Auditorias comprometidas. |
| `avatars` | Fotos de perfil de usuários | Substituível (baixo risco) |

### 2.3 Configuração (crítico)

| Item | Local | Risco se perdido |
|------|-------|------------------|
| SUPABASE_URL | Railway env vars | Backend não conecta ao banco |
| SUPABASE_SERVICE_KEY | Railway env vars | Backend sem acesso ao banco |
| JWT_SECRET | Railway env vars | Tokens existentes invalidados |
| ASAAS_API_KEY | Config global (banco) + Railway fallback | Cobranças param de funcionar |
| ASAAS_WEBHOOK_TOKEN | Railway env vars | Webhook rejeitado |
| FRONTEND_URL | Railway env vars | CORS quebra |

### 2.4 Migrations (importante)

| Item | Local |
|------|-------|
| SQLs versionados | `backend/migrations/` (18 arquivos, 001 a 018) |
| Aplicação | Manual no Supabase SQL Editor — **sem controle automatizado** |

### 2.5 Deploy (importante)

| Item | Localização |
|------|-------------|
| Backend | Railway — deploy automático via push na main |
| Frontend | GitHub Pages — deploy via GitHub Actions |
| Domínio | matopibalog.com.br — DNS na Hostinger |

---

## 3. O que NÃO deve ser commitado

**Nenhum destes valores pode aparecer em commits, docs versionados ou logs:**

| O quê | Onde vaza com mais frequência |
|------|-------------------------------|
| SUPABASE_SERVICE_KEY | Código, scripts de diagnóstico, `.env` comitado |
| JWT_SECRET | Exemplos, `AGENTS.md`, `docs/` |
| ASAAS_API_KEY / ASAAS_WEBHOOK_TOKEN | Exemplos de requisição, logs |
| Token Netlify/GitHub | Scripts de deploy, CI logs |
| Dumps reais do banco | Backup em local público |
| Senha admin temporária | Scripts de setup |

**Regra:** qualquer arquivo comitado que contenha `supabaseKey`, `supabase_service_key`,
`jwt_secret` ou similar deve usar `SEU_SUPABASE_KEY_AQUI` ou `{{placeholder}}`.

---

## 4. Backup manual

### 4.1 Banco de dados

**Opção A — Supabase Dashboard:**

1. Acessar o Supabase Dashboard → Projeto → Database → Database Functions → "Database Dump"
2. Selecionar formato `SQL` (não `Directory`)
3. Marcar "Include data" (não apenas schema)
4. Salvar arquivo em local seguro (ex.: storage externo, não no mesmo provedor)

**Opção B — pg_dump via CLI:**

> Requer `pg_dump` instalado localmente.

```bash
pg_dump \
  --host=<SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --format=plain \
  --no-owner \
  --no-acl \
  --file=backup_$(date +%Y-%m-%d).sql
```

- `--no-owner` / `--no-acl` evita erros de permissão no restore (usuários diferentes).
- Proteger o arquivo gerado: contém dados reais.

**Opção C — Supabase CLI (recomendado para automação futura):**

```bash
supabase db dump --linked > backup_$(date +%Y-%m-%d).sql
```

### 4.2 Storage

**Bucket `comprovantes`:**

```bash
# Via Supabase CLI
supabase storage download comprovantes ./backup_comprovantes/

# Ou manualmente via Dashboard
# Supabase → Storage → comprovantes → Download All
```

Bucket `avatars` segue o mesmo padrão, mas o risco de perda é menor.

### 4.3 Variáveis de ambiente

Lista **(sem valores)** das variáveis que devem estar configuradas:

| Variável | Obrigatória | Origem |
|----------|-------------|--------|
| `SUPABASE_URL` | Sim | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Sim | Supabase Dashboard → Settings → API (service_key, **não** anon_key) |
| `JWT_SECRET` | Sim | Gerado localmente, configurado no Railway |
| `FRONTEND_URL` | Sim | URL de produção do frontend |
| `ASAAS_WEBHOOK_TOKEN` | Condicional | Configurado manualmente |
| `NODE_ENV` | Sim | `production` em prod |

**Exportar do Railway:**

```bash
# Railway Dashboard → Project → Variables → Export
```

Manter o arquivo exportado em cofre de senhas (Bitwarden, 1Password, etc.),
**nunca** no repositório.

---

## 5. Restore manual

### Visão geral

```
1. Incidente → banco perdido ou corrompido
2. Criar novo projeto Supabase (mesma região, plano equivalente)
3. Restaurar dump SQL
4. Restaurar Storage
5. Atualizar env vars no Railway
6. Testar backend
7. Testar painel web
8. Testar app Android
```

### Passo a passo

#### 5.1 Criar novo projeto Supabase

1. Acessar [supabase.com](https://supabase.com) → New project
2. Selecionar a **mesma região** do projeto original (evitar latência extra)
3. Escolher plano equivalente ao original (confirmar no contrato)
4. Anotar a nova `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`

#### 5.2 Restaurar banco

```bash
psql \
  --host=<NOVO_SUPABASE_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --file=backup_<DATA>.sql
```

Erros comuns:
- `role "postgres" does not exist` → usar `--no-owner` no dump
- `permission denied` → criar o schema antes se o dump não incluir

#### 5.3 Restaurar Storage

```bash
supabase storage cp --recursive backup_comprovantes/ dst://comprovantes/
```

**Verificar:** as URLs públicas no banco (coluna `foto_url`) apontam para o mesmo
bucket name (`comprovantes`). Se o novo projeto tiver o mesmo nome de bucket,
as URLs continuam válidas.

#### 5.4 Aplicar migrations pendentes

Migrations são aplicadas manualmente no Supabase SQL Editor.
Verificar quais já estão no dump (rodar `SELECT * FROM termos LIMIT 1;` etc.).

Migrations que precisam de aplicação manual (confirmar se já estão no dump):

- 015: `ENABLE ROW LEVEL SECURITY` + helpers + policies
- 016: `DROP POLICY IF EXISTS` para policies legadas
- 017: policies de faturas
- 018: `client_request_id`

Para verificar se uma migration já foi aplicada:

```sql
-- Exemplo: ver se helpers da 015 existem
SELECT * FROM pg_proc WHERE proname = 'rls_is_super_admin';
-- Exemplo: ver se coluna da 018 existe
SELECT column_name FROM information_schema.columns
WHERE table_name='despesas' AND column_name='client_request_id';
```

#### 5.5 Configurar env vars no Railway

1. Railway Dashboard → Project → Variables
2. Substituir:
   - `SUPABASE_URL` → URL do novo projeto
   - `SUPABASE_SERVICE_KEY` → service key do novo projeto
   - Demais variáveis mantêm os mesmos valores
3. Redeploy automático (ou manual em Deployments → Redeploy)

#### 5.6 Testar backend

Após o deploy do Railway:

```bash
curl https://matopibalog-backend-production.up.railway.app/health
# Esperado: {"status":"UP","timestamp":"..."}
```

#### 5.7 Testar painel web

1. Acessar https://matopibalog.com.br
2. Fazer login com admin conhecido
3. Verificar: Dashboard → fretes carregam? Despesas aparecem?
4. Verificar: Gerenciamento → fretes ativos
5. Verificar: Relatórios → PDF gera?

#### 5.8 Testar app Android

1. Abrir app → login
2. Verificar: fretes carregam na Home
3. Verificar: despesas/abastecimentos carregam
4. Verificar: comprovantes aparecem (imagens do Storage)

---

## 6. Checklist pós-restore

### 6.1 Infraestrutura

| Item | Como verificar |
|------|----------------|
| Backend rodando | `curl /health → 200` |
| Frontend servindo | HTTP status 200 no domínio |
| CORS funcionando | Login pelo painel |
| Env vars corretas | Railway Dashboard → Variables |

### 6.2 Banco

| Item | Como verificar |
|------|----------------|
| Dados restaurados | `SELECT count(*) FROM fretes;` |
| RLS ativo nas tabelas críticas | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` |
| Helpers RLS existem | `SELECT * FROM pg_proc WHERE proname LIKE 'rls_%'` |
| Policies corretas | `SELECT policyname, tablename FROM pg_policies WHERE schemaname='public'` |
| Faturas com RLS | Confirmar `faturas_superadmin_all` + `faturas_empresa_select` existem |
| `client_request_id` presente | `SELECT column_name FROM information_schema.columns WHERE table_name='despesas' AND column_name='client_request_id'` |

### 6.3 Storage

| Item | Como verificar |
|------|----------------|
| Bucket comprovantes existe | Supabase Dashboard → Storage |
| Fotos acessíveis | `curl <foto_url>` de uma despesa → 200 |
| Fotos de perfil acessíveis | `curl <avatar_url>` de um usuário → 200 |

### 6.4 Funcional

| Item | Como verificar |
|------|----------------|
| Login admin | Autenticar no painel |
| Fretes listados | GET /fretes retorna dados |
| Despesas com comprovante | GET /despesas → foto_url não nula |
| Abastecimentos listados | GET /abastecimentos retorna dados |
| Vales listados | GET /vales retorna dados |
| Criação de despesa | POST /despesas → 201 |
| Idempotência ativa | POST /despesas repetido com mesmo `client_request_id` → não duplica |
| Relatório PDF | Gerar PDF no painel |
| Webhook Asaas | POST /pagamentos/webhook/asaas → 401 sem token (esperado; rota confirmada em backend/routes/pagamentos.js) |

---

## 7. Frequência recomendada

| Tipo | Frequência | Retenção |
|------|-----------|----------|
| Backup completo do banco | Diário | 30 dias |
| Backup do Storage | Semanal | 90 dias |
| Exportação de env vars | A cada alteração | Sempre a última versão |
| Teste de restore | Mensal | — |

**Nota:** backup diário = dump SQL + storage. Pode ser automatizado com cron
ou GitHub Actions após validação manual do processo.

---

## 8. Plano de teste de restore

Para validar que o backup funciona **antes** de precisar dele:

1. Criar projeto Supabase **separado** (gratuito ou PRO por 1 mês)
2. Restaurar o dump SQL mais recente
3. Restaurar o Storage mais recente
4. Rodar o checklist pós-restore (seção 6)
5. Se tudo passar, descartar o projeto separado

**Não usar dados reais de clientes no teste.**
Usar apenas as contas de teste (Alfa, Bravo, autônomos).

---

## 9. Riscos conhecidos

| Risco | Mitigação |
|-------|-----------|
| Dump SQL não inclui usuários do Auth (auth.users) | O dump padrão do Supabase NÃO inclui a tabela `auth.users`. Se for necessário recriar identidades, exportar `auth.users` separadamente. Isto significa que senhas não são restauradas — todos os usuários precisarão resetar senha via "Esqueceu senha". |
| Bucket comprovantes pode ter permissões diferentes | Verificar RLS do bucket Storage após restore. O dump do banco não inclui configurações de bucket. |
| Service role key do novo projeto é diferente | Atualizar no Railway. |
| Domínios/CORS podem precisar de reconfiguração | Verificar configuração de autenticação no novo projeto Supabase. |
| Migrations podem ter sido aplicadas parcialmente | Sempre verificar colunas/funções/policies antes de reaplicar. |

---

## 10. O que fica para automação futura

| Item | Prioridade |
|------|-----------|
| Script `scripts/backup.sh` — executa pg_dump + storage dump | Alta |
| GitHub Action semanal de backup | Alta |
| GitHub Action mensal de restore test | Média |
| Migration runner automatizado | Média |
| Export automático de env vars | Baixa |
| Monitoramento com alerta de falha de backup | Baixa |
| Backup para storage externo (S3/Backblaze/GCS) | Baixa |

---

## Apêndices

### A. Comandos úteis

```bash
# Verificar RLS ativo
psql -h <host> -U postgres -d postgres -c "
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;
"

# Verificar políticas
psql -h <host> -U postgres -d postgres -c "
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public' ORDER BY tablename;
"

# Contagem rápida de linhas (aproximada)
psql -h <host> -U postgres -d postgres -c "
SELECT relname AS tabela, n_live_tup AS linhas
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
"

# Listar buckets Storage
supabase storage list
```

### B. Contatos de emergência

| Serviço | Contato |
|----------|---------|
| Supabase Support | https://supabase.com/support |
| Railway Support | https://railway.app/support |
| GitHub Support | https://support.github.com |
