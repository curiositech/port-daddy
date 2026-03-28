// Fleet Engine Tests -- Expose bugs in lib/fleet-engine.ts
//
// Bugs targeted:
//   1. parseCronInterval: "*​/0" cron produces 0ms interval (runaway setInterval)
//   2. parseCronInterval: "*​/abc" cron produces NaN interval (runaway setInterval)
//   3. loadFleetConfig: YAML array-style agents corrupts names (numeric indices used)
//   4. loadFleetConfig: empty YAML -> parseFleetYaml returns null -> TypeError on .agents
//   5. runAgentOnce: onSuccess/onFailure check data.status === 'completed' but
//      /spawn returns {status: 'spawned'} -- callbacks are dead code

import { jest } from '@jest/globals';

// ─── Mocks (must be set up before any import of the module under test) ───────

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockSpawn = jest.fn();
const mockExecSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

// yaml must be available for fleet-engine to import
jest.unstable_mockModule('yaml', () => ({
  parse: (text) => {
    // Use JSON.parse for test simplicity — tests provide JSON not YAML
    try { return JSON.parse(text); } catch { return null; }
  },
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

const { loadFleetConfig, createFleetRunner } = await import('../../lib/fleet-engine.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a minimal valid FleetConfig for runner tests */
function makeConfig(agentOverrides = {}) {
  return {
    name: 'test-fleet',
    agents: [
      {
        name: 'test-agent',
        backend: 'claude-cli',
        prompt: 'Do something',
        schedule: undefined,
        trigger: undefined,
        worktree: false,
        singleton: false,
        ...agentOverrides,
      },
    ],
    watchers: [],
    channels: {},
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  mockExecSync.mockReturnValue('main');

  const mockChild = {
    pid: 1234,
    unref: jest.fn(),
    kill: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
  };
  mockSpawn.mockReturnValue(mockChild);

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Bug 1: */0 cron produces 0ms interval ───────────────────────────────────

test('BUG 1: schedule */0 * * * * produces 0ms setInterval (runaway)', () => {
  const config = makeConfig({ schedule: '*/0 * * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  const calls = setIntervalSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const intervalMs = calls[0][1];
  // 0ms or NaN both cause runaway — neither is a valid schedule
  expect(intervalMs).toBeGreaterThan(0);
  expect(Number.isFinite(intervalMs)).toBe(true);
});

// ─── Bug 2: */abc cron produces NaN interval ─────────────────────────────────

test('BUG 2: schedule */abc * * * * produces NaN setInterval (runaway)', () => {
  const config = makeConfig({ schedule: '*/abc * * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  const calls = setIntervalSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const intervalMs = calls[0][1];
  // Must not be NaN — NaN causes Node.js to treat it as 1ms
  expect(Number.isNaN(intervalMs)).toBe(false);
  expect(intervalMs).toBeGreaterThan(0);
});

// ─── Bug 3: YAML array-style agents corrupts names ───────────────────────────

test('BUG 3: array-style agents in YAML use numeric keys as names', () => {
  // YAML arrays parsed by js-yaml become JS arrays.
  // Object.entries([{...}]) yields [['0', {...}], ['1', {...}]] — numeric string keys.
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');

  // Simulate yaml.parse returning an array for agents (array YAML syntax)
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'test',
    agents: [
      { backend: 'claude-cli', prompt: 'Run qa', schedule: '*/10 * * * *' },
      { backend: 'claude-cli', prompt: 'Run docs', schedule: '*/30 * * * *' },
    ],
  }));

  const config = loadFleetConfig('/tmp/proj');
  // With the bug, names would be '0', '1' instead of meaningful names
  // Agent names should not be numeric strings
  expect(config).not.toBeNull();
  for (const agent of config.agents) {
    expect(agent.name).not.toMatch(/^\d+$/);
  }
});

// ─── Bug 4: empty YAML → null → TypeError ────────────────────────────────────

test('BUG 4: empty pd-fleet.yml throws instead of returning null or empty config', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(''); // empty file

  // Should not throw — should return null or an empty config
  expect(() => loadFleetConfig('/tmp/proj')).not.toThrow();
});

// ─── Bug 5: onSuccess/onFailure never fires (dead code) ──────────────────────

test('FIX 5: onSuccess fires when spawn returns status=spawned', async () => {
  // /spawn returns immediately with {status: 'spawned'}.
  // The engine now correctly treats 'spawned' as a success (spawn was accepted).
  const publishFetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });

  let spawnCallCount = 0;
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('/spawn')) {
      spawnCallCount++;
      return { ok: true, json: async () => ({ agentId: 'abc', status: 'spawned' }) };
    }
    if (typeof url === 'string' && url.includes('/msg/')) {
      publishFetch(url);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  });

  const config = makeConfig({
    schedule: '*/10 * * * *',
    onSuccess: 'publish fleet:done',
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  runner.startAgent(config.agents[0]); // triggers runAgentOnce immediately

  // Wait for the async runAgentOnce to resolve
  await Promise.resolve();
  await Promise.resolve();

  // Spawn was called
  expect(spawnCallCount).toBe(1);

  // Publish IS now called (status 'spawned' is treated as success)
  expect(publishFetch).toHaveBeenCalledWith('http://localhost:9876/msg/fleet:done');
});

// ─── Valid cron patterns still work ──────────────────────────────────────────

test('valid cron */10 * * * * returns 600000ms', () => {
  const config = makeConfig({ schedule: '*/10 * * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  const calls = setIntervalSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0][1]).toBe(600000);
});

test('valid cron 0 * * * * returns 3600000ms', () => {
  const config = makeConfig({ schedule: '0 * * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  const calls = setIntervalSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0][1]).toBe(3600000);
});

test('valid cron 0 */4 * * * returns 14400000ms', () => {
  const config = makeConfig({ schedule: '0 */4 * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  const calls = setIntervalSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0][1]).toBe(14400000);
});
