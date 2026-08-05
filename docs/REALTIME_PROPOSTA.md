# Proposta arquitetural — Atualização automática e tempo real

> **Auditoria/proposta (PR 2C-C1.1). NÃO implementar realtime global aqui.**
> O PR 2C-C1.1 entrega **atualização automática controlada** (foco/reconexão +
> polling ~30s) nas páginas administrativas. Realtime por conexão persistente é
> decisão posterior do proprietário. Este documento serve à decisão.

## Classificação por módulo

### A. Tempo real (segundos) — candidatos a push/conexão persistente
- Torre de Controle; notificações; ocorrências; ePOD; status de viagem; eventos
  operacionais críticos.
- Necessidade: latência baixa, eventos empurrados pelo servidor.

### B. Atualização automática periódica / por foco — **já atendido pelo polling**
- Usuários; Empresas; Planos; catálogo de funcionalidades; configurações admin.
- Necessidade: frescor "em segundos a dezenas de segundos" é suficiente. Polling
  de ~30s com pausa (aba oculta/offline/em-voo) já cobre, com custo baixo.

## Opções técnicas (trade-offs)
| Opção | Prós | Contras / risco |
|---|---|---|
| **Polling (atual)** | simples; sem estado de conexão; barato; funciona atrás de proxy | frescor limitado ao intervalo; carga proporcional a usuários×intervalo |
| **Supabase Realtime** | push nativo; integra RLS | multi-tenant via RLS por canal exige cuidado; nº de conexões; custo; reconexão; entrega duplicada; ordenação; o backend hoje usa service_role (RLS não é a autoridade) |
| **WebSocket próprio** | controle total | infra nova (conexões, escala, auth, reconexão) no Railway; observabilidade |
| **SSE** | simples (HTTP unidirecional); reconecta sozinho | 1 conexão por aba; unidirecional; limites de conexões por navegador |
| **Invalidação por evento (webhook→canal)** | eficiente; empurra só o que mudou | exige barramento de eventos e roteamento por tenant |
| **Híbrido** | push nos módulos A + polling nos B | mais partes para operar |

## Riscos a endereçar antes de qualquer realtime
- **Multi-tenant / RLS:** a app usa **service_role no backend** (RLS não é hoje a
  autoridade). Um canal Realtime por tenant exige política de canal correta para
  não vazar entre tenants.
- Nº de conexões e custo; reconexão; **entrega duplicada** e **perda de evento**;
  **ordenação**; **sincronização inicial** (snapshot + stream); **fallback para
  polling**; impacto no **app móvel** (Flutter) e no **backend**; **observabilidade**.

## Recomendação
1. **Agora (PR 2C-C1.1):** manter polling controlado nos módulos B. **Feito.**
2. **Futuro (decisão do proprietário):** avaliar push apenas nos módulos A
   (Torre/notificações/ePOD/status de viagem), começando por **SSE** ou
   **Supabase Realtime** com um POC restrito a 1 módulo e 1 tenant, medindo
   conexões/custo/duplicidade, sempre com **fallback para polling**.
3. **Não** adotar realtime global de uma vez; **não** trocar o modelo de auth
   (ver PR SEC-1) sem plano próprio.
