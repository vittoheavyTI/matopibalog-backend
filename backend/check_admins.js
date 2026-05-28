const supabase = require('./config/supabase');
require('dotenv').config();

async function checkAdmins() {
  const { data, error } = await supabase
    .from('usuarios')
    .select('email, tipo')
    .eq('tipo', 'admin');

  if (error) {
    console.error('Erro ao buscar admins:', error);
    return;
  }

  if (data.length === 0) {
    console.log('Nenhum administrador encontrado na tabela usuarios.');
  } else {
    console.log('Administradores encontrados:');
    data.forEach(user => console.log(`- ${user.email}`));
  }
}

checkAdmins();
