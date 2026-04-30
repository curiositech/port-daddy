import { jest } from '@jest/globals';

const { createSpawner } = await import('../../lib/spawner.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Explicit telemetry bypass test coverage',
};

describe('spawner telemetry enforcement', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalCloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalCloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    }));
  });

  afterAll(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

    if (originalCloudflareAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccountId;

    if (originalCloudflareApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflareApiToken;
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

    const result = await spawner.spawn({
      backend: 'ollama',
      task: 'say hello',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Spawn blocked');
    expect(result.error).toContain('Ollama is blocked');
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
      workdir: '/tmp/port-daddy-telemetry-test',
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
      workdir: '/tmp/port-daddy-codex-telemetry-test',
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

  test('attaches exact telemetry to successful Cloudflare Workers AI launches under enforcement', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    process.env.CLOUDFLARE_API_TOKEN = 'token-123';
    global.fetch = jest.fn(async (url) => {
      if (typeof url === 'string' && url.includes('api.cloudflare.com/client/v4/accounts/acct-123/ai/run/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              response: 'Cloudflare done',
              usage: {
                prompt_tokens: 10000,
                completion_tokens: 2000,
                total_tokens: 12000,
              },
            },
          }),
          text: async () => 'Cloudflare done',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionId: 'test-session' }),
        text: async () => 'OK',
      };
    });
    const costTracker = {
      computeCost: jest.fn(() => ({ costUsd: 0.004474, isEstimate: false })),
      record: jest.fn((opts) => ({
        id: 'evt-cloudflare-1',
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
        costUsd: 0.0014,
        isEstimate: false,
      })),
    };
    const spawner = createSpawner({
      costTracker,
      enforceTelemetryPolicy: true,
    });

    const result = await spawner.spawn({
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      identity: 'port-daddy:fleet:cloudflare',
      task: 'Summarize Workers AI readiness',
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.output).toBe('Cloudflare done');
    expect(result.telemetry).toEqual({
      inputTokens: 10000,
      outputTokens: 2000,
      costUsd: 0.0014,
      rateMode: 'exact',
    });
    expect(costTracker.computeCost).toHaveBeenCalledWith(
      'cloudflare',
      '@cf/zai-org/glm-4.7-flash',
      10000,
      2000,
    );
    expect(costTracker.record).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      identity: 'port-daddy:fleet:cloudflare',
      inputTokens: 10000,
      outputTokens: 2000,
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
