const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROJECT_REF = 'rjahjogidyndphdxevom';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function runSQL() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'final_migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('SQL a executar:');
  console.log(sql.substring(0, 500) + '...\n');

  // Tenta via Management API
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    const text = await response.text();
    console.log(`Status: ${response.status}`);
    console.log(`Resposta: ${text.substring(0, 500)}`);
    
    if (response.ok) {
      console.log('\n✅ SQL executado com sucesso!');
      return;
    }
    
    // Se falhou, tenta via /rest/v1/rpc/
    if (response.status === 401 || response.status === 403) {
      console.log('\nManagement API não aceitou service_key. Tentando via REST API...');
      await tryViaRest();
    }
  } catch (err) {
    console.log('Erro na Management API:', err.message);
    console.log('Tentando via REST API...');
    await tryViaRest();
  }
}

async function tryViaRest() {
  const PROJECT_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
  
  // Tenta criar a tabela faturas via INSERT em uma tabela que não existe
  // para verificar, e usa o endpoint rest para fazer consultas
  // Mas não dá pra fazer DDL via REST...
  
  console.log('Não é possível executar DDL via REST API.');
  console.log('\n❌ Não foi possível executar o SQL automaticamente.');
  console.log('\nPara executar manualmente:');
  console.log('1. Acesse: https://supabase.com/dashboard/project/rjahjogidyndphdxevom/sql/new');
  console.log('2. Copie e cole o conteúdo de: backend\\sql\\final_migration.sql');
  console.log('3. Clique em "Run"');
}

runSQL().catch(console.error);
