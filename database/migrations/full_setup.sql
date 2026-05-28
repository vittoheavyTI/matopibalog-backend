-- =============================================
-- CHOFER LOG - SETUP COMPLETO DO BANCO DE DADOS
-- =============================================

-- 1. LIMPAR TABELAS EXISTENTES (para recriação limpa)
DROP TABLE IF EXISTS vales CASCADE;
DROP TABLE IF EXISTS abastecimentos CASCADE;
DROP TABLE IF EXISTS despesas CASCADE;
DROP TABLE IF EXISTS fretes CASCADE;
DROP TABLE IF EXISTS motoristas CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- 2. FUNÇÃO AUXILIAR PARA VERIFICAR SE É ADMIN
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. TABELA USUARIOS
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

-- 4. TABELA MOTORISTAS
CREATE TABLE motoristas (
  id UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  cpf TEXT UNIQUE NOT NULL,
  placa_veiculo TEXT NOT NULL,
  percentual_comissao NUMERIC(5,2) DEFAULT 12.0,
  status_cadastro TEXT CHECK (status_cadastro IN ('aprovado', 'pendente', 'bloqueado')) DEFAULT 'pendente',
  data_cadastro TIMESTAMPTZ DEFAULT now()
);

-- 5. TABELA FRETES
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

-- 6. TABELA DESPESAS
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
  status TEXT CHECK (status IN ('aprovado', 'pendente', 'rejeitado', 'finalizado')) DEFAULT 'pendente',
  sincronizado BOOLEAN DEFAULT true
);

-- 7. TABELA ABASTECIMENTOS
CREATE TABLE abastecimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID REFERENCES motoristas(id) NOT NULL,
  frete_id UUID REFERENCES fretes(id),
  litros NUMERIC(10,2) NOT NULL,
  valor_total NUMERIC(12,2) NOT NULL,
  quem_pagou TEXT CHECK (quem_pagou IN ('proprietario', 'motorista')) NOT NULL,
  arla_litros NUMERIC(10,2),
  arla_valor NUMERIC(12,2),
  foto_url TEXT,
  foto_pendente BOOLEAN DEFAULT false,
  data TIMESTAMPTZ DEFAULT now(),
  status TEXT CHECK (status IN ('aprovado', 'pendente', 'rejeitado', 'finalizado')) DEFAULT 'pendente',
  posto TEXT
);

-- 8. TABELA VALES
CREATE TABLE vales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id UUID REFERENCES motoristas(id) NOT NULL,
  frete_id UUID REFERENCES fretes(id),
  posto TEXT,
  litros NUMERIC(10,2),
  valor NUMERIC(12,2) NOT NULL,
  quem_pagou TEXT CHECK (quem_pagou IN ('proprietario', 'motorista')) NOT NULL,
  foto_url TEXT,
  foto_pendente BOOLEAN DEFAULT false,
  data TIMESTAMPTZ DEFAULT now(),
  status TEXT CHECK (status IN ('aprovado', 'pendente', 'rejeitado', 'finalizado')) DEFAULT 'pendente'
);

-- =============================================
-- 9. HABILITAR RLS EM TODAS AS TABELAS
-- =============================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE abastecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vales ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 10. POLÍTICAS RLS - USUARIOS
-- =============================================
-- Admin pode tudo
CREATE POLICY "Admin pode tudo em usuarios" ON usuarios
  FOR ALL TO authenticated USING (is_admin());

-- Motorista vê apenas o próprio perfil
CREATE POLICY "Motorista ve proprio perfil" ON usuarios
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- Motorista pode atualizar o próprio nome/email (mas não tipo/status)
CREATE POLICY "Motorista atualiza proprio perfil" ON usuarios
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (tipo = 'motorista' AND status IN ('pendente', 'ativo', 'bloqueado'));

-- =============================================
-- 11. POLÍTICAS RLS - MOTORISTAS
-- =============================================
-- Admin pode tudo
CREATE POLICY "Admin pode tudo em motoristas" ON motoristas
  FOR ALL TO authenticated USING (is_admin());

-- Motorista vê apenas seus dados técnicos
CREATE POLICY "Motorista ve seus dados" ON motoristas
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- Motorista NÃO pode alterar percentual_comissao nem status_cadastro (isso é feito pelo admin)
-- Esta política permite UPDATE apenas se a mudança não afetar esses campos
CREATE POLICY "Motorista nao altera comissao nem status" ON motoristas
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    percentual_comissao = (SELECT percentual_comissao FROM motoristas WHERE id = auth.uid()) 
    AND status_cadastro = (SELECT status_cadastro FROM motoristas WHERE id = auth.uid())
  );

-- =============================================
-- 12. POLÍTICAS RLS - FRETES
-- =============================================
-- Admin pode tudo
CREATE POLICY "Admin pode tudo em fretes" ON fretes
  FOR ALL TO authenticated USING (is_admin());

-- Motorista vê apenas seus fretes
CREATE POLICY "Motorista ve seus fretes" ON fretes
  FOR SELECT TO authenticated USING (auth.uid() = motorista_id);

-- Motorista pode criar fretes (apenas para si mesmo)
CREATE POLICY "Motorista cria seus fretes" ON fretes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = motorista_id);

-- Motorista pode atualizar apenas seus fretes
CREATE POLICY "Motorista atualiza seus fretes" ON fretes
  FOR UPDATE TO authenticated
  USING (auth.uid() = motorista_id);

-- Motorista pode excluir (soft delete) apenas seus fretes
CREATE POLICY "Motorista deleta seus fretes" ON fretes
  FOR DELETE TO authenticated
  USING (auth.uid() = motorista_id);

-- =============================================
-- 13. POLÍTICAS RLS - DESPESAS
-- =============================================
CREATE POLICY "Admin pode tudo em despesas" ON despesas
  FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "Motorista gerencia suas despesas" ON despesas
  FOR ALL TO authenticated USING (auth.uid() = motorista_id);

-- =============================================
-- 14. POLÍTICAS RLS - ABASTECIMENTOS
-- =============================================
CREATE POLICY "Admin pode tudo em abastecimentos" ON abastecimentos
  FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "Motorista gerencia seus abastecimentos" ON abastecimentos
  FOR ALL TO authenticated USING (auth.uid() = motorista_id);

-- =============================================
-- 15. POLÍTICAS RLS - VALES
-- =============================================
CREATE POLICY "Admin pode tudo em vales" ON vales
  FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "Motorista gerencia seus vales" ON vales
  FOR ALL TO authenticated USING (auth.uid() = motorista_id);
