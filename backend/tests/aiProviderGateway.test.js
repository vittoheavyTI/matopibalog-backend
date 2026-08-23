'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = require('../services/ai/providerGateway');
const { fakeProvider } = require('../services/ai/providers/fakeProvider');
const { AIProviderError } = require('../services/ai/providers/errors');
const { MODES } = require('../services/ai/config');

test('provider disabled lança AIProviderError DISABLED', async () => {
  await assert.rejects(
    () => gateway.generate({ system: 's', messages: [], tools: [] }, { mode: MODES.DISABLED }),
    (e) => e instanceof AIProviderError && e.code === 'DISABLED',
  );
});

test('fake provider é determinístico e roteirizável', async () => {
  fakeProvider.reset();
  fakeProvider.setScript([
    { type: 'tools', toolCalls: [{ name: 'x.tool', arguments: { a: 1 } }] },
    { type: 'text', content: 'Resposta final.' },
  ]);
  const r1 = await gateway.generate({ system: 's', messages: [], tools: [] }, { mode: MODES.FAKE });
  assert.equal(r1.finishReason, 'tool_calls');
  assert.equal(r1.toolCalls[0].name, 'x.tool');
  const r2 = await gateway.generate({ system: 's', messages: [], tools: [] }, { mode: MODES.FAKE });
  assert.equal(r2.finishReason, 'stop');
  assert.equal(r2.content, 'Resposta final.');
});

test('fake provider sem script devolve texto seguro (não inventa)', async () => {
  fakeProvider.reset();
  const r = await gateway.generate({ system: 's', messages: [], tools: [] }, { mode: MODES.FAKE });
  assert.equal(r.finishReason, 'stop');
  assert.match(r.content, /não tenho informações/i);
});

test('fake provider propaga erro/timeout normalizados', async () => {
  fakeProvider.reset();
  fakeProvider.setScript([{ type: 'error', code: 'RATE_LIMIT' }]);
  await assert.rejects(() => gateway.generate({ system: 's', messages: [] }, { mode: MODES.FAKE }), (e) => e.code === 'RATE_LIMIT');
  fakeProvider.setScript([{ type: 'timeout' }]);
  await assert.rejects(() => gateway.generate({ system: 's', messages: [] }, { mode: MODES.FAKE }), (e) => e.code === 'TIMEOUT');
});

// §12/§59: a camada de PROVIDER não pode importar supabase.
test('camada de provider NÃO importa supabase (arquitetural)', () => {
  const dir = path.join(__dirname, '..', 'services', 'ai');
  const providerFiles = [
    'providerGateway.js', 'config.js', 'chatOrchestrator.js', 'toolRegistry.js', 'systemPrompt.js',
    'providers/disabledProvider.js', 'providers/fakeProvider.js', 'providers/openaiProvider.js', 'providers/errors.js',
  ];
  for (const rel of providerFiles) {
    const src = fs.readFileSync(path.join(dir, rel), 'utf8');
    assert.ok(!/config\/supabase/.test(src), `${rel} não deve importar config/supabase`);
    assert.ok(!/@supabase\/supabase-js/.test(src), `${rel} não deve importar supabase-js`);
  }
});
