require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function criarAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@choferlog.com.br';
  const password = process.env.ADMIN_PASSWORD;
  const nome = 'Administrador';

  if (!password) {
    console.error('❌ ADMIN_PASSWORD obrigatório. Defina a senha fora do código.');
    process.exit(1);
  }

  try {
    // 1. Tentar criar ou obter usuário no Auth
    let uid;
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log('ℹ️ Usuário já existe no Auth. Atualizando senha e buscando UID...');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        const existingUser = users.find(u => u.email === email);
        if (!existingUser) throw new Error('Não foi possível encontrar o usuário existente.');
        uid = existingUser.id;

        // Resetar a senha para garantir que as credenciais informadas funcionem
        const { error: updateError } = await supabase.auth.admin.updateUserById(uid, {
          password: password
        });
        if (updateError) console.warn('⚠️ Aviso: Não foi possível atualizar a senha:', updateError.message);
        else console.log('✅ Senha do administrador atualizada.');
      } else {
        throw authError;
      }
    } else {
      uid = authUser.user.id;
      console.log('✅ Usuário criado no Auth. UID:', uid);
    }

    // 2. Upsert na tabela usuarios
    const { error: insertError } = await supabase
      .from('usuarios')
      .upsert({
        id: uid,
        nome,
        email,
        tipo: 'admin',
        status: 'ativo',
      }, { onConflict: 'id' });

    if (insertError) {
      console.error('Erro ao inserir/atualizar em usuarios:', insertError.message);
    } else {
      console.log('✅ Administrador configurado com sucesso!');
      console.log(`   Email: ${email}`);
      console.log('   Senha: (definida via ADMIN_PASSWORD)');
    }
  } catch (err) {
    console.error('❌ Erro inesperado:', err.message);
  }
}

criarAdmin();
