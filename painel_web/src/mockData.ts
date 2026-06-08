import type { Motorista, Frete, Despesa, Abastecimento, Vale, Usuario } from './types';

// Motoristas Fictícios para Apresentação
export const mockMotoristas: Motorista[] = [
  {
    uid: 'mot-1',
    nomeCompleto: 'João Silva',
    cpf: '123.456.789-01',
    placaVeiculo: 'ABC-1234',
    percentualComissao: 15,
    statusCadastro: 'aprovado',
    telefone: '(11) 98765-4321',
    dataCadastro: new Date().toISOString()
  },
  {
    uid: 'mot-2',
    nomeCompleto: 'Ricardo Oliveira',
    cpf: '234.567.890-12',
    placaVeiculo: 'DEF-5678',
    percentualComissao: 12,
    statusCadastro: 'aprovado',
    telefone: '(11) 97654-3210',
    dataCadastro: new Date().toISOString()
  },
  {
    uid: 'mot-3',
    nomeCompleto: 'Marcos Santos',
    cpf: '345.678.901-23',
    placaVeiculo: 'GHI-9012',
    percentualComissao: 14,
    statusCadastro: 'aprovado',
    telefone: '(11) 96543-2109',
    dataCadastro: new Date().toISOString()
  },
  {
    uid: 'mot-4',
    nomeCompleto: 'Antônio Ferreira',
    cpf: '456.789.012-34',
    placaVeiculo: 'JKL-3456',
    percentualComissao: 13,
    statusCadastro: 'aprovado',
    telefone: '(11) 95432-1098',
    dataCadastro: new Date().toISOString()
  },
  {
    uid: 'mot-5',
    nomeCompleto: 'Luiz Carlos',
    cpf: '567.890.123-45',
    placaVeiculo: 'MNO-7890',
    percentualComissao: 15,
    statusCadastro: 'aprovado',
    telefone: '(11) 94321-0987',
    dataCadastro: new Date().toISOString()
  },
];

export const mockUsuarios: Usuario[] = [
  {
    uid: 'mock-admin-uid',
    nome: 'Administrador Matopiba',
    email: 'admin@mock.com',
    celular: '(11) 99999-9999',
    endereco: 'Rua Principal, 100 - Centro',
    nivel: 'administrador',
    permissoes: {
      dashboard: true,
      motoristas: true,
      relatorios: true,
      usuarios: true,
      configuracoes: true
    },
    dataCadastro: new Date().toISOString()
  },
  {
    uid: 'mock-user-uid',
    nome: 'Operador Sistema',
    email: 'usuario@mock.com',
    celular: '(11) 88888-8888',
    endereco: 'Av. Secundária, 500',
    nivel: 'usuario',
    permissoes: {
      dashboard: true,
      motoristas: true,
      relatorios: true,
      usuarios: false,
      configuracoes: false
    },
    dataCadastro: new Date().toISOString()
  }
];

// Fretes (Viagens) para apresentação
export const mockFretes: Frete[] = [
  {
    id: 'f-1',
    motoristaUid: 'mot-1',
    placa: 'ABC-1234',
    data: new Date().toISOString(),
    origem: 'São Paulo, SP',
    destino: 'Curitiba, PR',
    valorFrete: 4500.00,
    quemRecebeu: 'proprietario',
    kmInicial: 150200,
    kmFinal: 150650,
    status: 'ativo',
    criadoEm: new Date().toISOString()
  },
  {
    id: 'f-2',
    motoristaUid: 'mot-2',
    placa: 'DEF-5678',
    data: new Date().toISOString(),
    origem: 'Santos, SP',
    destino: 'Cuiabá, MT',
    valorFrete: 8200.00,
    quemRecebeu: 'proprietario',
    kmInicial: 85400,
    kmFinal: 87050,
    status: 'ativo',
    criadoEm: new Date().toISOString()
  },
  {
    id: 'f-3',
    motoristaUid: 'mot-3',
    placa: 'GHI-9012',
    data: new Date().toISOString(),
    origem: 'Belo Horizonte, MG',
    destino: 'Rio de Janeiro, RJ',
    valorFrete: 3800.00,
    quemRecebeu: 'proprietario',
    kmInicial: 210500,
    kmFinal: 210940,
    status: 'ativo',
    criadoEm: new Date().toISOString()
  }
];

// Despesas e Manutenções
export const mockDespesas: Despesa[] = [
  {
    id: 'd-1',
    motoristaUid: 'mot-1',
    descricao: 'Almoço e Estacionamento',
    valor: 85.00,
    quemPagou: 'motorista',
    tipo: 'despesa',
    status: 'pendente',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  },
  {
    id: 'd-2',
    motoristaUid: 'mot-1',
    descricao: 'Troca de Óleo',
    valor: 1200.00,
    quemPagou: 'proprietario',
    tipo: 'manutencao',
    status: 'aprovado',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  },
  {
    id: 'd-3',
    motoristaUid: 'mot-2',
    descricao: 'Pedágio Rodoanel',
    valor: 45.60,
    quemPagou: 'motorista',
    tipo: 'despesa',
    status: 'aprovado',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  }
];

// Abastecimentos
export const mockAbastecimentos: Abastecimento[] = [
  {
    id: 'a-1',
    motoristaUid: 'mot-1',
    posto: 'Posto Graal',
    litros: 450,
    valorTotal: 2700.00,
    odometro: 150450,
    quemPagou: 'proprietario',
    status: 'aprovado',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  },
  {
    id: 'a-2',
    motoristaUid: 'mot-2',
    posto: 'Posto Ipiranga',
    litros: 600,
    valorTotal: 3600.00,
    odometro: 86100,
    quemPagou: 'proprietario',
    status: 'pendente',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  }
];

// Vales / Adiantamentos
export const mockVales: Vale[] = [
  {
    id: 'v-1',
    motoristaUid: 'mot-1',
    valor: 500.00,
    quemPagou: 'proprietario',
    status: 'aprovado',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  },
  {
    id: 'v-2',
    motoristaUid: 'mot-3',
    valor: 300.00,
    quemPagou: 'proprietario',
    status: 'pendente',
    data: new Date().toISOString(),
    finalizado: false,
    sincronizado: true,
    fotoPendente: false
  }
];
