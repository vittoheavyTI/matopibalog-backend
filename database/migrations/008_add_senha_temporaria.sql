-- Marca senha definida pelo admin; motorista troca no primeiro acesso (fluxo futuro)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_temporaria BOOLEAN DEFAULT false;
