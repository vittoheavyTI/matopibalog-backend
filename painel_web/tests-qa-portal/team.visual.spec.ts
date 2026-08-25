import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  instalarFixtures, estabelecerSessao, assentar, DESKTOP, MOBILE, type Cenario,
} from './harness';

// Pacote visual do Team / User Provisioning V1.
//
// Captura o modal de Frete como REFERÊNCIA (`UX_FORM_001`) e os modais de Usuário
// e Motorista já alinhados a ele. O harness é o mesmo do Portal: fixtures no
// lugar da API, nada de produção — e a mesma contabilidade de escapes.

const TOKEN_INTERNO = 'token-fixture-interno-nao-e-real';
const PASTA = path.resolve(process.cwd(), '..', 'team-user-provisioning-visual');

const USUARIO_INTERNO = {
  id: 'user-fixture-0001', email: 'operacao@exemplo.invalid', nome: 'Rafael Queiroz',
  tipo: 'admin', status: 'ativo', foto_url: null, is_super_admin: false,
  empresa_id: 'emp-fixture-0001', empresas: { tipo: 'transportadora', nome: 'Transportes Cerrado' },
  effective_permissions: {
    'users.view': true, 'users.manage': true, 'permissions.manage': true,
    'drivers.view': true, 'drivers.manage': true, 'freight.view': true, 'freight.manage': true,
    'fleet.view': true, 'reports.view': true,
  },
  permission_template: 'administrador', senha_temporaria: false,
  termos_pendentes: false, termos_pendentes_count: 0,
};

const SHELL = {
  'GET /auth/me': USUARIO_INTERNO,
  'GET /ai/capabilities': { enabled: false, provider_available: false, read_only: true },
  'GET /configuracoes': {},
  'GET /configuracoes/empresa': { logomarca: null },
  'GET /notificacoes': [],
  'GET /notificacoes/nao-lidas/count': { count: 0 },
  'GET /operacional/contexto': { unidades: [], grupos: [] },
};

// Perfis como o novo endpoint os devolve — já filtrados pelo servidor.
const PERFIS_ATRIBUIVEIS = {
  itens: [
    {
      id: 'tpl-administrador', stable_key: 'administrador', nome: 'Administrador',
      descricao: 'Administra o tenant: usuários, permissões, configurações, operação, relatórios e financeiro.',
      resumo: ['Gerenciar usuários e permissões', 'Financeiro', 'Fretes e operação', 'Motoristas'],
      editavel: true,
    },
    {
      id: 'tpl-gerente-frota', stable_key: 'gerente_frota', nome: 'Gerente de Frota',
      descricao: 'Gestão operacional da frota no escopo, incluindo aprovação de lançamentos. Sem financeiro por padrão.',
      resumo: ['Fretes e operação', 'Motoristas', 'Frota'],
      editavel: true,
    },
    {
      id: 'tpl-operador', stable_key: 'operador', nome: 'Operador',
      descricao: 'Operação do dia a dia: fretes, documentos e lançamentos. Sem financeiro nem administração.',
      resumo: ['Fretes e operação'],
      editavel: true,
    },
    {
      id: 'tpl-financeiro', stable_key: 'financeiro', nome: 'Financeiro',
      descricao: 'Acesso ao financeiro operacional e aos relatórios financeiros.',
      resumo: ['Financeiro', 'Relatórios'],
      editavel: true,
    },
  ],
};

const USUARIOS = [
  {
    id: 'u-1', nome: 'Rafael Queiroz', email: 'operacao@exemplo.invalid', tipo: 'admin',
    status: 'ativo', empresa_id: 'emp-fixture-0001', telefone: '(99) 9 9999-0001',
    permission_template_id: 'tpl-administrador', perfil_acesso_nome: 'Administrador',
    empresas: { tipo: 'transportadora' },
  },
  {
    id: 'u-2', nome: 'Camila Ribeiro', email: 'camila@exemplo.invalid', tipo: 'admin',
    status: 'ativo', empresa_id: 'emp-fixture-0001', telefone: '(99) 9 9999-0002',
    permission_template_id: 'tpl-gerente-frota', perfil_acesso_nome: 'Gerente de Frota',
    empresas: { tipo: 'transportadora' },
  },
];

const MOTORISTAS = { itens: [], data: [] };

const medidas: Array<Record<string, unknown>> = [];

async function medirModal(page: Page, cena: string, viewport: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    // O container do modal é o filho direto do overlay `fixed inset-0`.
    const overlay = document.querySelector('div.fixed.inset-0');
    const caixa = overlay?.querySelector(':scope > div') as HTMLElement | null;
    const rodape = caixa?.lastElementChild as HTMLElement | null;
    const caixaRect = caixa?.getBoundingClientRect();
    const rodapeRect = rodape?.getBoundingClientRect();

    // Campos visíveis sem rolar dentro do corpo do modal (primeira dobra).
    const corpo = caixa?.children?.[1] as HTMLElement | null;
    let camposPrimeiraDobra = 0;
    if (corpo) {
      corpo.querySelectorAll('input, select, textarea').forEach((el) => {
        const r2 = (el as HTMLElement).getBoundingClientRect();
        if (r2.height > 0 && r2.bottom <= (corpo.getBoundingClientRect().bottom + 1)) camposPrimeiraDobra += 1;
      });
    }

    return {
      paginaScrollWidth: doc.scrollWidth,
      paginaClientWidth: doc.clientWidth,
      modalAltura: caixaRect ? Math.round(caixaRect.height) : null,
      alturaViewport: window.innerHeight,
      modalCabeNaTela: caixaRect ? caixaRect.height <= window.innerHeight + 1 : null,
      rodapeVisivel: rodapeRect
        ? rodapeRect.bottom <= window.innerHeight + 1 && rodapeRect.top >= 0
        : null,
      corpoTemRolagemPropria: corpo ? corpo.scrollHeight > corpo.clientHeight : null,
      camposPrimeiraDobra,
    };
  });

  medidas.push({ cena, viewport, ...r });
}

async function capturar(page: Page, nome: string, url: string, cenario: Cenario, abrirModal: (p: Page) => Promise<void>) {
  const sessao = await instalarFixtures(page, cenario);
  await estabelecerSessao(page, cenario);

  for (const [rotulo, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    await page.setViewportSize(vp);
    await page.goto(url);
    await assentar(page);
    await abrirModal(page);
    await assentar(page, 400);
    await medirModal(page, nome, `${vp.width}x${vp.height}`);
    fs.mkdirSync(PASTA, { recursive: true });
    await page.screenshot({ path: path.join(PASTA, `${nome}-${rotulo}.png`), fullPage: false });
  }

  expect(sessao.escapes, `escapes: ${JSON.stringify(sessao.escapes)}`).toEqual([]);
}

test.describe('Team provisioning — pacote visual', () => {
  test('referência: modal de Novo Frete', async ({ page }) => {
    await capturar(page, 'freight-reference', '/relatorios/viagens', {
      rotas: {
        ...SHELL,
        'GET /fretes': [],
        'GET /admin/motoristas': [],
        'GET /fretes/localizacao/estados': { itens: [] },
        'GET /frota/veiculos': { itens: [] },
        'GET /frota/composicoes': { itens: [] },
      },
      tokenInterno: TOKEN_INTERNO,
    }, async (p) => {
      await p.locator('button:has-text("Novo Frete")').first().click();
      await p.waitForSelector('text=Novo Frete', { state: 'visible' });
    });
  });

  test('depois: modal de Novo Usuário', async ({ page }) => {
    await capturar(page, 'user-after', '/admins', {
      rotas: {
        ...SHELL,
        'GET /admin/usuarios': USUARIOS,
        'GET /admin/perfis-acesso': PERFIS_ATRIBUIVEIS,
      },
      tokenInterno: TOKEN_INTERNO,
    }, async (p) => {
      await p.locator('button:has-text("Novo Usuário"), button:has-text("Novo usuário")').first().click();
      await p.waitForSelector('text=Perfil de acesso');
    });
  });

  test('depois: modal de Novo Motorista', async ({ page }) => {
    await capturar(page, 'driver-after', '/motoristas', {
      rotas: {
        ...SHELL,
        'GET /admin/motoristas': MOTORISTAS,
        'GET /admin/motoristas/pendentes': [],
        'GET /admin/plano-uso': { limite: 10, usados: 2 },
      },
      tokenInterno: TOKEN_INTERNO,
    }, async (p) => {
      await p.locator('button:has-text("Novo Motorista"), button:has-text("Adicionar")').first().click();
      await p.waitForSelector('text=Cadastrar novo motorista');
    });
  });

  test.afterAll(() => {
    fs.mkdirSync(PASTA, { recursive: true });
    fs.writeFileSync(path.join(PASTA, 'medidas.json'), JSON.stringify(medidas, null, 2), 'utf8');
    for (const m of medidas) {
      console.log(`\n### ${m.cena} (${m.viewport})`);
      console.log(`   modal cabe na tela: ${m.modalCabeNaTela} (altura ${m.modalAltura} / viewport ${m.alturaViewport})`);
      console.log(`   rodapé visível: ${m.rodapeVisivel}`);
      console.log(`   corpo com rolagem própria: ${m.corpoTemRolagemPropria}`);
      console.log(`   campos na primeira dobra: ${m.camposPrimeiraDobra}`);
      console.log(`   página: scroll ${m.paginaScrollWidth} / client ${m.paginaClientWidth}`);
    }
  });
});
