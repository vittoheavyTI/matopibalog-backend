-- Dados da empresa (nome, endereço, CNPJ...) por empresa, fora do configuracoes id=1 global (#16/#32)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_empresa JSONB DEFAULT '{}'::jsonb;
