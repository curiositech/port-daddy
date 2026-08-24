/**
 * Tests for the relay retention + reaping sweep (src/retention-sweep.ts).
 * The Cron-triggered equivalent of the daemon Arbiter's sweep. Injection-style:
 * a mock D1 records every DELETE's SQL + bound horizon so we assert the sweep
 * targets the right rows at a FIXED injected `now` (never the system clock).
 */

import { describe, it, expect } from 'vitest';
import { runRetentionSweep } from '../src/retention-sweep.js';
import type { Env } from '../src/types.js';

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000; // fixed injected clock

/** D1 mock: each DELETE returns a per-table changes count and records its horizon. */
function makeDb(counts: Record<string, number>, opts: { throwOn?: string } = {}) {
  const calls: Array<{ sql: string; horizon: number }> = [];
  const stmt = (sql: string) => {
    let horizon = 0;
    const s = {
      bind(...v: unknown[]) { horizon = v[0] as number; return s; },
      async run() {
        calls.push({ sql, horizon });
        if (opts.throwOn && sql.includes(opts.throwOn)) throw new Error(`boom:${opts.throwOn}`);
        const key = Object.keys(counts).find((k) => sql.includes(k));
        return { success: true, meta: { changes: key ? counts[key] : 0 } };
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { db: { prepare: stmt } as unknown as D1Database, calls };
}

function makeEnv(db: D1Database, retentionDays?: string): Env {
  return { DB: db, EVENT_RETENTION_DAYS: retentionDays } as unknown as Env;
}

describe('retention sweep', () => {
  it('prunes runs/steps/events at the retention horizon and reaps expired sessions', async () => {
    const { db, calls } = makeDb({
      fleet_run_steps: 12, fleet_runs: 3, fleet_run_intents: 4,
      events: 40, web_sessions: 7, users: 1,
    });
    const r = await runRetentionSweep(makeEnv(db, '7'), NOW);

    expect(r.retentionDays).toBe(7);
    expect(r.runStepsPruned).toBe(12);
    expect(r.runsPruned).toBe(3);
    expect(r.runIntentsPruned).toBe(4);
    expect(r.eventsPruned).toBe(40);
    expect(r.sessionsReaped).toBe(7);
    expect(r.errors).toEqual([]);

    // Retention deletes use now - 7d; the session reap uses `now` exactly.
    const retentionHorizon = NOW - 7 * DAY;
    expect(calls.find((c) => c.sql.includes('fleet_runs WHERE created_at'))!.horizon).toBe(retentionHorizon);
    const intents = calls.find((c) => c.sql.includes('DELETE FROM fleet_run_intents'))!;
    expect(intents.horizon).toBe(retentionHorizon);
    expect(intents.sql).toContain("state IN ('superseded','enqueue_failed','success','failure','neutral','cancelled')");
    expect(intents.sql).not.toContain("'queued'");
    expect(intents.sql).not.toContain("'running'");
    expect(calls.find((c) => c.sql.includes('events WHERE arrived_at'))!.horizon).toBe(retentionHorizon);
    expect(calls.find((c) => c.sql.includes('web_sessions WHERE expires_at'))!.horizon).toBe(NOW);
  });

  it('hard-deletes users soft-deleted more than 30 days ago (erasure completion)', async () => {
    const { db, calls } = makeDb({ users: 2 });
    const r = await runRetentionSweep(makeEnv(db, '30'), NOW);
    expect(r.usersHardDeleted).toBe(2);
    const erasureHorizon = NOW - 30 * DAY;
    const del = calls.find((c) => c.sql.includes('DELETE FROM users WHERE deleted_at IS NOT NULL'));
    expect(del!.horizon).toBe(erasureHorizon);
    const roles = calls.find((c) => c.sql.includes('DELETE FROM user_roles WHERE user_id IN'));
    expect(roles!.horizon).toBe(erasureHorizon);
  });

  it('fails SAFE on an unset/garbage retention knob — falls back to 30d, never horizon 0', async () => {
    for (const bad of [undefined, '', '0', 'abc', '-5']) {
      const { db, calls } = makeDb({ fleet_runs: 0 });
      const r = await runRetentionSweep(makeEnv(db, bad), NOW);
      expect(r.retentionDays).toBe(30); // never 0 → never "delete everything"
      const horizon = calls.find((c) => c.sql.includes('fleet_runs WHERE created_at'))!.horizon;
      expect(horizon).toBe(NOW - 30 * DAY);
      expect(horizon).toBeLessThan(NOW); // strictly in the past, never >= now
    }
  });

  it('is best-effort: one failing DELETE is recorded but never aborts the others or throws', async () => {
    const { db } = makeDb({ web_sessions: 5, users: 1 }, { throwOn: 'events' });
    const r = await runRetentionSweep(makeEnv(db, '7'), NOW);
    expect(r.errors.some((e) => e.includes('events'))).toBe(true);
    // Steps/sessions/users still ran despite the events failure.
    expect(r.sessionsReaped).toBe(5);
    expect(r.usersHardDeleted).toBe(1);
  });
});
