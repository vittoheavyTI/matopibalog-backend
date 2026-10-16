# Backup de Storage e Variáveis de Ambiente — Matopiba Log

> Rotina **manual recorrente** para os itens que **não** entram no backup automático do banco.
> Comandos detalhados e procedimento completo: ver [runbook_backup_restore.md](runbook_backup_restore.md)
> (seções 4.2, 4.3 e 5.3). Log dos backups (só metadados): ver [registro_backups.md](registro_backups.md).

---

## 1. Por que este documento existe

O backup automático diário cobre **apenas o banco** (Supabase PostgreSQL — ver runbook §10.1).
Dois itens críticos ficam **de fora** e dependem de rotina manual:

- **Arquivos do Storage** (`comprovantes`, `fretes-documentos`,
  `fretes-evidencias` e `fretes-odometro`). Fotos de perfil usam o prefixo
  `avatars/` dentro de `comprovantes`.
- **Variáveis de ambiente** do Railway (configuração de produção).

> ⚠️ **O dump do banco NÃO inclui os arquivos do Storage.** O banco guarda apenas as
> **referências/caminhos** (ex.: a coluna `foto_url`), não os bytes das imagens. Se os buckets
> forem perdidos, restaurar o banco **não** traz as fotos de volta — os links apontarão para
> arquivos inexistentes. Por isso o Storage precisa de backup próprio.

---

## 2. Regras de segurança (valem para todo este fluxo)

- ❌ **Nunca versionar:** arquivos do Storage, export de variáveis, `.env`, `pgpass.conf`, dumps, zips.
- ❌ **Nunca colocar no Git:** valores reais de variáveis, service role key, JWT secret, tokens,
  senhas ou connection strings.
- ✅ No repositório, registrar **apenas metadados** (nome, data, tamanho, quantidade) em
  [registro_backups.md](registro_backups.md).
- ✅ Conteúdo real vai para **cofre seguro** (Bitwarden/1Password) ou pasta local **fora do repo**.

---

## 3. Rotina manual — Storage

Frequência recomendada: **semanal** (retenção ~90 dias) — ver runbook §7.

- [ ] Conferir quais buckets existem hoje (`supabase storage list` — runbook, apêndice A).
- [ ] Baixar **`comprovantes`**, **`fretes-documentos`**, **`fretes-evidencias`** e
      **`fretes-odometro`** para pastas datadas fora do repo. Confirmar a lista
      real de buckets antes da coleta.
- [ ] Confirmar que o prefixo **`comprovantes/avatars/`** foi incluído; não tratá-lo
      como bucket independente.
- [ ] Conferir que a pasta baixada **não está vazia** (quantidade de arquivos > 0, tamanho coerente).
- [ ] Registrar em [registro_backups.md](registro_backups.md) **apenas**: data, bucket, quantidade
      de arquivos e tamanho aproximado — **nunca** nomes de cliente ou conteúdo dos arquivos.
- [ ] Confirmar que nada do Storage entrou no Git (`git status` limpo).

---

## 4. Rotina manual — Variáveis de ambiente (Railway)

Frequência recomendada: **a cada alteração** (manter sempre a última versão) — ver runbook §7.

- [ ] Exportar as variáveis pelo Railway Dashboard → Project → Variables → Export (runbook §4.3).
- [ ] Salvar o export em **cofre seguro** (Bitwarden/1Password), **nunca** no repositório.
- [ ] Conferir que a lista de variáveis obrigatórias está completa (runbook §4.3 / §2.3).
- [ ] Registrar em [registro_backups.md](registro_backups.md) **apenas metadados**: data,
      "env vars Railway exportadas", quantidade de variáveis e referência genérica ao cofre.
      **Sem valores.**
- [ ] Confirmar que nenhum valor real foi colado em arquivo versionado.

> 🔑 **Rotação de senha do banco:** ao trocar a senha do Supabase, atualizar o `pgpass.conf`
> (fora do repo) para a automação do banco voltar a autenticar — ver runbook §10.1. A senha
> **não** deve aparecer em nenhuma variável versionada nem no repositório.

---

## 5. Verificação mensal (rotina recorrente)

Uma vez por mês, confirmar que todas as frentes estão protegidas:

- [ ] **Banco:** existe backup recente (último `.dump`) e a automação está rodando
      (tarefa `Backup MatopibaLog` — runbook §10.1).
- [ ] **Storage:** existe backup recente dos quatro buckets, com manifesto de paths,
      tamanhos e checksums.
- [ ] **Env vars:** o cofre tem a versão **atual** das variáveis do Railway.
- [ ] **Teste de restore:** restore foi exercitado **periodicamente** (banco já validado em
      2026-06-29 — runbook §8.1). Repetir de tempos em tempos, incluindo Storage quando possível,
      em projeto separado / instância descartável e **só com contas de teste** (Alfa, Bravo, autônomos).
- [ ] **Higiene:** repositório sem segredos/dumps (`git status` limpo).

---

## 6. Riscos específicos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Dump do banco não inclui Storage | Restaurar o banco não traz as fotos; `foto_url` aponta para arquivos inexistentes | Backup próprio dos buckets (seção 3) |
| Env vars vivem fora do repo | Se o cofre/Railway se perder sem cópia, o backend não sobe (faltam `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/`JWT_SECRET`) | Exportar a cada alteração para o cofre (seção 4) |
| Rotação de senha do banco | Automação do backup deixa de autenticar | Atualizar `pgpass.conf` após a troca (runbook §10.1) |
| `avatars` ser tratado como bucket separado | Fotos de perfil ficam fora do backup real | Incluir o prefixo `avatars/` no backup de `comprovantes` |
| Buckets privados restaurados como públicos | Exposição de documentos/evidências | Validar anon-deny e signed URLs após restore |

---

Relacionados: [runbook_backup_restore.md](runbook_backup_restore.md) · [registro_backups.md](registro_backups.md)
