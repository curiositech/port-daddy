/**
 * lib/budget-guard.ts — PRE-FLIGHT + MID-FLIGHT spend control.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * The cost-tracker TELLS US what was spent. The budget guard DECIDES what
 * happens NEXT. Two questions, two decisions:
 *
 *   1. canSpawn() — pre-flight. Before we escrow a bond and spin up a
 *      body, does this agent have room in today's budget for a
 *      worst-case charge? If not, the spawn is refused.
 *
 *   2. onCharge() — mid-flight. After cost-tracker records a charge,
 *      is this agent now past a threshold? At 80% we THROTTLE (no new
 *      expensive actions, finish current work). At 100% we CANCEL
 *      (SIGTERM the body, slash the bond, quarantine the agent).
 *
 * This split matches the classic admission-control / back-pressure
 * distinction in systems literature. You admit once, you back-pressure
 * continuously. Conflating the two leads to either (a) letting bad
 * actors past the gate because they "promised" small spend, or
 * (b) refusing every spawn because a past spike is still on the books.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  DAILY BUCKETS (UTC)
 * ════════════════════════════════════════════════════════════════════════
 * Budgets reset at 00:00 UTC. We bucket by `YYYY-MM-DD` TEXT so queries
 * are simple range-free comparisons and debugging via `sqlite3` is
 * readable. Timezones are avoided on purpose — a fleet that spans
 * continents should bill to a single clock.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  USAGE
 * ════════════════════════════════════════════════════════════════════════
 *    const guard = createBudgetGuard(db);
 *
 *    // Pre-flight before spawn:
 *    const ok = guard.canSpawn({
 *      project: 'port-daddy', agentId: 'hawk-3',
 *      budgetUsdPerDay: 1.00, estimatedUsd: 0.15,
 *    });
 *    if (!ok.ok) throw new FleetBlocked(ok.reason);
 *
 *    // Mid-flight on every cost-tracker.record():
 *    const decision = guard.onCharge({
 *      project: 'port-daddy', agentId: 'hawk-3',
 *      budgetUsdPerDay: 1.00, usd: 0.08,
 *    });
 *    if (decision.cancel)     spawner.cancel('hawk-3');
 *    if (decision.throttle) runtime.emit('agent.throttled', 'hawk-3');
 */

import type { Database } from 'better-sqlite3';
import type { ActorSouls } from './actor-souls.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CanSpawnParams {
  project: string;
  agentId: string;
  /** Per-agent daily budget envelope in USD. */
  budgetUsdPerDay: number;
  /** Estimated spend for this one spawn; pre-flight adds this to today's
   *  running total to decide admission. Default 0 (trusting the caller
   *  to charge later via onCharge). */
  estimatedUsd?: number;
  /** Multi-tenant scope for soul resolution (ADR-0040). Defaults to the souls
   *  store's default harbor ('local'). Ignored when no souls store is wired. */
  harbor?: string;
}
export interface CanSpawnDecision {
  ok: boolean;
  reason?: 'budget-exceeded' | 'cancellation-armed';
  spentTodayUsd: number;
  budgetUsdPerDay: number;
}

export interface OnChargeParams {
  project: string;
  agentId: string;
  budgetUsdPerDay: number;
  usd: number;
  /** Multi-tenant scope for soul resolution (ADR-0040). */
  harbor?: string;
}
export interface OnChargeDecision {
  /** True means: SIGTERM the body and slash the bond. */
  cancel: boolean;
  /** True means: don't spawn new expensive work, finish current. */
  throttle: boolean;
  spentTodayUsd: number;
  budgetUsdPerDay: number;
  /** When cancel=true, what tripped it. */
  reason?: 'budget-exceeded';
}

export interface BudgetLedgerRow {
  project: string;
  agentId: string;
  day: string;              // YYYY-MM-DD UTC
  spendUsd: number;
  cancellationArmedAt: number | null;
}

export interface BudgetGuardConfig {
  /** Fraction of daily budget at which to emit throttle.
   *  Default 0.80. Tune per project if needed. */
  throttleThreshold?: number;
  /** Fraction of daily budget at which to emit cancellation.
   *  Default 1.00. Leaving room above 1.0 allows brief overages in
   *  experimental setups; production should stay at 1.00. */
  cancellationThreshold?: number;
}

/**
 * Optional dependencies. Pass a `broadcast` callback to publish every
 * throttle/cancel decision on `budget:decisions` so subscribers (dashboard,
 * IPC, other actors) learn about threshold crossings in real time.
 * Without it, decisions are returned to the caller but unobserved by
 * the rest of the daemon.
 */
export interface BudgetGuardDeps {
  broadcast?: (channel: string, event: Record<string, unknown>) => void;
  /**
   * ADR-0040 spend choke. When wired, budget-guard resolves each `agentId`
   * (a minted actor_id OR a display alias) to a soul + class, SOUL-SOURCES the
   * effective ceiling (a caller may only LOWER, never RAISE, its ceiling above
   * what the soul entitles), and meters newcomers / unknown ids against the
   * SHARED per-project `newcomer_pool` rather than an individual ledger row.
   *
   * The load-bearing anti-launder property: minting N fresh newcomer ids grants
   * ZERO new budget, because they all share one project pool.
   *
   * HONEST LIMIT (do NOT over-claim "Sybil-proof"): this only bites if writes
   * cannot bypass the choke. That requires the `door` lane making the SQLite
   * write-boundary real; until then a same-UID agent can `new Database()` and
   * write a ledger/pool row directly. ADR-0040 non-goal. Backward-compatible:
   * omit this dep and the guard behaves exactly as before (per-agentId ledger).
   */
  souls?: Pick<ActorSouls, 'resolveActor' | 'poolState' | 'chargePool' | 'constants'>;
}

/** Where a given (project, handle) spend is metered and under what ceiling. */
type SpendRoute =
  | { mode: 'ledger'; key: string; ceiling: number }
  | { mode: 'pool'; key: string; ceiling: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get today's bucket key in UTC. Kept tiny so tests can stub `now`. */
export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// ─── Module factory ───────────────────────────────────────────────────────────

export function createBudgetGuard(db: Database, config: BudgetGuardConfig = {}, deps: BudgetGuardDeps = {}) {
  const throttleThreshold = clamp01(config.throttleThreshold ?? 0.80);
  const cancellationThreshold = clamp01(config.cancellationThreshold ?? 1.00);
  const broadcast = deps.broadcast;
  const souls = deps.souls;

  /**
   * ADR-0040 spend choke. Decide WHERE a spend is metered and under what
   * ceiling, given the caller-supplied budget. Steps (design §5):
   *   1. resolve agentId (minted id OR alias) → soul;
   *   2. classify newcomer / graduated / operator / unknown;
   *   3. derive the effective ceiling from the soul, then apply
   *      min(callerBudget, soulCeiling) — a caller may lower but never raise;
   *   4. newcomer/unknown → meter on the SHARED newcomer_pool (mode 'pool');
   *   5. an unknown/un-souled id is treated as a pool-floored newcomer, NEVER
   *      admitted at a caller-supplied above-floor ceiling.
   * With no souls store wired, every spend keeps the legacy per-agentId ledger.
   */
  function routeSpend(project: string, agentId: string, callerBudget: number, harbor?: string): SpendRoute {
    if (!souls) return { mode: 'ledger', key: agentId, ceiling: callerBudget };
    const scope = harbor ?? souls.constants.defaultHarbor;
    const { actorId, soulClass } = souls.resolveActor(agentId, scope);
    if (soulClass === 'newcomer' || soulClass === 'unknown') {
      const poolCeiling = souls.constants.newcomerPoolCeilingUsd;
      // Caller may only lower the pool ceiling, never raise it above the floor.
      const ceiling = callerBudget > 0 ? Math.min(callerBudget, poolCeiling) : poolCeiling;
      return { mode: 'pool', key: actorId, ceiling };
    }
    // graduated / operator: soul entitles the caller-governed ceiling (soulCeiling = ∞).
    return { mode: 'ledger', key: actorId, ceiling: callerBudget };
  }

  /** Safe broadcast: swallow subscriber errors so they never block a
   *  charge from landing. */
  function emit(event: string, payload: Record<string, unknown>): void {
    if (!broadcast) return;
    try { broadcast('budget:decisions', { event, ts: Date.now(), ...payload }); }
    catch { /* no-op */ }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Schema. Individual DDLs via prepare+run (idempotent).
  // Composite PK so per-(project, agent, day) tallies are O(1) lookups.
  // ──────────────────────────────────────────────────────────────────────────
  const runDDL = (sql: string): void => { db.prepare(sql).run(); };

  runDDL(`
    CREATE TABLE IF NOT EXISTS budget_ledger (
      project       TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      day           TEXT NOT NULL,
      spend_usd     REAL NOT NULL DEFAULT 0,
      cancel_armed_at INTEGER,
      PRIMARY KEY (project, agent_id, day)
    )
  `);

  // 3.28 renamed the operator contract from "kill" to "cancel". Migrate the
  // durable ledger before preparing statements so an upgraded daemon can open
  // an existing database without losing the already-armed safety state. The
  // legacy identifier is intentionally confined to this compatibility bridge.
  const ledgerColumns = db.prepare('PRAGMA table_info(budget_ledger)').all() as Array<{ name: string }>;
  const hasCancelArmedAt = ledgerColumns.some((column) => column.name === 'cancel_armed_at');
  const hasLegacyArmedAt = ledgerColumns.some((column) => column.name === 'kill_armed_at');
  if (!hasCancelArmedAt && hasLegacyArmedAt) {
    runDDL('ALTER TABLE budget_ledger RENAME COLUMN kill_armed_at TO cancel_armed_at');
  }

  runDDL(`CREATE INDEX IF NOT EXISTS idx_budget_project_day
            ON budget_ledger(project, day)`);

  const selectRow = db.prepare(`
    SELECT project, agent_id, day, spend_usd, cancel_armed_at
      FROM budget_ledger
     WHERE project = ? AND agent_id = ? AND day = ?
  `);

  // UPSERT: insert-or-accumulate. Single atomic write per charge.
  const upsertSpend = db.prepare(`
    INSERT INTO budget_ledger (project, agent_id, day, spend_usd, cancel_armed_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(project, agent_id, day) DO UPDATE SET
      spend_usd = spend_usd + excluded.spend_usd
  `);

  const armCancellation = db.prepare(`
    UPDATE budget_ledger SET cancel_armed_at = ?
     WHERE project = ? AND agent_id = ? AND day = ?
       AND cancel_armed_at IS NULL
  `);

  // ──────────────────────────────────────────────────────────────────────────
  // Internal read of today's state. Returns {spend, cancellationArmed} for a
  // project+agent in a single SQL round-trip.
  // ──────────────────────────────────────────────────────────────────────────
  function readToday(project: string, agentId: string, day: string): {
    spend: number; cancellationArmed: boolean;
  } {
    const row = selectRow.get(project, agentId, day) as
      | { spend_usd: number; cancel_armed_at: number | null }
      | undefined;
    if (!row) return { spend: 0, cancellationArmed: false };
    return { spend: row.spend_usd, cancellationArmed: row.cancel_armed_at !== null };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Pre-flight check before spawn. Returns admission decision.
   *
   * Three ways this says no:
   *   - `cancellation-armed` — today's cancellation trigger already fired; no new
   *                         spawns for this agent until tomorrow 00:00 UTC.
   *   - `budget-exceeded` — spent + estimated > budget. We admit only if
   *                         there's room for the worst case.
   *   - budgetUsdPerDay=0 — treat as "not allowed to spawn" (configured off).
   *
   * @example
   *   const d = guard.canSpawn({
   *     project: 'port-daddy', agentId: 'hawk-3',
   *     budgetUsdPerDay: 1.00, estimatedUsd: 0.15,
   *   });
   *   if (!d.ok) console.log(`refused: ${d.reason} (spent ${d.spentTodayUsd})`);
   */
  function canSpawn(params: CanSpawnParams): CanSpawnDecision {
    const { project, agentId, budgetUsdPerDay } = params;
    const estimatedUsd = Math.max(0, params.estimatedUsd ?? 0);
    const day = utcDay();
    const route = routeSpend(project, agentId, budgetUsdPerDay, params.harbor);

    // Newcomer / unknown: admission is metered against the SHARED project pool,
    // NOT an individual ledger row. Minting fresh ids buys no headroom here.
    if (route.mode === 'pool' && souls) {
      const spend = souls.poolState(project, day).spendUsd;
      if (route.ceiling <= 0) {
        return { ok: false, reason: 'budget-exceeded', spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
      }
      if (spend + estimatedUsd > route.ceiling) {
        return { ok: false, reason: 'budget-exceeded', spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
      }
      return { ok: true, spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
    }

    // Graduated / operator / no-souls-store: legacy per-key ledger path.
    const { spend, cancellationArmed } = readToday(project, route.key, day);
    if (cancellationArmed) {
      return { ok: false, reason: 'cancellation-armed', spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
    }
    if (route.ceiling <= 0) {
      return { ok: false, reason: 'budget-exceeded', spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
    }
    if (spend + estimatedUsd > route.ceiling) {
      return { ok: false, reason: 'budget-exceeded', spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
    }
    return { ok: true, spentTodayUsd: spend, budgetUsdPerDay: route.ceiling };
  }

  /**
   * Record a charge and decide what happens next. Call this from inside
   * cost-tracker's record hook OR from whatever pipeline observes actual
   * spend. Returns cancel/throttle decisions — the CALLER is responsible
   * for acting on them (we're pure, no side effects beyond the ledger
   * write).
   *
   * Arms cancel_armed_at IDEMPOTENTLY: second breach doesn't re-arm, so
   * concurrent readers all see the same "armed at" timestamp. This is
   * important for audit log ordering.
   *
   * @example
   *   const d = guard.onCharge({
   *     project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, usd: 0.30,
   *   });
   *   // if spent was $0.60 before: now $0.90 → throttle
   *   // if spent was $0.80 before: now $1.10 → cancel
   */
  function onCharge(params: OnChargeParams): OnChargeDecision {
    const { project, agentId, budgetUsdPerDay } = params;
    const usd = Number.isFinite(params.usd) ? Math.max(0, params.usd) : 0;
    const day = utcDay();
    const route = routeSpend(project, agentId, budgetUsdPerDay, params.harbor);

    // Newcomer / unknown: meter against the SHARED project pool. Every
    // uncredentialed newcomer in a project accumulates into ONE row, so N mints
    // cannot multiply the per-project budget (the Sybil-reset launder is closed).
    if (route.mode === 'pool' && souls) {
      const spend = souls.chargePool(project, day, usd);
      const ceiling = route.ceiling;
      if (ceiling <= 0) {
        return { cancel: true, throttle: true, spentTodayUsd: spend, budgetUsdPerDay: ceiling, reason: 'budget-exceeded' };
      }
      const pctPool = spend / ceiling;
      const cancelPool = pctPool >= cancellationThreshold;
      const throttlePool = pctPool >= throttleThreshold;
      if (cancelPool) {
        emit('cancel', { project, agentId: route.key, pool: true, spentTodayUsd: spend, budgetUsdPerDay: ceiling });
      } else if (throttlePool) {
        emit('throttle', { project, agentId: route.key, pool: true, spentTodayUsd: spend, budgetUsdPerDay: ceiling });
      }
      return {
        cancel: cancelPool, throttle: throttlePool,
        spentTodayUsd: spend, budgetUsdPerDay: ceiling,
        ...(cancelPool ? { reason: 'budget-exceeded' as const } : {}),
      };
    }

    // Graduated / operator / no-souls-store: legacy per-key ledger path.
    // Accumulate in one atomic write, then re-read to decide.
    upsertSpend.run(project, route.key, day, usd);
    const { spend, cancellationArmed } = readToday(project, route.key, day);
    const effectiveBudget = route.ceiling;

    if (effectiveBudget <= 0) {
      return { cancel: true, throttle: true, spentTodayUsd: spend, budgetUsdPerDay: effectiveBudget, reason: 'budget-exceeded' };
    }

    const pct = spend / effectiveBudget;
    const cancel = pct >= cancellationThreshold;
    const throttle = pct >= throttleThreshold;

    if (cancel && !cancellationArmed) {
      armCancellation.run(Date.now(), project, route.key, day);
      // Fire a CANCEL only the first time per day. Subsequent charges
      // against an already-armed agent stay quiet on the wire — the
      // throttle stream covers downstream visibility.
      emit('cancel', { project, agentId: route.key, spentTodayUsd: spend, budgetUsdPerDay: effectiveBudget });
    } else if (throttle && !cancel) {
      // Emit throttle every time we're in the window so subscribers
      // can trace back-pressure cleanly. Cheap (≤5 messages/hour per
      // agent, usually).
      emit('throttle', { project, agentId: route.key, spentTodayUsd: spend, budgetUsdPerDay: effectiveBudget });
    }

    return {
      cancel, throttle,
      spentTodayUsd: spend,
      budgetUsdPerDay: effectiveBudget,
      ...(cancel ? { reason: 'budget-exceeded' as const } : {}),
    };
  }

  /**
   * Read today's spend for a specific agent. Read-only — does not
   * allocate the row. Returns 0 if nothing charged yet today.
   *
   * @example
   *   const spent = guard.getSpendToday('port-daddy', 'hawk-3');
   *   // 0.82
   */
  function getSpendToday(project: string, agentId: string): number {
    return readToday(project, agentId, utcDay()).spend;
  }

  /**
   * Get the full ledger row for today (project, agent, day, spend,
   * cancellationArmedAt). Null if no activity today.
   */
  function getLedger(project: string, agentId: string, day?: string): BudgetLedgerRow | null {
    const d = day ?? utcDay();
    const row = selectRow.get(project, agentId, d) as
      | { project: string; agent_id: string; day: string;
          spend_usd: number; cancel_armed_at: number | null }
      | undefined;
    if (!row) return null;
    return {
      project: row.project,
      agentId: row.agent_id,
      day: row.day,
      spendUsd: row.spend_usd,
      cancellationArmedAt: row.cancel_armed_at,
    };
  }

  /**
   * List all agents for a project today, sorted by spend descending.
   * Handy for the FleetControl panel and the `pd fleet status` CLI.
   */
  function listToday(project: string): BudgetLedgerRow[] {
    const day = utcDay();
    const rows = db.prepare(`
      SELECT project, agent_id, day, spend_usd, cancel_armed_at
        FROM budget_ledger
       WHERE project = ? AND day = ?
       ORDER BY spend_usd DESC
    `).all(project, day) as Array<{
      project: string; agent_id: string; day: string;
      spend_usd: number; cancel_armed_at: number | null;
    }>;
    return rows.map((r) => ({
      project: r.project, agentId: r.agent_id, day: r.day,
      spendUsd: r.spend_usd, cancellationArmedAt: r.cancel_armed_at,
    }));
  }

  return {
    canSpawn,
    onCharge,
    getSpendToday,
    getLedger,
    listToday,
    /** Exposed for tests that want to reason about thresholds. */
    thresholds: { throttle: throttleThreshold, cancel: cancellationThreshold },
  };
}

export type BudgetGuard = ReturnType<typeof createBudgetGuard>;

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1.5, x)); // allow > 1.0 for experimental overhead
}
