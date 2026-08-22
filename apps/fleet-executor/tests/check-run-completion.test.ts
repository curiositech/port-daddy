/**
 * Regression tests for two "Port Daddy Fleet" check-completion bugs that let
 * required, otherwise-fully-green PRs sit BLOCKED repo-wide:
 *
 *   Bug A: recordRunStart's INSERT is best-effort/swallowed by design ("NEVER
 *   aborts the run"), so a transient D1 failure at exactly that moment left
 *   NO fleet_runs row behind — even though the check run still completes
 *   normally on GitHub with a real conclusion. Its details_url then points at
 *   a run id with no row, and the run page 404s ("Run not found"). ensureRunRow
 *   closes this with an idempotent (INSERT OR IGNORE) backstop, called both
 *   in execute.ts (after recordRunStart) and in dlq.ts (which never called
 *   recordRunStart at all).
 *
 *   Bug B: completeCheckRun's completion PATCH never checked res.ok, so a
 *   failed PATCH (network blip, GitHub 5xx, rate limit) was silently
 *   swallowed — the job was acked as a success and the check stayed
 *   `in_progress` on GitHub forever, with no retry and no DLQ chance to fix
 *   it. completeCheckRun now retries the PATCH locally (bounded, since it's a
 *   pure idempotent write) and returns whether it ultimately succeeded.
 *   executeFleet must treat false as a queue-level failure after checkpointed
 *   ships are durable and before posting the non-idempotent aggregate review,
 *   so redelivery is no-spend/no-duplicate and DLQ completion stays reachable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet, ensureRunRow } from '../src/execute.js';
import { completeCheckRun } from '../src/github.js';
import { handleDlqJob } from '../src/dlq.js';
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

function fleetYaml(name: string): string {
  return [
    'fleet:',
    '  name: test',
    '  agents:',
    `    ${name}:`,
    '      trigger: pull_request:opened',
    '      blocking: true',
    '      fallbacks:',
    "        - backend: cloudflare",
    "          model: '@cf/qwen/qwen2.5-coder-32b-instruct'",
    '      prompt: |',
    `        ${name} ship: review the diff and report findings.`,
    '',
  ].join('\n');
}
const REVIEWER_YAML = fleetYaml('code-reviewer');

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ensureRunRow (Bug A backstop)', () => {
  it('creates a minimal row when none exists yet', async () => {
    const d1 = memoryD1();
    await ensureRunRow(makeEnv({ DB: d1.db }), 'run:abc', 'abc', 'owner/repo', 7, 'sha1');
    expect(d1.runs).toHaveLength(1);
    expect(d1.runs[0]).toMatchObject({ id: 'run:abc', deliveryId: 'abc', headSha: 'sha1' });
  });

  it('never clobbers a row recordRunStart already wrote (OR IGNORE, not OR REPLACE)', async () => {
    const d1 = memoryD1();
    // Simulate recordRunStart's own successful write (real ships_csv, real pr data).
    await d1.db
      .prepare(
        `INSERT OR REPLACE INTO fleet_runs
           (id, delivery_id, repo_full_name, pr_number, pr_url, head_sha, conclusion, ships_csv, ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`,
      )
      .bind('run:abc', 'abc', 'owner/repo', 7, 'https://github.com/owner/repo/pull/7', 'sha1', 'code-reviewer,qa', 100)
      .run();

    // The backstop must be a true no-op against the already-correct row.
    await ensureRunRow(makeEnv({ DB: d1.db }), 'run:abc', 'abc', 'owner/repo', 7, 'sha1');

    expect(d1.runs).toHaveLength(1);
    expect(d1.runs[0].shipsCsv).toBe('code-reviewer,qa');
  });

  it('is a no-op (never throws) when env.DB is absent', async () => {
    await expect(
      ensureRunRow(makeEnv({ DB: undefined }), 'run:abc', 'abc', 'owner/repo', 7, 'sha1'),
    ).resolves.toBeUndefined();
  });

  it('end-to-end: a transient recordRunStart failure still leaves a real fleet_runs row after a full run', async () => {
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });
    const d1 = memoryD1();
    d1.failNextRecordRunStartInsert = true; // recordRunStart's own INSERT throws once

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: d1.db }));

    // The check still resolved normally on GitHub (recordRunStart failures never gate)...
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].conclusion).toBe('success');
    // ...and, thanks to ensureRunRow, its details_url now resolves to a real row
    // instead of 404ing — this is the exact PR #4103 symptom, closed.
    expect(d1.runs).toHaveLength(1);
    expect(d1.runs[0].id).toBe('run:delivery-abc');
  });
});

describe('DLQ path also gets the ensureRunRow backstop', () => {
  it('a dead-lettered job still gets a real fleet_runs row for its details_url', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();

    await handleDlqJob(makeJob(), makeEnv({ FLEET_TOKENS: kv, DB: d1.db }));

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]).toMatchObject({ id: 4242, conclusion: 'failure' });
    // Before this fix, dlq.ts never wrote a fleet_runs row at all.
    expect(d1.runs).toHaveLength(1);
    expect(d1.runs[0].id).toBe('run:delivery-abc');
  });
});

describe('completeCheckRun (Bug B: no more silently-swallowed PATCH failures)', () => {
  it('returns true on the first successful PATCH (unchanged happy path)', async () => {
    state.existingCheckRuns.push({ id: 99, name: 'Port Daddy Fleet' });
    const ok = await completeCheckRun('owner', 'repo', 99, 'success', 'all good', 'tok');
    expect(ok).toBe(true);
    expect(state.completed).toHaveLength(1);
  });

  it('retries a transient failure and succeeds without the caller ever seeing an error', async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/check-runs/99')) {
          calls += 1;
          if (calls < 2) return new Response('server hiccup', { status: 502 });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    const ok = await completeCheckRun('owner', 'repo', 99, 'success', 'all good', 'tok');
    expect(ok).toBe(true);
    expect(calls).toBe(2); // one failure, one success — proves the internal retry ran
  });

  it('returns false (never throws) after exhausting retries on a persistent failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('still down', { status: 503 })) as unknown as typeof fetch,
    );

    await expect(
      completeCheckRun('owner', 'repo', 99, 'success', 'all good', 'tok'),
    ).resolves.toBe(false);
  });

  it('a persistently-failing completion PATCH propagates before aggregate review', async () => {
    // This is the executable ack boundary. Returning normally would make the
    // queue consumer ack a ghost in-progress required check. Rejecting lets the
    // consumer retry/DLQ, while ordering completion before createReview keeps
    // that retry from posting a duplicate non-idempotent aggregate review.
    state.files.set('main:pd-fleet.yml', REVIEWER_YAML);
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/check-runs\/\d+$/.test(url) && (init?.method ?? 'GET') === 'PATCH') {
          return new Response('down', { status: 503 });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    await expect(
      executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai, DB: memoryD1().db })),
    ).rejects.toThrow('Port Daddy Fleet check completion failed after bounded retries');
    expect(state.completed).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
  });
});
