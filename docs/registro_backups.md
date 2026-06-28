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
| _(preencher)_ | Banco (dump SQL) | `backup_AAAA-MM-DD.sql` | — | — | ☐ |
| _(preencher)_ | Storage `comprovantes` | `backup_comprovantes_AAAA-MM-DD.zip` | — | — | ☐ |
| _(preencher)_ | Storage `avatars` (se existir) | `backup_avatars_AAAA-MM-DD.zip` | — | — | ☐ |
| _(preencher)_ | Env vars Railway | `railway_envvars_AAAA-MM-DD.txt` | — | — | ☐ |
| _(preencher)_ | Lista de migrations | `migrations_aplicadas_AAAA-MM-DD.txt` | — | — | ☐ |

> Copie o bloco de 5 linhas acima a cada novo backup, com a data preenchida.

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

Validar o restore num **projeto Supabase separado** (seção 8 do runbook), usando só contas de
teste (Alfa, Bravo, autônomos) — nunca dados reais de cliente.
