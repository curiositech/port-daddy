import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../src/index.js';
import { handleDlqJob } from '../src/dlq.js';
import { executeFleet } from '../src/execute.js';
import { DEAD_LETTER_MARKER, isDeadLetteredSummary } from '../src/dead-letter-marker.js';
import {
  DELIVERY_ATTEMPT_KIND,
  DELIVERY_ATTEMPT_SEQ_BASE,
  DELIVERY_CONTINUATION_KIND,
  DELIVERY_CONTINUATION_LIVELOCK_THRESHOLD,
  DELIVERY_CONTINUATION_SEQ_BASE,
  DELIVERY_FAILURE_KIND,
  DELIVERY_FAILURE_SEQ_BASE,
  countDeliveryContinuations,
  countDeliveryAttemptStarts,
  deadLetterSummary,
  describeDeliveryError,
  readLastDeliveryFailure,
  readDeliveryContinuationLivelock,
  recordDeliveryAttemptStart,
  recordDeliveryContinuation,
  recordDeliveryFailure,
  runIdForDelivery,
} from '../src/delivery-failure.js';
import { saveShipCheckpoint } from '../src/ship-checkpoint.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
  aiStub,
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

const CHECKPOINT_BINDING = {
  bindingVersion: 3 as const,
  shipConfigSha256: `sha256:${'1'.repeat(64)}`,
  contractSha256: 'absent',
  graftSha256: `sha256:${'2'.repeat(64)}`,
  systemPromptSha256: `sha256:${'3'.repeat(64)}`,
  reviewInputSha256: `sha256:${'4'.repeat(64)}`,
  mediatorOrdersSha256: 'absent',
  lookoutProjectionSha256: 'not-applicable',
  executionReceiptKind: 'not-applicable' as const,
};

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

describe('attempt-start markers make uncatchable kills visible (#7743)', () => {
  it('records successful checkpoint continuations in their own durable band', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryAttemptStart(env, makeJob(), 2);
    await expect(
      recordDeliveryContinuation(env, makeJob(), 2, 'qa', ['spark', 'spider']),
    ).resolves.toBe(true);

    const continuation = db.steps.find(step => step.kind === DELIVERY_CONTINUATION_KIND);
    expect(Number(continuation?.seq)).toBe(DELIVERY_CONTINUATION_SEQ_BASE + 2);
    expect(String(continuation?.title)).toContain('progress, not a failure');
    expect(await countDeliveryContinuations(env, runIdForDelivery('delivery-abc'))).toBe(1);
  });

  it('detects two identical continuation states but permits monotonic progress', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    const runId = runIdForDelivery('delivery-abc');

    await recordDeliveryContinuation(env, makeJob(), 1, 'lookout', ['snipe', 'purser']);
    await expect(readDeliveryContinuationLivelock(env, runId)).resolves.toBeNull();
    await recordDeliveryContinuation(env, makeJob(), 101, 'snipe', ['purser']);
    await expect(readDeliveryContinuationLivelock(env, runId)).resolves.toBeNull();
    await recordDeliveryContinuation(env, makeJob(), 201, 'snipe', ['purser']);

    await expect(readDeliveryContinuationLivelock(env, runId)).resolves.toEqual({
      completedShip: 'snipe',
      remainingShips: ['purser'],
      repeats: DELIVERY_CONTINUATION_LIVELOCK_THRESHOLD,
    });
  });

  it('permits a shrinking roster when the same ship completes consecutive slices', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    const runId = runIdForDelivery('delivery-abc');

    await recordDeliveryContinuation(env, makeJob(), 1, 'lookout', ['snipe', 'purser']);
    await recordDeliveryContinuation(env, makeJob(), 101, 'lookout', ['purser']);

    await expect(readDeliveryContinuationLivelock(env, runId)).resolves.toBeNull();
  });

  it('detects repeated empty rosters as zero progress', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    const runId = runIdForDelivery('delivery-abc');

    await recordDeliveryContinuation(env, makeJob(), 1, 'lookout', []);
    await recordDeliveryContinuation(env, makeJob(), 101, 'lookout', []);

    await expect(readDeliveryContinuationLivelock(env, runId)).resolves.toEqual({
      completedShip: 'lookout',
      remainingShips: [],
      repeats: DELIVERY_CONTINUATION_LIVELOCK_THRESHOLD,
    });
  });

  it('treats roster order as scheduler state', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    const runId = runIdForDelivery('delivery-abc');

    await recordDeliveryContinuation(env, makeJob(), 1, 'lookout', ['snipe', 'purser']);
    await recordDeliveryContinuation(env, makeJob(), 101, 'lookout', ['purser', 'snipe']);

    await expect(readDeliveryContinuationLivelock(env, runId)).resolves.toBeNull();
  });

  it('fails open when continuation evidence is unavailable or malformed', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryContinuation(env, makeJob(), 1, 'lookout', ['purser']);
    db.steps.find(step => step.kind === DELIVERY_CONTINUATION_KIND)!.detail = '{bad json';
    await recordDeliveryContinuation(env, makeJob(), 101, 'lookout', ['purser']);

    await expect(readDeliveryContinuationLivelock(
      env,
      runIdForDelivery('delivery-abc'),
    )).resolves.toBeNull();
    db.failAll = true;
    await expect(readDeliveryContinuationLivelock(
      env,
      runIdForDelivery('delivery-abc'),
    )).resolves.toBeNull();
  });

  it('the consumer records a start marker BEFORE executing, so a platform kill still leaves evidence', async () => {
    const db = memoryD1();
    const msg = fakeMessage(makeJob(), 2);
    // Token mint throws (no seeded token), so this delivery fails — but the
    // start marker must already be on the transcript from before the work.
    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: memoryKV(), DB: db.db }),
      {} as ExecutionContext,
    );

    const starts = db.steps.filter(s => s.kind === DELIVERY_ATTEMPT_KIND);
    expect(starts).toHaveLength(1);
    expect(Number(starts[0].seq)).toBe(DELIVERY_ATTEMPT_SEQ_BASE + 2);
    expect(String(starts[0].title)).toContain('attempt 2 started');
    // Its band sits above the failure band, so neither overwrites the other.
    expect(DELIVERY_ATTEMPT_SEQ_BASE).toBeGreaterThan(DELIVERY_FAILURE_SEQ_BASE);
  });

  it('counts starts per run and degrades to 0 without a DB or on a throwing one', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryAttemptStart(env, makeJob(), 1);
    await recordDeliveryAttemptStart(env, makeJob(), 2);
    expect(await countDeliveryAttemptStarts(env, runIdForDelivery('delivery-abc'))).toBe(2);

    expect(await countDeliveryAttemptStarts(makeEnv({}), runIdForDelivery('delivery-abc'))).toBe(0);
    db.failAll = true;
    expect(await countDeliveryAttemptStarts(env, runIdForDelivery('delivery-abc'))).toBe(0);
  });

  it('a recorder failure never blocks the delivery', async () => {
    const db = memoryD1();
    db.failAll = true;
    await expect(recordDeliveryAttemptStart(makeEnv({ DB: db.db }), makeJob(), 1)).resolves.toBeUndefined();
  });

  it('starts-but-no-failure turns the gate summary into a diagnosis, not a shrug', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: db.db });

    // Three attempts began; none recorded a failure — the uncatchable-kill shape.
    for (const attempt of [1, 2, 3]) await recordDeliveryAttemptStart(env, makeJob(), attempt);
    await handleDlqJob(makeJob(), env);

    const summary = String(state.completed[0].summary);
    expect(summary).toContain('dead-lettered');
    expect(summary).toContain('3 delivery attempt(s) recorded a start marker but no failure');
    expect(summary).toContain('terminated without a catchable error');
    expect(summary).toContain(DEAD_LETTER_MARKER);
    expect(summary).not.toContain('No per-attempt failure was recorded');
  });

  it('a recorded failure still wins the summary over start markers — the thrown cause is more specific', async () => {
    state.existingCheckRuns.push({ id: 77, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: db.db });

    await recordDeliveryAttemptStart(env, makeJob(), 1);
    await recordDeliveryFailure(env, makeJob(), 1, new Error('token mint failed'));
    await handleDlqJob(makeJob(), env);

    const summary = String(state.completed[0].summary);
    expect(summary).toContain('token mint failed');
    expect(summary).not.toContain('terminated without a catchable error');
  });

  it('subtracts intentional continuations before diagnosing platform kills', async () => {
    state.existingCheckRuns.push({ id: 78, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: db.db });

    for (const attempt of [1, 2, 3]) await recordDeliveryAttemptStart(env, makeJob(), attempt);
    await recordDeliveryContinuation(env, makeJob(), 1, 'qa', ['spark', 'spider']);
    await recordDeliveryContinuation(env, makeJob(), 2, 'spark', ['spider']);
    await handleDlqJob(makeJob(), env);

    const summary = String(state.completed[0].summary);
    expect(summary).toContain('1 delivery attempt(s) recorded a start marker but no failure or intentional continuation');
    expect(summary).toContain('2 delivery attempt(s) completed as intentional checkpoint continuations');
    expect(summary).not.toContain('3 delivery attempt(s) recorded a start marker');
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

  it('reports retained checkpoint progress without promising an unverified resume', () => {
    const summary = deadLetterSummary('o', 'r', 7, null, 4, 2);
    expect(summary).toContain('2 ship(s) completed and checkpointed before the loss');
    expect(summary).toContain('revalidates their current trusted policy and prompt');
    expect(summary).not.toContain('replay of this delivery resumes past them');
    expect(summary).toContain(DEAD_LETTER_MARKER);
  });
});

describe('a dead-lettered check does not strand the head SHA', () => {
  const DECIDED_SUMMARY = 'pd-qa: PASS. Ships ran and reached a verdict.';

  it('marks the DLQ summary so a later delivery can tell it apart', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);

    await handleDlqJob(makeJob(), makeEnv({ FLEET_TOKENS: kv, DB: memoryD1().db }));

    expect(state.completed[0].summary).toContain(DEAD_LETTER_MARKER);
    expect(isDeadLetteredSummary(state.completed[0].summary)).toBe(true);
  });

  it('reads retained checkpoint progress into the DLQ check summary without promising reuse', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: db.db });
    await saveShipCheckpoint(env, runIdForDelivery('delivery-abc'), 0, {
      ship: 'code-reviewer',
      blocking: true,
      verdict: 'PASS',
      errored: false,
      findings: [],
    }, CHECKPOINT_BINDING);

    await handleDlqJob(makeJob(), env);

    expect(state.completed[0].summary).toContain('1 ship(s) completed and checkpointed');
    expect(state.completed[0].summary).toContain('revalidates their current trusted policy and prompt');
  });

  it('does not mark a summary ships actually decided', () => {
    expect(isDeadLetteredSummary(DECIDED_SUMMARY)).toBe(false);
    expect(isDeadLetteredSummary('')).toBe(false);
    expect(isDeadLetteredSummary(null)).toBe(false);
    expect(isDeadLetteredSummary(undefined)).toBe(false);
  });

  it('RE-RUNS the ships after a dead-letter, instead of returning at the guard', async () => {
    // This is the exact shape that stranded #7278, #7339 and #7344: one run
    // lost to a dead-letter leaves a completed `failure` on the head SHA, and
    // every later delivery used to return before even creating a check run.
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db });

    // A dead-lettered gate already sits on this head SHA.
    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'completed',
      conclusion: 'failure',
      summary: deadLetterSummary('erichowens', 'port-daddy', 7, { attempt: 4, error: 'boom' }),
      headSha: 'HEADSHA',
    });

    await executeFleet(makeJob(), env);

    // A FRESH check run was minted (a finished one cannot be reopened, so
    // reusing 4242 would complete a gate GitHub already considers closed)…
    const minted = state.existingCheckRuns.filter(c => c.id !== 4242);
    expect(minted).toHaveLength(1);
    // …and it reached a real verdict rather than returning at the guard.
    expect(state.completed.some(c => c.id === minted[0].id)).toBe(true);
  });

  it('still stops dead on a check that ships DID decide', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'completed',
      conclusion: 'failure',
      summary: DECIDED_SUMMARY,
      headSha: 'HEADSHA',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db }));

    // No new check, no completion, no model spend — the money guard holds.
    expect(state.existingCheckRuns).toHaveLength(1);
    expect(state.completed).toHaveLength(0);
  });

  it('mints a fresh check when an explicit reopen retries a completed neutral gate', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'completed',
      conclusion: 'neutral',
      summary: 'Fleet deferred before reaching a verdict.',
      headSha: 'HEADSHA',
    });

    await executeFleet(
      makeJob({ action: 'reopened', deliveryId: 'delivery-reopened' }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db }),
    );

    const minted = state.existingCheckRuns.filter(c => c.id !== 4242);
    expect(minted).toHaveLength(1);
    expect(state.completed.some(c => c.id === minted[0].id)).toBe(true);
  });

  it('mints a fresh check when an explicit reopen retries a decided failure', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'completed',
      conclusion: 'failure',
      summary: DECIDED_SUMMARY,
      headSha: 'HEADSHA',
    });

    await executeFleet(
      makeJob({ action: 'reopened', deliveryId: 'delivery-reopened' }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db }),
    );

    const minted = state.existingCheckRuns.filter(c => c.id !== 4242);
    expect(minted).toHaveLength(1);
    expect(state.completed.some(c => c.id === minted[0].id)).toBe(true);
  });

  it('does not rerun or spend when an explicit reopen finds a completed success', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'completed',
      conclusion: 'success',
      summary: DECIDED_SUMMARY,
      headSha: 'HEADSHA',
    });

    const result = await executeFleet(
      makeJob({ action: 'reopened', deliveryId: 'delivery-reopened' }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db }),
    );

    expect(result).toEqual({ kind: 'already-decided', conclusion: 'success' });
    expect(state.existingCheckRuns).toHaveLength(1);
    expect(state.completed).toHaveLength(0);
  });

  it('closes the loop: DLQ failure then redelivery yields a real verdict', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;
    const env = makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db });

    // 1. A run got as far as creating its in_progress gate, then was lost.
    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'in_progress',
      headSha: 'HEADSHA',
    });
    await handleDlqJob(makeJob(), env);
    expect(state.completed[0]).toMatchObject({ id: 4242, conclusion: 'failure' });

    // 2. A later delivery for the SAME head SHA now runs for real. Nothing was
    //    hand-fed between the two steps: step 1's PATCH wrote the marked
    //    summary, and step 2 read it back through the same lookup GitHub serves.
    await executeFleet(makeJob(), env);
    const verdict = state.completed.find(c => c.id !== 4242);
    expect(verdict, 'the redelivery reached no verdict — the SHA is still stranded').toBeDefined();
    // A REAL verdict: ships ran and their results are in the summary. Asserting
    // a specific conclusion would pin the stub's roster, not the un-stranding —
    // what matters is that this gate was decided by ships rather than inherited
    // from the dead-letter.
    expect(verdict!.summary).toContain('pd-code-reviewer');
    expect(verdict!.summary).not.toContain(DEAD_LETTER_MARKER);
    expect(verdict!.summary).not.toContain('dead-lettered');
  });
});

describe('the read-back path degrades honestly (pd-qa findings on #7377)', () => {
  it('falls back to the step title when detail is malformed JSON', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryFailure(env, makeJob(), 2, new Error('real cause'));

    // Corrupt the stored detail the way a truncated or half-written row would.
    const step = db.steps.find(s => s.kind === DELIVERY_FAILURE_KIND)!;
    step.detail = '{"attempt": 2, "error": "unterminated';

    const last = await readLastDeliveryFailure(env, runIdForDelivery('delivery-abc'));
    // Not null: the row is still evidence. The attempt comes from the seq (which
    // does not depend on the JSON) and the cause from the human-readable title.
    expect(last).not.toBeNull();
    expect(last!.attempt).toBe(2);
    expect(last!.error).toContain('real cause');
  });

  it('returns null rather than throwing when the read itself fails', async () => {
    const db = memoryD1();
    const env = makeEnv({ DB: db.db });
    await recordDeliveryFailure(env, makeJob(), 1, new Error('written fine'));
    db.failAll = true; // D1 goes away between the write and the read

    await expect(
      readLastDeliveryFailure(env, runIdForDelivery('delivery-abc')),
    ).resolves.toBeNull();
  });

  it('a failed read still yields a complete dead-letter summary, not a broken one', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const db = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: db.db });
    await recordDeliveryFailure(env, makeJob(), 3, new Error('cause that will be unreadable'));
    db.failAll = true;

    await handleDlqJob(makeJob(), env);

    const summary = String(state.completed[0].summary);
    expect(summary).toContain('dead-lettered');
    expect(summary).toContain('No per-attempt failure was recorded');
    // The marker must survive the degraded path, or the SHA stays stranded.
    expect(summary).toContain(DEAD_LETTER_MARKER);
  });

  it('names an empty cause instead of trailing a dangling colon', () => {
    const summary = deadLetterSummary('o', 'r', 7, { attempt: 2, error: '   ' });
    expect(summary).toContain('carried no readable cause');
    expect(summary).not.toMatch(/:\s*\n/);
    expect(summary).toContain(DEAD_LETTER_MARKER);
  });
});

describe('the DLQ handler fails the gate even on a malformed job', () => {
  it('completes the check as failure when deliveryId is missing, rather than bailing', async () => {
    // pd-qa proposed returning early on an absent deliveryId. That would be
    // WORSE than the degraded path: bailing leaves the check stuck
    // `in_progress` forever, which is the exact stuck-gate this handler exists
    // to prevent. A missing id costs a useless run link, not the gate.
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const job = makeJob();
    delete (job as { deliveryId?: string }).deliveryId;

    await expect(
      handleDlqJob(job, makeEnv({ FLEET_TOKENS: kv, DB: memoryD1().db })),
    ).resolves.toBeUndefined();

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]).toMatchObject({ id: 4242, conclusion: 'failure' });
    // …and the marker still lands, so the SHA is not stranded either.
    expect(String(state.completed[0].summary)).toContain(DEAD_LETTER_MARKER);
  });

  it('never rejects, so the caller always reaches message.ack()', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const db = memoryD1();
    db.failAll = true; // every write throws, including the read-back's guard
    await expect(
      handleDlqJob(makeJob(), makeEnv({ FLEET_TOKENS: memoryKV(), DB: db.db })),
    ).resolves.toBeUndefined();
  });
});

describe('checks dead-lettered BEFORE the marker existed are still recoverable', () => {
  // The exact summary GitHub is holding for #7278/#7339/#7344 — written by the
  // pre-marker DLQ handler, verbatim from check run 95964283666.
  const LEGACY_SUMMARY =
    'pd-fleet: run for curiositech/port-daddy PR #7339 was lost (job exhausted retries / ' +
    'dead-lettered). This gate is failed rather than left stuck in-progress.';

  it('recognises a legacy dead-letter that carries no marker', () => {
    expect(LEGACY_SUMMARY).not.toContain(DEAD_LETTER_MARKER);
    expect(isDeadLetteredSummary(LEGACY_SUMMARY)).toBe(true);
  });

  it('still recognises a marked one, and still refuses a ship-decided one', () => {
    expect(isDeadLetteredSummary(deadLetterSummary('o', 'r', 7, null))).toBe(true);
    expect(isDeadLetteredSummary('- pd-qa: PASS\n\nVerdict: SUCCESS')).toBe(false);
  });

  it('RE-RUNS the ships on a legacy dead-lettered check', async () => {
    // Without this, a PR stranded before the marker deployed stays stranded
    // forever: the guard reads a bare `failure` as decided and returns before
    // creating a check run. Reproduced live on 2026-08-19 — reopening all three
    // PRs re-ran every GitHub job and produced no fleet check at all.
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    state.existingCheckRuns.push({
      id: 4242,
      name: 'Port Daddy Fleet',
      status: 'completed',
      conclusion: 'failure',
      summary: LEGACY_SUMMARY,
      headSha: 'HEADSHA',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai, DB: memoryD1().db }));

    const minted = state.existingCheckRuns.filter(c => c.id !== 4242);
    expect(minted, 'no fresh check run — the legacy SHA is still stranded').toHaveLength(1);
    expect(state.completed.some(c => c.id === minted[0].id)).toBe(true);
  });
});
