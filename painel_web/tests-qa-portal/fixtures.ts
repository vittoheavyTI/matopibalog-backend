// Fixtures do pacote de aceitação visual do Portal do Embarcador V1.
//
// TUDO AQUI É FICTÍCIO. Nenhum e-mail, token, pessoa, empresa ou documento real
// aparece — os nomes são inventados e os identificadores são literais fixos.
// Estes dados substituem apenas as RESPOSTAS DA API: os componentes, rotas, CSS,
// textos e layout renderizados são o código de produção, sem alteração.

export const EMBARCADOR = { id: 'org-fixture-0001', nome: 'Agro Serra Verde' };
export const TRANSPORTADORA = { relationship_id: 'rel-fixture-0001', nome: 'Transportes Cerrado' };
export const USUARIO = {
  id: 'user-fixture-0001',
  nome: 'Marina Alcântara',
  email: 'contato@exemplo.invalid',
};

export const CONTEXTO = {
  usuario: USUARIO,
  embarcador: EMBARCADOR,
  transportadoras: [TRANSPORTADORA],
};

// Segundo relacionamento: existe só para a cena do seletor de transportadora.
export const CONTEXTO_DUAS_TRANSPORTADORAS = {
  ...CONTEXTO,
  transportadoras: [TRANSPORTADORA, { relationship_id: 'rel-fixture-0002', nome: 'Rodoviário Palmeiras' }],
};

const SEM_ACAO = { rotulo: '', tipo: 'NENHUMA', request_id: '' };

function operacao(over: Record<string, unknown>) {
  return {
    request_id: 'req-fixture-0001',
    reference_code: 'SOL-2026-0001',
    cargo_name: 'Soja em grãos',
    destination_name: 'Porto de Itaqui',
    quantity_unit: 'ton',
    total_quantidade: 1200,
    window_start: '2026-09-01T00:00:00.000Z',
    window_end: '2026-09-20T00:00:00.000Z',
    status_externo: 'EM_ANALISE',
    status_rotulo: 'Em análise pela transportadora',
    comprovante_disponivel: false,
    // Proveniência de operação: é o que separa "Pedidos" de "Transportes".
    tem_operacao: false,
    proxima_acao: SEM_ACAO,
    atualizado_em: '2026-08-24T14:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Início do portal
// ---------------------------------------------------------------------------

export const INICIO_VAZIO = {
  precisam_atencao: [],
  em_andamento: [],
  comprovantes_disponiveis: [],
  recentes: [],
  contadores: { precisam_atencao: 0, em_andamento: 0, comprovantes_disponiveis: 0, total: 0 },
};

const OP_PRECISA_ATENCAO = operacao({
  request_id: 'req-fixture-0002',
  reference_code: 'SOL-2026-0002',
  cargo_name: 'Milho a granel',
  destination_name: 'Terminal de Balsas',
  total_quantidade: 850,
  status_externo: 'AJUSTES_SOLICITADOS',
  status_rotulo: 'Ajustes solicitados',
  proxima_acao: { rotulo: 'Corrigir', tipo: 'REVISAR', request_id: 'req-fixture-0002' },
  atualizado_em: '2026-08-25T10:30:00.000Z',
});

const OP_EM_TRANSPORTE = operacao({
  request_id: 'req-fixture-0003',
  reference_code: 'SOL-2026-0003',
  cargo_name: 'Soja em grãos',
  destination_name: 'Porto de Itaqui',
  total_quantidade: 1200,
  status_externo: 'EM_TRANSPORTE',
  status_rotulo: 'Em transporte',
  tem_operacao: true,
  atualizado_em: '2026-08-25T08:15:00.000Z',
});

const OP_COMPROVANTE = operacao({
  request_id: 'req-fixture-0004',
  reference_code: 'SOL-2026-0004',
  cargo_name: 'Algodão em pluma',
  destination_name: 'Armazém de Luís Eduardo',
  total_quantidade: 320,
  status_externo: 'COMPROVANTE_DISPONIVEL',
  status_rotulo: 'Comprovante disponível',
  comprovante_disponivel: true,
  tem_operacao: true,
  proxima_acao: { rotulo: 'Ver comprovante', tipo: 'VER_COMPROVANTE', request_id: 'req-fixture-0004' },
  atualizado_em: '2026-08-23T17:45:00.000Z',
});

export const INICIO_ATIVO = {
  precisam_atencao: [OP_PRECISA_ATENCAO],
  em_andamento: [OP_EM_TRANSPORTE],
  comprovantes_disponiveis: [OP_COMPROVANTE],
  recentes: [OP_PRECISA_ATENCAO, OP_EM_TRANSPORTE, OP_COMPROVANTE],
  contadores: { precisam_atencao: 1, em_andamento: 1, comprovantes_disponiveis: 1, total: 3 },
};

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

export const LISTA_VAZIA = { itens: [] };

export const LISTA_ATIVA = {
  itens: [
    OP_PRECISA_ATENCAO,
    OP_EM_TRANSPORTE,
    OP_COMPROVANTE,
    operacao({
      request_id: 'req-fixture-0005',
      reference_code: 'SOL-2026-0005',
      cargo_name: 'Sorgo',
      destination_name: 'Unidade de Uruçuí',
      total_quantidade: 480,
      status_externo: 'EM_ANALISE',
      status_rotulo: 'Em análise',
    }),
  ],
};

// ---------------------------------------------------------------------------
// Detalhe / acompanhamento — uma cena por estado de tracking
// ---------------------------------------------------------------------------

const ORIGENS_3 = [
  { nome: 'Fazenda Boa Vista', quantidade: 500 },
  { nome: 'Fazenda Santa Clara', quantidade: 450 },
  { nome: 'Armazém Riacho Fundo', quantidade: 250 },
];

function detalhe(over: Record<string, unknown>) {
  return {
    request_id: 'req-fixture-0003',
    reference_code: 'SOL-2026-0003',
    cargo_name: 'Soja em grãos',
    destination_name: 'Porto de Itaqui',
    quantity_unit: 'ton',
    origens: ORIGENS_3,
    total_quantidade: 1200,
    window_start: '2026-09-01T00:00:00.000Z',
    window_end: '2026-09-20T00:00:00.000Z',
    notes: 'Portaria fecha às 17h. Avisar com 1 dia de antecedência.',
    status_externo: 'EM_PLANEJAMENTO',
    status_rotulo: 'Em planejamento',
    motivo_transportadora: null,
    versao_atual: 1,
    revisoes: 0,
    comprovante_disponivel: false,
    proxima_acao: SEM_ACAO,
    linha_do_tempo: [
      { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-20T12:00:00.000Z' },
      { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-21T09:30:00.000Z' },
    ],
    // `null` por padrão: o backend só envia progresso quando consegue medir com
    // confiança, e a tela nunca inventa número (§14).
    entrega: null,
    atualizado_em: '2026-08-21T09:30:00.000Z',
    ...over,
  };
}

export const DETALHE_PLANEJAMENTO = detalhe({});

export const DETALHE_AGENDADO = detalhe({
  status_externo: 'AGENDADA',
  status_rotulo: 'Transporte agendado',
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-20T12:00:00.000Z' },
    { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-21T09:30:00.000Z' },
    { chave: 'AGENDADA', rotulo: 'Transporte agendado', em: '2026-08-22T11:00:00.000Z' },
  ],
});

export const DETALHE_EM_TRANSPORTE = detalhe({
  status_externo: 'EM_TRANSPORTE',
  status_rotulo: 'Em transporte',
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-20T12:00:00.000Z' },
    { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-21T09:30:00.000Z' },
    { chave: 'AGENDADA', rotulo: 'Transporte agendado', em: '2026-08-22T11:00:00.000Z' },
    { chave: 'EM_TRANSPORTE', rotulo: 'Carga em transporte', em: '2026-08-24T06:10:00.000Z' },
  ],
});

export const DETALHE_PARCIAL = detalhe({
  status_externo: 'PARCIALMENTE_ENTREGUE',
  status_rotulo: 'Entrega parcial',
  // O progresso que o backend sempre calculou e a tela não mostrava (VIS-02).
  entrega: { unidade: 'ton', solicitado: 1200, entregue: 500, restante: 700, concluida: false },
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-20T12:00:00.000Z' },
    { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-21T09:30:00.000Z' },
    { chave: 'AGENDADA', rotulo: 'Transporte agendado', em: '2026-08-22T11:00:00.000Z' },
    { chave: 'EM_TRANSPORTE', rotulo: 'Carga em transporte', em: '2026-08-24T06:10:00.000Z' },
    { chave: 'PARCIALMENTE_ENTREGUE', rotulo: 'Parte da carga foi entregue', em: '2026-08-25T13:20:00.000Z' },
  ],
});

export const DETALHE_ENTREGUE = detalhe({
  status_externo: 'ENTREGUE',
  status_rotulo: 'Entrega concluída',
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-20T12:00:00.000Z' },
    { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-21T09:30:00.000Z' },
    { chave: 'AGENDADA', rotulo: 'Transporte agendado', em: '2026-08-22T11:00:00.000Z' },
    { chave: 'EM_TRANSPORTE', rotulo: 'Carga em transporte', em: '2026-08-24T06:10:00.000Z' },
    { chave: 'ENTREGUE', rotulo: 'Carga entregue', em: '2026-08-25T15:40:00.000Z' },
  ],
});

export const DETALHE_COMPROVANTE = detalhe({
  request_id: 'req-fixture-0004',
  reference_code: 'SOL-2026-0004',
  cargo_name: 'Algodão em pluma',
  destination_name: 'Armazém de Luís Eduardo',
  origens: [{ nome: 'Fazenda Boa Vista', quantidade: 320 }],
  total_quantidade: 320,
  status_externo: 'COMPROVANTE_DISPONIVEL',
  status_rotulo: 'Comprovante disponível',
  comprovante_disponivel: true,
  proxima_acao: { rotulo: 'Ver comprovante', tipo: 'VER_COMPROVANTE' },
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-18T12:00:00.000Z' },
    { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-19T09:30:00.000Z' },
    { chave: 'ENTREGUE', rotulo: 'Carga entregue', em: '2026-08-23T15:40:00.000Z' },
    { chave: 'COMPROVANTE_DISPONIVEL', rotulo: 'Comprovante de entrega disponível', em: '2026-08-23T17:45:00.000Z' },
  ],
});

export const DETALHE_DESCONHECIDO = detalhe({
  status_externo: 'ATUALIZACAO_EM_PROCESSAMENTO',
  status_rotulo: 'Atualização em processamento',
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-20T12:00:00.000Z' },
    { chave: 'ACEITA', rotulo: 'Pedido aceito pela transportadora', em: '2026-08-21T09:30:00.000Z' },
  ],
});

export const DETALHE_AJUSTES = detalhe({
  request_id: 'req-fixture-0002',
  reference_code: 'SOL-2026-0002',
  cargo_name: 'Milho a granel',
  destination_name: 'Terminal de Balsas',
  origens: [
    { nome: 'Fazenda Boa Vista', quantidade: 500 },
    { nome: 'Fazenda Santa Clara', quantidade: 350 },
  ],
  total_quantidade: 850,
  status_externo: 'AJUSTES_SOLICITADOS',
  status_rotulo: 'Ajustes solicitados',
  motivo_transportadora:
    'A janela pedida coincide com a parada programada da balança do terminal. '
    + 'Consegue deslocar o período para depois do dia 10? Se puder, confirme também '
    + 'a quantidade da Fazenda Santa Clara — o valor informado ficou acima da capacidade combinada.',
  versao_atual: 1,
  revisoes: 0,
  proxima_acao: { rotulo: 'Corrigir', tipo: 'REVISAR' },
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-24T12:00:00.000Z' },
    { chave: 'AJUSTES_SOLICITADOS', rotulo: 'A transportadora pediu ajustes', em: '2026-08-25T10:30:00.000Z' },
  ],
});

export const DETALHE_RECUSADO = detalhe({
  request_id: 'req-fixture-0006',
  reference_code: 'SOL-2026-0006',
  cargo_name: 'Farelo de soja',
  destination_name: 'Terminal de Balsas',
  origens: [{ nome: 'Fazenda Boa Vista', quantidade: 200 }],
  total_quantidade: 200,
  status_externo: 'RECUSADA',
  status_rotulo: 'Não atendida',
  motivo_transportadora: 'Não temos frota disponível para essa janela. Sugerimos reenviar para a segunda quinzena.',
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-22T12:00:00.000Z' },
    { chave: 'RECUSADA', rotulo: 'A transportadora não pôde atender', em: '2026-08-22T18:00:00.000Z' },
  ],
});

// Duas versões enviadas: é a cena que mostra o histórico de revisão.
export const DETALHE_COM_HISTORICO = detalhe({
  request_id: 'req-fixture-0002',
  reference_code: 'SOL-2026-0002',
  cargo_name: 'Milho a granel',
  destination_name: 'Terminal de Balsas',
  origens: [
    { nome: 'Fazenda Boa Vista', quantidade: 500 },
    { nome: 'Fazenda Santa Clara', quantidade: 300 },
  ],
  total_quantidade: 800,
  status_externo: 'EM_ANALISE',
  status_rotulo: 'Em análise',
  versao_atual: 2,
  revisoes: 1,
  linha_do_tempo: [
    { chave: 'ENVIADA', rotulo: 'Pedido enviado para a transportadora', em: '2026-08-24T12:00:00.000Z' },
    { chave: 'AJUSTES_SOLICITADOS', rotulo: 'A transportadora pediu ajustes', em: '2026-08-25T10:30:00.000Z' },
    { chave: 'REENVIADA', rotulo: 'Pedido corrigido e reenviado', em: '2026-08-25T14:05:00.000Z' },
  ],
});

// ORDEM DECRESCENTE (versão mais recente primeiro) — é como os dois serviços
// devolvem (`.order('version', { ascending: false })`), e o componente interno
// depende disso para montar o comparativo na direção certa.
export const HISTORICO_DUAS_VERSOES = {
  itens: [
    {
      versao: 2,
      enviada_em: '2026-08-25T14:05:00.000Z',
      total_quantidade: 800,
      quantity_unit: 'ton',
      origens: [
        { nome: 'Fazenda Boa Vista', quantidade: 500 },
        { nome: 'Fazenda Santa Clara', quantidade: 300 },
      ],
      decisao: null,
      motivo: null,
    },
    {
      versao: 1,
      enviada_em: '2026-08-24T12:00:00.000Z',
      total_quantidade: 850,
      quantity_unit: 'ton',
      origens: [
        { nome: 'Fazenda Boa Vista', quantidade: 500 },
        { nome: 'Fazenda Santa Clara', quantidade: 350 },
      ],
      decisao: 'CHANGES_REQUESTED',
      motivo: 'A janela pedida coincide com a parada programada da balança do terminal. Consegue deslocar o período para depois do dia 10?',
    },
  ],
};

export const HISTORICO_VAZIO = { itens: [] };

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export const DOCUMENTOS_VAZIOS = {
  enviados_por_mim: [],
  da_transportadora: [],
  comprovantes: [],
};

export const DOCUMENTOS_COMPLETOS = {
  enviados_por_mim: [
    {
      id: 'doc-fixture-0001', origem: 'EMBARCADOR',
      nome: 'Nota fiscal de remessa.pdf', descricao: null,
      enviado_em: '2026-08-21T10:00:00.000Z',
    },
    {
      id: 'doc-fixture-0002', origem: 'EMBARCADOR',
      nome: 'Laudo de classificação da carga.pdf', descricao: null,
      enviado_em: '2026-08-21T10:05:00.000Z',
    },
  ],
  da_transportadora: [
    {
      id: 'doc-fixture-0010', origem: 'TRANSPORTADORA',
      nome: 'CT-e da viagem.pdf', descricao: null,
      enviado_em: '2026-08-24T08:00:00.000Z',
    },
  ],
  comprovantes: [
    {
      id: 'doc-fixture-0020', origem: 'COMPROVANTE',
      nome: 'Canhoto assinado no destino.jpg', descricao: null,
      enviado_em: '2026-08-25T16:00:00.000Z',
    },
  ],
};

export const DOCUMENTOS_SO_COMPROVANTE = {
  enviados_por_mim: [],
  da_transportadora: [],
  comprovantes: DOCUMENTOS_COMPLETOS.comprovantes,
};

// ---------------------------------------------------------------------------
// Convite
// ---------------------------------------------------------------------------

export const CONVITE_NOVO = {
  email: 'novo.acesso@exemplo.invalid',
  nome_convidado: 'Marina Alcântara',
  transportadora: 'Transportes Cerrado',
  embarcador: 'Agro Serra Verde',
  utilizavel: true,
  conta_existente: false,
  motivo: null,
};

export const CONVITE_CONTA_EXISTENTE = {
  ...CONVITE_NOVO,
  email: 'ja.tem.conta@exemplo.invalid',
  conta_existente: true,
};

export const CONVITE_EXPIRADO = {
  ...CONVITE_NOVO,
  utilizavel: false,
  motivo: 'expirado',
};

// ---------------------------------------------------------------------------
// Conteúdo longo — cena de estresse de layout
// ---------------------------------------------------------------------------

const NOME_LONGO_EMBARCADOR = 'Cooperativa Agroindustrial dos Produtores de Grãos do Oeste Baiano e Sul do Piauí';
const ORIGEM_LONGA = 'Fazenda Nossa Senhora Aparecida do Riacho Fundo — Gleba 14, Setor Norte, Rodovia BR-135 km 287';
const DESTINO_LONGO = 'Terminal Portuário de Uso Privativo do Complexo de Itaqui — Berço 108, Pátio de Granéis Sólidos';

export const CONTEXTO_LONGO = {
  usuario: { ...USUARIO, nome: 'Maria Aparecida Gonçalves de Albuquerque Nascimento' },
  embarcador: { id: EMBARCADOR.id, nome: NOME_LONGO_EMBARCADOR },
  transportadoras: [{ relationship_id: TRANSPORTADORA.relationship_id, nome: 'Transportes e Logística Integrada do Cerrado Setentrional' }],
};

export const DETALHE_LONGO = detalhe({
  cargo_name: 'Soja em grãos a granel safra 2025/2026 classificação tipo exportação',
  destination_name: DESTINO_LONGO,
  origens: [
    { nome: ORIGEM_LONGA, quantidade: 500 },
    { nome: 'Armazém Coletor Intermediário da Cooperativa — Unidade de Recebimento 03', quantidade: 450 },
  ],
  total_quantidade: 950,
  status_externo: 'AJUSTES_SOLICITADOS',
  status_rotulo: 'Ajustes solicitados',
  motivo_transportadora:
    'Precisamos que você confirme alguns pontos antes de seguir com o planejamento desta operação. '
    + 'Primeiro, a janela informada coincide com a parada programada de manutenção da balança rodoviária do '
    + 'terminal de destino, que ocorre entre os dias 5 e 10. Segundo, a quantidade declarada para o armazém '
    + 'coletor intermediário está acima do volume que conseguimos escoar naquele período com a frota alocada. '
    + 'Terceiro, precisamos da confirmação de que a portaria da fazenda opera aos sábados, porque a programação '
    + 'de carregamento prevê coleta em dois finais de semana consecutivos.',
  proxima_acao: { rotulo: 'Corrigir', tipo: 'REVISAR' },
});

export const DOCUMENTOS_LONGOS = {
  enviados_por_mim: [{
    id: 'doc-fixture-0001', origem: 'EMBARCADOR',
    nome: 'Nota fiscal de remessa para formação de lote de exportação — série 3 número 000148295.pdf',
    descricao: null, enviado_em: '2026-08-21T10:00:00.000Z',
  }],
  da_transportadora: [{
    id: 'doc-fixture-0010', origem: 'TRANSPORTADORA',
    nome: 'Conhecimento de Transporte Eletrônico CT-e série 1 número 0000000000000000982371.pdf',
    descricao: null, enviado_em: '2026-08-24T08:00:00.000Z',
  }],
  comprovantes: [{
    id: 'doc-fixture-0020', origem: 'COMPROVANTE',
    nome: 'Canhoto de entrega assinado pelo responsável do pátio de granéis sólidos do terminal.jpg',
    descricao: null, enviado_em: '2026-08-25T16:00:00.000Z',
  }],
};

// ---------------------------------------------------------------------------
// Lado transportadora — caixa de entrada
// ---------------------------------------------------------------------------

function solicitacaoInterna(over: Record<string, unknown>) {
  return {
    id: 'req-fixture-0001',
    reference_code: 'SOL-2026-0001',
    status: 'SUBMITTED',
    cargo_name: 'Soja em grãos',
    destination_name: 'Porto de Itaqui',
    quantity_unit: 'ton',
    origins: ORIGENS_3,
    total_quantidade: 1200,
    window_start: '2026-09-01T00:00:00.000Z',
    window_end: '2026-09-20T00:00:00.000Z',
    notes: 'Portaria fecha às 17h.',
    submitted_at: '2026-08-25T12:00:00.000Z',
    decision_reason: null,
    campaign_id: null,
    versao_atual: 1,
    revisoes: 0,
    conversao_pendente: false,
    ...over,
  };
}

export const CAIXA_VAZIA = {
  grupos: {
    novas_solicitacoes: [], ajustes_reenviados: [], conversao_pendente: [],
    aguardando_embarcador: [], convertidas_em_operacao: [], encerradas: [],
  },
  resumo: { aguardando_decisao: 0, novas_solicitacoes: 0, ajustes_reenviados: 0, conversao_pendente: 0, total: 0 },
};

export const CAIXA_ATIVA = {
  grupos: {
    ajustes_reenviados: [solicitacaoInterna({
      id: 'req-fixture-0002', reference_code: 'SOL-2026-0002',
      cargo_name: 'Milho a granel', destination_name: 'Terminal de Balsas',
      origins: [
        { nome: 'Fazenda Boa Vista', quantidade: 500 },
        { nome: 'Fazenda Santa Clara', quantidade: 300 },
      ],
      total_quantidade: 800, versao_atual: 2, revisoes: 1,
      submitted_at: '2026-08-25T14:05:00.000Z',
    })],
    novas_solicitacoes: [
      solicitacaoInterna({}),
      solicitacaoInterna({
        id: 'req-fixture-0005', reference_code: 'SOL-2026-0005',
        cargo_name: 'Sorgo', destination_name: 'Unidade de Uruçuí',
        origins: [{ nome: 'Fazenda Santa Clara', quantidade: 480 }],
        total_quantidade: 480, submitted_at: '2026-08-25T09:10:00.000Z',
      }),
    ],
    conversao_pendente: [solicitacaoInterna({
      id: 'req-fixture-0007', reference_code: 'SOL-2026-0007',
      cargo_name: 'Algodão em pluma', destination_name: 'Armazém de Luís Eduardo',
      origins: [{ nome: 'Fazenda Boa Vista', quantidade: 320 }],
      total_quantidade: 320, status: 'ACCEPTED', conversao_pendente: true,
      submitted_at: '2026-08-24T11:00:00.000Z',
    })],
    aguardando_embarcador: [solicitacaoInterna({
      id: 'req-fixture-0008', reference_code: 'SOL-2026-0008',
      cargo_name: 'Farelo de soja', destination_name: 'Terminal de Balsas',
      origins: [{ nome: 'Armazém Riacho Fundo', quantidade: 210 }],
      total_quantidade: 210, status: 'CHANGES_REQUESTED',
      decision_reason: 'Confirme a quantidade do armazém — o valor ficou acima do combinado.',
      submitted_at: '2026-08-23T16:20:00.000Z',
    })],
    convertidas_em_operacao: [solicitacaoInterna({
      id: 'req-fixture-0003', reference_code: 'SOL-2026-0003',
      status: 'ACCEPTED', campaign_id: 'camp-fixture-0001',
      submitted_at: '2026-08-20T12:00:00.000Z',
    })],
    encerradas: [solicitacaoInterna({
      id: 'req-fixture-0006', reference_code: 'SOL-2026-0006',
      cargo_name: 'Farelo de soja', destination_name: 'Terminal de Balsas',
      origins: [{ nome: 'Fazenda Boa Vista', quantidade: 200 }],
      total_quantidade: 200, status: 'REJECTED',
      decision_reason: 'Não temos frota disponível para essa janela.',
      submitted_at: '2026-08-22T12:00:00.000Z',
    })],
  },
  resumo: { aguardando_decisao: 3, novas_solicitacoes: 2, ajustes_reenviados: 1, conversao_pendente: 1, total: 7 },
};

// ---------------------------------------------------------------------------
// Lado transportadora — detalhe da solicitação
// ---------------------------------------------------------------------------

export const DOCS_EMBARCADOR_INTERNO = {
  itens: [{
    id: 'doc-fixture-0001',
    nome: 'Nota fiscal de remessa.pdf',
    descricao: null,
    tipo_arquivo: 'application/pdf',
    tamanho_bytes: 184320,
    enviado_em: '2026-08-25T13:00:00.000Z',
  }],
};

// Também DECRESCENTE — ver comentário em HISTORICO_DUAS_VERSOES.
export const HISTORICO_INTERNO = {
  itens: [
    {
      versao: 2, enviada_em: '2026-08-25T14:05:00.000Z',
      cargo_name: 'Milho a granel', destination_name: 'Terminal de Balsas',
      quantity_unit: 'ton', total_quantidade: 800,
      origens: [
        { nome: 'Fazenda Boa Vista', quantidade: 500 },
        { nome: 'Fazenda Santa Clara', quantidade: 300 },
      ],
      decisao: null, motivo: null, decidida_em: null,
    },
    {
      versao: 1, enviada_em: '2026-08-24T12:00:00.000Z',
      cargo_name: 'Milho a granel', destination_name: 'Terminal de Balsas',
      quantity_unit: 'ton', total_quantidade: 850,
      origens: [
        { nome: 'Fazenda Boa Vista', quantidade: 500 },
        { nome: 'Fazenda Santa Clara', quantidade: 350 },
      ],
      decisao: 'CHANGES_REQUESTED',
      motivo: 'A janela coincide com a parada da balança do terminal. Consegue deslocar para depois do dia 10?',
      decidida_em: '2026-08-25T10:30:00.000Z',
    },
  ],
};

export const COMPARTILHAVEIS = {
  documentos: [
    { id: 'fdoc-fixture-0001', titulo: 'CT-e da viagem SOL-2026-0002', tipo: 'cte', criado_em: '2026-08-24T08:00:00.000Z', compartilhado: false },
    { id: 'fdoc-fixture-0002', titulo: 'MDF-e da viagem SOL-2026-0002', tipo: 'mdfe', criado_em: '2026-08-24T08:05:00.000Z', compartilhado: true },
  ],
  comprovantes: [
    { id: 'epod-fixture-0001', titulo: 'Canhoto assinado no destino', criado_em: '2026-08-25T16:00:00.000Z', compartilhado: false },
  ],
  ja_compartilhados: [
    { id: 'share-fixture-0001', titulo: 'MDF-e da viagem SOL-2026-0002', origem: 'FRETE_DOCUMENTO', desde: '2026-08-25T09:00:00.000Z' },
  ],
};

export const USUARIO_INTERNO_COM_SHARE = {
  id: 'user-int-fixture-0001',
  email: 'operacao@exemplo.invalid',
  nome: 'Rafael Queiroz',
  tipo: 'admin',
  status: 'ativo',
  foto_url: null,
  is_super_admin: false,
  empresa_id: 'emp-fixture-0001',
  empresas: { tipo: 'transportadora', nome: 'Transportes Cerrado' },
  effective_permissions: {
    'shipper_portal.requests.review': true,
    'shipper_portal.documents.share': true,
    'campaign.create': true,
    'freight.view': true,
  },
  permission_template: 'administrador',
  senha_temporaria: false,
  termos_pendentes: false,
  termos_pendentes_count: 0,
};

export const USUARIO_INTERNO_SEM_SHARE = {
  ...USUARIO_INTERNO_COM_SHARE,
  id: 'user-int-fixture-0002',
  nome: 'Camila Ribeiro',
  effective_permissions: {
    'shipper_portal.requests.review': true,
    'shipper_portal.documents.share': false,
    'campaign.create': true,
    'freight.view': true,
  },
  permission_template: 'operador',
};

// ---------------------------------------------------------------------------
// Após a correção da aceitação visual
// ---------------------------------------------------------------------------

// Entrega concluída: `restante = 0`. O progresso continua visível e verdadeiro,
// sem inventar um estado de alarme para algo que terminou (§16).
export const DETALHE_ENTREGUE_COM_PROGRESSO = {
  ...DETALHE_ENTREGUE,
  entrega: { unidade: 'ton', solicitado: 1200, entregue: 1200, restante: 0, concluida: true },
};

export const DETALHE_EM_TRANSPORTE_COM_PROGRESSO = {
  ...DETALHE_EM_TRANSPORTE,
  entrega: { unidade: 'ton', solicitado: 1200, entregue: 0, restante: 1200, concluida: false },
};

// Um único pedido, parcialmente entregue: o cenário que antes produzia
// "No momento, nenhuma ação é necessária" com metade da carga por chegar.
const OP_PARCIAL = operacao({
  request_id: 'req-fixture-0003',
  reference_code: 'SOL-2026-0003',
  cargo_name: 'Soja em grãos',
  destination_name: 'Porto de Itaqui',
  total_quantidade: 1200,
  status_externo: 'PARCIALMENTE_ENTREGUE',
  status_rotulo: 'Entrega parcial',
  tem_operacao: true,
  proxima_acao: { rotulo: 'Acompanhar operação', tipo: 'ACOMPANHAR', request_id: 'req-fixture-0003' },
  atualizado_em: '2026-08-25T13:20:00.000Z',
});

export const INICIO_SO_ENTREGA_PARCIAL = {
  precisam_atencao: [],
  em_andamento: [OP_PARCIAL],
  comprovantes_disponiveis: [],
  contadores: { precisam_atencao: 0, em_andamento: 1, comprovantes_disponiveis: 1, total: 1 },
};

export const LISTA_COM_PARCIAL = {
  itens: [
    OP_PRECISA_ATENCAO,
    OP_PARCIAL,
    OP_COMPROVANTE,
    operacao({
      request_id: 'req-fixture-0007',
      reference_code: 'SOL-2026-0007',
      cargo_name: 'Algodão em pluma',
      destination_name: 'Armazém de Luís Eduardo',
      total_quantidade: 320,
      status_externo: 'ACEITA',
      status_rotulo: 'Pedido aceito',
      // Aceito, mas a operação ainda não foi criada: segue em "Pedidos" (§48).
      tem_operacao: false,
    }),
    operacao({
      request_id: 'req-fixture-0005',
      reference_code: 'SOL-2026-0005',
      cargo_name: 'Sorgo',
      destination_name: 'Unidade de Uruçuí',
      total_quantidade: 480,
    }),
  ],
};

// Aba de documentos: todos os arquivos, de todos os pedidos, em uma lista só.
export const DOCUMENTOS_AGREGADOS = {
  itens: [
    {
      id: 'doc-fixture-0020', origem: 'COMPROVANTE',
      nome: 'Canhoto assinado no destino.jpg', descricao: null,
      enviado_em: '2026-08-25T16:00:00.000Z', mime_type: 'image/jpeg',
      request_id: 'req-fixture-0004', pedido_referencia: 'SOL-2026-0004',
      pedido_titulo: 'Algodão em pluma · Armazém de Luís Eduardo',
    },
    {
      id: 'doc-fixture-0010', origem: 'ENVIADO_PELA_TRANSPORTADORA',
      nome: 'CT-e da viagem.pdf', descricao: null,
      enviado_em: '2026-08-24T08:00:00.000Z', mime_type: 'application/pdf',
      request_id: 'req-fixture-0003', pedido_referencia: 'SOL-2026-0003',
      pedido_titulo: 'Soja em grãos · Porto de Itaqui',
    },
    {
      id: 'doc-fixture-0001', origem: 'ENVIADO_POR_MIM',
      nome: 'Nota fiscal de remessa.pdf', descricao: null,
      enviado_em: '2026-08-21T10:00:00.000Z', mime_type: 'application/pdf',
      request_id: 'req-fixture-0003', pedido_referencia: 'SOL-2026-0003',
      pedido_titulo: 'Soja em grãos · Porto de Itaqui',
    },
  ],
};

export const DOCUMENTOS_AGREGADOS_VAZIO = { itens: [] };

// Histórico do portal externo agora vem em ordem CRESCENTE (§42): causa antes
// da correção.
export const HISTORICO_CRESCENTE = {
  itens: [...HISTORICO_DUAS_VERSOES.itens].sort((a, b) => a.versao - b.versao),
};
