import { jest } from '@jest/globals';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { generateKeyPairSync } from 'node:crypto';

const { relayPlugin } = await import('../../routes/relay.js');

// ─────────────────────────────────────────────────────────────────────────
// Hermetic in-memory DB with just the tables the relay route touches:
//   config                     — relay_url storage (lib/relay-client.ts)
//   harbor_token_signing_keys  — daemon Phase 2 Ed25519 key (lib/harbor-tokens.ts)
// We own this fixture; we never touch the operator's registry DB.
// ─────────────────────────────────────────────────────────────────────────
const PHASE2_KID = 'harbor-daemon-ed25519-v1';

function makeDb({ withKey = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE harbor_token_signing_keys (
      id TEXT PRIMARY KEY,
      alg TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      public_key_pem TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  if (withKey) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    db.prepare(
      'INSERT INTO harbor_token_signing_keys (id, alg, private_key_pem, public_key_pem, created_at) VALUES (?,?,?,?,?)',
    ).run(PHASE2_KID, 'EdDSA', privatePem, publicPem, Date.now());
  }
  return db;
}

const NOT_CONNECTED = {
  connected: false,
  session_id: null,
  last_handshake: null,
  accepted_channels: [],
  relay_version: null,
};

async function buildApp(db, { logger } = {}) {
  const app = Fastify({ trustProxy: true }); // lets us forge a non-loopback peer
  await app.register(relayPlugin, {
    deps: {
      db,
      getRelayStatus: () => NOT_CONNECTED,
      logger: logger ?? { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    },
  });
  await app.ready();
  return app;
}

const REMOTE = { 'x-forwarded-for': '203.0.113.7' };

describe('relay routes — reachability', () => {
  test('GET /relay/config returns relay_url (null when unset)', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/relay/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ relay_url: null });
    await app.close();
    db.close();
  });

  test('GET /relay/status reports honest not-connected status', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/relay/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.relay_url).toBeNull();
    await app.close();
    db.close();
  });
});

describe('relay routes — loopback guard (defense in depth)', () => {
  test('POST /relay/config rejects a non-loopback caller (403) and does NOT write', async () => {
    const db = makeDb();
    const warn = jest.fn();
    const app = await buildApp(db, { logger: { info: jest.fn(), warn, error: jest.fn() } });

    const res = await app.inject({
      method: 'POST',
      url: '/relay/config',
      payload: { relay_url: 'https://relay.portdaddy.dev' },
      headers: REMOTE,
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('LOOPBACK_ONLY');
    expect(warn).toHaveBeenCalledWith('relay_config_blocked_non_loopback', expect.any(Object));

    // The handler must not have run — config is still empty.
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get('relay_url');
    expect(row).toBeUndefined();
    await app.close();
    db.close();
  });

  test('POST /relay/exchange rejects a non-loopback caller (403)', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const res = await app.inject({
      method: 'POST',
      url: '/relay/exchange',
      payload: { oidc_token: 'x' },
      headers: REMOTE,
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('LOOPBACK_ONLY');
    await app.close();
    db.close();
  });

  test('GET routes are NOT loopback-guarded (status-only, safe from Host-validated callers)', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const cfg = await app.inject({ method: 'GET', url: '/relay/config', headers: REMOTE, remoteAddress: '203.0.113.7' });
    expect(cfg.statusCode).toBe(200);
    await app.close();
    db.close();
  });
});

describe('relay routes — SSRF guard on POST /relay/config', () => {
  async function postConfig(relay_url) {
    const db = makeDb();
    const app = await buildApp(db);
    // Loopback peer (default inject remoteAddress is 127.0.0.1) → passes guard.
    const res = await app.inject({ method: 'POST', url: '/relay/config', payload: { relay_url } });
    const body = res.json();
    await app.close();
    db.close();
    return { status: res.statusCode, body };
  }

  test('rejects cloud-metadata host', async () => {
    const { status, body } = await postConfig('http://169.254.169.254/latest/meta-data');
    expect(status).toBe(400);
    expect(['SSRF_BLOCKED', 'INSECURE_SCHEME']).toContain(body.code);
  });

  test('rejects https to a private RFC1918 host', async () => {
    const { status, body } = await postConfig('https://10.1.2.3');
    expect(status).toBe(400);
    expect(body.code).toBe('SSRF_BLOCKED');
  });

  test('rejects https to a 192.168/16 host', async () => {
    const { status, body } = await postConfig('https://192.168.0.10:9000');
    expect(status).toBe(400);
    expect(body.code).toBe('SSRF_BLOCKED');
  });

  test('rejects plaintext http:// to a remote host', async () => {
    const { status, body } = await postConfig('http://relay.example.test');
    expect(status).toBe(400);
    expect(body.code).toBe('INSECURE_SCHEME');
  });

  test('rejects a non-URL value', async () => {
    const { status, body } = await postConfig('::: not a url :::');
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_URL');
  });

  test('rejects a non-http(s) scheme (e.g. file:)', async () => {
    const { status, body } = await postConfig('file:///etc/passwd');
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_SCHEME');
  });

  test('accepts a valid https remote relay_url', async () => {
    const { status, body } = await postConfig('https://relay.portdaddy.dev');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.relay_url).toBe('https://relay.portdaddy.dev');
  });

  test('accepts loopback http:// (local relay dev)', async () => {
    const { status, body } = await postConfig('http://127.0.0.1:8787');
    expect(status).toBe(200);
    expect(body.relay_url).toBe('http://127.0.0.1:8787');
  });

  test('accepts clearing relay_url with null', async () => {
    const db = makeDb();
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('relay_url', 'https://relay.portdaddy.dev');
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/relay/config', payload: { relay_url: null } });
    expect(res.statusCode).toBe(200);
    expect(res.json().relay_url).toBeNull();
    expect(db.prepare('SELECT value FROM config WHERE key = ?').get('relay_url')).toBeUndefined();
    await app.close();
    db.close();
  });
});

describe('relay routes — POST /relay/exchange', () => {
  test('400 NO_RELAY when no relay_url configured', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/relay/exchange', payload: { oidc_token: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_RELAY');
    await app.close();
    db.close();
  });

  test('400 MISSING_FIELDS when oidc_token absent (relay configured)', async () => {
    const db = makeDb({ withKey: true });
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('relay_url', 'https://relay.portdaddy.dev');
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/relay/exchange', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MISSING_FIELDS');
    await app.close();
    db.close();
  });

  test('500 NO_KEY when daemon Phase 2 keypair not initialized', async () => {
    const db = makeDb({ withKey: false }); // table exists, no row
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('relay_url', 'https://relay.portdaddy.dev');
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/relay/exchange', payload: { oidc_token: 'x' } });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('NO_KEY');
    await app.close();
    db.close();
  });

  test('re-validates a stored SSRF relay_url before the outbound fetch (no key needed — SSRF check first)', async () => {
    // A private relay_url could have been stored by an older daemon. The
    // exchange handler must block it BEFORE any outbound fetch, even with a
    // valid oidc_token + key present.
    const db = makeDb({ withKey: true });
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('relay_url', 'https://10.0.0.9');
    const app = await buildApp(db);
    const res = await app.inject({ method: 'POST', url: '/relay/exchange', payload: { oidc_token: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('SSRF_BLOCKED');
    await app.close();
    db.close();
  });

  test('reaches the outbound fetch with a valid key + safe relay_url (fetch stubbed)', async () => {
    const db = makeDb({ withKey: true });
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('relay_url', 'https://relay.portdaddy.dev');
    const app = await buildApp(db);

    const origFetch = globalThis.fetch;
    let calledUrl = null;
    globalThis.fetch = jest.fn(async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ card: 'CARD', exp: 9999999999 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/relay/exchange',
        payload: { oidc_token: 'tok', cap: [{ op: 'pub', channel: 'x' }] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().card).toBe('CARD');
      expect(calledUrl).toBe('https://relay.portdaddy.dev/v1/exchange');
    } finally {
      globalThis.fetch = origFetch;
      await app.close();
      db.close();
    }
  });
});
