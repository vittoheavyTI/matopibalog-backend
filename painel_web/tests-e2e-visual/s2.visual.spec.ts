import { test, expect, type Page, type Route } from '@playwright/test';

type ViewportCase = { nome: string; width: number; height: number };
type S2Route = { rota: string; nome: string; deepLinkOnly?: boolean; persona?: 'super-admin' | 'internal-admin' };

const VIEWPORTS: ViewportCase[] = [
  { nome: 'desktop', width: 1440, height: 900 },
  { nome: 'tablet', width: 1024, height: 768 },
  { nome: 'mobile', width: 390, height: 844 },
];

const ROTAS_S2: S2Route[] = [
  { nome: 'Super Admin Dashboard', rota: '/' },
  { nome: 'Empresas', rota: '/painel-administrativo/empresas' },
  { nome: 'Usuarios', rota: '/painel-administrativo/usuarios' },
  { nome: 'Motoristas', rota: '/painel-administrativo/motoristas' },
  { nome: 'Operacional Super Admin', rota: '/painel-administrativo/operacional' },
  { nome: 'Financeiro Visao Geral', rota: '/painel-administrativo/financeiro' },
  { nome: 'PainelAssinaturas', rota: '/painel-administrativo/financeiro?aba=assinaturas' },
  { nome: 'Termos LGPD', rota: '/painel-administrativo/termos-lgpd' },
  { nome: 'ModelosContrato', rota: '/painel-administrativo/termos-lgpd#modelos' },
  { nome: 'Perfis e Permissoes', rota: '/perfis-permissoes', persona: 'internal-admin' },
  { nome: 'Usuarios Cliente', rota: '/admins', persona: 'internal-admin' },
  { nome: 'DEBT-101 Visao Geral', rota: '/painel-administrativo/visao-geral', deepLinkOnly: true },
  { nome: 'DEBT-101 Relatorios', rota: '/painel-administrativo/relatorios', deepLinkOnly: true },
];

const SUPER_ADMIN = {
  id: 'super-1',
  uid: 'super-1',
  nome: 'Super Admin S2',
  email: 'super@matopibalog.test',
  tipo: 'admin',
  role: 'admin',
  is_super_admin: true,
  empresa_id: null,
  status: 'ativo',
  termos_pendentes: false,
  senha_temporaria: false,
  effective_permissions: {},
};

const ADMIN_PERMISSOES = {
  'drivers.view': true,
  'users.view': true,
  'users.manage': true,
  'permissions.manage': true,
  'company.settings.view': true,
  'company.settings.manage': true,
  'finance.saas.view': true,
};

const longText = 'Fazenda Primavera Exportacao Agricola e Transportes Integrados do MATOPIBA Ltda';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function empresas() {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `emp-${i + 1}`,
    nome: `${longText} ${i + 1}`,
    razao_social: `${longText} Razao Social ${i + 1}`,
    cnpj: `00.000.000/000${i}-00`,
    tipo: i % 2 === 0 ? 'transportadora' : 'autonomo',
    status: i % 3 === 0 ? 'trial' : 'ativo',
    billing_status: 'ok',
    created_at: '2026-01-10T12:00:00Z',
    trial_started_at: '2026-01-10T12:00:00Z',
    trial_ends_at: '2026-12-31T12:00:00Z',
    asaas_subscription_id: i % 2 === 0 ? `sub_${i}` : null,
    planos: {
      id: `plano-${i}`,
      nome: i % 2 === 0 ? 'Enterprise Safra Completa' : 'Operacao Essencial',
      preco_mensal: i % 2 === 0 ? 1499.9 : 499.9,
    },
  }));
}

function motoristas() {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `mot-${i + 1}`,
    nome: `Motorista Autonomo Com Nome Muito Longo Para Teste ${i + 1}`,
    email: `motorista.${i + 1}@empresa-longa.example`,
    cpf: `000.000.000-0${i}`,
    status: i % 2 === 0 ? 'pendente' : 'aprovado',
    status_cadastro: i % 2 === 0 ? 'pendente' : 'aprovado',
    empresas: empresas()[i % empresas().length],
    usuarios: {
      nome: `Motorista Vinculado Com Nome Muito Longo ${i + 1}`,
      email: `usuario.motorista.${i + 1}@empresa-longa.example`,
    },
  }));
}

const termos = [
  {
    id: 'termo-1',
    tipo: 'politica_privacidade',
    versao: 3,
    titulo: 'Politica de Privacidade para Operacoes Multiempresa e Motoristas Autonomos',
    resumo: 'Documento longo para testar quebra de linhas em tabelas estreitas.',
    conteudo_hash: 'abcdef1234567890abcdef1234567890',
    obrigatorio_para: ['admin', 'motorista'],
    ativo: true,
    publicado_em: '2026-09-01T12:00:00Z',
  },
  {
    id: 'termo-2',
    tipo: 'termo_motorista',
    versao: 1,
    titulo: 'Termo do Motorista Autonomo',
    resumo: 'Resumo curto.',
    conteudo_hash: '1234567890abcdef',
    obrigatorio_para: ['motorista'],
    ativo: false,
    publicado_em: null,
  },
];

async function instalarS2ApiFake(page: Page, opcoes: { superAdmin?: boolean; permissions?: Record<string, boolean> } = {}) {
  const violacoes: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      violacoes.push(`${route.request().method()} ${url.href}`);
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();

    const p = url.pathname;
    if (p.endsWith('/auth/me')) {
      if (opcoes.superAdmin !== false) return json(route, SUPER_ADMIN);
      return json(route, {
        ...SUPER_ADMIN,
        is_super_admin: false,
        empresa_id: 'emp-1',
        empresas: { id: 'emp-1', nome: 'Transportadora Teste', tipo: 'transportadora' },
        effective_permissions: opcoes.permissions || ADMIN_PERMISSOES,
      });
    }
    if (p.endsWith('/auth/logout') || p.endsWith('/auth/refresh')) return json(route, {});
    if (p.endsWith('/configuracoes') || p.endsWith('/configuracoes/public') || p.endsWith('/configuracoes/empresa')) return json(route, {});
    if (p.includes('/portal/governanca') || p.includes('/governanca')) {
      return json(route, { entitlements: { estrutura_operacional: { permitido: true } } });
    }
    if (p.includes('/painel-admin/empresas')) return json(route, empresas());
    if (p.includes('/painel-admin/motoristas')) return json(route, motoristas());
    if (p.includes('/admin/motoristas/em-viagem')) return json(route, [{ id: 'mot-2' }]);
    if (p.endsWith('/admin/termos')) return json(route, termos);
    if (p.includes('/admin/termos/') && p.endsWith('/aceites')) return json(route, []);
    if (p.endsWith('/admin/usuarios')) {
      return json(route, [
        {
          id: 'u-1',
          nome: 'Administradora Operacional de Nome Muito Longo',
          email: 'admin.operacional@empresa-longa.example',
          tipo: 'admin',
          empresa_id: 'emp-1',
          empresas: empresas()[0],
          status: 'ativo',
          permission_template_id: 'tpl-admin',
          perfil_acesso_nome: 'Administrador',
          ajustes_de_acesso: 2,
        },
      ]);
    }
    if (p.endsWith('/admin/perfis-acesso')) {
      return json(route, { itens: [
        { id: 'tpl-admin', stable_key: 'administrador', nome: 'Administrador', resumo: ['Gerenciar usuarios e permissoes'], editavel: true },
        { id: 'tpl-op', stable_key: 'operador', nome: 'Operador', resumo: ['Operacao do dia a dia'], editavel: true },
      ] });
    }
    if (p.endsWith('/admin/permissions/registry')) {
      return json(route, { permissions: [
        { key: 'users.manage', category: 'users', label: 'Gerenciar usuarios', description: 'Criar e editar usuarios' },
        { key: 'permissions.manage', category: 'permissions', label: 'Gerenciar permissoes', description: 'Editar perfis' },
      ], driver_financial_visibility_modes: ['none', 'own'] });
    }
    if (p.endsWith('/admin/permissions/templates')) {
      return json(route, { templates: [
        { id: 'tpl-admin', stable_key: 'administrador', display_name: 'Administrador', is_system_baseline: true, editable: true, permissions: ADMIN_PERMISSOES, user_count: 1 },
        { id: 'tpl-op', stable_key: 'operador', display_name: 'Operador', is_system_baseline: true, editable: true, permissions: { 'drivers.view': true }, user_count: 0 },
      ] });
    }
    if (p.includes('/admin/contrato-modelos/overview')) {
      return json(route, { planos: [
        { plano_id: 'plano-1', plano_nome: 'Enterprise Safra Completa', preco_mensal: 1499.9, vigente: { id: 'mod-1', versao: 2, titulo: 'Contrato Enterprise Safra Completa', publicado_em: '2026-09-01T12:00:00Z' }, tem_rascunho: true, rascunho_id: 'mod-r1', total_versoes: 2, ultima_atualizacao: '2026-09-01T12:00:00Z', sem_modelo_vigente: false },
        { plano_id: 'plano-2', plano_nome: 'Operacao Essencial', preco_mensal: 499.9, vigente: null, tem_rascunho: false, rascunho_id: null, total_versoes: 0, ultima_atualizacao: null, sem_modelo_vigente: true },
      ] });
    }
    if (p.includes('/admin/contrato-modelos/')) {
      return json(route, { id: 'mod-1', plano_id: 'plano-1', versao: 2, titulo: 'Contrato Enterprise', conteudo: 'Texto do contrato', status: 'publicado' });
    }
    if (p.includes('/operacional/contexto')) return json(route, { scope: { mode: 'CONFIGURED', rollout_mode: 'configured' } });
    if (p.includes('/operacional/unidades')) return json(route, [
      { id: 'un-1', nome: 'Unidade Matriz com Nome Muito Longo', codigo: 'MTZ', cidade: 'Balsas', uf: 'MA', status: 'ativo', is_default: true },
    ]);
    if (p.includes('/operacional/regioes')) return json(route, [
      { id: 'reg-1', nome: 'Regiao Sul do Piaui e Oeste da Bahia', codigo: 'MATOPIBA-SUL', status: 'ativo' },
    ]);
    if (p.includes('/operacional/memberships')) return json(route, [
      { id: 'mem-1', usuario_id: 'usuario-com-identificador-longo-123', scope_level: 'LOCAL', unidade_operacional_id: 'un-1', status: 'ativo', papel: 'operador' },
    ]);
    if (p.includes('/operacional/grupos')) return json(route, [
      { id: 'grp-1', nome: 'Grupo Empresarial Integrado MATOPIBA', status: 'ativo' },
    ]);
    if (p.includes('/notificacoes')) return json(route, []);
    return json(route, Array.isArray(empresas()) ? [] : {});
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'token-s2-visual');
  });

  return {
    violacoes,
    assertSemRedeExterna() {
      if (violacoes.length > 0) {
        throw new Error(`EXTERNAL_NETWORK_VIOLATIONS=${violacoes.length}: ${violacoes.join(' | ')}`);
      }
    },
  };
}

async function irPara(page: Page, rota: string) {
  const [path, hash] = rota.split('#');
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav a', { timeout: 20_000 });
  if (hash === 'modelos') {
    await page.getByRole('button', { name: 'Modelos de contrato' }).click();
  }
  await page.waitForTimeout(350);
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 80),
          className: String(el.className || '').slice(0, 160),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((el) => el.right > doc.clientWidth + 1 || el.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5);
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflow: doc.scrollWidth > doc.clientWidth + 1,
      activeNav: document.querySelectorAll('nav a.bg-green-700').length,
      offenders,
    };
  });
}

test.describe('S2 behavioral audit — rotas, overflow global e nav ativo', () => {
  for (const vp of VIEWPORTS) {
    for (const caso of ROTAS_S2) {
      test(`${vp.nome} ${vp.width}x${vp.height} — ${caso.nome} — ${caso.rota}`, async ({ page }) => {
        const rede = await instalarS2ApiFake(page, { superAdmin: caso.persona !== 'internal-admin' });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await irPara(page, caso.rota);
        const medida = await medir(page);
        await test.info().attach('s2-measurement', {
          body: JSON.stringify({ viewport: vp, route: caso, medida }, null, 2),
          contentType: 'application/json',
        });
        expect(
          medida.scrollWidth,
          `${caso.rota} overflow global (${medida.scrollWidth} > ${medida.clientWidth}) offenders=${JSON.stringify(medida.offenders)}`,
        ).toBeLessThanOrEqual(medida.clientWidth + 1);
        if (!caso.deepLinkOnly) {
          expect(medida.activeNav, `${caso.rota} deve ter exatamente 1 primary nav ativo`).toBe(1);
        }
        rede.assertSemRedeExterna();
      });
    }
  }
});

test.describe('S2 persona/permission matrix — guardas cliente', () => {
  test('sem login redireciona rota S2 para login', async ({ page }) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname.endsWith('/auth/me')) return json(route, { message: 'unauthorized' }, 401);
      return json(route, {});
    });
    await page.goto('/painel-administrativo/usuarios', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });

  test('admin interno sem is_super_admin nao acessa painel administrativo', async ({ page }) => {
    const rede = await instalarS2ApiFake(page, { superAdmin: false, permissions: ADMIN_PERMISSOES });
    await page.goto('/painel-administrativo/usuarios', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$/);
    rede.assertSemRedeExterna();
  });

  test('users.manage nao torna o editor de perfis visivel sem permissions.manage', async ({ page }) => {
    const rede = await instalarS2ApiFake(page, {
      superAdmin: false,
      permissions: { 'users.view': true, 'users.manage': true, 'company.settings.view': true },
    });
    await page.goto('/admins', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav a', { timeout: 20_000 });
    await expect(page.getByRole('link', { name: /perfis e permissões/i })).toHaveCount(0);
    await page.goto('/perfis-permissoes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/acesso restrito/i)).toBeVisible();
    rede.assertSemRedeExterna();
  });
});

test.describe('S2 PainelAssinaturas contract', () => {
  test('deep link, refresh, back/forward e query aba=assinaturas preservados', async ({ page }) => {
    const rede = await instalarS2ApiFake(page, { superAdmin: true });
    await page.setViewportSize({ width: 1024, height: 768 });
    await irPara(page, '/painel-administrativo/financeiro?aba=assinaturas');
    await expect(page).toHaveURL(/aba=assinaturas/);
    await expect(page.getByRole('button', { name: /assinaturas/i })).toHaveClass(/bg-green-700/);
    await expect(page.locator('nav a.bg-green-700')).toHaveCount(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/aba=assinaturas/);

    await page.getByRole('button', { name: /faturas/i }).click();
    await expect(page).toHaveURL(/aba=faturas/);
    await page.goBack();
    await expect(page).toHaveURL(/aba=assinaturas/);
    await page.goForward();
    await expect(page).toHaveURL(/aba=faturas/);
    rede.assertSemRedeExterna();
  });
});
