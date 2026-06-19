# HANDOFF — Modelo de Passagem entre Agentes

> Copie este bloco e preencha ao passar trabalho de um agente para outro
> (ou para o coordenador humano). Mantém contexto, evita retrabalho e
> protege o escopo. Ver [AGENTS.md](AGENTS.md) e [PROTOCOLO_AGENTES.md](PROTOCOLO_AGENTES.md).

---

## Bloco de Handoff (copiar e preencher)

```
### Handoff — <título curto>

- **Branch:** <nome da branch>
- **Objetivo:** <o que esta tarefa deve alcançar, em 1–2 frases>

- **Arquivos autorizados (pode editar):**
  - <caminho/arquivo>
  - <caminho/arquivo>

- **Arquivos proibidos (não tocar):**
  - <ex.: painel_web, backend, banco/migrations/RLS/storage/policies, Supabase,
    login, notificações, PDFs, stashes, untracked existentes, dist/>

- **Estado git:**
  - Branch atual: <...>
  - `git status --short`: <resumo — o que está modificado/untracked>
  - Staged: <nada / lista>
  - Commits locais vs main: <nenhum / lista>
  - Stashes: <intocados / detalhe>
  - PRs abertos: <nenhum / link>

- **Alterações feitas:**
  - <arquivo:linha> — <o que mudou e por quê>

- **Validações feitas:**
  - <ex.: revisão estática; teste manual X; preview visual Y>

- **Validações NÃO feitas (pendentes/obrigatórias):**
  - <ex.: flutter analyze (SDK indisponível); APK em dispositivo; teste E2E>

- **Riscos:**
  - <P0/P1/P2 — descrição; risco residual; efeitos colaterais possíveis>

- **Próximo passo:**
  - <ex.: rodar flutter analyze; stage seletivo; abrir PR; auditar remoto>

- **Instrução clara (escolher uma):**
  - [ ] IMPLEMENTAR
  - [ ] AUDITAR
  - [ ] RELEASE (stage/commit/PR/merge — só com autorização)
  - [ ] PARAR
```

---

## Regras de uso

- O handoff é a **fonte de verdade** do escopo: o próximo agente não excede os
  arquivos autorizados.
- Se algo necessário estiver fora do escopo, o agente **para e devolve o handoff**
  com a pendência, em vez de agir.
- "Validado" só pode ser marcado com evidência. Sem evidência → "não testado".
- Autorizar PR **não** autoriza merge: o merge precisa de instrução separada.
