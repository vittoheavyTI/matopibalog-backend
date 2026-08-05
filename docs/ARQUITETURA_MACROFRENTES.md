# Arquitetura — Macrofrentes de Catálogo, Integração e IA

> Registro de roadmap (PR 2C). **Não substitui** as decisões existentes; complementa.
> Preserva contratos, trial, billing, ePOD, rentabilidade, acerto, Torre, rastreamento,
> filiais, frota e demais frentes já entregues.

## Fundação já entregue (PR 2C)
- **Catálogo estruturado de funcionalidades** (`funcionalidades`, `plano_funcionalidades`,
  `funcionalidade_dependencias`, `empresa_funcionalidades`, `funcionalidade_auditoria`).
- **Entitlement service** canônico no backend (`entitlementDomainService`): separa
  estado técnico × entitlement comercial × visibilidade. Backend é a autoridade.
- Cards públicos consomem o catálogo (rótulos: Incluído / Adicional / Em breve / Sob consulta).

## Macrofrentes registradas (NÃO implementadas — não vender como concluídas)
- **A. Catálogo de Funcionalidades, Entitlements e Add-ons** — fundação entregue; falta
  página super-admin completa (Matriz/Clientes) e cobrança de adicionais (PR 3A).
- **B. Integration Hub e conectores de ERP** — adapters, modelo canônico, filas,
  idempotência, auditoria. `funcionalidades.codigo = 'erp_api' / 'webhooks_empresariais'`.
- **C. Orquestração de documentos fiscais pelo ERP/provedor** — `vinculo_docs_fiscais`,
  `emissao_por_erp`. Matopiba **não** emite; orquestra criação, retorno e vínculo.
- **D. Demanda de transporte, compra e aprovação de frete** — `demanda_frete`.
- **E. Disponibilidade, despacho assistido e ofertas automáticas** — `despacho_assistido`.
- **F. SSO corporativo Entra ID/AD** — `sso_entra_ad`.
- **G. IA por nível de plano** — `ia_operacional` (multi-filial, agentes personalizados).

## Princípios
- Matopiba **não** pretende substituir o ERP.
- Dados capturados **uma vez**; ERP/provedor permanece **fonte fiscal autoritativa**.
- Matopiba **orquestra** criação, retorno e vínculo dos documentos.
- Integração usa **adapters + modelo canônico + filas + idempotência + auditoria**.
- Fluxo normal é **automático**; exceções têm **fallback humano**.
- Funcionalidades futuras **não** são vendidas como concluídas: só aparecem como
  "Em breve" quando o proprietário ativa `visivel_publicamente`.

## Estado técnico × comercial × visibilidade
| Conceito | Campo | Autoridade |
|---|---|---|
| Implementada? | `funcionalidades.status_ciclo_vida` | Engenharia |
| Incluída/adicional no plano? | `plano_funcionalidades.disponibilidade` | Comercial (super-admin) |
| Aparece no card? | `funcionalidades.visivel_publicamente` + `plano_funcionalidades.exibir_no_card` | Comercial |
| Acesso em runtime | `entitlementDomainService.resolverEntitlement` (+ `requireFeature` futuro) | Backend |
