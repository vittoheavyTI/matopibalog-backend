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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'empresas' AND column_name = 'asaas_customer_id'
  ) THEN
    ALTER TABLE empresas ADD COLUMN asaas_customer_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'empresas' AND column_name = 'trial_expires_at'
  ) THEN
    ALTER TABLE empresas ADD COLUMN trial_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days');
  END IF;
END $$;
