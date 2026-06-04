import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { githubWebhookPlugin } from '../../routes/github-webhook.js';

const GITHUB_ENV_KEYS = [
  'PD_GITHUB_FORWARD_TOKEN',
  'PD_GITHUB_WEBHOOK_SECRET',
  'PD_GITHUB_WEBHOOK_ALLOW_UNAUTH',
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
