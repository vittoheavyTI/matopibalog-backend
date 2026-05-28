const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  // Check current estado
  const { data: empresas } = await supabase.from('empresas').select('id, nome, trial_expires_at, plano_id').limit(1);
  console.log('empresas columns:', empresas ? Object.keys(empresas[0]).join(', ') : 'empty table');
  console.log('Has trial_expires_at:', empresas?.[0]?.trial_expires_at !== undefined);
  console.log('Has plano_id:', empresas?.[0]?.plano_id !== undefined);

  const { data: usuarios } = await supabase.from('usuarios').select('id, nome, empresa_id').limit(1);
  console.log('usuarios columns:', usuarios ? Object.keys(usuarios[0]).join(', ') : 'empty table');
  console.log('Has empresa_id:', usuarios?.[0]?.empresa_id !== undefined);

  // Check planos
  const { data: planos } = await supabase.from('planos').select('*');
  console.log('planos count:', planos ? planos.length : 0);
  if (planos) planos.forEach(p => console.log(' -', p.nome, 'R$' + p.preco_mensal, 'limite:', p.limite_motoristas));

  // Try faturas table
  const { data: faturas, error: errF } = await supabase.from('faturas').select('id').limit(1);
  console.log('faturas table:', errF ? errF.message : 'exists');
}

main().catch(console.error);
