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
  mkdirSync: jest.fn(),
  chmodSync: jest.fn(),
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

const { loadFleetConfig, createFleetRunner, resolveFleetAgentRuntime, validateTopology } = await import('../../lib/fleet-engine.js');
const { resolveFleetChannel } = await import('../../lib/fleet-channels.js');
const { getDaemonTcpUrl } = await import('../../shared/daemon-discovery.js');

const DAEMON_URL = getDaemonTcpUrl();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a minimal valid FleetConfig for runner tests */
function makeConfig(agentOverrides = {}) {
  return {
    name: 'test-fleet',
    limits: {
      budgetUsdPerDay: 5,
    },
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
  delete process.env.PD_FLEET_DEFAULT_BACKEND;
  delete process.env.PD_FLEET_DEFAULT_MODEL;
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

test('BUG 3: array-style agents in YAML are silently dropped (zero agents loaded)', () => {
  // YAML arrays parsed by js-yaml become JS arrays.
  // loadFleetConfig only processes object-style agents (typeof === 'object' && !Array.isArray).
  // Array-format agents are silently ignored — the fleet starts with 0 agents.
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');

  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'test',
    agents: [
      { backend: 'claude-cli', prompt: 'Run qa', schedule: '*/10 * * * *' },
      { backend: 'claude-cli', prompt: 'Run docs', schedule: '*/30 * * * *' },
    ],
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config).not.toBeNull();
  // BUG: 2 agents were declared but 0 are loaded because array format is ignored.
  // This must load agents, not silently discard them.
  expect(config.agents.length).toBe(2);
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

test('uses env runtime defaults when agent backend/model are omitted', () => {
  process.env.PD_FLEET_DEFAULT_BACKEND = 'gemini';
  process.env.PD_FLEET_DEFAULT_MODEL = 'gemini-2.5-flash';
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'env-backed-fleet',
    agents: {
      scout: { prompt: 'Scan the repo', trigger: 'git:committed' },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config).not.toBeNull();
  expect(config?.agents).toEqual([
    expect.objectContaining({
      name: 'scout',
      backend: 'gemini',
      model: 'gemini-2.5-flash',
    }),
  ]);
});

test('maps model_tier to a backend-specific model', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'tiered-fleet',
    agents: {
      qa: {
        backend: 'claude-cli',
        model_tier: 'low',
        prompt: 'Review the change',
        trigger: 'git:committed',
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents).toEqual([
    expect.objectContaining({
      name: 'qa',
      backend: 'claude-cli',
      model: 'haiku',
      modelTier: 'low',
    }),
  ]);
});

test('maps model_tier for every backend family with built-in tiers', () => {
  const expectations = [
    [{ backend: 'ollama', modelTier: 'high' }, 'qwen2.5-coder:14b'],
    [{ backend: 'aider', modelTier: 'mid' }, 'gpt-4.1'],
    [{ backend: 'custom', modelTier: 'low' }, 'custom-low'],
    [{ backend: 'codex', modelTier: 'low' }, 'gpt-5.4-mini'],
  ];

  for (const [agent, expectedModel] of expectations) {
    const runtime = resolveFleetAgentRuntime(agent);
    expect(runtime.model).toBe(expectedModel);
  }
});

test('budgetUsdPerDay blocks spawn when project is over budget', async () => {
  const config = {
    ...makeConfig({
      schedule: '*/10 * * * *',
    }),
    limits: { budgetUsdPerDay: 1.25 },
  };

  const onEvent = jest.fn();
  const mockBudgetStatus = jest.fn(() => ({
    project: 'test-fleet',
    budgetUsdPerDay: 1.25,
    spentUsd: 1.5,
    remainingUsd: 0,
    percentUsed: 120,
    overBudget: true,
  }));
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const runner = createFleetRunner(config, '/tmp/proj', {
    onEvent,
    costTracker: { budgetStatus: mockBudgetStatus },
  });

  runner.startAgent(config.agents[0]);
  await Promise.resolve();
  await Promise.resolve();

  expect(global.fetch).not.toHaveBeenCalledWith(
    `${DAEMON_URL}/spawn`,
    expect.anything()
  );
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_failed',
      agent: 'test-agent',
      details: expect.objectContaining({
        error: expect.stringContaining('daily budget exceeded'),
      }),
    })
  );
  // MOCK ECHO FIX: verify budgetStatus was called with the correct project name and budget
  expect(mockBudgetStatus).toHaveBeenCalledWith('test-fleet', 1.25);
});

test('missing fleet budget blocks spawn before contacting the daemon', async () => {
  const config = {
    ...makeConfig({ schedule: '*/10 * * * *' }),
    limits: undefined,
  };

  const onEvent = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });
  runner.startAgent(config.agents[0]);
  await Promise.resolve();
  await Promise.resolve();

  expect(global.fetch).not.toHaveBeenCalledWith(
    `${DAEMON_URL}/spawn`,
    expect.anything()
  );
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_failed',
      details: expect.objectContaining({
        error: expect.stringContaining('budgetUsdPerDay'),
      }),
    })
  );
});

test('singleton agents reject overlapping hail while a run is active', async () => {
  const config = makeConfig({
    schedule: '*/10 * * * *',
    singleton: true,
  });

  global.fetch = jest.fn(() => new Promise(() => {}));
  const runner = createFleetRunner(config, '/tmp/proj');

  runner.startAgent(config.agents[0]);
  await Promise.resolve();

  const result = await runner.hailAgent('test-agent', { source: 'manual' });
  expect(result).toEqual({
    success: false,
    error: 'test-agent is singleton and already active',
  });
});

test('falls back to the next backend/model when the first spawn attempt fails', async () => {
  const config = {
    ...makeConfig({
      backend: 'gemini',
      model: 'gemini-2.5-flash',
      fallbacks: [{ backend: 'ollama', model: 'llama3.2:8b' }],
    }),
  };

  const onEvent = jest.fn();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ status: 'failed', error: 'gemini unavailable' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ agentId: 'fallback-123', status: 'spawned' }),
    });

  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });
  const result = await runner.hailAgent('test-agent', { source: 'manual' });
  const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body);
  const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);

  expect(result).toEqual({ success: true });
  expect(global.fetch).toHaveBeenNthCalledWith(
    1,
    `${DAEMON_URL}/spawn`,
    expect.objectContaining({ method: 'POST' })
  );
  expect(global.fetch).toHaveBeenNthCalledWith(
    2,
    `${DAEMON_URL}/spawn`,
    expect.objectContaining({ method: 'POST' })
  );
  expect(firstBody).toEqual(expect.objectContaining({
    backend: 'gemini',
    model: 'gemini-2.5-flash',
  }));
  expect(secondBody).toEqual(expect.objectContaining({
    backend: 'ollama',
    model: 'llama3.2:8b',
  }));
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_completed',
      details: expect.objectContaining({
        backend: 'ollama',
        model: 'llama3.2:8b',
        attempt: 2,
      }),
    })
  );
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
  await Promise.resolve();
  await Promise.resolve();

  // Spawn was called
  expect(spawnCallCount).toBe(1);

  // Publish IS now called (status 'spawned' is treated as success)
  expect(publishFetch).toHaveBeenCalledWith(
    `${DAEMON_URL}/msg/${resolveFleetChannel('fleet:done', '/tmp/proj', 'test-fleet')}`
  );
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
        expect(channel).toBe(resolveFleetChannel('spark:idea', '/tmp/proj', 'test-fleet'));
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
    `${DAEMON_URL}/spawn`,
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('what is the most important idea I could build now?'),
    })
  );
});

test('global: channels bypass project scoping for shared fanout', async () => {
  const publishFetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });

  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('/spawn')) {
      return { ok: true, json: async () => ({ agentId: 'abc', status: 'spawned' }) };
    }
    if (typeof url === 'string' && url.includes('/msg/')) {
      publishFetch(url);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  });

  const config = makeConfig({
    onSuccess: 'publish global:fleet:done',
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();

  expect(publishFetch).toHaveBeenCalledWith(`${DAEMON_URL}/msg/fleet:done`);
});

// ─── BUG A: stopAll() leaks watchHandle subscriptions ──────────────────────

test('BUG A: stopAll must call watchHandle to unsubscribe in-process triggers', () => {
  const unsubscribe = jest.fn();
  const config = makeConfig({ trigger: 'test:channel' });

  const runner = createFleetRunner(config, '/tmp/proj', {
    messaging: {
      subscribe: jest.fn(() => unsubscribe),
    },
  });

  runner.startAgent(config.agents[0]);
  // Subscription was created
  expect(unsubscribe).not.toHaveBeenCalled();

  runner.stopAll();
  // After stop, the unsubscribe function MUST have been called
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

// ─── BUG B: hailAgent singleton check uses wrong map ───────────────────────

test('BUG B: hailAgent allows singleton hail when no run is in flight', async () => {
  // Start a singleton scheduled agent. Its initial run completes quickly.
  let resolveSpawn;
  global.fetch = jest.fn().mockImplementation(() =>
    new Promise(resolve => {
      resolveSpawn = resolve;
    })
  );

  const config = makeConfig({
    schedule: '*/10 * * * *',
    singleton: true,
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  runner.startAgent(config.agents[0]);

  // Complete the initial scheduled run
  resolveSpawn({ ok: true, json: async () => ({ agentId: 'abc', status: 'spawned' }) });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Now the initial run is done — activeAgentRuns should be empty.
  // A hail to the singleton should succeed since no run is in flight.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'def', status: 'spawned' }),
  });

  const result = await runner.hailAgent('test-agent', { source: 'manual' });
  // BUG: currently returns { success: false } because running.has() is always true
  expect(result.success).toBe(true);
});

// ─── MISSING: hailAgent on non-existent agent ──────────────────────────────

test('hailAgent returns error for unknown agent name', async () => {
  const config = makeConfig();
  const runner = createFleetRunner(config, '/tmp/proj');
  const result = await runner.hailAgent('no-such-agent');
  expect(result.success).toBe(false);
  expect(result.error).toContain('no-such-agent');
});

// ─── BUG B2: hailAgent reports success even when spawn is rejected ───────────

test('BUG B2: hailAgent must return failure when spawn is blocked by quota', async () => {
  const config = {
    ...makeConfig({ schedule: undefined, trigger: undefined }),
    limits: { budgetUsdPerDay: 5, maxConcurrentSpawns: 0 },  // zero concurrency → always blocked
  };

  const onEvent = jest.fn();
  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });
  const result = await runner.hailAgent('test-agent', { source: 'manual' });

  // BUG: currently returns { success: true } because runAgentOnce
  // swallows the quota failure and hailAgent doesn't check.
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
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
    expect(result.warnings.some((warning) => warning.includes('orphan'))).toBe(true);
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

// ─── BUG 7: runAgentOnce sends agent.identity (undefined) not computed fallback ─

test('BUG 7: spawn body uses computed identity fallback when agent.identity is undefined', async () => {
  // When agent.identity is undefined, the code computes a fallback:
  //   const identity = agent.identity || `${project}:fleet:${agent.name}`;
  // But then does: body.identity = agent.identity (the raw undefined).
  // The spawn request sends identity: undefined → agent registers with no identity.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const config = makeConfig(); // agent has no identity field
  const runner = createFleetRunner(config, '/tmp/proj');
  runner.startAgent(config.agents[0]);

  await Promise.resolve();
  await Promise.resolve();

  const spawnCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();
  const body = JSON.parse(spawnCall[1].body);
  // Identity should be the computed fallback, not undefined
  expect(body.identity).toBe('test-fleet:fleet:test-agent');
  expect(body.budgetUsd).toBe(5);
});

// ─── MISSING: hourly rate limit enforcement ──────────────────────────────────

test('maxSpawnsPerHour blocks spawn after limit is reached', async () => {
  const config = {
    ...makeConfig({ schedule: '*/5 * * * *' }),
    limits: { budgetUsdPerDay: 5, maxSpawnsPerHour: 2 },
  };

  const onEvent = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });
  runner.startAgent(config.agents[0]); // triggers first runAgentOnce immediately
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Manually hail to trigger second run
  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();

  // Third should be blocked by hourly rate limit
  const result = await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();

  // Find the failed event with hourly spawn limit reason
  const failedEvents = onEvent.mock.calls
    .map(c => c[0])
    .filter(e => e.type === 'agent_failed' && e.details?.error?.includes('hourly spawn limit'));
  expect(failedEvents.length).toBeGreaterThan(0);
});

// ─── BUG C: concurrency limit releases after spawn completes ────────────────

test('BUG C: activeSpawns decrements after spawn resolves, allowing next spawn', async () => {
  // With maxConcurrentSpawns=1, the first spawn should succeed and after
  // it resolves, the second should also succeed (not be stuck at limit).
  const config = {
    ...makeConfig({ schedule: undefined, trigger: undefined }),
    limits: { budgetUsdPerDay: 5, maxConcurrentSpawns: 1 },
  };

  let callCount = 0;
  global.fetch = jest.fn().mockImplementation(async () => {
    callCount++;
    return { ok: true, json: async () => ({ agentId: `spawn-${callCount}`, status: 'spawned' }) };
  });

  const runner = createFleetRunner(config, '/tmp/proj');

  // First hail — should succeed
  const r1 = await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Second hail — should also succeed because first completed (finally decremented activeSpawns)
  const r2 = await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();

  expect(r1.success).toBe(true);
  expect(r2.success).toBe(true);
  expect(callCount).toBe(2);
});

// ─── BUG D: loadFleetConfig with nested fleet.limits vs top-level limits ────

test('fleet.limits inside nested fleet key are parsed correctly', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    fleet: {
      name: 'nested-fleet',
      limits: {
        max_concurrent_spawns: 3,
        max_spawns_per_hour: 10,
        budget_usd_per_day: 2.5,
      },
      agents: {
        worker: { backend: 'claude-cli', prompt: 'work' },
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config).not.toBeNull();
  expect(config.limits).toEqual({
    maxConcurrentSpawns: 3,
    maxSpawnsPerHour: 10,
    budgetUsdPerDay: 2.5,
  });
});

// ─── BUG E: onFailure fires for HTTP error even when status is missing ──────

test('onFailure fires when /spawn returns HTTP error', async () => {
  const failureFetch = jest.fn();
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('/spawn')) {
      return { ok: false, status: 500, json: async () => ({ error: 'internal error' }) };
    }
    if (typeof url === 'string' && url.includes('/msg/')) {
      failureFetch(url);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  });

  const config = makeConfig({
    onFailure: 'publish fleet:errors',
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  // Use hailAgent to trigger runAgentOnce (startAgent only auto-runs scheduled agents)
  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(failureFetch).toHaveBeenCalledWith(
    `${DAEMON_URL}/msg/${resolveFleetChannel('fleet:errors', '/tmp/proj', 'test-fleet')}`
  );
});

// ─── BUG F: trimMessage edge — exactly maxChars should not truncate ─────────

test('trimMessage at exactly maxChars returns message unchanged', async () => {
  // Build a prompt that's exactly 4000 chars — should NOT get truncated
  const longPrompt = 'x'.repeat(4000);
  const config = makeConfig({ prompt: longPrompt });

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  // Use hailAgent to trigger runAgentOnce (startAgent only auto-runs scheduled agents)
  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();

  const spawnCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();
  const body = JSON.parse(spawnCall[1].body);
  // Task should contain the full prompt without truncation marker
  expect(body.task).not.toContain('[truncated');
  expect(body.task.length).toBeGreaterThanOrEqual(4000);
});
