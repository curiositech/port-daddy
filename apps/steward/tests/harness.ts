import type { Env } from '../src/types.js';

/**
 * Test fakes for the Steward seat — a faithful miniature of the two platform
 * interfaces the scaffold touches: Durable Object storage and D1.
 *
 * PHILOSOPHY (inherited from the fleet-executor harness): fake the platform,
 * never the logic under test. These fakes implement the exact call shapes the
 * seat uses (`get`/`put`/`delete`/`list`/`setAlarm`/`getAlarm`; `prepare
 * .bind .run/.all`) with real in-memory semantics, so a passing test means
 * the REAL charter/inbox/ledger machinery behaved — not that a mock agreed
 * with itself.
 */

/**
 * In-memory Durable Object storage fake.
 *
 * WHY A REAL MAP + SORTED LIST: the seat's inbox relies on `list({prefix})`
 * returning keys in lexicographic order (zero-padded sequence keys) — a fake
 * that returned insertion order would hide ordering bugs the platform would
 * expose. Alarm calls are recorded so tests can assert the debounce and
 * heartbeat re-arm behavior directly.
 */
export class FakeStorage {
  /** Backing store. */
  readonly map = new Map<string, unknown>();
  /** Every setAlarm() target, in call order — newest is the live alarm. */
  readonly alarms: number[] = [];

  /**
   * Read one key — mirrors DurableObjectStorage.get by design.
   * @param key - Storage key.
   * @returns The stored value or undefined.
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  /**
   * Write one key or a batch object — both platform forms, because the seat
   * uses both and a fake missing one would hide real calls (fidelity intent).
   * @param keyOrEntries - A key (with `value`) or a `{key: value}` batch.
   * @param value - The value when the first argument is a key.
   * @returns Resolves once stored.
   */
  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.map.set(keyOrEntries, value);
      return;
    }
    for (const [k, v] of Object.entries(keyOrEntries)) this.map.set(k, v);
  }

  /**
   * Delete one key or an array of keys — the array form is why this exists:
   * the seat drains its inbox with a batch delete.
   * @param keys - Key or keys to remove.
   * @returns Count/boolean per the platform contract (tests ignore it).
   */
  async delete(keys: string | string[]): Promise<number | boolean> {
    if (typeof keys === 'string') return this.map.delete(keys);
    let n = 0;
    for (const k of keys) if (this.map.delete(k)) n++;
    return n;
  }

  /**
   * List entries by prefix in lexicographic key order — the ordering is the
   * design point (see class doc): insertion order would hide inbox sequencing
   * bugs.
   * @param opts - `{prefix}` filter.
   * @returns Ordered Map of matching entries.
   */
  async list<T = unknown>(opts?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = opts?.prefix ?? '';
    const keys = [...this.map.keys()].filter(k => k.startsWith(prefix)).sort();
    return new Map(keys.map(k => [k, this.map.get(k) as T]));
  }

  /**
   * Arm the alarm — recorded rather than executed, so tests can assert the
   * debounce/heartbeat arithmetic directly (that is this fake's purpose).
   * @param when - Epoch milliseconds target.
   * @returns Resolves once recorded.
   */
  async setAlarm(when: number): Promise<void> {
    this.alarms.push(when);
  }

  /**
   * Read the live alarm target — mirrors the platform's getAlarm by design.
   * @returns The most recent setAlarm value, or null when never armed.
   */
  async getAlarm(): Promise<number | null> {
    return this.alarms.length > this.cleared ? this.alarms[this.alarms.length - 1] : null;
  }

  /**
   * Clear the live alarm — mirrors the platform's `deleteAlarm()`.
   *
   * WHY THE FAKE NEEDS IT: on the real platform `getAlarm()` returns null once
   * an alarm has been delivered, and an alarm can also be lost outright (a
   * failed delivery, an evicted object, a migration). Without a way to reach
   * the un-armed state, the watchdog path in `handlePulse` — the whole subject
   * of P1 PR 5 — could only ever be tested on a brand-new seat, which is the
   * one case that is not the interesting one. The `alarms` history is kept so
   * assertions about earlier arming arithmetic still hold.
   *
   * @returns Resolves once the live alarm is cleared.
   */
  async deleteAlarm(): Promise<void> {
    this.cleared = this.alarms.length;
  }

  /** Count of alarms already delivered/lost; entries before it are history. */
  private cleared = 0;
}

/**
 * Build a fake DurableObjectState around a FakeStorage.
 *
 * PURPOSE: the seat only touches `state.storage`, so the fake state is thin —
 * but typed as the real interface so the production class needs no
 * test-only seams.
 *
 * @returns The fake state plus direct handles to storage for assertions.
 */
export function makeState(): { state: DurableObjectState; storage: FakeStorage } {
  const storage = new FakeStorage();
  const state = { storage } as unknown as DurableObjectState;
  return { state, storage };
}

/** One row as stored by the memory D1 — column names mirror schema.sql. */
type Row = Record<string, unknown>;

/**
 * In-memory D1 fake covering the seat's two ledger tables.
 *
 * DESIGN: SQL is matched by table name, mirroring the fleet-executor
 * harness's approach — the fake answers the exact queries ledgers.ts issues
 * and throws on anything unrecognized, so a query drifting away from the
 * schema fails loudly in tests instead of silently returning nothing.
 * `failing = true` makes every statement throw, exercising the seat's
 * degraded (fallback-ring) path.
 *
 * @returns The fake with direct row-array handles for seeding and assertions.
 */
export function memoryD1(): {
  db: D1Database;
  deckLog: Row[];
  mergeLedger: Row[];
  failing: { value: boolean };
} {
  const deckLog: Row[] = [];
  const mergeLedger: Row[] = [];
  const failing = { value: false };
  let deckId = 0;
  let mergeId = 0;

  const db = {
    /**
     * Capture a statement — the SQL string is what routes execution.
     * PURPOSE: mirrors D1's prepare/bind/run|all shape one level at a time so
     * ledgers.ts runs unmodified against the fake.
     * @param sql - The statement text ledgers.ts issued.
     * @returns The bindable statement fake.
     */
    prepare(sql: string) {
      return {
        /**
         * Capture the positional binds for the routed handler — the purpose
         * is faithful positional semantics, matching schema column order.
         * @param binds - Positional parameters in statement order.
         * @returns The runnable statement fake.
         */
        bind(...binds: unknown[]) {
          return {
            /**
             * Execute a write — INSERTs only, by the append-only design.
             * @returns `{success: true}` on a recognized statement.
             */
            async run() {
              if (failing.value) throw new Error('D1 unavailable (test)');
              if (/INSERT INTO steward_deck_log/i.test(sql)) {
                deckLog.push({
                  id: ++deckId,
                  repo_full_name: binds[0],
                  entry_kind: binds[1],
                  summary: binds[2],
                  detail: binds[3],
                  wake_events: binds[4],
                  created_at: binds[5],
                });
                return { success: true };
              }
              if (/INSERT INTO steward_merge_ledger/i.test(sql)) {
                mergeLedger.push({
                  id: ++mergeId,
                  repo_full_name: binds[0],
                  pr_number: binds[1],
                  verdict: binds[2],
                  evidence: binds[3],
                  requested_by: binds[4],
                  created_at: binds[5],
                });
                return { success: true };
              }
              throw new Error(`memoryD1: unhandled run(): ${sql}`);
            },
            /**
             * Execute a read — the two bounded newest-first ledger queries,
             * shaped like real D1 results by design so mapping code runs
             * unmodified.
             * @returns `{results}` shaped like a real D1 result set.
             */
            async all() {
              if (failing.value) throw new Error('D1 unavailable (test)');
              /**
               * Shared newest-first/limit/repo-filter projection.
               * WHY SHARED: both ledger tables read with identical shape, and
               * one implementation keeps the fake's semantics from drifting
               * between them.
               * @param rows - The backing table.
               * @returns `{results}` for the caller to return.
               */
              const select = (rows: Row[]) => {
                const repo = binds[0];
                const limit = Number(binds[1] ?? 20);
                const results = rows
                  .filter(r => r.repo_full_name === repo)
                  .sort((a, b) => Number(b.id) - Number(a.id))
                  .slice(0, limit);
                return { results };
              };
              if (/FROM steward_deck_log/i.test(sql)) return select(deckLog);
              if (/FROM steward_merge_ledger/i.test(sql)) return select(mergeLedger);
              throw new Error(`memoryD1: unhandled all(): ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, deckLog, mergeLedger, failing };
}

/**
 * Assemble a Worker Env for tests.
 *
 * WHY DEFAULTS HERE: most tests want a commissioned seat with a working D1;
 * the ones probing degradation override precisely one field, keeping each
 * test's divergence from the happy path visible at its call site.
 *
 * @param over - Field overrides (e.g. `{DB: undefined}` for an unbound seat).
 * @returns A complete Env; STEWARD is a throwing stub unless overridden.
 */
export function makeEnv(over: Partial<Env> = {}): Env {
  return {
    STEWARD: {
      /**
       * Deliberately-throwing namespace stub.
       *
       * WHY THROW INSTEAD OF RETURNING A DUMMY: most tests exercise the seat
       * class directly and must never route through the namespace — a test
       * that does so unintentionally should fail loudly at the exact call,
       * not wander into a silent no-op stub. Worker-gate tests override this
       * with a wired namespace (see steward-do.test.ts).
       *
       * @returns Never — always throws to expose accidental namespace use.
       */
      idFromName(): never {
        throw new Error('makeEnv: override STEWARD to route through the namespace');
      },
    } as unknown as DurableObjectNamespace,
    STEWARD_ADMIN_TOKEN: 'test-token',
    ...over,
  };
}
