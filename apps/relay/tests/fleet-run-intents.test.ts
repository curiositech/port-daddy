import { describe, expect, it } from 'vitest';
import {
  getFleetRunProjectionWithSteps,
  listFleetRunProjections,
  markFleetRunIntentEnqueued,
  reserveFleetRunIntent,
  type FleetRunIntentRow,
} from '../src/fleet-run-intents.js';
import type { FleetRunRow } from '../src/db.js';

function makeDb(opts: {
  intents?: FleetRunIntentRow[];
  runs?: FleetRunRow[];
  insertChanges?: number | number[];
  seen?: Array<{ sql: string; bound: unknown[] }>;
} = {}): D1Database {
  const intents = opts.intents ?? [];
  const runs = opts.runs ?? [];
  const seen = opts.seen ?? [];
  const insertChanges = Array.isArray(opts.insertChanges)
    ? [...opts.insertChanges]
    : null;
  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) {
        bound = values;
        return stmt;
      },
      async first<T>() {
        seen.push({ sql, bound });
        if (sql.includes('fleet_run_intents') && sql.includes('delivery_id = ?')) {
          return (intents.find((row) => row.delivery_id === bound[0]) ?? null) as T | null;
        }
        if (sql.includes('fleet_runs') && sql.includes('delivery_id = ?')) {
          return (runs.find((row) => row.delivery_id === bound[0]) ?? null) as T | null;
        }
        if (sql.includes('fleet_runs') && sql.includes('id = ?')) {
          return (runs.find((row) => row.id === bound[0]) ?? null) as T | null;
        }
        return null;
      },
      async all<T>() {
        seen.push({ sql, bound });
        if (sql.includes('FROM fleet_run_intents')) return { results: intents as T[] };
        if (sql.includes('FROM fleet_run_steps')) return { results: [] as T[] };
        if (sql.includes('FROM fleet_runs')) return { results: runs as T[] };
        return { results: [] as T[] };
      },
      async run() {
        seen.push({ sql, bound });
        const changes = sql.includes('INSERT OR IGNORE INTO fleet_run_intents') && insertChanges
          ? (insertChanges.shift() ?? 1)
          : (typeof opts.insertChanges === 'number' ? opts.insertChanges : 1);
        return { success: true, meta: { changes } };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => {
      for (const statement of statements) await statement.run();
      return [];
    },
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function intent(overrides: Partial<FleetRunIntentRow> = {}): FleetRunIntentRow {
  return {
    delivery_id: 'delivery-new',
    repo_full_name: 'curiositech/port-daddy',
    pr_number: 8889,
    pr_url: 'https://github.com/curiositech/port-daddy/pull/8889',
    head_sha: 'a'.repeat(40),
    event_type: 'pull_request',
    action: 'synchronize',
    generation: 4,
    state: 'queued',
    attempt_count: 0,
    queued_at: 1_000,
    started_at: null,
    last_progress_at: 1_000,
    finished_at: null,
    superseded_by: null,
    last_error: null,
    ...overrides,
  };
}

const HISTORIC_RUN: FleetRunRow = {
  id: 'run:historic',
  delivery_id: 'historic',
  repo_full_name: 'curiositech/port-daddy',
  pr_number: 8888,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/8888',
  head_sha: 'b'.repeat(40),
  conclusion: 'neutral',
  ships_csv: 'qa,code-reviewer',
  neurons: null,
  ms: 60_000,
  created_at: 900,
};

describe('Fleet run admission ledger', () => {
  it('reserves a monotonic generation with the delivery id as idempotency key', async () => {
    const seen: Array<{ sql: string; bound: unknown[] }> = [];
    const result = await reserveFleetRunIntent(makeDb({ seen }), {
      deliveryId: 'delivery-new',
      repoFullName: 'curiositech/port-daddy',
      prNumber: 8889,
      prUrl: 'https://github.com/curiositech/port-daddy/pull/8889',
      headSha: 'a'.repeat(40),
      eventType: 'pull_request',
      action: 'synchronize',
      now: 1_000,
    });

    expect(result).toEqual({ shouldEnqueue: true, duplicate: false, state: 'admitting' });
    const insert = seen.find((entry) => entry.sql.includes('INSERT OR IGNORE INTO fleet_run_intents'));
    expect(insert?.sql).toContain('COALESCE(MAX(generation), 0) + 1');
    expect(insert?.bound[0]).toBe('delivery-new');
  });

  it('does not enqueue an already queued duplicate delivery', async () => {
    const result = await reserveFleetRunIntent(makeDb({ intents: [intent()] }), {
      deliveryId: 'delivery-new',
      repoFullName: 'curiositech/port-daddy',
      prNumber: 8889,
      prUrl: 'https://github.com/curiositech/port-daddy/pull/8889',
      headSha: 'a'.repeat(40),
      eventType: 'pull_request',
      action: 'synchronize',
      now: 1_001,
    });
    expect(result).toEqual({ shouldEnqueue: false, duplicate: true, state: 'queued' });
  });

  it('lets only one redelivery reclaim an enqueue-failed intent', async () => {
    const result = await reserveFleetRunIntent(
      makeDb({ intents: [intent({ state: 'enqueue_failed' })], insertChanges: 0 }),
      {
        deliveryId: 'delivery-new',
        repoFullName: 'curiositech/port-daddy',
        prNumber: 8889,
        prUrl: 'https://github.com/curiositech/port-daddy/pull/8889',
        headSha: 'a'.repeat(40),
        eventType: 'pull_request',
        action: 'synchronize',
        now: 1_001,
      },
    );
    expect(result).toEqual({ shouldEnqueue: false, duplicate: true, state: 'admitting' });
  });

  it('retries a concurrent generation collision instead of dropping the newer head', async () => {
    const seen: Array<{ sql: string; bound: unknown[] }> = [];
    const result = await reserveFleetRunIntent(makeDb({ seen, insertChanges: [0, 1] }), {
      deliveryId: 'delivery-new',
      repoFullName: 'curiositech/port-daddy',
      prNumber: 8889,
      prUrl: 'https://github.com/curiositech/port-daddy/pull/8889',
      headSha: 'a'.repeat(40),
      eventType: 'pull_request',
      action: 'synchronize',
      now: 1_001,
    });
    expect(result).toEqual({ shouldEnqueue: true, duplicate: false, state: 'admitting' });
    expect(seen.filter((entry) => entry.sql.includes('INSERT OR IGNORE')).length).toBe(2);
  });

  it('supersedes only older active generations after the new queue send', async () => {
    const seen: Array<{ sql: string; bound: unknown[] }> = [];
    await markFleetRunIntentEnqueued(makeDb({ seen }), 'delivery-new', 1_010);
    const supersede = seen.find((entry) => entry.sql.includes("SET state = 'superseded'"));
    expect(supersede?.sql).toContain('generation <');
    expect(supersede?.sql).toContain("state IN ('admitting', 'queued', 'running', 'retrying')");
    expect(supersede?.bound).toContain('delivery-new');
  });
});

describe('logical run projections', () => {
  it('shows queued work before a transcript exists and derives explicit ETA estimates', async () => {
    const rows = await listFleetRunProjections(
      makeDb({ intents: [intent()], runs: [HISTORIC_RUN] }),
      10,
      1_020,
    );
    const queued = rows.find((row) => row.delivery_id === 'delivery-new');
    expect(queued).toMatchObject({
      id: 'intent:delivery-new',
      logical_state: 'queued',
      has_transcript: false,
      queue_ahead_estimate: 0,
      expected_start_at: 1_020,
      expected_finish_at: 1_080,
    });
  });

  it('subtracts elapsed service time from a running receipt ETA', async () => {
    const rows = await listFleetRunProjections(
      makeDb({
        intents: [intent({ state: 'running', started_at: 980 })],
        runs: [HISTORIC_RUN],
      }),
      10,
      1_020,
    );
    const running = rows.find((row) => row.delivery_id === 'delivery-new');
    expect(running?.expected_start_at).toBe(980);
    expect(running?.expected_finish_at).toBe(1_040);
  });

  it('leaves ETA fields unknown when no completed service-time witness exists', async () => {
    const rows = await listFleetRunProjections(makeDb({ intents: [intent()] }), 10, 1_020);
    expect(rows[0]).toMatchObject({
      logical_state: 'queued',
      expected_start_at: null,
      expected_finish_at: null,
      queue_ahead_estimate: null,
    });
    expect(Number.isNaN(rows[0]?.expected_finish_at)).toBe(false);
  });

  it('keeps the durable intent state authoritative over a pending transcript header', async () => {
    const pendingRun = {
      ...HISTORIC_RUN,
      id: 'run:delivery-new',
      delivery_id: 'delivery-new',
      conclusion: 'pending',
    };
    const rows = await listFleetRunProjections(
      makeDb({ intents: [intent({ state: 'superseded' })], runs: [pendingRun] }),
      10,
      1_020,
    );
    expect(rows[0]).toMatchObject({ logical_state: 'superseded', has_transcript: true });
  });

  it('opens an intent-only transcript route without inventing transcript steps', async () => {
    const found = await getFleetRunProjectionWithSteps(
      makeDb({ intents: [intent()] }),
      'intent:delivery-new',
      1_020,
    );
    expect(found?.run.logical_state).toBe('queued');
    expect(found?.run.has_transcript).toBe(false);
    expect(found?.steps).toEqual([]);
  });
});
