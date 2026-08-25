// Gera o 00-index.md do pacote a partir dos screenshots realmente produzidos.
// Rodar depois da suíte: node tests-qa-portal/gerar-indice.cjs

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', 'portal-v1-owner-visual');

// prefixo do arquivo → { titulo, fixture, inspecionar }
const CENAS = {
  '01-login': {
    titulo: 'Entrada do portal',
    fixture: 'Sem sessão.',
    inspecionar: 'A marca está clara? Fica evidente que é o portal do cliente, e não o painel da transportadora? Aparece alguma navegação interna que não deveria? A ação principal é única e óbvia?',
  },
  '02-login-erro': {
    titulo: 'Entrada — credencial recusada',
    fixture: 'Login responde 401.',
    inspecionar: 'A mensagem diz o que fazer, em português, sem jargão de segurança?',
  },
  '03-ativacao-conta-nova': {
    titulo: 'Ativação de convite — conta nova',
    fixture: 'Convite válido, e-mail sem conta.',
    inspecionar: 'Dá para saber QUEM convidou e para QUAL e-mail antes de digitar a senha? A criação de senha está clara (mínimo, confirmação)? O botão principal é inequívoco?',
  },
  '04-ativacao-conta-existente': {
    titulo: 'Ativação de convite — conta já existente',
    fixture: 'Convite válido, e-mail JÁ tem conta Matopiba.',
    inspecionar: 'A tela diz que a conta já existe? Pede a senha ATUAL (e não uma nova)? Afirma que a senha não será trocada? Some o campo "repita a senha"? Isso é o ponto mais sensível do fluxo — se confundir aqui, a pessoa acha que trocou de senha.',
  },
  '05-ativacao-expirada': {
    titulo: 'Ativação — convite expirado',
    fixture: 'Convite com utilizavel=false, motivo=expirado.',
    inspecionar: 'Explica o que houve e o caminho de saída, ou deixa a pessoa sem opção?',
  },
  '06-inicio-vazio': {
    titulo: 'Início — embarcador novo',
    fixture: 'Zero pedidos, zero operações.',
    inspecionar: 'A tela responde "o que eu posso fazer aqui?" A ação primária é pedir transporte? Existe alguma parede de indicadores zerados (que seria ruído)?',
  },
  '07-inicio-ativo': {
    titulo: 'Início — com atividade',
    fixture: '1 pedido com ajustes pedidos, 1 em transporte, 1 com comprovante.',
    inspecionar: 'O item que PRECISA de você aparece antes do histórico passivo? O bloco de atenção se destaca de verdade, ou parece só mais um cartão? (ver achado VIS-01)',
  },
  '08-lista-solicitacoes': {
    titulo: 'Lista de solicitações',
    fixture: '4 pedidos em situações diferentes.',
    inspecionar: 'É lista de cartões ou virou planilha? Cada item diz o que é, onde está e o que fazer?',
  },
  '09-lista-operacoes-vazia': {
    titulo: 'Lista de operações — vazia',
    fixture: 'Nenhuma operação em andamento.',
    inspecionar: 'O vazio explica quando algo vai aparecer aqui, em vez de só dizer "nenhum registro"?',
  },
  '10-pedido-uma-origem': {
    titulo: 'Pedir transporte — formulário inicial',
    fixture: 'Formulário limpo.',
    inspecionar: 'Parece DECLARAR uma necessidade ou PREENCHER um cadastro? Aparece algum ID interno, distância, diesel, veículo, motorista ou número de viagens? (não deveria)',
  },
  '11-pedido-tres-origens': {
    titulo: 'Pedir transporte — três locais de coleta',
    fixture: '3 origens preenchidas.',
    inspecionar: 'Continua compacto com 3 origens? "Adicionar outro local" parece progressivo ou vira uma planilha? O total é calculado sozinho?',
  },
  '12-pedido-conferencia': {
    titulo: 'Pedir transporte — conferência antes de enviar',
    fixture: 'Pedido completo, etapa de revisão.',
    inspecionar: 'Dá para entender O QUÊ, QUANTO, DE ONDE, PARA ONDE e QUANDO sem nenhum termo técnico?',
  },
  '13-pedido-enviado': {
    titulo: 'Pedido enviado',
    fixture: 'Recém-enviado, em análise.',
    inspecionar: 'Mostra a referência, a situação e o que acontece a seguir — sem exigir que a pessoa entenda o processo interno da transportadora?',
  },
  '20-ajustes-solicitados': {
    titulo: 'A transportadora pediu ajustes',
    fixture: 'Motivo longo e realista da transportadora.',
    inspecionar: 'O motivo está em destaque? O botão "Corrigir solicitação" está junto do motivo? O bloco realmente parece um aviso? (ver achado VIS-01)',
  },
  '21-editor-correcao': {
    titulo: 'Corrigir a solicitação',
    fixture: 'Editor aberto via ?acao=corrigir.',
    inspecionar: 'Vem pré-preenchido com o que foi enviado antes? O motivo do ajuste continua visível enquanto se corrige? Parece corrigir — ou parece recomeçar do zero?',
  },
  '22-historico-envios': {
    titulo: 'Histórico de envios (v1 → v2)',
    fixture: 'Envio 1 devolvido com motivo + envio 2 atual.',
    inspecionar: 'Uma pessoa comum entende O QUE MUDOU entre os dois envios, ou só vê dois totais? (ver achado VIS-09)',
  },
  '23-nao-atendido': {
    titulo: 'Pedido não atendido',
    fixture: 'Recusa com motivo.',
    inspecionar: 'O tom é adequado? O motivo aparece? Não há botão prometendo ação que não existe?',
  },
  '30-tracking-planejamento': {
    titulo: 'Acompanhamento — em planejamento',
    fixture: 'Aceita, planejamento em curso.',
    inspecionar: 'A situação é compreensível para quem não conhece o processo da transportadora?',
  },
  '31-tracking-agendado': {
    titulo: 'Acompanhamento — agendado',
    fixture: 'Transporte agendado.',
    inspecionar: 'A linha do tempo comunica progresso de forma legível?',
  },
  '32-tracking-em-transporte': {
    titulo: 'Acompanhamento — em transporte',
    fixture: 'Carga em trânsito.',
    inspecionar: 'Aparece algum dado que o embarcador NÃO deveria ver (motorista, placa, valor de frete)? Não deveria.',
  },
  '33-tracking-entrega-parcial': {
    titulo: 'Acompanhamento — ENTREGA PARCIAL',
    fixture: 'Parte da carga entregue, demanda residual em aberto.',
    inspecionar: 'ESTE É O MAIS IMPORTANTE DA SEÇÃO. Bate o olho e parece que a operação inteira terminou? Se parecer, é um problema sério — a carga ainda não foi toda entregue. (ver achado VIS-02)',
  },
  '34-tracking-entregue': {
    titulo: 'Acompanhamento — entrega concluída',
    fixture: 'Entregue, ainda sem comprovante liberado.',
    inspecionar: 'Fica claro que a entrega terminou mas o comprovante ainda não está disponível?',
  },
  '35-comprovante-disponivel': {
    titulo: 'Comprovante disponível',
    fixture: 'Comprovante liberado pela transportadora.',
    inspecionar: 'O comprovante é a ação primária e aparece acima dos demais documentos? É isso que a pessoa vem buscar depois da entrega. (ver achado VIS-08)',
  },
  '36-tracking-processando': {
    titulo: 'Acompanhamento — atualização em processamento',
    fixture: 'Estado desconhecido tratado com segurança.',
    inspecionar: 'Soa honesto sem parecer erro/quebra? Ou dá a impressão de que algo deu errado?',
  },
  '40-documentos-lista': {
    titulo: 'Documentos — todos os tipos juntos',
    fixture: 'Documento enviado pelo embarcador + documento da transportadora + comprovante.',
    inspecionar: 'Dá para diferenciar de quem é cada documento? O campo de envio é claro, sem jargão de armazenamento? O limite (PDF/XML/imagem, 15 MB) aparece antes do erro?',
  },
  '41-documento-erro': {
    titulo: 'Documentos — falha ao abrir',
    fixture: 'URL do arquivo responde 500.',
    inspecionar: 'O erro é compreensível e recuperável, ou é uma exceção crua?',
  },
  '42-erro-carregamento': {
    titulo: 'Falha ao carregar o início',
    fixture: 'Endpoint do início responde 500.',
    inspecionar: 'Aparece mensagem em português com "Tentar novamente"? Nunca deve ser tela branca.',
  },
  '43-duas-transportadoras': {
    titulo: 'Embarcador com duas transportadoras',
    fixture: 'Dois relacionamentos ativos.',
    inspecionar: 'O seletor aparece e é compreensível? No celular ele continua utilizável?',
  },
  '50-conteudo-longo': {
    titulo: 'Estresse de layout — textos longos',
    fixture: 'Nome de empresa, origem, destino, motivo e documentos com nomes muito longos.',
    inspecionar: 'Algum texto vaza para fora? Algum botão fica cortado? O layout quebra? (ver medidas.json)',
  },
  '60-inbox-vazia': {
    titulo: 'Caixa de entrada — vazia',
    fixture: 'Nenhuma solicitação recebida.',
    inspecionar: 'O vazio explica quando algo aparece aqui?',
  },
  '61-inbox-grupos': {
    titulo: 'Caixa de entrada — os seis grupos',
    fixture: 'Ajustes reenviados, novas, aceitas sem operação, aguardando embarcador, convertidas, encerradas.',
    inspecionar: 'A ordem ajuda a decidir o que fazer primeiro, ou vira uma parede? O que exige decisão está no topo? Os grupos passivos atrapalham?',
  },
  '62-inbox-detalhe': {
    titulo: 'Caixa de entrada — detalhe da solicitação',
    fixture: '3 origens, observações, 2 versões, documento do embarcador, CT-e/MDF-e elegíveis, comprovante aprovado.',
    inspecionar: 'Dá para ver o que o embarcador anexou? A comparação entre envios ajuda a decidir? As ações de disponibilizar/revogar estão claras e diferenciadas?',
  },
  '63-inbox-pedir-ajustes': {
    titulo: 'Caixa de entrada — pedir ajustes',
    fixture: 'Campo de motivo aberto.',
    inspecionar: 'Fica evidente que o texto vai para o embarcador ler? O exemplo orienta a escrever algo útil?',
  },
  '64-inbox-nao-atender': {
    titulo: 'Caixa de entrada — não atender',
    fixture: 'Campo de motivo aberto.',
    inspecionar: 'Mesma clareza do pedido de ajustes? O peso da ação está adequado?',
  },
  '65-inbox-sem-permissao-share': {
    titulo: 'Sem permissão para disponibilizar documentos',
    fixture: 'Usuário revisa, mas não tem shipper_portal.documents.share (403 nos compartilháveis).',
    inspecionar: 'A tela EXPLICA por que as ações de documento não estão disponíveis e o que fazer? Não pode ser um ícone desabilitado sem motivo.',
  },
  '66-inbox-sem-permissao-review': {
    titulo: 'Sem acesso à área',
    fixture: 'Usuário sem shipper_portal.requests.review.',
    inspecionar: 'Explica o que fazer para conseguir acesso?',
  },
  '67-inbox-conteudo-longo': {
    titulo: 'Caixa de entrada — textos longos',
    fixture: 'Carga, destino, origem e observação muito longos.',
    inspecionar: 'Sem vazamento de texto, botão cortado ou rolagem lateral no celular?',
  },
};

function listar(sub) {
  const dir = path.join(RAIZ, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
}

function prefixoDe(arquivo) {
  return arquivo.replace(/-(desktop|tablet|mobile)\.png$/, '');
}

function agrupar() {
  const mapa = new Map();
  for (const sub of ['external', 'carrier', 'mobile']) {
    for (const arq of listar(sub)) {
      const p = prefixoDe(arq);
      if (!mapa.has(p)) mapa.set(p, []);
      mapa.get(p).push(`${sub}/${arq}`);
    }
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

const grupos = agrupar();
const total = grupos.reduce((s, [, arqs]) => s + arqs.length, 0);

const externos = grupos.filter(([p]) => Number(p.slice(0, 2)) < 60);
const carrier = grupos.filter(([p]) => Number(p.slice(0, 2)) >= 60);

function secao(titulo, lista) {
  const linhas = [`## ${titulo}`, ''];
  for (const [prefixo, arquivos] of lista) {
    const meta = CENAS[prefixo] || { titulo: prefixo, fixture: '—', inspecionar: '—' };
    linhas.push(`### ${prefixo} · ${meta.titulo}`);
    linhas.push('');
    linhas.push(`**Estado da fixture:** ${meta.fixture}`);
    linhas.push('');
    linhas.push(`**O que inspecionar:** ${meta.inspecionar}`);
    linhas.push('');
    for (const a of arquivos) {
      const vp = a.includes('-desktop') ? '1440×900' : a.includes('-tablet') ? '768×1024' : '390×844';
      linhas.push(`- [\`${a}\`](./${a}) — ${vp}`);
    }
    linhas.push('');
  }
  return linhas.join('\n');
}

const cabecalho = `# Portal do Embarcador V1 — pacote de aceitação visual

> Gerado a partir do código de produção em \`main\`. **Nenhum dado de produção foi
> criado, lido ou tocado**: as telas são os componentes reais, e apenas as
> respostas de API foram substituídas por fixtures fictícias.

| | |
|---|---|
| Base | \`main\` @ \`fd5965d8\` (PR #477 mergeado em \`75a39d0a\`) |
| Código de produto alterado | **não** |
| Telas (cenas) | ${grupos.length} |
| Capturas | ${total} |
| Viewports | 1440×900 · 768×1024 · 390×844 |
| Escritas em produção | 0 |

**Como usar:** cada cena abaixo tem o estado da fixture e uma pergunta concreta a
responder olhando a imagem. Os achados que já levantei estão em
[\`findings.md\`](./findings.md) — leia depois de formar sua própria impressão,
para não enviesar. As medidas objetivas (rolagem lateral, cor de fundo aplicada)
estão em \`medidas.json\`.

**O que este pacote NÃO responde:** se o produto resolve o problema comercial, se
os textos convencem um embarcador real, e se o fluxo funciona ponta a ponta com
dados reais. Isso só o uso real responde.

**Duas ressalvas de leitura, para você não avaliar um artefato meu como se fosse
o produto:**

1. Nas cenas de erro (\`41\`, \`42\`), a frase exibida vem da minha fixture, não do
   backend real. Avalie o *formato* do erro (mensagem + botão "Tentar novamente",
   nunca tela branca), não o texto em si.
2. O botão "Choose File / No file chosen" no envio de documento é o controle
   nativo do navegador, cujo texto segue o idioma do **navegador**, não o do app.
   Num navegador em português ele aparece como "Escolher arquivo". Ainda assim
   isso é um achado — ver \`VIS-07\`.

`;

const corpo = [
  cabecalho,
  secao('Portal externo — o que o embarcador vê', externos),
  secao('Lado da transportadora — caixa de entrada', carrier),
].join('\n');

fs.writeFileSync(path.join(RAIZ, '00-index.md'), corpo, 'utf8');
console.log(`00-index.md gerado: ${grupos.length} cenas, ${total} capturas`);

const faltando = Object.keys(CENAS).filter((k) => !grupos.some(([p]) => p === k));
if (faltando.length) console.log('CENAS SEM CAPTURA: ' + faltando.join(', '));
