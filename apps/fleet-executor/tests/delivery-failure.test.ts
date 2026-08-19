import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../src/index.js';
import { handleDlqJob } from '../src/dlq.js';
import {
  DELIVERY_FAILURE_KIND,
  DELIVERY_FAILURE_SEQ_BASE,
  deadLetterSummary,
  describeDeliveryError,
  readLastDeliveryFailure,
  recordDeliveryFailure,
  runIdForDelivery,
} from '../src/delivery-failure.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';
import type { FleetRunJob } from '../src/env.js';

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

function fakeMessage(body: FleetRunJob, attempts?: number) {
  return { id: 'm1', timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() };
}

function fakeBatch(messages: ReturnType<typeof fakeMessage>[]) {
  return { queue: 'fleet-runs', messages } as unknown as MessageBatch<FleetRunJob>;
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a lost delivery records why it died', () => {
  it('writes a delivery-failed step and STILL retries when the run throws', async () => {
    // No pd-fleet.yml on the trusted branch and no token in KV: the token mint
    // path throws, which is exactly the "infrastructure error" the retry
    // contract exists for.
    const db = memoryD1();
    const msg = fakeMessage(makeJob(), 2);
    await handler.queue!(
      fakeBatch([msg]),
      // FLEET_TOKENS empty => no seeded token => the mint fetch 404s => throw.
      makeEnv({ FLEET_TOKENS: memoryKV(), DB: db.db }),
      {} as ExecutionContext,
    );

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();

    const failures = db.steps.filter(s => s.kind === DELIVERY_FAILURE_KIND);
    expect(failures).toHaveLength(1);
    expect(failures[0].runId).toBe(runIdForDelivery('delivery-abc'));
    expect(String(failures[0].title)).toContain('Delivery attempt 2 failed');
    // And a fleet_runs row exists, so the details_url a failed gate publishes
    // resolves instead of 404ing on a run that never got one.
    expect(db.runs.map(r => r.id)).toContain(runIdForDelivery('delivery-abc'));
  });

  it('parks failures above the transcript seq range so a later attempt cannot overwrite them', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryFailure(env, makeJob(), 1, new Error('first cause'));

    const failure = db.steps.find(s => s.kind === DELIVERY_FAILURE_KIND);
    expect(Number(failure!.seq)).toBe(DELIVERY_FAILURE_SEQ_BASE + 1);
    // The Transcript recorder restarts at seq 0 every attempt and writes
    // INSERT OR REPLACE. Anything it emits must sort below this floor, or
    // attempt N+1 would erase the record of why attempt N died.
    expect(Number(failure!.seq)).toBeGreaterThan(10_000);
  });

  it('keeps the earlier attempt readable and reads back the latest one', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryFailure(env, makeJob(), 1, new Error('token mint failed: 401'));
    await recordDeliveryFailure(env, makeJob(), 3, new Error('D1 unavailable'));

    expect(db.steps.filter(s => s.kind === DELIVERY_FAILURE_KIND)).toHaveLength(2);
    const last = await readLastDeliveryFailure(env, runIdForDelivery('delivery-abc'));
    expect(last).toEqual({ attempt: 3, error: 'Error: D1 unavailable' });
  });

  it('never throws out of the recorder, so a failing recorder cannot eat the retry', async () => {
    const db = memoryD1();
    db.failAll = true; // every .run() throws, including ensureRunRow's
    const msg = fakeMessage(makeJob(), 1);
    await expect(
      handler.queue!(
        fakeBatch([msg]),
        makeEnv({ FLEET_TOKENS: memoryKV(), DB: db.db }),
        {} as ExecutionContext,
      ),
    ).resolves.toBeUndefined();
    expect(msg.retry).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without a DB binding rather than a second failure', async () => {
    const env = makeEnv({});
    await expect(recordDeliveryFailure(env, makeJob(), 1, new Error('x'))).resolves.toBeUndefined();
    await expect(readLastDeliveryFailure(env, 'run:delivery-abc')).resolves.toBeNull();
  });
});

describe('the dead-letter gate names the cause', () => {
  it('puts the last recorded failure in the check-run summary', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: db.db });

    await recordDeliveryFailure(env, makeJob(), 4, new Error('token mint failed: 401 Bad credentials'));
    await handleDlqJob(makeJob(), env);

    expect(state.completed).toHaveLength(1);
    const summary = String(state.completed[0].summary);
    // The load-bearing first sentence is unchanged...
    expect(summary).toContain('dead-lettered');
    // ...and the cause is now on it.
    expect(summary).toContain('attempt 4');
    expect(summary).toContain('token mint failed: 401 Bad credentials');
  });

  it('says so explicitly when nothing was recorded, rather than leaving a silent gap', async () => {
    state.existingCheckRuns.push({ id: 99, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);

    await handleDlqJob(makeJob(), makeEnv({ FLEET_TOKENS: kv, DB: memoryD1().db }));

    const summary = String(state.completed[0].summary);
    expect(summary).toContain('dead-lettered');
    expect(summary).toContain('No per-attempt failure was recorded');
  });
});

describe('describeDeliveryError', () => {
  it('collapses a multi-line stack into one readable line', () => {
    const err = new Error('boom\n    at foo (bar.ts:1:1)\n    at baz (qux.ts:2:2)');
    expect(describeDeliveryError(err)).toBe('Error: boom at foo (bar.ts:1:1) at baz (qux.ts:2:2)');
  });

  it('names a falsy throw instead of returning an empty string', () => {
    expect(describeDeliveryError(undefined)).toBe('undefined');
    expect(describeDeliveryError('')).toContain('falsy value');
  });

  it('truncates a runaway error rather than filling the row', () => {
    const out = describeDeliveryError(new Error('x'.repeat(5_000)));
    expect(out.length).toBeLessThan(700);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('deadLetterSummary', () => {
  it('renders an unknown attempt number without printing "attempt 0"', () => {
    const summary = deadLetterSummary('o', 'r', 7, { attempt: 0, error: 'something' });
    expect(summary).toContain('the last attempt');
    expect(summary).not.toContain('attempt 0');
  });
});
