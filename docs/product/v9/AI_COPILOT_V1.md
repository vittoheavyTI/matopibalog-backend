# AI Copilot V1 — Assistente Operacional Read-Only

> Documento de frente (Claude / `AI_COPILOT_V1_WRITER`). **Não** é fonte canônica:
> `ROADMAP`, `MASTER_LEDGER`, `CONTEXT_BRIDGE`, `DECISIONS` e `PARALLEL_EXECUTION_BOARD`
> seguem sob o orchestrator/integrator.

- `MACROFRONT=AI_COPILOT_V1`
- `BASE_SHA=4faa735b5b1760fb159fbf9436f7d8eef0665b0e`
- `BRANCH=feature/ai-copilot-readonly-v1`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0` · `CLAUDE_SCHEMA_AUTHORITY=NONE`
- `DEFAULT_PROVIDER_MODE=disabled` (deploy NÃO ativa IA)

## 1. Princípio central — a IA não é autoridade

Fluxo canônico: `usuário → copiloto → pedido de tool → registry → auth → entitlement →
permissão → escopo → serviço determinístico → resultado sanitizado → resposta →
evidência → log`. **O LLM nunca acessa o banco** (§12): só enxerga tools registradas.

## 2. Provider Gateway

`services/ai/providerGateway.js` seleciona o provider pelo modo (`AI_PROVIDER_MODE`):
- `disabled` (default de produção) → inerte, lança `DISABLED`;
- `fake` → determinístico e roteirizável (testes/dev), zero rede;
- `openai` → adapter HTTP OpenAI-compatível (`providers/openaiProvider.js`), **pronto**
  para habilitação futura, sem key hardcoded, sem chamada em certificação.

Contrato normalizado `generate({system,messages,tools}) → {finishReason,toolCalls[],content,usage}`;
erros como `AIProviderError` (DISABLED/NOT_CONFIGURED/TIMEOUT/RATE_LIMIT/UPSTREAM_ERROR/INVALID_RESPONSE),
com mensagem pt-BR segura. Nenhum internal/secret do vendor vaza para o produto.
Futuro Ollama/local: basta um provider OpenAI-compatível (via `OPENAI_BASE_URL`) — sem
mudar registry, autorização, UI ou serviços.

## 3. Autonomia V1 = READ_ONLY

Permitido: explicar, resumir, buscar, comparar, calcular a partir do que a tool
retornou, orientar. **Proibido**: qualquer escrita/ação de negócio. `actions_available`
da resposta nunca contém ação executável (apenas, no futuro, navegação).

## 4. Tool Registry e autorização

`services/ai/toolRegistry.js`: allowlist estrita (tool desconhecida = DENY; sem
SQL/HTTP/eval dinâmico). Cada tool declara `requiredPermission`/`requiredEntitlement`
e o registry checa a **mesma autoridade** de um read normal (`ensureEffective` V9 +
entitlement), além de timeout, sanitização e envelope `{ok,data,evidence,warnings,truncated}`.
Tenant/escopo vêm do contexto autenticado do servidor (`req.empresa_id`,
`operationalScope`) — **nunca** de argumento do modelo (§24). Não há
`ai.superuser`/bypass (§23).

Tools V1 (reúso de serviços canônicos, sem duplicar cálculo):
- `fleet.current.summary` (`fleet.view`) → `fleetService.getOverview` (contagens/atenção).
- `operation.freights.attention` (`freight.view`) → fretes por status com tenant+escopo (`aplicarEscopoOperacionalQuery`).
- `commercial.current_plan.summary` (`company.settings.view`) → `planoLimiteService` (plano/capacidade/uso; sem preço/fatura).

Campaign AI tools: `DEFERRED` (§21, evita colisão com #457).

## 5. Endpoints

- `GET /ai/capabilities` — `{enabled, provider_available, read_only:true, capabilities[]}`.
  Nunca retorna key/credencial/prompt. Quando `disabled`, `enabled=false` e não resolve permissões.
- `POST /ai/chat` — `verifyToken` + tenant; sem chat anônimo. Zod bound de message/history.

## 6. Segurança

- **Sem DB no provider** (teste arquitetural §59).
- **IDOR/tenant**: handlers usam `ctx.empresaId` do servidor; `empresa_id` do modelo é ignorado (teste).
- **Escopo** operacional aplicado dentro das tools.
- **Injeção de prompt**: texto de dados é conteúdo, não instrução; tool desconhecida sempre negada; nenhuma escalada de autoridade (testes §29/§64).
- **Sanitização** (§63): remove chaves sensíveis, tokens e URLs assinadas do payload ao modelo.
- **Data minimization** (§38): tools projetam só contagens/labels; sem CPF/placa/PII/URL assinada.
- **Loop bound** `MAX_TOOL_STEPS=6` + dedupe de tool calls idênticas.
- **Timeouts** provider/tool/request; falha vira mensagem pt-BR segura.
- **Logs**: correlation_id, modo, nomes de tools, duração — nunca key/token/prompt/PII.

## 7. Fallback / default inerte

Sem env, `AI_PROVIDER_MODE=disabled` → capabilities `enabled=false`, chat responde
inerte. Nenhum fluxo do produto depende da IA (§34). O deploy desta frente **não**
ativa IA nem faz chamada externa.

## 8. Web Copilot

`painel_web/src/components/AiCopilot.tsx` — drawer acessível (dialog, foco, teclado,
Enter envia), responsivo, montado no `Layout` (não bloqueia navegação). Estado
efêmero (sem persistência, §40). Sugestões contextuais, evidência ("Baseado em N…"),
warnings, nova conversa. Sem botões de ação de negócio (§46).

## 9. Testes

Backend: gateway (disabled/fake/normalização), registry (allowlist/permissão/entitlement/
timeout/sanitização/tenant), orquestrador (disabled/tool loop/dedupe/loop-limit/injeção/
erro), tools reais (permissão + tenant). Web: capabilities desabilitado, fluxo habilitado
com evidência, erro seguro, nova conversa.

## 10. Deferidos (futuro, não são defeitos de V1) — §87

Habilitação OpenAI em produção, secret do provider, histórico persistente, voz/STT/TTS,
IA no Flutter, Campaign AI tools, tools de escrita/ações confirmadas/autônomas,
deploy Ollama, rate-limit distribuído.

## 11. Configuração

Env (schema-free, sem mudar Railway nesta frente):
`AI_PROVIDER_MODE=disabled|fake|openai`; para `openai`: `OPENAI_API_KEY` (obrigatória),
`OPENAI_BASE_URL` (opcional, OpenAI-compatível/local), `OPENAI_MODEL` (opcional).
