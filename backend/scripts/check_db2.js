const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  // Check empresas columns by querying info
  const { data: info, error } = await supabase
    .from('empresas')
    .select('*')
    .limit(1);
  
  if (error) {
    console.log('empresas error:', error.message);
  } else if (info && info.length > 0) {
    console.log('empresas columns:', Object.keys(info[0]).join(', '));
  } else {
    // Table exists but empty - can't detect columns this way
    console.log('empresas table exists but empty');
  }

  // Check if faturas table can be created by trying to insert/select
  const { error: errFat } = await supabase.from('faturas').select('*').limit(1);
  console.log('faturas exists:', errFat ? errFat.message : 'YES');
  
  // Check admin user's empresa_id
  const { data: admins } = await supabase.from('usuarios').select('id, email, empresa_id').eq('tipo', 'admin');
  if (admins) {
    console.log('Admin users:', admins.length);
    admins.forEach(a => console.log(' -', a.email, 'empresa_id:', a.empresa_id || 'null'));
  }
  
  // Check if planos already exist with proper limits
  const { data: planos } = await supabase.from('planos').select('nome, preco_mensal, limite_motoristas');
  console.log('\nCurrent planos:');
  planos?.forEach(p => console.log(' -', p.nome, '| R$' + p.preco_mensal, '| limit:', p.limite_motoristas));
}

main().catch(console.error);
