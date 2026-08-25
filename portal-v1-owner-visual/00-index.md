# Portal do Embarcador V1 — pacote de aceitação visual

> Gerado a partir do código de produção em `main`. **Nenhum dado de produção foi
> criado, lido ou tocado**: as telas são os componentes reais, e apenas as
> respostas de API foram substituídas por fixtures fictícias.

| | |
|---|---|
| Base | `main` @ `fd5965d8` (PR #477 mergeado em `75a39d0a`) |
| Código de produto alterado | **não** |
| Telas (cenas) | 37 |
| Capturas | 85 |
| Viewports | 1440×900 · 768×1024 · 390×844 |
| Escritas em produção | 0 |

**Como usar:** cada cena abaixo tem o estado da fixture e uma pergunta concreta a
responder olhando a imagem. Os achados que já levantei estão em
[`findings.md`](./findings.md) — leia depois de formar sua própria impressão,
para não enviesar. As medidas objetivas (rolagem lateral, cor de fundo aplicada)
estão em `medidas.json`.

**O que este pacote NÃO responde:** se o produto resolve o problema comercial, se
os textos convencem um embarcador real, e se o fluxo funciona ponta a ponta com
dados reais. Isso só o uso real responde.

**Duas ressalvas de leitura, para você não avaliar um artefato meu como se fosse
o produto:**

1. Nas cenas de erro (`41`, `42`), a frase exibida vem da minha fixture, não do
   backend real. Avalie o *formato* do erro (mensagem + botão "Tentar novamente",
   nunca tela branca), não o texto em si.
2. O botão "Choose File / No file chosen" no envio de documento é o controle
   nativo do navegador, cujo texto segue o idioma do **navegador**, não o do app.
   Num navegador em português ele aparece como "Escolher arquivo". Ainda assim
   isso é um achado — ver `VIS-07`.


## Portal externo — o que o embarcador vê

### 01-login · Entrada do portal

**Estado da fixture:** Sem sessão.

**O que inspecionar:** A marca está clara? Fica evidente que é o portal do cliente, e não o painel da transportadora? Aparece alguma navegação interna que não deveria? A ação principal é única e óbvia?

- [`external/01-login-desktop.png`](./external/01-login-desktop.png) — 1440×900
- [`external/01-login-tablet.png`](./external/01-login-tablet.png) — 768×1024
- [`mobile/01-login-mobile.png`](./mobile/01-login-mobile.png) — 390×844

### 02-login-erro · Entrada — credencial recusada

**Estado da fixture:** Login responde 401.

**O que inspecionar:** A mensagem diz o que fazer, em português, sem jargão de segurança?

- [`external/02-login-erro-desktop.png`](./external/02-login-erro-desktop.png) — 1440×900
- [`mobile/02-login-erro-mobile.png`](./mobile/02-login-erro-mobile.png) — 390×844

### 03-ativacao-conta-nova · Ativação de convite — conta nova

**Estado da fixture:** Convite válido, e-mail sem conta.

**O que inspecionar:** Dá para saber QUEM convidou e para QUAL e-mail antes de digitar a senha? A criação de senha está clara (mínimo, confirmação)? O botão principal é inequívoco?

- [`external/03-ativacao-conta-nova-desktop.png`](./external/03-ativacao-conta-nova-desktop.png) — 1440×900
- [`mobile/03-ativacao-conta-nova-mobile.png`](./mobile/03-ativacao-conta-nova-mobile.png) — 390×844

### 04-ativacao-conta-existente · Ativação de convite — conta já existente

**Estado da fixture:** Convite válido, e-mail JÁ tem conta Matopiba.

**O que inspecionar:** A tela diz que a conta já existe? Pede a senha ATUAL (e não uma nova)? Afirma que a senha não será trocada? Some o campo "repita a senha"? Isso é o ponto mais sensível do fluxo — se confundir aqui, a pessoa acha que trocou de senha.

- [`external/04-ativacao-conta-existente-desktop.png`](./external/04-ativacao-conta-existente-desktop.png) — 1440×900
- [`mobile/04-ativacao-conta-existente-mobile.png`](./mobile/04-ativacao-conta-existente-mobile.png) — 390×844

### 05-ativacao-expirada · Ativação — convite expirado

**Estado da fixture:** Convite com utilizavel=false, motivo=expirado.

**O que inspecionar:** Explica o que houve e o caminho de saída, ou deixa a pessoa sem opção?

- [`external/05-ativacao-expirada-desktop.png`](./external/05-ativacao-expirada-desktop.png) — 1440×900
- [`mobile/05-ativacao-expirada-mobile.png`](./mobile/05-ativacao-expirada-mobile.png) — 390×844

### 06-inicio-vazio · Início — embarcador novo

**Estado da fixture:** Zero pedidos, zero operações.

**O que inspecionar:** A tela responde "o que eu posso fazer aqui?" A ação primária é pedir transporte? Existe alguma parede de indicadores zerados (que seria ruído)?

- [`external/06-inicio-vazio-desktop.png`](./external/06-inicio-vazio-desktop.png) — 1440×900
- [`external/06-inicio-vazio-tablet.png`](./external/06-inicio-vazio-tablet.png) — 768×1024
- [`mobile/06-inicio-vazio-mobile.png`](./mobile/06-inicio-vazio-mobile.png) — 390×844

### 07-inicio-ativo · Início — com atividade

**Estado da fixture:** 1 pedido com ajustes pedidos, 1 em transporte, 1 com comprovante.

**O que inspecionar:** O item que PRECISA de você aparece antes do histórico passivo? O bloco de atenção se destaca de verdade, ou parece só mais um cartão? (ver achado VIS-01)

- [`external/07-inicio-ativo-desktop.png`](./external/07-inicio-ativo-desktop.png) — 1440×900
- [`external/07-inicio-ativo-tablet.png`](./external/07-inicio-ativo-tablet.png) — 768×1024
- [`mobile/07-inicio-ativo-mobile.png`](./mobile/07-inicio-ativo-mobile.png) — 390×844

### 08-lista-solicitacoes · Lista de solicitações

**Estado da fixture:** 4 pedidos em situações diferentes.

**O que inspecionar:** É lista de cartões ou virou planilha? Cada item diz o que é, onde está e o que fazer?

- [`external/08-lista-solicitacoes-desktop.png`](./external/08-lista-solicitacoes-desktop.png) — 1440×900
- [`mobile/08-lista-solicitacoes-mobile.png`](./mobile/08-lista-solicitacoes-mobile.png) — 390×844

### 09-lista-operacoes-vazia · Lista de operações — vazia

**Estado da fixture:** Nenhuma operação em andamento.

**O que inspecionar:** O vazio explica quando algo vai aparecer aqui, em vez de só dizer "nenhum registro"?

- [`external/09-lista-operacoes-vazia-desktop.png`](./external/09-lista-operacoes-vazia-desktop.png) — 1440×900
- [`mobile/09-lista-operacoes-vazia-mobile.png`](./mobile/09-lista-operacoes-vazia-mobile.png) — 390×844

### 10-pedido-uma-origem · Pedir transporte — formulário inicial

**Estado da fixture:** Formulário limpo.

**O que inspecionar:** Parece DECLARAR uma necessidade ou PREENCHER um cadastro? Aparece algum ID interno, distância, diesel, veículo, motorista ou número de viagens? (não deveria)

- [`external/10-pedido-uma-origem-desktop.png`](./external/10-pedido-uma-origem-desktop.png) — 1440×900
- [`external/10-pedido-uma-origem-tablet.png`](./external/10-pedido-uma-origem-tablet.png) — 768×1024
- [`mobile/10-pedido-uma-origem-mobile.png`](./mobile/10-pedido-uma-origem-mobile.png) — 390×844

### 11-pedido-tres-origens · Pedir transporte — três locais de coleta

**Estado da fixture:** 3 origens preenchidas.

**O que inspecionar:** Continua compacto com 3 origens? "Adicionar outro local" parece progressivo ou vira uma planilha? O total é calculado sozinho?

- [`external/11-pedido-tres-origens-desktop.png`](./external/11-pedido-tres-origens-desktop.png) — 1440×900
- [`mobile/11-pedido-tres-origens-mobile.png`](./mobile/11-pedido-tres-origens-mobile.png) — 390×844

### 12-pedido-conferencia · Pedir transporte — conferência antes de enviar

**Estado da fixture:** Pedido completo, etapa de revisão.

**O que inspecionar:** Dá para entender O QUÊ, QUANTO, DE ONDE, PARA ONDE e QUANDO sem nenhum termo técnico?

- [`external/12-pedido-conferencia-desktop.png`](./external/12-pedido-conferencia-desktop.png) — 1440×900
- [`mobile/12-pedido-conferencia-mobile.png`](./mobile/12-pedido-conferencia-mobile.png) — 390×844

### 13-pedido-enviado · Pedido enviado

**Estado da fixture:** Recém-enviado, em análise.

**O que inspecionar:** Mostra a referência, a situação e o que acontece a seguir — sem exigir que a pessoa entenda o processo interno da transportadora?

- [`external/13-pedido-enviado-desktop.png`](./external/13-pedido-enviado-desktop.png) — 1440×900
- [`mobile/13-pedido-enviado-mobile.png`](./mobile/13-pedido-enviado-mobile.png) — 390×844

### 20-ajustes-solicitados · A transportadora pediu ajustes

**Estado da fixture:** Motivo longo e realista da transportadora.

**O que inspecionar:** O motivo está em destaque? O botão "Corrigir solicitação" está junto do motivo? O bloco realmente parece um aviso? (ver achado VIS-01)

- [`external/20-ajustes-solicitados-desktop.png`](./external/20-ajustes-solicitados-desktop.png) — 1440×900
- [`external/20-ajustes-solicitados-tablet.png`](./external/20-ajustes-solicitados-tablet.png) — 768×1024
- [`mobile/20-ajustes-solicitados-mobile.png`](./mobile/20-ajustes-solicitados-mobile.png) — 390×844

### 21-editor-correcao · Corrigir a solicitação

**Estado da fixture:** Editor aberto via ?acao=corrigir.

**O que inspecionar:** Vem pré-preenchido com o que foi enviado antes? O motivo do ajuste continua visível enquanto se corrige? Parece corrigir — ou parece recomeçar do zero?

- [`external/21-editor-correcao-desktop.png`](./external/21-editor-correcao-desktop.png) — 1440×900
- [`mobile/21-editor-correcao-mobile.png`](./mobile/21-editor-correcao-mobile.png) — 390×844

### 22-historico-envios · Histórico de envios (v1 → v2)

**Estado da fixture:** Envio 1 devolvido com motivo + envio 2 atual.

**O que inspecionar:** Uma pessoa comum entende O QUE MUDOU entre os dois envios, ou só vê dois totais? (ver achado VIS-09)

- [`external/22-historico-envios-desktop.png`](./external/22-historico-envios-desktop.png) — 1440×900
- [`mobile/22-historico-envios-mobile.png`](./mobile/22-historico-envios-mobile.png) — 390×844

### 23-nao-atendido · Pedido não atendido

**Estado da fixture:** Recusa com motivo.

**O que inspecionar:** O tom é adequado? O motivo aparece? Não há botão prometendo ação que não existe?

- [`external/23-nao-atendido-desktop.png`](./external/23-nao-atendido-desktop.png) — 1440×900
- [`mobile/23-nao-atendido-mobile.png`](./mobile/23-nao-atendido-mobile.png) — 390×844

### 30-tracking-planejamento · Acompanhamento — em planejamento

**Estado da fixture:** Aceita, planejamento em curso.

**O que inspecionar:** A situação é compreensível para quem não conhece o processo da transportadora?

- [`external/30-tracking-planejamento-desktop.png`](./external/30-tracking-planejamento-desktop.png) — 1440×900
- [`mobile/30-tracking-planejamento-mobile.png`](./mobile/30-tracking-planejamento-mobile.png) — 390×844

### 31-tracking-agendado · Acompanhamento — agendado

**Estado da fixture:** Transporte agendado.

**O que inspecionar:** A linha do tempo comunica progresso de forma legível?

- [`external/31-tracking-agendado-desktop.png`](./external/31-tracking-agendado-desktop.png) — 1440×900
- [`mobile/31-tracking-agendado-mobile.png`](./mobile/31-tracking-agendado-mobile.png) — 390×844

### 32-tracking-em-transporte · Acompanhamento — em transporte

**Estado da fixture:** Carga em trânsito.

**O que inspecionar:** Aparece algum dado que o embarcador NÃO deveria ver (motorista, placa, valor de frete)? Não deveria.

- [`external/32-tracking-em-transporte-desktop.png`](./external/32-tracking-em-transporte-desktop.png) — 1440×900
- [`mobile/32-tracking-em-transporte-mobile.png`](./mobile/32-tracking-em-transporte-mobile.png) — 390×844

### 33-tracking-entrega-parcial · Acompanhamento — ENTREGA PARCIAL

**Estado da fixture:** Parte da carga entregue, demanda residual em aberto.

**O que inspecionar:** ESTE É O MAIS IMPORTANTE DA SEÇÃO. Bate o olho e parece que a operação inteira terminou? Se parecer, é um problema sério — a carga ainda não foi toda entregue. (ver achado VIS-02)

- [`external/33-tracking-entrega-parcial-desktop.png`](./external/33-tracking-entrega-parcial-desktop.png) — 1440×900
- [`mobile/33-tracking-entrega-parcial-mobile.png`](./mobile/33-tracking-entrega-parcial-mobile.png) — 390×844

### 34-tracking-entregue · Acompanhamento — entrega concluída

**Estado da fixture:** Entregue, ainda sem comprovante liberado.

**O que inspecionar:** Fica claro que a entrega terminou mas o comprovante ainda não está disponível?

- [`external/34-tracking-entregue-desktop.png`](./external/34-tracking-entregue-desktop.png) — 1440×900
- [`mobile/34-tracking-entregue-mobile.png`](./mobile/34-tracking-entregue-mobile.png) — 390×844

### 35-comprovante-disponivel · Comprovante disponível

**Estado da fixture:** Comprovante liberado pela transportadora.

**O que inspecionar:** O comprovante é a ação primária e aparece acima dos demais documentos? É isso que a pessoa vem buscar depois da entrega. (ver achado VIS-08)

- [`external/35-comprovante-disponivel-desktop.png`](./external/35-comprovante-disponivel-desktop.png) — 1440×900
- [`external/35-comprovante-disponivel-tablet.png`](./external/35-comprovante-disponivel-tablet.png) — 768×1024
- [`mobile/35-comprovante-disponivel-mobile.png`](./mobile/35-comprovante-disponivel-mobile.png) — 390×844

### 36-tracking-processando · Acompanhamento — atualização em processamento

**Estado da fixture:** Estado desconhecido tratado com segurança.

**O que inspecionar:** Soa honesto sem parecer erro/quebra? Ou dá a impressão de que algo deu errado?

- [`external/36-tracking-processando-desktop.png`](./external/36-tracking-processando-desktop.png) — 1440×900
- [`mobile/36-tracking-processando-mobile.png`](./mobile/36-tracking-processando-mobile.png) — 390×844

### 40-documentos-lista · Documentos — todos os tipos juntos

**Estado da fixture:** Documento enviado pelo embarcador + documento da transportadora + comprovante.

**O que inspecionar:** Dá para diferenciar de quem é cada documento? O campo de envio é claro, sem jargão de armazenamento? O limite (PDF/XML/imagem, 15 MB) aparece antes do erro?

- [`external/40-documentos-lista-desktop.png`](./external/40-documentos-lista-desktop.png) — 1440×900
- [`external/40-documentos-lista-tablet.png`](./external/40-documentos-lista-tablet.png) — 768×1024
- [`mobile/40-documentos-lista-mobile.png`](./mobile/40-documentos-lista-mobile.png) — 390×844

### 41-documento-erro · Documentos — falha ao abrir

**Estado da fixture:** URL do arquivo responde 500.

**O que inspecionar:** O erro é compreensível e recuperável, ou é uma exceção crua?

- [`external/41-documento-erro-desktop.png`](./external/41-documento-erro-desktop.png) — 1440×900
- [`mobile/41-documento-erro-mobile.png`](./mobile/41-documento-erro-mobile.png) — 390×844

### 42-erro-carregamento · Falha ao carregar o início

**Estado da fixture:** Endpoint do início responde 500.

**O que inspecionar:** Aparece mensagem em português com "Tentar novamente"? Nunca deve ser tela branca.

- [`external/42-erro-carregamento-desktop.png`](./external/42-erro-carregamento-desktop.png) — 1440×900
- [`mobile/42-erro-carregamento-mobile.png`](./mobile/42-erro-carregamento-mobile.png) — 390×844

### 43-duas-transportadoras · Embarcador com duas transportadoras

**Estado da fixture:** Dois relacionamentos ativos.

**O que inspecionar:** O seletor aparece e é compreensível? No celular ele continua utilizável?

- [`external/43-duas-transportadoras-desktop.png`](./external/43-duas-transportadoras-desktop.png) — 1440×900
- [`mobile/43-duas-transportadoras-mobile.png`](./mobile/43-duas-transportadoras-mobile.png) — 390×844

### 50-conteudo-longo · Estresse de layout — textos longos

**Estado da fixture:** Nome de empresa, origem, destino, motivo e documentos com nomes muito longos.

**O que inspecionar:** Algum texto vaza para fora? Algum botão fica cortado? O layout quebra? (ver medidas.json)

- [`external/50-conteudo-longo-desktop.png`](./external/50-conteudo-longo-desktop.png) — 1440×900
- [`external/50-conteudo-longo-tablet.png`](./external/50-conteudo-longo-tablet.png) — 768×1024
- [`mobile/50-conteudo-longo-mobile.png`](./mobile/50-conteudo-longo-mobile.png) — 390×844

## Lado da transportadora — caixa de entrada

### 60-inbox-vazia · Caixa de entrada — vazia

**Estado da fixture:** Nenhuma solicitação recebida.

**O que inspecionar:** O vazio explica quando algo aparece aqui?

- [`carrier/60-inbox-vazia-desktop.png`](./carrier/60-inbox-vazia-desktop.png) — 1440×900
- [`mobile/60-inbox-vazia-mobile.png`](./mobile/60-inbox-vazia-mobile.png) — 390×844

### 61-inbox-grupos · Caixa de entrada — os seis grupos

**Estado da fixture:** Ajustes reenviados, novas, aceitas sem operação, aguardando embarcador, convertidas, encerradas.

**O que inspecionar:** A ordem ajuda a decidir o que fazer primeiro, ou vira uma parede? O que exige decisão está no topo? Os grupos passivos atrapalham?

- [`carrier/61-inbox-grupos-desktop.png`](./carrier/61-inbox-grupos-desktop.png) — 1440×900
- [`carrier/61-inbox-grupos-tablet.png`](./carrier/61-inbox-grupos-tablet.png) — 768×1024
- [`mobile/61-inbox-grupos-mobile.png`](./mobile/61-inbox-grupos-mobile.png) — 390×844

### 62-inbox-detalhe · Caixa de entrada — detalhe da solicitação

**Estado da fixture:** 3 origens, observações, 2 versões, documento do embarcador, CT-e/MDF-e elegíveis, comprovante aprovado.

**O que inspecionar:** Dá para ver o que o embarcador anexou? A comparação entre envios ajuda a decidir? As ações de disponibilizar/revogar estão claras e diferenciadas?

- [`carrier/62-inbox-detalhe-desktop.png`](./carrier/62-inbox-detalhe-desktop.png) — 1440×900
- [`carrier/62-inbox-detalhe-tablet.png`](./carrier/62-inbox-detalhe-tablet.png) — 768×1024
- [`mobile/62-inbox-detalhe-mobile.png`](./mobile/62-inbox-detalhe-mobile.png) — 390×844

### 63-inbox-pedir-ajustes · Caixa de entrada — pedir ajustes

**Estado da fixture:** Campo de motivo aberto.

**O que inspecionar:** Fica evidente que o texto vai para o embarcador ler? O exemplo orienta a escrever algo útil?

- [`carrier/63-inbox-pedir-ajustes-desktop.png`](./carrier/63-inbox-pedir-ajustes-desktop.png) — 1440×900
- [`mobile/63-inbox-pedir-ajustes-mobile.png`](./mobile/63-inbox-pedir-ajustes-mobile.png) — 390×844

### 64-inbox-nao-atender · Caixa de entrada — não atender

**Estado da fixture:** Campo de motivo aberto.

**O que inspecionar:** Mesma clareza do pedido de ajustes? O peso da ação está adequado?

- [`carrier/64-inbox-nao-atender-desktop.png`](./carrier/64-inbox-nao-atender-desktop.png) — 1440×900
- [`mobile/64-inbox-nao-atender-mobile.png`](./mobile/64-inbox-nao-atender-mobile.png) — 390×844

### 65-inbox-sem-permissao-share · Sem permissão para disponibilizar documentos

**Estado da fixture:** Usuário revisa, mas não tem shipper_portal.documents.share (403 nos compartilháveis).

**O que inspecionar:** A tela EXPLICA por que as ações de documento não estão disponíveis e o que fazer? Não pode ser um ícone desabilitado sem motivo.

- [`carrier/65-inbox-sem-permissao-share-desktop.png`](./carrier/65-inbox-sem-permissao-share-desktop.png) — 1440×900
- [`carrier/65-inbox-sem-permissao-share-tablet.png`](./carrier/65-inbox-sem-permissao-share-tablet.png) — 768×1024
- [`mobile/65-inbox-sem-permissao-share-mobile.png`](./mobile/65-inbox-sem-permissao-share-mobile.png) — 390×844

### 66-inbox-sem-permissao-review · Sem acesso à área

**Estado da fixture:** Usuário sem shipper_portal.requests.review.

**O que inspecionar:** Explica o que fazer para conseguir acesso?

- [`carrier/66-inbox-sem-permissao-review-desktop.png`](./carrier/66-inbox-sem-permissao-review-desktop.png) — 1440×900
- [`mobile/66-inbox-sem-permissao-review-mobile.png`](./mobile/66-inbox-sem-permissao-review-mobile.png) — 390×844

### 67-inbox-conteudo-longo · Caixa de entrada — textos longos

**Estado da fixture:** Carga, destino, origem e observação muito longos.

**O que inspecionar:** Sem vazamento de texto, botão cortado ou rolagem lateral no celular?

- [`carrier/67-inbox-conteudo-longo-desktop.png`](./carrier/67-inbox-conteudo-longo-desktop.png) — 1440×900
- [`mobile/67-inbox-conteudo-longo-mobile.png`](./mobile/67-inbox-conteudo-longo-mobile.png) — 390×844
