# Runbook — Go-live de Billing (Asaas sandbox → production)

> Documento operacional versionado. **Ler inteiro antes de qualquer ação.**
> Escopo: como ativar cobrança real no Asaas com segurança, validar e reverter.
> Este runbook **não ativa nada** — descreve o procedimento. Cada passo marcado
> com 🔴 é um **hard stop** que exige autorização explícita do responsável.

Última atualização: 2026-07-22. Base de código: `main` após PR #305.

---

## 0. Modelo mental — por que hoje NÃO cobra de verdade

O sistema é **fail-closed para sandbox** por design. Duas travas independentes:

1. **Ambiente Asaas** vive no banco, não em env var:
   `configuracoes.dados.integracao_asaas.environment` = `'sandbox'` | `'production'`.
   A `baseURL` deriva dele: `production` → `https://api.asaas.com/v3`;
   qualquer outro valor → `https://sandbox.asaas.com/api/v3`
   (`backend/routes/pagamentos.js`, `getAsaasConfig`).

2. **Sandbox-gate nas rotas** (`bloquearSeNaoSandbox`): **13 endpoints** de billing
   respondem **403** se `environment !== 'sandbox'` — inclusive criar cliente,
   criar cobrança, conciliar, PIX sob demanda, regularização, faturas
   recorrentes e assinaturas. O job de recorrência tem a **mesma trava** embutida.

**Consequência crítica:** só mudar o ambiente para `production` **não** liga a
cobrança real — pelo contrário, **derruba** todas essas rotas (403), porque elas
exigem `sandbox`. Portanto o go-live real é uma mudança **deliberada e
coordenada** de DUAS coisas: (a) trocar o ambiente para `production` **e**
(b) relaxar/ajustar o sandbox-gate para permitir produção. O item (b) é um
**🔴 hard stop** ("remover sandbox-gate") e deve ser um PR próprio, revisado,
com o gate virando algo como "permitir sandbox OU produção-autorizada", nunca
uma remoção cega.

---

## 1. Pré-requisitos antes de cogitar produção

- [ ] **Preços comerciais definidos** e aplicados no catálogo (hoje são
      placeholder: Básico 149,90 / Básico Autônomo 149,99 / Profissional 149,99 /
      Enterprise 199,90). 🔴 Decisão comercial + alteração de preço em produção.
- [ ] **Catálogo auditado**: nenhuma empresa em plano de categoria incompatível
      (o PR #304 barra novas; corrigir as antigas via DML autorizado). Verificar
      em `GET /painel-admin/billing-health` → `categoria_incompativel: 0`.
- [ ] **Dados de teste isolados/limpos** (contas TESTE/Codex/Sandbox/Alfa/Bravo/
      José e reservas órfãs). Ver runbook de limpeza (PR de dados) — DML autorizado.
- [ ] **billing-health limpo**: `GET /painel-admin/billing-health` → `ok: true`
      (ou apenas pendências conhecidas e aceitas).
- [ ] **Conta Asaas de produção** criada, com chave de API de produção em mãos.
- [ ] **Webhook de produção** configurado no painel do Asaas (ver §3).

---

## 2. Variáveis e configuração

### 2.1 Env vars no Railway (backend)
| Variável | Papel | Observação no go-live |
|----------|-------|------------------------|
| `ASAAS_WEBHOOK_TOKEN` | autentica o webhook (header `asaas-access-token`) | 🔴 Deve casar com o token configurado no painel Asaas de produção. Trocar env = hard stop. |
| `FATURAS_RECORRENTES_ALLOWLIST` | UUIDs elegíveis ao cron | Manter restrita no piloto de produção (1 empresa real). 🔴 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `JWT_SECRET` / `FRONTEND_URL` / `NODE_ENV` | infra | Não mudam no go-live. |

### 2.2 Config no banco (painel → Integrações, super-admin)
`configuracoes.dados.integracao_asaas`:
- `environment`: `'sandbox'` → `'production'` (🔴 §0 item a).
- `apiKey`: chave de produção, **criptografada em repouso** (`resolveAsaasApiKey`).
  Nunca versionar, nunca logar. 🔴 Alterar segredo.

> A apiKey **não** é env var — vive cifrada no banco e é inserida pela tela de
> Integrações. Trocar sandbox↔produção troca a chave junto.

---

## 3. Webhook de produção

- URL: `https://matopibalog-backend-production.up.railway.app/pagamentos/webhook/asaas`
- Autenticação: header fixo `asaas-access-token` == `ASAAS_WEBHOOK_TOKEN`
  (comparação em tempo constante; **não** é HMAC).
- Eventos mínimos a habilitar no painel Asaas de produção:
  `PAYMENT_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`,
  `PAYMENT_DELETED`, `PAYMENT_REFUNDED` (os demais são reconhecidos e tratados
  como "sem transição", ver `asaasWebhookService.EVENTOS_VALIDOS`).
- Idempotência garantida por `event_id` único + lease (migration 024). Reenvio do
  Asaas é seguro.
- **Validação**: após configurar, disparar um evento de teste do painel Asaas e
  conferir em `billing-health.detalhes.webhook_por_status` que ele aparece como
  `processed` (ou `ignored` para eventos sem pagamento) — nunca `failed`.

---

## 4. Sequência de go-live (proposta, com hard stops)

> Ordem sugerida. NÃO executar sem autorização item a item.

1. Fechar §1 (pré-requisitos). Confirmar `billing-health.ok = true`.
2. 🔴 **PR de sandbox-gate**: transformar `bloquearSeNaoSandbox` em uma trava que
   aceita `sandbox` OU `production` **somente quando** uma flag explícita de
   produção-autorizada estiver ligada (ex.: `configuracoes...billing_go_live=true`
   + allowlist de empresas de produção). Revisar, testar, mergear. **Ainda inerte**
   enquanto a flag estiver desligada.
3. 🔴 Trocar `environment` para `production` e inserir a apiKey de produção
   (painel Integrações). A partir daqui o ambiente é real.
4. 🔴 Configurar webhook de produção (§3) e validar com evento de teste.
5. **Piloto controlado**: UMA empresa real na allowlist. Gerar 1 cobrança real de
   valor baixo, pagar de verdade, confirmar o ciclo completo em `billing-health`
   (fatura paga, empresa ativa, webhook processed, zero órfã/duplicidade).
6. Observar 24–48h. Só então ampliar allowlist / ligar recorrência para mais
   empresas.

---

## 5. Rollback

Qualquer sinal de erro (webhook failed, cobrança errada, duplicidade):

1. **Pausar o cron**: no Railway, serviço do cron (`vivacious-flow`) →
   desabilitar o schedule (ou apontar `Config File Path` para um toml com
   `--dry-run`). O job também aborta sozinho se o ambiente não for exatamente o
   esperado pela sua trava.
2. **Voltar o ambiente para `sandbox`** (painel Integrações) — isso reativa o
   sandbox-gate e **bloqueia (403) todas as rotas de cobrança** imediatamente,
   estancando qualquer cobrança nova.
3. Se o PR de sandbox-gate usa flag: **desligar a flag** de produção-autorizada
   (efeito equivalente, sem trocar a apiKey).
4. Cobranças já criadas no Asaas de produção: tratar caso a caso pelo painel
   Asaas (cancelar/estornar). 🔴 Estorno/cancelamento real exige autorização.
5. Comunicar clientes afetados apenas com aprovação. 🔴

> **Regra de ouro do rollback:** voltar `environment` para `sandbox` é o freio de
> emergência mais rápido — o próprio design fail-closed vira a favor.

---

## 6. Pausar / retomar o cron de recorrência

- **Estado atual**: Railway `vivacious-flow`, `startCommand =
  node jobs/gerarFaturasRecorrentes.js --limite=1` (sem `--dry-run`), schedule
  `0 6 1 * *`, sandbox-only + allowlist. Primeira execução automática:
  **01/08/2026 06:00 UTC**.
- **Pausar**: desabilitar o schedule no Railway, OU trocar o `Config File Path`
  para um `railway.cron.toml` com `--dry-run`, OU esvaziar
  `FATURAS_RECORRENTES_ALLOWLIST` (fail-closed: allowlist vazia = ninguém).
- **Retomar**: reverter a ação acima.
- **Nunca** remover o sandbox-gate do job nem o `--limite` sem autorização (🔴).

---

## 7. Checklist final antes de declarar go-live

- [ ] Preços comerciais aplicados e conferidos.
- [ ] `billing-health.ok = true`.
- [ ] Sandbox-gate convertido para flag de produção-autorizada (PR revisado).
- [ ] apiKey de produção inserida (cifrada), `environment = production`.
- [ ] Webhook de produção validado (evento de teste `processed`).
- [ ] Piloto real de 1 empresa concluído sem erro.
- [ ] Allowlist do cron restrita ao piloto.
- [ ] Plano de rollback comunicado e testado (voltar a `sandbox`).
- [ ] Autorização explícita registrada para cada 🔴.

**Enquanto qualquer item acima estiver aberto, o veredito é: NÃO PRONTO.**
