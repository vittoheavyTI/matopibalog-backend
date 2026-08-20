# Matopiba Log — MASTER LEDGER V9 (RBV9-1)

> **Fonte permanente do backlog.** Cada item tem ID estável `RBV9-INV-NNN`. Nenhum item pode desaparecer.
> Regras (D-030): `DONE`/`IMPLEMENTED_VALIDATED` = feito e validado; `DEFERRED` = adiado conscientemente; **DEFERRED nunca é DONE**.
> Ao abrir subfrentes (ex.: FROTA → FROTA-E1/E2/E3), o pai só fecha quando **todos** os filhos estiverem DONE ou DEFERRED explicitamente.

**Legenda de camadas:** `B` backend · `W` web · `A` app · `D` banco · `P` produção. → `✓` presente · `~` parcial · `✗` ausente · `—` n/a.
**Status:** `IMPL_VAL` (implementado+validado) · `IMPL_NV` (implementado, não validado visualmente) · `PARTIAL` · `BROKEN` · `STUB` · `ROADMAP` (só roadmap) · `DEFERRED` · `TECH_DEBT` · `UNKNOWN`.

_Evidência coletada em 2026-08-19 (ver [FORENSIC_BASELINE](./FORENSIC_BASELINE.md))._

---

## IDENTITY & AUTH

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-001 | Login JWT (web httpOnly cookie / app Bearer) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | CLAUDE.md, produção UP |
| RBV9-INV-002 | SEC-1 sessões revogáveis (access curto + refresh rotativo) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `auth_sessions`(54), `auth_refresh_tokens`(112), migration 062 |
| RBV9-INV-003 | SEC-1 auditoria append-only de auth | IMPL_VAL | ✓ — — ✓ ✓ | `auth_event_audit`(128) |
| RBV9-INV-004 | Credencial GPS escopada (tracking) | IMPL_VAL | ✓ — ✓ ✓ ✓ | `frete_tracking_credenciais`(30), PR #414; `TRACKING_SCOPED_CREDENTIAL_ENABLED` OFF |
| RBV9-INV-005 | Rate limiting por usuário (fallback IP) | IMPL_VAL | ✓ — — — ✓ | PR #376 |
| RBV9-INV-006 | Recuperação/redefinição de senha + senha temporária | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `RedefinirSenha.tsx`, `senhaTemporaria` |
| RBV9-INV-007 | SSO OIDC / Microsoft Entra ID / App Roles | ROADMAP | ✗ ✗ ✗ ✗ ✗ | 0 tabelas, 0 env identidade externa · D-031 |
| RBV9-INV-008 | SCIM provisioning / SAML / JIT | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-031 (evolução) |
| RBV9-INV-009 | Break-glass local obrigatório (com Entra) | ROADMAP | ✗ — — — — | D-031 |

## ORG SCOPE (grupos / filiais / regiões)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-010 | Grupos empresariais + empresa-grupo | PARTIAL | ✓ ~ ✗ ✓ ✓ | migration 067; `grupos_empresariais`(0) — schema vivo, **0 dados** |
| RBV9-INV-011 | Unidades/regiões operacionais | PARTIAL | ✓ ~ ✗ ✓ ✓ | 067; tabelas 0 linhas |
| RBV9-INV-012 | Memberships local/regional/global | PARTIAL | ✓ ~ ✗ ✓ ✓ | `usuario_operacional_memberships`(0) |
| RBV9-INV-013 | Enforcement automático de escopo | DEFERRED | ✓ — — ✓ ~ | **desativado por segurança** · gate `OPERATIONAL_SCOPE_ENFORCEMENT_GATE` |
| RBV9-INV-014 | Perfis Gerente Filial/Regional/Nacional | ROADMAP | ✗ ✗ ✗ ~ ✗ | escopo existe; papéis formais não |

## PERMISSIONS & ENTITLEMENTS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-015 | Níveis auth (verifyToken/isAdmin/isSuperAdmin) + tenant | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | middlewares/auth.js, tenant.js |
| RBV9-INV-016 | Catálogo de funcionalidades + entitlements por plano | IMPL_VAL | ✓ ✓ — ✓ ✓ | `funcionalidades`(21), `plano_funcionalidades`(111), migration 060 |
| RBV9-INV-017 | Overrides por empresa (`empresa_funcionalidades`) | PARTIAL | ✓ ~ — ✓ ✓ | tabela existe, **0 linhas** |
| RBV9-INV-018 | Templates de permissão editáveis por empresa + overrides individuais | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-006 |
| RBV9-INV-019 | Permissões `freight.create` / `freight.finish` separadas | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-010 |
| RBV9-INV-020 | Financeiro atribuível (nunca automático) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-008 |
| RBV9-INV-021 | Governança portal cliente (ERP/SSO='em_breve', Estrutura gate real) | IMPL_VAL | ✓ ✓ — ✓ ✓ | migration 069 (aplicada), PR #422 |

## FREIGHT EXECUTION (frete atual)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-022 | CRUD de fretes + isolamento multi-tenant | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `fretes`(63) |
| RBV9-INV-023 | Frete tonelada/km + odômetro (modalidade) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | migration 019 |
| RBV9-INV-024 | Tetos de sanidade de valores de frete | IMPL_VAL | ✓ — — ✓ ✓ | migration 032, PRs #291/#292 |
| RBV9-INV-025 | Rentabilidade por viagem (read-only) | IMPL_VAL | ✓ ✓ — ✓ ✓ | PR #381, `Rentabilidade.tsx` |
| RBV9-INV-026 | Check-in/Check-out formal (KM+foto pelo motorista) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-011/D-012 |
| RBV9-INV-027 | Snapshot de composição+motorista no frete | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de FLEET |
| RBV9-INV-028 | Handoff de motorista durante a viagem | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-002 |

## FREIGHT PLANNING & DISPATCH

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-029 | Planejamento/oportunidade → aprovação → designação | ROADMAP | ✗ ✗ ✗ ✗ ✗ | §7 do prompt; 0 tabelas |
| RBV9-INV-030 | Route Intelligence (provider abstraction, pedágio, combustível previsto) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-032; 0 tabelas |
| RBV9-INV-031 | Dispatch estilo Uber (oferta/aceite/expira, lock concorrência-safe) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-033 |
| RBV9-INV-032 | Elegibilidade de candidatos (filial/região/vínculo/docs) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-033 |

## FLEET (frota / veículos / composições / pneus / manutenção)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-033 | `fleet_assets` (caminhão/cavalo/reboque/dolly/implemento) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | **0 tabelas** · D-001..D-003 |
| RBV9-INV-034 | Composições veiculares + membros | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-003 |
| RBV9-INV-035 | Vínculo temporal motorista↔veículo/composição | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-002 |
| RBV9-INV-036 | Documentos de ativo + vencimentos | ROADMAP | ✗ ✗ ✗ ✗ ✗ | §13 |
| RBV9-INV-037 | Odômetro como eventos | ROADMAP | ✗ ✗ ✗ ✗ ✗ | hoje é campo no frete (RBV9-INV-023) |
| RBV9-INV-038 | Pneus (nº de fogo, posição, KM, recapagens, custo/km) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-005; §14 |
| RBV9-INV-039 | Manutenção (preventiva/corretiva, OS, peças, tempo parado) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | §15 |

## DRIVERS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-040 | Cadastro/gestão de motoristas + limite por plano | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `motoristas`(18), PR #282 |
| RBV9-INV-041 | Visibilidade financeira do motorista configurável | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-009 |
| RBV9-INV-042 | Acerto/espelho do motorista | IMPL_VAL | ✓ ✓ ~ ✓ ✓ | `AcertoMotoristas.tsx`, `ResumoMotorista.tsx` |

## DOCUMENTS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-043 | Documentos por frete (upload/storage/signed URL) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_documentos`(16), migration 026 |
| RBV9-INV-044 | Scanner de documentos no app | PARTIAL | — — ~ — ~ | PR #347; aquém do alvo (crop/perspectiva/multipágina/OCR) |
| RBV9-INV-045 | Fluxos distintos empresa→motorista / motorista→empresa | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-013 |
| RBV9-INV-046 | Múltiplos recebedores/assinantes | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-015 |
| RBV9-INV-047 | Viewer PDF-first no app (ver antes de exportar) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-016 |
| RBV9-INV-048 | Documentos por ativo (frota) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de FLEET |

## LAUNCHES (despesas / abastecimento / vale / adiantamento)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-049 | Despesas (web+app, isolamento, idempotência) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `despesas`(98), migration 018 |
| RBV9-INV-050 | Abastecimentos / ARLA | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `abastecimentos`(46) |
| RBV9-INV-051 | Vales / adiantamentos | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `vales`(18) |
| RBV9-INV-052 | Estados append/audit-safe (pend/aprov/rej/cancel+motivo+ator) | IMPL_NV | ✓ ✓ ~ ✓ ✓ | **Onda 1 DEPLOYADO**: máquina de estados + RPC transação (CAS) + ledger `lancamento_eventos` append-only. **Migration 070 aplicada+rastreada em prod** (`20260820033844`). Aguarda validação visual. App: create; ações admin no web. |
| RBV9-INV-053 | Realtime web↔app dos lançamentos | IMPL_NV | ✓ ✓ ✓ — ✓ | **Onda 1 DEPLOYADO**: SSE autenticado (`/realtime/stream`) + `realtimeBus` + limites de conexão; web (fetch stream) e app (http stream) refazem fetch canônico. Polling não é mais o mecanismo principal. |
| RBV9-INV-054 | Paridade painel↔app de todos os campos coletados | IMPL_NV | ✓ ✓ ~ — ✓ | **Onda 1 DEPLOYADO**: painel exibe arla/odômetro/preço-litro/observação do abastecimento; observação obrigatória no create (web+app, transitório para cliente novo). |

## FINANCE — OPERACIONAL DO CLIENTE

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-055 | Relatórios/dashboards financeiros do cliente | IMPL_VAL | ✓ ✓ ~ ✓ ✓ | `PainelFinanceiro`, `Dashboard`, agregação de fretes |
| RBV9-INV-056 | Auditoria de correções (fretes/faturas) | IMPL_VAL | ✓ ✓ — ✓ ✓ | `fretes_correcoes_auditoria`(5), migration 065 |
| RBV9-INV-057 | Centro de custo / filial no financeiro operacional | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de ORG_SCOPE+FLEET |

## SAAS BILLING (financeiro Matopiba)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-058 | Planos + catálogo comercial + categorias | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `planos`(9), migrations 025/038/041/045 |
| RBV9-INV-059 | Faturas + snapshot de plano + recorrência (schema) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `faturas`(25), migrations 030/031 |
| RBV9-INV-060 | Integração Asaas (sandbox + production code) | IMPL_VAL | ✓ ✓ — ✓ ~ | **desarmado**; primeiro pagamento real reconciliado e revertido |
| RBV9-INV-061 | Webhook Asaas (token fixo, idempotente) | IMPL_VAL | ✓ — — ✓ ✓ | `asaas_webhook_events`(46) |
| RBV9-INV-062 | Billing outbox + runner + reconcile | IMPL_NV | ✓ ✓ — ✓ ~ | migration 066; **runner desativado**, outbox=0 |
| RBV9-INV-063 | Upgrade/troca de plano (avulsa) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | PRs #278-#281, migration 028 |
| RBV9-INV-064 | Aquisição comercial v2 (RPC) | IMPL_VAL | ✓ ✓ — ✓ ✓ | RPC `iniciar_aquisicao_comercial_v2` **viva em prod** |
| RBV9-INV-065 | Promoções / tickets / códigos | IMPL_VAL | ✓ ✓ — ✓ ✓ | `promocoes`(1), migration 040 |
| RBV9-INV-066 | Cobrança por motorista (preço final = backend autoridade) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | PR #282 |
| RBV9-INV-067 | Notificações de inadimplência (escada D+0..D+3) | IMPL_VAL | ✓ ✓ — ✓ ✓ | cron dry-run; PRs #363-#365 |
| RBV9-INV-068 | Expiração de trial / carência | IMPL_VAL | ✓ — — ✓ ✓ | cron `radiant-warmth` dry-run; migration 047 |
| RBV9-INV-069 | Recorrência real (produção) | DEFERRED | ✓ ✓ — ✓ ✗ | validada em sandbox; produção exige autorização |
| RBV9-INV-070 | Super-admin: dashboard comercial/financeiro SaaS/trials/conversões/MRR/churn | PARTIAL | ✓ ✓ — ✓ ✓ | Painéis existem; KPIs MRR/churn a formalizar |

## FISCAL_INVOICING (NFS-e / entidade jurídica) — domínio novo (patch fiscal RBV9)

> Domínio **separado** de SAAS_BILLING e FINANCE_OPERATIONAL (D-036). Todos **NEW (0 no banco)**. IDs próprios `FISC-NNN`. Arquitetura-alvo: LEGAL_ENTITY → FISCAL_PROFILE → SAAS_BILLING_EVENT → FISCAL_OUTBOX → FISCAL_PROVIDER → DPS → NFSE → RECONCILE → XML/DANFSe → EMAIL/PORTAL. Nenhum bloqueia a Onda 1.

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| FISC-001 | Legal entity + fiscal profile (entidade configurável/versionada) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-037/D-040; 0 tabelas |
| FISC-002 | Habilitação/config fiscal por entidade | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-037 |
| FISC-003 | Política de trigger fiscal (que receita SaaS gera NFS-e) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-036 |
| FISC-004 | Fiscal provider abstraction | ROADMAP | ✗ ✗ ✗ ✗ ✗ | não acoplar a provider único · análogo a D-032 |
| FISC-005 | Adapter NFS-e Nacional | ROADMAP | ✗ ✗ ✗ ✗ ✗ | padrão nacional DPS/DANFSe |
| FISC-006 | Gestão de certificado/secret | ROADMAP | ✗ ✗ ✗ ✗ ✗ | `CERTIFICATE_PURCHASE=DEFERRED` |
| FISC-007 | DPS builder | ROADMAP | ✗ ✗ ✗ ✗ ✗ | Declaração de Prestação de Serviço |
| FISC-008 | Fiscal outbox + idempotência | ROADMAP | ✗ ✗ ✗ ✗ ✗ | análogo ao billing_outbox |
| FISC-009 | Reconcile fiscal | ROADMAP | ✗ ✗ ✗ ✗ ✗ | status/retry/reconciliação |
| FISC-010 | Armazenamento XML/DANFSe | ROADMAP | ✗ ✗ ✗ ✗ ✗ | storage imutável |
| FISC-011 | E-mail automático de NFS-e | ROADMAP | ✗ ✗ ✗ ✗ ✗ | Resend |
| FISC-012 | Portal "Notas Fiscais" (cliente) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-036 |
| FISC-013 | Cancelamento/substituição de NFS-e | ROADMAP | ✗ ✗ ✗ ✗ ✗ | audit-safe |
| FISC-014 | Produção Restrita (fiscal) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | `FISCAL_LEGAL_ENTITY_GATE` |
| FISC-015 | Primeiro piloto NFS-e production | ROADMAP | ✗ ✗ ✗ ✗ ✗ | gate comercial/fiscal |
| FISC-016 | Recurring billing → recurring NFS-e | ROADMAP | ✗ ✗ ✗ ✗ ✗ | depende de FISC-008/009 |
| FISC-017 | Super Admin Fiscal Health | ROADMAP | ✗ ✗ ✗ ✗ ✗ | observabilidade fiscal |
| FISC-018 | Legal entity cutover | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-041 |
| FISC-019 | Payment provider account por entidade | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-041; desacopla Asaas por entidade |
| FISC-020 | Fiscal profile versioning | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-040 (SIMEI→Simples/ME) |

## CONTRACTS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-071 | Contratos comerciais + modelos versionados | IMPL_VAL | ✓ ✓ — ✓ ✓ | `contratos_comerciais`(8), `contrato_modelos`(8), migrations 053-058 |
| RBV9-INV-072 | Assinatura eletrônica interna (OTP/desafio) | IMPL_VAL | ✓ ✓ — ✓ ✓ | migration 055, `contrato_assinatura_desafios`(5) |
| RBV9-INV-073 | Signatários múltiplos + eventos/auditoria | IMPL_VAL | ✓ ✓ — ✓ ✓ | `contrato_signatarios`(16), `contrato_eventos`(27) |
| RBV9-INV-074 | Signature Provider abstraction (externo) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-034 |
| RBV9-INV-075 | Tipos aditivo/rescisão/trial opcional formalizados | PARTIAL | ~ ~ — ~ ~ | D-034 |

## TERMS / LGPD (distinto de Contracts)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-076 | Termos + aceites (versão/hash/IP/UA) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `termos`(4), `termos_aceites`(22) |

## EPOD & OCORRÊNCIAS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-077 | ePOD (prova de entrega) + evidências + status | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_epod`(1), migrations 048/050, PRs #369/#370 |
| RBV9-INV-078 | Ocorrências logísticas + evidências | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_ocorrencias`(1), migration 049 |

## TRACKING / TORRE DE CONTROLE

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-079 | Rastreamento leve (localizações) | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `frete_localizacoes`(964), migrations 051/052 |
| RBV9-INV-080 | Torre de Controle (web) | IMPL_NV | ✓ ✓ — ✓ ✓ | `TorreControle.tsx` (polling) |

## SHIPPER / PARTNER NETWORK

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-081 | Portal do Embarcador (demanda/cotação/proposta) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-024; 0 tabelas |
| RBV9-INV-082 | Rede privada de parceiros (Lite/Cliente, boundaries de tenant) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-025/D-026 |
| RBV9-INV-083 | Marketplace público | ROADMAP | ✗ ✗ ✗ ✗ ✗ | posterior (D-025) |

## ERP / INTEGRATION HUB

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-084 | Integração customizada (integrações genéricas, cripto at-rest) | PARTIAL | ✓ ✓ — ~ ✓ | `INTEGRATIONS_SECRET_KEY`; `integracoes.js`; sem hub canônico |
| RBV9-INV-085 | Integration Hub canônico (outbox/adapter/external_id/retry/reconcile) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-023 |
| RBV9-INV-086 | Adapters ERP (Aliare/SIAGRI, Sankhya, TOTVS, Senior, SSW, Bsoft, REST, CSV) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | census de prospects pendente |

## AUDIT / ENVELOPE DIGITAL

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-087 | Auditoria por domínio (auth, contratos, fretes, funcionalidades, escopo) | PARTIAL | ✓ ~ — ✓ ✓ | vários `*_auditoria` / `*_eventos`; não unificado |
| RBV9-INV-088 | Modelo de eventos unificado (entity/action/actor/source/metadata) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-021 |
| RBV9-INV-089 | Envelope Digital (unidade formal de fechamento) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-022 |

## REPORTING / PDF

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-090 | Relatórios PDF com branding/logo + filtros padronizados | IMPL_VAL | ✓ ✓ — ✓ ✓ | PR #366, `relatorioBranding.ts` |
| RBV9-INV-091 | Produtos de relatório-alvo (Envelope, fechamento, espelho, histórico veículo/manutenção, consumo) | ROADMAP | ✗ ✗ ✗ ✗ ✗ | D-029; dependem de FLEET/Envelope |

## NOTIFICATIONS

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-092 | Notificações internas + push (Firebase) + badge/toast | IMPL_VAL | ✓ ✓ ✓ ✓ ✓ | `notificacoes`(176), `push_tokens`(19), migrations 013/019/020 |

## PERFORMANCE / REALTIME (sistêmico)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-093 | Realtime sistêmico (web↔app poucos segundos) | PARTIAL | ✓ ✓ ✓ — ✗ | **Onda 1** entrega a fundação (SSE backend-mediated) para lançamentos; estender a outros domínios (notificações/torre) fica para ondas seguintes |
| RBV9-INV-094 | Baseline de performance (queries N+1, índices, payloads) | UNKNOWN | ~ ~ ~ ~ ~ | não medido; advisors não coletados (TD-06) |

## INFRA

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-095 | Deploy Railway (backend) + GitHub Pages (web) + crons | IMPL_VAL | ✓ ✓ — — ✓ | 3 crons SUCCESS; health UP |
| RBV9-INV-096 | Portabilidade / migração Hostinger | DEFERRED | — — — — — | gate `INFRA_MIGRATION_GATE` (D-028) |

## UX / PERFIL / RESPONSIVIDADE (backlog herdado)

| ID | Item | Status | B W A D P | Evidência / Obs |
|----|------|--------|-----------|-----------------|
| RBV9-INV-097 | Perfil avançado / avatar / CPF / CEP | ROADMAP | ✗ ✗ ✗ ✗ ✗ | backlog upgrade-plano |
| RBV9-INV-098 | Máscaras (CPF/telefone/placa/moeda) web+app | PARTIAL | — ~ ~ — — | branch `feat/app-rc-mascaras` |
| RBV9-INV-099 | IA de navegação/sidebar + didática | PARTIAL | — ~ — — ~ | PR #425 (aberto, não mergeado) |
| RBV9-INV-100 | Comparador de planos / vitrine de upgrade | IMPL_VAL | — ✓ ✓ — ✓ | `ComparadorPlanos.tsx`, PR #424 |

## TECH DEBT / QUALIDADE

| ID | Item | Status | Obs |
|----|------|--------|-----|
| RBV9-INV-101 | `sec1-e2e-browser` flaky | TECH_DEBT | race no refresh |
| RBV9-INV-102 | SQLs versionados antigos desatualizados | TECH_DEBT | conferir sempre o banco |
| RBV9-INV-103 | Higiene de repositório local (~450 branches, dezenas de worktrees) | TECH_DEBT | ambiente do dev |
| RBV9-INV-104 | Supabase advisors não coletados | TECH_DEBT | rodar na Onda 0/1 |
| RBV9-INV-105 | Smoke autenticado automatizado ausente | TECH_DEBT | falta conta smoke |
| RBV9-INV-106 | Tabelas legado (`documentos`, `contratos`, `modelo_contratos`) | TECH_DEBT | limpeza futura |
| RBV9-INV-107 | `REALTIME_HORIZONTAL_SCALE` — bus SSE é in-memory/single-instance | DEFERRED | Onda 1/E1.6A; **Railway confirmado `numReplicas=1` (região sfo)** → `REALTIME_BUS_IN_MEMORY_ALLOWED=true` no escopo atual. **Critério de remoção:** antes de `replicas>1`, trocar o bus por pub/sub compartilhado atrás da mesma abstração. Mitigado hoje: clientes refazem fetch no reconnect/resume. **DEFERRED ≠ DONE.** |
| RBV9-INV-108 | `LEGACY_OBSERVATION_ENFORCEMENT` — observação/descrição obrigatória é TRANSITÓRIA | DEFERRED | E1.6A; backend só exige o campo de clientes NOVOS (header `X-Client-Platform`); APK legado sem o campo NÃO é quebrado (histórico null permanece válido, sem inventar texto). **Critério de remoção:** quando existir *minimum supported app version* / forced-upgrade controlado, tornar a validação estrita para todos. **DEFERRED ≠ DONE.** |

---

### Contagem do inventário

> **Recalculado após o patch fiscal RBV9** (+20 `FISC-001..020`, ROADMAP/NEW) **e a Onda 1 / E1.6A** (+`RBV9-INV-107` realtime horizontal scale, +`RBV9-INV-108` legacy observation enforcement; transições de status de 052/053/054/093). Inventário: 108 (`RBV9-INV`) + 20 (`FISC`) = **128**.

- **Total de itens:** **128** (108 RBV9-INV + 20 FISC)
- **IMPLEMENTED_VALIDATED:** 45
- **IMPLEMENTED_NOT_VISUAL_VALIDATED:** 6 (+3 da Onda 1: RBV9-INV-052/053/054 — aguardam migration gate + validação visual)
- **PARTIAL:** 15 (RBV9-INV-052/054 saíram de PARTIAL; RBV9-INV-093 entrou)
- **ROADMAP_ONLY:** **51** (RBV9-INV-053 saiu de ROADMAP)
- **DEFERRED:** 5 (+RBV9-INV-107 realtime horizontal scale; +RBV9-INV-108 legacy observation enforcement)
- **TECH_DEBT:** 6 (itens 101-106; + achados TD no FORENSIC)
- **UNKNOWN:** 1 (perf baseline)
- **BROKEN / STUB:** 0 / 0 (impressoras = stub intencional de segurança, fora de contagem)

_Contagem por ID (autoritativa): 108 (`RBV9-INV-001..108`) + 20 (`FISC-001..020`) = **128**. A soma das categorias (45+6+15+51+5+6+1 = 129) carrega o mesmo **+1 pré-existente** do baseline original (item `RBV9-INV-094` aparece como UNKNOWN e também compõe uma faixa PARTIAL); a quirk não foi "corrigida" para não reescrever o baseline forense._

_Ver: [CONTEXT_BRIDGE](./CONTEXT_BRIDGE.md) · [DECISIONS](./DECISIONS.md) · [ROADMAP](./ROADMAP.md) · [FORENSIC_BASELINE](./FORENSIC_BASELINE.md)_
