const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERRO: SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados no .env');
  process.exit(1);
}

// Client admin (service_role) — usado por DB e Storage em todo o backend.
// persistSession/autoRefreshToken desligados: este client NUNCA deve guardar sessão
// de usuário. O login (signInWithPassword) usa um client isolado próprio
// (ver authController) para não contaminar este client com o token do usuário
// autenticado — o que rebaixaria as operações de Storage de service_role para
// 'authenticated' e faria os uploads baterem em RLS.
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = supabase;
