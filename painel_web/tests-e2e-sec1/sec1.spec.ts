import { test, expect, chromium, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const painelDir = resolve(here, '..');
const repoDir = resolve(painelDir, '..');
const backendDir = resolve(repoDir, 'backend');
const backendRequire = createRequire(join(backendDir, 'package.json'));

const express = backendRequire('express');
const cors = backendRequire('cors');
const cookieParser = backendRequire('cookie-parser');
const pg = backendRequire('pg');
const { loadAuthConfig } = backendRequire('./config/authConfig');
const { criarSessionService } = backendRequire('./services/auth/sessionService');
const { criarAuthSessionController } = backendRequire('./controllers/authSessionController');
const { criarVerifyTokenSec1 } = backendRequire('./middlewares/authSession');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMPRESA_ID = '22222222-2222-4222-8222-222222222222';
const EMAIL = 'sec1-e2e@matopibalog.test';
const SENHA = 'senha-e2e';
const JWT_SECRET = 'jwt-secret-sec1-e2e-nao-producao';
const PEPPER = 'pepper-sec1-e2e-nao-producao';
const APP_HOST = 'app.matopibalog.test';
const API_HOST = 'api.matopibalog.test';
const EVIL_HOST = 'evil.matopibalog.test';

type Pool = InstanceType<typeof pg.Pool>;

let pool: Pool | null = null;
let apiServer: HttpsServer | null = null;
let viteServer: ViteDevServer | null = null;
let appPort = 0;
let apiPort = 0;
let appOrigin = '';
let apiOrigin = '';
let apiDirectOrigin = '';
let evilOrigin = '';

function hasDatabase() {
  return !!process.env.DATABASE_URL;
}

test.skip(!hasDatabase(), 'DATABASE_URL ausente; E2E SEC-1 roda com PostgreSQL efemero no CI');

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function findOpenSsl(): string {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
  ];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error('openssl nao encontrado para gerar certificado local E2E');
}

function createLocalCertificate() {
  const dir = mkdtempSync(join(tmpdir(), 'sec1-e2e-cert-'));
  const key = join(dir, 'sec1.key');
  const cert = join(dir, 'sec1.crt');
  const cnf = join(dir, 'sec1.cnf');
  writeFileSync(cnf, `
[req]
distinguished_name=req_distinguished_name
x509_extensions=v3_req
prompt=no

[req_distinguished_name]
CN=SEC1 E2E Local

[v3_req]
subjectAltName=@alt_names

[alt_names]
DNS.1=${APP_HOST}
DNS.2=${API_HOST}
DNS.3=${EVIL_HOST}
IP.1=127.0.0.1
`, 'utf8');
  execFileSync(findOpenSsl(), [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-config', cnf,
  ], { stdio: 'ignore' });
  return { key, cert };
}

async function applySchema() {
  execFileSync(process.execPath, ['tests-pg/apply_schema.mjs'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || '' },
    stdio: 'inherit',
  });
}

async function seedFixture(db: Pool) {
  await db.query(`
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS nome text;
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS tipo text;
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS status text;
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS empresa_id uuid;
  `);
  await db.query(`
    INSERT INTO public.empresas(id, nome, status)
    VALUES ($1, 'Empresa SEC-1 E2E', 'ativo')
    ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, status=EXCLUDED.status
  `, [EMPRESA_ID]);
  await db.query(`
    INSERT INTO public.usuarios(id, nome, email, tipo, status, is_super_admin, empresa_id)
    VALUES ($1, 'Usuario SEC-1 E2E', $2, 'admin', 'ativo', true, $3)
    ON CONFLICT (id) DO UPDATE SET
      nome=EXCLUDED.nome,
      email=EXCLUDED.email,
      tipo=EXCLUDED.tipo,
      status=EXCLUDED.status,
      is_super_admin=EXCLUDED.is_super_admin,
      empresa_id=EXCLUDED.empresa_id
  `, [USER_ID, EMAIL, EMPRESA_ID]);
}

function createPgSupabaseAdapter(db: Pool) {
  const rpcSql: Record<string, { sql: string; params: string[] }> = {
    criar_sessao_auth: {
      sql: 'SELECT * FROM public.criar_sessao_auth($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      params: [
        'p_usuario_id', 'p_empresa_id', 'p_client_type', 'p_device_id', 'p_device_label',
        'p_refresh_family_id', 'p_refresh_token_hash', 'p_refresh_expires_at',
        'p_idle_expires_at', 'p_absolute_expires_at', 'p_ip_hash', 'p_user_agent', 'p_created_by',
      ],
    },
    rotacionar_refresh_token: {
      sql: 'SELECT * FROM public.rotacionar_refresh_token($1,$2,$3,$4,$5,$6,$7)',
      params: [
        'p_apresentado_hash', 'p_novo_token_hash', 'p_novo_expires_at',
        'p_novo_idle_expires_at', 'p_request_id', 'p_origin', 'p_grace_seconds',
      ],
    },
    revogar_sessao_auth: {
      sql: 'SELECT * FROM public.revogar_sessao_auth($1,$2,$3,$4,$5)',
      params: ['p_session_id', 'p_motivo', 'p_actor_usuario_id', 'p_request_id', 'p_origin'],
    },
    revogar_sessoes_usuario: {
      sql: 'SELECT public.revogar_sessoes_usuario($1,$2,$3,$4,$5) AS n',
      params: ['p_usuario_id', 'p_motivo', 'p_actor_usuario_id', 'p_request_id', 'p_origin'],
    },
  };

  return {
    async rpc(name: string, params: Record<string, unknown>) {
      const spec = rpcSql[name];
      if (!spec) return { data: null, error: new Error(`RPC nao suportada no E2E: ${name}`) };
      try {
        const result = await db.query(spec.sql, spec.params.map((p) => params[p]));
        return { data: result.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      return new PgQuery(db, table);
    },
  };
}

class PgQuery {
  private filters: Array<{ field: string; op: 'eq' | 'is' | 'lt'; value: unknown }> = [];
  private updatePayload: Record<string, unknown> | null = null;
  private insertPayload: Record<string, unknown> | null = null;
  private wantsSingle = false;
  private wantsMaybeSingle = false;
  private orderField: string | null = null;
  private orderAscending = true;

  constructor(private db: Pool, private table: string) {}

  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push({ field, op: 'eq', value }); return this; }
  is(field: string, value: unknown) { this.filters.push({ field, op: 'is', value }); return this; }
  lt(field: string, value: unknown) { this.filters.push({ field, op: 'lt', value }); return this; }
  order(field: string, opts?: { ascending?: boolean }) {
    this.orderField = field;
    this.orderAscending = opts?.ascending !== false;
    return this;
  }
  maybeSingle() { this.wantsMaybeSingle = true; return this.execute(); }
  single() { this.wantsSingle = true; return this.execute(); }
  update(payload: Record<string, unknown>) { this.updatePayload = payload; return this; }
  insert(payload: Record<string, unknown>) { this.insertPayload = payload; return this.execute(); }
  then(resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) {
    return this.execute().then(resolve, reject);
  }

  private whereClause(offset = 1) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    this.filters.forEach((filter, index) => {
      const param = `$${offset + index}`;
      if (filter.op === 'eq') clauses.push(`${filter.field} = ${param}`);
      if (filter.op === 'is') clauses.push(`${filter.field} IS ${filter.value === null ? 'NULL' : 'NOT NULL'}`);
      if (filter.op === 'lt') clauses.push(`${filter.field} < ${param}`);
      if (filter.op !== 'is') values.push(filter.value);
    });
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
  }

  private async execute() {
    try {
      if (this.insertPayload) {
        const keys = Object.keys(this.insertPayload);
        const values = keys.map((k) => this.insertPayload?.[k]);
        await this.db.query(
          `INSERT INTO public.${this.table}(${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
          values,
        );
        return { data: null, error: null };
      }

      if (this.updatePayload) {
        const keys = Object.keys(this.updatePayload);
        const setSql = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
        const setValues = keys.map((key) => this.updatePayload?.[key]);
        const where = this.whereClause(setValues.length + 1);
        const result = await this.db.query(
          `UPDATE public.${this.table} SET ${setSql}${where.sql} RETURNING id`,
          [...setValues, ...where.values],
        );
        return { data: result.rows, error: null };
      }

      const where = this.whereClause();
      const order = this.orderField ? ` ORDER BY ${this.orderField} ${this.orderAscending ? 'ASC' : 'DESC'}` : '';
      const result = await this.db.query(`SELECT * FROM public.${this.table}${where.sql}${order}`, where.values);
      const data = this.wantsSingle || this.wantsMaybeSingle ? (result.rows[0] || null) : result.rows;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
}

async function startApiServer(tls: { key: string; cert: string }, db: Pool) {
  const cfg = loadAuthConfig({
    JWT_SECRET,
    AUTH_REFRESH_TOKEN_PEPPER: PEPPER,
    AUTH_SESSIONS_ENABLED: 'true',
    AUTH_REFRESH_ROTATION_ENABLED: 'true',
    AUTH_REQUIRE_SESSION: 'true',
    AUTH_ALLOW_LEGACY_TOKENS: 'false',
    AUTH_ACCESS_TOKEN_TTL_SECONDS: '60',
    AUTH_REFRESH_IDLE_TTL_SECONDS: '300',
    AUTH_REFRESH_ABSOLUTE_TTL_SECONDS: '3600',
    AUTH_REFRESH_REUSE_GRACE_SECONDS: '10',
    AUTH_SESSION_ACTIVITY_THROTTLE_SECONDS: '0',
    AUTH_REFRESH_COOKIE_SAMESITE: 'lax',
    AUTH_WEB_ALLOWED_ORIGINS: appOrigin,
    AUTH_TOKEN_ISSUER: 'matopibalog-sec1-e2e',
    AUTH_TOKEN_AUDIENCE: 'matopibalog-sec1-e2e-browser',
  });
  const sessionService = criarSessionService({
    supabase: createPgSupabaseAdapter(db),
    cfg,
  });
  const authSessionController = criarAuthSessionController({ sessionService, cfg });
  const verify = criarVerifyTokenSec1({ cfg, sessionService });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
      if (!origin) return callback(null, true);
      if (origin === appOrigin) return callback(null, origin);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  app.post('/auth/login', async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    if (process.env.NODE_ENV === 'production' || process.env.SEC1_E2E_AUTH_FAKE !== '1') {
      return res.status(500).json({ error: 'E2EFakeAuthDisabled' });
    }
    if (req.body?.email !== EMAIL || req.body?.senha !== SENHA || req.body?.client_type !== 'web') {
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }
    const { rows } = await db.query('SELECT * FROM public.usuarios WHERE id=$1', [USER_ID]);
    const user = rows[0];
    const sessao = await sessionService.criarSessao({
      usuario_id: user.id,
      empresa_id: user.empresa_id,
      client_type: 'web',
      role: user.tipo,
      is_super_admin: user.is_super_admin === true,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 512),
    });
    res.cookie('refresh_token', sessao.refreshDelivery.reveal(), {
      httpOnly: true,
      secure: true,
      sameSite: cfg.refreshCookieSameSite,
      path: '/auth',
      expires: new Date(sessao.refreshDelivery.expiresAt),
    });
    return res.status(200).json({
      token: sessao.accessToken,
      user: {
        uid: user.id,
        nome: user.nome,
        email: user.email,
        role: user.tipo,
        status: user.status,
        empresa_id: user.empresa_id,
        is_super_admin: user.is_super_admin === true,
      },
    });
  });
  app.post('/auth/refresh', (req: any, res: any) => {
    res.set('X-SEC1-E2E-Cookie-Present', String(String(req.headers.cookie || '').includes('refresh_token=')));
    return authSessionController.refreshWeb(req, res);
  });
  app.post('/auth/logout', verify, (req: any, res: any) => authSessionController.logout(req, res));
  app.get('/auth/me', verify, async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    const { rows } = await db.query('SELECT * FROM public.usuarios WHERE id=$1', [req.user.uid]);
    return res.status(200).json({ ...rows[0], termos_pendentes: false, termos_pendentes_count: 0 });
  });

  return new Promise<HttpsServer>((resolveServer) => {
    const server = createHttpsServer({ key: readFile(tls.key), cert: readFile(tls.cert) }, app);
    server.listen(apiPort, '0.0.0.0', () => resolveServer(server));
  });
}

function readFile(path: string) {
  return backendRequire('fs').readFileSync(path);
}

async function startFrontend(tls: { key: string; cert: string }) {
  process.env.VITE_API_URL = apiOrigin;
  const server = await createViteServer({
    root: painelDir,
    logLevel: 'error',
    server: {
      host: '0.0.0.0',
      port: appPort,
      strictPort: true,
      https: { key: readFile(tls.key), cert: readFile(tls.cert) },
    },
  });
  await server.listen();
  return server;
}

function cookieHeaderValue(setCookie: string, name: string) {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

function decodeJwtPayload(token: string) {
  const payload = token.split('.')[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

async function latestSession() {
  const { rows } = await pool!.query(
    `SELECT id, refresh_family_id, revoked_at, revoke_reason
       FROM public.auth_sessions
      WHERE usuario_id=$1
      ORDER BY created_at DESC
      LIMIT 1`,
    [USER_ID],
  );
  return rows[0];
}

async function activeRefreshCount(sessionId: string) {
  const { rows } = await pool!.query(
    `SELECT count(*)::int AS c
       FROM public.auth_refresh_tokens
      WHERE session_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,
    [sessionId],
  );
  return rows[0].c;
}

async function auditEvents(sessionId: string) {
  const { rows } = await pool!.query(
    'SELECT event, resultado, motivo FROM public.auth_event_audit WHERE session_id=$1 ORDER BY created_at',
    [sessionId],
  );
  return rows;
}

async function setFirstRefreshUsedOutsideGrace(sessionId: string) {
  await pool!.query(
    `UPDATE public.auth_refresh_tokens
        SET used_at = now() - interval '30 seconds'
      WHERE session_id=$1 AND version=1`,
    [sessionId],
  );
}

async function loginViaApi(request: APIRequestContext) {
  const response = await request.post(`${apiDirectOrigin}/auth/login`, {
    headers: { Origin: appOrigin, Host: `${API_HOST}:${apiPort}` },
    data: { email: EMAIL, senha: SENHA, client_type: 'web' },
    ignoreHTTPSErrors: true,
  });
  expect(response.status()).toBe(200);
  return response.headers()['set-cookie'] || '';
}

async function postRefreshWithCookie(request: APIRequestContext, cookie: string, origin?: string, referer?: string) {
  const headers: Record<string, string> = {
    Cookie: cookie,
    Host: `${API_HOST}:${apiPort}`,
  };
  if (origin) headers.Origin = origin;
  if (referer) headers.Referer = referer;
  return request.post(`${apiDirectOrigin}/auth/refresh`, {
    headers,
    ignoreHTTPSErrors: true,
  });
}

async function gotoHarness(page: Page) {
  await page.goto(`${appOrigin}/tests-e2e-sec1/harness.html`);
  await page.waitForFunction(() => Boolean((window as any).sec1));
}

async function loginInPage(page: Page) {
  const loginResponsePromise = page.waitForResponse((r) => r.url().includes('/auth/login'));
  const result = await page.evaluate(() => (window as any).sec1.login());
  const loginResponse = await loginResponsePromise;
  expect(result.ok).toBe(true);
  return { result, loginResponse };
}

async function refreshCookieFromContext(context: BrowserContext) {
  const cookies = await context.cookies(`${apiOrigin}/auth/refresh`);
  return cookies.find((cookie) => cookie.name === 'refresh_token') || null;
}

async function waitRefreshCookie(context: BrowserContext) {
  return expect.poll(async () => {
    const cookie = await refreshCookieFromContext(context);
    return cookie ? {
      value: cookie.value,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
      domain: cookie.domain,
    } : null;
  }, { timeout: 5_000 }).not.toBeNull();
}

test.beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEC1_E2E_AUTH_FAKE = '1';
  appPort = await freePort();
  apiPort = await freePort();
  appOrigin = `https://${APP_HOST}:${appPort}`;
  apiOrigin = `https://${API_HOST}:${apiPort}`;
  apiDirectOrigin = `https://127.0.0.1:${apiPort}`;
  evilOrigin = `https://${EVIL_HOST}:${appPort}`;

  await applySchema();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  await seedFixture(pool);

  const tls = createLocalCertificate();
  apiServer = await startApiServer(tls, pool);
  viteServer = await startFrontend(tls);
});

test.afterAll(async () => {
  await viteServer?.close();
  await new Promise<void>((resolveClose) => apiServer?.close(() => resolveClose()));
  await pool?.end();
});

test('SEC-1 browser same-site: cookie web, refresh, duas abas, logout, CSRF, CORS, cache e reuse', async ({ page, context, request }) => {
  await test.step('login web cria refresh cookie HttpOnly/Secure/SameSite=Lax host-only sem vazar refresh', async () => {
    await gotoHarness(page);
    const { result, loginResponse } = await loginInPage(page);
    expect(result.data.refresh_token).toBeUndefined();
    expect(result.refreshTokenInLocalStorage).toBeNull();
    expect(result.data.token).toBeTruthy();
    expect(await page.evaluate(() => (window as any).sec1.authToken())).toBe(result.data.token);

    await waitRefreshCookie(context);
    const refreshCookie = await refreshCookieFromContext(context);
    expect(refreshCookie?.value).toBeTruthy();
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.secure).toBe(true);
    expect(refreshCookie?.sameSite).toBe('Lax');
    expect(refreshCookie?.path).toBe('/auth');
    expect(refreshCookie?.domain).toBe(API_HOST);
    expect(loginResponse.headers()['cache-control']).toContain('no-store');
    expect(loginResponse.headers()['access-control-allow-origin']).toBe(appOrigin);
    expect(loginResponse.headers()['access-control-allow-credentials']).toBe('true');
    expect(loginResponse.headers()['access-control-allow-origin']).not.toBe('*');
  });

  await test.step('refresh web usa cookie, nao Bearer, rotaciona cookie e preserva JSON sem refresh aberto', async () => {
    const refreshAntes = await refreshCookieFromContext(context);
    await page.evaluate(() => (window as any).sec1.poisonAccess());
    const refreshResponsePromise = page.waitForResponse((r) => r.url().includes('/auth/refresh'));
    const result = await page.evaluate(() => (window as any).sec1.me());
    const refreshResponse = await refreshResponsePromise;
    expect(result.ok).toBe(true);
    expect(refreshResponse.status()).toBe(200);
    expect(refreshResponse.request().headers()['authorization']).toBeUndefined();
    expect(refreshResponse.headers()['x-sec1-e2e-cookie-present']).toBe('true');
    const body = await refreshResponse.json();
    expect(body.token).toBeTruthy();
    expect(body.refresh_token).toBeUndefined();
    const refreshDepois = await refreshCookieFromContext(context);
    expect(refreshDepois?.value).toBeTruthy();
    expect(refreshDepois?.value).not.toBe(refreshAntes?.value);
    expect(refreshResponse.headers()['cache-control']).toContain('no-store');
    expect(decodeJwtPayload(result.token).sid).toBeTruthy();
  });

  await test.step('duas abas: colisao RefreshAlreadyRotated nao encerra sessao e ambas recuperam access', async () => {
    const secondPage = await context.newPage();
    await gotoHarness(secondPage);
    await secondPage.evaluate(() => (window as any).sec1.authToken());

    const refreshes: Array<{ status: number; body: any }> = [];
    for (const p of [page, secondPage]) {
      p.on('response', async (response) => {
        if (response.url().includes('/auth/refresh')) {
          let body: any = null;
          try { body = await response.json(); } catch { body = null; }
          refreshes.push({ status: response.status(), body });
        }
      });
    }

    await Promise.all([
      page.evaluate(() => (window as any).sec1.poisonAccess()),
      secondPage.evaluate(() => (window as any).sec1.poisonAccess()),
    ]);
    const [a, b] = await Promise.all([
      page.evaluate(() => (window as any).sec1.me()),
      secondPage.evaluate(() => (window as any).sec1.me()),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await page.evaluate(() => (window as any).sec1.events())).toEqual({ unauthorized: 0, rateLimited: 0 });
    expect(await secondPage.evaluate(() => (window as any).sec1.events())).toEqual({ unauthorized: 0, rateLimited: 0 });

    expect(refreshes.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(refreshes.some((r) => r.body?.error === 'RefreshAlreadyRotated')).toBe(true);

    const session = await latestSession();
    expect(session.revoked_at).toBeNull();
    expect(await activeRefreshCount(session.id)).toBe(1);
    const events = await auditEvents(session.id);
    expect(events.some((e: any) => e.event === 'refresh_colisao' && e.resultado === 'refresh_already_rotated')).toBe(true);

    expect((await page.evaluate(() => (window as any).sec1.me())).ok).toBe(true);
    expect((await secondPage.evaluate(() => (window as any).sec1.me())).ok).toBe(true);
    await secondPage.close();
  });

  await test.step('logout revoga server-side, remove cookie e chamadas subsequentes exigem nova autenticacao', async () => {
    const logoutResponsePromise = page.waitForResponse((r) => r.url().includes('/auth/logout'));
    const result = await page.evaluate(() => (window as any).sec1.logout());
    const logoutResponse = await logoutResponsePromise;
    expect(result.ok).toBe(true);
    expect(await refreshCookieFromContext(context)).toBeNull();
    expect(logoutResponse.headers()['cache-control']).toContain('no-store');
    const session = await latestSession();
    expect(session.revoked_at).not.toBeNull();
    const afterLogout = await page.evaluate(() => (window as any).sec1.me());
    expect(afterLogout.ok).toBe(false);
    expect([401, 403]).toContain(afterLogout.status);
  });

  await test.step('CSRF e cache: origins/referers seguem contrato sem relaxar CORS', async () => {
    const allowedCookie = await loginViaApi(request);
    const allowed = await postRefreshWithCookie(request, allowedCookie, appOrigin);
    expect(allowed.status()).toBe(200);
    expect(allowed.headers()['cache-control']).toContain('no-store');

    const evilCookie = await loginViaApi(request);
    const evil = await postRefreshWithCookie(request, evilCookie, evilOrigin);
    expect(evil.status()).toBe(403);
    expect((await evil.json()).error).toBe('CsrfRejected');

    const refererCookie = await loginViaApi(request);
    const referer = await postRefreshWithCookie(request, refererCookie, undefined, `${appOrigin}/alguma-rota`);
    expect(referer.status()).toBe(200);

    const noOriginCookie = await loginViaApi(request);
    const noOrigin = await postRefreshWithCookie(request, noOriginCookie);
    expect(noOrigin.status()).toBe(403);
    expect((await noOrigin.json()).error).toBe('CsrfRejected');
  });

  await test.step('reuse real fora da grace revoga familia/sessao e audita RefreshReuseDetected', async () => {
    const loginCookie = await loginViaApi(request);
    const oldRefresh = cookieHeaderValue(loginCookie, 'refresh_token');
    expect(oldRefresh).toBeTruthy();
    const firstRefresh = await postRefreshWithCookie(request, loginCookie, appOrigin);
    expect(firstRefresh.status()).toBe(200);
    const session = await latestSession();
    await setFirstRefreshUsedOutsideGrace(session.id);
    const reuse = await postRefreshWithCookie(request, `refresh_token=${oldRefresh}`, appOrigin);
    expect(reuse.status()).toBe(401);
    expect((await reuse.json()).error).toBe('RefreshReuseDetected');
    const revoked = await latestSession();
    expect(revoked.revoked_at).not.toBeNull();
    expect(revoked.revoke_reason).toBe('refresh_reuse_detected');
    const events = await auditEvents(revoked.id);
    expect(events.some((e: any) => e.event === 'refresh_reuse' && e.resultado === 'reuse_detected')).toBe(true);
    const again = await postRefreshWithCookie(request, firstRefresh.headers()['set-cookie'] || '', appOrigin);
    expect([401, 403]).toContain(again.status());
  });

  await test.step('same-site baseline: fluxo completo funciona sem depender de third-party', async () => {
    const allowedContext = context;
    const allowedPage = await allowedContext.newPage();
    await gotoHarness(allowedPage);
    const { result } = await loginInPage(allowedPage);
    expect(result.ok).toBe(true);
    await allowedPage.evaluate(() => (window as any).sec1.poisonAccess());
    const refreshed = await allowedPage.evaluate(() => (window as any).sec1.me());
    expect(refreshed.ok).toBe(true);
    await allowedPage.close();
  });

  await test.step('third-party cookies bloqueados: fluxo same-site continua funcionando', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'sec1-e2e-blocked-'));
    const blockedContext = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      ignoreHTTPSErrors: true,
      args: [
        `--host-resolver-rules=MAP ${APP_HOST} 127.0.0.1,MAP ${API_HOST} 127.0.0.1,MAP ${EVIL_HOST} 127.0.0.1`,
        '--ignore-certificate-errors',
        '--block-third-party-cookies',
      ],
    });
    try {
      const blockedPage = blockedContext.pages()[0] || await blockedContext.newPage();
      await gotoHarness(blockedPage);
      const { result } = await loginInPage(blockedPage);
      await blockedPage.evaluate(() => (window as any).sec1.poisonAccess());
      const refreshed = await blockedPage.evaluate(() => (window as any).sec1.me());
      const storedCookie = await refreshCookieFromContext(blockedContext);
      const classification = result.ok && refreshed.ok && storedCookie?.sameSite === 'Lax'
        ? 'SAME_SITE_COOKIE_OK_WITH_THIRD_PARTY_BLOCKED'
        : 'ARCH-BLOCKER-WEB-COOKIE';
      console.log(`SEC1_SAME_SITE_THIRD_PARTY_BLOCKED_RESULT=${classification}; login=${result.status}; refreshFlow=${refreshed.status}`);
      expect(classification).toBe('SAME_SITE_COOKIE_OK_WITH_THIRD_PARTY_BLOCKED');
    } finally {
      await blockedContext.close();
    }
  });
});
