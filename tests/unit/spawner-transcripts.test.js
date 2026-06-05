/**
 * Integration test: spawner ↔ transcripts wiring.
 *
 * Verifies the spawner records a transcript with system prompt, user task,
 * assistant reply, outputs, and finalized cost/tokens whenever a
 * `transcripts` dep is provided.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';

// Mock child_process so spawner's custom/aider backends don't actually fork.
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

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Spawner+transcripts integration test — exercises legacy non-metered path',
};

describe('spawner ↔ transcripts integration', () => {
  let db;
  let transcripts;
  let originalFetch;

  // assessSpawnIsolation (lib/spawner.ts) blocks spawns into a repository main
  // checkout. These tests pass no workdir, so the guard reads process.cwd() —
  // a worktree locally but the primary checkout in CI — and would fail every
  // spawn before transcripts are written. This suite exercises the
  // spawn↔transcripts integration, not the guard (see
  // spawner-isolation-guard.test.js), so opt out of layer-2 isolation.
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

  it('records a full transcript for a successful spawn', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({
          output: 'Done — LGTM.',
          error: null,
          inputTokens: 100,
          outputTokens: 50,
        }),
      },
    });
    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      task: 'Review PR #42',
      ship: 'code-reviewer',
      trigger: 'pull_request:opened',
      prNumber: 42,
      systemPrompt: 'You are a code reviewer.',
    });

    expect(result.status).toBe('completed');

    const rows = transcripts.listTranscripts({ ship: 'code-reviewer' });
    expect(rows).toHaveLength(1);
    expect(rows[0].pr_number).toBe(42);
    expect(rows[0].trigger).toBe('pull_request:opened');
    expect(rows[0].status).toBe('completed');

    const tx = transcripts.getTranscript(rows[0].id);
    const roles = tx.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant']);
    expect(tx.messages[0].content).toBe('You are a code reviewer.');
    expect(tx.messages[1].content).toBe('Review PR #42');
    expect(tx.messages[2].content).toBe('Done — LGTM.');
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0].type).toBe('message');
  });

  it('records error as assistant message and marks status=failed', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({ output: '', error: 'backend unreachable' }),
      },
    });
    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      task: 'do thing',
      ship: 'qa',
      trigger: 'manual',
    });
    expect(result.status).toBe('failed');
    const rows = transcripts.listTranscripts({ ship: 'qa' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    const tx = transcripts.getTranscript(rows[0].id);
    const lastMsg = tx.messages[tx.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toMatch(/\[error\] backend unreachable/);
    expect(tx.outputs[0].type).toBe('noop');
  });

  it('uses ship="spawn:<backend>" as default when no ship provided', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({ output: 'hi', error: null }),
      },
    });
    await spawner.spawn({ backend: 'claude', task: 'hi' });
    const rows = transcripts.listTranscripts({ ship: 'spawn:claude' });
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger).toBe('manual');
  });

  it('does not throw when transcripts is absent (back-compat)', async () => {
    const spawner = createSpawner({
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({ output: 'hi', error: null }),
      },
    });
    const result = await spawner.spawn({ backend: 'claude', task: 'hi' });
    expect(result.status).toBe('completed');
  });
});
