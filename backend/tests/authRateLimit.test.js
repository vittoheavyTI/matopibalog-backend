const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { criarRefreshLimiter } = require('../middlewares/authRateLimit');

test('refresh limiter retorna 429 ao exceder tentativas no endpoint de refresh', async () => {
  const app = express();
  app.use('/auth/refresh', criarRefreshLimiter({ windowMs: 60 * 1000, max: 2 }));
  app.post('/auth/refresh', (_req, res) => res.status(401).json({ error: 'RefreshInvalid' }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/auth/refresh', { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/auth/refresh', { method: 'POST' })).status, 401);
    const r = await fetch(base + '/auth/refresh', { method: 'POST' });
    assert.equal(r.status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
