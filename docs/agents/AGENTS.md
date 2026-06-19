# AGENTS — Governança de Agentes (Matopiba Log)

> Documentação local e neutra. Vale para Claude, Codex ou qualquer outro agente
> que trabalhe neste repositório. Objetivo: trabalho seguro, sem conflitos, sem
> alterações fora de escopo e sem gasto desnecessário de créditos.
>
> ⚠️ Não confundir com o `AGENTS.md` da **raiz** do projeto, que é um documento de
> diagnóstico/ambiente e histórico de sessões (assunto diferente). A governança de
> agentes vive **aqui**, em `docs/agents/`.

Documentos relacionados:
- [PROTOCOLO_AGENTES.md](PROTOCOLO_AGENTES.md) — papéis e responsabilidades.
- [SKILLS_MATOPIBA_LOG.md](SKILLS_MATOPIBA_LOG.md) — playbooks por área.
- [HANDOFF_TEMPLATE.md](HANDOFF_TEMPLATE.md) — modelo de passagem entre agentes.

---

## 1. Regra central

- **Somente um agente implementador por branch.** Dois implementadores na mesma
  branch geram conflito e retrabalho.
- **Auditores são read-only.** Leem, apontam, classificam risco. Não editam.
- **Planejadores geram relatórios, não código.** Backlog, prioridades, proposta de
  PRs pequenos — nunca diffs de produto.
- **Release só faz git (stage/commit/push/PR/merge) quando autorizado** de forma
  explícita e por etapa.

---

## 2. Regras Git

- **Nunca usar `git add .`** — sempre stage seletivo, arquivo por arquivo.
- **Stage seletivo obrigatório** (`git add <caminho-específico>`).
- **Nunca commitar `dist/`** (build gerado).
- **Nunca commitar** `.env`, `.idea/`, `.claude/`, relatórios temporários,
  scripts temporários (`teste_*.ps1`, etc.) nem PDFs locais.
- **Nunca mexer em stashes sem autorização** (não aplicar, dropar ou criar).
- **Nunca abrir PR sem auditoria** prévia.
- **Nunca fazer merge sem autorização separada** (autorizar PR ≠ autorizar merge).

---

## 3. Regras de escopo

- **Web, app, backend e banco em PRs separados.** Nunca um PR atravessando camadas.
- **Não misturar visual com cálculo financeiro** no mesmo PR.
- **Não misturar bugfix com refator.**
- **Não misturar app Android com painel web.**
- **Não mexer em RLS / storage / policies / migrations sem autorização explícita.**

---

## 4. Fluxo obrigatório

```
Auditoria
  → Implementação pequena (escopo mínimo, arquivos autorizados)
    → Validação (teste/observação real do comportamento)
      → Build / analyze (quando a ferramenta estiver disponível)
        → Stage seletivo
          → PR
            → Auditoria remota
              → Merge autorizado
```

Cada seta é um ponto de parada: o agente para e relata antes de avançar.

---

## 5. Regras de verdade

- **Não declarar "corrigido" sem teste ou validação.**
- **Se não testou, dizer "não testado".**
- **Se validou só por leitura de código, dizer exatamente isso** ("validado por
  revisão estática, sem execução").
- **Não fabricar resultado** (logs, saídas, números).
- **Não esconder incerteza** — sinalizar o que ficou em aberto e o risco residual.
