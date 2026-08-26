import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  instalarFixtures, estabelecerSessao, assentar, DESKTOP, MOBILE, type Cenario,
} from './harness';

// Pacote visual da correção da aceitação do owner.
//
// Captura o FLUXO, não telas soltas (§61): o que o owner precisa conferir é que a
// lista de contas não nasce aberta, que o seletor de perfil é um campo e não uma
// parede, e que as seções estão visíveis sem gate. Screenshot de estado final não
// mostraria nada disso.
//
// Mesmo harness do Portal: fixtures no lugar da API, contenção auditada, zero
// produção.

const TOKEN_INTERNO = 'token-fixture-interno-nao-e-real';
const PASTA = path.resolve(process.cwd(), '..', 'team-correcoes-visual');

const PERFIS = {
  itens: [
    {
      id: 'tpl-administrador', stable_key: 'administrador', nome: 'Administrador',
      descricao: 'Administra o tenant: usuários, permissões, operação e financeiro.',
      resumo: ['Gerenciar usuários e permissões', 'Financeiro', 'Fretes e operação'], editavel: true,
    },
    {
      id: 'tpl-gerente-frota', stable_key: 'gerente_frota', nome: 'Gerente de Frota',
      descricao: 'Gestão operacional da frota, incluindo aprovação de lançamentos.',
      resumo: ['Fretes e operação', 'Motoristas', 'Frota'], editavel: true,
    },
    {
      id: 'tpl-operador', stable_key: 'operador', nome: 'Operador',
      descricao: 'Operação do dia a dia: fretes, documentos e lançamentos.',
      resumo: ['Fretes e operação'], editavel: true,
    },
    {
      id: 'tpl-financeiro', stable_key: 'financeiro', nome: 'Financeiro',
      descricao: 'Acesso ao financeiro operacional e aos relatórios financeiros.',
      resumo: ['Financeiro', 'Relatórios'], editavel: true,
    },
  ],
};

const EMPRESAS = [
  { id: 'emp-1', nome: 'Transportes Cerrado', tipo: 'transportadora' },
  { id: 'emp-2', nome: 'Fazenda Boa Vista', tipo: 'transportadora' },
  { id: 'emp-3', nome: 'Cerrado Agro Logística', tipo: 'transportadora' },
  { id: 'emp-4', nome: 'João Batista (Autônomo)', tipo: 'autonomo' },
  { id: 'emp-5', nome: 'Transportadora Bravo', tipo: 'transportadora' },
];

const USUARIOS = [
  {
    id: 'u-1', nome: 'Rafael Queiroz', email: 'rafael@exemplo.invalid', tipo: 'admin',
    status: 'ativo', empresa_id: 'emp-1', telefone: '(99) 9 9999-0001',
    permission_template_id: 'tpl-administrador', perfil_acesso_nome: 'Administrador',
    ajustes_de_acesso: 0, empresas: { tipo: 'transportadora' },
  },
  {
    id: 'u-2', nome: 'Camila Ribeiro', email: 'camila@exemplo.invalid', tipo: 'admin',
    status: 'ativo', empresa_id: 'emp-1', telefone: '(99) 9 9999-0002',
    permission_template_id: 'tpl-gerente-frota', perfil_acesso_nome: 'Gerente de Frota',
    ajustes_de_acesso: 2, empresas: { tipo: 'transportadora' },
  },
];

function shell(superAdmin: boolean) {
  return {
    'GET /auth/me': {
      id: 'user-fixture-0001', email: 'operacao@exemplo.invalid', nome: 'Rafael Queiroz',
      tipo: 'admin', status: 'ativo', foto_url: null, is_super_admin: superAdmin,
      empresa_id: 'emp-1', empresas: { tipo: 'transportadora', nome: 'Transportes Cerrado' },
      effective_permissions: {
        'users.view': true, 'users.manage': true, 'permissions.manage': true,
        'drivers.view': true, 'drivers.manage': true, 'freight.view': true,
        'freight.manage': true, 'fleet.view': true, 'reports.view': true,
      },
      permission_template: 'administrador', senha_temporaria: false,
      termos_pendentes: false, termos_pendentes_count: 0,
    },
    'GET /ai/capabilities': { enabled: false, provider_available: false, read_only: true },
    'GET /configuracoes': {},
    'GET /configuracoes/empresa': { logomarca: null },
    'GET /notificacoes': [],
    'GET /notificacoes/nao-lidas/count': { count: 0 },
    'GET /operacional/contexto': { unidades: [], grupos: [] },
    'GET /admin/usuarios': USUARIOS,
    'GET /admin/perfis-acesso': PERFIS,
    'GET /painel-admin/empresas': EMPRESAS,
  };
}

const medidas: Array<Record<string, unknown>> = [];

async function medir(page: Page, cena: string, viewport: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const caixa = document.querySelector('[role="dialog"]') as HTMLElement | null;
    const rodape = caixa?.lastElementChild as HTMLElement | null;
    const caixaRect = caixa?.getBoundingClientRect();
    const rodapeRect = rodape?.getBoundingClientRect();
    const corpo = caixa?.children?.[1] as HTMLElement | null;
    return {
      paginaScrollWidth: doc.scrollWidth,
      paginaClientWidth: doc.clientWidth,
      semOverflowHorizontal: doc.scrollWidth <= doc.clientWidth,
      modalAltura: caixaRect ? Math.round(caixaRect.height) : null,
      alturaViewport: window.innerHeight,
      modalCabeNaTela: caixaRect ? caixaRect.height <= window.innerHeight + 1 : null,
      rodapeVisivel: rodapeRect
        ? rodapeRect.bottom <= window.innerHeight + 1 && rodapeRect.top >= 0
        : null,
      corpoTemRolagemPropria: corpo ? corpo.scrollHeight > corpo.clientHeight : null,
      // O que a correção promete: nenhuma lista gigante permanentemente aberta.
      opcoesDeContaVisiveis: caixa ? caixa.querySelectorAll('[role="option"]').length : 0,
      opcoesDePerfilVisiveis: caixa ? caixa.querySelectorAll('[role="radio"]').length : 0,
    };
  });
  medidas.push({ cena, viewport, ...r });
}

async function cena(page: Page, nome: string, vp: typeof DESKTOP) {
  await assentar(page, 300);
  await medir(page, nome, `${vp.width}x${vp.height}`);
  fs.mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: path.join(PASTA, `${nome}.png`), fullPage: false });
}

async function irParaUsuarios(page: Page, cenario: Cenario, vp: typeof DESKTOP) {
  await instalarFixtures(page, cenario);
  await estabelecerSessao(page, cenario);
  await page.setViewportSize(vp);
  await page.goto('/admins');
  await assentar(page);
}

test.describe('Team — correção da aceitação visual', () => {
  test('super-admin: fluxo completo de criação', async ({ page }) => {
    const cenario: Cenario = { rotas: shell(true), tokenInterno: TOKEN_INTERNO };
    const sessao = await instalarFixtures(page, cenario);
    await estabelecerSessao(page, cenario);
    await page.setViewportSize(DESKTOP);
    await page.goto('/admins');
    await assentar(page);

    await page.locator('button:has-text("Novo Usuário"), button:has-text("Novo usuário")').first().click();
    await page.waitForSelector('[role="dialog"]');
    await cena(page, 'sa-1-novo-antes-da-busca', DESKTOP);

    await page.getByLabel('Buscar conta').fill('cerrado');
    await page.waitForSelector('[role="listbox"]');
    await cena(page, 'sa-2-conta-buscando', DESKTOP);

    await page.locator('[role="dialog"]').getByRole('option', { name: /Transportes Cerrado/ }).click();
    await page.waitForSelector('button:has-text("Alterar conta")');
    await cena(page, 'sa-3-conta-selecionada', DESKTOP);

    await page.waitForSelector('button:has-text("Selecionar perfil de acesso")');
    await cena(page, 'sa-4-perfil-fechado', DESKTOP);

    await page.locator('button:has-text("Selecionar perfil de acesso")').click();
    await page.waitForSelector('[role="radio"]');
    await cena(page, 'sa-5-perfil-aberto', DESKTOP);

    await page.locator('[role="dialog"]').getByRole('radio', { name: /Operador/ }).click();
    await page.waitForSelector('button:has-text("Alterar perfil")');
    await cena(page, 'sa-6-perfil-selecionado', DESKTOP);

    // Formulário inteiro, rolado até o fim: mostra que as seções estão abertas.
    await page.locator('[role="dialog"] > div').nth(1).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await cena(page, 'sa-7-formulario-completo', DESKTOP);

    expect(sessao.escapes, `escapes: ${JSON.stringify(sessao.escapes)}`).toEqual([]);
  });

  test('empresa: mesmo formulário, sem seletor de conta', async ({ page }) => {
    const cenario: Cenario = { rotas: shell(false), tokenInterno: TOKEN_INTERNO };
    await irParaUsuarios(page, cenario, DESKTOP);

    await page.locator('button:has-text("Novo Usuário"), button:has-text("Novo usuário")').first().click();
    await page.waitForSelector('[role="dialog"]');
    await cena(page, 'empresa-1-novo', DESKTOP);

    // §58: dentro da empresa o campo de conta não existe — ela já é conhecida.
    await expect(page.getByLabel('Buscar conta')).toHaveCount(0);

    await page.locator('button:has-text("Selecionar perfil de acesso")').click();
    await page.waitForSelector('[role="radio"]');
    await cena(page, 'empresa-2-perfil-aberto', DESKTOP);

    await page.locator('[role="dialog"]').getByRole('radio', { name: /Gerente de Frota/ }).click();
    await page.waitForSelector('button:has-text("Alterar perfil")');
    await cena(page, 'empresa-3-perfil-selecionado', DESKTOP);
  });

  test('super-admin: edição com troca de perfil', async ({ page }) => {
    const cenario: Cenario = { rotas: shell(true), tokenInterno: TOKEN_INTERNO };
    await irParaUsuarios(page, cenario, DESKTOP);

    await page.locator('button[aria-label="Editar usuário"]').first().click();
    await page.waitForSelector('[role="dialog"]');
    await cena(page, 'edicao-1-perfil-atual', DESKTOP);

    await page.locator('[role="dialog"] button:has-text("Alterar perfil")').click();
    await page.waitForSelector('[role="radio"]');
    await cena(page, 'edicao-2-escolhendo', DESKTOP);

    await page.locator('[role="dialog"]').getByRole('radio', { name: /Gerente de Frota/ }).click();
    await assentar(page, 300);
    await cena(page, 'edicao-3-trocado', DESKTOP);
  });

  test('mobile 390x844: sem overflow, rodapé visível, nada permanentemente aberto', async ({ page }) => {
    const cenario: Cenario = { rotas: shell(true), tokenInterno: TOKEN_INTERNO };
    await irParaUsuarios(page, cenario, MOBILE);

    await page.locator('button:has-text("Novo Usuário"), button:has-text("Novo usuário")').first().click();
    await page.waitForSelector('[role="dialog"]');
    await cena(page, 'mobile-1-novo', MOBILE);

    await page.getByLabel('Buscar conta').fill('cerrado');
    await page.locator('[role="dialog"]').getByRole('option', { name: /Transportes Cerrado/ }).click();
    await page.waitForSelector('button:has-text("Selecionar perfil de acesso")');
    await cena(page, 'mobile-2-conta-selecionada', MOBILE);

    await page.locator('button:has-text("Selecionar perfil de acesso")').click();
    await page.waitForSelector('[role="radio"]');
    await cena(page, 'mobile-3-perfil-aberto', MOBILE);

    await page.locator('[role="dialog"]').getByRole('radio', { name: /Operador/ }).click();
    await assentar(page, 300);
    await cena(page, 'mobile-4-perfil-selecionado', MOBILE);
  });

  test.afterAll(() => {
    fs.mkdirSync(PASTA, { recursive: true });
    fs.writeFileSync(path.join(PASTA, 'medidas.json'), JSON.stringify(medidas, null, 2), 'utf8');
    for (const m of medidas) {
      console.log(`\n### ${m.cena} (${m.viewport})`);
      console.log(`   modal cabe: ${m.modalCabeNaTela} (${m.modalAltura}/${m.alturaViewport}) · rodapé visível: ${m.rodapeVisivel}`);
      console.log(`   sem overflow horizontal: ${m.semOverflowHorizontal} (${m.paginaScrollWidth}/${m.paginaClientWidth})`);
      console.log(`   opções de conta abertas: ${m.opcoesDeContaVisiveis} · opções de perfil abertas: ${m.opcoesDePerfilVisiveis}`);
    }
  });
});
