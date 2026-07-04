// tests/unit/fleet-push-notifications.test.js
//
// Web Push delivery for trust-gate approval gates. Pins the
// mobile-push-notification-expert gates that carry security/UX weight:
//   - Subscription lifecycle: upsert-by-endpoint (browsers rotate
//     subscriptions), dead-endpoint pruning on 404/410 (token cleanup) —
//     but transient failures NEVER unsubscribe a live device.
//   - Grouping: approval pushes share one tag/topic so ten pending gates
//     collapse instead of spamming.
//   - Data minimization: the push body is agent/trigger/tier/project —
//     never trigger event content.
//   - VAPID keypair generated once and persisted (0600), reused across
//     restarts.

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

const { FleetPushNotifier, setSharedPushNotifier } = await import('../../lib/fleet/push-notifications.js');
const { fleetPushPlugin } = await import('../../routes/fleet-push.js');
const { FleetApprovalStream } = await import('../../lib/fleet/approval-stream.js');

function makeScratch() {
  const home = process.env.HOME || '';
  try {
    return mkdtempSync(join(home, 'coding', 'tmp', 'pd-push-test-'));
  } catch {
    return mkdtempSync(join(tmpdir(), 'pd-push-test-'));
  }
}

function fakeWebpush() {
  const sent = [];
  let generateCalls = 0;
  const failWith = new Map(); // endpoint -> statusCode
  return {
    sent,
    failWith,
    get generateCalls() { return generateCalls; },
    generateVAPIDKeys() {
      generateCalls += 1;
      return { publicKey: `pub-${generateCalls}`, privateKey: `priv-${generateCalls}` };
    },
    setVapidDetails() {},
    async sendNotification(subscription, payload, options) {
      const code = failWith.get(subscription.endpoint);
      if (code) {
        const err = new Error(`push service says ${code}`);
        err.statusCode = code;
        throw err;
      }
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options });
    },
  };
}

function sub(endpoint) {
  return { endpoint, keys: { p256dh: 'p', auth: 'a' } };
}

function notifier(dir, wp, extra = {}) {
  return new FleetPushNotifier({
    webpush: wp,
    vapidPath: join(dir, 'vapid.json'),
    subscriptionsPath: join(dir, 'subs.json'),
    ...extra,
  });
}

describe('FleetPushNotifier', () => {
  let dir;
  beforeEach(() => { dir = makeScratch(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('VAPID keypair is generated once and persisted across instances', async () => {
    const wp = fakeWebpush();
    const first = await notifier(dir, wp).publicKey();
    expect(first).toBe('pub-1');
    // A NEW instance (daemon restart) reads the persisted pair.
    const second = await notifier(dir, wp).publicKey();
    expect(second).toBe('pub-1');
    expect(wp.generateCalls).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8')).privateKey).toBe('priv-1');
  });

  test('subscription upsert-by-endpoint (refresh replaces, never duplicates)', () => {
    const n = notifier(dir, fakeWebpush());
    n.addSubscription(sub('https://push.example/one'));
    n.addSubscription({ endpoint: 'https://push.example/one', keys: { p256dh: 'p2', auth: 'a2' } });
    const subs = n.listSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].keys.p256dh).toBe('p2'); // newest keys win
    expect(() => n.addSubscription({ endpoint: '', keys: {} })).toThrow(/malformed/);
  });

  test('sendToAll prunes 410-Gone endpoints but keeps transiently-failing ones', async () => {
    const wp = fakeWebpush();
    const n = notifier(dir, wp);
    n.addSubscription(sub('https://push.example/live'));
    n.addSubscription(sub('https://push.example/gone'));
    n.addSubscription(sub('https://push.example/flaky'));
    wp.failWith.set('https://push.example/gone', 410);
    wp.failWith.set('https://push.example/flaky', 500);

    const result = await n.sendToAll({ title: 't', body: 'b', tag: 'g', deepLink: '/x' });
    expect(result).toEqual({ sent: 1, pruned: 1, failed: 1 });
    const remaining = n.listSubscriptions().map((s) => s.endpoint).sort();
    // Gone is pruned; the flaky-but-live device is KEPT.
    expect(remaining).toEqual(['https://push.example/flaky', 'https://push.example/live']);
  });

  test('approval gates push grouped, minimized payloads; resolutions do not push', async () => {
    const wp = fakeWebpush();
    const banners = [];
    const n = notifier(dir, wp, { localNotify: async (title, body) => banners.push({ title, body }) });
    n.addSubscription(sub('https://push.example/phone'));

    const stream = new FleetApprovalStream();
    stream.configure({ hail: async () => ({ success: true }), claimDurable: () => true, restoreDurable: () => {} });
    n.bindApprovalStream(stream);

    stream.enqueue({
      id: 'p-9',
      project: 'test-fleet',
      agent: 'hook-agent',
      trigger: 'webhook:hooks',
      tier: 'ANONYMOUS_EXTERNAL',
      reason: 'requires approval',
      safeTools: ['read'],
      context: { source: 'trigger', messageContent: 'SECRET EVENT CONTENT' },
      timestamp: 1,
    });
    // sendToAll is fire-and-forget off the subscriber; let it settle.
    await new Promise((r) => setTimeout(r, 20));

    expect(wp.sent).toHaveLength(1);
    const push = wp.sent[0].payload;
    expect(push.tag).toBe('fleet-approvals');            // grouping
    expect(push.deepLink).toBe('/fleet-ui/#approvals');  // tap target
    expect(push.body).toContain('hook-agent');
    expect(push.body).toContain('webhook:hooks');
    // Data minimization: event content NEVER rides in a push.
    expect(JSON.stringify(push)).not.toContain('SECRET EVENT CONTENT');
    expect(banners).toHaveLength(1); // local macOS banner too

    await stream.decide({ type: 'human_decision', id: 'p-9', decision: 'reject' }, 'op');
    await new Promise((r) => setTimeout(r, 20));
    expect(wp.sent).toHaveLength(1); // resolution did not push
  });
});

describe('approval push coalescing (banner-blindness guard)', () => {
  let dir;
  beforeEach(() => { dir = makeScratch(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function gate(stream, id) {
    stream.enqueue({
      id,
      project: 'test-fleet',
      agent: 'hook-agent',
      trigger: 'webhook:hooks',
      tier: 'ANONYMOUS_EXTERNAL',
      reason: 'requires approval',
      safeTools: ['read'],
      context: { source: 'trigger', messageContent: `content-${id}` },
      timestamp: 1,
    });
  }

  test('a burst becomes two notifications: immediate detail + one trailing summary', async () => {
    const wp = fakeWebpush();
    const n = notifier(dir, wp);
    n.addSubscription(sub('https://push.example/phone'));
    const stream = new FleetApprovalStream();
    stream.configure({ hail: async () => ({ success: true }), claimDurable: () => true, restoreDurable: () => {} });
    const unbind = n.bindApprovalStream(stream, 120); // 120ms window for the test

    for (let i = 0; i < 8; i += 1) gate(stream, `burst-${i}`);
    await new Promise((r) => setTimeout(r, 40));
    expect(wp.sent).toHaveLength(1); // leading edge: first gate, full detail
    expect(wp.sent[0].payload.body).toContain('hook-agent');

    await new Promise((r) => setTimeout(r, 200)); // window closes
    expect(wp.sent).toHaveLength(2); // trailing summary, not 7 more pushes
    expect(wp.sent[1].payload.body).toMatch(/7 more spawns/);
    expect(wp.sent[1].payload.body).toMatch(/8 pending total/);
    unbind();
  });

  test('gates in separate quiet periods each push immediately', async () => {
    const wp = fakeWebpush();
    const n = notifier(dir, wp);
    n.addSubscription(sub('https://push.example/phone'));
    const stream = new FleetApprovalStream();
    stream.configure({ hail: async () => ({ success: true }), claimDurable: () => true, restoreDurable: () => {} });
    const unbind = n.bindApprovalStream(stream, 50);

    gate(stream, 'quiet-1');
    await new Promise((r) => setTimeout(r, 80)); // past the window
    gate(stream, 'quiet-2');
    await new Promise((r) => setTimeout(r, 40));
    expect(wp.sent).toHaveLength(2); // both immediate, no summaries
    unbind();
  });
});

describe('fleet push routes', () => {
  let app;
  let dir;
  let wp;

  beforeEach(async () => {
    dir = makeScratch();
    wp = fakeWebpush();
    setSharedPushNotifier(notifier(dir, wp));
    app = Fastify();
    await app.register(fleetPushPlugin, { deps: { logger: { info: () => {} } } });
  });

  afterEach(async () => {
    await app.close();
    setSharedPushNotifier(null);
    rmSync(dir, { recursive: true, force: true });
  });

  test('vapid key, subscribe, list (truncated endpoints), unsubscribe, test push', async () => {
    const key = await app.inject({ method: 'GET', url: '/fleet/push/vapid-public-key' });
    expect(key.json().publicKey).toBe('pub-1');

    const bad = await app.inject({ method: 'POST', url: '/fleet/push/subscriptions', payload: { subscription: { endpoint: '' } } });
    expect(bad.statusCode).toBe(400);

    const longEndpoint = `https://push.example/${'x'.repeat(80)}`;
    const ok = await app.inject({
      method: 'POST', url: '/fleet/push/subscriptions',
      payload: { subscription: sub(longEndpoint) },
    });
    expect(ok.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/fleet/push/subscriptions' });
    expect(list.json().count).toBe(1);
    // Capability URL never exposed whole.
    expect(list.json().subscriptions[0].endpoint.length).toBeLessThan(longEndpoint.length);

    const test = await app.inject({ method: 'POST', url: '/fleet/push/test' });
    expect(test.json()).toEqual(expect.objectContaining({ success: true, sent: 1 }));

    const gone = await app.inject({ method: 'DELETE', url: '/fleet/push/subscriptions', payload: { endpoint: longEndpoint } });
    expect(gone.json().success).toBe(true);
    const missing = await app.inject({ method: 'DELETE', url: '/fleet/push/subscriptions', payload: { endpoint: longEndpoint } });
    expect(missing.statusCode).toBe(404);
  });
});
