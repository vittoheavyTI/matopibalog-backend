-- Planos padrão com trial de 7 dias
INSERT INTO planos (nome, preco_mensal, limite_motoristas, dias_trial, ativo, descricao)
VALUES
  ('Básico', 49.90, 3, 7, true, 'Para pequenas frotas — até 3 motoristas'),
  ('Profissional', 99.90, 10, 7, true, 'Para frotas em crescimento — até 10 motoristas'),
  ('Empresarial', 199.90, 999, 7, true, 'Motoristas ilimitados — recursos completos')
ON CONFLICT (id) DO NOTHING;
