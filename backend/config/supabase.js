const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERRO: SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ─── DIAGNÓSTICO TEMPORÁRIO (REMOVER após validar a role da chave no Railway) ──
// Loga SOMENTE metadados seguros da SUPABASE_SERVICE_KEY no boot.
// NUNCA loga a chave/token. Objetivo: confirmar role/ref efetivos em runtime.
(function diagSupabaseKey() {
  try {
    const k = supabaseServiceKey || '';
    const meta = { existe: !!k, tamanho: k.length, prefixo: k.slice(0, 3) };

    if (k.startsWith('eyJ')) {
      let payload;
      try {
        const seg = k.split('.')[1] || '';
        payload = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
      } catch (e) {
        console.log('[diag-supabase-key]', { ...meta, formato: 'jwt', payload: 'indecodificavel' });
        return;
      }
      console.log('[diag-supabase-key]', {
        ...meta,
        formato: 'jwt',
        role: payload.role ?? null,   // esperado: 'service_role'
        ref: payload.ref ?? null,     // deve bater com o subdomínio da SUPABASE_URL
        iss: payload.iss ?? null,
      });
    } else if (k.startsWith('sb_')) {
      // Formato novo — loga só o sub-prefixo (publishable vs secret), nunca o valor.
      const tipo = k.startsWith('sb_secret_') ? 'sb_secret_'
        : k.startsWith('sb_publishable_') ? 'sb_publishable_'
        : 'sb_desconhecido';
      console.log('[diag-supabase-key]', { ...meta, formato: 'novo_nao_jwt', tipo });
    } else {
      console.log('[diag-supabase-key]', { ...meta, formato: 'desconhecido_nao_jwt' });
    }
  } catch (e) {
    console.log('[diag-supabase-key] erro no diagnostico:', e && e.message);
  }
})();
// ─── FIM DIAGNÓSTICO TEMPORÁRIO ───────────────────────────────────────────────

module.exports = supabase;
