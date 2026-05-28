-- Ativar RLS em todas as tabelas
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE abastecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vales ENABLE ROW LEVEL SECURITY;

-- Função auxiliar para checar se o usuário logado é Administrador
CREATE OR REPLACE FUNCTION is_admin() 
RETURNS BOOLEAN AS $$
  BEGIN
    RETURN (SELECT tipo FROM usuarios WHERE id = auth.uid()) = 'admin';
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- POLÍTICAS PARA: usuarios
CREATE POLICY "Admins total usuarios" ON usuarios FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Motorista vê próprio perfil" ON usuarios FOR SELECT TO authenticated USING (auth.uid() = id);

-- POLÍTICAS PARA: motoristas
CREATE POLICY "Admins total motoristas" ON motoristas FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Motorista vê próprio técnico" ON motoristas FOR SELECT TO authenticated USING (auth.uid() = id);

-- POLÍTICAS PARA: fretes
CREATE POLICY "Admins total fretes" ON fretes FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Motorista gerencia seus fretes" ON fretes FOR ALL TO authenticated USING (auth.uid() = motorista_id);

-- POLÍTICAS PARA: despesas
CREATE POLICY "Admins total despesas" ON despesas FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Motorista gerencia suas despesas" ON despesas FOR ALL TO authenticated USING (auth.uid() = motorista_id);

-- POLÍTICAS PARA: abastecimentos
CREATE POLICY "Admins total abastecimentos" ON abastecimentos FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Motorista gerencia seus abastecimentos" ON abastecimentos FOR ALL TO authenticated USING (auth.uid() = motorista_id);

-- POLÍTICAS PARA: vales
CREATE POLICY "Admins total vales" ON vales FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Motorista gerencia seus vales" ON vales FOR ALL TO authenticated USING (auth.uid() = motorista_id);
