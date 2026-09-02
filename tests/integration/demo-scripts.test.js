/**
 * Integration test: verify the demo GIF scripts produce real pd output.
 *
 * These tests run the actual pd commands used in /tmp/gen_casts.py —
 * the same commands that generate demo-fleet.gif and demo-agents.gif.
 * This proves the demos are not mocked: every command produces real,
 * structured output from a live daemon.
 *
 * Demo 1 (fleet):   pd claim / pd find / pd ps
 * Demo 2 (agents):  pd begin / pd note / pd pub / pd salvage / pd lock / pd unlock / pd done
 */

import { runCli, request } from '../helpers/integration-setup.js';

// Unique prefix so these tests don't collide with other suites
const PREFIX = 'demo-scripts-test';
const FLEET = `${PREFIX}:fleet`;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Assert a string looks like a TCP port (1–65535). */
function expectPort(str) {
  const n = parseInt(str.trim(), 10);
  expect(n).toBeGreaterThanOrEqual(1024);
  expect(n).toBeLessThanOrEqual(65535);
  return n;
}

// ─── Demo 1: Fleet commands ──────────────────────────────────────────────────

describe('Demo 1 — fleet (pd claim / pd find / pd ps)', () => {
  const services = [
    { id: `${FLEET}:api`,      label: 'API server' },
    { id: `${FLEET}:frontend`, label: 'React frontend' },
    { id: `${FLEET}:worker`,   label: 'Background worker' },
    { id: `${FLEET}:db`,       label: 'Postgres proxy' },
  ];

  afterAll(async () => {
    // Release all claimed services
    for (const { id } of services) {
      await request('/release', {
        method: 'DELETE',
        body: { id },
      }).catch(() => {});
    }
  });

  test.each(services)('pd claim $id -q returns a valid port', ({ id }) => {
    const { stdout, status } = runCli(['claim', id, '-q']);
    expect(status).toBe(0);
    expectPort(stdout);
  });

  test('pd claim is idempotent — same port every time', () => {
    const id = `${FLEET}:api`;
    const first  = runCli(['claim', id, '-q']);
    const second = runCli(['claim', id, '-q']);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout.trim()).toBe(second.stdout.trim());
  });

  test('pd find <exact-service-name> outputs a port or hint', () => {
    // pd find with a bare project name shows a wildcard hint (real behavior in GIF)
    const { stdout, stderr } = runCli(['find', `${FLEET}:api`]);
    const combined = stdout + stderr;
    // Either it found the service (port listed) or it gave a hint — both are real output
    const hasPort  = /\d{4,5}/.test(combined);
    const hasHint  = /find.*\*|wildcard|quote/i.test(combined) || combined.includes('No services');
    expect(hasPort || hasHint).toBe(true);
  });

  test('pd ps outputs a table with ID, PORT, STATUS columns', () => {
    // pd ps outputs to stderr (console.error); stdout is empty
    const { stderr, status } = runCli(['ps']);
    expect(status).toBe(0);
    expect(stderr).toMatch(/ID/i);
    expect(stderr).toMatch(/PORT/i);
    expect(stderr).toMatch(/STATUS/i);
    // At least one of our services appears
    expect(stderr).toContain(FLEET);
  });

  test('pd ps --json returns an array with claimed services', () => {
    const { stdout, status } = runCli(['ps', '--json']);
    expect(status).toBe(0);
    // --json goes to stdout; table goes to stderr
    const data = JSON.parse(stdout);
    // ps --json returns { services: [...], count: N } or a plain array
    const services = Array.isArray(data) ? data : (data.services ?? data.results ?? []);
    expect(Array.isArray(services)).toBe(true);
    const ours = services.filter(s => s.id && s.id.startsWith(FLEET));
    expect(ours.length).toBeGreaterThanOrEqual(4);
    for (const svc of ours) {
      expect(svc.port).toBeGreaterThan(1000);
      expect(svc.status).toBeDefined();
    }
  });
});

// ─── Demo 2: Agent coordination commands ─────────────────────────────────────

describe('Demo 2 — agents (pd begin / pd note / pd pub / pd salvage / pd lock / pd unlock / pd done)', () => {
  let agentId = null;
  let sessionId = null;
  const LOCK_NAME = `${PREFIX}-db-migration`;
  const cliOptions = {
    env: {
      PORT_DADDY_CONTEXT_SLOT: `${PREFIX}-agents`,
    },
  };

  afterAll(async () => {
    // Best-effort cleanup. Abandonment does not claim repository work landed,
    // so it needs no completion override.
    if (agentId) {
      runCli(['done', '--status', 'abandoned'], cliOptions);
      await request(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' }).catch(() => {});
    }
    await request(`/locks/${encodeURIComponent(LOCK_NAME)}`, { method: 'DELETE' }).catch(() => {});
  });

  test('pd begin creates an agent + session (JSON output)', () => {
    const { stdout, status } = runCli([
      'begin', 'Building OAuth integration',
      '--identity', `${PREFIX}:api`,
      '--lifecycle', 'durable',
      '--json',
    ], cliOptions);
    expect(status).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.agentId).toBeDefined();
    expect(data.sessionId).toBeDefined();
    agentId  = data.agentId;
    sessionId = data.sessionId;
  });

  test('pd note adds an immutable note to the active session', () => {
    const { stdout, stderr, status } = runCli([
      'note', 'JWT validation done, starting session store',
    ], cliOptions);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    // Should mention success or note ID
    expect(combined).toMatch(/note|ok|added|saved/i);
  });

  test('pd pub broadcasts to a channel', () => {
    const { stdout, stderr, status } = runCli([
      'pub', `${PREFIX}:progress`, 'auth: 60% done, JWT merged',
    ], cliOptions);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/published|sent|ok|message/i);
  });

  test('pd salvage returns structured output (queue list or "no dead agents")', () => {
    const { stdout, status } = runCli(['salvage'], cliOptions);
    expect(status).toBe(0);
    // Either shows the salvage table or a "no dead agents" message — both are valid
    expect(stdout.length).toBeGreaterThan(0);
  });

  test('pd lock acquires a distributed lock', () => {
    const { stdout, stderr, status } = runCli([
      'lock', LOCK_NAME, '--ttl', '30000',
    ], cliOptions);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/acquired|locked|lock|ok/i);
  });

  test('pd lock is exclusive — second acquisition fails', () => {
    const { status } = runCli(['lock', LOCK_NAME, '--ttl', '30000'], cliOptions);
    // Lock already held: must fail
    expect(status).not.toBe(0);
  });

  test('pd unlock releases the lock', () => {
    const { stdout, stderr, status } = runCli(['unlock', LOCK_NAME], cliOptions);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/released|unlocked|ok/i);
  });

  test('pd done ends the session and unregisters the agent', () => {
    expect(agentId).not.toBeNull();
    // The demo proves lifecycle teardown, not publication. Abandoning is the
    // truthful terminal state when no merge-ready repository artifact exists.
    const { stdout, stderr, status } = runCli([
      'done',
      '--status', 'abandoned',
    ], cliOptions);
    expect(status).toBe(0);
    const combined = stdout + stderr;
    expect(combined).toMatch(/done|complete|ended|session|archived/i);
  });

  test('agent is gone after pd done', async () => {
    if (!agentId) return;
    // Small delay — pd done may close keep-alive connections
    await new Promise(r => setTimeout(r, 500));
    let res;
    for (let i = 0; i < 3; i++) {
      try {
        res = await request(`/agents/${encodeURIComponent(agentId)}`);
        break;
      } catch {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    // Agent should be deleted or show as inactive
    expect(res.status === 404 || res.data?.active === false).toBe(true);
  });
});
