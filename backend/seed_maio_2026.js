require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service role for admin bypass
);

const motoristasData = [
  { nome: 'João Silva', placa: 'ABC-1234', tipo: 'Carreta 3 Eixos', mediaRange: [2.5, 3.0], rotas: [['LEM', 'Barreiras'], ['LEM', 'Rosário']] },
  { nome: 'Maria Oliveira', placa: 'DEF-5678', tipo: 'Bitrem 7 Eixos', mediaRange: [2.3, 2.5], rotas: [['Cuiabá', 'Santos'], ['Brasília', 'LEM']] },
  { nome: 'Carlos Santos', placa: 'GHI-9012', tipo: 'Bitrenzão 9 Eixos', mediaRange: [2.0, 2.3], rotas: [['Barreiras', 'Goiânia'], ['LEM', 'Brasília']] },
  { nome: 'Ana Costa', placa: 'JKL-3456', tipo: 'Rodotrem 9 Eixos', mediaRange: [1.8, 2.2], rotas: [['Rosário', 'LEM'], ['Santos', 'LEM']] },
  { nome: 'Pedro Souza', placa: 'MNO-7890', tipo: 'Carreta 3 Eixos', mediaRange: [2.5, 3.0], rotas: [['Goiânia', 'LEM'], ['LEM', 'Santos']] },
];

async function seed() {
  console.log('🚀 Gerando dados REALISTAS para MAIO/2026...');
  
  // Limpar dados anteriores do mês para não duplicar
  const dataInicio = '2026-05-01T00:00:00Z';
  const dataFim = '2026-05-31T23:59:59Z';
  await supabase.from('fretes').delete().gte('data', dataInicio).lte('data', dataFim);
  await supabase.from('abastecimentos').delete().gte('data', dataInicio).lte('data', dataFim);
  await supabase.from('despesas').delete().gte('data', dataInicio).lte('data', dataFim);

  for (const mData of motoristasData) {
    const { data: users } = await supabase.from('usuarios').select('id').eq('nome', mData.nome);
    if (!users || users.length === 0) continue;
    const uid = users[0].id;

    console.log(`👤 Populando ${mData.nome} (${mData.tipo})...`);

    for (let i = 1; i <= 4; i++) {
      const rota = mData.rotas[Math.floor(Math.random() * mData.rotas.length)];
      const dist = 300 + (Math.random() * 600); // 300 a 900km por viagem
      const kmIni = 20000 + (Math.random() * 10000);
      const kmFim = kmIni + dist;
      
      // Média baseada no tipo de caminhão
      const mediaAlvo = mData.mediaRange[0] + (Math.random() * (mData.mediaRange[1] - mData.mediaRange[0]));
      const litrosNecessarios = dist / mediaAlvo;
      
      const dataStr = `2026-05-${5 + (i * 5)}T10:00:00Z`;

      const { data: frete } = await supabase.from('fretes').insert({
        motorista_id: uid,
        placa: mData.placa,
        origem: rota[0],
        destino: rota[1],
        valor_frete: 3000 + (Math.random() * 2000),
        km_inicial: Math.floor(kmIni),
        km_final: Math.floor(kmFim),
        status: 'aprovado',
        data: dataStr
      }).select().single();

      if (frete) {
        await supabase.from('abastecimentos').insert({
          motorista_id: uid,
          frete_id: frete.id,
          posto: 'Posto Rota 163',
          litros: parseFloat(litrosNecessarios.toFixed(2)),
          valor_total: litrosNecessarios * 5.80, // Preço médio diesel
          quem_pagou: 'proprietario',
          status: 'aprovado',
          data: dataStr
        });

        await supabase.from('despesas').insert({
          motorista_id: uid,
          frete_id: frete.id,
          tipo: 'pedagio',
          descricao: 'Pedágios da Rota',
          valor: 120.00,
          quem_pagou: 'proprietario',
          status: 'aprovado',
          data: dataStr
        });
      }
    }
  }
  console.log('✨ Dados de Maio de 2026 inseridos com sucesso!');
}

seed();
