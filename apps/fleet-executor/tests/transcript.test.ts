/**
 * Phase C observability: the executor's KILL SWITCH (KV `fleet:paused`) and the
 * best-effort transcript/audit writes (fleet_runs + fleet_run_steps in the
 * shared relay D1).
 *
 * Invariants exercised here:
 *   1. Paused ⇒ the job is acked with ZERO AI spend and ZERO GitHub calls.
 *   2. A normal run writes exactly one fleet_runs row (final conclusion stamped)
 *      plus the expected ordered transcript step kinds.
 *   3. A transcript-write failure (D1 down) NEVER fails the run or changes the
 *      merge gate — the check still completes with the correct conclusion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../src/index.js';
import { TRANSCRIPT_EMERGENCY_EVENT } from '../../../lib/transcript-emergency-constants.js';
import { executeFleet } from '../src/execute.js';
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

/** Build a well-formed pd-fleet.yml the deterministic parser reads directly. */
function fleetYaml(
  ships: Array<{ name: string; blocking?: boolean; model?: string }>,
): string {
  const body = ships
    .map(s => {
      const lines = [`    ${s.name}:`, `      trigger: pull_request:opened`];
      if (s.blocking) lines.push('      blocking: true');
      lines.push('      fallbacks:');
      lines.push('        - backend: cloudflare');
      lines.push(`          model: '${s.model ?? '@cf/qwen/qwen2.5-coder-32b-instruct'}'`);
      lines.push('      prompt: |');
      lines.push(`        ${s.name} ship: review the diff and report findings.`);
      return lines.join('\n');
    })
    .join('\n');
  return `fleet:\n  name: test\n  agents:\n${body}\n`;
}

const REVIEWER_YAML = fleetYaml([
  { name: 'code-reviewer', blocking: true, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
]);

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

function fakeMessage(body: FleetRunJob) {
  return { id: 'm1', timestamp: new Date(), body, ack: vi.fn(), retry: vi.fn() };
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
});

describe('kill switch (KV fleet:paused)', () => {
  it('paused (boolean "true") ⇒ no AI calls, no GitHub calls, job acked', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    await kv.put('fleet:paused', 'true');

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();

    const msg = fakeMessage(makeJob());
    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }),
      {} as ExecutionContext,
    );

    // Acked without retry — the job is consumed, nothing was done.
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    // Zero AI spend, zero GitHub traffic, zero check runs, zero transcript writes.
    expect(ai.calls).toHaveLength(0);
    expect(state.records).toHaveLength(0);
    expect(state.completed).toHaveLength(0);
    expect(state.commentPosts).toBe(0);
    expect(d1.runs).toHaveLength(0);
    expect(d1.steps).toHaveLength(0);
  });

  it('paused (JSON {paused:true}) ⇒ skips, while {paused:false} runs normally', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    await kv.put('fleet:paused', JSON.stringify({ paused: true, pausedAt: 1 }));

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: memoryD1().db }));
    expect(ai.calls).toHaveLength(0);
    expect(state.completed).toHaveLength(0);

    // Flip to resumed: the same job now runs to completion.
    await kv.put('fleet:paused', JSON.stringify({ paused: false, pausedAt: 2 }));
    const ai2 = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai2.ai, DB: memoryD1().db }));
    expect(ai2.calls.length).toBeGreaterThan(0);
    expect(state.completed).toHaveLength(1);
  });

  it('absent / corrupt flag ⇒ NOT paused (fail-safe keeps the gate running)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    await kv.put('fleet:paused', 'garbage-not-json');

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: memoryD1().db }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed).toHaveLength(1);
  });

  it('missing CONTROL_KV binding ⇒ NOT paused (fail-safe keeps the gate running)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: undefined, AI: ai.ai, DB: memoryD1().db }));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('CONTROL_KV read failures and malformed objects ⇒ NOT paused', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const throwingControlKv = {
      get: vi.fn(async () => {
        throw new Error('kv read failed');
      }),
    } as unknown as KVNamespace;

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: throwingControlKv, AI: ai.ai, DB: memoryD1().db }));
    expect(ai.calls.length).toBeGreaterThan(0);
    expect(state.completed).toHaveLength(1);

    const malformedKv = memoryKV();
    await malformedKv.put('fleet:paused', JSON.stringify({ paused: 'true' }));
    const ai2 = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    await executeFleet(makeJob({ deliveryId: 'delivery-def' }), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: malformedKv, AI: ai2.ai, DB: memoryD1().db }));
    expect(ai2.calls.length).toBeGreaterThan(0);
    expect(state.completed).toHaveLength(2);
  });

  it('pause flipped after check creation stops before AI spend and completes neutral', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const originalGet = kv.get.bind(kv);
    let pauseReads = 0;
    kv.get = (async (key: string) => {
      if (key === 'fleet:paused') {
        pauseReads += 1;
        return pauseReads >= 2 ? 'true' : null;
      }
      return originalGet(key);
    }) as KVNamespace['get'];

    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(pauseReads).toBe(2);
    expect(ai.calls).toHaveLength(0);
    expect(state.commentPosts).toBe(0);
    expect(state.reviews).toHaveLength(0);
    expect(state.checkRunsCreated).toBe(1);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('neutral');
    expect(state.completed[0].summary).toContain('Fleet paused before pd-code-reviewer');
    expect(d1.runs[0].conclusion).toBe('neutral');
    expect(d1.steps.map(s => s.kind)).toEqual(['check-completed']);
    expect(d1.steps[0].detail).toContain('"pausedBeforeShip":"code-reviewer"');
  });
});

describe('transcript writes (fleet_runs + fleet_run_steps)', () => {
  it('a normal single-chunk run writes one fleet_runs row + the expected step kinds', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();

    const job = makeJob();
    await executeFleet(job, makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    // Exactly one run row, with the PR hyperlink + final conclusion stamped.
    expect(d1.runs).toHaveLength(1);
    const run = d1.runs[0];
    expect(run.deliveryId).toBe(job.deliveryId);
    expect(run.repo).toBe('erichowens/port-daddy');
    expect(run.prNumber).toBe(7);
    expect(run.prUrl).toBe('https://github.com/erichowens/port-daddy/pull/7');
    expect(run.headSha).toBe('HEADSHA');
    expect(run.shipsCsv).toBe('code-reviewer');
    expect(run.conclusion).toBe('success'); // 'pending' was overwritten by the UPDATE
    expect(run.ms).toBeGreaterThanOrEqual(0);

    // Single chunk ⇒ no reduce step. Order: map-chunk → ship-verdict →
    // review-posted → check-completed.
    const kinds = d1.steps.map(s => s.kind);
    expect(kinds).toEqual(['map-chunk', 'ship-verdict', 'review-posted', 'check-completed']);
    // seq is monotonic from 0.
    expect(d1.steps.map(s => s.seq)).toEqual([0, 1, 2, 3]);
    // The verdict step carries the parsed findings as its detail (here: empty).
    const verdict = d1.steps.find(s => s.kind === 'ship-verdict');
    expect(verdict?.ship).toBe('code-reviewer');
    // check-completed is run-scoped (no ship).
    expect(d1.steps.find(s => s.kind === 'check-completed')?.ship).toBeNull();
  });

  it('a multi-chunk run records 2 map-chunk steps + exactly one reduce step', async () => {
    const file = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n` + '+line\n'.repeat(1500);
    state.prDiff = file('a.ts') + file('b.ts');
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      perShip: { 'code-reviewer': 'partial\n\nFLEET-VERDICT: PASS' },
      managerOutput: 'merged\n\nFLEET-VERDICT: PASS',
    });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    const kinds = d1.steps.map(s => s.kind);
    expect(kinds.filter(k => k === 'map-chunk')).toHaveLength(2);
    expect(kinds.filter(k => k === 'reduce')).toHaveLength(1);
    // reduce comes after both map chunks, before the verdict.
    expect(kinds).toEqual([
      'map-chunk',
      'map-chunk',
      'reduce',
      'ship-verdict',
      'review-posted',
      'check-completed',
    ]);
  });

  it('a blocking ship with malformed findings records a ship-finding (MALFORMED) step', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const malformed = ['```json', '{ not valid array', '```', '', 'FLEET-VERDICT: PASS'].join('\n');
    const ai = aiStub({ perShip: { 'code-reviewer': malformed } });
    const d1 = memoryD1();

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    const kinds = d1.steps.map(s => s.kind);
    expect(kinds).toContain('ship-finding');
    expect(kinds).not.toContain('ship-verdict');
    // The gate still fails closed regardless of the transcript.
    expect(d1.runs[0].conclusion).toBe('failure');
  });
});

describe('transcript is best-effort (never changes the gate)', () => {
  it('D1 down ⇒ run still completes the check with the correct conclusion', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'HIGH\n\nFLEET-VERDICT: BLOCK' } });
    const d1 = memoryD1();
    d1.failAll = true; // every D1 .run() throws

    // Must NOT throw — a transcript-write failure cannot fail the job.
    await expect(
      executeFleet(makeJob(), makeEnv({
        FLEET_TOKENS: kv,
        CONTROL_KV: kv,
        AI: ai.ai,
        DB: d1.db,
        PORT_DADDY_TELEMETRY_URL: 'https://telemetry.example/ingest',
      })),
    ).resolves.toBeUndefined();

    // The gate still concluded correctly (blocking BLOCK ⇒ failure).
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('failure');
    // Writes were attempted but all swallowed → nothing captured.
    expect(d1.runCalls).toBeGreaterThan(0);
    expect(d1.runs).toHaveLength(0);
    expect(d1.steps).toHaveLength(0);
    expect(state.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'POST',
        url: 'https://telemetry.example/ingest',
        body: expect.objectContaining({
          source: 'fleet-executor',
          event: TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED,
          status: 'error',
          backend: 'cloudflare',
          metadata: expect.objectContaining({
            runId: 'run:delivery-abc',
            error: expect.stringContaining('D1 unavailable'),
          }),
        }),
      }),
    ]));
  });

  it('D1 down ⇒ transcript failure telemetry cannot hold run completion open', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    d1.failAll = true;

    const originalFetch = globalThis.fetch;
    let telemetryCalls = 0;
    const telemetryStarted = new Promise<void>((resolve) => {
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://telemetry.example/ingest') {
          const payload = typeof init?.body === 'string'
            ? JSON.parse(init.body) as { event?: string }
            : {};
          if (payload.event === TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED) {
            telemetryCalls += 1;
            resolve();
            return new Promise<Response>(() => {});
          }
        }
        return originalFetch(input, init);
      }) as unknown as typeof fetch);
    });

    const run = executeFleet(makeJob(), makeEnv({
      FLEET_TOKENS: kv,
      CONTROL_KV: kv,
      AI: ai.ai,
      DB: d1.db,
      PORT_DADDY_TELEMETRY_URL: 'https://telemetry.example/ingest',
    }));

    const result = await Promise.race([
      run.then(() => 'completed' as const),
      new Promise<'timed-out'>(resolve => setTimeout(() => resolve('timed-out'), 100)),
    ]);

    expect(result).toBe('completed');
    await telemetryStarted;
    expect(telemetryCalls).toBeGreaterThan(0);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('queue acks a completed run even when every transcript D1 write fails', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    d1.failAll = true;

    const msg = fakeMessage(makeJob());
    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }),
      {} as ExecutionContext,
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
    expect(d1.runCalls).toBeGreaterThan(0);
    expect(d1.runs).toHaveLength(0);
    expect(d1.steps).toHaveLength(0);
  });

  it('a missing DB binding ⇒ run still completes (writes are no-ops)', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    // No DB in env at all.
    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai }));

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
  });
});

describe('delivery id validation', () => {
  it('skips malformed delivery ids before minting tokens or creating run ids', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();

    await executeFleet(makeJob({ deliveryId: '../delivery abc' }), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));

    expect(ai.calls).toHaveLength(0);
    expect(state.records).toHaveLength(0);
    expect(state.completed).toHaveLength(0);
    expect(d1.runCalls).toBe(0);
  });
});
