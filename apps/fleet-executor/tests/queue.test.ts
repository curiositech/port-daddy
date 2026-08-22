import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import handler from '../src/index.js';
import {
  freshState,
  installGitHubFetch,
  memoryD1,
  memoryKV,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';
import type { FleetRunJob } from '../src/env.js';
import {
  DELIVERY_CONTINUATION_KIND,
  countDeliveryContinuations,
  recordDeliveryContinuation,
  runIdForDelivery,
} from '../src/delivery-failure.js';

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

function fakeMessage(body: FleetRunJob, attempts = 1) {
  return { id: 'm1', timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}

function fakeBatch(messages: ReturnType<typeof fakeMessage>[]) {
  return { queue: 'fleet-runs', messages } as unknown as MessageBatch<FleetRunJob>;
}

interface CapturingCtx extends ExecutionContext {
  waited: Promise<unknown>[];
}

function capturingCtx(): CapturingCtx {
  const waited: Promise<unknown>[] = [];
  return {
    waited,
    waitUntil(promise: Promise<unknown>) {
      waited.push(promise);
    },
    passThroughOnException() {},
  } as unknown as CapturingCtx;
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('queue consumer', () => {
  it('slices a multi-ship run into visible cumulative continuations, then acks the verdict', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      fallbacks:',
        '        - backend: cloudflare',
        `          model: '@cf/qwen/qwen3-30b-a3b-fp8'`,
        '      blocking: true',
        '      prompt: review',
        '    qa:',
        '      trigger: pull_request:opened',
        '      fallbacks:',
        '        - backend: cloudflare',
        `          model: '@cf/qwen/qwen3-30b-a3b-fp8'`,
        '      prompt: test',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'FLEET-VERDICT: PASS',
        qa: 'FLEET-VERDICT: PASS',
      },
    }).ai;
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: db.db });

    const first = fakeMessage(makeJob(), 1);
    await handler.queue!(fakeBatch([first]), env, capturingCtx());

    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 1 });
    expect(first.ack).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
    expect(db.steps.filter(step => step.kind === DELIVERY_CONTINUATION_KIND)).toHaveLength(1);
    expect(await countDeliveryContinuations(env, runIdForDelivery('delivery-abc'))).toBe(1);

    const deliveries = [first];
    for (let attempt = 2; attempt <= 13 && deliveries.at(-1)?.ack.mock.calls.length === 0; attempt += 1) {
      const next = fakeMessage(makeJob(), attempt);
      await handler.queue!(fakeBatch([next]), env, capturingCtx());
      deliveries.push(next);
    }

    const final = deliveries.at(-1)!;
    expect(final.retry).not.toHaveBeenCalled();
    expect(final.ack).toHaveBeenCalledTimes(1);
    for (const slice of deliveries.slice(0, -1)) {
      expect(slice.retry).toHaveBeenCalledWith({ delaySeconds: 1 });
      expect(slice.ack).not.toHaveBeenCalled();
    }
    expect(await countDeliveryContinuations(env, runIdForDelivery('delivery-abc')))
      .toBe(deliveries.length - 1);
    expect(state.completed.at(-1)?.conclusion).toBe('success');
  });

  it('does not charge intentional slices against the provider retry circuit', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    qa:',
        '      trigger: pull_request:opened',
        '      fallbacks:',
        '        - backend: cloudflare',
        `          model: '@cf/qwen/qwen3-30b-a3b-fp8'`,
        '      prompt: test',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({
      FLEET_TOKENS: kv,
      DB: db.db,
      AI: {
        run: vi.fn(async () => {
          throw Object.assign(new Error('no capacity'), { status: 429, code: 3040 });
        }),
      } as unknown as Ai,
    });
    await recordDeliveryContinuation(env, makeJob(), 1, 'prior-a', ['qa']);
    await recordDeliveryContinuation(env, makeJob(), 2, 'prior-b', ['qa']);

    const thirdQueueDelivery = fakeMessage(makeJob(), 3);
    await handler.queue!(fakeBatch([thirdQueueDelivery]), env, capturingCtx());

    // Raw queue attempt 3 minus two successful continuations = provider
    // attempt 1, so the dependency gets its first bounded retry rather than an
    // immediate fleet-wide adjudication.
    expect(thirdQueueDelivery.retry).toHaveBeenCalledTimes(1);
    expect(thirdQueueDelivery.ack).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
  });

  it('acks a message on successful run', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      ctx,
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(ctx.waited).toHaveLength(1);
    await Promise.all(ctx.waited);
  });

  it('closes a stale-head admission receipt instead of leaving it running forever', async () => {
    state.prHeadSha = 'NEWESTSHA';
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const intent = { state: 'queued', error: null as string | null };
    const db = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) { bound = values; return stmt; },
          async first<T>() {
            if (sql.includes('SELECT state FROM fleet_run_intents')) {
              return { state: intent.state } as T;
            }
            return null;
          },
          async all<T>() { return { results: [] as T[] }; },
          async run() {
            if (sql.includes("SET state = 'running'")) intent.state = 'running';
            if (sql.includes('UPDATE fleet_run_intents') && sql.includes('SET state = ?')) {
              intent.state = String(bound[0]);
              intent.error = bound[3] == null ? null : String(bound[3]);
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
        return stmt;
      },
      batch: async () => [],
    } as unknown as D1Database;
    const msg = fakeMessage(makeJob({ action: 'synchronize' }));

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, DB: db }),
      capturingCtx(),
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(intent.state).toBe('cancelled');
    expect(intent.error).toContain('no longer current');
  });

  it('closes an execution-only fleet as cancelled instead of looking for a missing run', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      `fleet:\n  name: execution-only\n  agents:\n    test-author:\n      trigger: pull_request:opened\n      allowedTools: "Read,Write,Bash(npm test*)"\n      fallbacks:\n        - backend: cloudflare\n          model: '@cf/qwen/qwen3-30b-a3b-fp8'\n      prompt: |\n        test-author ship: execute repository tests.\n`,
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const intent = { state: 'queued', error: null as string | null };
    const db = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) { bound = values; return stmt; },
          async first<T>() {
            if (sql.includes('SELECT state FROM fleet_run_intents')) {
              return { state: intent.state } as T;
            }
            if (sql.includes('SELECT conclusion FROM fleet_runs')) return null;
            return null;
          },
          async all<T>() { return { results: [] as T[] }; },
          async run() {
            if (sql.includes("SET state = 'running'")) intent.state = 'running';
            if (sql.includes('UPDATE fleet_run_intents') && sql.includes('SET state = ?')) {
              intent.state = String(bound[0]);
              intent.error = bound[3] == null ? null : String(bound[3]);
            }
            return { success: true, meta: { changes: 1 } };
          },
        };
        return stmt;
      },
      batch: async () => [],
    } as unknown as D1Database;
    const msg = fakeMessage(makeJob());

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, DB: db }),
      capturingCtx(),
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(intent.state).toBe('cancelled');
    expect(intent.error).toContain('no Cloud-executable review ships');
  });

  it('retries a message when the orchestrator throws (recoverable infra error)', async () => {
    // Force a token mint to fail repeatedly: no seeded KV + token mint 401s,
    // so getInstallationTokenCached throws and executeFleet re-throws.
    const kv = memoryKV();
    state.failTokenMintTimes = 5;
    // Provide a real-ish env; AI never reached.
    const env = makeEnv({
      FLEET_TOKENS: kv,
      GITHUB_APP_PRIVATE_KEY: pkcs8(),
    });

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    await handler.queue!(fakeBatch([msg]), env, ctx);

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(ctx.waited).toHaveLength(0);
  });

  it('retries instead of acking when the required check cannot be completed', async () => {
    vi.useFakeTimers();
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/check-runs\/\d+$/.test(url) && (init?.method ?? 'GET') === 'PATCH') {
          return new Response('completion unavailable', { status: 503 });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    const handling = handler.queue!(fakeBatch([msg]), makeEnv({ FLEET_TOKENS: kv, AI: ai }), ctx);
    await vi.runAllTimersAsync();
    await handling;

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.retry).toHaveBeenCalledWith();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
    expect(ctx.waited).toHaveLength(0);
  });

  it('carries a long provider Retry-After into the Cloudflare redelivery delay', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/check-runs\/\d+$/.test(url) && (init?.method ?? 'GET') === 'PATCH') {
          return new Response('secondary limit', {
            status: 429,
            headers: { 'retry-after': '120', 'x-github-request-id': 'request-rate-limit' },
          });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    const msg = fakeMessage(makeJob());
    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      capturingCtx(),
    );

    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('opens the Workers AI circuit and retries the delivery with bounded jitter', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    qa:',
        '      trigger: pull_request:opened',
        '      fallbacks:',
        "        - backend: cloudflare",
        "          model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
        '      prompt: review this diff',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = {
      run: vi.fn(async () => {
        throw Object.assign(new Error('no capacity'), { status: 429, code: 3040 });
      }),
    } as unknown as Ai;
    const msg = fakeMessage(makeJob(), 1);

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      capturingCtx(),
    );

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledTimes(1);
    const delay = (msg.retry.mock.calls[0]?.[0] as { delaySeconds?: number })?.delaySeconds;
    expect(delay).toBeGreaterThanOrEqual(1);
    expect(delay).toBeLessThanOrEqual(15);
    // One model call, then the circuit owns the retry. No local retry fan-out.
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(state.completed).toHaveLength(0);
  });

  it('stops after three provider attempts and completes neutral as a fleet fault', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    qa:',
        '      trigger: pull_request:opened',
        '      fallbacks:',
        "        - backend: cloudflare",
        "          model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
        '      prompt: review this diff',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = {
      run: vi.fn(async () => {
        throw Object.assign(new Error('no capacity'), { status: 429, code: 3040 });
      }),
    } as unknown as Ai;
    const msg = fakeMessage(makeJob(), 3);

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      capturingCtx(),
    );

    expect(msg.retry).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(state.completed[0]?.conclusion).toBe('neutral');
    expect(state.completed[0]?.summary).toContain('HTTP 429, code 3040');
    expect(state.completed[0]?.summary).toContain('adjudicated FLEET-WIDE fault');
    expect(state.completed[0]?.summary).toContain('not gating this PR');
  });
});

// Real PKCS8 key so the (failing) mint path actually signs a JWT before the
// faked fetch returns 401.
function pkcs8(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;
}
