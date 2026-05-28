-- 1. Tabela de Usuários (Base para Auth e Perfis)
CREATE TABLE usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  tipo TEXT CHECK (tipo IN ('admin', 'motorista')) DEFAULT 'motorista',
  status TEXT CHECK (status IN ('ativo', 'pendente', 'bloqueado')) DEFAULT 'pendente',
  foto_url TEXT,
  telefone TEXT,
  endereco TEXT,
  cep TEXT,
  bairro TEXT,
  cidade TEXT,
  permissoes JSONB DEFAULT '{"dashboard": true, "motoristas": true, "relatorios": true, "usuarios": false, "configuracoes": false}',
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabela de Motoristas (Dados Técnicos)
CREATE TABLE motoristas (
  id UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  cpf TEXT UNIQUE NOT NULL,
  placa_veiculo TEXT NOT NULL,
  percentual_comissao NUMERIC(5,2) DEFAULT 12.0,
  status_cadastro TEXT CHECK (status_cadastro IN ('aprovado', 'pendente', 'bloqueado')) DEFAULT 'pendente',
  data_cadastro TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabela de Fretes
CREATE TABLE fretes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID REFERENCES motoristas(id) NOT NULL,
  placa TEXT NOT NULL,
  data TIMESTAMPTZ DEFAULT now(),
  origem TEXT NOT NULL,
  destino TEXT NOT NULL,
  valor_frete NUMERIC(12,2) NOT NULL,
  quem_recebeu TEXT CHECK (quem_recebeu IN ('proprietario', 'motorista')) NOT NULL,
  status TEXT DEFAULT 'ativo',
  km_inicial INTEGER,
  km_final INTEGER,
  criado_em TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_fretes_motorista_data ON fretes (motorista_id, data);

-- 4. Tabela de Despesas
CREATE TABLE despesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID REFERENCES motoristas(id) NOT NULL,
  frete_id UUID REFERENCES fretes(id),
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  quem_pagou TEXT CHECK (quem_pagou IN ('proprietario', 'motorista')) NOT NULL,
  foto_url TEXT,
  foto_pendente BOOLEAN DEFAULT false,
  data TIMESTAMPTZ DEFAULT now(),
  sincronizado BOOLEAN DEFAULT true
);

-- 5. Tabela de Abastecimentos
CREATE TABLE abastecimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID REFERENCES motoristas(id) NOT NULL,
  frete_id UUID REFERENCES fretes(id),
  litros NUMERIC(10,2) NOT NULL,
  valor_total NUMERIC(12,2) NOT NULL,
  quem_pagou TEXT CHECK (quem_pagou IN ('proprietario','motorista')) NOT NULL,
  arla_litros NUMERIC(10,2),
  arla_valor NUMERIC(12,2),
  foto_url TEXT,
  foto_pendente BOOLEAN DEFAULT false,
  data TIMESTAMPTZ DEFAULT now(),
  posto TEXT
);

-- 6. Tabela de Vales
CREATE TABLE vales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID REFERENCES motoristas(id) NOT NULL,
  frete_id UUID REFERENCES fretes(id),
  posto TEXT,
  litros NUMERIC(10,2),
  valor NUMERIC(12,2) NOT NULL,
  quem_pagou TEXT CHECK (quem_pagou IN ('proprietario','motorista')) NOT NULL,
  foto_url TEXT,
  foto_pendente BOOLEAN DEFAULT false,
  data TIMESTAMPTZ DEFAULT now()
);
