import { jest } from '@jest/globals';

const { createSpawner: createSpawnerBase } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Explicit telemetry bypass test coverage',
};

// This suite exercises the TELEMETRY policy, not the transcript policy. Default
// transcript enforcement off so construction doesn't require a transcripts
// module (a test can still opt in via deps.enforceTranscriptPolicy). Telemetry
// enforcement is left at its real default so these assertions are unaffected.
function createSpawner(deps = {}) {
  return createSpawnerBase({ enforceTranscriptPolicy: false, ...deps });
}

describe('spawner telemetry enforcement', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalSpawnIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    // The worktree isolation guard (assessSpawnIsolation) is evaluated BEFORE
    // the telemetry policy inside spawn(). These tests assert the telemetry
    // fail-closed error ("cost tracker unavailable..."), but they pass no
    // workdir, so in a main checkout (CI) the isolation guard fires first and
    // returns "Spawn blocked: ...main checkout" instead — masking the policy
    // assertion. The guard has dedicated coverage in
    // spawner-isolation-guard.test.js, so opt out of it here.
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    }));
  });

  afterAll(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalSpawnIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalSpawnIsolationOff;
  });

  test('defaults telemetry enforcement on when no override is provided', async () => {
    const spawner = createSpawner();

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'say hello',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('cost tracker unavailable under fail-closed telemetry policy');
    expect(result.telemetry).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects telemetry opt-out without explicit HITL confirmation', () => {
    expect(() => createSpawner({
      enforceTelemetryPolicy: false,
    })).toThrow(/TELEMETRY BYPASS REJECTED[\s\S]*HITL confirmation is required/);
  });

  test('allows telemetry opt-out only when HITL confirmation is attached and logs a loud warning', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => createSpawner({
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    })).not.toThrow();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('TELEMETRY BYPASS ACTIVE'));
    consoleError.mockRestore();
  });

  test('blocks opaque backends before they launch when telemetry enforcement is enabled', async () => {
    const costTracker = {
      computeCost: jest.fn(),
      record: jest.fn(),
    };
    const spawner = createSpawner({
      costTracker,
      enforceTelemetryPolicy: true,
    });

    // Use a model whose name doesn't match any Ollama family key, so the
    // backend-scoped policy still blocks (no exact rate available). The
    // default 'llama3.1:8b' would unblock since 'llama' matches in
    // OLLAMA_MODEL_RATES — that's working as intended, so we exercise the
    // blocked path with an unrecognized model.
    const result = await spawner.spawn({
      backend: 'ollama',
      model: 'unobtanium-7b',
      task: 'say hello',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Spawn blocked');
    expect(result.error).toContain('no exact cost rate entry');
    expect(result.telemetry).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(costTracker.record).not.toHaveBeenCalled();
  });

  test('attaches exact telemetry to successful Claude launches under enforcement', async () => {
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0.00216, isEstimate: false })),
      record: jest.fn((opts) => ({
        id: 'evt-1',
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
        costUsd: 0.00216,
        isEstimate: false,
      })),
    };
    const spawner = createSpawner({
      costTracker,
      enforceTelemetryPolicy: true,
      runnerOverrides: {
        claude: jest.fn(async () => ({
          output: 'done',
          error: null,
          inputTokens: 1200,
          outputTokens: 300,
        })),
      },
    });

    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5-20251001',
      identity: 'port-daddy:qa:telemetry',
      task: 'Summarize the diff',
      workdir: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.telemetry).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.00216,
      rateMode: 'exact',
    });
    expect(costTracker.computeCost).toHaveBeenCalledWith(
      'claude',
      'claude-haiku-4-5-20251001',
      1200,
      300,
    );
    expect(costTracker.record).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'claude',
      model: 'claude-haiku-4-5-20251001',
      identity: 'port-daddy:qa:telemetry',
      inputTokens: 1200,
      outputTokens: 300,
    }));
  });

  test('attaches cached-input telemetry to successful Codex launches under enforcement', async () => {
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0.0138, isEstimate: false })),
      record: jest.fn((opts) => ({
        id: 'evt-codex-1',
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
    const spawner = createSpawner({
      costTracker,
      enforceTelemetryPolicy: true,
      runnerOverrides: {
        codex: jest.fn(async () => ({
          output: 'done',
          error: null,
          inputTokens: 10000,
          cachedInputTokens: 4000,
          outputTokens: 2000,
        })),
      },
    });

    const result = await spawner.spawn({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      identity: 'port-daddy:fleet:cartographer',
      task: 'Summarize salvage state',
      workdir: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
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
      identity: 'port-daddy:fleet:cartographer',
      inputTokens: 10000,
      cachedInputTokens: 4000,
      outputTokens: 2000,
    }));
  });

  test('allows flat-rate cli:agy estimated telemetry when a nonzero cost record persists', async () => {
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0.001, isEstimate: true })),
      record: jest.fn((opts) => ({
        id: 'evt-agy-1',
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
        costUsd: 0.001,
        isEstimate: true,
      })),
    };
    const spawner = createSpawner({
      costTracker,
      enforceTelemetryPolicy: true,
      runnerOverrides: {
        'cli:agy': jest.fn(async () => ({
          output: 'done',
          error: null,
          inputTokens: 12,
          outputTokens: 3,
          estimatedTelemetry: true,
        })),
      },
    });

    const result = await spawner.spawn({
      backend: 'cli:agy',
      identity: 'port-daddy:fleet:agy',
      task: 'Summarize agy output',
      workdir: process.cwd(),
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.telemetry).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      costUsd: 0.001,
      rateMode: 'estimated',
    });
    expect(costTracker.computeCost).toHaveBeenCalledWith(
      'cli:agy',
      'agy-cli',
      12,
      3,
    );
    expect(costTracker.record).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cli:agy',
      model: 'agy-cli',
      identity: 'port-daddy:fleet:agy',
      inputTokens: 12,
      outputTokens: 3,
    }));
  });

  test('fails Claude launches that return text without usage telemetry', async () => {
    const costTracker = {
      computeCost: jest.fn(),
      record: jest.fn(),
    };
    const spawner = createSpawner({
      costTracker,
      enforceTelemetryPolicy: true,
      runnerOverrides: {
        claude: jest.fn(async () => ({
          output: 'done',
          error: null,
        })),
      },
    });

    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5-20251001',
      identity: 'port-daddy:qa:telemetry',
      task: 'Summarize the diff',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('did not return token counts');
    expect(result.telemetry).toBeNull();
    expect(costTracker.computeCost).not.toHaveBeenCalled();
    expect(costTracker.record).not.toHaveBeenCalled();
  });
});
