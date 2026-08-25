# Portal do Embarcador V1 — PORTAL-B (acesso, revisão, acompanhamento, comprovantes)

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados após o fechamento técnico. Continuação de
> [SHIPPER_PORTAL_V1](./SHIPPER_PORTAL_V1.md) (PORTAL-A).

- `MACROFRONT=E3_5_SHIPPER_PORTAL_V1_PORTAL_B` · fatia `PORTAL-B`
- `MIGRATION_REQUIRED=true` · `MIGRATION_FILE=081_shipper_portal_b_revision_documents.sql`
- `PORTAL_B_PRODUCTION_MIGRATION_AUTHORIZED=false` — **não aplicada em lugar nenhum**
- `BUSINESS_DML=0`

## 1. O que o PORTAL-A deixou pronto e o que faltava

PORTAL-A fechou com uma característica que precisa ser dita sem rodeio: entregou
**domínio e fronteira**, e **nenhuma rota HTTP**. Os serviços em
`services/shipperPortal/` não eram importados por nada, e nenhum embarcador
conseguia entrar. A única mudança viva em produção era a auth interna recusar
`token_kind='shipper_portal'`.

PORTAL-B liga isso a uma experiência real.

## 2. Auditoria delta (§8–§9)

| Pergunta | Achado | Consequência |
|---|---|---|
| O que existe e não está ligado a HTTP? | Os 3 serviços do portal, o middleware de token e as 5 RPCs da 080 | `WIRE_ONLY` — nada a reescrever |
| Primitivas de login/ativação externas? | Supabase Auth (senha) reusável; **não havia RPC de ativação de convite** | RPC nova |
| Documentos expostos com segurança? | Nenhum. `frete_documentos` é interno; ePOD é prova operacional | Precisa de autoridade nova |
| Existe autoridade de compartilhamento? | **Não existe em lugar nenhum do schema** | `NEW_REQUIRED` |
| Comprovante projetável sem schema? | `frete_epod_evidencias.status='aprovada'` basta para "aprovado"… | …mas §63 exige liberação explícita |
| Tracking mapeável sem adivinhar? | **Sim** — `freightExecutionStatus.js` já é o mapa congelado com UNKNOWN seguro | `REUSE_AS_IS` |
| Shell externo no frontend? | **Não** — só o shell interno, com `AuthContext` e `api.ts` acoplados ao tenant | Shell/cliente próprios |
| CHANGES_REQUESTED tem histórico? | **Não** — um único `submitted_snapshot` por solicitação | `NEW_REQUIRED` |

## 3. Por que houve migration

Duas lacunas, e só duas, exigiram schema:

**Histórico de submissão.** Reenviar sobrescreveria `submitted_snapshot` — e a
evidência exata que a transportadora avaliou ao pedir ajustes deixaria de
existir. §34/§35 proíbem destruir evidência de decisão. A tabela
`shipper_transport_request_submissions` é append-only e carrega a decisão **na
versão avaliada**, o que responde a pergunta que só o histórico responde: *o
aceite se refere a qual versão?*

**Visibilidade externa de documento.** Não havia nada no schema dizendo "este
documento pode ser visto pelo embarcador". Decidir por heurística (tipo do
documento, nome do arquivo, status do ePOD) seria adivinhar — e adivinhar aqui
significa vazar documento operacional para fora da transportadora.
`shipper_document_shares` é essa autoridade: explícita, revogável, com histórico.

O que **não** virou schema, por já existir: mapa de status de execução,
proveniência solicitação→campanha→fretes, storage privado com signed URL, e o
Supabase Auth como autoridade de senha.

## 4. Fronteira externa (o que mudou e o que não mudou)

Não mudou nada no modelo do PORTAL-A: identidade externa em tabelas próprias sem
`empresa_id`, acesso via relacionamento ATIVO, isolamento entre embarcadores da
mesma transportadora garantido por FKs compostas.

O que PORTAL-B acrescenta é a superfície, em dois namespaces que **nunca**
compartilham contexto:

| | Externa | Interna |
|---|---|---|
| Rota | `/portal/embarcador` | `/shipper-inbox` |
| Sessão | `token_kind='shipper_portal'` | sessão da transportadora |
| Middleware | `verifyPortalToken` | `verifyToken` + `verificarEmpresa` + `verificarPlano` |
| Autorização | identidade externa ∧ usuário ativo ∧ relacionamento ativo ∧ objeto do relacionamento | entitlement ∧ permissão efetiva ∧ escopo ∧ tenant |
| Cliente web | `portal/portalApi.ts` (instância própria) | `api.ts` |

O frontend do portal fica **fora** do `AuthProvider` interno: o embarcador não
dispara `/auth/me` da transportadora e não herda nada dela. As duas árvores
coexistem no mesmo navegador sem se misturar.

## 5. Invariante do aceite (congelada no owner review do PORTAL-A)

Aceitar exige `shipper_portal.requests.review` **e** `campaign.create`.

O motivo: aceitar não é "decidir sobre um registro" — cria uma operação real via
Operation Orchestrator. Sem a segunda permissão, o portal seria um caminho
lateral para criar campanha sem ter permissão de campanha.

`operador` continua sem nenhuma permissão de portal por padrão, incluindo a nova
`shipper_portal.documents.share`.

## 6. Revisão auditável

```
v1 enviada ──▶ transportadora pede ajustes ──▶ decisão carimbada NA v1
                                                      │
                          embarcador corrige ─────────┘
                                     │
                                     ▼
                              v2 enviada (v1 intacta)
                                     │
                          transportadora aceita ──▶ decisão carimbada NA v2
```

A RPC `shipper_request_revise_and_resubmit` trava a solicitação com `FOR UPDATE`
— a mesma linha que aceite, rejeição e cancelamento disputam. Existe uma ordem
serial única de desfechos. `expected_version` é controle otimista: se outra
pessoa da mesma empresa corrigiu enquanto a tela estava aberta, o reenvio falha
em vez de sobrescrever o trabalho dela.

`shipper_request_decide` (rejeitar/pedir ajustes) passou a ser atômica. Antes era
um UPDATE condicional na aplicação: protegia contra outra rejeição, mas concorria
com aceite e cancelamento **sem travar a linha**.

## 7. Acompanhamento

O portal não tem máquina de estados própria. `shipperTrackingService` projeta o
estado canônico em vocabulário externo, com uma ordem de autoridade explícita:
comprovante > fretes > campanha > solicitação.

Dois cuidados que valem ser destacados:

- **Status desconhecido nunca vira "Em transporte"** — vira "Atualização em
  processamento". Fabricar progresso faria o embarcador acreditar que a carga
  saiu quando ninguém sabe se saiu.
- **Nada aparece por heurística.** A cadeia é `solicitação → campaign_id →
  campaign_trip_freights → fretes`. Um frete histórico com destino parecido não
  entra.

Campanha cancelada internamente **não** vira "Cancelada" para o embarcador:
cancelar planejamento interno não é uma decisão comunicada a ele.

## 8. Documentos e comprovantes

Três origens, e só três:

1. o embarcador enviou → `shipper_request_documents`
2. a transportadora liberou um documento → `shipper_document_shares` (`FRETE_DOCUMENTO`)
3. a transportadora liberou um comprovante → `shipper_document_shares` (`EPOD_EVIDENCIA`)

Projeção por whitelist, nunca "linha menos campos sensíveis". `storage_path`
jamais sai do backend. A URL assinada (300s) só é emitida **depois** da checagem
de fronteira sobre o objeto concreto. Revogar o compartilhamento para de assinar
imediatamente, e uma evidência que não esteja `aprovada` não é servida como
comprovante final mesmo se compartilhada.

## 9. Falha parcial na ativação (§21)

A ativação atravessa dois sistemas sem transação comum:

- **fase 1 (Auth, idempotente por e-mail):** cria ou reencontra a identidade;
- **fase 2 (banco, atômica):** `shipper_invitation_activate`.

Se a fase 2 falhar, sobra uma identidade de auth **sem vínculo de portal** — que
não autoriza nada (`loadPortalContext` exige linha em `shipper_portal_users`) e é
reencontrada na próxima tentativa com o mesmo convite. Não desfazemos a
identidade: se ela já existia antes, apagá-la destruiria uma conta legítima.

Detalhe de segurança que merece registro: quando o e-mail **já tem conta**, a
senha digitada no convite **não é aplicada**. Redefinir permitiria assumir o
controle de uma conta existente — inclusive a de um usuário interno da
transportadora — com um convite. A tela informa isso explicitamente.

## 10. Entrega de convite

Não há e-mail transacional de convite nesta fatia. O token em claro é devolvido
**uma vez**, na criação, ao usuário interno autorizado, que o repassa. Fingir
"e-mail enviado" sem provedor configurado seria mentir para o operador (§17).
Só o hash é persistido; o token nunca é logado.

## 11. Achado da revisão de janelas de falha (§152)

A revisão encontrou um vazamento real que eu mesmo havia introduzido, e vale
registrar porque a versão errada parecia a mais natural.

`cadastrarEmbarcador` procurava a organização pelo nome em
`shipper_organizations` **globalmente**, para reusar em vez de duplicar. O schema
permite que um embarcador se relacione com várias transportadoras (§22), então
reusar parecia certo. Só que o acesso do portal é **por organização**:
`loadPortalContext` devolve todos os relacionamentos ativos dela. Consequência:

1. a transportadora A, digitando um nome, descobriria que aquele embarcador
   existe e quantos contatos ativos ele tem — cadastrados pela B;
2. os contatos cadastrados pela B passariam a enxergar a A automaticamente.

Bastaria acertar o nome para se enxertar na base de outra transportadora.

**Correção:** a busca por embarcador existente é feita somente entre os que já
têm relacionamento com **esta** transportadora. Unificar organizações entre
transportadoras é uma decisão de produto que ninguém tomou — é Partner Network,
fora de escopo. O schema continua suportando N relacionamentos para quando essa
decisão existir. Dois testes congelam os dois lados: nome igual de outra
transportadora **não** reusa; nome igual dentro da própria **reusa**.

## 12. Testes

| Suíte | Contagem | Cobre |
|---|---|---|
| PG real 081 | 27 | histórico, 4 corridas de reenvio, ativação concorrente, fronteira de compartilhamento, permissão do operador |
| Backend 081B | 31 | mapa de status, whitelist da linha do tempo, isolamento mesmo-transportadora, IDOR de documento/comprovante, varredura de chaves proibidas, separação de credenciais |
| Web portal | — | estados de carregamento/erro/vazio, correção pré-preenchida, idempotência do envio, ausência de jargão interno |
| Web caixa de entrada | — | aceite sem redigitação, motivo obrigatório, conversão pendente visível |

## 13. Fora de escopo (mantido)

Partner Network, Marketplace, ERP, Billing no portal, financeiro interno,
ações de escrita da IA, provider de rota novo. Cotação/proposta segue **deferida**
(`PORTAL_QUOTE_PROPOSAL_V1B`): não há autoridade canônica de preço
embarcador↔transportadora.

Envelope digital: **deferido** — não há artefato de fechamento estável hoje, e
construí-lo dentro do PORTAL-B seria inventar autoridade nova.
