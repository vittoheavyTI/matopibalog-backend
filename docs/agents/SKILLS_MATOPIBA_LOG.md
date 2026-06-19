# SKILLS / PLAYBOOKS — Matopiba Log

> Playbooks locais por área. Use junto com [AGENTS.md](AGENTS.md) e
> [PROTOCOLO_AGENTES.md](PROTOCOLO_AGENTES.md).

---

## 1. Skill: Git Seguro

**Comandos permitidos (leitura/sincronização):**
- `git status --short`, `git diff`, `git diff --stat`, `git diff --check`,
  `git diff --name-only`, `git log`, `git stash list`, `git branch`.
- `git checkout <branch>`, `git pull`, `git fetch` (sincronização segura).
- `git add <caminho-específico>` (stage seletivo, **só quando autorizado**).

**Comandos proibidos (sem autorização explícita):**
- `git add .` / `git add -A` (stage em massa).
- `git commit`, `git push`, `git merge`, abrir PR.
- `git stash` / `git stash drop` / `git stash pop` (mexer em stashes).
- `git reset --hard`, `git push --force`, `git rebase`, limpeza de histórico.

**Checklist antes de commit:**
1. `git status --short` — só os arquivos esperados aparecem?
2. `git diff --stat` — escopo bate com o autorizado?
3. `git diff --check` — sem lixo de whitespace/conflito?
4. Nenhum `dist/`, `.env`, `.idea/`, `.claude/`, relatório/script temporário ou PDF local entrou?
5. Stage **seletivo** feito arquivo por arquivo?
6. Mensagem em português, atômica, um motivo lógico só?

---

## 2. Skill: Auditoria de Bug

- **Mapear a causa:** reproduzir/rastrear até a origem real (arquivo + linha),
  não parar no sintoma.
- **Separar bug confirmado de suspeita:**
  - *Confirmado* — há evidência (código, log, comportamento observado).
  - *Suspeita* — hipótese sem evidência; rotular como tal, nunca como fato.
- **Classificar risco:** P0 (bloqueador) / P1 (grave) / P2 (menor).
- **Propor PR pequeno:** menor escopo que resolve a causa; uma camada por vez;
  listar arquivos prováveis, regra de correção e o que **não** entra.

---

## 3. Skill: Financeiro Matopiba

- **Autônomo:** `resultado = faturamento − gastos`. **Sem comissão** por percentual.
- **Vinculado:** usa **comissão** (percentual do cadastro), **saldo** e **resultado
  da empresa**.
- **Frete cancelado:** continua **visível** em listas/Home/Histórico/Detalhe, mas
  fica **fora de todas as agregações** financeiras e operacionais.
- **Lançamento sem `frete_id`** (lançamento solto): **sempre preservado** nas somas.
- **Rejeitado:** não entra no cálculo (regra preexistente — manter).
- **Nunca detectar autônomo por nome.** O tipo vem da empresa
  (`empresas.tipo == 'autonomo'`), nunca de heurística sobre o nome do motorista.
- **Paridade entre módulos:** Dashboard, Relatórios e Gerenciamento devem aplicar a
  mesma regra financeira (evitar "3 módulos, 3 regras").

---

## 4. Skill: Painel Web

- **Validação visual obrigatória** para qualquer mudança de UI (preview/print real,
  não só leitura de código).
- **Não mexer em Dashboard / Relatórios / Gerenciamento juntos** sem escopo definido
  — cada um pode ter seu PR.
- **Preservar paridade** super-admin / admin comum (isolamento multi-tenant e
  visibilidade de itens de plataforma).
- Web usa autenticação própria (ver auth do projeto); não presumir cookie vs Bearer
  sem conferir.

---

## 5. Skill: App Android

- **PR app-only** — nunca misturar app com web/backend.
- **`flutter analyze` obrigatório** quando a ferramenta estiver disponível.
- **APK + validação em dispositivo/emulador obrigatórios** para a entrega final.
- Se o SDK Flutter não estiver disponível no ambiente, **dizer explicitamente** e
  registrar `flutter analyze`/APK como pendência obrigatória (não declarar validado).

---

## 6. Skill: Banco / Supabase

- **Não mexer em RLS / storage / policies / migrations sem autorização explícita.**
- **Hard-delete proibido sem autorização.** Preferir neutralização/soft quando possível.
- **Dados de teste em produção exigem plano de limpeza** registrado antes de criar.
- Schema real de produção pode divergir dos SQLs versionados — **conferir o banco
  real**, não confiar só nos arquivos.
