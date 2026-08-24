# Route Intelligence V1

> Documento de frente (Claude). Não é fonte canônica; ROADMAP/MASTER_LEDGER/CONTEXT_BRIDGE
> são atualizados pelo integrator após o fechamento técnico.

- `MACROFRONT=ROUTE_INTELLIGENCE_V1`
- `BASE_SHA=14a1d1fc05c63ba9859e50b6908eb8b7eb227069`
- `MIGRATION_REQUIRED=false` · `SCHEMA_CHANGES=0` · `ROUTE_PROVIDER_MODE default=disabled`

## 1. Objetivo
Reduzir trabalho manual (abrir mapa externo, copiar km, estimar tempo/combustível na mão)
com uma camada **provider-agnostic** e **production-inert** para distância, duração,
pedágio (quando conhecido), combustível (quando os inputs existem) e custo — sem provider
real, sem secret e sem schema.

## 2. Arquitetura (provider abstraction)
`RouteProviderGateway` seleciona o provider por `ROUTE_PROVIDER_MODE`:
- `disabled` (default de produção) → nenhum provider externo; **entrada manual continua funcionando**;
- `fake` → determinístico (testes/dev), sem rede; não fabrica pedágio nem restrição de caminhão;
- `http` → adapter HTTP genérico (OSRM-compatível), **pronto** para o futuro, exige `ROUTE_PROVIDER_URL`, sem key hardcoded, **nunca ativado** nesta frente.

A camada de negócio não conhece o formato do vendor — só o adapter normaliza. Trocar de
provider não reescreve a lógica. Sem scraping de mapas.

## 3. Contrato normalizado (unknown ≠ zero)
`{ origin, destination, route_source (MANUAL|PROVIDER|UNAVAILABLE), provider, availability,
distance_km, duration_minutes, tolls_amount|null, truck_restrictions_status, fuel{status,liters,cost},
cost{fuel_cost,tolls_cost,other_known_cost,estimated_route_cost,partial}, calculated_at, warnings }`.
Pedágio desconhecido = `null` (não 0). Restrições de caminhão = `UNAVAILABLE` em V1 (nenhuma
alegação de segurança a partir de roteamento de carro).

## 4. Fallback manual (§76)
Distância/duração/pedágio podem ser informados manualmente (`route_source=MANUAL`) e o
cálculo funciona mesmo com provider `disabled` — o produto é útil sem provider.

## 5. Combustível e custo (§83–86)
Combustível só é calculado quando `distance_km`, `consumption_km_per_liter` e
`fuel_price_per_liter` são todos informados/autoritativos — **nunca** consumo/preço inventados;
senão `UNAVAILABLE`. Custo soma apenas valores conhecidos e marca `partial` quando algo falta.
Duração é rotulada como estimativa de rota, **não** prazo legal (não considera janelas/descanso).

## 6. API e segurança
- `GET /route-intelligence/capabilities` (nunca expõe URL/secret).
- `POST /route-intelligence/estimate` — `verifyToken` + tenant + `requirePermission('freight.view')`; read-only, sem persistência.
- Contexto de frete opcional (`frete_id`): o servidor deriva origem/destino do frete **do próprio tenant + escopo** (sem IDOR). Sem `route.superuser`.

## 7. IA (read-only)
Tool opcional `route.estimate` no AI Copilot (provider inalterado/inerte): reusa o serviço,
retorna estimativa sem PII/URL assinada; dado desconhecido = indisponível.

## 8. Web
Página `Rota inteligente` (`/rota`, `freight.view`) com origem/destino, distância manual,
consumo/diesel, e resultado sempre exibindo a **fonte** (Manual/Provedor/Indisponível).

## 9. Produção / deferidos (§109)
Default inerte (`ROUTE_PROVIDER_MODE=disabled`, 0 chamadas externas, sem env change). Deferidos
(não são defeitos de V1): provider real (Google/TomTom/OSRM prod), secret, tráfego ao vivo,
dados premium de restrição de caminhão, cache persistente, aprendizado histórico, overwrite
automático de KM do frete, mutação de plano Campaign aprovado, integração Campaign planned-trip.
