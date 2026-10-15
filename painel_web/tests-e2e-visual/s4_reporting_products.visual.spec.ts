import { test, expect, type Page, type Locator } from '@playwright/test';
import { CENARIOS, VIEWPORTS, instalarApiFake, json } from './fixtures';

const CENARIO_PADRAO = CENARIOS.find((c) => c.nome === 'plano-ativo-contrato-pendente')!;

const MOTORISTAS_MOCK = [
  { id: 'mot-1', nome: 'João da Silva', telefone: '11999999999', status: 'ativo', placa: 'BRA2E19', comissao: 12, empresaTipo: 'vinculado' },
];

const FRETES_MOCK = [
  {
    id: 'frete-formal-1',
    motorista_id: 'mot-1',
    motoristas: { nome: 'João da Silva' },
    origem: 'Balsas - MA',
    destino: 'Itaqui - MA',
    valor_frete: 12500,
    km_inicial: 1000,
    km_final: 1750,
    modalidade_calculo: 'valor_fixo',
    status: 'finalizado',
    placa: 'BRA2E19',
    data: '2026-03-10',
  },
  {
    id: 'frete-legado-2',
    motorista_id: 'mot-1',
    motoristas: { nome: 'João da Silva' },
    origem: 'Uruçuí - PI',
    destino: 'Santos - SP',
    valor_frete: 18000,
    km_inicial: 2000,
    km_final: 4200,
    modalidade_calculo: 'valor_fixo',
    status: 'finalizado',
    placa: 'XYZ9876',
    data: '2026-02-15',
  },
  {
    id: 'frete-erro-3',
    motorista_id: 'mot-1',
    motoristas: { nome: 'João da Silva' },
    origem: 'Balsas - MA',
    destino: 'Caxias - MA',
    valor_frete: 5000,
    km_inicial: 5000,
    km_final: 5400,
    modalidade_calculo: 'valor_fixo',
    status: 'finalizado',
    placa: 'BRA2E19',
    data: '2026-01-20',
  },
];

const ENVELOPE_FORMAL_MOCK = {
  status: 'FORMAL_ENVELOPE_SEALED',
  envelope: {
    id: 'env-formal-1',
    frete_id: 'frete-formal-1',
    envelope_id: 'env-formal-1',
    sealed_at: '2026-03-10T18:00:00Z',
    envelope_hash: 'abc123canonicalhash789xyz456',
    audit_summary: { total_despesas_aprovadas: 200 },
  },
  motorista_nome: 'João da Silva',
  placa: 'BRA2E19',
};

const ENVELOPE_LEGADO_MOCK = {
  status: 'LEGACY_NO_FORMAL_ENVELOPE',
  envelope: null,
};

const RELATORIO_FECHAMENTO_LEGADO_MOCK = {
  frete: {
    id: 'frete-legado-2',
    empresa_id: 'emp-1',
    motorista_id: 'mot-1',
    origem: 'Uruçuí - PI',
    destino: 'Santos - SP',
    data: '2026-02-15',
    km_inicial: 2000,
    km_final: 4200,
    distancia_km: 2200,
    modalidade_calculo: 'valor_fixo',
    valor_frete: 18000,
    status: 'finalizado',
  },
  motorista: {
    id: 'mot-1',
    nome: 'João da Silva',
    placa: 'XYZ9876',
    tipo_empresa: 'vinculado',
  },
  lancamentos: { despesas: [], abastecimentos: [], vales: [] },
  documentos_fiscais: { total: 0, tipos: [] },
  envelope: {
    status: 'LEGACY_NO_FORMAL_ENVELOPE',
  },
  resumo_financeiro: {
    frete_bruto: 18000,
    resultado_operacional: 14000,
    comissao_percentual: 12,
    comissao_valor: 2160,
    saldo_motorista: 2160,
    is_autonomo: false,
  },
  gerado_em: '2026-02-15T10:00:00Z',
};

const RELATORIO_FECHAMENTO_FORMAL_MOCK = {
  frete: {
    id: 'frete-formal-1',
    empresa_id: 'emp-1',
    motorista_id: 'mot-1',
    origem: 'Balsas - MA',
    destino: 'Itaqui - MA',
    data: '2026-03-10',
    km_inicial: 1000,
    km_final: 1750,
    distancia_km: 750,
    modalidade_calculo: 'valor_fixo',
    valor_frete: 12500,
    toneladas: 48.5,
    valor_tonelada_km: null,
    status: 'finalizado',
    quem_recebeu: 'Porto de Itaqui',
    foto_odometro_inicial_presente: true,
    foto_odometro_final_presente: true,
  },
  motorista: {
    id: 'mot-1',
    nome: 'João da Silva',
    placa: 'BRA2E19',
    tipo_empresa: 'vinculado',
  },
  lancamentos: {
    despesas: [
      { id: 'desp-1', descricao: 'Pedágio BR-135', tipo: 'pedagio', valor: 250, status: 'aprovado', quem_pagou: 'empresa' },
      { id: 'desp-2', descricao: 'Alimentação', tipo: 'refeicao', valor: 150, status: 'aprovado', quem_pagou: 'motorista' },
    ],
    abastecimentos: [
      { id: 'abast-1', posto: 'Posto Rota do Sol', litros: 250, arla_litros: 20, arla_valor: 80, valor_total: 800, status: 'aprovado', quem_pagou: 'empresa' },
    ],
    vales: [],
  },
  documentos_fiscais: {
    total: 2,
    tipos: [
      { tipo: 'cte', status: 'autorizado' },
      { tipo: 'mdfe', status: 'autorizado' },
    ],
  },
  epod: {
    id: 'epod-1',
    status: 'ENTREGUE',
    entregue_em: '2026-03-10T15:00:00Z',
    recebedor_nome: 'Carlos Mendes',
  },
  envelope: {
    status: 'FORMAL_ENVELOPE_SEALED',
    detalhes: {
      id: 'env-formal-1',
      envelope_type: 'formal_freight_closure',
      schema_version: '1.0.0',
      sealed_at: '2026-03-10T15:00:00Z',
      envelope_hash: 'abc123canonicalhash789xyz456',
      reason: 'Encerramento regular de frete e consolidação probatória E3.8',
    },
  },
  resumo_financeiro: {
    receita_realizada: 12500,
    frete_bruto: 12500,
    resultado_operacional: 9800,
    margem_percentual: 78.4,
    custos_diretos: {
      combustivel: 800,
      pedagio: 250,
      outras_despesas: 150,
      comissao: 1500,
      total: 2700,
    },
    total_despesas_efetivadas: 400,
    total_abastecimentos_efetivados: 800,
    total_vales_efetivados: 0,
    comissao_percentual: 12,
    comissao_valor: 1500,
    saldo_motorista: 1650,
    saldo_motorista_situacao: 'credito_motorista',
    motorista_creditos: 1650,
    motorista_debitos: 0,
    total_pendente: 0,
    tem_pendentes: false,
    is_autonomo: false,
    alertas: [],
    dados_completos: true,
  },
  gerado_em: '2026-03-10T15:00:00Z',
};


async function assertElementHorizontalFit(locator: Locator, maxViewportWidth: number) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, 'Element bounding box should exist').not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(maxViewportWidth + 1);
}

test.describe('Reporting Products V1 — Verificação Visual, Responsiva e Superfície de Ações', () => {
  for (const vp of VIEWPORTS) {
    test(`Superfície completa de relatórios em ${vp.nome} (${vp.width}x${vp.height})`, async ({ page }) => {
      let resolverRelatorio: (() => void) | null = null;
      const promessaRelatorio = new Promise<void>((res) => {
        resolverRelatorio = res;
      });

      const interceptadorReporting = async (route: any, url: URL): Promise<boolean> => {
        const p = url.pathname;
        if (p.endsWith('/admin/motoristas')) {
          json(route, MOTORISTAS_MOCK);
          return true;
        }
        if (p.endsWith('/fretes') && url.searchParams.get('motorista_id') === 'mot-1') {
          json(route, FRETES_MOCK);
          return true;
        }
        if (p.endsWith('/despesas') || p.endsWith('/abastecimentos') || p.endsWith('/vales')) {
          json(route, []);
          return true;
        }
        if (p.includes('/fretes/frete-formal-1/documentos') || p.includes('/fretes/frete-legado-2/documentos') || p.includes('/fretes/frete-erro-3/documentos')) {
          json(route, []);
          return true;
        }
        if (p.endsWith('/fretes/frete-formal-1/envelope-digital')) {
          json(route, ENVELOPE_FORMAL_MOCK);
          return true;
        }
        if (p.endsWith('/fretes/frete-legado-2/envelope-digital') || p.endsWith('/fretes/frete-erro-3/envelope-digital')) {
          json(route, ENVELOPE_LEGADO_MOCK);
          return true;
        }
        if (p.endsWith('/fretes/frete-formal-1/relatorio-fechamento')) {
          await promessaRelatorio;
          json(route, RELATORIO_FECHAMENTO_FORMAL_MOCK);
          return true;
        }
        if (p.endsWith('/fretes/frete-legado-2/relatorio-fechamento')) {
          json(route, RELATORIO_FECHAMENTO_LEGADO_MOCK);
          return true;
        }
        if (p.endsWith('/fretes/frete-erro-3/relatorio-fechamento')) {
          json(route, { error: 'Falha simulada no backend para teste de erro em tela' }, 500);
          return true;
        }
        return false;
      };

      const rede = await instalarApiFake(page, CENARIO_PADRAO, {
        interceptadores: [interceptadorReporting],
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/relatorios/viagens?motorista=mot-1&frete=frete-formal-1,frete-legado-2,frete-erro-3', {
        waitUntil: 'domcontentloaded',
      });

      // Selected driver banner: NO undefined%, null%, NaN%, truthful plate and commission
      const driverBanner = page.locator('#selected-motorista-banner');
      await expect(driverBanner).toBeVisible({ timeout: 15_000 });
      await expect(driverBanner).toContainText('João da Silva');
      await expect(driverBanner).toContainText('Placa: BRA2E19');
      await expect(driverBanner).toContainText('Comissão: 12%');

      const bodyHtml = await page.content();
      expect(bodyHtml, 'NO_VISIBLE_UNDEFINED=true').not.toContain('undefined%');
      expect(bodyHtml).not.toContain('null%');
      expect(bodyHtml).not.toContain('NaN%');

      // 1. Finalized freight rows/accordions rendered
      const freteFormal = page.locator('#frete-frete-formal-1');
      const freteLegado = page.locator('#frete-frete-legado-2');
      const freteErro = page.locator('#frete-frete-erro-3');
      await expect(freteFormal).toBeVisible({ timeout: 15_000 });
      await expect(freteLegado).toBeVisible({ timeout: 15_000 });
      await expect(freteErro).toBeVisible({ timeout: 15_000 });

      // 2 & 3. Envelope Digital and Relatório de Fechamento buttons visible on fretes
      const btnEnvFormal = page.locator('#btn-envelope-digital-frete-formal-1');
      const btnFechamentoFormal = page.locator('#btn-relatorio-fechamento-frete-formal-1');
      const btnEnvLegado = page.locator('#btn-envelope-digital-frete-legado-2');
      const btnFechamentoLegado = page.locator('#btn-relatorio-fechamento-frete-legado-2');
      const btnFechamentoErro = page.locator('#btn-relatorio-fechamento-frete-erro-3');

      await expect(btnEnvFormal).toBeVisible();
      await expect(btnFechamentoFormal).toBeVisible();
      await expect(btnEnvLegado).toBeVisible();
      await expect(btnFechamentoLegado).toBeVisible();
      await expect(btnFechamentoErro).toBeVisible();

      // 4. Buttons remain inside viewport bounding box
      await assertElementHorizontalFit(btnEnvFormal, vp.width);
      await assertElementHorizontalFit(btnFechamentoFormal, vp.width);
      await assertElementHorizontalFit(btnEnvLegado, vp.width);
      await assertElementHorizontalFit(btnFechamentoLegado, vp.width);
      await assertElementHorizontalFit(btnFechamentoErro, vp.width);

      // 5. Formal envelope state is verified
      await expect(page.locator('#frete-frete-formal-1')).toContainText('Selo Formal E3.8 Ativo');

      // REGRESSION ASSERTION (DEFECT 1): ACCORDION STATE PERSISTENCE
      // A. Deep-linked fretes initialize open (btnEnvFormal is visible)
      // B. Manually close freight formal 1
      const btnExpandirFormal = page.locator('#btn-expandir-frete-frete-formal-1');
      await btnExpandirFormal.click();
      await expect(btnEnvFormal).toBeHidden();

      // C. Wait through async freight / envelope / documents updates
      await page.waitForTimeout(600);
      // USER_ACCORDION_CLOSE_PERSISTS=true: Freight remains CLOSED
      await expect(btnEnvFormal).toBeHidden();

      // D. Manually reopen freight formal 1
      await btnExpandirFormal.click();
      await expect(btnEnvFormal).toBeVisible();

      // E. Wait through another async refresh
      await page.waitForTimeout(600);
      // USER_ACCORDION_REOPEN_PERSISTS=true: Freight remains OPEN
      await expect(btnEnvFormal).toBeVisible();

      // REGRESSION ASSERTION: USER_SCROLL_PERSISTS_AFTER_INITIAL_DEEPLINK_FOCUS=true
      const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      if (maxScroll > 20) {
        const targetScroll = Math.min(250, maxScroll);
        await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), targetScroll);
        const scrollPosInicial = await page.evaluate(() => window.scrollY);
        expect(scrollPosInicial).toBeGreaterThan(0);

        await page.waitForTimeout(600);
        const scrollPosAposEspera = await page.evaluate(() => window.scrollY);
        expect(
          Math.abs(scrollPosAposEspera - scrollPosInicial),
          `USER_SCROLL_PERSISTS_AFTER_INITIAL_DEEPLINK_FOCUS=true em ${vp.nome}`
        ).toBeLessThanOrEqual(15);
      }

      // 7. Loading / disabled state for formal report action (FORMAL_REPORT_FULL_INTERNAL=true)
      await btnFechamentoFormal.click();
      await expect(btnFechamentoFormal).toBeDisabled();
      await expect(btnFechamentoFormal).toContainText('Gerando...');
      resolverRelatorio!();
      await expect(btnFechamentoFormal).toBeEnabled({ timeout: 10_000 });

      // 6. LEGACY_NO_FORMAL_ENVELOPE state & modal dialog (LEGACY_ENVELOPE_MODAL=true)
      await expect(page.locator('#frete-frete-legado-2')).toContainText('Legado (sem envelope formal)');
      await btnEnvLegado.click();

      const modalAviso = page.locator('#modal-aviso-envelope');
      await expect(modalAviso).toBeVisible();
      await expect(modalAviso).toContainText('Envelope Digital Indisponível (Frete Legado)');
      await expect(modalAviso).toContainText('política de governança, envelopes formais não são fabricados retroativamente');

      // Modal horizontal overflow check
      const modalDialog = page.locator('#modal-aviso-envelope > div');
      await assertElementHorizontalFit(modalDialog, vp.width);
      const btnFecharAviso = page.locator('#btn-fechar-aviso-envelope');
      const btnAltFechamento = page.locator('#btn-alternativa-fechamento');
      await expect(btnFecharAviso).toBeVisible();
      await expect(btnAltFechamento).toBeVisible();
      await assertElementHorizontalFit(btnFecharAviso, vp.width);
      await assertElementHorizontalFit(btnAltFechamento, vp.width);

      // Close legacy modal
      await btnFecharAviso.click();
      await expect(modalAviso).toBeHidden();

      // 8. Legacy operational closure report succeeds (LEGACY_REPORT_SUCCESS=true)
      await btnFechamentoLegado.click();
      await expect(btnFechamentoLegado).toBeEnabled({ timeout: 10_000 });

      // 9. API failure state is user-visible on dedicated error scenario (ERROR_MODAL_SEPARATE_SCENARIO=true)
      await btnFechamentoErro.click();
      const modalErro = page.locator('#modal-erro-reporting');
      await expect(modalErro).toBeVisible();
      await expect(modalErro).toContainText('Erro no Relatório de Fechamento');
      await expect(modalErro).toContainText('Não foi possível gerar o relatório de fechamento deste frete.');

      const modalErroDialog = page.locator('#modal-erro-reporting > div');
      await assertElementHorizontalFit(modalErroDialog, vp.width);
      const btnFecharErro = page.locator('#btn-fechar-erro-reporting');
      await expect(btnFecharErro).toBeVisible();
      await assertElementHorizontalFit(btnFecharErro, vp.width);

      await btnFecharErro.click();
      await expect(modalErro).toBeHidden();

      // Page-level horizontal overflow check
      const medida = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        medida.scrollWidth,
        `/relatorios/viagens em ${vp.nome} rola horizontalmente (${medida.scrollWidth} > ${medida.clientWidth})`,
      ).toBeLessThanOrEqual(medida.clientWidth + 1);

      // 10. External network violations = 0
      rede.assertSemRedeExterna();
    });
  }
});
