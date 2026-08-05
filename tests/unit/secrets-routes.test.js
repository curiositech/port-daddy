import { jest } from '@jest/globals';
import Fastify from 'fastify';

// ─────────────────────────────────────────────────────────────────────────
// In-memory keychain stub. We do NOT touch the operator's real keychain.
// The stub mirrors lib/keychain.ts's surface (available/load/save/delete)
// and stores base64-of-value to match the real round-trip shape.
// ─────────────────────────────────────────────────────────────────────────
const store = new Map();
const keyOf = (service, account) => `${service}::${account}`;

const mockKeychain = {
  available: () => true,
  loadSecret: (service, account) => {
    const v = store.get(keyOf(service, account));
    return v === undefined ? null : v;
  },
  saveSecret: (service, account, value) => {
    store.set(keyOf(service, account), value);
    return true;
  },
  deleteSecret: (service, account) => store.delete(keyOf(service, account)),
};

jest.unstable_mockModule('../../lib/keychain.js', () => ({
  keychain: mockKeychain,
  KEYCHAIN_SERVICE: 'port-daddy',
}));

const { secretsPlugin } = await import('../../routes/secrets.js');
const secretEnv = await import('../../lib/secret-env.js');

async function buildApp(remoteIp) {
  const app = Fastify({
    // Allow us to forge a non-loopback remote for the reveal-guard test.
    trustProxy: true,
  });
  await app.register(secretsPlugin, { deps: { logger: { info: jest.fn(), warn: jest.fn() } } });
  await app.ready();
  return app;
}

const ALLOWED = 'ANTHROPIC_API_KEY';
const SECRET_VALUE = 'sk-ant-test-do-not-log-123';

describe('secrets routes', () => {
  beforeEach(() => {
    store.clear();
    // Reset the in-module cache between tests (test env only).
    process.env.NODE_ENV = 'test';
    secretEnv._resetForTests();
  });

  test('GET /secrets returns names + status, never values', async () => {
    const app = await buildApp();
    secretEnv.saveManagedSecret(ALLOWED, SECRET_VALUE);

    const res = await app.inject({ method: 'GET', url: '/secrets' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.secrets)).toBe(true);

    const entry = body.secrets.find((s) => s.key === ALLOWED);
    expect(entry).toBeDefined();
    expect(entry.set).toBe(true);
    expect(entry.storage).toBe('keychain');
    expect(entry.encryptedAtRest).toBe(true);

    // Crucially: the value must NOT appear anywhere in the payload.
    expect(res.payload).not.toContain(SECRET_VALUE);
    expect(entry).not.toHaveProperty('value');

    await app.close();
  });

  test('GitHub webhook transport and origin keys are managed credentials', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/secrets' });
    const keys = res.json().secrets.map((secret) => secret.key);

    expect(keys).toContain('PD_GITHUB_FORWARD_TOKEN');
    expect(keys).toContain('PD_GITHUB_WEBHOOK_SECRET');

    await app.close();
  });

  test('POST /secrets then GET shows set:true', async () => {
    const app = await buildApp();

    const set = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { key: ALLOWED, value: SECRET_VALUE },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().success).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/secrets' });
    const entry = list.json().secrets.find((s) => s.key === ALLOWED);
    expect(entry.set).toBe(true);

    await app.close();
  });

  test('POST /secrets never echoes the value in the response body', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { key: ALLOWED, value: SECRET_VALUE },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(SECRET_VALUE);
    expect(res.json()).not.toHaveProperty('value');
    await app.close();
  });

  test('POST /secrets rejects an unknown (non-allow-listed) key', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { key: 'NOT_A_REAL_SECRET', value: 'whatever' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Unsupported managed secret key/);
    expect(Array.isArray(body.allowedKeys)).toBe(true);
    await app.close();
  });

  test('reveal returns the value for a set key', async () => {
    const app = await buildApp();
    secretEnv.saveManagedSecret(ALLOWED, SECRET_VALUE);

    const res = await app.inject({
      method: 'POST',
      url: `/secrets/${ALLOWED}/reveal`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.key).toBe(ALLOWED);
    expect(body.value).toBe(SECRET_VALUE);
    await app.close();
  });

  test('reveal returns 404 on an unset (but allow-listed) key', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/secrets/${ALLOWED}/reveal`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
    await app.close();
  });

  test('reveal rejects a non-loopback caller (403)', async () => {
    const app = await buildApp();
    secretEnv.saveManagedSecret(ALLOWED, SECRET_VALUE);

    const res = await app.inject({
      method: 'POST',
      url: `/secrets/${ALLOWED}/reveal`,
      payload: {},
      // Forge a public remote address via X-Forwarded-For (trustProxy on).
      headers: { 'x-forwarded-for': '203.0.113.7' },
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(403);
    expect(res.payload).not.toContain(SECRET_VALUE);
    await app.close();
  });

  test('POST /secrets rejects a non-loopback caller (403) and does NOT write', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/secrets',
      payload: { key: ALLOWED, value: SECRET_VALUE },
      headers: { 'x-forwarded-for': '203.0.113.7' },
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(403);
    // The handler must not have run: the credential is still unset.
    const list = await app.inject({ method: 'GET', url: '/secrets' });
    const entry = list.json().secrets.find((s) => s.key === ALLOWED);
    expect(entry.set).toBe(false);
    await app.close();
  });

  test('DELETE /secrets/:key rejects a non-loopback caller (403) and does NOT delete', async () => {
    const app = await buildApp();
    secretEnv.saveManagedSecret(ALLOWED, SECRET_VALUE);

    const res = await app.inject({
      method: 'DELETE',
      url: `/secrets/${ALLOWED}`,
      headers: { 'x-forwarded-for': '203.0.113.7' },
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(403);
    // The handler must not have run: the credential is still present (loopback reveal works).
    const reveal = await app.inject({
      method: 'POST',
      url: `/secrets/${ALLOWED}/reveal`,
      payload: {},
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().value).toBe(SECRET_VALUE);
    await app.close();
  });

  test('DELETE /secrets/:key removes the value', async () => {
    const app = await buildApp();
    secretEnv.saveManagedSecret(ALLOWED, SECRET_VALUE);

    const del = await app.inject({ method: 'DELETE', url: `/secrets/${ALLOWED}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().success).toBe(true);
    expect(del.json().removed).toBe(true);

    const reveal = await app.inject({
      method: 'POST',
      url: `/secrets/${ALLOWED}/reveal`,
      payload: {},
    });
    expect(reveal.statusCode).toBe(404);
    await app.close();
  });
});
