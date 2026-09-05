/**
 * P4: spawner adoption of harbor envelope enforcement (ADR-0047, #188).
 *
 * The spawner is the first real call site to consult the envelope. The IPC
 * model is parent→child: env vars are the one-way config channel to the spawned
 * agent (lib/spawner.ts). These tests verify:
 *
 *   1. A harbor with NO envelope set enforces nothing (opt-in; open default
 *      preserved) — the spawn proceeds.
 *   2. A harbor WITH an envelope that forbids the backend blocks the spawn
 *      BEFORE the bond is escrowed, names the boundary, and leaves the harbor.
 *   3. A harbor WITH an envelope that admits the backend proceeds AND
 *      propagates PD_HARBOR_ENVELOPE + PD_HARBOR_NAME into the child env.
 */

import { jest } from '@jest/globals';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

// Mocking the child alone does not isolate the spawner's coordination HTTP.
// Install BEFORE importing the real spawner, and never forward to live fetch.
// pdCoordinate deliberately swallows transport errors: an independent ledger
// must fail the test even when an unexpected request's rejection was caught.
const coordinationUrl = 'http://spawner-envelope.test.invalid';
const originalFetch = global.fetch;
const daemonEnvKeys = ['PD_URL', 'PORT_DADDY_URL', 'PORT_DADDY_SOCK'];
const snapshotDaemonEnv = () => Object.fromEntries(daemonEnvKeys.map(key => [key, process.env[key]]));
const originalDaemonEnv = snapshotDaemonEnv();
const networkViolations = [];
const registeredAgents = new Set();

function restoreDaemonEnv(snapshot) {
  for (const key of daemonEnvKeys) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function pinFixtureEnvironment() {
  process.env.PD_URL = coordinationUrl;
  process.env.PORT_DADDY_URL = coordinationUrl;
  delete process.env.PORT_DADDY_SOCK;
}

function refuseTransport(kind) {
  networkViolations.push(kind);
  throw Object.assign(new Error('Unexpected network attempt in hermetic spawner test'), { code: 'TEST_NETWORK_LEAK' });
}

function assertNoUnexpectedNetwork() {
  if (networkViolations.length) throw new Error('Hermetic transport violation ledger is not empty');
}

const coordinationFetch = jest.fn(async (input, options) => {
  let url;
  try {
    url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  } catch {
    return refuseTransport('fetch-input');
  }
  if (url.origin !== coordinationUrl || url.username || url.password || url.search || url.hash) return refuseTransport('fetch-origin');
  if (options?.method !== 'POST') return refuseTransport('fetch-method');
  let body;
  try {
    body = JSON.parse(options.body);
  } catch {
    return refuseTransport('fetch-body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuseTransport('fetch-body');
  if (url.pathname === '/agents' && typeof body.id === 'string' && body.id.length) {
    registeredAgents.add(body.id);
  } else if (['/sugar/begin', '/sugar/done'].includes(url.pathname) && registeredAgents.has(body.agentId)) {
    // These are fixture-only lifecycle writes, not real admissions.
  } else if (![...registeredAgents].some(id => url.pathname === `/agents/${id}/heartbeat`)) {
    return refuseTransport('fetch-route');
  }
  return { ok: true, status: 200, json: async () => ({ success: true }) };
});

global.fetch = coordinationFetch;
pinFixtureEnvironment();
const transportSpies = [
  [http, 'request', 'http-request'], [http, 'get', 'http-get'],
  [https, 'request', 'https-request'], [https, 'get', 'https-get'],
  [net, 'connect', 'net-connect'], [net, 'createConnection', 'net-create-connection'],
  [net.Socket.prototype, 'connect', 'socket-connect'], [tls, 'connect', 'tls-connect'],
  [net.Server.prototype, 'listen', 'server-listen'],
].map(([target, key, kind]) => jest.spyOn(target, key).mockImplementation(() => refuseTransport(kind)));
// Keep named builtin imports behind the same guard as their default exports.
syncBuiltinESMExports();

beforeAll(() => assertNoUnexpectedNetwork());
afterAll(() => {
  // Every spawn below is awaited through completion; its heartbeat has cleared.
  try {
    assertNoUnexpectedNetwork();
  } finally {
    // A failing leak assertion must not poison the next suite's transports.
    for (const spy of transportSpies.reverse()) spy.mockRestore();
    syncBuiltinESMExports();
    global.fetch = originalFetch;
    restoreDaemonEnv(originalDaemonEnv);
  }
});
afterEach(() => {
  assertNoUnexpectedNetwork();
  expect(global.fetch).toBe(coordinationFetch);
  for (const [url, options] of coordinationFetch.mock.calls) {
    expect(new URL(url).origin).toBe(coordinationUrl);
    expect(options.method).toBe('POST');
  }
});

const mockChildProcess = {
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn((event, cb) => { if (event === 'close') setTimeout(() => cb(0), 0); }),
  kill: jest.fn(),
  pid: 4242,
};

jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn(() => mockChildProcess),
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

// The real Coast Guard runner starts a loopback meter before launching the
// child. Metering I/O is outside this envelope unit's scope: use a non-network
// meter while retaining the real runner, confinement, env scrubbing and finally
// disposal. Native listen remains forbidden, including under OS network denial.
const fixtureMeters = [];
jest.unstable_mockModule('../../lib/coast-guard/egress-meter.js', () => ({
  EgressMeter: class {
    constructor() {
      this.state = { requests: 0, bytes: 0, blocked: 0, injected: 0 };
      this.proxyUrl = 'http://egress-meter.test.invalid:31337';
      this.listen = jest.fn(async () => 31337);
      this.dispose = jest.fn();
      fixtureMeters.push(this);
    }
  },
}));

const { spawn: cpSpawn } = await import('node:child_process');
const { createSpawner: createSpawnerBase } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'envelope enforcement coverage',
};

function createSpawner(deps = {}) {
  return createSpawnerBase({
    ...deps,
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: deps.enforceTranscriptPolicy ?? false,
    telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
  });
}

function makeDeps(envelope) {
  return {
    bonds: {
      getBudget: jest.fn(() => 1),
      escrow: jest.fn(() => ({ ok: true, id: 7 })),
      markRunning: jest.fn(),
      refund: jest.fn(),
      slash: jest.fn(),
    },
    harbors: {
      get: jest.fn(() => null),
      create: jest.fn(() => ({ success: true, harbor: { name: 'myapp:fleet' } })),
      enter: jest.fn(async () => ({ success: true, harbor: { name: 'myapp:fleet' } })),
      leaveAll: jest.fn(() => 1),
      getEnvelope: jest.fn(() => envelope),
      assertWithinEnvelope: jest.fn((_name, _agent, action) => {
        if (!envelope) return { allowed: false, boundary: 'membership', reason: 'no envelope' };
        if (action.kind === 'backend') {
          const ok = envelope.backends.includes('*') || envelope.backends.includes(action.name);
          return ok
            ? { allowed: true, boundary: 'backends', reason: 'admitted' }
            : { allowed: false, boundary: 'backends', reason: `backend '${action.name}' not permitted` };
        }
        return { allowed: true, boundary: 'unknown', reason: 'n/a' };
      }),
    },
  };
}

// The worktree isolation guard (lib/spawner.ts assessSpawnIsolation) blocks a
// spawn whose workdir resolves to a repository main checkout. These tests pass
// no workdir, so the guard falls back to process.cwd() — a worktree locally but
// the primary checkout in CI — making every spawn here return status 'failed'
// before any harbor/envelope logic runs. This suite exercises envelope
// enforcement, not the guard (covered by spawner-isolation-guard.test.js), so
// opt out of layer-2 isolation for a checkout-independent run.
const originalSpawnIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
const originalCoastGuardOff = process.env.PD_COAST_GUARD_OFF;
beforeAll(() => {
  process.env.PD_SPAWN_ISOLATION_OFF = '1';
  // Exercise the enabled runner even if a developer's shell opted out.
  delete process.env.PD_COAST_GUARD_OFF;
});
afterAll(() => {
  if (originalSpawnIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
  else process.env.PD_SPAWN_ISOLATION_OFF = originalSpawnIsolationOff;
  if (originalCoastGuardOff === undefined) delete process.env.PD_COAST_GUARD_OFF;
  else process.env.PD_COAST_GUARD_OFF = originalCoastGuardOff;
});
afterEach(() => {
  expect(fixtureMeters).toHaveLength(cpSpawn.mock.calls.length);
  for (const meter of fixtureMeters) {
    expect(meter.listen).toHaveBeenCalledTimes(1);
    expect(meter.listen).toHaveBeenCalledWith(0);
    expect(meter.dispose).toHaveBeenCalledTimes(1);
  }
});

beforeEach(() => {
  assertNoUnexpectedNetwork();
  pinFixtureEnvironment();
  registeredAgents.clear();
  fixtureMeters.length = 0;
  cpSpawn.mockClear();
  coordinationFetch.mockClear();
});

describe('hermetic transport boundary', () => {
  test.each([
    ['PD_URL', { PD_URL: 'http://127.0.0.1:9876' }],
    ['PORT_DADDY_URL', { PORT_DADDY_URL: 'http://127.0.0.1:9876' }],
    ['socket', { PORT_DADDY_SOCK: '/operator/daemon.sock' }],
    ['conflicting inherited selectors', {
      PD_URL: 'http://127.0.0.1:9876', PORT_DADDY_URL: 'http://foreign.invalid:4444', PORT_DADDY_SOCK: '/operator/daemon.sock',
    }],
  ])('isolates and restores inherited %s without real transport', async (_name, inherited) => {
    const before = snapshotDaemonEnv();
    Object.assign(process.env, inherited);
    const contaminated = snapshotDaemonEnv();
    try {
      pinFixtureEnvironment();
      const result = await createSpawner(makeDeps(null)).spawn({ backend: 'custom', task: 'fixture only' });
      expect({ status: result.status, error: result.error }).toEqual({ status: 'completed', error: null });
      expect(coordinationFetch.mock.calls.map(([url]) => new URL(url).pathname))
        .toEqual(expect.arrayContaining(['/agents', '/sugar/begin', '/sugar/done']));
      expect(transportSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      restoreDaemonEnv(contaminated);
      expect(snapshotDaemonEnv()).toEqual(contaminated);
    } finally {
      restoreDaemonEnv(before);
    }
  });

  test.each([
    ['wrong origin', 'http://127.0.0.1:9876/agents', 'POST', 'fetch-origin'],
    ['unknown route', `${coordinationUrl}/relay/publish`, 'POST', 'fetch-route'],
    ['wrong method', `${coordinationUrl}/agents`, 'GET', 'fetch-method'],
    ['unregistered heartbeat', `${coordinationUrl}/agents/foreign/heartbeat`, 'POST', 'fetch-route'],
    ['malformed URL', 'not-a-url', 'POST', 'fetch-input'],
    ['malformed body', `${coordinationUrl}/agents`, 'POST', 'fetch-body', '{'],
    ['null body', `${coordinationUrl}/agents`, 'POST', 'fetch-body', 'null'],
    ['array body', `${coordinationUrl}/agents`, 'POST', 'fetch-body', '[]'],
  ])('records %s before any request can escape', async (_name, url, method, kind, body = '{}') => {
    try {
      await expect(coordinationFetch(url, { method, body })).rejects.toMatchObject({ code: 'TEST_NETWORK_LEAK' });
      expect(networkViolations).toEqual([kind]);
      expect(() => assertNoUnexpectedNetwork()).toThrow('violation ledger');
      expect(registeredAgents.size).toBe(0);
    } finally {
      // Only a negative control may consume its already-asserted violations.
      networkViolations.length = 0;
      coordinationFetch.mockClear();
    }
  });

  test.each([
    ['http-request', () => http.request('http://127.0.0.1:9876/agents')],
    ['http-get', () => http.get('http://127.0.0.1:9876/agents')],
    ['https-request', () => https.request('https://relay.invalid/events')],
    ['https-get', () => https.get('https://relay.invalid/events')],
    ['net-connect', () => net.connect({ port: 9876 })],
    ['net-create-connection', () => net.createConnection({ path: '/operator/daemon.sock' })],
    ['socket-connect', () => new net.Socket().connect({ path: '/operator/daemon.sock' })],
    ['tls-connect', () => tls.connect({ port: 443, host: 'relay.invalid' })],
    ['server-listen', () => net.createServer().listen(0, '127.0.0.1')],
    ['server-listen', () => net.createServer().listen('/operator/daemon.sock')],
  ])('blocks the %s escape hatch before opening a connection', (kind, attempt) => {
    try {
      expect(attempt).toThrow('Unexpected network attempt');
      expect(networkViolations).toEqual([kind]);
      expect(() => assertNoUnexpectedNetwork()).toThrow('violation ledger');
    } finally {
      networkViolations.length = 0;
      for (const spy of transportSpies) spy.mockClear();
    }
  });

  test('detects a forbidden registration even when real pdCoordinate swallows the error', async () => {
    process.env.PORT_DADDY_URL = 'http://127.0.0.1:9876';
    try {
      const result = await createSpawner(makeDeps(null)).spawn({ backend: 'custom', task: 'swallowed-error fixture' });
      // Production intentionally keeps running after a coordination failure.
      expect({ status: result.status, error: result.error }).toEqual({ status: 'completed', error: null });
      expect(new URL(coordinationFetch.mock.calls[0][0]).pathname).toBe('/agents');
      expect(networkViolations.length).toBeGreaterThanOrEqual(3);
      expect(networkViolations.every(kind => kind === 'fetch-origin')).toBe(true);
      expect(registeredAgents.size).toBe(0);
      expect(() => assertNoUnexpectedNetwork()).toThrow('violation ledger');
      expect(transportSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      pinFixtureEnvironment();
      networkViolations.length = 0;
      coordinationFetch.mockClear();
    }
  });
});

describe('spawner P4 — harbor envelope enforcement', () => {
  test('no envelope set → no enforcement, spawn proceeds to escrow', async () => {
    const { bonds, harbors } = makeDeps(null); // getEnvelope returns null
    const spawner = createSpawner({ bonds, harbors });

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'echo unenforced',
      identity: 'myapp:api:test',
    });

    expect({ status: result.status, error: result.error }).toEqual({ status: 'completed', error: null });
    expect(harbors.assertWithinEnvelope).not.toHaveBeenCalled();
    expect(bonds.escrow).toHaveBeenCalled();
    expect(coordinationFetch.mock.calls.map(([url]) => new URL(url).pathname))
      .toEqual(expect.arrayContaining(['/agents', '/sugar/begin', '/sugar/done']));
  });

  test('envelope forbids the backend → blocked before escrow, boundary named, harbor left', async () => {
    const { bonds, harbors } = makeDeps({ backends: ['claude'], filesystem: [], tools: [], skills: [], mcps: [], channels: [], budgetUsd: 0 });
    const spawner = createSpawner({ bonds, harbors });

    const result = await spawner.spawn({
      backend: 'custom', // not in the ['claude'] allowlist
      task: 'echo forbidden',
      identity: 'myapp:api:test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('harbor envelope');
    expect(result.error).toContain('backends'); // the boundary
    expect(bonds.escrow).not.toHaveBeenCalled();
    // The admitted agent is evicted from the harbor on the block (the blocked
    // result carries a sentinel id, so assert the eviction happened at all).
    expect(harbors.leaveAll).toHaveBeenCalled();
    expect(coordinationFetch).not.toHaveBeenCalled();
  });

  test('envelope admits the backend → proceeds and propagates env to child', async () => {
    const { bonds, harbors } = makeDeps({ backends: ['custom'], filesystem: ['*'], tools: ['*'], skills: ['*'], mcps: ['*'], channels: ['*'], budgetUsd: null });
    const spawner = createSpawner({ bonds, harbors });

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'echo allowed',
      identity: 'myapp:api:test',
    });

    expect({ status: result.status, error: result.error }).toEqual({ status: 'completed', error: null });
    expect(bonds.escrow).toHaveBeenCalled();
    // PD_HARBOR_ENVELOPE propagated to the child via the env IPC channel
    expect(cpSpawn).toHaveBeenCalled();
    const spawnOpts = cpSpawn.mock.calls.at(-1)[2];
    expect(spawnOpts.env.PD_HARBOR_NAME).toBe('myapp:fleet');
    expect(spawnOpts.env.PD_COAST_GUARD).toBe('1');
    expect(spawnOpts.env.HTTPS_PROXY).toBe('http://egress-meter.test.invalid:31337');
    expect(JSON.parse(spawnOpts.env.PD_HARBOR_ENVELOPE).backends).toEqual(['custom']);
    expect(coordinationFetch.mock.calls.map(([url]) => new URL(url).pathname))
      .toEqual(expect.arrayContaining(['/agents', '/sugar/begin', '/sugar/done']));
  });
});
