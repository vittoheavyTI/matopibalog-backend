import { describe, expect, it } from 'vitest';
import {
  formatarMoeda,
  formatarDataHora,
  formatarData,
  formatarKm,
  formatarToneladas,
  formatarModalidade,
  formatarModalidadeCalculo,
  formatarStatusFrete,
  formatarStatusEnvelope,
  resumirHashIntegridade,
  sanitizarNomeArquivo,
  gerarNomeArquivoEnvelope,
  gerarNomeArquivoFechamento,
} from './reportingFormatters';
import { gerarPdfEnvelopeDigital } from './formalEnvelopePdf';
import { gerarPdfFechamentoFrete, type RelatorioFechamentoPayload } from './freightClosurePdf';

describe('reportingFormatters', () => {
  it('formata moeda BRL com seguranca para nulos e numeros', () => {
    expect(formatarMoeda(1500)).toContain('1.500,00');
    expect(formatarMoeda('2450.50')).toContain('2.450,50');
    expect(formatarMoeda(0)).toContain('0,00');
    expect(formatarMoeda(null)).toBe('-');
    expect(formatarMoeda(undefined)).toBe('-');
    expect(formatarMoeda('invalido')).toBe('-');
  });

  it('formata datas e horas de forma honesta sem timezone drifting', () => {
    expect(formatarData('2026-10-14')).toBe('14/10/2026');
    expect(formatarData(null)).toBe('-');
    expect(formatarDataHora('2026-10-14T10:30:00Z')).toContain('14/10/2026');
    expect(formatarDataHora(null)).toBe('-');
    expect(formatarDataHora('invalido')).toBe('-');
  });

  it('formata quilometragem e tonelagem com unidades corretas', () => {
    expect(formatarKm(1250)).toBe('1.250 km');
    expect(formatarKm('800')).toBe('800 km');
    expect(formatarKm(0)).toBe('0 km');
    expect(formatarKm(null)).toBe('-');
    expect(formatarToneladas(45.5)).toBe('45,50 t');
    expect(formatarToneladas('32')).toBe('32,00 t');
    expect(formatarToneladas(null)).toBe('-');
  });

  it('formata modalidade de calculo e status de forma legivel', () => {
    expect(formatarModalidade('valor_fixo')).toBe('Valor Fixo');
    expect(formatarModalidadeCalculo('tonelada_km')).toBe('Por Tonelada / KM');
    expect(formatarModalidade(null)).toBe('-');

    expect(formatarStatusFrete('ativo')).toBe('Ativo');
    expect(formatarStatusFrete('finalizado')).toBe('Finalizado');
    expect(formatarStatusFrete('cancelado')).toBe('Cancelado');
    expect(formatarStatusFrete('pendente')).toBe('Pendente');

    expect(formatarStatusEnvelope('FORMAL_ENVELOPE_SEALED')).toBe('Envelope Digital Selado (Formal)');
    expect(formatarStatusEnvelope('LEGACY_NO_FORMAL_ENVELOPE')).toBe('Legado (sem envelope formal)');
  });

  it('resume hash criptografico para exibicao em cabecalhos de auditoria', () => {
    const hash = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';
    expect(resumirHashIntegridade(hash, 8)).toBe('a1b2c3d4...cdef0');
    expect(resumirHashIntegridade('curto')).toBe('curto');
    expect(resumirHashIntegridade(null)).toBe('-');
  });

  it('sanitiza e gera nomes de arquivo significativos e seguros', () => {
    expect(sanitizarNomeArquivo('São Desidério / Barreiras')).toBe('Sao_Desiderio_Barreiras');
    const nomeEnv = gerarNomeArquivoEnvelope('12345678-abcd-ef01-2345-6789abcdef01');
    expect(nomeEnv).toMatch(/^envelope-digital-frete-12345678-\d{8}\.pdf$/);
    const nomeFech = gerarNomeArquivoFechamento('12345678-abcd-ef01-2345-6789abcdef01');
    expect(nomeFech).toMatch(/^relatorio-fechamento-frete-12345678-\d{8}\.pdf$/);
  });
});

describe('formalEnvelopePdf', () => {
  it('retorna status de erro quando frete for legado sem envelope formal', async () => {
    const payloadLegado = {
      frete_id: 'frete-legado-1',
      status: 'LEGACY_NO_FORMAL_ENVELOPE',
      envelope: null,
    };

    const result = await gerarPdfEnvelopeDigital(payloadLegado, { autoSave: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Frete legado finalizado');
  });

  it('gera PDF de envelope formal para frete com selo E3.8 ativo', async () => {
    const payloadFormal = {
      status: 'FORMAL_ENVELOPE_SEALED',
      envelope: {
        id: 'env-1',
        frete_id: 'c8f74577-bb89-4b62-9ea1-92e105e4eb01',
        sealed_at: '2026-10-14T09:00:00Z',
        envelope_hash: '3a7bd844f2e96030c6a51d45903b22cf345719918dbb0a2fa5f1bca7f798a63f',
        closure_reason: 'finalizacao_operacional',
        frete_snapshot: {
          origem: 'LEM - Fazenda Primavera',
          destino: 'Porto de Salvador',
          data: '2026-10-10',
          modalidade_calculo: 'valor_fixo',
          valor_frete: 14500,
          km_inicial: 10000,
          km_final: 10980,
          distancia_km: 980,
          toneladas: 48.5,
          placa: 'BRA2E19',
          motorista_nome: 'João da Silva',
        },
        financial_snapshot: {
          valor_frete_bruto: 14500,
          total_despesas: 850,
          total_abastecimentos: 2400,
          total_vales: 1000,
          saldo_final: 10250,
        },
        operational_summary: {
          odometro_status: 'regular',
          documentos_validos: true,
          docs_count: 2,
        },
        audit_summary: {
          e38_rule: 'NO_FINALIZED_WITHOUT_FORMAL_ENVELOPE',
          client_request_id: 'req-e38-1234',
        },
      },
      motorista_nome: 'João da Silva',
      placa: 'BRA2E19',
    };

    const result = await gerarPdfEnvelopeDigital(payloadFormal, { autoSave: false });
    expect(result.ok).toBe(true);
    expect(result.doc).toBeDefined();
    expect(result.filename).toContain('envelope-digital');
  });
});

describe('freightClosurePdf', () => {
  it('gera relatorio operacional de fechamento com lancamentos e regras de comissao', async () => {
    const payloadFechamento: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-op-1',
        empresa_id: 'empresa-1',
        motorista_id: 'mot-1',
        origem: 'Barreiras / BA',
        destino: 'Santos / SP',
        data: '2026-10-12',
        status: 'finalizado',
        modalidade_calculo: 'tonelada_km',
        toneladas: 50,
        valor_tonelada_km: 0.18,
        valor_frete: 13500,
        km_inicial: 50000,
        km_final: 51500,
        distancia_km: 1500,
        quem_recebeu: 'proprietario',
        foto_odometro_inicial_presente: true,
        foto_odometro_final_presente: true,
      },
      motorista: {
        id: 'mot-1',
        nome: 'Carlos Eduardo',
        placa: 'XYZ9876',
        tipo_empresa: 'autonomo',
      },
      lancamentos: {
        despesas: [
          { id: 'desp-1', descricao: 'Pedágio Anhanguera', tipo: 'pedagio', valor: 320, status: 'aprovado', quem_pagou: 'motorista' },
        ],
        abastecimentos: [
          { id: 'abast-1', posto: 'Posto Graal', litros: 300, valor_total: 1800, status: 'aprovado', quem_pagou: 'proprietario' },
        ],
        vales: [
          { id: 'vale-1', descricao: 'Adiantamento alimentação', valor: 500, status: 'aprovado', quem_pagou: 'proprietario' },
        ],
      },
      documentos_fiscais: {
        total: 2,
        tipos: [{ tipo: 'cte', status: 'validado' }],
      },
      epod: {
        id: 'epod-1',
        status: 'aprovado',
        entregue_em: '2026-10-14T08:00:00Z',
        recebedor_nome: 'Recepção Porto',
      },
      envelope: {
        status: 'FORMAL_ENVELOPE_SEALED',
        detalhes: {
          id: 'env-1',
          envelope_type: 'formal_frete_closure',
          schema_version: '1.0',
          sealed_at: '2026-10-14T08:00:00Z',
          envelope_hash: 'abc123def456',
          reason: 'fechamento',
        },
      },
      resumo_financeiro: {
        restricted: false,
        frete_bruto: 13500,
        total_despesas_efetivadas: 320,
        total_abastecimentos_efetivados: 1800,
        total_vales_efetivados: 500,
        comissao_percentual: 12,
        comissao_valor: 1620,
        saldo_motorista: 1440,
        resultado_operacional: 9260,
        is_autonomo: true,
      },
      gerado_em: '2026-10-14T10:00:00Z',
    };

    const result = await gerarPdfFechamentoFrete(payloadFechamento, { autoSave: false });
    expect(result.ok).toBe(true);
    expect(result.doc).toBeDefined();
    expect(result.filename).toContain('relatorio-fechamento');
  });

  it('gera relatorio operacional de fechamento mesmo para frete legado com envelope ausente', async () => {
    const payloadLegado: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-legado-op-2',
        empresa_id: 'empresa-1',
        motorista_id: 'mot-2',
        origem: 'LEM / BA',
        destino: 'Candeias / BA',
        data: '2026-09-01',
        status: 'finalizado',
        modalidade_calculo: 'valor_fixo',
        valor_frete: 8000,
      },
      motorista: {
        id: 'mot-2',
        nome: 'Marcos Vinicius',
        placa: 'ABC1234',
        tipo_empresa: 'vinculado',
      },
      lancamentos: { despesas: [], abastecimentos: [], vales: [] },
      documentos_fiscais: { total: 0, tipos: [] },
      envelope: {
        status: 'LEGACY_NO_FORMAL_ENVELOPE',
      },
      resumo_financeiro: {
        restricted: false,
        frete_bruto: 8000,
        total_despesas_efetivadas: 0,
        total_abastecimentos_efetivados: 0,
        total_vales_efetivados: 0,
        comissao_percentual: 10,
        comissao_valor: 800,
        saldo_motorista: 800,
        resultado_operacional: 7200,
        is_autonomo: false,
      },
      gerado_em: '2026-10-14T10:00:00Z',
    };

    const result = await gerarPdfFechamentoFrete(payloadLegado, { autoSave: false });
    expect(result.ok).toBe(true);
    expect(result.doc).toBeDefined();
  });

function extrairTextoPdf(doc: any): string {
  const pages = doc.internal?.pages || [];
  return pages.map((p: any) => (Array.isArray(p) ? p.join('\n') : String(p))).join('\n');
}

  it('garante que lancamentos pendentes e rejeitados nao sao somados no rodape (rodape consome autoridade backend)', async () => {
    const payload: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-contract-1',
        empresa_id: 'empresa-1',
        motorista_id: 'mot-1',
        origem: 'LEM / BA',
        destino: 'Salvador / BA',
        data: '2026-10-10',
        status: 'finalizado',
      },
      motorista: { id: 'mot-1', nome: 'Motorista Teste', placa: 'ABC1234' },
      lancamentos: {
        despesas: [
          { id: 'd-1', descricao: 'Pedagio Aprovado', tipo: 'pedagio', valor: 100, status: 'aprovado', quem_pagou: 'proprietario' },
          { id: 'd-2', descricao: 'Refeicao Pendente', tipo: 'refeicao', valor: 500, status: 'pendente', quem_pagou: 'motorista' },
          { id: 'd-3', descricao: 'Manutencao Rejeitada', tipo: 'manutencao', valor: 300, status: 'rejeitado', quem_pagou: 'motorista' },
          { id: 'd-4', descricao: 'Multa Cancelada', tipo: 'multa', valor: 400, status: 'cancelado', quem_pagou: 'proprietario' },
        ],
        abastecimentos: [],
        vales: [],
      },
      documentos_fiscais: { total: 0, tipos: [] },
      envelope: { status: 'LEGACY_NO_FORMAL_ENVELOPE' },
      resumo_financeiro: {
        restricted: false,
        total_despesas_efetivadas: 100, // canonical backend authority
      },
    };

    const result = await gerarPdfFechamentoFrete(payload, { autoSave: false });
    expect(result.ok).toBe(true);

    const textoPdf = extrairTextoPdf(result.doc);

    // Must render footer with backend authority total (R$ 100,00)
    expect(textoPdf).toContain('TOTAL DESPESAS EFETIVADAS');
    expect(textoPdf).toContain('100,00');

    // Must NOT recompute client-side sum of all rows (100 + 500 + 300 + 400 = 1300)
    expect(textoPdf).not.toContain('1.300,00');
  });

  it('garante que valores restritos nao reaparecem atraves de recalculacao no PDF', async () => {
    const payload: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-contract-2',
        empresa_id: 'empresa-1',
        motorista_id: 'mot-1',
        origem: 'LEM / BA',
        destino: 'Salvador / BA',
        data: '2026-10-10',
        status: 'finalizado',
        valor_frete: null, // restricted
      },
      motorista: { id: 'mot-1', nome: 'Motorista Teste', placa: 'ABC1234' },
      lancamentos: {
        despesas: [
          { id: 'd-1', descricao: 'Pedagio', tipo: 'pedagio', valor: null, status: 'aprovado', quem_pagou: 'proprietario' },
        ],
        abastecimentos: [],
        vales: [],
      },
      documentos_fiscais: { total: 0, tipos: [] },
      envelope: { status: 'LEGACY_NO_FORMAL_ENVELOPE' },
      resumo_financeiro: {
        restricted: true,
        message: 'Informações financeiras restritas para o seu nível de acesso.',
      },
    };

    const result = await gerarPdfFechamentoFrete(payload, { autoSave: false });
    expect(result.ok).toBe(true);

    const textoPdf = extrairTextoPdf(result.doc);
    expect(textoPdf).toContain('[Restrito]');
    expect(textoPdf).toContain('Informações financeiras restritas');
  });

  it('gerador nao reconstrói totais operacionais ocultos para motorista commission_only', async () => {
    const payload: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-contract-3',
        empresa_id: 'empresa-1',
        motorista_id: 'mot-1',
        origem: 'LEM / BA',
        destino: 'Salvador / BA',
        data: '2026-10-10',
        status: 'finalizado',
        valor_frete: null, // commission_only
      },
      motorista: { id: 'mot-1', nome: 'Motorista Teste', placa: 'ABC1234' },
      lancamentos: {
        despesas: [
          { id: 'd-1', descricao: 'Pedagio Empresa', tipo: 'pedagio', valor: null, status: 'aprovado', quem_pagou: 'proprietario' },
          { id: 'd-2', descricao: 'Refeicao', tipo: 'refeicao', valor: 80, status: 'aprovado', quem_pagou: 'motorista' },
        ],
        abastecimentos: [],
        vales: [],
      },
      documentos_fiscais: { total: 0, tipos: [] },
      envelope: { status: 'LEGACY_NO_FORMAL_ENVELOPE' },
      resumo_financeiro: {
        restricted: false,
        receita_realizada: null,
        frete_bruto: null,
        resultado_operacional: null,
        comissao_valor: 450,
        comissao_percentual: 10,
        saldo_motorista: 530,
        saldo_motorista_situacao: 'A pagar ao motorista',
        is_autonomo: false,
      },
    };

    const result = await gerarPdfFechamentoFrete(payload, { autoSave: false });
    expect(result.ok).toBe(true);

    const textoPdf = extrairTextoPdf(result.doc);

    // Receita is marked [Restrito]
    expect(textoPdf).toContain('Receita do Frete');
    expect(textoPdf).toContain('[Restrito]');

    // Operational result must NOT exist
    expect(textoPdf).not.toContain('RESULTADO OPERACIONAL');

    // Commission and driver settlement are displayed
    expect(textoPdf).toContain('450,00');
    expect(textoPdf).toContain('530,00');
  });

  it('gerador tolera lancamentos.restricted e documentos_fiscais.restricted sem crash e com mensagens honestas de restricao', async () => {
    const payloadRestrito: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-restricted-cross-domain',
        empresa_id: 'empresa-1',
        motorista_id: 'mot-1',
        origem: 'LEM / BA',
        destino: 'Salvador / BA',
        data: '2026-10-10',
        status: 'finalizado',
        valor_frete: null,
      },
      motorista: { id: 'mot-1', nome: 'Motorista Teste', placa: 'ABC1234' },
      lancamentos: {
        restricted: true,
        despesas: [],
        abastecimentos: [],
        vales: [],
      },
      documentos_fiscais: {
        restricted: true,
        total: null,
        tipos: [],
      },
      envelope: { status: 'LEGACY_NO_FORMAL_ENVELOPE' },
      resumo_financeiro: {
        restricted: true,
        message: 'Informações financeiras restritas para o seu nível de acesso.',
      },
    };

    const result = await gerarPdfFechamentoFrete(payloadRestrito, { autoSave: false });
    expect(result.ok).toBe(true);
    expect(result.doc).toBeDefined();

    const textoPdf = extrairTextoPdf(result.doc);

    // Lancamentos restricted table
    expect(textoPdf).toContain('Lançamentos Operacionais');
    expect(textoPdf).toContain('Informações restritas para este perfil');
    expect(textoPdf).toContain('launch.view ausente');

    // Documentos fiscais restricted
    expect(textoPdf).toContain('Informações de documentos fiscais restritas');
    expect(textoPdf).toContain('documents.view ausente');
    expect(textoPdf).not.toContain('0 documento(s) fiscal(is) anexado(s)');
    expect(textoPdf).not.toContain('Nenhum documento fiscal vinculado');
  });

  it('DEFECT 3 & 4 REGRESSION: renderiza rota com "para" sem mojibake e trata hash nulo/undefined sem concatenar "undefined..."', async () => {
    // 1. Envelope Digital Formal com hash ausente/undefined
    const payloadEnvDefensivo = {
      status: 'FORMAL_ENVELOPE_SEALED',
      envelope: {
        id: 'env-defensive-1',
        frete_id: 'frete-defensive-1',
        sealed_at: '2026-03-10T15:00:00Z',
        envelope_hash: undefined, // Simula ausência de hash
        frete_snapshot: {
          origem: 'Balsas - MA',
          destino: 'Itaqui - MA',
          data: '2026-03-10',
          km_inicial: 1000,
          km_final: 1750,
        },
      },
      motorista_nome: 'João da Silva',
      placa: 'BRA2E19',
    };

    const resEnv = await gerarPdfEnvelopeDigital(payloadEnvDefensivo as any, { autoSave: false });
    expect(resEnv.ok).toBe(true);
    expect(resEnv.doc).toBeDefined();
    const textoEnv = extrairTextoPdf(resEnv.doc);

    // Rota segura com "para", sem mojibake ou ➔
    expect(textoEnv).toContain('Balsas - MA para Itaqui - MA');
    expect(textoEnv).not.toContain('➔');
    expect(textoEnv).not.toContain('undefined');
    expect(textoEnv).not.toContain('NaN');
    expect(textoEnv).toContain('Não disponível');

    // 2. Fechamento de Frete com envelope_hash ausente/undefined
    const payloadFechDefensivo: RelatorioFechamentoPayload = {
      frete: {
        id: 'frete-defensive-1',
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
        status: 'finalizado',
      },
      motorista: {
        id: 'mot-1',
        nome: 'João da Silva',
        placa: 'BRA2E19',
      },
      lancamentos: { despesas: [], abastecimentos: [], vales: [] },
      documentos_fiscais: { total: 0, tipos: [] },
      envelope: {
        status: 'FORMAL_ENVELOPE_SEALED',
        detalhes: {
          id: 'env-defensive-1',
          envelope_type: 'formal_freight_closure',
          schema_version: '1.0.0',
          sealed_at: '2026-03-10T15:00:00Z',
          envelope_hash: undefined as any, // ausência de hash
          reason: 'teste',
        },
      },
      resumo_financeiro: {
        restricted: false,
        frete_bruto: 12500,
        resultado_operacional: 9800,
      },
      gerado_em: '2026-03-10T15:00:00Z',
    };

    const resFech = await gerarPdfFechamentoFrete(payloadFechDefensivo, { autoSave: false });
    expect(resFech.ok).toBe(true);
    expect(resFech.doc).toBeDefined();
    const textoFech = extrairTextoPdf(resFech.doc);

    // Rota com "para"
    expect(textoFech).toContain('Balsas - MA para Itaqui - MA');
    expect(textoFech).not.toContain('➔');

    // Defesa contra "Hash: undefined..."
    expect(textoFech).not.toContain('undefined');
    expect(textoFech).not.toContain('Hash: undefined');
    expect(textoFech).not.toContain('NaN');
    expect(textoFech).toContain('Hash: Não disponível');
  });

  it('DEFECT 2 REGRESSION: preenche motorista, placa e km mesmo com fallbacks parciais do frete', async () => {
    const payloadFallback = {
      frete: {
        id: 'frete-fallback-1',
        origem: 'Balsas - MA',
        destino: 'Itaqui - MA',
        data: '2026-03-10',
        motorista_nome: 'João da Silva',
        placa: 'BRA2E19',
        kmInicial: 1000,
        kmFinal: 1750,
        status: 'finalizado',
      },
      // motorista ausente no nível raiz — deve fazer fallback gracioso
      lancamentos: { despesas: [], abastecimentos: [], vales: [] },
      documentos_fiscais: { total: 0, tipos: [] },
      envelope: { status: 'LEGACY_NO_FORMAL_ENVELOPE' },
      resumo_financeiro: { restricted: false },
    };

    const res = await gerarPdfFechamentoFrete(payloadFallback as any, { autoSave: false });
    expect(res.ok).toBe(true);
    const texto = extrairTextoPdf(res.doc);

    expect(texto).toContain('João da Silva');
    expect(texto).toContain('BRA2E19');
    expect(texto).toContain('1.000 km');
    expect(texto).toContain('1.750 km');
    expect(texto).toContain('750 km');
    expect(texto).not.toContain('undefined');
    expect(texto).not.toContain('NaN');
  });
});


