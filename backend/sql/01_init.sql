-- ============================================================
-- MIGRAÇÃO: Fases 1-4 — Estrutura completa do sistema
-- ============================================================

-- 1. Adicionar colunas faltantes na tabela empresas
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas' AND column_name = 'trial_expires_at') THEN
    ALTER TABLE empresas ADD COLUMN trial_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas' AND column_name = 'asaas_customer_id') THEN
    ALTER TABLE empresas ADD COLUMN asaas_customer_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empresas' AND column_name = 'plano_id') THEN
    ALTER TABLE empresas ADD COLUMN plano_id UUID REFERENCES planos(id);
  END IF;
END $$;

-- 2. Adicionar empresa_id na tabela usuarios
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'empresa_id') THEN
    ALTER TABLE usuarios ADD COLUMN empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Criar tabela de faturas
CREATE TABLE IF NOT EXISTS faturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  asaas_id TEXT UNIQUE,
  valor DECIMAL(10,2) NOT NULL,
  tipo_pagamento TEXT CHECK (tipo_pagamento IN ('PIX', 'BOLETO', 'CARTAO')),
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'vencido', 'cancelado', 'estornado')),
  invoice_url TEXT,
  pix_qr_code TEXT,
  due_date DATE,
  pago_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Criar tabela de documentos/contratos
CREATE TABLE IF NOT EXISTS documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('contrato', 'comprovante', 'documento')),
  clicksign_key TEXT,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'assinado', 'recusado', 'cancelado')),
  url_download TEXT,
  url_visualizacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  signed_at TIMESTAMPTZ
);

-- 5. Trigger: limite de motoristas por plano
CREATE OR REPLACE FUNCTION check_motorista_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_plano_limite INTEGER;
  v_total INTEGER;
BEGIN
  -- Buscar limite do plano da empresa do motorista
  SELECT p.limite_motoristas INTO v_plano_limite
  FROM usuarios u
  JOIN empresas e ON u.empresa_id = e.id
  JOIN planos p ON e.plano_id = p.id
  WHERE u.id = NEW.id;

  -- Se houver limite, verificar
  IF v_plano_limite IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total
    FROM motoristas m
    JOIN usuarios u ON m.id = u.id
    WHERE u.empresa_id = (SELECT empresa_id FROM usuarios WHERE id = NEW.id);

    IF v_total >= v_plano_limite THEN
      RAISE EXCEPTION 'Limite de motoristas do plano atingido (%)', v_plano_limite;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remover trigger se já existir e recriar
DROP TRIGGER IF EXISTS trg_check_motorista_limit ON motoristas;
CREATE TRIGGER trg_check_motorista_limit
  BEFORE INSERT ON motoristas
  FOR EACH ROW
  EXECUTE FUNCTION check_motorista_limit();

-- 6. RLS Policies (re-ativar após desabilitado)
-- Habilitar RLS nas tabelas principais
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE abastecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vales ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturas ENABLE ROW LEVEL SECURITY;

-- Remover policies existentes para recriar
DROP POLICY IF EXISTS empresas_isolation ON empresas;
DROP POLICY IF EXISTS usuarios_isolation ON usuarios;
DROP POLICY IF EXISTS motoristas_isolation ON motoristas;
DROP POLICY IF EXISTS fretes_isolation ON fretes;
DROP POLICY IF EXISTS despesas_isolation ON despesas;
DROP POLICY IF EXISTS abastecimentos_isolation ON abastecimentos;
DROP POLICY IF EXISTS vales_isolation ON vales;
DROP POLICY IF EXISTS faturas_isolation ON faturas;

-- Empresas: admin vê todas, usuário vê só a sua
CREATE POLICY empresas_isolation ON empresas
  FOR ALL
  USING (
    (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
    OR
    id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
  );

-- Usuários: admin vê todos, usuário vê só da mesma empresa
CREATE POLICY usuarios_isolation ON usuarios
  FOR ALL
  USING (
    (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
    OR
    empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
  );

-- Motoristas: admin vê todos, usuário vê só da mesma empresa
CREATE POLICY motoristas_isolation ON motoristas
  FOR ALL
  USING (
    (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
    OR
    id IN (
      SELECT id FROM usuarios
      WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
    )
  );

-- Fretes: admin vê todos, motorista vê os próprios, empresa vê da empresa
CREATE POLICY fretes_isolation ON fretes
  FOR ALL
  USING (
    (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
    OR
    motorista_id = auth.uid()
    OR
    motorista_id IN (
      SELECT id FROM usuarios
      WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
    )
  );

-- Despesas, abastecimentos, vales: mesma lógica
CREATE POLICY despesas_isolation ON despesas FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY abastecimentos_isolation ON abastecimentos FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

CREATE POLICY vales_isolation ON vales FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR motorista_id = auth.uid()
  OR motorista_id IN (SELECT id FROM usuarios WHERE empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid()))
);

-- Faturas: admin vê todas, empresa vê as próprias
CREATE POLICY faturas_isolation ON faturas FOR ALL USING (
  (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin'
  OR empresa_id IN (SELECT empresa_id FROM usuarios WHERE id = auth.uid())
);
