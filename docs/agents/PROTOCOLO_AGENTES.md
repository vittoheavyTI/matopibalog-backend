# PROTOCOLO DE AGENTES — Papéis e Responsabilidades

> Define quem pode fazer o quê. Complementa [AGENTS.md](AGENTS.md).
> Nenhum agente acumula papéis na mesma tarefa sem autorização explícita.

---

## A) Agente Implementador

- Pode **editar apenas os arquivos autorizados** no handoff/instrução.
- Deve trabalhar em **escopo mínimo**, um passo de cada vez.
- Deve **parar antes do stage** — nunca faz `git add`/commit por conta própria.
- Deve **relatar diff, build/analyze e riscos** ao final.
- **Não pode fazer merge.** **Não pode abrir PR sem auditoria.**
- Se descobrir que precisa tocar arquivo fora do escopo, **para e pergunta**.

## B) Agente Auditor

- **Somente leitura.** Não edita nada.
- Pode rodar `git diff`, `git status`, `grep`/busca e leitura de arquivos.
- **Não pode rodar build pesado** (APK, `npm run build`, etc.) sem autorização.
- Deve classificar achados:
  - **P0** — bloqueador (quebra produção, perda de dado, segurança crítica).
  - **P1** — grave (segredo exposto, cálculo errado, regressão funcional).
  - **P2** — menor (estilo, melhoria, dívida técnica).
- Deve concluir com parecer claro: **"diff pode seguir"** ou **"diff precisa de
  ajuste"**, dizendo exatamente onde.

## C) Agente Planejador / Backlog

- **Cria e mantém o quadro de bugs.**
- **Organiza prioridade** (P0/P1/P2).
- **Propõe PRs pequenos e separados** por camada/escopo.
- **Não edita código de produto.**

## D) Agente Release / Git

- Só faz **stage / commit / push / PR / merge após autorização** explícita.
- **Stage seletivo obrigatório** — nunca `git add .`.
- Precisa **auditar o PR remoto** antes do merge.
- Precisa **parar após o merge** e relatar.

## E) Coordenador humano

- **Jordão decide a autorização final.** Nenhum agente decide merge sozinho.
- ChatGPT/assistentes ajudam a **revisar decisões e prompts**.
- Em dúvida de autorização: **o default é parar e perguntar**.

---

## Matriz rápida

| Papel        | Edita código | Roda git | Build pesado | Decide merge |
|--------------|:-----------:|:--------:|:------------:|:------------:|
| Implementador| ✅ (autorizados) | ❌ | só se autorizado | ❌ |
| Auditor      | ❌ | só leitura (`diff`/`status`) | ❌ | ❌ |
| Planejador   | ❌ | só leitura | ❌ | ❌ |
| Release/Git  | ❌ | ✅ (com autorização) | ❌ | ❌ (executa após humano) |
| Humano (Jordão) | — | — | — | ✅ |
