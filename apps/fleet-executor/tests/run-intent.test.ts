import { describe, expect, it } from 'vitest';
import type { ExecutorEnv, FleetRunJob } from '../src/env.js';
import { memoryD1 } from './harness.js';
import { fleetLifecycleDb } from '../../relay/tests/fleet-lifecycle-db.js';
import {
  assertFleetIntentCurrent,
  beginFleetIntentAttempt,
  claimFleetIntentForDlq,
  claimFleetIntentWork,
  finishFleetIntentFromRun,
  markFleetIntentTerminal,
  markFleetIntentRetrying,
  markFleetIntentWaitingForControl,
} from '../src/run-intent.js';

const JOB: FleetRunJob = {
  deliveryId: 'delivery-8889',
  eventType: 'pull_request',
  action: 'synchronize',
  repoFullName: 'curiositech/port-daddy',
  installationId: 1,
  prNumber: 8889,
  payloadMinimal: { pull_request: { head: { sha: 'head-8889' } } },
};

function envWithDb(opts: {
  state?: string | null;
  conclusion?: string | null;
  attemptCount?: number;
  controlWaitingAt?: number | null;
  lastError?: string | null;
  fail?: boolean;
  updateChanges?: number;
  omitUpdateMeta?: boolean;
}) {
  const writes: Array<{ sql: string; bound: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          bound = values;
          return stmt;
        },
        async first<T>() {
          if (opts.fail) throw new Error('no such table: fleet_run_intents');
          if (sql.includes('fleet_run_intents')) {
            return (opts.state == null ? null : {
              state: opts.state,
              attempt_count: opts.attemptCount ?? 0,
              control_waiting_at: opts.controlWaitingAt ?? null,
              last_error: opts.lastError ?? null,
            }) as T | null;
          }
          if (sql.includes('fleet_runs')) {
            return (opts.conclusion == null ? null : { conclusion: opts.conclusion }) as T | null;
          }
          return null;
        },
        async run() {
          if (opts.fail) throw new Error('write failed');
          writes.push({ sql, bound });
          return opts.omitUpdateMeta
            ? { success: true }
            : { success: true, meta: { changes: opts.updateChanges ?? 1 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { env: { DB: db } as ExecutorEnv, writes };
}

describe('executor Fleet intent preflight', () => {
  it('acks superseded work before execution', async () => {
    const { env, writes } = envWithDb({ state: 'superseded' });
    expect(await beginFleetIntentAttempt(env, JOB, 4)).toBe('skip');
    expect(writes).toEqual([]);
  });

  it('marks a queued intent running with the platform attempt count', async () => {
    const { env, writes } = envWithDb({ state: 'queued' });
    expect(await beginFleetIntentAttempt(env, JOB, 4)).toBe('run');
    expect(writes[0]?.sql).toContain("SET state = 'running'");
    expect(writes[0]?.bound[0]).toBe(4);
  });

  it('skips when a newer generation wins between the read and conditional update', async () => {
    const { env } = envWithDb({ state: 'queued', updateChanges: 0 });
    expect(await beginFleetIntentAttempt(env, JOB, 4)).toBe('skip');
  });

  it('allows a running row to resume after an uncatchable Worker termination', async () => {
    const { env, writes } = envWithDb({ state: 'running', attemptCount: 4 });
    expect(await beginFleetIntentAttempt(env, JOB, 5)).toBe('run');
    expect(writes[0]?.sql).toContain("'running'");
    expect(writes[0]?.sql).toContain('attempt_count < ?');
    expect(writes[0]?.bound.at(-1)).toBe(5);
  });

  it('requires a higher platform attempt before re-entering an already-running intent', async () => {
    const { env } = envWithDb({ state: 'running', attemptCount: 4, updateChanges: 0 });
    expect(await beginFleetIntentAttempt(env, JOB, 4)).toBe('skip');
  });

  it('does not bypass a possible control hold when the ledger is unavailable', async () => {
    const { env } = envWithDb({ fail: true });
    await expect(beginFleetIntentAttempt(env, JOB, 1)).rejects.toThrow();
  });

  it('fails closed when the durable admission binding is missing', async () => {
    await expect(beginFleetIntentAttempt({} as ExecutorEnv, JOB, 1)).rejects.toMatchObject({
      state: 'authority-unavailable',
    });
  });

  it('fails closed when a direct or stale queue delivery has no admission row', async () => {
    const { env } = envWithDb({ state: null });
    await expect(beginFleetIntentAttempt(env, JOB, 1)).rejects.toMatchObject({ state: 'missing' });
  });

  it('fails closed when the database adapter cannot prove the conditional ownership write', async () => {
    const { env } = envWithDb({ state: 'queued', omitUpdateMeta: true });
    await expect(beginFleetIntentAttempt(env, JOB, 1)).rejects.toMatchObject({
      state: 'write-unverified',
    });
  });

  it('retries a dead letter when durable generation ownership is unavailable or unverified', async () => {
    await expect(claimFleetIntentForDlq({} as ExecutorEnv, JOB, 'failed')).rejects.toMatchObject({
      state: 'authority-unavailable',
    });
    const { env } = envWithDb({ state: 'retrying', omitUpdateMeta: true });
    await expect(claimFleetIntentForDlq(env, JOB, 'failed')).rejects.toMatchObject({
      state: 'write-unverified',
    });
    const missing = envWithDb({ state: null });
    await expect(claimFleetIntentForDlq(missing.env, JOB, 'failed')).rejects.toMatchObject({
      state: 'missing',
    });
  });

  it('does not let a stale predecessor DLQ clear or steal a pending continuation permit', async () => {
    const db = memoryD1({
      deliveryId: JOB.deliveryId,
      state: 'retrying',
      repoFullName: JOB.repoFullName ?? 'erichowens/port-daddy',
      prNumber: JOB.prNumber as number,
      headSha: 'head-8889',
      eventType: JOB.eventType ?? 'pull_request',
      action: JOB.action ?? 'opened',
      attemptCount: 4,
      continuationSequence: 0,
      pendingContinuationSequence: 1,
      pendingContinuationAt: 123,
    });

    const env = { DB: db.db } as ExecutorEnv;
    await expect(claimFleetIntentForDlq(env, JOB, 'send failed')).resolves.toEqual({
      kind: 'skip',
      reason: 'continuation-stale',
    });
    expect(db.intents.get(JOB.deliveryId)).toMatchObject({
      state: 'retrying',
      continuationSequence: 0,
      pendingContinuationSequence: 1,
      pendingContinuationAt: 123,
    });
  });

  it('lets the exact pending successor DLQ claim and promote its own incarnation', async () => {
    const db = memoryD1({
      deliveryId: JOB.deliveryId,
      state: 'retrying',
      repoFullName: JOB.repoFullName ?? 'erichowens/port-daddy',
      prNumber: JOB.prNumber as number,
      headSha: 'head-8889',
      eventType: JOB.eventType ?? 'pull_request',
      action: JOB.action ?? 'opened',
      attemptCount: 4,
      continuationSequence: 0,
      pendingContinuationSequence: 1,
      pendingContinuationAt: 123,
    });
    const env = { DB: db.db } as ExecutorEnv;

    await expect(claimFleetIntentForDlq(
      env,
      { ...JOB, continuationSequence: 1 },
      'successor exhausted retries',
    )).resolves.toEqual({ kind: 'claimed', attempt: 5 });
    expect(db.intents.get(JOB.deliveryId)).toMatchObject({
      state: 'running',
      attemptCount: 5,
      continuationSequence: 1,
      pendingContinuationSequence: null,
      pendingContinuationAt: null,
    });
  });

  it('claims only the DLQ message matching the active continuation incarnation', async () => {
    const db = memoryD1({
      deliveryId: JOB.deliveryId,
      state: 'retrying',
      repoFullName: JOB.repoFullName ?? 'erichowens/port-daddy',
      prNumber: JOB.prNumber as number,
      headSha: 'head-8889',
      eventType: JOB.eventType ?? 'pull_request',
      action: JOB.action ?? 'opened',
      attemptCount: 104,
      continuationSequence: 1,
      pendingContinuationSequence: null,
    });
    const env = { DB: db.db } as ExecutorEnv;

    await expect(claimFleetIntentForDlq(env, JOB, 'stale predecessor'))
      .resolves.toEqual({ kind: 'skip', reason: 'continuation-stale' });
    expect(db.intents.get(JOB.deliveryId)).toMatchObject({
      state: 'retrying', attemptCount: 104, continuationSequence: 1,
    });

    const successor = { ...JOB, continuationSequence: 1 };
    await expect(claimFleetIntentForDlq(env, successor, 'successor failed')).resolves.toEqual({
      kind: 'claimed',
      attempt: 105,
    });
    expect(db.intents.get(JOB.deliveryId)).toMatchObject({
      state: 'running', attemptCount: 105, continuationSequence: 1,
    });
  });

  it.each([
    {
      label: 'pending successor replay before producer projection',
      state: 'admitting',
      sequence: 3,
      active: 2,
      pending: 3,
    },
    {
      label: 'pending successor replay after producer projection',
      state: 'queued',
      sequence: 3,
      active: 2,
      pending: 3,
    },
    {
      label: 'active continuation replay before producer projection',
      state: 'admitting',
      sequence: 3,
      active: 3,
      pending: null,
    },
    {
      label: 'active continuation replay after producer projection',
      state: 'queued',
      sequence: 3,
      active: 3,
      pending: null,
    },
  ])('claims an authorized $label', async ({ state, sequence, active, pending }) => {
    const db = memoryD1({
      deliveryId: JOB.deliveryId,
      state,
      repoFullName: JOB.repoFullName ?? 'erichowens/port-daddy',
      prNumber: JOB.prNumber as number,
      headSha: 'head-8889',
      eventType: JOB.eventType ?? 'pull_request',
      action: JOB.action ?? 'opened',
      attemptCount: 0,
      continuationSequence: active,
      pendingContinuationSequence: pending,
      pendingContinuationAt: pending == null ? null : 123,
    });
    const env = { DB: db.db } as ExecutorEnv;
    const replay = { ...JOB, continuationSequence: sequence };

    await expect(claimFleetIntentWork(env, replay, sequence * 100 + 1, sequence))
      .resolves.toEqual({ kind: 'run' });
    expect(db.intents.get(JOB.deliveryId)).toMatchObject({
      state: 'running',
      attemptCount: sequence * 100 + 1,
      continuationSequence: sequence,
      pendingContinuationSequence: null,
    });
  });

  it('enforces continuation DLQ and replay fencing through the real SQLite migration schema', async () => {
    const { db, sqlite } = fleetLifecycleDb();
    sqlite.prepare(`INSERT INTO fleet_run_intents
      (delivery_id, repo_full_name, pr_number, pr_url, head_sha, event_type, action,
       generation, state, attempt_count, continuation_sequence,
       pending_continuation_sequence, pending_continuation_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'retrying', 4, 0, 1, 123,
        'Continuation 1 pending queue handoff')`)
      .run(
        JOB.deliveryId,
        JOB.repoFullName,
        JOB.prNumber,
        `https://github.com/${JOB.repoFullName}/pull/${JOB.prNumber}`,
        'head-8889',
        JOB.eventType,
        JOB.action,
      );
    const env = { DB: db } as ExecutorEnv;

    await expect(claimFleetIntentForDlq(env, JOB, 'stale predecessor'))
      .resolves.toEqual({ kind: 'skip', reason: 'continuation-stale' });
    await expect(claimFleetIntentForDlq(
      env,
      { ...JOB, continuationSequence: 1 },
      'exact successor',
    )).resolves.toEqual({ kind: 'claimed', attempt: 5 });
    expect(sqlite.prepare(`SELECT state, attempt_count, continuation_sequence,
      pending_continuation_sequence FROM fleet_run_intents WHERE delivery_id = ?`)
      .get(JOB.deliveryId)).toEqual({
      state: 'running',
      attempt_count: 5,
      continuation_sequence: 1,
      pending_continuation_sequence: null,
    });

    sqlite.prepare(`UPDATE fleet_run_intents
      SET state = 'queued', attempt_count = 0, continuation_sequence = 2,
          pending_continuation_sequence = 3, pending_continuation_at = 124
      WHERE delivery_id = ?`).run(JOB.deliveryId);
    await expect(claimFleetIntentWork(
      env,
      { ...JOB, continuationSequence: 3 },
      301,
      3,
    )).resolves.toEqual({ kind: 'run' });
    expect(sqlite.prepare(`SELECT state, attempt_count, continuation_sequence,
      pending_continuation_sequence FROM fleet_run_intents WHERE delivery_id = ?`)
      .get(JOB.deliveryId)).toEqual({
      state: 'running',
      attempt_count: 301,
      continuation_sequence: 3,
      pending_continuation_sequence: null,
    });
    sqlite.close();
  });

  it('skips only a proven terminal, superseded, or control-waiting DLQ intent', async () => {
    await expect(claimFleetIntentForDlq(envWithDb({ state: 'success' }).env, JOB, 'failed'))
      .resolves.toEqual({ kind: 'skip', reason: 'terminal' });
    await expect(claimFleetIntentForDlq(envWithDb({ state: 'superseded' }).env, JOB, 'failed'))
      .resolves.toEqual({ kind: 'skip', reason: 'superseded' });
    await expect(claimFleetIntentForDlq(envWithDb({
      state: 'cancelled', controlWaitingAt: 123,
    }).env, JOB, 'failed')).resolves.toEqual({ kind: 'skip', reason: 'control-waiting' });
  });

  it('fences an older running attempt at every hot boundary', async () => {
    const { env } = envWithDb({ state: 'running', attemptCount: 5 });
    await expect(assertFleetIntentCurrent(env, JOB, 4)).rejects.toMatchObject({
      state: 'attempt-fenced:5',
    });
    await expect(assertFleetIntentCurrent(env, JOB, 5)).resolves.toBeUndefined();
  });

  it('does not let a delayed older delivery reopen a retrying newer attempt', async () => {
    const { env, writes } = envWithDb({ state: 'retrying', attemptCount: 5, updateChanges: 0 });
    expect(await beginFleetIntentAttempt(env, JOB, 4)).toBe('skip');
    expect(writes[0]?.sql).toContain("state IN ('running','retrying') AND attempt_count < ?");
  });

  it('treats the additive control marker as a durable waiting-for-control hold', async () => {
    const { env } = envWithDb({ state: 'cancelled', attemptCount: 4, controlWaitingAt: 123 });
    expect(await beginFleetIntentAttempt(env, JOB, 5)).toBe('skip');
    await expect(assertFleetIntentCurrent(env, JOB, 4)).rejects.toMatchObject({
      state: 'waiting_for_control',
    });
  });

  it('keeps a pre-marker legacy suspension inert without rewriting it', async () => {
    const { env, writes } = envWithDb({
      state: 'retrying', attemptCount: 4, lastError: 'Fleet suspended: binding-missing',
    });
    expect(await beginFleetIntentAttempt(env, JOB, 5)).toBe('skip');
    expect(writes).toEqual([]);
    await expect(assertFleetIntentCurrent(env, JOB, 4)).rejects.toMatchObject({
      state: 'waiting_for_control',
    });
  });

  it('requires the exact attempt for control and terminal transitions', async () => {
    const waiting = envWithDb({ state: 'running', attemptCount: 5, updateChanges: 0 });
    await expect(markFleetIntentWaitingForControl(waiting.env, JOB, 4, 'paused'))
      .rejects.toMatchObject({ state: 'waiting-for-control-write-fenced' });
    expect(waiting.writes[0]?.sql).toContain("SET state = 'cancelled'");
    const terminal = envWithDb({ state: 'running', attemptCount: 5, updateChanges: 0 });
    await expect(markFleetIntentTerminal(terminal.env, JOB, 4, 'failure', 'failed'))
      .rejects.toMatchObject({ state: 'terminal-write-fenced' });
  });

  it('publishes retry failure detail without making the retry path throw', async () => {
    const { env, writes } = envWithDb({ state: 'running' });
    await expect(markFleetIntentRetrying(env, JOB, 2, new Error('upstream 503\nretry'))).resolves.toBeUndefined();
    expect(writes[0]?.sql).toContain("SET state = 'retrying'");
    expect(writes[0]?.sql).toContain("state = 'running' AND attempt_count = ?");
    expect(writes[0]?.sql).toContain('repo_full_name = ?');
    expect(writes[0]?.bound[2]).toBe('Error: upstream 503 retry');
    expect(writes[0]?.bound.slice(3, 9)).toEqual([
      JOB.deliveryId, JOB.repoFullName, JOB.prNumber, 'head-8889', JOB.eventType, JOB.action,
    ]);
    expect(writes[0]?.bound[9]).toBe(2);
  });

  it('copies the authoritative run conclusion into the intent terminal state', async () => {
    const { env, writes } = envWithDb({ state: 'running', attemptCount: 2, conclusion: 'neutral' });
    await finishFleetIntentFromRun(env, JOB, 2);
    expect(writes[0]?.sql).toContain('SET state = ?');
    expect(writes[0]?.sql).toContain("state = 'running' AND attempt_count = ?");
    expect(writes[0]?.bound[0]).toBe('neutral');
  });

  it('refuses to acknowledge completion without a terminal run conclusion', async () => {
    const missing = envWithDb({ state: 'running', attemptCount: 2 });
    await expect(finishFleetIntentFromRun(missing.env, JOB, 2)).rejects.toMatchObject({
      state: 'terminal-conclusion-unavailable',
    });
    const pending = envWithDb({ state: 'running', attemptCount: 2, conclusion: 'pending' });
    await expect(finishFleetIntentFromRun(pending.env, JOB, 2)).rejects.toMatchObject({
      state: 'terminal-conclusion-unavailable',
    });
  });
});
