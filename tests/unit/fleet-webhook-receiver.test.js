// tests/unit/fleet-webhook-receiver.test.js
//
// The Phase-2 inbound webhook surface: FleetWebhookReceiver (channel→handler
// registry) + routes/fleet-webhooks.ts (HTTP) + the END-TO-END proof that an
// HTTP POST flows through the receiver, the WebhookTriggerSource (HMAC), and
// the engine's ADR-0093 trust gate — landing as an approval proposal, never a
// direct spawn.
//
// Non-trivial properties pinned here:
//   - Channel exclusivity: a second registration for the same slug throws
//     (config error surfaced at trigger start, not a silent fan-out).
//   - Stale deregistration is a no-op: an old stop() cannot evict a newer
//     registration for the same slug.
//   - Unknown channel and invalid slug both read as 404 to an external
//     prober (no topology leak).
//   - A throwing handler is a 500 with a generic body (no internals leak).
//   - HMAC verification happens on the EXACT raw bytes posted.

import { createHmac } from 'node:crypto';
import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockSpawn = jest.fn();
jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execSync: jest.fn(() => 'main'),
  execFileSync: jest.fn(),
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
  // lib/fleet-engine.ts transitively imports lib/watcher-pid-registry.ts,
  // whose getCommandLineForPid() uses spawnSync (`ps`) to confirm a watcher
  // child's identity before killing it.
  spawnSync: jest.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

const { FleetWebhookReceiver, getSharedWebhookReceiver, setSharedWebhookReceiver } =
  await import('../../lib/fleet/webhook-receiver.js');
const { fleetWebhooksPlugin } = await import('../../routes/fleet-webhooks.js');
const { createFleetRunner } = await import('../../lib/fleet-engine.js');

const okHandler = async () => ({ status: 200, body: { received: true } });

// ─── Receiver semantics ──────────────────────────────────────────────────────

describe('FleetWebhookReceiver', () => {
  test('registers, delivers, deregisters', async () => {
    const r = new FleetWebhookReceiver();
    const seen = [];
    const dereg = r.registerHandler('deploys', async (req) => {
      seen.push(req.body);
      return { status: 200, body: { ok: true } };
    });
    expect(r.channels()).toEqual(['deploys']);

    const res = await r.deliver('deploys', {
      headers: {}, body: { n: 1 }, rawBody: Buffer.from('{"n":1}'),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ n: 1 }]);

    dereg();
    expect(r.channels()).toEqual([]);
    const gone = await r.deliver('deploys', { headers: {}, body: {}, rawBody: Buffer.alloc(0) });
    expect(gone.status).toBe(404);
  });

  test('channels are exclusive: double registration throws', () => {
    const r = new FleetWebhookReceiver();
    r.registerHandler('deploys', okHandler);
    expect(() => r.registerHandler('deploys', okHandler)).toThrow(/already registered/);
  });

  test('a stale deregister cannot evict a newer registration', () => {
    const r = new FleetWebhookReceiver();
    // Distinct handler instances — identity is what dereg checks.
    const deregOld = r.registerHandler('deploys', async () => ({ status: 200 }));
    deregOld();
    const deregNew = r.registerHandler('deploys', async () => ({ status: 200 }));
    // Calling the OLD deregister again must not remove the NEW handler.
    deregOld();
    expect(r.channels()).toEqual(['deploys']);
    deregNew();
    expect(r.channels()).toEqual([]);
  });

  test('invalid slugs are refused at registration', () => {
    const r = new FleetWebhookReceiver();
    for (const bad of ['', 'UPPER', 'a/b', '../etc', 'a'.repeat(65), 'sp ace']) {
      expect(() => r.registerHandler(bad, okHandler)).toThrow(/not a valid slug/);
    }
  });

  test('a throwing handler is a 500 with no internals leaked', async () => {
    const r = new FleetWebhookReceiver();
    r.registerHandler('bad', async () => { throw new Error('secret db string'); });
    const res = await r.deliver('bad', { headers: {}, body: {}, rawBody: Buffer.alloc(0) });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret db string');
  });
});

// ─── HTTP route ──────────────────────────────────────────────────────────────

describe('POST /webhooks/fleet/:channel', () => {
  let app;

  beforeEach(async () => {
    setSharedWebhookReceiver(new FleetWebhookReceiver());
    app = Fastify();
    await app.register(fleetWebhooksPlugin, { deps: { logger: { info: () => {} } } });
  });

  afterEach(async () => {
    await app.close();
    setSharedWebhookReceiver(null);
  });

  test('delivers a JSON POST to the registered handler with exact raw bytes', async () => {
    const seen = [];
    getSharedWebhookReceiver().registerHandler('ping', async (req) => {
      seen.push({ body: req.body, raw: req.rawBody.toString('utf8'), ip: req.ip });
      return { status: 200, body: { got: true } };
    });

    const payload = '{"a": 1, "b":  "two"}'; // deliberate odd spacing
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/fleet/ping',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ got: true });
    expect(seen[0].body).toEqual({ a: 1, b: 'two' });
    // Raw bytes preserved exactly — HMAC depends on this.
    expect(seen[0].raw).toBe(payload);
  });

  test('unknown channel is a 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/fleet/nobody-home',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
  });

  test('malformed JSON is a 400', async () => {
    getSharedWebhookReceiver().registerHandler('ping', okHandler);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/fleet/ping',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
  });

  test('non-JSON content types deliver the raw string body', async () => {
    const seen = [];
    getSharedWebhookReceiver().registerHandler('texty', async (req) => {
      seen.push(req.body);
      return { status: 200 };
    });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/fleet/texty',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello sensor',
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual(['hello sensor']);
  });

  test('GET /webhooks/fleet lists armed channels', async () => {
    getSharedWebhookReceiver().registerHandler('a-chan', okHandler);
    getSharedWebhookReceiver().registerHandler('b-chan', okHandler);
    const res = await app.inject({ method: 'GET', url: '/webhooks/fleet' });
    expect(res.json()).toEqual({ channels: ['a-chan', 'b-chan'] });
  });
});

// ─── End-to-end: HTTP → receiver → trigger source → trust gate ──────────────

describe('end-to-end: POST → WebhookTriggerSource → trust gate (Phase 2 proof)', () => {
  afterEach(() => {
    setSharedWebhookReceiver(null);
    delete process.env.PD_TEST_E2E_HOOK_SECRET;
  });

  test('an HMAC-signed POST lands as an approval proposal, never a direct spawn', async () => {
    process.env.PD_TEST_E2E_HOOK_SECRET = 'shhh-e2e';
    setSharedWebhookReceiver(new FleetWebhookReceiver());
    const app = Fastify();
    await app.register(fleetWebhooksPlugin, { deps: { logger: { info: () => {} } } });

    const proposals = [];
    const events = [];
    const runner = createFleetRunner(
      {
        name: 'e2e-fleet',
        limits: { budgetUsdPerDay: 5 },
        agents: [{
          name: 'sensor-agent',
          backend: 'claude-cli',
          prompt: 'Read the sensor event',
          triggers: ['webhook:sensor(secret:PD_TEST_E2E_HOOK_SECRET)'],
          allowedTools: 'Read,Grep',
          worktree: false,
          singleton: false,
        }],
        watchers: [],
        channels: {},
      },
      '/nonexistent',
      {
        onEvent: (e) => events.push(e),
        registerWebhookHandler: (channel, handler) =>
          getSharedWebhookReceiver().registerHandler(channel, handler),
        enqueueForApproval: (p) => { proposals.push(p); },
      },
    );
    runner.startAll();
    await runner.whenTriggersReady();

    const payload = JSON.stringify({ reading: 42 });
    const signature = 'sha256=' + createHmac('sha256', 'shhh-e2e').update(payload).digest('hex');

    // Wrong signature → 401 from the trigger source, nothing downstream.
    const badRes = await app.inject({
      method: 'POST',
      url: '/webhooks/fleet/sensor',
      headers: { 'content-type': 'application/json', 'x-pd-webhook-signature': 'sha256=deadbeef' },
      payload,
    });
    expect(badRes.statusCode).toBe(401);
    expect(proposals).toHaveLength(0);

    // Correct signature → delivered, trust-gated, queued for approval.
    const okRes = await app.inject({
      method: 'POST',
      url: '/webhooks/fleet/sensor',
      headers: { 'content-type': 'application/json', 'x-pd-webhook-signature': signature },
      payload,
    });
    expect(okRes.statusCode).toBe(200);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].agent).toBe('sensor-agent');
    expect(proposals[0].tier).toBe('ANONYMOUS_EXTERNAL'); // HMAC ≠ content trust
    expect(proposals[0].context.messageContent).toContain('42');
    expect(events.find((e) => e.type === 'trust_gate_queued')).toBeDefined();
    // No direct spawn by any path.
    expect(mockSpawn).not.toHaveBeenCalled();

    // Delivery idempotency: an at-least-once sender retrying the SAME
    // delivery id acks 200 without re-emitting. (This harness wires
    // enqueueForApproval directly, so the trigger-layer dedup is what's
    // under test here; the approval stream's content-fingerprint dedup is
    // covered in fleet-approval-stream.test.js.)
    const retryHeaders = {
      'content-type': 'application/json',
      'x-pd-webhook-signature': signature,
      'x-pd-delivery-id': 'delivery-42',
    };
    const first = await app.inject({ method: 'POST', url: '/webhooks/fleet/sensor', headers: retryHeaders, payload });
    expect(first.statusCode).toBe(200);
    expect(proposals).toHaveLength(2); // a NEW delivery id is a new event
    const retried = await app.inject({ method: 'POST', url: '/webhooks/fleet/sensor', headers: retryHeaders, payload });
    expect(retried.json().deduped).toBe(true);
    expect(proposals).toHaveLength(2); // the RETRY is not

    runner.stopAll();
    await runner.whenTriggersReady();
    await app.close();
  });
});
