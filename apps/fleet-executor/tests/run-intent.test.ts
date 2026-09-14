import { describe, expect, it } from 'vitest';
import type { ExecutorEnv, FleetRunJob } from '../src/env.js';
import {
  beginFleetIntentAttempt,
  claimFleetIntentForDlq,
  finishFleetIntentFromRun,
  markFleetIntentRetrying,
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
            return (opts.state == null ? null : { state: opts.state }) as T | null;
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
    const { env, writes } = envWithDb({ state: 'running' });
    expect(await beginFleetIntentAttempt(env, JOB, 5)).toBe('run');
    expect(writes[0]?.sql).toContain("'running'");
    expect(writes[0]?.sql).toContain('attempt_count < ?');
    expect(writes[0]?.bound.at(-1)).toBe(5);
  });

  it('requires a higher platform attempt before re-entering an already-running intent', async () => {
    const { env } = envWithDb({ state: 'running', updateChanges: 0 });
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

  it('does not let a dead letter mutate a gate without durable generation ownership', async () => {
    await expect(claimFleetIntentForDlq({} as ExecutorEnv, JOB, 'failed')).resolves.toBe(false);
    const { env } = envWithDb({ state: 'retrying', omitUpdateMeta: true });
    await expect(claimFleetIntentForDlq(env, JOB, 'failed')).resolves.toBe(false);
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
    const { env, writes } = envWithDb({ state: 'running', conclusion: 'neutral' });
    await finishFleetIntentFromRun(env, JOB);
    expect(writes[0]?.sql).toContain('SET state = ?');
    expect(writes[0]?.sql).toContain("state IN ('admitting','queued','running','retrying','enqueue_failed')");
    expect(writes[0]?.bound[0]).toBe('neutral');
  });
});
