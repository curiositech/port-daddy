/**
 * Tests for the relay retention + reaping sweep (src/retention-sweep.ts).
 * The Cron-triggered equivalent of the daemon Arbiter's sweep. Injection-style:
 * a mock D1 records every DELETE's SQL + bound horizon so we assert the sweep
 * targets the right rows at a FIXED injected `now` (never the system clock).
 */

import { describe, it, expect } from 'vitest';
import {
  runRetentionSweep,
  SHIPWRIGHT_RETENTION_DAYS,
  SEAMANSHIP_CACHE_RETENTION_DAYS,
  SNIPE_CHAT_RETENTION_DAYS,
  CHAT_SPEND_RETENTION_DAYS,
  SUGGESTION_JOB_RETENTION_DAYS,
} from '../src/retention-sweep.js';
import { DIRECTORY_SIGNAL_RETENTION_DAYS } from '../src/directory.js';
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

/**
 * D1 mock that answers EVERY delete with one row removed, whatever the SQL.
 * Used by the wiring test below: under this mock a counter that comes back 0
 * is a counter no DELETE ever fed, which is the only way it can be 0.
 */
function makeUniformDb() {
  const calls: Array<{ sql: string; horizon: number }> = [];
  const stmt = (sql: string) => {
    let horizon = 0;
    const s = {
      bind(...v: unknown[]) { horizon = v[0] as number; return s; },
      async run() { calls.push({ sql, horizon }); return { success: true, meta: { changes: 1 } }; },
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

  // ── Every counter, discovered from the result ────────────────────────────
  //
  // The tests above name six tables. The sweep prunes thirteen, and the seven
  // it grew later — the Shipwright and Engineman chat stores, the Seamanship
  // frontmatter cache, the spend ledger, finished suggestion jobs, and both
  // directory invariants — were never named here. That is the same shape as
  // the no-body-column invariant: a list of things to check goes stale the
  // first time someone adds one, and the assertion keeps passing while
  // covering less of what it claims.
  //
  // So this reads the counters OFF THE RESULT instead of listing them. A prune
  // added tomorrow is covered the moment its counter exists.

  it('every counter on the result is fed by a real DELETE', async () => {
    const { db, calls } = makeUniformDb();
    const r = await runRetentionSweep(makeEnv(db, '7'), NOW);

    const counters = Object.entries(r).filter(
      ([k, v]) => typeof v === 'number' && k !== 'now' && k !== 'retentionDays',
    );
    // Premise, two ways: discovery actually found the counters (without this
    // the check below passes vacuously on an empty list), and none has been
    // quietly dropped since — removing one should be a deliberate edit here.
    expect(counters.length).toBeGreaterThanOrEqual(13);
    expect(calls.length).toBeGreaterThanOrEqual(counters.length);

    // Under makeUniformDb every DELETE reports one row, so the only way a
    // counter reads 0 is that no DELETE fed it — the statement is missing, or
    // its result is being dropped on the floor.
    const unfed = counters.filter(([, v]) => v !== 1).map(([k]) => k);
    expect(unfed).toEqual([]);
  });

  it('each stated retention horizon is bound to its own table and column', async () => {
    const { db, calls } = makeUniformDb();
    await runRetentionSweep(makeEnv(db, '7'), NOW);

    // These horizons are stated to the operator on the page, so the prune has
    // to match the promise. Matching on table AND column separates each age
    // prune from the identically-named defensive delete in the erasure block,
    // which keys on user_id rather than a timestamp.
    const expected: Array<[string, number]> = [
      ['shipwright_chats WHERE created_at', SHIPWRIGHT_RETENTION_DAYS],
      ['seamanship_skill_cache WHERE fetched_at', SEAMANSHIP_CACHE_RETENTION_DAYS],
      ['agent_chats WHERE created_at', SNIPE_CHAT_RETENTION_DAYS],
      ['agent_chat_spend WHERE window_start', CHAT_SPEND_RETENTION_DAYS],
      ['seamanship_suggestion_jobs WHERE state', SUGGESTION_JOB_RETENTION_DAYS],
      ['capability_index WHERE observed_at', DIRECTORY_SIGNAL_RETENTION_DAYS],
    ];

    // Premise: the constants differ, so binding the wrong one is detectable.
    // If they were all equal these assertions would pass for any pairing.
    expect(new Set(expected.map(([, d]) => d)).size).toBeGreaterThanOrEqual(3);

    for (const [needle, days] of expected) {
      const call = calls.find((c) => c.sql.includes(needle));
      expect(call, `no DELETE matched ${needle}`).toBeDefined();
      expect(call!.horizon, `${needle} horizon`).toBe(NOW - days * DAY);
      expect(call!.horizon).toBeLessThan(NOW); // strictly past, never >= now
    }
  });

  it('the spend prune can never reach the CURRENT budget window', async () => {
    const { db, calls } = makeUniformDb();
    await runRetentionSweep(makeEnv(db, '7'), NOW);

    // agent_chat_spend rows are keyed by UTC midnight (chat-spend.ts; the
    // refusal copy tells the operator the cap "resets at UTC midnight"), so
    // today's window_start is somewhere in (now - 1d, now]. A horizon later
    // than now - 1d can delete it, and deleting the live window forgives spend
    // the cap has already charged — a budget bypass, not a tidy-up. Two days
    // of retention is one full rollover plus slack; what MUST hold is the
    // boundary, not the exact number.
    const spend = calls.find((c) => c.sql.includes('agent_chat_spend WHERE window_start'));
    expect(spend).toBeDefined();
    expect(spend!.horizon).toBeLessThanOrEqual(NOW - DAY);
  });

  it('the suggestion-job prune touches only finished jobs', async () => {
    const { db, calls } = makeUniformDb();
    await runRetentionSweep(makeEnv(db, '7'), NOW);

    // Same rule the fleet_run_intents prune already follows: an unfinished job
    // row is the only durable evidence that work is in flight, so aging one out
    // loses the run rather than its receipt.
    const jobs = calls.find((c) => c.sql.includes('seamanship_suggestion_jobs WHERE state'));
    expect(jobs).toBeDefined();
    expect(jobs!.sql).toContain("state IN ('done','failed')");
    expect(jobs!.sql).not.toContain("'queued'");
    expect(jobs!.sql).not.toContain("'running'");
  });
});
