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
import { beginFleetIntentAttempt } from '../src/run-intent.js';

const ONE_SHIP_YAML = 'fleet:\n  agents:\n    code-reviewer:\n      trigger: pull_request:opened\n      participation: { default: required, rules: [] }\n      blocking: true\n      prompt: code-reviewer ship\n';

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

/** Build a dead-letter delivery using the same message shape as the main queue. */
function fakeDlqBatch(messages: ReturnType<typeof fakeMessage>[]) {
  return { queue: 'fleet-runs-dlq', messages } as unknown as MessageBatch<FleetRunJob>;
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
  it('durably retries a merge-group token or check-creation failure even without AI', async () => {
    const job = makeJob({ eventType: 'merge_group', action: 'checks_requested', prNumber: null,
      payloadMinimal: { merge_group: { head_sha: 'QUEUE_SHA' } } });
    const db = memoryD1({ prNumber: 0, headSha: 'QUEUE_SHA', eventType: 'merge_group', action: 'checks_requested' });
    const tokens = memoryKV();
    const env = makeEnv({ DB: db.db, FLEET_TOKENS: tokens, AI: undefined });
    const first = fakeMessage(job, 1);
    await handler.queue(fakeBatch([first]), env, capturingCtx());
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(db.steps.some(step => step.kind === 'delivery-failed')).toBe(true);
    expect(db.runs[0].headSha).toBe('QUEUE_SHA');
    seedToken(tokens, 42);
    state.failCreateCheckRun = 1;
    const second = fakeMessage(job, 2);
    await handler.queue(fakeBatch([second]), env, capturingCtx());
    expect(second.retry).toHaveBeenCalledOnce();
    expect(second.ack).not.toHaveBeenCalled();
    const third = fakeMessage(job, 3);
    await handler.queue(fakeBatch([third]), env, capturingCtx());
    expect(third.ack).toHaveBeenCalledOnce();
    expect(third.retry).not.toHaveBeenCalled();
    expect(state.completed[0]).toMatchObject({ conclusion: 'failure' });
    expect(db.runs[0].conclusion).toBe('failure');
  });

  it('does not terminalize or ack a merge-group intent until GitHub confirms the failure check', async () => {
    const job = makeJob({ eventType: 'merge_group', action: 'checks_requested', prNumber: null,
      payloadMinimal: { merge_group: { head_sha: 'QUEUE_SHA' } } });
    const d1 = memoryD1({ prNumber: 0, headSha: 'QUEUE_SHA', eventType: 'merge_group', action: 'checks_requested' });
    const tokens = memoryKV();
    seedToken(tokens, 42);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (/\/check-runs\/\d+$/.test(String(input)) && init?.method === 'PATCH') {
          return new Response('cannot complete', { status: 422 });
        }
        return originalFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );
    const message = fakeMessage(job, 1);

    await handler.queue(fakeBatch([message]), makeEnv({ DB: d1.db, FLEET_TOKENS: tokens }), capturingCtx());

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(d1.intents.get(job.deliveryId)?.state).toBe('retrying');
    expect(state.completed).toHaveLength(0);
  });

  it('acks suspension without a terminal review verdict and rejects unauthorised direct redelivery', async () => {
    state.files.set('main:pd-fleet.yml', ONE_SHIP_YAML);
    const tokens = memoryKV();
    seedToken(tokens, 42);
    const capture = memoryD1();
    let intentState = 'queued';
    let intentAttemptCount = 0;
    let controlWaitingAt: number | null = null;
    let intentReason = '';
    const db = { prepare(sql: string) {
      if (!sql.includes('fleet_run_intents')) return capture.db.prepare(sql);
      let bound: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { bound = args; return statement; },
        async first() {
          return { state: intentState, attempt_count: intentAttemptCount,
            control_waiting_at: controlWaitingAt, last_error: intentReason || null };
        },
        async run() {
          if (sql.includes("SET state = 'running'")) {
            intentState = 'running';
            intentAttemptCount = Number(bound[0]);
          } else if (sql.includes('control_waiting_at = ?')) {
            intentState = 'cancelled';
            controlWaitingAt = Number(bound[0]);
            intentReason = String(bound[2]);
          } else if (sql.includes("SET state = 'retrying'")) {
            intentState = 'retrying';
            intentReason = String(bound[2]);
          }
          else if (sql.includes('SET state = ?')) intentState = String(bound[0]);
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    } } as D1Database;
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const env = makeEnv({ FLEET_TOKENS: tokens, AI: ai.ai, DB: db });
    const available = env.FLEET_CONTROL;
    env.FLEET_CONTROL = undefined;
    const first = fakeMessage(makeJob());
    await handler.queue(fakeBatch([first]), env, capturingCtx());
    expect(first.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    expect(intentState).toBe('cancelled');
    expect(controlWaitingAt).not.toBeNull();
    expect(intentReason).toContain('Fleet suspended: binding-missing');
    expect(ai.calls).toHaveLength(0);
    env.FLEET_CONTROL = available;
    const redelivery = fakeMessage(makeJob(), 2);
    await handler.queue(fakeBatch([redelivery]), env, capturingCtx());
    expect(redelivery.ack).toHaveBeenCalledOnce();
    expect(ai.calls).toHaveLength(0);
    expect(intentState).toBe('cancelled');
    expect(controlWaitingAt).not.toBeNull();
    expect(state.completed.at(-1)?.conclusion).toBe('failure');
  });

  it('retries an unavailable raw diff, then the DLQ fails its visible gate without model work', async () => {
    // A GitHub 5xx from the raw-diff endpoint used to become an empty diff and
    // let a clean, zero-source review complete. It is infrastructure failure:
    // retry the delivery, preserve an in-progress required check, and let the
    // DLQ turn that check red after retry exhaustion.
    state.prDiffStatus = 503;
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const ai = aiStub({ perShip: { 'code-reviewer': 'FLEET-VERDICT: PASS' } });
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db });
    const first = fakeMessage(makeJob(), 1);

    await handler.queue!(fakeBatch([first]), env, capturingCtx());

    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(first.ack).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(0);
    expect(state.completed).toHaveLength(0);
    expect(state.existingCheckRuns).toMatchObject([
      { name: 'Port Daddy Fleet', status: 'in_progress', headSha: 'HEADSHA' },
    ]);

    const deadLetter = fakeMessage(makeJob(), 3);
    await handler.queue!(fakeDlqBatch([deadLetter]), env, capturingCtx());

    expect(deadLetter.ack).toHaveBeenCalledTimes(1);
    expect(deadLetter.retry).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(0);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]).toMatchObject({ conclusion: 'failure' });
    expect(state.completed[0].summary).toContain('infrastructure failed before review completed');
    expect(state.completed).not.toContainEqual(expect.objectContaining({ conclusion: 'success' }));
    expect(state.completed).not.toContainEqual(expect.objectContaining({ conclusion: 'neutral' }));
  });

  it('retries a trusted ship-contract outage instead of treating it as an absent contract', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  name: test',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      participation: { default: required, rules: [] }',
        '      blocking: true',
        '      fallbacks:',
        '        - backend: cloudflare',
        "          model: '@cf/qwen/qwen3-30b-a3b-fp8'",
        '      prompt: code-reviewer ship: review the diff.',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'FLEET-VERDICT: PASS' } });
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/contents/fleet/ships/code-reviewer.md?ref=main')) {
          return new Response('contract authority unavailable', { status: 503 });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );
    const message = fakeMessage(makeJob(), 1);

    await handler.queue!(fakeBatch([message]), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }), capturingCtx());

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(0);
    expect(state.completed).toHaveLength(0);
    expect(state.existingCheckRuns).toMatchObject([
      { name: 'Port Daddy Fleet', status: 'in_progress', headSha: 'HEADSHA' },
    ]);
  });

  it('leaves a missing-producer continuation permit repairable without re-running a ship', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      participation: { default: required, rules: [] }',
        '      fallbacks:',
        '        - backend: cloudflare',
        `          model: '@cf/qwen/qwen3-30b-a3b-fp8'`,
        '      blocking: true',
        '      prompt: review',
        '    qa:',
        '      trigger: pull_request:opened',
        '      participation: { default: advisory, rules: [] }',
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
    });
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: db.db });

    const first = fakeMessage(makeJob(), 1);
    await handler.queue!(fakeBatch([first]), env, capturingCtx());

    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 1 });
    expect(first.ack).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
    expect(db.steps.filter(step => step.kind === DELIVERY_CONTINUATION_KIND)).toHaveLength(1);
    expect(await countDeliveryContinuations(env, runIdForDelivery('delivery-abc'))).toBe(1);
    expect(db.intents.get('delivery-abc')).toMatchObject({
      state: 'retrying',
      pendingContinuationSequence: 1,
    });
    const callsAfterFirstShip = ai.calls.length;

    const repairOnly = fakeMessage(makeJob(), 2);
    await handler.queue!(fakeBatch([repairOnly]), env, capturingCtx());

    expect(repairOnly.retry).toHaveBeenCalledTimes(1);
    expect(repairOnly.ack).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(callsAfterFirstShip);
    expect(db.intents.get('delivery-abc')).toMatchObject({
      state: 'retrying',
      pendingContinuationSequence: 1,
    });
  });

  it('acks successful slices and sends explicit deduplicated continuation messages', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      participation: { default: required, rules: [] }',
        '      fallbacks:',
        '        - backend: cloudflare',
        `          model: '@cf/qwen/qwen3-30b-a3b-fp8'`,
        '      blocking: true',
        '      prompt: review',
        '    qa:',
        '      trigger: pull_request:opened',
        '      participation: { default: advisory, rules: [] }',
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
    const continuationSend = vi.fn(async (
      _body: FleetRunJob,
      _options?: { delaySeconds?: number },
    ) => ({
      metadata: { metrics: { sent: 1 } },
    }));
    const env = makeEnv({
      FLEET_TOKENS: kv,
      AI: ai,
      DB: db.db,
      FLEET_CONTINUATIONS: { send: continuationSend } as unknown as Queue<FleetRunJob>,
    });

    const first = fakeMessage(makeJob(), 1);
    await handler.queue!(fakeBatch([first]), env, capturingCtx());

    expect(first.ack).toHaveBeenCalledTimes(1);
    expect(first.retry).not.toHaveBeenCalled();
    expect(continuationSend).toHaveBeenCalledTimes(1);
    const sequenceOne = continuationSend.mock.calls[0]?.[0] as FleetRunJob;
    expect(sequenceOne.continuationSequence).toBe(1);

    const second = fakeMessage(sequenceOne, 1);
    await handler.queue!(fakeBatch([second]), env, capturingCtx());

    expect(second.ack).toHaveBeenCalledTimes(1);
    expect(second.retry).not.toHaveBeenCalled();
    expect(continuationSend).toHaveBeenCalledTimes(1);
    expect(state.completed.at(-1)?.conclusion).toBe('success');

    // Simulate later checkpoints having advanced well past sequence one before
    // an at-least-once duplicate is delivered. It is provably stale, so no
    // successor repair is necessary.
    await recordDeliveryContinuation(env, makeJob(), 101, 'later-ship', []);
    await recordDeliveryContinuation(env, makeJob(), 202, 'latest-ship', []);

    const callsBeforeDuplicate = vi.mocked(ai.run).mock.calls.length;
    const duplicate = fakeMessage(sequenceOne, 1);
    await handler.queue!(fakeBatch([duplicate]), env, capturingCtx());

    expect(duplicate.ack).toHaveBeenCalledTimes(1);
    expect(duplicate.retry).not.toHaveBeenCalled();
    expect(continuationSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ai.run)).toHaveBeenCalledTimes(callsBeforeDuplicate);
  });

  it('lets only one duplicate explicit successor win the pending permit CAS', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      'fleet:\n  agents:\n    code-reviewer:\n      trigger: pull_request:opened\n      prompt: review\n    qa:\n      trigger: pull_request:opened\n      prompt: test\n',
    );
    const tokens = memoryKV();
    seedToken(tokens, 42);
    const db = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'FLEET-VERDICT: PASS',
        qa: 'FLEET-VERDICT: PASS',
      },
    });
    const send = vi.fn(async (
      _body: FleetRunJob,
      _options?: { delaySeconds?: number },
    ) => ({ metadata: { metrics: { sent: 1 } } }));
    const env = makeEnv({
      DB: db.db,
      FLEET_TOKENS: tokens,
      AI: ai.ai,
      FLEET_CONTINUATIONS: { send } as unknown as Queue<FleetRunJob>,
    });
    const predecessor = fakeMessage(makeJob(), 1);
    await handler.queue!(fakeBatch([predecessor]), env, capturingCtx());
    const successor = send.mock.calls[0]?.[0] as FleetRunJob;
    const callsBeforeDuplicates = ai.calls.length;
    const firstDuplicate = fakeMessage(successor, 1);
    const secondDuplicate = fakeMessage(successor, 1);

    await Promise.all([
      handler.queue!(fakeBatch([firstDuplicate]), env, capturingCtx()),
      handler.queue!(fakeBatch([secondDuplicate]), env, capturingCtx()),
    ]);

    expect(ai.calls).toHaveLength(callsBeforeDuplicates + 1);
    expect(firstDuplicate.ack).toHaveBeenCalledTimes(1);
    expect(secondDuplicate.ack).toHaveBeenCalledTimes(1);
    expect(firstDuplicate.retry).not.toHaveBeenCalled();
    expect(secondDuplicate.retry).not.toHaveBeenCalled();
    expect(db.intents.get('delivery-abc')).toMatchObject({
      state: 'success',
      continuationSequence: 1,
      pendingContinuationSequence: null,
    });
  });

  it('acks a superseded pending permit without repair-send or retry churn', async () => {
    const db = memoryD1({
      state: 'retrying',
      attemptCount: 1,
      continuationSequence: 0,
      pendingContinuationSequence: 1,
      pendingContinuationAt: 123,
    });
    const current = db.intents.get('delivery-abc')!;
    db.intents.set('delivery-newer', {
      ...current,
      state: 'queued',
      generation: 2,
      attemptCount: 0,
      controlWaitingAt: null,
      lastError: null,
      continuationSequence: 0,
      pendingContinuationSequence: null,
      pendingContinuationAt: null,
    });
    const send = vi.fn();
    const ai = aiStub({ perShip: {} });
    const message = fakeMessage(makeJob(), 2);

    await handler.queue!(fakeBatch([message]), makeEnv({
      DB: db.db,
      AI: ai.ai,
      FLEET_CONTINUATIONS: { send } as unknown as Queue<FleetRunJob>,
    }), capturingCtx());

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(0);
  });

  it('retries without a permit or send when a newer attempt wins before permit CAS', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      blocking: true',
        '      prompt: review',
        '    qa:',
        '      trigger: pull_request:opened',
        '      prompt: test',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const current = db.intents.get('delivery-abc')!;
    db.beforeContinuationPermitCas = () => {
      current.state = 'running';
      current.attemptCount = 2;
    };
    const continuationSend = vi.fn();
    const message = fakeMessage(makeJob(), 1);

    await handler.queue!(fakeBatch([message]), makeEnv({
      FLEET_TOKENS: kv,
      DB: db.db,
      AI: aiStub({
        perShip: {
          'code-reviewer': 'FLEET-VERDICT: PASS',
          qa: 'FLEET-VERDICT: PASS',
        },
      }).ai,
      FLEET_CONTINUATIONS: { send: continuationSend } as unknown as Queue<FleetRunJob>,
    }), capturingCtx());

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(continuationSend).not.toHaveBeenCalled();
    expect(db.steps.filter(step => step.kind === DELIVERY_CONTINUATION_KIND)).toHaveLength(0);
    expect(current).toMatchObject({ state: 'running', attemptCount: 2 });
  });

  it('retries without sending when a successor wins after permit but before send', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      blocking: true',
        '      prompt: review',
        '    qa:',
        '      trigger: pull_request:opened',
        '      prompt: test',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const current = db.intents.get('delivery-abc')!;
    const baselineControl = makeEnv({ DB: db.db }).FLEET_CONTROL!;
    const racingControl = {
      async admit(expectedRevision?: number, runId?: string) {
        if (current.pendingContinuationSequence === 1) {
          current.state = 'running';
          current.attemptCount = 101;
          current.continuationSequence = 1;
          current.pendingContinuationSequence = null;
          current.pendingContinuationAt = null;
        }
        return baselineControl.admit(expectedRevision, runId);
      },
    };
    const continuationSend = vi.fn();
    const message = fakeMessage(makeJob(), 1);

    await handler.queue!(fakeBatch([message]), makeEnv({
      FLEET_TOKENS: kv,
      DB: db.db,
      AI: aiStub({
        perShip: {
          'code-reviewer': 'FLEET-VERDICT: PASS',
          qa: 'FLEET-VERDICT: PASS',
        },
      }).ai,
      FLEET_CONTROL: racingControl,
      FLEET_CONTINUATIONS: { send: continuationSend } as unknown as Queue<FleetRunJob>,
    }), capturingCtx());

    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
    expect(continuationSend).not.toHaveBeenCalled();
    expect(db.steps.filter(step => step.kind === DELIVERY_CONTINUATION_KIND)).toHaveLength(1);
    expect(current).toMatchObject({
      state: 'running',
      attemptCount: 101,
      continuationSequence: 1,
      pendingContinuationSequence: null,
    });
  });

  it('retries an explicit continuation when its durable cursor is unavailable', async () => {
    const failingDb = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
    const continuationSend = vi.fn();
    const msg = fakeMessage(makeJob({ continuationSequence: 1 }), 1);

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({
        DB: failingDb,
        FLEET_CONTINUATIONS: { send: continuationSend } as unknown as Queue<FleetRunJob>,
      }),
      capturingCtx(),
    );

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(continuationSend).not.toHaveBeenCalled();
  });

  it('repairs the exact successor after queue-send failure without re-running a ship', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      'fleet:\n  agents:\n    code-reviewer:\n      trigger: pull_request:opened\n      prompt: review\n    qa:\n      trigger: pull_request:opened\n      prompt: test\n',
    );
    const db = memoryD1();
    const job = makeJob();
    const tokens = memoryKV();
    seedToken(tokens, 42);
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'FLEET-VERDICT: PASS',
        qa: 'FLEET-VERDICT: PASS',
      },
    });
    const failedSend = vi.fn(async () => {
      throw new Error('queue unavailable');
    });
    const env = makeEnv({
      DB: db.db,
      FLEET_TOKENS: tokens,
      AI: ai.ai,
      FLEET_CONTINUATIONS: { send: failedSend } as unknown as Queue<FleetRunJob>,
    });
    const first = fakeMessage(job, 1);
    await handler.queue!(fakeBatch([first]), env, capturingCtx());

    expect(first.retry).toHaveBeenCalledTimes(1);
    expect(first.ack).not.toHaveBeenCalled();
    expect(db.intents.get(job.deliveryId)).toMatchObject({
      state: 'retrying',
      continuationSequence: 0,
      pendingContinuationSequence: 1,
    });
    const callsAfterFirstShip = ai.calls.length;

    const continuationSend = vi.fn(async (
      _body: FleetRunJob,
      _options?: { delaySeconds?: number },
    ) => ({
      metadata: { metrics: { sent: 1 } },
    }));
    env.FLEET_CONTINUATIONS = { send: continuationSend } as unknown as Queue<FleetRunJob>;
    const msg = fakeMessage(job, 2);

    await handler.queue!(fakeBatch([msg]), env, capturingCtx());

    expect(continuationSend).toHaveBeenCalledTimes(1);
    expect(continuationSend.mock.calls[0]?.[0]).toMatchObject({
      deliveryId: job.deliveryId,
      continuationSequence: 1,
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(callsAfterFirstShip);
  });

  it('durably holds a pending handoff when Fleet pauses before its repair send', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      'fleet:\n  agents:\n    code-reviewer:\n      trigger: pull_request:opened\n      prompt: review\n    qa:\n      trigger: pull_request:opened\n      prompt: test\n',
    );
    const tokens = memoryKV();
    seedToken(tokens, 42);
    const db = memoryD1();
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'FLEET-VERDICT: PASS',
        qa: 'FLEET-VERDICT: PASS',
      },
    });
    let paused = false;
    const control = {
      async admit() {
        return { status: paused ? 'paused' as const : 'unpaused' as const,
          paused, revision: paused ? 2 : 1, pausedAt: 1 };
      },
    };
    const failedSend = vi.fn(async () => { throw new Error('queue unavailable'); });
    const env = makeEnv({
      DB: db.db,
      FLEET_TOKENS: tokens,
      AI: ai.ai,
      FLEET_CONTROL: control,
      FLEET_CONTINUATIONS: { send: failedSend } as unknown as Queue<FleetRunJob>,
    });
    const predecessor = fakeMessage(makeJob(), 1);
    await handler.queue!(fakeBatch([predecessor]), env, capturingCtx());
    const callsAfterFirstShip = ai.calls.length;
    expect(predecessor.retry).toHaveBeenCalledTimes(1);
    expect(db.intents.get('delivery-abc')?.pendingContinuationSequence).toBe(1);

    paused = true;
    const repairedSend = vi.fn();
    env.FLEET_CONTINUATIONS = { send: repairedSend } as unknown as Queue<FleetRunJob>;
    const repair = fakeMessage(makeJob(), 2);
    await handler.queue!(fakeBatch([repair]), env, capturingCtx());

    expect(repair.ack).toHaveBeenCalledTimes(1);
    expect(repair.retry).not.toHaveBeenCalled();
    expect(repairedSend).not.toHaveBeenCalled();
    expect(ai.calls).toHaveLength(callsAfterFirstShip);
    expect(db.intents.get('delivery-abc')).toMatchObject({
      state: 'cancelled',
      pendingContinuationSequence: 1,
    });
    expect(db.intents.get('delivery-abc')?.controlWaitingAt).not.toBeNull();
  });

  it('acks a continuation without its exact durable permit and performs no work', async () => {
    const db = memoryD1();
    const continuationSend = vi.fn();
    const msg = fakeMessage(makeJob({ continuationSequence: 1 }), 1);

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({
        DB: db.db,
        FLEET_CONTINUATIONS: { send: continuationSend } as unknown as Queue<FleetRunJob>,
      }),
      capturingCtx(),
    );

    expect(msg.retry).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(continuationSend).not.toHaveBeenCalled();
    expect(db.intents.get('delivery-abc')).toMatchObject({ state: 'queued', attemptCount: 0 });
    expect(db.runs).toHaveLength(0);
  });

  it('does not charge intentional slices against the provider retry circuit', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    qa:',
        '      trigger: pull_request:opened',
        '      participation: { default: required, rules: [] }',
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
    expect(await beginFleetIntentAttempt(env, makeJob(), 1)).toBe('run');
    await recordDeliveryContinuation(env, makeJob(), 1, 'prior-a', ['qa']);
    expect(await beginFleetIntentAttempt(env, makeJob(), 2)).toBe('run');
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
    state.files.set('main:pd-fleet.yml', ONE_SHIP_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '', participation: { default: 'required', rules: [] } },
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
    const intent = { state: 'queued', attemptCount: 0, error: null as string | null };
    const db = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) { bound = values; return stmt; },
          async first<T>() {
            if (sql.includes('FROM fleet_run_intents AS current')) {
              return { state: intent.state, attempt_count: intent.attemptCount, control_waiting_at: null } as T;
            }
            return null;
          },
          async all<T>() { return { results: [] as T[] }; },
          async run() {
            if (sql.includes("SET state = 'running'")) {
              intent.state = 'running';
              intent.attemptCount = Number(bound[0]);
            }
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

  it('closes a mid-flight supersession with an honest spend and publication receipt', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    code-reviewer:',
        '      trigger: pull_request:opened',
        '      participation: { default: required, rules: [] }',
        '      blocking: true',
        '      fallbacks:',
        '        - backend: cloudflare',
        `          model: '@cf/qwen/qwen3-30b-a3b-fp8'`,
        '      prompt: review',
        '',
      ].join('\n'),
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const intent = { state: 'queued', attemptCount: 0, error: null as string | null };
    const db = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) { bound = values; return stmt; },
          async first<T>() {
            if (sql.includes('FROM fleet_run_intents AS current')) {
              return { state: intent.state, attempt_count: intent.attemptCount, control_waiting_at: null } as T;
            }
            return null;
          },
          async all<T>() { return { results: [] as T[] }; },
          async run() {
            if (sql.includes("SET state = 'running'")) {
              intent.state = 'running';
              intent.attemptCount = Number(bound[0]);
            }
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
    let moved = false;
    const ai = aiStub({
      perShip: { 'code-reviewer': 'FLEET-VERDICT: PASS' },
      onCall: () => {
        if (!moved) {
          moved = true;
          state.prHeadSha = 'NEWER-DURING-AI';
        }
      },
    }).ai;
    const msg = fakeMessage(makeJob({ action: 'synchronize', deliveryId: 'delivery-midflight-stale' }));

    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, DB: db, AI: ai }),
      capturingCtx(),
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(intent.state).toBe('cancelled');
    expect(intent.error).toContain('changed during Fleet execution');
    expect(intent.error).toContain('Model work may already have occurred');
    expect(intent.error).toContain('after pd-code-reviewer MAP');
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.commentPosts).toBe(0);
    expect(state.reviews).toHaveLength(0);
  });

  it('closes an execution-only fleet as failed while no runner consumes sandbox grants', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      `fleet:\n  name: execution-only\n  agents:\n    test-author:\n      trigger: pull_request:opened\n      participation: { default: required, rules: [] }\n      allowedTools: "Read,Write,Bash(npm test*)"\n      execution:\n        mode: write_sandbox\n        repository: current_repository\n        worktree: isolated\n        cwd: .\n        toolAllowlist: [read_file, run_tests]\n        mcpAllowlist: [github.read]\n        networkAllowlist: []\n        writePathAllowlist: [.]\n        maxWallClockMs: 300000\n        maxCostMicrousd: 1000000\n      fallbacks:\n        - backend: cloudflare\n          model: '@cf/qwen/qwen3-30b-a3b-fp8'\n      prompt: |\n        test-author ship: execute repository tests.\n`,
    );
    const kv = memoryKV();
    seedToken(kv, 42);
    const intent = { state: 'queued', attemptCount: 0, error: null as string | null };
    const db = {
      prepare(sql: string) {
        let bound: unknown[] = [];
        const stmt = {
          bind(...values: unknown[]) { bound = values; return stmt; },
          async first<T>() {
            if (sql.includes('FROM fleet_run_intents AS current')) {
              return { state: intent.state, attempt_count: intent.attemptCount, control_waiting_at: null } as T;
            }
            if (sql.includes('SELECT conclusion FROM fleet_runs')) {
              return { conclusion: 'failure' } as T;
            }
            return null;
          },
          async all<T>() { return { results: [] as T[] }; },
          async run() {
            if (sql.includes("SET state = 'running'")) {
              intent.state = 'running';
              intent.attemptCount = Number(bound[0]);
            }
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
    expect(intent.state).toBe('failure');
    expect(intent.error).toBeNull();
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
    state.files.set('main:pd-fleet.yml', ONE_SHIP_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '', participation: { default: 'required', rules: [] } },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    const realFetch = globalThis.fetch;
    let resolveFirstCompletionPatch: (() => void) | undefined;
    const firstCompletionPatch = new Promise<void>(resolve => {
      resolveFirstCompletionPatch = resolve;
    });
    let completionPatchAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/check-runs\/\d+$/.test(url) && (init?.method ?? 'GET') === 'PATCH') {
          completionPatchAttempts += 1;
          if (completionPatchAttempts === 1) resolveFirstCompletionPatch?.();
          return new Response('completion unavailable', { status: 503 });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    const handling = handler.queue!(fakeBatch([msg]), makeEnv({ FLEET_TOKENS: kv, AI: ai }), ctx);
    // Wait for the first real completion response, then flush exactly the
    // response/read-back boundary that schedules completeCheckRun's retry
    // timer. The trusted snapshot adds ordinary awaits before this point;
    // advancing all timers before the first PATCH is observed races that
    // legitimate setup work and masks the retry behavior this test verifies.
    await firstCompletionPatch;
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    await handling;

    expect(completionPatchAttempts).toBe(3);
    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.retry).toHaveBeenCalledWith();
    expect(msg.ack).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
    expect(ctx.waited).toHaveLength(0);
  });

  it('carries a long provider Retry-After into the Cloudflare redelivery delay', async () => {
    state.files.set('main:pd-fleet.yml', ONE_SHIP_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '', participation: { default: 'required', rules: [] } },
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
        '      participation: { default: required, rules: [] }',
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

  it('stops after three provider attempts and fails closed when the required voter is unavailable', async () => {
    state.files.set(
      'main:pd-fleet.yml',
      [
        'fleet:',
        '  agents:',
        '    qa:',
        '      trigger: pull_request:opened',
        '      participation: { default: required, rules: [] }',
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
    expect(state.completed[0]?.conclusion).toBe('failure');
    expect(state.completed[0]?.summary).toContain('HTTP 429, code 3040');
    expect(state.completed[0]?.summary).toContain('adjudicated FLEET-WIDE fault');
    expect(state.completed[0]?.summary).toContain('required vote remains unmet and gates this PR');
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
