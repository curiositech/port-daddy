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

// Mocking the child alone does not isolate the spawner's coordination HTTP.
// Use a non-forwarding fetch plus an explicit non-routable target so neither
// the operator's port file nor a later HOME change can select the live daemon.
const coordinationUrl = 'http://spawner-envelope.test.invalid';
const originalFetch = global.fetch;
const originalDaemonUrl = process.env.PORT_DADDY_URL;
const coordinationFetch = jest.fn(async () => ({
  ok: true,
  json: async () => ({ success: true }),
}));
beforeAll(() => {
  global.fetch = coordinationFetch;
  process.env.PORT_DADDY_URL = coordinationUrl;
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalDaemonUrl === undefined) delete process.env.PORT_DADDY_URL;
  else process.env.PORT_DADDY_URL = originalDaemonUrl;
});
afterEach(() => {
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
beforeAll(() => { process.env.PD_SPAWN_ISOLATION_OFF = '1'; });
afterAll(() => {
  if (originalSpawnIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
  else process.env.PD_SPAWN_ISOLATION_OFF = originalSpawnIsolationOff;
});

beforeEach(() => {
  cpSpawn.mockClear();
  coordinationFetch.mockClear();
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

    expect(result.status).not.toBe('failed');
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

    expect(result.status).not.toBe('failed');
    expect(bonds.escrow).toHaveBeenCalled();
    // PD_HARBOR_ENVELOPE propagated to the child via the env IPC channel
    expect(cpSpawn).toHaveBeenCalled();
    const spawnOpts = cpSpawn.mock.calls.at(-1)[2];
    expect(spawnOpts.env.PD_HARBOR_NAME).toBe('myapp:fleet');
    expect(JSON.parse(spawnOpts.env.PD_HARBOR_ENVELOPE).backends).toEqual(['custom']);
    expect(coordinationFetch.mock.calls.map(([url]) => new URL(url).pathname))
      .toEqual(expect.arrayContaining(['/agents', '/sugar/begin', '/sugar/done']));
  });
});
