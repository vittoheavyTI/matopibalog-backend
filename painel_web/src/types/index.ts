export interface Motorista {
  uid: string;
  cpf: string;
  nomeCompleto: string;
  placaVeiculo: string;
  cnpjProprietario?: string;
  percentualComissao: number;
  statusCadastro: 'aprovado' | 'pendente' | 'bloqueado';
  telefone: string;
  dataCadastro: string;
  empresaTipo?: 'autonomo' | 'transportadora';
}

export interface Frete {
  id: string;
  motoristaUid: string;
  placa: string;
  data: string;
  origem: string;
  destino: string;
  valorFrete: number;
  quemRecebeu: 'proprietario' | 'motorista';
  status: 'ativo' | 'finalizado';
  kmInicial?: number;
  kmFinal?: number;
  criadoEm: string;
}

export interface Despesa {
  id: string;
  motoristaUid: string;
  freteId?: string;
  tipo: string;
  descricao: string;
  valor: number;
  quemPagou: 'proprietario' | 'motorista';
  fotoUrl?: string;
  fotoPendente: boolean;
  data: string;
  sincronizado: boolean;
  status?: 'pendente' | 'aprovado' | 'rejeitado';
  finalizado?: boolean;
}

export interface Abastecimento {
  id: string;
  motoristaUid: string;
  freteId?: string;
  litros: number;
  valorTotal: number;
  quemPagou: 'proprietario' | 'motorista';
  arlaLitros?: number;
  arlaValor?: number;
  odometro?: number;
  fotoUrl?: string;
  fotoPendente: boolean;
  data: string;
  posto?: string;
  sincronizado: boolean;
  status?: 'pendente' | 'aprovado' | 'rejeitado';
  finalizado?: boolean;
}

export interface Vale {
  id: string;
  motoristaUid: string;
  freteId?: string;
  posto?: string;
  litros?: number;
  valor: number;
  quemPagou: 'proprietario' | 'motorista';
  fotoUrl?: string;
  fotoPendente: boolean;
  data: string;
  sincronizado: boolean;
  status?: 'pendente' | 'aprovado' | 'rejeitado';
  finalizado?: boolean;
}

export interface Usuario {
  uid: string;
  nome: string;
  email: string;
  celular?: string;
  cep?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  fotoUrl?: string;
  nivel: 'administrador' | 'usuario';
  permissoes: {
    dashboard: boolean;
    motoristas: boolean;
    relatorios: boolean;
    usuarios: boolean;
    configuracoes: boolean;
  };
  dataCadastro: string;
  status?: string;
}
