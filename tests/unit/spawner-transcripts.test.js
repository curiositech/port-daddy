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

function exactCostTracker(costUsd) {
  return {
    computeCost: jest.fn(() => ({ costUsd, isEstimate: false })),
    record: jest.fn((opts) => ({
      id: 'evt-test',
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

describe('spawner ↔ transcripts integration', () => {
  let db;
  let transcripts;
  let originalFetch;
  let originalCloudflareAccountId;
  let originalCloudflareToken;

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
    originalCloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    originalCloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => 'OK',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalCloudflareAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccountId;
    if (originalCloudflareToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflareToken;
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

  it('binds the daemon-assigned identity into the child environment', async () => {
    let observedSpec;
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async (spec) => {
          observedSpec = spec;
          return {
            output: 'attention identity inherited',
            error: null,
            inputTokens: 10,
            outputTokens: 5,
          };
        },
      },
    });

    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      task: 'check attention',
      env: { PD_AGENT_ID: 'caller-spoof', KEEP_ME: 'yes' },
    });

    expect(observedSpec.env).toEqual(expect.objectContaining({
      PD_AGENT_ID: result.agentId,
      KEEP_ME: 'yes',
    }));
    expect(observedSpec.env.PD_AGENT_ID).not.toBe('caller-spoof');
  });

  it('acknowledges only after the durable transcript exists and can reconstruct after restart', async () => {
    const accepted = jest.fn((receipt) => {
      expect(receipt.status).toBe('running');
      expect(transcripts.listTranscripts({ agentId: receipt.agentId })).toHaveLength(1);
    });
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({ output: 'durable answer', error: null }),
      },
    });
    const result = await spawner.spawn({ backend: 'claude', task: 'persist me' }, accepted);
    expect(accepted).toHaveBeenCalledTimes(1);

    const restarted = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });
    expect(restarted.get(result.agentId)).toEqual(expect.objectContaining({
      agentId: result.agentId,
      status: 'completed',
      output: 'durable answer',
      telemetry: null,
    }));
  });

  it('finalizes an unowned running transcript as supervisor-lost on collection', () => {
    const transcriptId = transcripts.start({
      ship: 'spawn:claude',
      spawned_agent_id: 'spawned-orphan',
      trigger: 'manual',
      backend: 'claude',
      model: 'claude-haiku-4-5',
      started_at: 100,
    });
    transcripts.appendMessage(transcriptId, {
      role: 'user',
      content: 'work interrupted by daemon crash',
      timestamp: 100,
    });

    const restarted = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });
    const collected = restarted.get('spawned-orphan');
    expect(collected).toEqual(expect.objectContaining({
      status: 'failed',
      error: expect.stringMatching(/supervisor state was lost/i),
    }));
    expect(transcripts.getTranscript(transcriptId).status).toBe('failed');
  });

  it('passes a completed backend when exact telemetry stays under budget', async () => {
    const costTracker = exactCostTracker(0.0125);
    const spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
      runnerOverrides: {
        claude: async () => ({
          output: 'Done under budget.',
          error: null,
          inputTokens: 1000,
          outputTokens: 200,
        }),
      },
    });
    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      identity: 'port-daddy:test:under-budget',
      task: 'finish cheaply',
      ship: 'budget-under',
      budgetUsd: 0.02,
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.telemetry.costUsd).toBeCloseTo(0.0125);

    const rows = transcripts.listTranscripts({ ship: 'budget-under' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].cost_usd).toBeCloseTo(0.0125);
    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx.cost_usd).toBeCloseTo(0.0125);
    expect(tx.messages.map((m) => m.content)).toContain('Done under budget.');
  });

  it('marks a completed backend over budget and preserves transcript telemetry', async () => {
    const costTracker = exactCostTracker(0.154863);
    const spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
      runnerOverrides: {
        claude: async () => ({
          output: 'I finished the expensive work.',
          error: null,
          inputTokens: 10000,
          outputTokens: 5000,
        }),
      },
    });
    const result = await spawner.spawn({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      identity: 'port-daddy:test:over-budget',
      task: 'finish expensively',
      ship: 'budget-over',
      budgetUsd: 0.05,
    });

    expect(result.status).toBe('over_budget');
    expect(result.error).toMatch(/exceeded hard budget cap/);
    expect(result.telemetry.costUsd).toBeCloseTo(0.154863);

    const rows = transcripts.listTranscripts({ ship: 'budget-over' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('over_budget');
    expect(rows[0].cost_usd).toBeCloseTo(0.154863);
    expect(rows[0].error).toMatch(/exceeded hard budget cap/);
    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx.cost_usd).toBeCloseTo(0.154863);
    expect(tx.messages.map((m) => m.content)).toEqual(expect.arrayContaining([
      'I finished the expensive work.',
      expect.stringMatching(/\[error\] exceeded hard budget cap/),
    ]));
    expect(tx.outputs[0].type).toBe('noop');
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

  it('does not throw when transcripts is absent AND policy is not enforced (opt-out path)', async () => {
    const spawner = createSpawner({
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: false,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({ output: 'hi', error: null }),
      },
    });
    const result = await spawner.spawn({ backend: 'claude', task: 'hi' });
    expect(result.status).toBe('completed');
  });

  // ── Fail-loud policy ─────────────────────────────────────────────────────

  it('refuses to construct a spawner with no transcripts module when enforced', () => {
    expect(() => createSpawner({
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    })).toThrow(/TRANSCRIPT RECORDING REQUIRED/);
  });

  it('fails the spawn (and does not run the backend) when the transcript cannot be opened', async () => {
    let backendRan = false;
    const accepted = jest.fn();
    const brokenTranscripts = {
      ...transcripts,
      start() { throw new Error('db is on fire'); },
    };
    const spawner = createSpawner({
      transcripts: brokenTranscripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => { backendRan = true; return { output: 'hi', error: null }; },
      },
    });
    const result = await spawner.spawn({ backend: 'claude', task: 'hi' }, accepted);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/recording failed|must not run unless its conversation is recorded/i);
    expect(backendRan).toBe(false);
    expect(accepted).not.toHaveBeenCalled();
  });

  it('marks the spawn failed when finalize throws (recording failure cannot report success)', async () => {
    // The backend runs and turns record fine, but the final status-stamp write
    // fails. Under enforcement that must surface as a failed spawn, not a
    // silent `completed`.
    const brokenFinalize = {
      ...transcripts,
      finalize() { throw new Error('disk full at finalize'); },
    };
    const spawner = createSpawner({
      transcripts: brokenFinalize,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        claude: async () => ({ output: 'hi', error: null }),
      },
    });
    const result = await spawner.spawn({ backend: 'claude', task: 'hi' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/recording failed|disk full/i);
  });

  it('records codex-style structured turns (thinking + tool + assistant) as distinct messages', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
      runnerOverrides: {
        codex: async () => ({
          output: 'It printed hello.',
          error: null,
          inputTokens: 10,
          outputTokens: 5,
          transcript: [
            { role: 'thinking', content: 'I should run echo.' },
            { role: 'tool', content: '$ echo hello', toolCalls: [{ name: 'shell', args: { command: 'echo hello' }, result: { output: 'hello\n', exit_code: 0 } }] },
            { role: 'assistant', content: 'It printed hello.' },
          ],
        }),
      },
    });
    await spawner.spawn({ backend: 'codex', task: 'run echo', model: 'gpt-5.4-mini' });
    const rows = transcripts.listTranscripts({ ship: 'spawn:codex' });
    expect(rows).toHaveLength(1);
    const full = transcripts.getTranscript(rows[0].id);
    const roles = full.messages.map((m) => m.role);
    // user (from txStart) + thinking + tool + assistant
    expect(roles).toEqual(['user', 'thinking', 'tool', 'assistant']);
    const toolMsg = full.messages.find((m) => m.role === 'tool');
    expect(toolMsg.tool_calls[0].name).toBe('shell');
    expect(toolMsg.tool_calls[0].result.exit_code).toBe(0);
  });

  it('records a successful Cloudflare response as durable user, assistant, and output rows', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    let cloudflareInit;
    global.fetch = jest.fn(async (url, init = {}) => {
      if (String(url).includes('/ai/run/@cf/zai-org/glm-4.7-flash')) {
        cloudflareInit = init;
        return new Response(JSON.stringify({
          result: {
            choices: [{
              message: {
                role: 'assistant',
                content: 'Cloudflare transcript proof complete.',
              },
            }],
            usage: { prompt_tokens: 8, completion_tokens: 5 },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });
    const result = await spawner.spawn({
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      task: 'prove transcript readback',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Cloudflare transcript proof complete.');
    expect(cloudflareInit.signal).toBeInstanceOf(AbortSignal);

    const rows = transcripts.listTranscripts({ ship: 'spawn:cloudflare' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].error).toBeNull();
    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'prove transcript readback'],
      ['assistant', 'Cloudflare transcript proof complete.'],
    ]);
    expect(tx.outputs).toEqual([
      { type: 'message', summary: 'cloudflare: 1 turns, 37 chars' },
    ]);
  });

  async function expectCloudflareDefaultTimeoutFallback(spawnOverrides, responseText) {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    let cloudflareInit;
    global.fetch = jest.fn((url, init = {}) => {
      if (String(url).includes('/ai/run/@cf/zai-org/glm-4.7-flash')) {
        cloudflareInit = init;
        return new Promise((resolve, reject) => {
          if (!init.signal) {
            reject(new Error('Cloudflare request did not receive an AbortSignal'));
            return;
          }
          if (init.signal.aborted) {
            reject(init.signal.reason ?? new DOMException('Cloudflare request aborted', 'AbortError'));
            return;
          }
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason ?? new DOMException('Cloudflare request aborted', 'AbortError'));
          }, { once: true });
          setTimeout(() => {
            resolve(new Response(JSON.stringify({
              result: {
                response: responseText,
                usage: { prompt_tokens: 4, completion_tokens: 3 },
              },
            }), { status: 200 }));
          }, 20);
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });
    const result = await spawner.spawn({
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      task: responseText,
      ...spawnOverrides,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe(responseText);
    expect(cloudflareInit.signal).toBeInstanceOf(AbortSignal);
    expect(cloudflareInit.signal.aborted).toBe(false);
    const rows = transcripts.listTranscripts({ ship: 'spawn:cloudflare' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
  }

  it('treats missing Cloudflare timeout as the default instead of omitting abort handling', async () => {
    await expectCloudflareDefaultTimeoutFallback(
      {},
      'Cloudflare missing timeout used the default.',
    );
  });

  it('treats zero Cloudflare timeout as the default instead of an immediate abort', async () => {
    await expectCloudflareDefaultTimeoutFallback(
      { timeout: 0 },
      'Cloudflare zero timeout used the default.',
    );
  });

  it('treats negative Cloudflare timeout as the default instead of an immediate abort', async () => {
    await expectCloudflareDefaultTimeoutFallback(
      { timeout: -1000 },
      'Cloudflare negative timeout used the default.',
    );
  });

  it('finalizes a timed-out Cloudflare request as failed with an error transcript', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    global.fetch = jest.fn((url, init = {}) => {
      if (String(url).includes('/ai/run/@cf/zai-org/glm-4.7-flash')) {
        return new Promise((resolve, reject) => {
          if (init.signal.aborted) {
            reject(init.signal.reason ?? new DOMException('Cloudflare request aborted', 'AbortError'));
            return;
          }
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason ?? new DOMException('Cloudflare request aborted', 'AbortError'));
          }, { once: true });
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });
    const result = await spawner.spawn({
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      task: 'this provider call should time out',
      timeout: 5,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/TimeoutError|timeout/i);
    const rows = transcripts.listTranscripts({ ship: 'spawn:cloudflare' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toMatch(/TimeoutError|timeout/i);

    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx.messages[0]).toEqual(expect.objectContaining({
      role: 'user',
      content: 'this provider call should time out',
    }));
    expect(tx.messages.at(-1)).toEqual(expect.objectContaining({
      role: 'assistant',
      content: expect.stringMatching(/\[error\].*(TimeoutError|timeout)/i),
    }));
    expect(tx.outputs).toEqual([
      { type: 'noop', summary: expect.stringMatching(/^failed: .*?(TimeoutError|timeout)/i) },
    ]);
  });
});
