import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { githubWebhookPlugin } from '../../routes/github-webhook.js';

const GITHUB_ENV_KEYS = [
  'PD_GITHUB_FORWARD_TOKEN',
  'PD_GITHUB_WEBHOOK_SECRET',
  'PD_GITHUB_WEBHOOK_ALLOW_UNAUTH',
  'PD_GITHUB_REQUIRE_ORIGIN_HMAC',
  'PD_GITHUB_MAX_DISPATCH_PER_MIN',
];

function snapshotEnv() {
  const saved = {};
  for (const key of GITHUB_ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved) {
  for (const key of GITHUB_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function buildDeps(overrides = {}) {
  const published = [];
  return {
    published,
    logger: { info() {}, error() {} },
    metrics: { errors: 0, messages_published: 0 },
    messaging: {
      publish(channel, payload, opts) {
        published.push({ channel, payload, opts });
        return { id: published.length };
      },
    },
    ...overrides,
  };
}

/** A receiver-forwarded envelope (the primary path). */
function envelope(overrides = {}) {
  return {
    received_at: '2026-06-03T18:04:11.812Z',
    event: 'pull_request',
    delivery: '01HXP6ABC',
    action: 'opened',
    repository: { full_name: 'curiositech/port-daddy', id: 100 },
    installation_id: 9999,
    sender: { login: 'octocat', id: 1 },
    payload: {
      action: 'opened',
      pull_request: { number: 7, html_url: 'https://github.com/curiositech/port-daddy/pull/7', title: 'Add X' },
      repository: { full_name: 'curiositech/port-daddy' },
      sender: { login: 'octocat' },
    },
    ...overrides,
  };
}

/**
 * A forwarded envelope that carries the exact signed bytes + a GitHub signature
 * computed under `secret`, the way an origin-aware receiver sends them.
 */
function signedEnvelope(secret, overrides = {}) {
  const rawPayload = JSON.stringify({
    action: 'opened',
    pull_request: { number: 7, title: 'Add X' },
    repository: { full_name: 'curiositech/port-daddy' },
    sender: { login: 'octocat' },
  });
  const signature = 'sha256=' + createHmac('sha256', secret).update(rawPayload).digest('hex');
  return envelope({ raw_payload: rawPayload, signature, ...overrides });
}

async function buildApp(deps) {
  const app = Fastify();
  await app.register(githubWebhookPlugin, { deps });
  return app;
}

describe('POST /webhooks/github — inbound GitHub webhook → fleet channel', () => {
  let savedEnv;
  beforeEach(() => {
    savedEnv = snapshotEnv();
    for (const key of GITHUB_ENV_KEYS) delete process.env[key];
  });
  afterEach(() => restoreEnv(savedEnv));

  test('401 when no auth method is configured', async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({ method: 'POST', url: '/webhooks/github', payload: envelope() });
    expect(res.statusCode).toBe(401);
    expect(deps.published).toHaveLength(0);
    await app.close();
  });

  test('valid bearer publishes event, action, and repo-keyed channels, returns 204', async () => {
    process.env.PD_GITHUB_FORWARD_TOKEN = 'sekret-forward-token';
    const deps = buildDeps();
    const app = await buildApp(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { authorization: 'Bearer sekret-forward-token' },
      payload: envelope(),
    });

    expect(res.statusCode).toBe(204);
    const channels = deps.published.map((p) => p.channel);
    expect(channels).toEqual(expect.arrayContaining([
      'github:webhook:pull_request',
      'github:webhook:pull_request:opened',
      'github:curiositech/port-daddy:pull_request',
    ]));

    // Published payload carries normalized routing fields + raw payload + sender.
    const base = deps.published.find((p) => p.channel === 'github:webhook:pull_request');
    expect(base.payload).toEqual(expect.objectContaining({
      event: 'pull_request',
      action: 'opened',
      delivery: '01HXP6ABC',
      repository: expect.objectContaining({ full_name: 'curiositech/port-daddy' }),
    }));
    expect(base.payload.payload).toEqual(expect.objectContaining({ pull_request: expect.any(Object) }));
    expect(base.opts).toEqual(expect.objectContaining({ sender: 'octocat' }));
    await app.close();
  });

  test('wrong bearer is rejected with 401 and publishes nothing', async () => {
    process.env.PD_GITHUB_FORWARD_TOKEN = 'sekret-forward-token';
    const deps = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { authorization: 'Bearer wrong' },
      payload: envelope(),
    });
    expect(res.statusCode).toBe(401);
    expect(deps.published).toHaveLength(0);
    await app.close();
  });

  test('direct GitHub webhook with valid HMAC signature is accepted (raw body)', async () => {
    process.env.PD_GITHUB_WEBHOOK_SECRET = 'hmac-secret';
    const deps = buildDeps();
    const app = await buildApp(deps);

    // Raw GitHub payload (not the receiver envelope): event comes from header.
    const rawBody = JSON.stringify({
      action: 'opened',
      issue: { number: 3, html_url: 'https://github.com/curiositech/port-daddy/issues/3', title: 'Bug' },
      repository: { full_name: 'curiositech/port-daddy' },
      sender: { login: 'hubot' },
    });
    const sig = 'sha256=' + createHmac('sha256', 'hmac-secret').update(rawBody).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-hub-signature-256': sig,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(204);
    const channels = deps.published.map((p) => p.channel);
    expect(channels).toEqual(expect.arrayContaining([
      'github:webhook:issues',
      'github:webhook:issues:opened',
      'github:curiositech/port-daddy:issues',
    ]));
    await app.close();
  });

  test('invalid HMAC signature is rejected with 401', async () => {
    process.env.PD_GITHUB_WEBHOOK_SECRET = 'hmac-secret';
    const deps = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issues',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      payload: JSON.stringify({ action: 'opened', repository: { full_name: 'a/b' } }),
    });
    expect(res.statusCode).toBe(401);
    expect(deps.published).toHaveLength(0);
    await app.close();
  });

  // --- GitHub origin re-verification on the forwarded (bearer) path ---------
  // A trusted forward token proves the FORWARDER, not GitHub. These tests pin
  // that a valid forward token alone cannot forge fleet-triggering events.

  test('SECURITY: valid forward token but FORGED payload (bad signature) is rejected — no dispatch', async () => {
    process.env.PD_GITHUB_FORWARD_TOKEN = 'sekret-forward-token';
    process.env.PD_GITHUB_WEBHOOK_SECRET = 'hmac-secret';
    const deps = buildDeps();
    const app = await buildApp(deps);

    // Attacker holds the forward token and crafts an envelope, but cannot
    // produce a valid GitHub signature over their forged body.
    const forged = envelope({
      raw_payload: JSON.stringify({ action: 'closed', pull_request: { number: 666 } }),
      signature: 'sha256=' + 'de'.repeat(32), // not a real HMAC under the secret
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { authorization: 'Bearer sekret-forward-token' },
      payload: forged,
    });

    expect(res.statusCode).toBe(401);
    expect(deps.published).toHaveLength(0);
    await app.close();
  });

  test('forwarded envelope with a VALID GitHub signature re-verifies and dispatches (204)', async () => {
    process.env.PD_GITHUB_FORWARD_TOKEN = 'sekret-forward-token';
    process.env.PD_GITHUB_WEBHOOK_SECRET = 'hmac-secret';
    const deps = buildDeps();
    const app = await buildApp(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { authorization: 'Bearer sekret-forward-token' },
      payload: signedEnvelope('hmac-secret'),
    });

    expect(res.statusCode).toBe(204);
    expect(deps.published.map((p) => p.channel)).toEqual(expect.arrayContaining([
      'github:webhook:pull_request',
    ]));
    await app.close();
  });

  test('strict mode (PD_GITHUB_REQUIRE_ORIGIN_HMAC=1) rejects a forwarded envelope that carries no signature', async () => {
    process.env.PD_GITHUB_FORWARD_TOKEN = 'sekret-forward-token';
    process.env.PD_GITHUB_WEBHOOK_SECRET = 'hmac-secret';
    process.env.PD_GITHUB_REQUIRE_ORIGIN_HMAC = '1';
    const deps = buildDeps();
    const app = await buildApp(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { authorization: 'Bearer sekret-forward-token' },
      payload: envelope(), // legacy envelope, no raw_payload/signature
    });

    expect(res.statusCode).toBe(401);
    expect(deps.published).toHaveLength(0);
    await app.close();
  });

  test('non-strict back-compat: legacy receiver (no signature, no secret) still dispatches on bearer', async () => {
    process.env.PD_GITHUB_FORWARD_TOKEN = 'sekret-forward-token';
    // No PD_GITHUB_WEBHOOK_SECRET, not strict: an old receiver keeps working.
    const deps = buildDeps();
    const app = await buildApp(deps);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { authorization: 'Bearer sekret-forward-token' },
      payload: envelope(),
    });

    expect(res.statusCode).toBe(204);
    expect(deps.published.length).toBeGreaterThan(0);
    await app.close();
  });

  // --- Class-2 cost-griefing defenses: delivery dedup + per-installation cap ----

  test('duplicate X-GitHub-Delivery is de-duplicated (200, no second dispatch)', async () => {
    process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH = '1';
    const deps = buildDeps();
    const app = await buildApp(deps);

    const first = await app.inject({ method: 'POST', url: '/webhooks/github', payload: envelope() });
    expect(first.statusCode).toBe(204);
    const afterFirst = deps.published.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Same delivery UUID again (GitHub redelivery) — dropped, no new publishes.
    const second = await app.inject({ method: 'POST', url: '/webhooks/github', payload: envelope() });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload).deduplicated).toBe(true);
    expect(deps.published.length).toBe(afterFirst);
    await app.close();
  });

  test('per-installation dispatch rate cap returns 429 over the limit, publishing nothing further', async () => {
    process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH = '1';
    process.env.PD_GITHUB_MAX_DISPATCH_PER_MIN = '2';
    const deps = buildDeps();
    const app = await buildApp(deps);

    // Same installation (9999), distinct deliveries so dedup does not interfere.
    const r1 = await app.inject({ method: 'POST', url: '/webhooks/github', payload: envelope({ delivery: 'd-1' }) });
    const r2 = await app.inject({ method: 'POST', url: '/webhooks/github', payload: envelope({ delivery: 'd-2' }) });
    expect(r1.statusCode).toBe(204);
    expect(r2.statusCode).toBe(204);
    const publishedBefore = deps.published.length;

    const r3 = await app.inject({ method: 'POST', url: '/webhooks/github', payload: envelope({ delivery: 'd-3' }) });
    expect(r3.statusCode).toBe(429);
    expect(r3.headers['retry-after']).toBe('60');
    expect(deps.published.length).toBe(publishedBefore); // throttled before publish
    await app.close();
  });

  test('allow-unauth bypass accepts without credentials (dev only)', async () => {
    process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH = '1';
    const deps = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: { 'x-github-event': 'push' },
      payload: { repository: { full_name: 'curiositech/port-daddy' } },
    });
    expect(res.statusCode).toBe(204);
    expect(deps.published.map((p) => p.channel)).toEqual(expect.arrayContaining([
      'github:webhook:push',
      'github:curiositech/port-daddy:push',
    ]));
    await app.close();
  });

  test('400 when the event cannot be determined', async () => {
    process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH = '1';
    const deps = buildDeps();
    const app = await buildApp(deps);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      payload: { repository: { full_name: 'curiositech/port-daddy' } }, // no event, no header
    });
    expect(res.statusCode).toBe(400);
    expect(deps.published).toHaveLength(0);
    await app.close();
  });
});
