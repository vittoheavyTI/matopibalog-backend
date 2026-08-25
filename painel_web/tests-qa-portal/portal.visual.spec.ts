import { test, expect, type Page } from '@playwright/test';
import * as F from './fixtures';
import {
  instalarFixtures, estabelecerSessao, assentar, caminhoDeSaida, registrar, gravarRegistro,
  DESKTOP, MOBILE, TABLET, type Cenario,
} from './harness';

// Pacote de aceitação visual — PORTAL EXTERNO (embarcador).
// Renderiza o código de produção; só as respostas de API são fixtures.

const TOKEN = 'token-fixture-portal-nao-e-real';

type Cena = {
  arquivo: string;      // prefixo, sem sufixo de viewport
  descricao: string;
  url: string;
  rotas: Cenario['rotas'];
  comSessao?: boolean;
  antesDaCaptura?: (page: Page) => Promise<void>;
  tambemTablet?: boolean;
};

const ROTAS_BASE = {
  'GET /portal/embarcador/contexto': F.CONTEXTO,
};

async function capturar(page: Page, cena: Cena) {
  const cenario: Cenario = {
    rotas: cena.rotas,
    tokenPortal: cena.comSessao === false ? undefined : TOKEN,
  };
  const sessao = await instalarFixtures(page, cenario);
  await estabelecerSessao(page, cenario);

  const viewports: [string, { width: number; height: number }][] = [
    ['desktop', DESKTOP],
    ['mobile', MOBILE],
  ];
  if (cena.tambemTablet) viewports.splice(1, 0, ['tablet', TABLET]);

  for (const [nome, vp] of viewports) {
    await page.setViewportSize(vp);
    await page.goto(cena.url);
    await assentar(page);
    if (cena.antesDaCaptura) {
      await cena.antesDaCaptura(page);
      await assentar(page, 300);
    }
    const arquivo = `${cena.arquivo}-${nome}.png`;
    const pasta = nome === 'mobile' ? 'mobile' : 'external';
    await page.screenshot({ path: caminhoDeSaida(pasta, arquivo), fullPage: true });
    registrar(`${pasta}/${arquivo}`, cena.descricao, `${vp.width}x${vp.height}`);
  }

  // §46 — nenhuma chamada escapou do harness.
  expect(sessao.escapes, `escapes: ${JSON.stringify(sessao.escapes)}`).toEqual([]);
}

test.describe('Portal do Embarcador — externo', () => {
  test('01 login', async ({ page }) => {
    await capturar(page, {
      arquivo: '01-login',
      descricao: 'Entrada do portal, sem sessão. Verificar: identidade Matopiba, que é portal do embarcador, ausência de navegação interna, ação primária única.',
      url: '/portal/embarcador/entrar',
      comSessao: false,
      rotas: {},
      tambemTablet: true,
    });
  });

  test('02 login com erro de credencial', async ({ page }) => {
    await capturar(page, {
      arquivo: '02-login-erro',
      descricao: 'Login com credencial recusada. Verificar: mensagem acionável em português, sem jargão de segurança.',
      url: '/portal/embarcador/entrar',
      comSessao: false,
      rotas: { 'POST /portal/embarcador/login': 401 },
      antesDaCaptura: async (page) => {
        await page.fill('#portal-email', 'contato@exemplo.invalid');
        await page.fill('#portal-senha', 'senha-fixture-invalida');
        await page.click('button[type="submit"]');
        await page.waitForSelector('[role="alert"]');
      },
    });
  });

  test('03 ativação — conta nova', async ({ page }) => {
    await capturar(page, {
      arquivo: '03-ativacao-conta-nova',
      descricao: 'Ativação de convite para e-mail sem conta. Verificar: quem convidou, para qual e-mail, criação de senha com confirmação, CTA claro.',
      url: '/portal/embarcador/convite?token=token-fixture',
      comSessao: false,
      rotas: { 'GET /portal/embarcador/convite': F.CONVITE_NOVO },
    });
  });

  test('04 ativação — conta existente', async ({ page }) => {
    await capturar(page, {
      arquivo: '04-ativacao-conta-existente',
      descricao: 'Ativação quando o e-mail já tem conta Matopiba. Verificar: diz que a conta já existe, pede a senha ATUAL, afirma que a senha não será trocada, e não pede confirmação de senha.',
      url: '/portal/embarcador/convite?token=token-fixture',
      comSessao: false,
      rotas: { 'GET /portal/embarcador/convite': F.CONVITE_CONTA_EXISTENTE },
    });
  });

  test('05 ativação — convite expirado', async ({ page }) => {
    await capturar(page, {
      arquivo: '05-ativacao-expirada',
      descricao: 'Convite expirado. Verificar: explica o que houve e o que fazer, sem beco sem saída.',
      url: '/portal/embarcador/convite?token=token-fixture',
      comSessao: false,
      rotas: { 'GET /portal/embarcador/convite': F.CONVITE_EXPIRADO },
    });
  });

  test('06 início — vazio', async ({ page }) => {
    await capturar(page, {
      arquivo: '06-inicio-vazio',
      descricao: 'Embarcador novo, sem nada. Verificar: a tela responde "o que eu faço aqui?"; ação primária é pedir transporte; sem parede de KPIs vazios.',
      url: '/portal/embarcador',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/inicio': F.INICIO_VAZIO },
      tambemTablet: true,
    });
  });

  test('07 início — ativo', async ({ page }) => {
    await capturar(page, {
      arquivo: '07-inicio-ativo',
      descricao: '1 pedido precisando de ajuste, 1 em transporte, 1 com comprovante. Verificar hierarquia: o que precisa de atenção vem antes do histórico passivo.',
      url: '/portal/embarcador',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/inicio': F.INICIO_ATIVO },
      tambemTablet: true,
    });
  });

  test('08 lista de solicitações', async ({ page }) => {
    await capturar(page, {
      arquivo: '08-lista-solicitacoes',
      descricao: 'Lista em cartões. Verificar: nada de tabela larga; cada item diz o que é, onde está e o que fazer.',
      url: '/portal/embarcador/solicitacoes',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/operacoes': F.LISTA_ATIVA },
    });
  });

  test('09 lista de operações — vazia', async ({ page }) => {
    await capturar(page, {
      arquivo: '09-lista-operacoes-vazia',
      descricao: 'Sem operação em andamento. Verificar: vazio que explica, não "nenhum registro".',
      url: '/portal/embarcador/operacoes',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/operacoes': F.LISTA_VAZIA },
    });
  });

  test('10 pedido — formulário inicial (1 origem)', async ({ page }) => {
    await capturar(page, {
      arquivo: '10-pedido-uma-origem',
      descricao: 'Formulário inicial. Verificar: poucos campos; nenhum ID interno, distância, diesel, veículo, motorista ou número de viagens.',
      url: '/portal/embarcador/solicitacoes/nova',
      rotas: { ...ROTAS_BASE },
      tambemTablet: true,
    });
  });

  test('11 pedido — três origens', async ({ page }) => {
    await capturar(page, {
      arquivo: '11-pedido-tres-origens',
      descricao: 'Multi-origem preenchido. Verificar: continua compacto, "Adicionar outro local" é progressivo, total é derivado.',
      url: '/portal/embarcador/solicitacoes/nova',
      rotas: { ...ROTAS_BASE },
      antesDaCaptura: async (page) => {
        await page.fill('#cargo', 'Soja em grãos');
        await page.fill('#destino', 'Porto de Itaqui');
        await page.fill('#origem-0', 'Fazenda Boa Vista');
        await page.fill('#qtd-0', '500');
        await page.click('button:has-text("Adicionar outro local")');
        await page.fill('#origem-1', 'Fazenda Santa Clara');
        await page.fill('#qtd-1', '450');
        await page.click('button:has-text("Adicionar outro local")');
        await page.fill('#origem-2', 'Armazém Riacho Fundo');
        await page.fill('#qtd-2', '250');
      },
    });
  });

  test('12 pedido — conferência antes de enviar', async ({ page }) => {
    await capturar(page, {
      arquivo: '12-pedido-conferencia',
      descricao: 'Resumo pré-envio. Verificar: dá para entender o quê, quanto, de onde, para onde e quando, sem termo técnico.',
      url: '/portal/embarcador/solicitacoes/nova',
      rotas: { ...ROTAS_BASE },
      antesDaCaptura: async (page) => {
        await page.fill('#cargo', 'Soja em grãos');
        await page.fill('#destino', 'Porto de Itaqui');
        await page.fill('#origem-0', 'Fazenda Boa Vista');
        await page.fill('#qtd-0', '500');
        await page.click('button:has-text("Adicionar outro local")');
        await page.fill('#origem-1', 'Fazenda Santa Clara');
        await page.fill('#qtd-1', '450');
        await page.fill('#inicio', '2026-09-01');
        await page.fill('#fim', '2026-09-20');
        await page.fill('#obs', 'Portaria fecha às 17h. Avisar com 1 dia de antecedência.');
        await page.click('button:has-text("Conferir pedido")');
        await page.waitForSelector('text=Confira antes de enviar');
      },
    });
  });

  test('13 pedido enviado — em análise', async ({ page }) => {
    await capturar(page, {
      arquivo: '13-pedido-enviado',
      descricao: 'Estado logo após enviar. Verificar: mostra referência, situação atual e o que acontece a seguir, sem exigir que o usuário entenda o processo interno.',
      url: '/portal/embarcador/operacoes/req-fixture-0003?enviada=1',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': {
          ...F.DETALHE_PLANEJAMENTO,
          status_externo: 'EM_ANALISE',
          status_rotulo: 'Em análise',
          linha_do_tempo: [
            { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-25T12:00:00.000Z' },
          ],
        },
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  test('20 ajustes solicitados', async ({ page }) => {
    await capturar(page, {
      arquivo: '20-ajustes-solicitados',
      descricao: 'A transportadora pediu ajustes. Verificar: motivo em destaque e CTA "Corrigir solicitação" junto dele.',
      url: '/portal/embarcador/operacoes/req-fixture-0002',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0002': F.DETALHE_AJUSTES,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/documentos': F.DOCUMENTOS_VAZIOS,
      },
      tambemTablet: true,
    });
  });

  test('21 editor de correção', async ({ page }) => {
    await capturar(page, {
      arquivo: '21-editor-correcao',
      descricao: 'Formulário de correção. Verificar: vem pré-preenchido e mostra o motivo — não parece recomeçar do zero.',
      url: '/portal/embarcador/operacoes/req-fixture-0002?acao=corrigir',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0002': F.DETALHE_AJUSTES,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  test('22 histórico de envios (v1 → v2)', async ({ page }) => {
    await capturar(page, {
      arquivo: '22-historico-envios',
      descricao: 'Histórico aberto com v1 (motivo do ajuste) e v2. Verificar: uma pessoa comum entende o que mudou entre os envios.',
      url: '/portal/embarcador/operacoes/req-fixture-0002',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0002': F.DETALHE_COM_HISTORICO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/documentos': F.DOCUMENTOS_VAZIOS,
        'GET /portal/embarcador/solicitacoes/req-fixture-0002/historico': F.HISTORICO_DUAS_VERSOES,
      },
      antesDaCaptura: async (page) => {
        await page.click('button:has-text("Ver histórico de envios")');
        await page.waitForSelector('text=Envio 1');
      },
    });
  });

  test('23 pedido não atendido', async ({ page }) => {
    await capturar(page, {
      arquivo: '23-nao-atendido',
      descricao: 'Recusa da transportadora. Verificar: motivo visível e tom adequado; sem CTA que não existe.',
      url: '/portal/embarcador/operacoes/req-fixture-0006',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0006': F.DETALHE_RECUSADO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0006/documentos': F.DOCUMENTOS_VAZIOS,
      },
    });
  });

  const RASTREIO: [string, string, unknown][] = [
    ['30-tracking-planejamento', 'Aceita / em planejamento.', F.DETALHE_PLANEJAMENTO],
    ['31-tracking-agendado', 'Transporte agendado.', F.DETALHE_AGENDADO],
    ['32-tracking-em-transporte', 'Em transporte. Verificar: nenhum dado de motorista, veículo ou valor.', F.DETALHE_EM_TRANSPORTE],
    ['33-tracking-entrega-parcial', 'ENTREGA PARCIAL — o mais importante. Verificar: NÃO pode parecer que a operação inteira terminou.', F.DETALHE_PARCIAL],
    ['34-tracking-entregue', 'Entrega concluída, ainda sem comprovante.', F.DETALHE_ENTREGUE],
    ['36-tracking-processando', 'Estado desconhecido seguro. Verificar: honesto sem parecer quebrado/alarmante.', F.DETALHE_DESCONHECIDO],
  ];

  for (const [arquivo, descricao, detalhe] of RASTREIO) {
    test(`${arquivo}`, async ({ page }) => {
      await capturar(page, {
        arquivo,
        descricao,
        url: '/portal/embarcador/operacoes/req-fixture-0003',
        rotas: {
          ...ROTAS_BASE,
          'GET /portal/embarcador/operacoes/req-fixture-0003': detalhe,
          'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_VAZIOS,
        },
      });
    });
  }

  test('35 comprovante disponível', async ({ page }) => {
    await capturar(page, {
      arquivo: '35-comprovante-disponivel',
      descricao: 'Comprovante liberado. Verificar: é a ação primária e está acima dos demais documentos.',
      url: '/portal/embarcador/operacoes/req-fixture-0004',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0004': F.DETALHE_COMPROVANTE,
        'GET /portal/embarcador/solicitacoes/req-fixture-0004/documentos': F.DOCUMENTOS_SO_COMPROVANTE,
      },
      tambemTablet: true,
    });
  });

  test('40 documentos — lista completa e envio', async ({ page }) => {
    await capturar(page, {
      arquivo: '40-documentos-lista',
      descricao: 'Documento enviado pelo embarcador, documento da transportadora e comprovante, na mesma tela. Verificar: dá para diferenciar de quem é cada um; o campo de envio é claro e sem jargão de storage.',
      url: '/portal/embarcador/operacoes/req-fixture-0003',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_ENTREGUE,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_COMPLETOS,
      },
      tambemTablet: true,
    });
  });

  test('41 documentos — erro ao abrir arquivo', async ({ page }) => {
    await capturar(page, {
      arquivo: '41-documento-erro',
      descricao: 'Falha ao abrir um arquivo. Verificar: erro compreensível e recuperável, não uma exceção crua.',
      url: '/portal/embarcador/operacoes/req-fixture-0003',
      rotas: {
        ...ROTAS_BASE,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_ENTREGUE,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_COMPLETOS,
        'GET /portal/embarcador/documentos/doc-fixture-0020/url': 500,
      },
      antesDaCaptura: async (page) => {
        await page.click('button:has-text("Abrir comprovante")');
        await page.waitForSelector('[role="alert"]');
      },
    });
  });

  test('42 erro de carregamento', async ({ page }) => {
    await capturar(page, {
      arquivo: '42-erro-carregamento',
      descricao: 'Falha ao carregar o início. Verificar: mensagem em português com "Tentar novamente" — nunca tela branca.',
      url: '/portal/embarcador',
      rotas: { ...ROTAS_BASE, 'GET /portal/embarcador/inicio': 500 },
    });
  });

  test('43 seletor de transportadora', async ({ page }) => {
    await capturar(page, {
      arquivo: '43-duas-transportadoras',
      descricao: 'Embarcador com dois relacionamentos. Verificar: o seletor aparece e fica compreensível também no celular.',
      url: '/portal/embarcador',
      rotas: {
        'GET /portal/embarcador/contexto': F.CONTEXTO_DUAS_TRANSPORTADORAS,
        'GET /portal/embarcador/inicio': F.INICIO_ATIVO,
      },
    });
  });

  test('50 conteúdo longo — estresse de layout', async ({ page }) => {
    await capturar(page, {
      arquivo: '50-conteudo-longo',
      descricao: 'Nome de empresa, origem, destino, motivo e título de documento longos. Verificar: sem overflow, sem ação cortada, sem layout quebrado.',
      url: '/portal/embarcador/operacoes/req-fixture-0003',
      rotas: {
        'GET /portal/embarcador/contexto': F.CONTEXTO_LONGO,
        'GET /portal/embarcador/operacoes/req-fixture-0003': F.DETALHE_LONGO,
        'GET /portal/embarcador/solicitacoes/req-fixture-0003/documentos': F.DOCUMENTOS_LONGOS,
      },
      tambemTablet: true,
    });
  });

  test.afterAll(() => { gravarRegistro(); });
});
