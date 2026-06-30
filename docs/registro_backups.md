# Registro de Backups — Matopiba Log

> Log de backups manuais. Veja o procedimento em [runbook_backup_restore.md](runbook_backup_restore.md).

## ⚠️ Regras deste arquivo (não violar)

Este arquivo é **versionado no Git**. Por isso, registre **apenas metadados**:

- ✅ Nome do arquivo de backup
- ✅ Data/hora do backup
- ✅ Item protegido (banco / comprovantes / avatars / env vars / migrations)
- ✅ Tamanho aproximado
- ✅ Referência **genérica** ao cofre (ex.: "Bitwarden — pasta Matopiba")

**NUNCA** coloque aqui:

- ❌ Caminho real/local exato do backup
- ❌ Conteúdo de dump, env vars, service key, JWT_SECRET, tokens
- ❌ Senhas ou qualquer valor sensível
- ❌ O próprio arquivo de dump (dumps ficam fora do repo)

---

## Histórico de backups

| Data/hora | Item | Nome do arquivo | Tamanho aprox. | Cofre (ref. genérica) | Pós-backup OK? |
|-----------|------|-----------------|----------------|------------------------|----------------|
| 2026-06-29 22:17 | Banco (schema) | `matopibalog_schema_2026-06-29.sql` | ~183 KB | Pasta local de backups (fora do repo) | ✅ |
| 2026-06-29 22:17 | Banco (dados) | `matopibalog_data_2026-06-29.sql` | ~424 KB | Pasta local de backups (fora do repo) | ✅ |
| 2026-06-29 22:17 | Banco (dump custom) | `matopibalog_full_2026-06-29.dump` | ~460 KB | Pasta local de backups (fora do repo) | ✅ |
| _(preencher)_ | Storage `comprovantes` | `backup_comprovantes_AAAA-MM-DD.zip` | — | — | ☐ |
| _(preencher)_ | Storage `avatars` (se existir) | `backup_avatars_AAAA-MM-DD.zip` | — | — | ☐ |
| _(preencher)_ | Env vars Railway | `railway_envvars_AAAA-MM-DD.txt` | — | — | ☐ |
| _(preencher)_ | Lista de migrations | `migrations_aplicadas_AAAA-MM-DD.txt` | — | — | ☐ |

> Copie o bloco de linhas acima a cada novo backup, com a data preenchida.

**Notas do backup de 2026-06-29 (banco):**
- Gerado com PostgreSQL tools **18.4** contra o servidor Supabase **PostgreSQL 17.6**.
- O `.dump` (formato custom) é o arquivo de restauração; os `.sql` (schema/dados) são auxiliares.
- Restauração **validada de verdade** — ver registro do teste no runbook (seção 8).
- A partir desta data o backup do **banco** roda **automatizado localmente** (tarefa agendada do Windows); ver runbook (seção 10). Os backups automáticos não são logados linha a linha aqui — esta tabela registra marcos manuais e validações.

---

## Checklist pós-backup (rodar a cada backup)

Marque só depois de conferir de verdade:

- [ ] Dump do banco **existe** (arquivo foi gerado)
- [ ] Dump **não está vazio** (tamanho > 0, abre e tem `CREATE TABLE`/`INSERT`)
- [ ] Storage `comprovantes` **foi baixado** (pasta/zip com as imagens)
- [ ] Storage `avatars` baixado **ou** confirmado que o bucket não existe
- [ ] Env vars do Railway **copiadas para o cofre** (não para o repo)
- [ ] Lista de migrations aplicadas **gerada a partir do banco real** (não dos arquivos do repo)
- [ ] **Nada** sensível foi colocado no Git (`git status` limpo de dumps/secrets)

---

## Notas sobre a lista de migrations

A lista de migrations **versionadas** no repositório **não reflete** o estado real do banco
(há lacunas: faltam 005, 006, 010; e estão espalhadas em `database/migrations/` e `backend/migrations/`).

Gere a lista real consultando o banco — ver seções 5.4 e 6.2 do runbook (colunas, funções e
policies). Salve essa saída como `migrations_aplicadas_AAAA-MM-DD.txt` no cofre.

---

## Próximo passo após o primeiro backup

✅ **Restore do banco validado em 2026-06-29** numa instância PostgreSQL 18 temporária e
descartável (não em produção) — 17 tabelas recuperadas, dados principais íntegros. Detalhes
e ressalvas técnicas na seção 8 do runbook.

Pendentes (itens separados, ainda manuais): backup do **Storage** (`comprovantes`/`avatars`)
e exportação das **env vars do Railway** para o cofre. A rotina manual (checklist + verificação
mensal) está em [backup_storage_env_vars.md](backup_storage_env_vars.md). A validação de restore
em um **projeto Supabase separado** com Storage continua recomendada quando esses itens forem
cobertos — usando só contas de teste (Alfa, Bravo, autônomos), nunca dados reais de cliente.
