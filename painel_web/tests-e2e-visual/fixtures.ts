import type { Page, Route } from '@playwright/test';

// Fixtures de ESTADO COMERCIAL. Cada cenário descreve uma combinação alcançável
// de (trial × plano × contrato) que o produto precisa comunicar de forma coerente.
// Nada aqui chama backend, Asaas ou banco — é tudo resposta interceptada.

export type Cenario = {
  nome: string;
  planoStatus: Record<string, unknown>;
  contratacaoStatus: Record<string, unknown>;
  faturas: unknown[];
};

const USUARIO_ADMIN = {
  id: 'u-admin-1',
  nome: 'Administradora com Nome Bastante Longo Para Testar Truncamento',
  email: 'admin@empresa-com-nome-muito-longo-de-verdade.com.br',
  // `/auth/me` devolve `tipo`; o AuthContext mapeia para `role`. O ProtectedRoute
  // exige `role === 'admin'` para liberar o painel web.
  tipo: 'admin',
  is_super_admin: false,
  empresa_id: 'emp-1',
  empresas: { tipo: 'transportadora', nome: 'Transportadora Exemplo Nome Longo Ltda ME' },
  status: 'ativo',
  termos_pendentes: false,
  senha_temporaria: false,
  effective_permissions: {
    'fleet.view': true,
    'campaign.view': true,
    'partner_network.view': true,
    'reports.operational.view': true,
    'reports.financial.view': true,
    'freight.view': true,
    'drivers.view': true,
    'users.view': true,
    'permissions.manage': true,
    'company.settings.view': true,
    'finance.saas.view': true,
    'shipper_portal.requests.review': true,
  },
  permission_template: 'administrador',
};

export const CENARIOS: Cenario[] = [
  {
    nome: 'trial-ativo-sem-pendencia',
    planoStatus: { status: 'trial', trial_expirado: false, trial_ends_at: '2026-09-20T00:00:00Z' },
    contratacaoStatus: { pendencia_obrigatoria: false, trial_ativo: true, trial_ends_at: '2026-09-20T00:00:00Z', dias_restantes: 19, pode_contratar: true },
    faturas: [],
  },
  {
    nome: 'trial-ativo-contrato-pendente',
    planoStatus: { status: 'trial', trial_expirado: false, trial_ends_at: '2026-09-20T00:00:00Z' },
    contratacaoStatus: { pendencia_obrigatoria: true, trial_ativo: true, assinatura_pendente: true },
    faturas: [],
  },
  {
    nome: 'plano-ativo-contrato-pendente',
    planoStatus: { status: 'ativo', trial_expirado: false },
    contratacaoStatus: { pendencia_obrigatoria: true, assinatura_pendente: true },
    faturas: [],
  },
  {
    nome: 'plano-ativo-contrato-assinado',
    planoStatus: { status: 'ativo', trial_expirado: false },
    contratacaoStatus: { pendencia_obrigatoria: false },
    faturas: [{ id: 'f-1', status: 'pago', valor: 149.9, due_date: '2026-08-01', invoice_url: null }],
  },
  {
    nome: 'plano-suspenso-regularizacao',
    planoStatus: { status: 'suspenso', trial_expirado: false, regularizacao: { suporte_email: 'suporte@matopibalog.com.br' } },
    contratacaoStatus: { pendencia_obrigatoria: false },
    faturas: [{ id: 'f-2', status: 'vencido', valor: 149.9, due_date: '2026-08-01', invoice_url: 'https://exemplo.invalid/fatura' }],
  },
  {
    nome: 'trial-expirado',
    planoStatus: { status: 'trial', trial_expirado: true, trial_ends_at: '2026-08-01T00:00:00Z' },
    contratacaoStatus: { pendencia_obrigatoria: false, trial_expirado: true, pode_contratar: true, pode_declinar: true },
    faturas: [],
  },
  {
    nome: 'sem-faturas',
    planoStatus: { status: 'ativo', trial_expirado: false },
    contratacaoStatus: { pendencia_obrigatoria: false },
    faturas: [],
  },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Intercepta TODA a rede e responde com o cenário.
 *
 * O padrão é um catch-all deliberado, não um casamento por host: o bundle de
 * produção embute `VITE_API_URL`, então uma regra amarrada a um host específico
 * silenciosamente deixa de casar quando esse valor muda — e o pack passa a falar
 * com o backend real em vez de com as fixtures. Aqui, o que não for `localhost`
 * é atendido pela fixture ou abortado; **nenhuma requisição sai da máquina**.
 */
export async function instalarApiFake(page: Page, cenario: Cenario) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());

    // Recursos do próprio preview (HTML, JS, CSS, imagens) seguem normalmente.
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();

    const p = url.pathname;

    if (p.endsWith('/configuracoes/public')) return json(route, {});
    if (p.endsWith('/auth/me')) return json(route, USUARIO_ADMIN);
    if (p.endsWith('/auth/logout') || p.endsWith('/auth/refresh')) return json(route, {});
    if (p.endsWith('/contratacao/status')) return json(route, cenario.contratacaoStatus);
    if (p.endsWith('/contratacao/minha')) return json(route, { contratos: [] });
    if (p.endsWith('/pagamentos/plano-status')) return json(route, cenario.planoStatus);
    if (p.includes('/pagamentos/cobrancas/')) return json(route, cenario.faturas);
    if (p.endsWith('/configuracoes')) return json(route, {});
    if (p.endsWith('/notificacoes') || p.includes('/notificacoes')) return json(route, []);
    if (p.includes('/portal/governanca') || p.includes('/governanca')) {
      return json(route, { entitlements: { estrutura_operacional: { permitido: false } } });
    }
    // Default seguro: 200 vazio. O pack mede layout/navegação, não dados.
    return json(route, Array.isArray(cenario.faturas) ? [] : {});
  });

  // Sessão: o painel envia Bearer quando há token; a API está toda interceptada.
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'token-de-teste-visual');
  });
}

export const VIEWPORTS = [
  { nome: 'desktop', width: 1440, height: 900 },
  { nome: 'tablet', width: 1024, height: 768 },
  { nome: 'mobile', width: 390, height: 844 },
];

export const ROTAS_CLIENTE = [
  '/',
  '/minhas-faturas',
  '/minhas-faturas?aba=contratacao',
  '/relatorios',
  '/relatorios/viagens',
  '/admins',
  '/configuracoes',
];
