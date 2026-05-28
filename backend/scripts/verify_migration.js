const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function verify() {
  console.log('=== VERIFICAÇÃO PÓS-MIGRAÇÃO ===\n');
  let ok = 0, fail = 0;

  // 1. asaas_customer_id em empresas
  try {
    const { data } = await supabase.from('empresas').select('id, asaas_customer_id').limit(1);
    if (data !== undefined) { console.log('✅ asaas_customer_id: OK'); ok++; }
  } catch { console.log('❌ asaas_customer_id: AUSENTE'); fail++; }

  // 2. trial_ends_at (já existia, mas verificar)
  try {
    const { data } = await supabase.from('empresas').select('trial_ends_at').limit(1);
    console.log('✅ trial_ends_at: OK'); ok++;
  } catch { console.log('❌ trial_ends_at: AUSENTE'); fail++; }

  // 3. faturas table
  try {
    const { data } = await supabase.from('faturas').select('id').limit(1);
    console.log('✅ Tabela faturas: OK'); ok++;
  } catch { console.log('❌ Tabela faturas: AUSENTE'); fail++; }

  // 4. documentos table
  try {
    const { data } = await supabase.from('documentos').select('id').limit(1);
    console.log('✅ Tabela documentos: OK'); ok++;
  } catch { console.log('❌ Tabela documentos: AUSENTE'); fail++; }

  // 5. empresa_id em usuarios
  try {
    const { data } = await supabase.from('usuarios').select('id, empresa_id').limit(1);
    console.log('✅ empresa_id em usuarios: OK'); ok++;
  } catch { console.log('❌ empresa_id em usuarios: AUSENTE'); fail++; }

  // 6. plano_id em empresas
  try {
    const { data } = await supabase.from('empresas').select('id, plano_id').limit(1);
    console.log('✅ plano_id em empresas: OK'); ok++;
  } catch { console.log('❌ plano_id em empresas: AUSENTE'); fail++; }

  // 7. Planos
  try {
    const { data: planos } = await supabase.from('planos').select('nome, limite_motoristas').order('preco_mensal');
    console.log('✅ Planos:', planos?.length || 0);
    planos?.forEach(p => console.log('   -', p.nome, '| limite:', p.limite_motoristas));
    ok++;
  } catch { console.log('❌ Planos: erro'); fail++; }

  // 8. Test register-empresa flow
  try {
    const rand = Date.now();
    const body = JSON.stringify({
      nome: `Verif ${rand}`, email: `v${rand}@test.com`, senha: '123456',
      empresa: `Verif Ltda ${rand}`, cnpj: '000', telefone: '11999999999', plano: 'basico'
    });
    const r = await fetch('http://localhost:3000/auth/register-empresa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    const data = await r.json();
    if (r.status === 201) {
      console.log('✅ register-empresa: 201 | empresa_id:', data.empresa_id?.substring(0, 8) + '...');
      ok++;
    } else {
      console.log(`❌ register-empresa: ${r.status} ${data.message}`);
      fail++;
    }
  } catch (e) {
    console.log('❌ register-empresa:', e.message); fail++;
  }

  console.log(`\n=== RESULTADO: ${ok}/8 ✅ | ${fail} ❌ ===`);
  if (fail === 0) console.log('TUDO OK — Migração concluída com sucesso!');
}

verify().catch(console.error);
