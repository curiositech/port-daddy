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
import { parse as realYamlParse, parseDocument as realParseDocument, LineCounter as RealLineCounter, isScalar as realIsScalar, isMap as realIsMap, isSeq as realIsSeq } from 'yaml';

// ─── Mocks (must be set up before any import of the module under test) ───────

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  appendFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: mockMkdirSync,
  chmodSync: jest.fn(),
  // The fleet engine now transitively imports the pluggable I/O registry
  // (lib/fleet/io-dispatch.ts), whose file trigger uses fs.watch. The
  // wholesale node:fs mock must surface it or module link fails.
  watch: jest.fn(() => ({ close: jest.fn() })),
  // …and the calendar channel's EventKit bridge (lib/fleet/calendar-
  // eventkit.ts) stats the helper source/binary at module-eval time.
  statSync: jest.fn(() => ({ mtimeMs: 0 })),
  // …and lib/skill-graft.ts transitively imports lib/shipwright/skill-index.ts,
  // whose catalog walker calls readdirSync. Some tests below DO set
  // `skill_graft: true` on an agent, but every one of them injects a fake
  // `options.skillGraft` (see "Skill Graft wiring" tests), so the real
  // createSkillGraftIndex()/loadSkillCatalog() path — the thing that would
  // actually call readdirSync — is never reached. This stub only needs to
  // exist so ESM module linking succeeds for lib/skill-graft.ts's import.
  readdirSync: jest.fn(() => []),
}));

const mockSpawn = jest.fn();
const mockExecSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
  execFileSync: jest.fn(),
  // The fleet engine transitively imports the I/O registry; the macOS
  // notification sink (lib/fleet/outputs/notify-macos.ts) uses execFile.
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
  // watcher-pid-registry.ts's getCommandLineForPid() uses spawnSync (`ps`)
  // to confirm a watcher child's identity before killing it. Return a
  // not-found shape by default — no test in this file exercises the
  // orphaned-watcher sweep's `ps` call directly (that's covered in
  // watcher-pid-registry.test.js), so this only needs to not throw.
  spawnSync: jest.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

// yaml must be available for fleet-engine to import.
// fleet-ast.ts (imported transitively) needs parseDocument, LineCounter,
// isScalar, isMap, isSeq — pass the real implementations through so that
// JSON fixtures (valid YAML superset) parse correctly with position tracking.
jest.unstable_mockModule('yaml', () => ({
  parse: (text) => {
    // Most tests pass JSON. Fall back to real YAML parser for actual YAML.
    try { return JSON.parse(text); } catch { return realYamlParse(text); }
  },
  parseDocument: realParseDocument,
  LineCounter:   RealLineCounter,
  isScalar:      realIsScalar,
  isMap:         realIsMap,
  isSeq:         realIsSeq,
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

const { loadFleetConfig, createFleetRunner, resolveFleetAgentRuntime, validateTopology, parseCronInterval, isIntervalCronSchedule, isAbsoluteCronSchedule, computeNextAbsoluteFireDelayMs } = await import('../../lib/fleet-engine.js');
const { parseFleetSource, astToConfig } = await import('../../lib/fleet-ast.js');
const { resolveFleetChannel } = await import('../../lib/fleet-channels.js');
const { getDaemonTcpUrl } = await import('../../shared/daemon-discovery.js');

const DAEMON_URL = getDaemonTcpUrl('http://127.0.0.1:4319');

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

function tuplePrefixMatch(fields, pattern) {
  if (!Array.isArray(pattern) || pattern.length === 0) return true;
  if (pattern.length > fields.length) return false;
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i];
    if (expected === '*' || expected === null) continue;
    if (fields[i] !== expected) return false;
  }
  return true;
}

function createMockTupleSpace() {
  const entries = [];
  return {
    out: jest.fn((fields, options = {}) => {
      const tuple = {
        id: entries.length + 1,
        harbor: options.harbor ?? null,
        fields,
      };
      entries.unshift(tuple);
      return tuple;
    }),
    take: jest.fn((pattern, options = {}) => {
      const harbor = options.harbor;
      const limit = options.limit ?? 1;
      const taken = [];
      for (let i = 0; i < entries.length && taken.length < limit; ) {
        const tuple = entries[i];
        const harborMatches = harbor === undefined || tuple.harbor === harbor;
        if (harborMatches && tuplePrefixMatch(tuple.fields, pattern)) {
          taken.push(tuple);
          entries.splice(i, 1);
          continue;
        }
        i += 1;
      }
      return taken;
    }),
    count: jest.fn((pattern, harbor) => entries.filter((tuple) => {
      const harborMatches = harbor === undefined || tuple.harbor === harbor;
      return harborMatches && tuplePrefixMatch(tuple.fields, pattern);
    }).length),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  process.env.PD_URL = DAEMON_URL;

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
  delete process.env.PD_URL;
  delete process.env.PD_FLEET_DEFAULT_BACKEND;
  delete process.env.PD_FLEET_DEFAULT_MODEL;
  delete process.env.PD_MODEL_TIER_CLAUDE_CLI_LOW;
});

// ─── Bug 1: */0 cron produces 0ms interval ───────────────────────────────────

test('BUG 1: schedule */0 * * * * is refused instead of arming a runaway timer', () => {
  const config = makeConfig({ schedule: '*/0 * * * *' });
  const onEvent = jest.fn();
  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'agent_failed',
    details: expect.objectContaining({ error: expect.stringContaining('unsupported cron schedule') }),
  }));
  errSpy.mockRestore();
});

// ─── Bug 2: */abc cron produces NaN interval ─────────────────────────────────

test('BUG 2: schedule */abc * * * * is refused instead of arming a NaN timer', () => {
  const config = makeConfig({ schedule: '*/abc * * * *' });
  const onEvent = jest.fn();
  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_failed' }));
  errSpy.mockRestore();
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
  expect(config.agents.map((agent) => agent.name)).toEqual(['run-qa', 'run-docs']);
  expect(config.agents.map((agent) => agent.name)).not.toContain('agent-1');
});

// ─── Bug 4: empty YAML → null → TypeError ────────────────────────────────────

test('BUG 4: empty pd-fleet.yml throws instead of returning null or empty config', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(''); // empty file

  // Should not throw — should return null or an empty config
  expect(() => loadFleetConfig('/tmp/proj')).not.toThrow();
});

test('loadFleetConfig avoids git probes when YAML only uses project templates', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockReadFileSync.mockReturnValue(`
name: fleet
harbor: "{project}:fleet"
agents:
  - name: qa
    backend: claude-cli
    prompt: "run qa in {project_dir}"
watchers: []
channels: {}
limits:
  budget_usd_per_day: 5
`);

  const config = loadFleetConfig('/tmp/proj');

  expect(config).not.toBeNull();
  expect(config.harbor).toBe('fleet:fleet');
  expect(config.agents[0].prompt).toBe('run qa in /tmp/proj');
  expect(mockExecSync).not.toHaveBeenCalled();
});

test('loadFleetConfig still resolves branch and sha templates when requested', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync
    .mockReturnValueOnce('feature-daemon\n')
    .mockReturnValueOnce('abc1234\n')
    .mockReturnValueOnce('feature-daemon\n')
    .mockReturnValueOnce('abc1234\n');
  mockReadFileSync.mockReturnValue(`
name: fleet-{branch}
agents:
  - name: qa
    backend: claude-cli
    prompt: "run qa at {sha}"
watchers: []
channels: {}
limits:
  budget_usd_per_day: 5
`);

  const config = loadFleetConfig('/tmp/proj');

  expect(config).not.toBeNull();
  expect(config.name).toBe('fleet-feature-daemon');
  expect(config.agents[0].prompt).toBe('run qa at abc1234');
  expect(mockExecSync).toHaveBeenCalledTimes(4);
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

test('parses trigger_tuple arrays from fleet yaml', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'tuple-fleet',
    agents: {
      qa: {
        backend: 'claude-cli',
        prompt: 'Review tuple mailbox',
        trigger_tuple: ['fleet:mailbox', 'qa'],
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents[0].triggerTuple).toEqual(['fleet:mailbox', 'qa']);
});

test('parses scheduled agent run_on_start opt-in from fleet yaml', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'scheduled-fleet',
    agents: {
      cartographer: {
        backend: 'claude-cli',
        prompt: 'Map the repo',
        schedule: '*/30 * * * *',
        run_on_start: true,
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents[0]).toEqual(expect.objectContaining({
    name: 'cartographer',
    schedule: '*/30 * * * *',
    runOnStart: true,
  }));
});

test('ignores camelCase runOnStart in fleet yaml when run_on_start is false', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'scheduled-fleet',
    agents: {
      cartographer: {
        backend: 'claude-cli',
        prompt: 'Map the repo',
        schedule: '*/30 * * * *',
        run_on_start: false,
        runOnStart: true,
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents[0]).toEqual(expect.objectContaining({
    name: 'cartographer',
    schedule: '*/30 * * * *',
    runOnStart: false,
  }));
});

test('omits disabled and malformed-enabled agents before runtime projection', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'disabled-fleet',
    agents: {
      dark: {
        enabled: false,
        backend: 'custom',
        prompt: 'must never run',
        schedule: '0 1 * * *',
      },
      malformed: {
        enabled: 'false',
        backend: 'custom',
        prompt: 'must also never run',
        schedule: '0 1 * * *',
      },
      armed: {
        enabled: true,
        backend: 'claude-cli',
        prompt: 'review',
        trigger: 'git:committed',
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents.map(agent => agent.name)).toEqual(['armed']);
});

test('parses per-agent cooldown, dedupe, and backoff settings from YAML', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    name: 'bounded-fleet',
    agents: {
      qa: {
        backend: 'claude-cli',
        prompt: 'Run qa',
        cooldown_ms: 30000,
        dedupe_window_ms: 120000,
        backoff_base_ms: 5000,
        backoff_max_ms: 60000,
        backoff_multiplier: 3,
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents).toEqual([
    expect.objectContaining({
      name: 'qa',
      cooldownMs: 30000,
      dedupeWindowMs: 120000,
      backoffBaseMs: 5000,
      backoffMaxMs: 60000,
      backoffMultiplier: 3,
    }),
  ]);
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

test('uses fleet YAML backend and model_tier defaults when agent runtime is omitted', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    fleet: {
      name: 'yaml-defaults-fleet',
      defaults: {
        backend: 'claude-cli',
        model_tier: 'low',
      },
      agents: {
        qa: { prompt: 'Review the change', trigger: 'git:committed' },
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

test('resolves project templates from fleet.name instead of checkout basename', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    fleet: {
      name: 'port-daddy',
      harbor: '{project}:fleet',
      agents: {
        cartographer: {
          prompt: 'Map the repo',
          backend: 'codex',
          model: 'gpt-5.4-mini',
          schedule: '*/30 * * * *',
          identity: '{project}:fleet:cartographer',
        },
      },
      channels: {
        'git:committed': {
          description: 'commit event for {project}',
        },
      },
    },
  }));

  const config = loadFleetConfig('/Users/erichowens/port-daddy-stable');
  expect(config).toEqual(expect.objectContaining({
    name: 'port-daddy',
    harbor: 'port-daddy:fleet',
    channels: expect.objectContaining({
      'git:committed': expect.objectContaining({
        description: 'commit event for port-daddy',
      }),
    }),
  }));
  expect(config?.agents[0]).toEqual(expect.objectContaining({
    name: 'cartographer',
    identity: 'port-daddy:fleet:cartographer',
  }));
});

test('accepts camelCase modelTier but prefers explicit agent runtime over fleet defaults', () => {
  mockExistsSync.mockImplementation(p => p.endsWith('pd-fleet.yml'));
  mockExecSync.mockReturnValue('main');
  mockReadFileSync.mockReturnValue(JSON.stringify({
    fleet: {
      name: 'mixed-defaults-fleet',
      defaults: {
        backend: 'claude-cli',
        modelTier: 'high',
      },
      agents: {
        qa: { prompt: 'Review', trigger: 'git:committed', model_tier: 'low' },
        local: { prompt: 'Local review', backend: 'ollama', model_tier: 'low' },
      },
    },
  }));

  const config = loadFleetConfig('/tmp/proj');
  expect(config?.agents).toEqual([
    expect.objectContaining({ name: 'qa', backend: 'claude-cli', model: 'haiku', modelTier: 'low' }),
    expect.objectContaining({ name: 'local', backend: 'ollama', model: 'qwen2.5-coder:7b', modelTier: 'low' }),
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
    [{ backend: 'cloudflare', modelTier: 'mid' }, '@cf/openai/gpt-oss-120b'],
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
      runOnStart: true,
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
    ...makeConfig({ schedule: '*/10 * * * *', runOnStart: true }),
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
    runOnStart: true,
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

test('runner exposes armed, paused, and running agent states truthfully', async () => {
  const config = makeConfig({ trigger: 'git:committed' });
  const runner = createFleetRunner(config, '/tmp/proj');

  runner.startAgent(config.agents[0]);
  expect(runner.getStatus()).toEqual([
    expect.objectContaining({
      name: 'test-agent',
      status: 'armed',
      paused: false,
      running: false,
    }),
  ]);

  expect(runner.pauseAgent('test-agent')).toEqual({ success: true });
  expect(runner.getStatus()).toEqual([
    expect.objectContaining({
      name: 'test-agent',
      status: 'paused',
      paused: true,
      running: false,
    }),
  ]);

  expect(runner.resumeAgent('test-agent')).toEqual({ success: true });
  expect(runner.getStatus()).toEqual([
    expect.objectContaining({
      name: 'test-agent',
      status: 'armed',
      paused: false,
      running: false,
    }),
  ]);
});

test('trigger watcher fallback invokes Port Daddy from the installed runtime, not the target repo', () => {
  const config = makeConfig({ trigger: 'git:committed' });
  const runner = createFleetRunner(config, '/tmp/plain-ruby-repo');

  runner.startAgent(config.agents[0]);

  expect(mockSpawn).toHaveBeenCalled();
  const [command, args] = mockSpawn.mock.calls[0];
  expect(command).toBe('pd');
  expect(args).toEqual(expect.arrayContaining(['watch', '--exec']));
  expect(args).not.toContain('tsx');
  expect(args.join(' ')).not.toContain('/tmp/plain-ruby-repo/bin/port-daddy-cli.ts');

  const execIndex = args.indexOf('--exec');
  const execCommand = args[execIndex + 1];
  expect(execCommand).toContain('"spawn"');
  expect(execCommand).not.toContain('/tmp/plain-ruby-repo');
});

test('YAML watcher fallback invokes Port Daddy from the installed runtime, not the target repo', async () => {
  const projectDir = '/tmp/plain-ruby-repo';
  const config = {
    name: 'test-fleet',
    limits: { budgetUsdPerDay: 5 },
    agents: [],
    watchers: [
      { name: 'notify', trigger: 'qa:findings', exec: 'echo "$PD_MESSAGE_CONTENT"' },
    ],
    channels: {},
  };
  const physicalChannel = resolveFleetChannel('qa:findings', projectDir, config.name);
  const runner = createFleetRunner(config, projectDir);

  runner.startAll();
  await Promise.resolve();
  await Promise.resolve();

  expect(mockSpawn).toHaveBeenCalled();
  const [command, args] = mockSpawn.mock.calls[0];
  expect(command).toBe('pd');
  expect(args).toEqual(['watch', physicalChannel, '--exec', 'echo "$PD_MESSAGE_CONTENT"']);
  expect(args).not.toContain('tsx');
  expect(args.join(' ')).not.toContain('/tmp/plain-ruby-repo/bin/port-daddy-cli.ts');
});

// 4th Copilot review round, PR #879: sweepOrphanedWatcherChildren() used to
// call saveWatcherPidRegistry() unconditionally on every startAll(), which
// meant every test (and every real fleet boot) that never spawned an
// external watcher child would still mkdirSync + writeFileSync an
// empty/unchanged ~/.port-daddy/watcher-pids.json as a pure side effect.
// mockExistsSync defaults to `undefined` (falsy) for this project's config
// file paths in most tests, so loadWatcherPidRegistry sees "no file" (an
// empty registry) here -- exactly the no-op case the guard exists for.
test('startAll() does not write the watcher-pid registry when there is nothing to sweep', async () => {
  const config = makeConfig({ trigger: 'git:committed' });
  const runner = createFleetRunner(config, '/tmp/plain-ruby-repo');

  runner.startAll();
  await Promise.resolve();
  await Promise.resolve();

  expect(mockWriteFileSync).not.toHaveBeenCalledWith(
    expect.stringContaining('watcher-pids.json'),
    expect.anything(),
  );
  expect(mockMkdirSync).not.toHaveBeenCalledWith(
    expect.stringContaining('.port-daddy'),
    expect.anything(),
  );
});

test('runner can deploy a subset by pausing unselected agents', async () => {
  const config = {
    ...makeConfig(),
    agents: [
      { name: 'qa', backend: 'claude-cli', prompt: 'Review code', trigger: 'git:committed' },
      { name: 'docs', backend: 'claude-cli', prompt: 'Write docs', trigger: 'git:committed' },
    ],
  };

  const runner = createFleetRunner(config, '/tmp/proj', { initiallyPausedAgents: ['docs'] });
  runner.startAll();
  await Promise.resolve();

  expect(runner.getStatus()).toEqual([
    expect.objectContaining({ name: 'qa', status: 'armed', paused: false }),
    expect.objectContaining({ name: 'docs', status: 'paused', paused: true }),
  ]);
});

test('falls back to the next backend/model when the first spawn attempt fails', async () => {
  const config = {
    ...makeConfig({
      backend: 'gemini',
      model: 'gemini-2.5-flash',
      fallbacks: [{ backend: 'ollama', model: 'llama3.1:8b' }],
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
    model: 'llama3.1:8b',
  }));
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_completed',
      details: expect.objectContaining({
        backend: 'ollama',
        model: 'llama3.1:8b',
        attempt: 2,
      }),
    })
  );
});

// ─── Bug 5: onSuccess/onFailure never fires (dead code) ──────────────────────

test('scheduled agents arm on start without immediately spawning by default', async () => {
  const config = makeConfig({
    schedule: '*/10 * * * *',
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  runner.startAgent(config.agents[0]);

  await Promise.resolve();
  await Promise.resolve();

  expect(global.fetch).not.toHaveBeenCalledWith(
    `${DAEMON_URL}/spawn`,
    expect.anything()
  );

  runner.stopAll();
});

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
    runOnStart: true,
    onSuccess: 'publish fleet:done',
  });

  const runner = createFleetRunner(config, '/tmp/proj');
  runner.startAgent(config.agents[0]); // run_on_start preserves immediate run behavior

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

test('I/O wiring: a registry-kind trigger (file:) does NOT go through the legacy channel subscribe', async () => {
  // The engine must route file:/email:/sms:/calendar:/webhook: triggers
  // through the pluggable registry, not the coordination-channel path.
  const subscribe = jest.fn(() => jest.fn());
  const config = makeConfig({ trigger: 'file:changed(/nonexistent/path/io-test)' });
  const runner = createFleetRunner(config, '/tmp/proj', { messaging: { subscribe } });

  runner.startAgent(config.agents[0]);
  // Await the async registry start so nothing logs/leaks after the test.
  await runner.whenTriggersReady();
  runner.stopAll();

  // The legacy channel subscribe must NOT be called for a registry-kind
  // trigger — that would mean it was mis-routed to the coordination path.
  expect(subscribe).not.toHaveBeenCalled();
});

test('I/O wiring: a legacy coordination channel trigger STILL goes through messaging.subscribe', () => {
  const subscribe = jest.fn(() => jest.fn());
  const config = makeConfig({ trigger: 'git:committed' });
  const runner = createFleetRunner(config, '/tmp/proj', { messaging: { subscribe } });

  runner.startAgent(config.agents[0]);
  runner.stopAll();

  // git:/pd:/github: + bare channel names stay on the legacy path (no regression).
  expect(subscribe).toHaveBeenCalledTimes(1);
});

test('I/O wiring: plural triggers[] route registry vs legacy kinds independently', async () => {
  const subscribe = jest.fn(() => jest.fn());
  const config = makeConfig({
    trigger: undefined,
    triggers: ['file:changed(/nonexistent/io-test)', 'qa:findings'],
  });
  const runner = createFleetRunner(config, '/tmp/proj', { messaging: { subscribe } });

  runner.startAgent(config.agents[0]);
  await runner.whenTriggersReady();
  runner.stopAll();

  // Only the legacy `qa:findings` should hit messaging.subscribe; the file:
  // trigger goes through the registry (and is refused at start() for the
  // nonexistent path — logged, not subscribed).
  expect(subscribe).toHaveBeenCalledTimes(1);
  const [channel] = subscribe.mock.calls[0];
  expect(channel).toContain('qa:findings');
});

test('I/O wiring: a not-ready registry trigger (email:) is refused via console.error, engine does not crash', async () => {
  // QA gap #4: a registry-kind trigger whose available() is {ready:false}
  // must surface a diagnostic and NOT crash or hang the engine.
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const subscribe = jest.fn(() => jest.fn());
  const config = makeConfig({ trigger: 'email:received(from:@team.com)' });
  const runner = createFleetRunner(config, '/tmp/proj', { messaging: { subscribe } });

  runner.startAgent(config.agents[0]);
  await runner.whenTriggersReady();

  // Email is a stub: refused at available(), logged, never subscribed.
  expect(subscribe).not.toHaveBeenCalled();
  const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  expect(logged).toMatch(/Trigger "email:received.*not started/);
  runner.stopAll();
  errorSpy.mockRestore();
});

test('I/O wiring: stopAll() before an async trigger start settles disposes the handle and stays silent', async () => {
  // Regression for the "Cannot log after tests are done" leak: if the runner
  // is stopped while a registry trigger start is in flight, the late
  // resolution must self-suppress (no log) and dispose any handle.
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const config = makeConfig({ trigger: 'email:received(from:@team.com)' });
  const runner = createFleetRunner(config, '/tmp/proj', {});

  runner.startAgent(config.agents[0]);
  runner.stopAll(); // stop BEFORE the async start resolves
  await runner.whenTriggersReady();

  // The late resolution self-suppressed because the runner is stopped.
  const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
  expect(logged).not.toMatch(/not started/);
  errorSpy.mockRestore();
});

test('tuple mailbox entries are consumed as fleet inputs', async () => {
  const tuples = createMockTupleSpace();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const config = makeConfig({
    trigger: 'git:committed',
  });

  const runner = createFleetRunner(config, '/tmp/proj', {
    tuples,
    tuplePollMs: 500,
  });

  runner.startAgent(config.agents[0]);
  tuples.out(['fleet:mailbox', 'test-agent', 'tuple', {
    messageContent: 'Writing the CSS for Port Daddy website design system',
    message: { topic: 'design-system-css' },
  }], {
    harbor: 'test-fleet:fleet',
    writtenBy: 'spark',
  });

  jest.advanceTimersByTime(600);
  await Promise.resolve();
  await Promise.resolve();

  expect(global.fetch).toHaveBeenCalledWith(
    `${DAEMON_URL}/spawn`,
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Writing the CSS for Port Daddy website design system'),
    }),
  );
  expect(tuples.count(['fleet:mailbox', 'test-agent'], 'test-fleet:fleet')).toBe(0);
  expect(tuples.out.mock.calls.some((call) => call[0][0] === 'semantic:alias')).toBe(true);
});

test('fleet runs forward aliases into the semantic resolver review stream', async () => {
  const observeAliases = jest.fn();
  const config = makeConfig();
  const runner = createFleetRunner(config, '/tmp/proj', {
    semanticResolver: { observeAliases },
  });

  await runner.hailAgent('test-agent', {
    source: 'manual',
    messageContent: 'Writing the CSS for Port Daddy website design system',
  });
  await Promise.resolve();
  await Promise.resolve();

  expect(observeAliases).toHaveBeenCalledWith(expect.objectContaining({
    projectDir: '/tmp/proj',
    harbor: 'test-fleet:fleet',
    sourceType: 'fleet_agent_task',
  }));
  const [payload] = observeAliases.mock.calls[0];
  expect(payload.aliases[0].canonical).toContain('css');
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

test('YAML watchers use daemon-owned subscriptions instead of leaking pd watch processes', async () => {
  let watcherCallback;
  const unsubscribe = jest.fn();
  const subscribe = jest.fn((channel, callback) => {
    watcherCallback = callback;
    return unsubscribe;
  });
  const projectDir = '/tmp/proj';
  const config = {
    name: 'test-fleet',
    limits: { budgetUsdPerDay: 5 },
    agents: [],
    watchers: [
      { name: 'notify', trigger: 'qa:findings', exec: 'echo "$PD_MESSAGE_CONTENT"' },
    ],
    channels: {},
  };
  const physicalChannel = resolveFleetChannel('qa:findings', projectDir, config.name);

  const runner = createFleetRunner(config, projectDir, {
    messaging: { subscribe },
  });

  runner.startAll();
  await Promise.resolve();
  await Promise.resolve();

  expect(subscribe).toHaveBeenCalledWith(physicalChannel, expect.any(Function));
  expect(mockSpawn).not.toHaveBeenCalled();

  watcherCallback({ payload: 'QA found issues' });

  expect(mockSpawn).toHaveBeenCalledWith(
    '/bin/sh',
    ['-c', 'echo "$PD_MESSAGE_CONTENT"'],
    expect.objectContaining({
      cwd: projectDir,
      shell: false,
      stdio: 'ignore',
      env: expect.objectContaining({
        PD_CHANNEL: physicalChannel,
        PD_MESSAGE_CONTENT: 'QA found issues',
      }),
    }),
  );

  runner.stopAll();
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
    runOnStart: true,
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

test('valid cron 0 * * * * arms a setTimeout at the next top of the hour (was a boot-anchored setInterval — same drift bug as the daily-absolute case)', () => {
  // "0 * * * *" is a fixed-minute pattern ("M * * * *"), one of the two
  // shapes isAbsoluteCronSchedule/computeNextAbsoluteFireDelayMs now handle.
  // The old fixed-3600000ms setInterval fired at boot+1h, boot+2h, ... never
  // converging on wall-clock :00 — the same anchoring defect the named
  // daily-at-1am bug had, just capped at 59 minutes of drift instead of
  // firing every 10 minutes. It now gets the same next-fire-time treatment.
  jest.setSystemTime(new Date(2026, 0, 15, 9, 30, 0, 0)); // 09:30 — 30 min to :00
  const config = makeConfig({ schedule: '0 * * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy).not.toHaveBeenCalled();
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
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

// ─── Absolute (fixed-clock) cron schedules ───────────────────────────────────
//
// Regression coverage for the bug pd-fleet.yml's dispatch-runner precondition
// notes named: parseCronInterval coerced an absolute hour-of-day schedule
// ("0 1 * * *") to DEFAULT_INTERVAL, so a daily-at-1am agent's setInterval
// fired every 10 minutes instead. isAbsoluteCronSchedule/
// computeNextAbsoluteFireDelayMs now route "M H * * *" and "M * * * *"
// patterns to a self-re-arming setTimeout chain that fires on the actual
// next occurrence instead.

describe('isAbsoluteCronSchedule', () => {
  test('recognizes a fixed daily hour-of-day pattern', () => {
    expect(isAbsoluteCronSchedule('0 1 * * *')).toBe(true);
  });

  test('recognizes a fixed minute-of-hour pattern (hour wildcard)', () => {
    expect(isAbsoluteCronSchedule('15 * * * *')).toBe(true);
  });

  test('rejects */N step patterns — those stay on the interval fast path', () => {
    expect(isAbsoluteCronSchedule('*/5 * * * *')).toBe(false);
    expect(isAbsoluteCronSchedule('0 */4 * * *')).toBe(false);
  });

  test('rejects a constrained day-of-week field (honest limitation: no calendar walk)', () => {
    // pd-fleet.yml's tenderfoot ship uses "0 8 * * 1" (Monday 8am). This
    // module doesn't walk weekdays, so it declines rather than fire on the
    // wrong day. startAgent refuses the unsupported shape below.
    expect(isAbsoluteCronSchedule('0 8 * * 1')).toBe(false);
    // Same honesty for a constrained day-of-month and a fully-pinned date:
    // any non-'*' calendar field is outside the supported subset.
    expect(isAbsoluteCronSchedule('0 1 15 * *')).toBe(false);
    expect(isAbsoluteCronSchedule('0 1 15 6 *')).toBe(false);
  });

  test('rejects a constrained day-of-month field', () => {
    expect(isAbsoluteCronSchedule('0 1 15 * *')).toBe(false);
  });

  test('rejects malformed/too-short input', () => {
    expect(isAbsoluteCronSchedule('garbage')).toBe(false);
    expect(isAbsoluteCronSchedule('0 25 * * *')).toBe(false); // hour out of range
  });
});

describe('isIntervalCronSchedule', () => {
  test('recognizes only the supported minute and hour step shapes', () => {
    expect(isIntervalCronSchedule('*/5 * * * *')).toBe(true);
    expect(isIntervalCronSchedule('0 */4 * * *')).toBe(true);
  });

  test('rejects zero, malformed, out-of-range, and calendar-constrained steps', () => {
    expect(isIntervalCronSchedule('*/0 * * * *')).toBe(false);
    expect(isIntervalCronSchedule('*/abc * * * *')).toBe(false);
    expect(isIntervalCronSchedule('*/60 * * * *')).toBe(false);
    expect(isIntervalCronSchedule('0 */24 * * *')).toBe(false);
    expect(isIntervalCronSchedule('*/5 * * * 1')).toBe(false);
  });
});

describe('computeNextAbsoluteFireDelayMs', () => {
  test('"0 1 * * *" schedules the next 01:00 later the same day', () => {
    const now = new Date(2026, 0, 15, 0, 30, 0, 0).getTime(); // Jan 15, 00:30
    const expected = new Date(2026, 0, 15, 1, 0, 0, 0).getTime() - now;
    expect(computeNextAbsoluteFireDelayMs('0 1 * * *', now)).toBe(expected);
  });

  test('"0 1 * * *" rolls to tomorrow\'s 01:00 once today\'s has passed', () => {
    const now = new Date(2026, 0, 15, 1, 30, 0, 0).getTime(); // Jan 15, 01:30 — past today's tick
    const expected = new Date(2026, 0, 16, 1, 0, 0, 0).getTime() - now;
    expect(computeNextAbsoluteFireDelayMs('0 1 * * *', now)).toBe(expected);
  });

  test('"15 * * * *" schedules the next :15 within the current or next hour', () => {
    const now = new Date(2026, 0, 15, 9, 45, 0, 0).getTime(); // Jan 15, 09:45 — past this hour's :15
    const expected = new Date(2026, 0, 15, 10, 15, 0, 0).getTime() - now;
    expect(computeNextAbsoluteFireDelayMs('15 * * * *', now)).toBe(expected);
  });

  test('returns null for schedules isAbsoluteCronSchedule rejects', () => {
    expect(computeNextAbsoluteFireDelayMs('*/5 * * * *')).toBeNull();
    expect(computeNextAbsoluteFireDelayMs('0 8 * * 1')).toBeNull();
    expect(computeNextAbsoluteFireDelayMs('garbage')).toBeNull();
  });

  test('"0 0 * * *" just after midnight schedules the NEXT midnight, never an immediate fire', () => {
    // The exact boundary: hour 0 with `now` seconds past 00:00 must roll the
    // day forward (next.getTime() <= now branch), not fire at once or today.
    const now = new Date(2026, 0, 15, 0, 0, 30, 0).getTime(); // Jan 15, 00:00:30
    const expected = new Date(2026, 0, 16, 0, 0, 0, 0).getTime() - now;
    const delay = computeNextAbsoluteFireDelayMs('0 0 * * *', now);
    expect(delay).toBe(expected);
    expect(delay).toBeGreaterThan(0);
  });

  test('"0 0 * * *" one second before midnight fires in exactly one second', () => {
    const now = new Date(2026, 0, 15, 23, 59, 59, 0).getTime(); // Jan 15, 23:59:59
    expect(computeNextAbsoluteFireDelayMs('0 0 * * *', now)).toBe(1000);
  });

  test('"0 0 * * *" at the exact fire instant rolls a full day forward, never zero', () => {
    // delay 0 would re-fire immediately in a tight loop; <= comparison must
    // push the equal-instant case to the next day.
    const now = new Date(2026, 0, 15, 0, 0, 0, 0).getTime(); // Jan 15, 00:00:00.000
    expect(computeNextAbsoluteFireDelayMs('0 0 * * *', now)).toBe(24 * 60 * 60 * 1000);
  });
});

test('parseCronInterval retains its direct-call DEFAULT_INTERVAL compatibility', () => {
  expect(parseCronInterval('garbage')).toBe(600000);
});

test('startAgent: "0 1 * * *" arms a setTimeout at the next 01:00, not a fixed setInterval', () => {
  jest.setSystemTime(new Date(2026, 0, 15, 0, 59, 0, 0)); // 1 minute before 01:00
  const config = makeConfig({ schedule: '0 1 * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy).not.toHaveBeenCalled();
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
});

test('startAgent: malformed schedule fails closed without a timer or run-on-start', () => {
  const config = makeConfig({ schedule: 'garbage' });
  const onEvent = jest.fn();
  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_failed' }));
  errSpy.mockRestore();
});

test('startAgent: constrained day-of-week "0 8 * * 1" fails closed', () => {
  const config = makeConfig({ schedule: '0 8 * * 1' });
  const onEvent = jest.fn();
  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'agent_failed',
    details: expect.objectContaining({ error: expect.stringContaining('0 8 * * 1') }),
  }));
  errSpy.mockRestore();
});

test('startAgent: "*/5 * * * *" keeps the 5-minute setInterval fast path untouched', () => {
  const config = makeConfig({ schedule: '*/5 * * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  runner.startAgent(config.agents[0]);

  expect(setIntervalSpy.mock.calls[0][1]).toBe(300000);
  expect(setTimeoutSpy).not.toHaveBeenCalled();
});

test('startAgent: absolute schedule re-arms a fresh setTimeout after firing', async () => {
  jest.setSystemTime(new Date(2026, 0, 15, 0, 59, 0, 0)); // 1 minute before 01:00
  const config = makeConfig({ schedule: '0 1 * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');

  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  runner.startAgent(config.agents[0]);
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

  setTimeoutSpy.mockClear();
  global.fetch.mockClear();

  // Fire the 01:00 tick.
  await jest.advanceTimersByTimeAsync(60000);

  // The scheduled run actually fired...
  expect(global.fetch).toHaveBeenCalled();
  const spawnCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();

  // ...and the chain re-armed a NEW setTimeout for tomorrow's 01:00 (24h out),
  // proving stopRunningRecord's single clearInterval(record.interval) call
  // would still have something live to cancel — this is not a one-shot timer.
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 86400000);
});

test('startAgent: absolute schedule chain does not re-arm after stopRunningRecord (fleet stopAll)', async () => {
  jest.setSystemTime(new Date(2026, 0, 15, 0, 59, 0, 0));
  const config = makeConfig({ schedule: '0 1 * * *' });
  const runner = createFleetRunner(config, '/tmp/proj');
  runner.startAgent(config.agents[0]);

  runner.stopAll();

  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  await jest.advanceTimersByTimeAsync(60000);

  // stopAll() cleared the pending timeout before it could fire, so no
  // re-arm setTimeout call should ever land.
  expect(setTimeoutSpy).not.toHaveBeenCalled();
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

  test('does not warn for channels marked with an external producer', () => {
    const config = {
      name: 'test',
      agents: [
        { name: 'documentarian', trigger: 'promotion:release-surfaces', backend: 'ollama', prompt: 'x' },
      ],
      watchers: [],
      channels: {
        'promotion:release-surfaces': {
          description: 'Promotion script publishes this channel',
          externalProducer: 'scripts/promote-stable.sh',
        },
      },
    };

    const result = validateTopology(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('promotion:release-surfaces'))).toBe(false);
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
    ...makeConfig({ schedule: '*/5 * * * *', runOnStart: true }),
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

test('cooldown blocks a second run until the window expires', async () => {
  const config = {
    ...makeConfig({ schedule: undefined, trigger: undefined, cooldownMs: 60000 }),
    limits: { budgetUsdPerDay: 5 },
  };

  const onEvent = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });
  const first = await runner.hailAgent('test-agent', { source: 'manual' });
  const second = await runner.hailAgent('test-agent', { source: 'manual' });

  expect(first).toEqual({ success: true });
  expect(second.success).toBe(false);
  expect(second.error).toContain('cooldown active');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_failed',
      details: expect.objectContaining({
        error: expect.stringContaining('cooldown active'),
      }),
    })
  );
});

test('trigger dedupe suppresses identical messages inside the dedupe window', async () => {
  let triggerCallback;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const onEvent = jest.fn();
  const config = {
    ...makeConfig({ trigger: 'spark:idea', dedupeWindowMs: 300000 }),
    limits: { budgetUsdPerDay: 5 },
  };

  const runner = createFleetRunner(config, '/tmp/proj', {
    onEvent,
    messaging: {
      subscribe: jest.fn((_channel, callback) => {
        triggerCallback = callback;
        return jest.fn();
      }),
    },
  });

  runner.startAgent(config.agents[0]);

  await triggerCallback({ payload: 'same idea', sender: 'fleet-ui' });
  await Promise.resolve();
  await Promise.resolve();
  await triggerCallback({ payload: 'same idea', sender: 'fleet-ui' });

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_failed',
      details: expect.objectContaining({
        error: expect.stringContaining('duplicate trigger suppressed'),
      }),
    })
  );
});

test('duplicate trigger spawn requests carry the same idempotency key', async () => {
  let triggerCallback;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });

  const config = {
    ...makeConfig({ trigger: 'spark:idea' }),
    limits: { budgetUsdPerDay: 5 },
  };

  const runner = createFleetRunner(config, '/tmp/proj', {
    messaging: {
      subscribe: jest.fn((_channel, callback) => {
        triggerCallback = callback;
        return jest.fn();
      }),
    },
  });

  runner.startAgent(config.agents[0]);
  await triggerCallback({ payload: 'same idea', sender: 'fleet-ui' });
  await Promise.resolve();
  await Promise.resolve();
  await triggerCallback({ payload: 'same idea', sender: 'fleet-ui' });
  await Promise.resolve();

  const spawnCalls = global.fetch.mock.calls.filter(([url]) => url === `${DAEMON_URL}/spawn`);
  expect(spawnCalls).toHaveLength(2);
  const keys = spawnCalls.map(([, opts]) => JSON.parse(opts.body).idempotencyKey);
  expect(keys[0]).toMatch(/^[a-f0-9]{32}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(spawnCalls[0][1].headers['Idempotency-Key']).toBe(keys[0]);
  expect(spawnCalls[1][1].headers['Idempotency-Key']).toBe(keys[1]);
});

test('rapid trigger bursts collapse into one pending mailbox run while active', async () => {
  let triggerCallback;
  let resolveFirstSpawn;
  let spawnCount = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    spawnCount += 1;
    if (spawnCount === 1) {
      return new Promise((resolve) => {
        resolveFirstSpawn = resolve;
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ agentId: `spawn-${spawnCount}`, status: 'spawned' }),
    });
  });

  const config = {
    ...makeConfig({ trigger: 'spark:idea' }),
    limits: { budgetUsdPerDay: 5 },
  };

  const runner = createFleetRunner(config, '/tmp/proj', {
    messaging: {
      subscribe: jest.fn((_channel, callback) => {
        triggerCallback = callback;
        return jest.fn();
      }),
    },
  });

  runner.startAgent(config.agents[0]);

  await triggerCallback({ payload: 'first', sender: 'fleet-ui' });
  await Promise.resolve();
  expect(runner.getStatus()).toEqual([
    expect.objectContaining({ name: 'test-agent', status: 'running', queueDepth: 0 }),
  ]);

  await triggerCallback({ payload: 'second', sender: 'fleet-ui' });
  await triggerCallback({ payload: 'third', sender: 'fleet-ui' });
  expect(runner.getStatus()).toEqual([
    expect.objectContaining({ name: 'test-agent', status: 'running', queueDepth: 1 }),
  ]);

  resolveFirstSpawn({ ok: true, json: async () => ({ agentId: 'spawn-1', status: 'spawned' }) });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(spawnCount).toBe(2);
});

test('backoff suppresses retries after repeated failures and resets after success', async () => {
  const config = {
    ...makeConfig({
      schedule: undefined,
      trigger: undefined,
      backoffBaseMs: 1000,
      backoffMaxMs: 4000,
      backoffMultiplier: 2,
    }),
    limits: { budgetUsdPerDay: 5 },
  };

  const onEvent = jest.fn();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ status: 'failed', error: 'boom' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ agentId: 'ok', status: 'spawned' }) });

  const runner = createFleetRunner(config, '/tmp/proj', { onEvent });
  const first = await runner.hailAgent('test-agent', { source: 'manual' });
  const second = await runner.hailAgent('test-agent', { source: 'manual' });

  expect(first.success).toBe(false);
  expect(second.success).toBe(false);
  expect(second.error).toContain('backoff active');
  expect(global.fetch).toHaveBeenCalledTimes(1);

  jest.setSystemTime(Date.now() + 1001);
  const third = await runner.hailAgent('test-agent', { source: 'manual' });

  expect(third.success).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'agent_completed',
      details: expect.objectContaining({
        backend: 'claude-cli',
      }),
    })
  );
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
  // Use hailAgent to trigger runAgentOnce without relying on startup work.
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
  // Use hailAgent to trigger runAgentOnce without relying on startup work.
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

// ─── Skill Graft wiring (opt-in per-ship context injection, lib/skill-graft.ts) ──

test('skillGraft: true splices the injected skill-graft context into the task', async () => {
  const craft = jest.fn().mockResolvedValue({
    query: 'Do something',
    scannedCount: 42,
    roots: [],
    shortlist: [
      { id: 'rag-retrieval-pattern-design', description: 'RAG chunking and hybrid search', category: 'AI', tags: [], similarity: 0.9 },
    ],
    top: [],
  });
  const config = makeConfig({ skillGraft: true });
  const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft } });

  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(craft).toHaveBeenCalledWith('Do something');
  const spawnCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();
  const body = JSON.parse(spawnCall[1].body);
  expect(body.task).toContain('Do something');
  expect(body.task).toContain('rag-retrieval-pattern-design');
  expect(body.task).toContain('42 scanned');
});

test('agents without skillGraft never call the injected index (fast path unaffected)', async () => {
  const craft = jest.fn();
  const config = makeConfig(); // skillGraft is undefined/falsy by default
  const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft } });

  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();

  expect(craft).not.toHaveBeenCalled();
  const spawnCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();
  const body = JSON.parse(spawnCall[1].body);
  expect(body.task).toBe('Do something');
});

test('skillGraft failure fails open: the spawn still proceeds with the unmodified task', async () => {
  const craft = jest.fn().mockRejectedValue(new Error('embedder unavailable'));
  const config = makeConfig({ skillGraft: true });
  const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft } });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await runner.hailAgent('test-agent', { source: 'manual' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const spawnCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();
  const body = JSON.parse(spawnCall[1].body);
  expect(body.task).toBe('Do something'); // unmodified — failed open, never blocked the spawn
  expect(errSpy).toHaveBeenCalledWith(
    expect.stringContaining('skill-graft failed for agent "test-agent"'),
    expect.stringContaining('embedder unavailable'),
  );
  errSpy.mockRestore();
});

test('skillGraft that stalls never blocks a spawn: the budget elapses and the ship spawns un-grafted', async () => {
  // craft() that never settles — stands in for the one-time cold cost on a
  // first spawn (a full skills/ scan, or a MiniLM model load/download when the
  // semantic tier is on). The awaited-before-spawn enrichment must be bounded
  // so it can never hold the spawn hostage (Copilot review finding).
  const craft = jest.fn().mockReturnValue(new Promise(() => {}));
  const config = makeConfig({ skillGraft: true });
  const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft }, skillGraftBudgetMs: 5 });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  // Fake timers are active (global beforeEach). Kick off the run WITHOUT
  // awaiting — it's parked on the never-settling craft() — then advance the
  // clock past the 5ms budget so the timer fires and the race falls open.
  const run = runner.hailAgent('test-agent', { source: 'manual' });
  await jest.advanceTimersByTimeAsync(10);
  await run;

  expect(craft).toHaveBeenCalledWith('Do something');
  const spawnCall = global.fetch.mock.calls.find(c => String(c[0]).includes('/spawn'));
  expect(spawnCall).toBeDefined();
  const body = JSON.parse(spawnCall[1].body);
  expect(body.task).toBe('Do something'); // un-grafted — budget elapsed, spawn never blocked
  expect(errSpy).toHaveBeenCalledWith(
    expect.stringContaining('skill-graft exceeded 5ms for agent "test-agent"'),
  );
  errSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// pd-fleet.yml dispatch-runner manifest — scheduler support can land without
// arming the current dispatch artifact path, which still opens draft PRs.
// Reads the REAL pd-fleet.yml (realReadFileSync bypasses this file's fs mock).
describe('pd-fleet.yml dispatch-runner manifest (gated nightly entry)', () => {
  const manifestRaw = realReadFileSync(
    realJoin(import.meta.dirname, '..', '..', 'pd-fleet.yml'),
    'utf8',
  );
  const manifest = realYamlParse(manifestRaw);
  const runtimeConfig = astToConfig(parseFleetSource(manifestRaw));
  const runner = manifest?.fleet?.agents?.['dispatch-runner'];
  const dispatchBlock = manifestRaw.match(
    /\n    dispatch-runner:[\s\S]*?(?=\n    # ─── The Purser)/,
  )?.[0] ?? '';

  test('the reviewed runner stays declaratively disabled while operator review is open', () => {
    expect(runner).toMatchObject({
      enabled: false,
      schedule: '0 1 * * *',
      backend: 'custom',
      singleton: true,
      cooldown_ms: 21_600_000,
      timeout: 14_400_000,
      daily_cap_usd: 10,
      prompt: 'pd dispatch run --next --really-run',
      identity: '{project}:fleet:dispatch-runner',
    });
    expect(manifestRaw).toMatch(/precondition 1 still open and\s+unverified in-repo/i);
    expect(manifestRaw).toMatch(/nothing here attests to that review having\s+happened/i);
  });

  test('its documented schedule satisfies the cron-parser precondition this PR closes', () => {
    // Precondition 3 in the file's own comment block: absolute hour-of-day
    // support. Executable check — the schedule must be recognized as an
    // absolute pattern (setTimeout chain), never coerced to DEFAULT_INTERVAL.
    const documentedSchedule = /schedule:\s+"([^"]+)"/.exec(dispatchBlock)?.[1];
    expect(documentedSchedule).toBe('0 1 * * *');
    expect(isAbsoluteCronSchedule(documentedSchedule)).toBe(true);
    expect(computeNextAbsoluteFireDelayMs(documentedSchedule)).not.toBeNull();
  });

  test('the real fleet-wide settled-spend threshold remains configured honestly', () => {
    expect(manifest.fleet.limits.budget_usd_per_day).toBe(8.5);
    expect(runner.daily_cap_usd).toBe(10);
    expect(dispatchBlock).toMatch(/review-contract metadata only; not a runtime budget authority/i);
    expect(manifestRaw).toMatch(/configured fleet-wide settled-spend\s+# threshold checked before each launch/i);
    expect(manifestRaw).toMatch(/not an atomic reservation;\s+# concurrent starts can oversubscribe it/i);
    expect(manifestRaw).not.toMatch(/\$8\.50(?:\/day)?\s+ceiling/i);
    expect(runtimeConfig.limits.budgetUsdPerDay).toBe(8.5);
    expect(runtimeConfig.agents.map(agent => agent.name)).not.toContain('dispatch-runner');
  });

  test('the remaining blast-radius values stay documented beside the gate', () => {
    expect(dispatchBlock).toMatch(/singleton:\s+true/);
    expect(dispatchBlock).toMatch(/timeout:\s+14400000/);
    expect(dispatchBlock).toMatch(/cooldown_ms:\s+21600000/);
  });
});
