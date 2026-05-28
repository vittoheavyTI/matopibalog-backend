-- ============================================================
-- MIGRAÇÃO FINAL — executar no Supabase SQL Editor
-- https://supabase.com/dashboard/project/rjahjogidyndphdxevom/sql/new
-- ============================================================

-- 1. Adicionar colunas faltantes na tabela empresas
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- 2. Criar tabela de faturas
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

-- 3. Criar tabela de documentos/contratos
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

-- 4. Trigger: limite de motoristas por plano
CREATE OR REPLACE FUNCTION check_motorista_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_plano_limite INTEGER;
  v_total INTEGER;
BEGIN
  SELECT p.limite_motoristas INTO v_plano_limite
  FROM usuarios u
  JOIN empresas e ON u.empresa_id = e.id
  JOIN planos p ON e.plano_id = p.id
  WHERE u.id = NEW.id;

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

DROP TRIGGER IF EXISTS trg_check_motorista_limit ON motoristas;
CREATE TRIGGER trg_check_motorista_limit
  BEFORE INSERT ON motoristas
  FOR EACH ROW
  EXECUTE FUNCTION check_motorista_limit();
