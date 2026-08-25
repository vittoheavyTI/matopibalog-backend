# Harness de aceitação visual — Portal do Embarcador V1

Gera o pacote `portal-v1-owner-visual/` para o owner inspecionar antes de dar
`OWNER_VISUAL_VALIDATION`. **Não faz parte do runtime**: nada aqui é importado
pelo app, e o código de produto não foi alterado para acomodá-lo.

## Como rodar

```bash
cd painel_web
npx playwright test -c tests-qa-portal/playwright.config.ts
node tests-qa-portal/gerar-indice.cjs
```

O `webServer` do Playwright sobe o Vite na porta 5188 com
`VITE_API_URL=http://localhost:5188/__api`.

## Contenção — por que isto não toca produção

Três camadas, e a última é a que vale:

1. **A "API" é o próprio servidor local**, sob o prefixo `/__api`. Não é um host
   externo. Escolha deliberada: o `index.html` de produção traz uma CSP com
   `connect-src` restrito, então um host inventado seria bloqueado pelo navegador
   antes de chegar ao interceptador — e afrouxar a CSP para o teste passar seria
   testar outra coisa. Usar `'self'` respeita a política real.
2. **Todo request passa pelo catch-all** de `harness.ts`. Destino que não seja o
   servidor local é abortado e registrado como escape. Escrita sem fixture idem.
3. **A contabilidade é verificada**: cada cena termina com
   `expect(sessao.escapes).toEqual([])`, e o teste `Contenção de rede` tenta
   deliberadamente alcançar `matopibalog-backend-production.up.railway.app` e
   `api.matopibalog.com.br`, exigindo que as duas tentativas falhem **e**
   apareçam na lista de escapes. Se o catch-all algum dia deixar passar, esse
   teste quebra.

## Arquivos

| Arquivo | Papel |
|---|---|
| `harness.ts` | Interceptação, contenção, sessão fictícia, viewports |
| `fixtures.ts` | Dados de cena — todos fictícios (`*.invalid`, nomes inventados) |
| `portal.visual.spec.ts` | Cenas do portal externo |
| `carrier.visual.spec.ts` | Cenas da caixa de entrada da transportadora |
| `checks.visual.spec.ts` | Medidas objetivas + prova de contenção |
| `gerar-indice.cjs` | Monta o `00-index.md` a partir dos PNGs produzidos |

## Cuidados ao editar fixtures

- **Ordem do histórico é decrescente.** Os dois serviços usam
  `.order('version', { ascending: false })`. Uma fixture em ordem crescente faz o
  comparativo da tela interna aparecer invertido — o que parece um bug do produto
  e não é. Já caí nisso uma vez.
- **Sem dado real.** Nenhum e-mail, token, pessoa, empresa ou documento
  verdadeiro. E-mails usam o TLD reservado `.invalid`.
