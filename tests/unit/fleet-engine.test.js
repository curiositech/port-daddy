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
import { readFileSync as realReadFileSync } from 'node:fs';
import { join as realJoin } from 'node:path';
import { parse as realYamlParse } from 'yaml';

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
    // Most tests pass JSON. Fall back to real YAML parser for actual YAML.
    try { return JSON.parse(text); } catch { return realYamlParse(text); }
  },
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

const { loadFleetConfig, createFleetRunner, validateTopology } = await import('../../lib/fleet-engine.js');

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

test('parses canonical fleet budget field as budgetUsdPerDay', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'budgeted-fleet',
    limits: {
      max_concurrent_spawns: 2,
      max_spawns_per_hour: 20,
      budget_usd_per_day: 7.5,
    },
    agents: {
      qa: { backend: 'claude-cli', prompt: 'Run qa', trigger: 'git:committed' },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config).not.toBeNull();
  expect(config?.limits).toEqual({
    maxConcurrentSpawns: 2,
    maxSpawnsPerHour: 20,
    budgetUsdPerDay: 7.5,
  });
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

test('triggered agents receive message content when subscribed in-process', async () => {
  let triggerCallback = null;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const config = makeConfig({
    trigger: 'spark:idea',
  });

  const runner = createFleetRunner(config, '/tmp/proj', {
    messaging: {
      subscribe: jest.fn((channel, callback) => {
        expect(channel).toBe('spark:idea');
        triggerCallback = callback;
        return jest.fn();
      }),
    },
  });

  runner.startAgent(config.agents[0]);
  expect(typeof triggerCallback).toBe('function');

  await triggerCallback({
    payload: 'what is the most important idea I could build now?',
    sender: 'fleet-ui',
  });
  await Promise.resolve();
  await Promise.resolve();

  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:9876/spawn',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('what is the most important idea I could build now?'),
    })
  );
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

// ─── Topology Validation (CSP DAG Property) ─────────────────────────────────

describe('validateTopology', () => {
  test('acyclic topology validates clean', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'spark', schedule: '*/30 * * * *', backend: 'claude-cli', prompt: 'idea', onSuccess: 'publish spark:idea' },
        { name: 'spider', trigger: 'spark:idea', backend: 'claude-cli', prompt: 'connect', onSuccess: 'publish spider:connections' },
      ],
      watchers: [],
      channels: { 'spark:idea': { description: 'Spark ideas' }, 'spider:connections': { description: 'Spider connections' } },
    };

    const result = validateTopology(config);
    expect(result.valid).toBe(true);
    expect(result.cycles).toHaveLength(0);
  });

  test('detects direct cycle between two agents', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'a', trigger: 'ch-b', backend: 'claude-cli', prompt: 'x', onSuccess: 'publish ch-a' },
        { name: 'b', trigger: 'ch-a', backend: 'claude-cli', prompt: 'y', onSuccess: 'publish ch-b' },
      ],
      watchers: [],
      channels: { 'ch-a': { description: 'A output' }, 'ch-b': { description: 'B output' } },
    };

    const result = validateTopology(config);
    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  test('detects transitive cycle through three agents', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'a', trigger: 'ch-c', backend: 'claude-cli', prompt: 'x', onSuccess: 'publish ch-a' },
        { name: 'b', trigger: 'ch-a', backend: 'claude-cli', prompt: 'y', onSuccess: 'publish ch-b' },
        { name: 'c', trigger: 'ch-b', backend: 'claude-cli', prompt: 'z', onSuccess: 'publish ch-c' },
      ],
      watchers: [],
      channels: { 'ch-a': { description: '' }, 'ch-b': { description: '' }, 'ch-c': { description: '' } },
    };

    const result = validateTopology(config);
    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  test('fan-out topology (one channel, many consumers) is valid', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'trigger', schedule: '*/10 * * * *', backend: 'custom', prompt: 'x', onSuccess: 'publish event' },
        { name: 'a', trigger: 'event', backend: 'claude-cli', prompt: 'x' },
        { name: 'b', trigger: 'event', backend: 'claude-cli', prompt: 'y' },
        { name: 'c', trigger: 'event', backend: 'claude-cli', prompt: 'z' },
      ],
      watchers: [],
      channels: { 'event': { description: 'Trigger event' } },
    };

    const result = validateTopology(config);
    expect(result.valid).toBe(true);
    expect(result.cycles).toHaveLength(0);
  });

  test('warns about orphan channels with no producer', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'a', trigger: 'orphan', backend: 'claude-cli', prompt: 'x' },
      ],
      watchers: [],
      channels: { 'orphan': { description: 'No one publishes here' } },
    };

    const result = validateTopology(config);
    expect(result.valid).toBe(true); // No cycle, but...
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('orphan');
  });

  test('self-trigger (agent publishes to its own trigger) is not a cycle', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'self', trigger: 'self:out', backend: 'claude-cli', prompt: 'x', onSuccess: 'publish self:out' },
      ],
      watchers: [],
      channels: { 'self:out': { description: 'Self-loop' } },
    };

    // Self-triggers are filtered out (p === c check in validateTopology)
    const result = validateTopology(config);
    expect(result.valid).toBe(true);
  });

  test('Port Daddy actual fleet topology is valid', () => {
    mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
    mockExecSync.mockReturnValue('main');

    // Read real fleet YAML using pre-mock imports
    const yamlContent = realReadFileSync(
      realJoin(process.cwd(), 'pd-fleet.yml'), 'utf-8'
    );
    mockReadFileSync.mockReturnValue(yamlContent);

    const config = loadFleetConfig('/tmp/proj');
    expect(config).not.toBeNull();

    const result = validateTopology(config);
    expect(result.valid).toBe(true);
    expect(result.cycles).toHaveLength(0);
  });
});
