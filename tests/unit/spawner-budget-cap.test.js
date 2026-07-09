import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

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

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { createTestDb } = await import('../setup-unit.js');

function exactCostTracker(costUsd) {
  return {
    computeCost: jest.fn(() => ({ costUsd, isEstimate: false })),
    record: jest.fn((opts) => ({
      id: 'evt-budget-cap',
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
      costUsd,
      isEstimate: false,
    })),
  };
}

describe('spawner hard budget cap edges', () => {
  let db;
  let transcripts;
  let originalFetch;
  const originalSpawnIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;

  beforeAll(() => { process.env.PD_SPAWN_ISOLATION_OFF = '1'; });

  afterAll(() => {
    if (originalSpawnIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalSpawnIsolationOff;
  });

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => 'OK',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (db) db.close();
  });

  test('exact cost equal to budgetUsd remains completed and readable', async () => {
    const spawner = createSpawner({
      transcripts,
      costTracker: exactCostTracker(0.05),
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
      runnerOverrides: {
        claude: async () => ({
          output: 'I used exactly the budget.',
          error: null,
          inputTokens: 1000,
          outputTokens: 250,
        }),
      },
    });

    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      identity: 'port-daddy:test:exact-budget',
      task: 'match the cap',
      ship: 'budget-exact',
      budgetUsd: 0.05,
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.telemetry.costUsd).toBeCloseTo(0.05);

    const [row] = transcripts.listTranscripts({ ship: 'budget-exact' });
    expect(row.status).toBe('completed');
    expect(row.cost_usd).toBeCloseTo(0.05);
    expect(transcripts.getTranscript(row.id).messages.map((m) => m.content)).toContain('I used exactly the budget.');
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -0.01],
    ['non-number', '0.01'],
  ])('non-positive or non-number budgetUsd (%s) does not create a hard cap', async (_label, budgetUsd) => {
    const ship = `budget-invalid-${_label}`;
    const spawner = createSpawner({
      transcripts,
      costTracker: exactCostTracker(0.02),
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
      runnerOverrides: {
        claude: async () => ({
          output: 'No valid hard cap was supplied.',
          error: null,
          inputTokens: 800,
          outputTokens: 120,
        }),
      },
    });

    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      identity: `port-daddy:test:${ship}`,
      task: 'ignore invalid cap',
      ship,
      budgetUsd,
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.telemetry.costUsd).toBeCloseTo(0.02);

    const [row] = transcripts.listTranscripts({ ship });
    expect(row.status).toBe('completed');
    expect(row.cost_usd).toBeCloseTo(0.02);
  });
});
