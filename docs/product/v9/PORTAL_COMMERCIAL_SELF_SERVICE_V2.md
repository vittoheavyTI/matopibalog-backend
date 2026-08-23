# Portal Comercial Self-Service V2 — Fechamento Técnico

> Documento de frente (Claude / `PORTAL_COMMERCIAL_SELF_SERVICE_V2_WRITER`). **Não** é
> fonte canônica: `MASTER_LEDGER`, `ROADMAP`, `DECISIONS`, `CONTEXT_BRIDGE` e
> `PARALLEL_EXECUTION_BOARD` seguem sob o orchestrator/integrator.

- `MACROFRONT=PORTAL_COMMERCIAL_SELF_SERVICE_V2`
- `BASE_SHA=a257e0f6b50e1d7d9f6f64113df768cdc6f7339f` (`origin/main`)
- `BRANCH=feature/portal-commercial-self-service-v2`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0` · `CLAUDE_SCHEMA_AUTHORITY=NONE`

## 1. Auditoria DELTA (congelada)

O domínio comercial já existia e funcionava de ponta a ponta (preview, comparação,
solicitação de add-ons, solicitação de troca de plano sem dinheiro, fila super-admin
com aprovar/recusar, auditoria, idempotência, isolamento de tenant, gate de permissão
do cliente e isolamento de billing). A auditoria encontrou **um defeito real** e alguns
gaps informativos.

| Capacidade | Estado | Ação nesta frente |
|---|---|---|
| Plano atual / situação | `/contratacao/status`,`/situacao` | DONE_VERIFIED |
| Catálogo/comparação de planos | `ComparadorPlanos.tsx` + `/planos/publicos` | DONE_VERIFIED |
| Preview de upgrade (read-only) | `previewUpgradeService` + `/contratacao/plano-preview` | DONE_VERIFIED |
| Solicitar troca de plano (sem dinheiro) | `/contratacao/iniciar` | DONE_VERIFIED |
| Solicitar add-on | `solicitacoesComerciaisService` + `/contratacao/solicitar-addons` | DONE (corrigido preço) |
| Idempotência de add-on | `jaTem` (ativa/pendente) | DONE_VERIFIED |
| Add-on pendente ≠ entitlement | resolver exige `ativa` | DONE_VERIFIED |
| Fila super-admin + aprovar/recusar | `/painel-admin/solicitacoes-comerciais*` + `SolicitacoesComerciais.tsx` | DONE_VERIFIED |
| Trilha de auditoria | `funcionalidade_auditoria` | DONE_VERIFIED |
| Isolamento de tenant | `verificarEmpresa` (empresa_id do backend) | DONE_VERIFIED |
| Gate do cliente (não-motorista) | `permitirAssinaturaCliente` (admin/owner/autônomo; motorista=403) | DONE_VERIFIED |
| Isolamento de billing | nenhum caminho toca Asaas/fatura/outbox | DONE_VERIFIED (teste explícito) |
| **Preço de ERP/SSO** | **fabricado (R$149,90 fixo p/ todo `opcional_paga`)** | **CORRIGIDO (BLOCKER)** |
| Custo-benefício sem economia fantasma | totais usavam o preço fabricado | CORRIGIDO (HIGH) |
| `price_status` / commercial×technical | não estruturado | ADICIONADO (MEDIUM) |
| Uso atual (motoristas ativos × limite) | não exposto no portal comercial | ADICIONADO (MEDIUM) |
| Downgrade guiado com guarda de capacidade | não há fluxo dedicado | `DEFERRED_COMMERCIAL_DECISION` |
| Cancelar solicitação pendente pelo cliente | modelo atual não expõe | `DEFERRED_DOMAIN` |

## 2. Correção principal — preço por funcionalidade (ERP_SSO_FAKE_PRICING=false)

**Defeito:** `snapshotUpgradeService` (exibição) e `solicitacoesComerciaisService`
(persistência) aplicavam a constante `ADDON_PADRAO_CENTAVOS=14990` a **todo** add-on
`opcional_paga` — inclusive ERP e SSO, que **não têm preço aprovado**. Isso inventava
um R$149,90 para ERP/SSO, tanto na tela quanto na linha gravada em
`empresa_funcionalidades`.

**Correção (schema-free — as colunas já existiam):** resolução de preço **por
funcionalidade**, na ordem:
1. `plano_funcionalidades.preco_especifico_centavos` (override do plano);
2. `funcionalidades.preco_padrao_centavos` (preço padrão APROVADO da feature);
3. senão → **sob proposta** (preço desconhecido; nunca fabricado).

Efeito: `estrutura_operacional` (com preço padrão aprovado) mostra valor de tabela;
ERP/SSO sem preço aprovado aparecem como **"Sob proposta"** e a solicitação grava
`preco_mensal_centavos = NULL` (o super-admin define o valor final na aprovação —
já suportado por `aprovarSolicitacao({ precoCentavos })`).

## 3. Contratos estruturados (§71/§72)

Cada add-on no snapshot agora expõe:
- `price_status` ∈ `INCLUDED | KNOWN | UNDER_PROPOSAL | NOT_AVAILABLE` (§71 — não
  sobrecarrega `null` com três sentidos);
- `commercial_status` ∈ `INCLUDED | OPTIONAL_PAID | UNDER_PROPOSAL | UNAVAILABLE`;
- `technical_status` ∈ `AVAILABLE | PREPARING` (§72 — separado do comercial; ERP/SSO em
  `PREPARING` = "integração em preparação", nunca "conectado/ativo").

## 4. Sem economia fantasma (§30/§32)

Quando um add-on **selecionado** é sob proposta (ex.: ERP/SSO), os totais
(`total_atual`, `total_alvo`, `diferenca_mensal`) ficam `null` e o snapshot marca
`total_*_incompleto=true`; a recomendação vira `sob_proposta` ("falar com o comercial").
A UI mostra **"Sob proposta"** no lugar do número — nunca um total/economia derivado de
preço desconhecido.

## 5. Uso atual e atenção de capacidade (§11/§12)

O preview passou a devolver `uso_atual { motoristas_ativos, limite, ilimitado,
capacidade_inclusa, estado }`, reusando a **autoridade canônica** de contagem de
motoristas (`planoLimiteService`: `tipo=motorista` ∧ `status=ativo` ∧
`status_cadastro ∈ {pendente,aprovado}`; bloqueado/inativo não contam). O `estado` usa
**contagem real** (sem porcentagem arbitrária): `confortavel`, `proximo` (última vaga),
`no_limite`, `acima`, `ilimitado`. Read-only, fail-open.

## 6. Fronteira de billing / Asaas (§54/§55/§59)

Nenhum caminho desta frente cria pagamento, fatura, cliente Asaas, assinatura, ativa
runner/outbox ou muda `empresa.plano_id`. `add-on pendente` não concede entitlement
(resolver exige `ativa`). Teste explícito garante que `solicitarAddons` não toca
`faturas`/`billing_outbox`/`cobrancas`. `ASAAS_TOUCHED=false`, `ENV_CHANGED=false`.

## 7. Segurança

- Cliente: `verifyToken + verificarEmpresa + permitirAssinaturaCliente` (motorista
  comum = 403; admin/owner/autônomo = ok). Tenant sempre do backend.
- Super-admin: rotas `/painel-admin/*` sob `isSuperAdmin`.
- Sem SQLSTATE/stack ao cliente; mensagens amigáveis.

## 8. Testes

- Backend: `snapshotUpgradeService.test.js` (preço por feature, ERP/SSO sob proposta,
  price_status, sem economia fantasma, estado de capacidade), `solicitacoesComerciaisService.test.js`
  (grava preço da feature / null p/ ERP-SSO, idempotência, sem billing/Asaas). Suíte
  completa no `backend-ci`.
- Web: `ComparadorPlanos.test.tsx` (ERP mostra "Sob proposta", sem R$149,90 fabricado;
  fluxo sem cobrança).

## 9. Deferidos (não disfarçados de implementados) — §90

- Downgrade guiado com guarda de capacidade (fluxo dedicado): `DEFERRED_COMMERCIAL_DECISION`.
- Cancelamento de solicitação pendente pelo cliente: `DEFERRED_DOMAIN` (o modelo atual
  não representa esse estado sem schema).
- Preço aprovado de ERP/SSO: `DEFERRED_COMMERCIAL_DECISION` (enquanto `preco_padrao_centavos`
  for null, seguem "sob proposta" — comportamento correto por design).
- Execução real de billing/proração/Asaas: fora desta frente por design.

`OWNER_VISUAL_VALIDATION=PENDING`.
