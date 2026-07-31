const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

test('painel: textos principais usam portugues claro nas tres paginas recentes', () => {
  const rentabilidade = ler('painel_web/src/pages/Rentabilidade.tsx');
  const acerto = ler('painel_web/src/pages/AcertoMotoristas.tsx');
  const torre = ler('painel_web/src/pages/TorreControle.tsx');

  assert.match(rentabilidade, /Rentabilidade por viagem/);
  assert.match(rentabilidade, /Veja quanto cada viagem gerou de receita/);
  assert.match(rentabilidade, /Não inclui custos fixos nem representa a contabilidade completa da empresa/);
  assert.match(acerto, /Acerto de Motoristas/);
  assert.match(acerto, /Créditos do motorista/);
  assert.match(acerto, /O valor apresentado é uma apuração/);
  assert.match(torre, /Torre de Controle/);
  assert.match(torre, /Acompanhe suas viagens e veja rapidamente quais precisam de atenção/);
  assert.match(torre, /Comprovações pendentes/);
});

test('painel: tela de cliente nao expõe termos tecnicos em textos JSX diretos', () => {
  const arquivos = [
    'painel_web/src/pages/Rentabilidade.tsx',
    'painel_web/src/pages/AcertoMotoristas.tsx',
    'painel_web/src/pages/TorreControle.tsx',
  ];
  const textoJsxDireto = arquivos
    .map(ler)
    .join('\n')
    .match(/>[^<>{]*(?:backend|endpoint|tenant|payload|refetch|polling|ePOD|Retry|Loading)[^<>{]*</gi);

  assert.equal(textoJsxDireto, null);
});

test('painel: combobox de empresa tem busca com normalizacao, teclado e estado vazio', () => {
  const torre = ler('painel_web/src/pages/TorreControle.tsx');

  assert.match(torre, /\.normalize\('NFD'\)/);
  assert.match(torre, /ArrowDown/);
  assert.match(torre, /ArrowUp/);
  assert.match(torre, /Escape/);
  assert.match(torre, /Enter/);
  assert.match(torre, /Nenhuma empresa encontrada/);
  assert.match(torre, /aria-expanded/);
});

test('torre: itens encaminham para telas operacionais sem alterar status diretamente', () => {
  const torre = ler('painel_web/src/pages/TorreControle.tsx');
  const viagens = ler('painel_web/src/pages/GerenciamentoViagens.tsx');

  assert.match(torre, /Ver viagem/);
  assert.match(torre, /Ver ocorrência/);
  assert.match(torre, /Analisar comprovante/);
  assert.match(torre, /\/relatorios\/viagens\?/);
  assert.match(torre, /params\.set\('frete', item\.frete_id\)/);
  assert.match(viagens, /searchParams\.get\('frete'\)/);
  assert.match(viagens, /scrollIntoView/);
  assert.doesNotMatch(torre, /api\.(post|patch|put|delete)\(/);
});
