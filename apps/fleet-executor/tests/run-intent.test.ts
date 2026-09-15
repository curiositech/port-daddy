import { describe, expect, it } from 'vitest';
import type { ExecutorEnv, FleetRunJob } from '../src/env.js';
import { memoryD1 } from './harness.js';
import {
  assertFleetIntentCurrent,
  beginFleetIntentAttempt,
  claimFleetIntentForDlq,
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

  it('lets the DLQ terminalize a pending continuation without inheriting its send permit', async () => {
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
      kind: 'claimed',
      attempt: 5,
    });
    expect(db.intents.get(JOB.deliveryId)).toMatchObject({
      state: 'running',
      continuationSequence: 0,
      pendingContinuationSequence: null,
      pendingContinuationAt: null,
    });
    await expect(assertFleetIntentCurrent(env, JOB, 5)).resolves.toBeUndefined();
    await expect(markFleetIntentTerminal(env, JOB, 5, 'failure', 'dead-lettered'))
      .resolves.toBeUndefined();
    expect(db.intents.get(JOB.deliveryId)?.state).toBe('failure');
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
