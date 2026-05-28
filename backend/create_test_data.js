require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const motoristasData = [
  { nome: 'João Silva', email: 'joao@teste.com', cpf: '111.111.111-11', placa: 'ABC-1234', viagens: 2 },
  { nome: 'Maria Oliveira', email: 'maria@teste.com', cpf: '222.222.222-22', placa: 'DEF-5678', viagens: 3 },
  { nome: 'Carlos Santos', email: 'carlos@teste.com', cpf: '333.333.333-33', placa: 'GHI-9012', viagens: 4 },
  { nome: 'Ana Costa', email: 'ana@teste.com', cpf: '444.444.444-44', placa: 'JKL-3456', viagens: 5 },
  { nome: 'Pedro Souza', email: 'pedro@teste.com', cpf: '555.555.555-55', placa: 'MNO-7890', viagens: 6 },
];

async function seed() {
  console.log('🚀 Iniciando geração de dados de teste...');

  for (const m of motoristasData) {
    console.log(`\n👤 Criando motorista: ${m.nome}...`);
    
    // 1. Criar no Auth
    let uid;
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: m.email,
      password: 'Senha@123!',
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        uid = users.find(u => u.email === m.email).id;
      } else {
        console.error(`Erro Auth: ${authError.message}`);
        continue;
      }
    } else {
      uid = authUser.user.id;
    }

    // 2. Tabela usuarios
    await supabase.from('usuarios').upsert({
      id: uid,
      nome: m.nome,
      email: m.email,
      tipo: 'motorista',
      status: 'ativo',
    });

    // 3. Tabela motoristas
    await supabase.from('motoristas').upsert({
      id: uid,
      cpf: m.cpf,
      placa_veiculo: m.placa,
      percentual_comissao: 12.0,
      status_cadastro: 'aprovado',
    });

    // 4. Criar Fretes
    for (let i = 1; i <= m.viagens; i++) {
      const status = i === 1 ? 'finalizado' : 'ativo';
      const valor = 1000 + (Math.random() * 2000);
      
      const { data: frete, error: freteErr } = await supabase.from('fretes').insert({
        motorista_id: uid,
        placa: m.placa,
        origem: 'Cuiabá - MT',
        destino: 'Santos - SP',
        valor_frete: valor,
        quem_recebeu: i % 2 === 0 ? 'proprietario' : 'motorista',
        status: status,
        data: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)).toISOString(),
      }).select().single();

      if (freteErr) {
        console.error(`Erro Frete: ${freteErr.message}`);
        continue;
      }

      // Adicionar Despesas, Abastecimentos e Vales para cada frete
      await supabase.from('despesas').insert({
        motorista_id: uid,
        frete_id: frete.id,
        tipo: 'Pedágio',
        descricao: 'Pedágio BR-163',
        valor: 150.00,
        quem_pagou: 'proprietario',
      });

      await supabase.from('abastecimentos').insert({
        motorista_id: uid,
        frete_id: frete.id,
        litros: 200,
        valor_total: 1200.00,
        quem_pagou: 'proprietario',
        posto: 'Posto Ipê',
      });

      if (i % 2 === 0) {
        await supabase.from('vales').insert({
          motorista_id: uid,
          frete_id: frete.id,
          valor: 200.00,
          quem_pagou: 'proprietario',
        });
      }
    }
    console.log(`✅ ${m.nome} configurado com ${m.viagens} viagens.`);
  }

  console.log('\n✨ Todos os dados de teste foram gerados com sucesso!');
}

seed();
