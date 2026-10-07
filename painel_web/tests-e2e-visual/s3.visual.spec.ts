import { test, expect, type Page, type Route } from '@playwright/test';

type ViewportCase = { nome: string; width: number; height: number };
type RouteCase = { nome: string; rota: string; heading: RegExp; activeNav?: number };

const VIEWPORTS: ViewportCase[] = [
  { nome: 'desktop', width: 1440, height: 900 },
  { nome: 'tablet', width: 1024, height: 768 },
  { nome: 'mobile', width: 390, height: 844 },
];

const ROTAS_S3: RouteCase[] = [
  { nome: 'Fretes', rota: '/relatorios/viagens', heading: /fretes|viagens|gerenciamento/i, activeNav: 1 },
  { nome: 'Campanhas de Escoamento', rota: '/campanhas-escoamento', heading: /campanhas de escoamento/i, activeNav: 1 },
  { nome: 'Route Intelligence', rota: '/rota', heading: /rota inteligente/i, activeNav: 1 },
  { nome: 'Frota', rota: '/frota', heading: /frota/i, activeNav: 1 },
  { nome: 'Estrutura Operacional', rota: '/operacional', heading: /estrutura operacional/i, activeNav: 1 },
  { nome: 'Motoristas', rota: '/motoristas', heading: /motoristas/i, activeNav: 1 },
  { nome: 'Usuarios', rota: '/admins', heading: /usuarios|usuários/i, activeNav: 1 },
  { nome: 'Rede de Parceiros', rota: '/rede-parceiros', heading: /rede de parceiros/i, activeNav: 1 },
];

const ADMIN_S3 = {
  id: 'u-s3-admin',
  uid: 'u-s3-admin',
  nome: 'Administradora Operacional S3',
  email: 's3.admin@matopibalog.test',
  tipo: 'admin',
  role: 'admin',
  is_super_admin: false,
  empresa_id: 'emp-1',
  empresas: { id: 'emp-1', nome: 'Transportadora MATOPIBA Integrada', tipo: 'transportadora' },
  status: 'ativo',
  termos_pendentes: false,
  senha_temporaria: false,
  permission_template: 'administrador',
  effective_permissions: {
    'fleet.view': true,
    'fleet.manage': true,
    'campaign.view': true,
    'campaign.manage': true,
    'partner_network.view': true,
    'partner_network.manage': true,
    'reports.operational.view': true,
    'reports.financial.view': true,
    'freight.view': true,
    'drivers.view': true,
    'drivers.manage': true,
    'users.view': true,
    'users.manage': true,
    'permissions.manage': true,
    'company.settings.view': true,
    'company.settings.manage': true,
    'finance.saas.view': true,
    'shipper_portal.requests.review': true,
  },
};

const MOTORISTAS = [
  {
    uid: 'driver-1',
    id: 'driver-1',
    nome: 'Ana Carolina Motorista de Nome Operacional Longo',
    email: 'ana.motorista@transportadora.example',
    placa: 'ABC1D23',
    telefone: '(77) 99999-0001',
    cpf: '000.000.000-01',
    status: 'ativo',
    statusCadastro: 'aprovado',
    status_cadastro: 'aprovado',
    valorComissao: 12,
    usuarios: { nome: 'Ana Carolina Motorista de Nome Operacional Longo', email: 'ana.motorista@transportadora.example' },
  },
  {
    uid: 'driver-2',
    id: 'driver-2',
    nome: 'Bruno Operador de Safra com Sobrenome Grande',
    email: 'bruno.motorista@transportadora.example',
    placa: 'XYZ9K88',
    telefone: '(77) 99999-0002',
    cpf: '000.000.000-02',
    status: 'ativo',
    statusCadastro: 'pendente',
    status_cadastro: 'pendente',
    valorComissao: 10,
    usuarios: { nome: 'Bruno Operador de Safra com Sobrenome Grande', email: 'bruno.motorista@transportadora.example' },
  },
];

const EMPRESAS = [
  { id: 'emp-1', nome: 'Transportadora MATOPIBA Integrada', razao_social: 'Transportadora MATOPIBA Integrada Ltda', cnpj: '00.000.000/0001-00', tipo: 'transportadora', status: 'ativo', plano: 'Enterprise Safra' },
];

const FRETES = [
  {
    id: 'frete-1',
    motorista_id: 'driver-1',
    descricao: 'Soja Fazenda Primavera Exportacao Agricola para Porto de Santos',
    origem: 'Fazenda Primavera Exportacao Agricola',
    destino: 'Porto de Santos - Terminal Integrado',
    valor: 6800,
    data: '2026-10-07',
    status: 'ativo',
    km_inicial: 12000,
    km_final: null,
  },
  {
    id: 'frete-2',
    motorista_id: 'driver-2',
    descricao: 'Milho Oeste da Bahia para Armazem Central',
    origem: 'Luis Eduardo Magalhaes',
    destino: 'Balsas',
    valor: 4300,
    data: '2026-10-06',
    status: 'pendente',
    km_inicial: null,
    km_final: null,
  },
];

const EMPTY_FLEET_OVERVIEW = {
  summary: {
    assets_total: 0,
    assets_active: 0,
    assets_available: 0,
    compositions_active: 0,
    tires_installed: 0,
    tires_stock: 0,
    maintenance_open: 0,
    documents_attention: 0,
    active_freight_assignments: 0,
  },
  attention: [],
  assets: [],
  compositions: [],
  tires: [],
  maintenance: [],
  documents: [],
  driver_assignments: [],
  freight_assignments: [],
  odometer_events: [],
};

const FLEET_OVERVIEW = {
  summary: {
    assets_total: 2,
    assets_active: 2,
    assets_available: 1,
    compositions_active: 1,
    tires_installed: 4,
    tires_stock: 2,
    maintenance_open: 1,
    documents_attention: 1,
    active_freight_assignments: 1,
  },
  attention: [{ code: 'maintenance_open', label: 'Manutencoes abertas ou agendadas', count: 1 }],
  assets: [
    { id: 'asset-1', asset_type: 'tractor', internal_identifier: 'CAV-01', plate: 'ABC1D23', brand: 'Volvo', model: 'FH', status: 'active' },
    { id: 'asset-2', asset_type: 'trailer', internal_identifier: 'SR-99', plate: 'QWE4R56', brand: 'Randon', model: 'Graneleiro', status: 'active' },
  ],
  compositions: [{ id: 'comp-1', code: 'COMP-01', name: 'Bitrem graos corredor norte', status: 'active', vehicle_composition_members: [{ id: 'm1', asset_id: 'asset-1', member_role: 'primary_power' }] }],
  tires: [{ id: 'tire-1', fire_number: 'PN-001', brand: 'Michelin', model: 'X', size: '295', status: 'installed', current_asset_id: 'asset-1' }],
  maintenance: [{ id: 'mnt-1', asset_id: 'asset-1', maintenance_type: 'preventive', category: 'oil', status: 'open', supplier: 'Oficina Central', notes: 'Troca programada antes da safra' }],
  documents: [{ id: 'doc-1', asset_id: 'asset-1', document_type: 'CRLV', storage_path: 'doc.pdf', status: 'active', expires_at: '2026-11-01' }],
  driver_assignments: [{ id: 'drv-1', driver_id: 'driver-1', composition_id: 'comp-1' }],
  freight_assignments: [],
  odometer_events: [],
};

const CAMPAIGN = {
  id: 'campaign-1',
  reference_code: 'CAMP-S3',
  name: 'Safra Graos Corredor Norte',
  cargo_name: 'Soja',
  status: 'APPROVED',
  planning_status: 'APPROVED',
  created_at: '2026-10-07T12:00:00Z',
};

const PLAN = {
  plan: { id: 'plan-1', version_number: 2, status: 'APPROVED', result_summary: { planned_trips: 3 } },
  planned_trips: [
    { id: 'trip-1', planned_quantity: 20, quantity_unit: 'ton', required_capacity_kg: 20000, status: 'PLANNED', candidate_asset_id: 'asset-1' },
  ],
  exceptions: [],
};

const PROGRESS = {
  approved_plan: { id: 'plan-1', version_number: 2 },
  progress: {
    trips: { planned_total: 3, not_materialized: 1, materialized: 2, in_execution: 1, completed: 1, cancelled: 0, blocked: 1, unknown: 0 },
    quantity: {
      unit: 'ton',
      target: 90,
      planned: 90,
      materialized: 60,
      completed: 30,
      cancelled: 0,
      remaining: 60,
      coverage: { quantity_source: 'planned', measured_actual_available: true, trips_with_quantity: 3, trips_total: 3, incompatible_units: false },
    },
  },
  trips_detail: [
    { planned_trip_id: 'trip-1', origem: 'Fazenda Primavera', destino: 'Porto de Santos', planned_quantity: 30, quantity_unit: 'ton', materialization: 'MATERIALIZED', frete_id: 'frete-1', execution_status: 'em_viagem', execution_bucket: 'IN_EXECUTION', readiness: 'ALREADY_EXECUTING', attention: [] },
    { planned_trip_id: 'trip-2', origem: 'Fazenda Bela Vista', destino: 'Porto de Santos', planned_quantity: 30, quantity_unit: 'ton', materialization: 'NOT_MATERIALIZED', frete_id: null, execution_status: null, execution_bucket: null, readiness: 'BLOCKED', attention: ['sem candidato elegivel'] },
  ],
  readiness: { total_operational_needs: 2, ready_direct: 1, ready_offer: 1, blocked: 1, already_assigned: 1, executing: 1, completed: 1 },
  health: { state: 'CRITICAL', reason_code: 'BLOCKED_TRIPS', reason_text: 'Ha viagens bloqueadas que precisam de atencao.' },
  exceptions: [],
  replan: { status: 'REPLAN_RECOMMENDED', reason_code: 'PACE_BEHIND', suggested_next_step: 'Considere gerar um novo plano para cobrir a demanda restante.', remaining_quantity: 60, quantity_unit: 'ton' },
  window: { state: 'IN_WINDOW', planned_start: '2026-10-01', planned_end: '2026-10-31' },
  updated_at: '2026-10-07T12:00:00Z',
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function instalarApiFake(page: Page, options: { fleetMode?: 'full' | 'empty' | 'error'; freightMode?: 'full' | 'empty' | 'error' } = {}) {
  const violacoes: string[] = [];
  const writes: string[] = [];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      violacoes.push(`${method} ${url.href}`);
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();

    const p = url.pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !p.endsWith('/auth/logout') && !p.endsWith('/auth/refresh') && !p.endsWith('/route-intelligence/estimate')) {
      writes.push(`${method} ${p}`);
      return json(route, { message: 'write bloqueado pelo pack S3' }, 405);
    }

    if (p.endsWith('/auth/me')) return json(route, ADMIN_S3);
    if (p.endsWith('/auth/logout') || p.endsWith('/auth/refresh')) return json(route, {});
    if (p.endsWith('/configuracoes') || p.endsWith('/configuracoes/public') || p.endsWith('/configuracoes/empresa')) return json(route, {});
    if (p.includes('/configuracoes/portal-governanca') || p.includes('/portal/governanca') || p.includes('/governanca')) {
      return json(route, { entitlements: { estrutura_operacional: { codigo: 'estrutura_operacional', permitido: true, disponibilidade_comercial: 'incluida' } } });
    }
    if (p.endsWith('/notificacoes') || p.includes('/notificacoes')) return json(route, []);
    if (p.includes('/painel-admin/empresas')) return json(route, EMPRESAS);
    if (p.endsWith('/admin/motoristas')) return json(route, MOTORISTAS);
    if (p.endsWith('/admin/plano-uso')) return json(route, { limite: 50, totalAtual: MOTORISTAS.length, planoAtual: 'Enterprise Safra', ilimitado: false });
    if (p.endsWith('/admin/usuarios')) {
      return json(route, [
        { id: 'u-1', uid: 'u-1', nome: 'Operadora Interna de Nome Longo', email: 'operadora@transportadora.example', tipo: 'admin', empresa_id: 'emp-1', empresaNome: 'Transportadora MATOPIBA Integrada', status: 'ativo', permission_template_id: 'tpl-op', perfilAcessoNome: 'Operador' },
      ]);
    }
    if (p.endsWith('/admin/perfis-acesso')) {
      return json(route, { itens: [{ id: 'tpl-op', stable_key: 'operador', nome: 'Operador', resumo: ['Operacao diaria'], editavel: true }] });
    }
    if (p.endsWith('/admin/permissions/templates')) {
      return json(route, { templates: [{ id: 'tpl-op', stable_key: 'operador', display_name: 'Operador', editable: true, permissions: { 'drivers.view': true }, user_count: 1 }] });
    }
    if (p.endsWith('/rede-parceiros/parceiros')) {
      return json(route, { itens: [{ id: 'partner-1', nome: 'Parceiro Logistico Regional', email: 'parceiro@example.test', documento: '11.111.111/0001-11', status: 'ativo', created_at: '2026-10-01T12:00:00Z' }] });
    }

    if (p.endsWith('/fretes')) {
      if (options.freightMode === 'error') return json(route, { message: 'falha fixture fretes' }, 500);
      return json(route, options.freightMode === 'empty' ? [] : FRETES);
    }
    if (p.includes('/fretes?') || p.endsWith('/despesas') || p.endsWith('/abastecimentos') || p.endsWith('/vales')) {
      return json(route, []);
    }
    if (p.includes('/fretes/') && p.endsWith('/documentos')) return json(route, []);

    if (p.endsWith('/fleet/overview')) {
      if (options.fleetMode === 'error') return json(route, { message: 'falha fixture frota' }, 500);
      return json(route, options.fleetMode === 'empty' ? EMPTY_FLEET_OVERVIEW : FLEET_OVERVIEW);
    }

    if (p.endsWith('/operation-campaigns')) return json(route, { itens: [CAMPAIGN] });
    if (p.endsWith('/operation-campaigns/context')) return json(route, { unidades: [{ id: 'un-1', nome: 'Unidade Balsas', codigo: 'BAL' }] });
    if (p.endsWith('/operation-campaigns/campaign-1/orchestration')) {
      return json(route, {
        next_action: 'REPLAN_RECOMMENDED',
        next_action_reason_text: 'Frete cancelado com demanda restante.',
        objective: { cargo_name: 'Soja', target_quantity: 90, quantity_unit: 'ton', origins: ['Fazenda Primavera'], destination: 'Porto de Santos' },
        route_context: [],
        plan_summary: { plan: PLAN.plan, exceptions_open: 0 },
      });
    }
    if (p.endsWith('/operation-campaigns/campaign-1/plans/plan-1')) return json(route, PLAN);
    if (p.endsWith('/operation-campaigns/campaign-1/progress')) return json(route, PROGRESS);
    if (p.endsWith('/operation-campaigns/campaign-1/plans/plan-1/trips/trip-2/eligibility')) {
      return json(route, {
        summary: { total_candidates: 2, eligible: 1, eligible_with_warnings: 1, ineligible: 0, has_any_eligible: true },
        candidates: [
          { driver_id: 'driver-1', asset_id: 'asset-1', composition_id: null, eligibility: 'ELIGIBLE', reasons: [], warnings: [], capacity_match: 'OK', documents_status: 'OK', maintenance_status: 'OK', assignment_status: 'FREE', route_compatibility: 'UNKNOWN', capacity_kg: 12000 },
          { driver_id: 'driver-2', asset_id: null, composition_id: 'comp-1', eligibility: 'ELIGIBLE_WITH_WARNINGS', reasons: [], warnings: ['documento vence em breve'], capacity_match: 'OK', documents_status: 'ATTENTION', maintenance_status: 'OK', assignment_status: 'FREE', route_compatibility: 'UNKNOWN', capacity_kg: 8000 },
        ],
        truncated: false,
      });
    }

    if (p.endsWith('/route-intelligence/estimate')) {
      return json(route, {
        ok: true,
        origin: 'Fazenda Primavera',
        destination: 'Porto de Santos',
        route_source: 'UNAVAILABLE',
        availability: 'UNAVAILABLE',
        distance_km: null,
        duration_minutes: null,
        tolls_amount: null,
        truck_restrictions_status: 'UNAVAILABLE',
        fuel: { status: 'UNAVAILABLE', liters: null, cost: null },
        cost: { fuel_cost: null, tolls_cost: null, estimated_route_cost: null, partial: true },
        warnings: ['Provedor externo bloqueado no pack visual S3.'],
      });
    }

    if (p.includes('/operacional/contexto')) return json(route, { scope: { mode: 'CONFIGURED', rollout_mode: 'configured' } });
    if (p.includes('/operacional/unidades')) return json(route, [{ id: 'un-1', nome: 'Unidade Operacional Balsas', codigo: 'BAL', cidade: 'Balsas', uf: 'MA', status: 'ativo', is_default: true }]);
    if (p.includes('/operacional/regioes')) return json(route, [{ id: 'reg-1', nome: 'Regiao Oeste Bahia e Sul Piaui', codigo: 'MATOPIBA-SUL', status: 'ativo' }]);
    if (p.includes('/operacional/memberships')) return json(route, [{ id: 'mem-1', usuario_id: 'u-1', scope_level: 'LOCAL', unidade_operacional_id: 'un-1', status: 'ativo', papel: 'operador' }]);
    if (p.includes('/operacional/grupos')) return json(route, []);

    return json(route, {});
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'token-s3-visual');
  });

  return {
    assertSemRedeExterna() {
      if (violacoes.length > 0) {
        throw new Error(`EXTERNAL_NETWORK_VIOLATIONS=${violacoes.length}: ${violacoes.join(' | ')}`);
      }
    },
    assertSemWritesBloqueados() {
      if (writes.length > 0) {
        throw new Error(`UNEXPECTED_BUSINESS_WRITES=${writes.length}: ${writes.join(' | ')}`);
      }
    },
  };
}

async function navegar(page: Page, rota: string, heading: RegExp) {
  await page.goto(rota, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav a', { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 90),
          className: String(el.className || '').slice(0, 160),
          position: style.position,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((el) => el.right > doc.clientWidth + 1 || el.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8);
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflow: doc.scrollWidth > doc.clientWidth + 1,
      activeNav: document.querySelectorAll('nav a.bg-green-700').length,
      offenders,
      firstFoldHeight: window.innerHeight,
    };
  });
}

test.describe('S3 visual audit — superficies operacionais', () => {
  for (const vp of VIEWPORTS) {
    for (const caso of ROTAS_S3) {
      test(`${vp.nome} ${vp.width}x${vp.height} — ${caso.nome} — ${caso.rota}`, async ({ page }) => {
        const rede = await instalarApiFake(page);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await navegar(page, caso.rota, caso.heading);
        const medida = await medir(page);
        await test.info().attach('s3-measurement', {
          body: JSON.stringify({ viewport: vp, route: caso, medida }, null, 2),
          contentType: 'application/json',
        });
        expect(
          medida.scrollWidth,
          `${caso.rota} overflow global (${medida.scrollWidth} > ${medida.clientWidth}) offenders=${JSON.stringify(medida.offenders)}`,
        ).toBeLessThanOrEqual(medida.clientWidth + 1);
        if (caso.activeNav !== undefined) {
          expect(medida.activeNav, `${caso.rota} deve ter ${caso.activeNav} nav ativo`).toBe(caso.activeNav);
        }
        rede.assertSemRedeExterna();
        rede.assertSemWritesBloqueados();
      });
    }
  }
});

test.describe('S3 visual audit — estados e subfluxos', () => {
  test('Frota cobre estado vazio sem overflow e sem escrita', async ({ page }) => {
    const rede = await instalarApiFake(page, { fleetMode: 'empty' });
    await page.setViewportSize({ width: 390, height: 844 });
    await navegar(page, '/frota', /frota/i);
    await expect(page.getByText(/cadastre o primeiro ativo/i)).toBeVisible();
    const medida = await medir(page);
    expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth + 1);
    rede.assertSemRedeExterna();
    rede.assertSemWritesBloqueados();
  });

  test('Frota cobre erro recuperavel sem overflow', async ({ page }) => {
    const rede = await instalarApiFake(page, { fleetMode: 'error' });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/frota', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/falha fixture frota|nao foi possivel|não foi possível/i)).toBeVisible({ timeout: 20_000 });
    const medida = await medir(page);
    expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth + 1);
    rede.assertSemRedeExterna();
    rede.assertSemWritesBloqueados();
  });

  test('Route Intelligence usa fallback local quando provedor externo esta indisponivel', async ({ page }) => {
    const rede = await instalarApiFake(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await navegar(page, '/rota', /rota inteligente/i);
    await page.getByLabel('Origem').fill('Fazenda Primavera');
    await page.getByLabel('Destino').fill('Porto de Santos');
    await page.getByRole('button', { name: /estimar rota/i }).click();
    await expect(page.getByText(/nao esta habilitado|não está habilitado|indisponivel|indisponível/i).first()).toBeVisible();
    const medida = await medir(page);
    expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth + 1);
    rede.assertSemRedeExterna();
    rede.assertSemWritesBloqueados();
  });

  test('Campanhas cobre execucao e painel de dispatch sem write real', async ({ page }) => {
    const rede = await instalarApiFake(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navegar(page, '/campanhas-escoamento', /campanhas de escoamento/i);
    await expect(page.getByRole('region', { name: /execução da campanha/i })).toBeVisible();
    await page.getByRole('button', { name: /despachar/i }).click();
    await expect(page.getByText(/elegivel|elegível/i).first()).toBeVisible({ timeout: 20_000 });
    const medida = await medir(page);
    expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth + 1);
    rede.assertSemRedeExterna();
    rede.assertSemWritesBloqueados();
  });

  test('UX_FORM_001 permanece modal em Motoristas, Usuarios e Rede de Parceiros', async ({ page }) => {
    const rede = await instalarApiFake(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await navegar(page, '/motoristas', /motoristas/i);
    await page.getByRole('button', { name: /novo motorista|adicionar motorista|cadastrar motorista/i }).click();
    await expect(page.locator('.fixed.inset-0').filter({ hasText: /motorista/i }).first()).toBeVisible();
    await page.keyboard.press('Escape').catch(() => undefined);

    await navegar(page, '/admins', /usuarios|usuários/i);
    await page.getByRole('button', { name: /novo usuario|novo usuário|adicionar usuario|adicionar usuário/i }).click();
    await expect(page.locator('.fixed.inset-0').filter({ hasText: /usuario|usuário/i }).first()).toBeVisible();
    await page.keyboard.press('Escape').catch(() => undefined);

    await navegar(page, '/rede-parceiros', /rede de parceiros/i);
    await page.getByRole('button', { name: /novo parceiro|convidar parceiro|adicionar parceiro/i }).click();
    await expect(page.locator('.fixed.inset-0').filter({ hasText: /parceiro/i }).first()).toBeVisible();

    const medida = await medir(page);
    expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth + 1);
    rede.assertSemRedeExterna();
    rede.assertSemWritesBloqueados();
  });
});
