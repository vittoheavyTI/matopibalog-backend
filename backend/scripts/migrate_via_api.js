const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function migrate() {
  console.log('=== Iniciando migração via API ===\n');

  // 1. Update planos with proper limits
  console.log('1. Atualizando planos...');
  const planos = [
    { nome: 'Plano Básico', preco_mensal: 49.90, limite_motoristas: 3, dias_trial: 7, ativo: true, descricao: 'Para pequenas frotas — até 3 motoristas' },
    { nome: 'Plano Profissional', preco_mensal: 99.90, limite_motoristas: 10, dias_trial: 7, ativo: true, descricao: 'Para frotas em crescimento — até 10 motoristas' },
    { nome: 'Plano Enterprise', preco_mensal: 199.90, limite_motoristas: 999, dias_trial: 7, ativo: true, descricao: 'Motoristas ilimitados — recursos completos' },
  ];
  
  for (const p of planos) {
    const { error } = await supabase.from('planos').update(p).eq('nome', p.nome);
    if (error) {
      // Try insert
      const { error: insErr } = await supabase.from('planos').insert(p);
      if (insErr) console.log(`  ${p.nome}: ${insErr.message}`);
      else console.log(`  ${p.nome}: inserido`);
    } else {
      console.log(`  ${p.nome}: atualizado`);
    }
  }

  // 2. Create faturas table by first checking if it exists
  console.log('\n2. Verificando tabela faturas...');
  const { error: fatErr } = await supabase.from('faturas').select('id').limit(1);
  if (fatErr && fatErr.message?.includes('find the table')) {
    console.log('  Tabela faturas não existe. Criar via SQL Editor.');
    console.log('  Execute o arquivo backend/sql/01_init.sql no SQL Editor do Supabase.');
  } else {
    console.log('  Tabela faturas já existe.');
  }

  // 3. Add empresa_id to usuarios if not exist (check was already done)
  const { data: userCols } = await supabase.from('usuarios').select('id, empresa_id').limit(1);
  if (userCols && userCols.length > 0) {
    console.log('\n3. empresa_id na tabela usuarios: OK');
  } else if (userCols && userCols.length === 0) {
    // Table has rows but no empresa_id
    const keys = Object.keys(userCols[0]);
    console.log('\n3. empresa_id na tabela usuarios:', keys.includes('empresa_id') ? 'OK' : 'Ausente');
  } else {
    // Table might have empresa_id as column but no rows
    console.log('\n3. Tabela usuarios vazia.');
  }

  // 4. Check empresas columns
  console.log('\n4. Verificando colunas da tabela empresas...');
  const { data: empCols } = await supabase.from('empresas').select('*').limit(1);
  if (empCols && empCols.length > 0) {
    const keys = Object.keys(empCols[0]);
    console.log('  Colunas existentes:', keys.join(', '));
    console.log('  trial_expires_at:', keys.includes('trial_expires_at') ? 'OK' : 'Ausente (rodar SQL)');
    console.log('  plano_id:', keys.includes('plano_id') ? 'OK' : 'Ausente (rodar SQL)');
    console.log('  asaas_customer_id:', keys.includes('asaas_customer_id') ? 'OK' : 'Ausente (rodar SQL)');
  } else {
    console.log('  Tabela empresas vazia.');
  }

  console.log('\n=== Migração concluída ===');
  console.log('Se alguma coluna estiver ausente, execute o SQL manualmente em:');
  console.log('https://supabase.com/dashboard/project/rjahjogidyndphdxevom/sql/new');
}

migrate().catch(console.error);
