/**
 * MERCY HOOKS — per-feature observability made real
 * (grand-plan DAG node x7-mercy-hooks; plan §X7 + the §4 hook-index table).
 *
 * Mercy v1 (src/mercy.ts) probes INFRASTRUCTURE — D1, KV, the channel DO, the
 * queue binding. This module is the other half it deliberately cut: the
 * PER-FEATURE hooks every shipped feature declared in the plan's §4 table and
 * then deferred. Three mechanisms:
 *
 *   1. HOOK LEDGER (`mercy_hook_events`) — hot paths append one small row per
 *      signal (a quota refusal on the publish path, a reconciliation gap on
 *      the run-report path). {@link recordHookEvent} NEVER throws: a hook
 *      failure must never disturb the path it observes.
 *
 *   2. HOOK COMPUTATION ({@link computeFeatureHooks}) — the MERCY sweep calls
 *      this once per fire; each hook runs one bounded D1 aggregate and yields
 *      a three-valued-plus-unknown verdict. THE VERDICT LAW: `unknown` is a
 *      real state and it NEVER renders green — a hook whose table is missing
 *      or whose signal has no samples says so, honestly, instead of implying
 *      health it cannot see (the observability-absences audit applied to the
 *      auditor itself). Results ride the mercy_health snapshot (hooks_json),
 *      so the status surfaces stay split-plane: cron writes, pages read.
 *
 *   3. SLO BURN WINDOWS (`mercy_slo_windows`) — index.ts samples every
 *      response into 5-minute buckets via ctx.waitUntil (off the response
 *      path; 5xx only count as errors — a caller's 4xx is not the relay's
 *      unavailability). The sweep computes classic multiwindow burn (fast 1h
 *      / slow 6h against a 99.9% availability target): both windows burning
 *      ≥14x is red, the fast window alone is yellow.
 *
 * Hooks emitted here, mapped to the plan's §4 table (shipped features only):
 *   X2  `x2_remote_harbors`      registry verdict (canary honestly `unknown`)
 *   X3  `x3_stale_helm`          vacant-flagged helms → warn
 *   X3  `x3_helm_contention`     dead-man passes/vacancies in 24h
 *   X4  `x4_summons_ack`         summons-ack SLO (plan gate: ack-rate ≥ 90%)
 *   X4  `x4_parley_fatigue`      max summonses per party per 24h
 *   X8  `x8_quota_exhaustion`    enforced 429s per 24h (ledger-fed)
 *   X8  `x8_shadow_delta`        shadow would-have-denied per 24h (the flip signal)
 *   N3  `hitl_interruptions`     open asks + asks that expired unanswered
 *   X7  `squid_reconciliation`   run-concluded claimed-vs-received gaps
 *   X7  `slo_burn`               multiwindow error-budget burn
 *
 * Consciously NOT here (named in the PR body, not silently absent):
 * X2 invite-replay (single-use invite JTIs are themselves deferred from
 * harbors v1 — there is no invite to replay), the X7 circuit breaker's
 * propose-and-page path, and daemon vitals-reports (severable per the node).
 */

import type { Env } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Hook verdicts extend Mercy's traffic light with an honest fourth state.
 * `unknown` = "this signal exists but cannot currently be measured" (missing
 * table, zero samples, unshipped canary). It renders muted, never green.
 */
export type HookStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface FeatureHook {
  /** Stable machine name, e.g. 'x4_summons_ack'. */
  name: string;
  status: HookStatus;
  /** The one headline number for the hook, or null when there is none. */
  metric: number | null;
  /** Operator-facing explanation. Shown on /account/mercy, NOT on public /mercy. */
  detail: string;
}

// ── Tuning (all windows in seconds unless noted) ──────────────────────────────

/** A daemon summons should be acknowledged within this (X4 ack SLO). */
export const SUMMONS_ACK_SLO_SECONDS = 15 * 60;
/** The plan's §4 gate for X4: summons ack-rate ≥ 90%. */
export const SUMMONS_ACK_RATE_TARGET = 0.9;
/** Below this the ack machinery is not degraded, it is broken. */
const SUMMONS_ACK_RATE_RED = 0.5;
const SUMMONS_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** More summonses than this to ONE party in 24h = fatigue warn / red. */
export const FATIGUE_YELLOW_PER_DAY = 6;
export const FATIGUE_RED_PER_DAY = 12;

const DAY_SECONDS = 24 * 60 * 60;

/** SLO burn: availability target 99.9% → error budget 0.1%. */
export const SLO_ERROR_BUDGET = 0.001;
/** Classic multiwindow burn-rate alert threshold. */
export const SLO_BURN_THRESHOLD = 14;
export const SLO_FAST_WINDOW_SECONDS = 60 * 60;
export const SLO_SLOW_WINDOW_SECONDS = 6 * 60 * 60;
/** SLO sample bucket width — one row per 5 minutes, bounded cardinality. */
export const SLO_BUCKET_SECONDS = 300;

const RECONCILIATION_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/** Retention: hook/reconciliation rows 30d, SLO buckets 7d. */
const HOOK_EVENT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const RECONCILIATION_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const SLO_WINDOW_RETENTION_SECONDS = 7 * 24 * 60 * 60;

// ── Emission (hot-path safe) ──────────────────────────────────────────────────

/**
 * Append one hook signal to the ledger. NEVER throws and never rejects —
 * callers sit on the publish and run-report hot paths, and a hook failure
 * must never disturb the path it observes. Best-effort by contract.
 */
export async function recordHookEvent(
  db: D1Database,
  hook: string,
  severity: 'info' | 'warn' | 'crit',
  detail: string,
  at: number,
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO mercy_hook_events (at, hook, severity, detail) VALUES (?, ?, ?, ?)')
      .bind(at, hook, severity, detail)
      .run();
  } catch {
    // Ledger unavailable (migration not applied, D1 down) — the observed
    // path must proceed; the sweep's aggregate hook will read `unknown`.
  }
}

/**
 * Record one response into the current 5-minute SLO bucket. NEVER throws —
 * it rides ctx.waitUntil after the response has already been returned.
 * `isError` means HTTP 5xx: the relay burning its own budget, not a caller's
 * 4xx.
 */
export async function recordSloSample(
  db: D1Database | undefined,
  nowMs: number,
  isError: boolean,
): Promise<void> {
  if (!db) return;
  const windowStart = Math.floor(nowMs / 1000 / SLO_BUCKET_SECONDS) * SLO_BUCKET_SECONDS;
  try {
    await db
      .prepare(
        `INSERT INTO mercy_slo_windows (window_start, requests, errors) VALUES (?, 1, ?)
         ON CONFLICT(window_start) DO UPDATE SET
           requests = requests + 1, errors = errors + excluded.errors`,
      )
      .bind(windowStart, isError ? 1 : 0)
      .run();
  } catch {
    // Sampling is best-effort; a lost sample under-counts burn, and the
    // slo_burn hook goes `unknown` (not green) when there are no samples.
  }
}

// ── Per-feature hook computation ──────────────────────────────────────────────

const unknownHook = (name: string, why: string): FeatureHook => ({
  name,
  status: 'unknown',
  metric: null,
  detail: why,
});

/**
 * X4: summons-ack SLO. Source of truth is the mediator's `parley_summonses`
 * ledger (migration 2026-08-09-mediator-body.sql). A summons is DECIDED when
 * the daemon responded (any state past 'summoned') or when it has sat
 * unacknowledged past the ack SLO; the rate is acks-within-SLO over decided.
 * Plan §4 gate: ack-rate ≥ 90%.
 */
async function hookSummonsAck(db: D1Database, now: number): Promise<FeatureHook> {
  const name = 'x4_summons_ack';
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN state != 'summoned' THEN 1 ELSE 0 END) AS responded,
                SUM(CASE WHEN state = 'acked' AND responded_at IS NOT NULL
                          AND responded_at - issued_at <= ? THEN 1 ELSE 0 END) AS acked_in_slo,
                SUM(CASE WHEN state = 'summoned' AND ? - issued_at > ? THEN 1 ELSE 0 END) AS overdue
         FROM parley_summonses WHERE issued_at >= ?`,
      )
      .bind(SUMMONS_ACK_SLO_SECONDS, now, SUMMONS_ACK_SLO_SECONDS, now - SUMMONS_WINDOW_SECONDS)
      .first<{ total: number; responded: number | null; acked_in_slo: number | null; overdue: number | null }>();
    const responded = row?.responded ?? 0;
    const ackedInSlo = row?.acked_in_slo ?? 0;
    const overdue = row?.overdue ?? 0;
    const decided = responded + overdue;
    if (decided === 0) {
      return unknownHook(name, 'no decided summonses in 7d — ack SLO unmeasured');
    }
    const rate = ackedInSlo / decided;
    const pct = Math.round(rate * 100);
    const status: HookStatus =
      rate >= SUMMONS_ACK_RATE_TARGET ? 'green' : rate >= SUMMONS_ACK_RATE_RED ? 'yellow' : 'red';
    return {
      name,
      status,
      metric: pct,
      detail: `${ackedInSlo}/${decided} summonses acked within ${SUMMONS_ACK_SLO_SECONDS / 60}min over 7d (${pct}%; target ≥ ${SUMMONS_ACK_RATE_TARGET * 100}%; ${overdue} overdue unacked)`,
    };
  } catch {
    return unknownHook(name, 'parley_summonses unreadable — summons-ack SLO unmeasured');
  }
}

/**
 * X4: parley fatigue — the most-summoned single party in the last 24h. A
 * mediator that keeps waking the same daemon (or human) is itself a health
 * problem, whatever the ack rate says.
 */
async function hookParleyFatigue(db: D1Database, now: number): Promise<FeatureHook> {
  const name = 'x4_parley_fatigue';
  try {
    const row = await db
      .prepare(
        `SELECT party_label, COUNT(*) AS n FROM parley_summonses
         WHERE issued_at >= ? GROUP BY party_kind, party_id
         ORDER BY n DESC LIMIT 1`,
      )
      .bind(now - DAY_SECONDS)
      .first<{ party_label: string; n: number }>();
    const worst = row?.n ?? 0;
    if (worst === 0) {
      return { name, status: 'green', metric: 0, detail: 'no summonses issued in 24h' };
    }
    const status: HookStatus =
      worst >= FATIGUE_RED_PER_DAY ? 'red' : worst >= FATIGUE_YELLOW_PER_DAY ? 'yellow' : 'green';
    return {
      name,
      status,
      metric: worst,
      detail: `most-summoned party in 24h: '${row?.party_label ?? '?'}' × ${worst} (warn ≥ ${FATIGUE_YELLOW_PER_DAY}, red ≥ ${FATIGUE_RED_PER_DAY})`,
    };
  } catch {
    return unknownHook(name, 'parley_summonses unreadable — fatigue unmeasured');
  }
}

/**
 * X3: stale helm. A vacant-FLAGGED helm is a harbor whose authority record
 * emptied through the dead-man rule with no present successor — a standing
 * `warn` until an owner re-points it.
 */
async function hookStaleHelm(db: D1Database): Promise<FeatureHook> {
  const name = 'x3_stale_helm';
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM harbor_helms WHERE vacant_flagged = 1')
      .first<{ n: number }>();
    const n = row?.n ?? 0;
    return {
      name,
      status: n > 0 ? 'yellow' : 'green',
      metric: n,
      detail:
        n > 0
          ? `${n} helm(s) vacant-flagged by the dead-man rule — an owner must re-point them`
          : 'no vacant-flagged helms',
    };
  } catch {
    return unknownHook(name, 'harbor_helms unreadable — stale-helm signal unmeasured');
  }
}

/**
 * X3: helm contention — dead-man transitions in the last 24h. Every pass or
 * vacancy is an authority record changing WITHOUT an owner's hand; more than
 * zero in a day deserves eyes.
 */
async function hookHelmContention(db: D1Database, now: number): Promise<FeatureHook> {
  const name = 'x3_helm_contention';
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM helm_events
         WHERE kind IN ('dead_man_pass','dead_man_vacant') AND at >= ?`,
      )
      .bind(now - DAY_SECONDS)
      .first<{ n: number }>();
    const n = row?.n ?? 0;
    return {
      name,
      status: n > 0 ? 'yellow' : 'green',
      metric: n,
      detail:
        n > 0
          ? `${n} dead-man helm transition(s) in 24h — holders going silent past grace`
          : 'no dead-man helm transitions in 24h',
    };
  } catch {
    return unknownHook(name, 'helm_events unreadable — contention signal unmeasured');
  }
}

/**
 * X2: remote-harbors verdict. HONEST unknown: the plan's per-harbor verdict
 * is gated on a canary round-trip that is not yet shipped, so with harbors
 * registered the only truthful verdict is `unknown` — liveness unproven,
 * never implied. Zero registered harbors is a measured green (nothing to
 * verify), not an unknown.
 */
async function hookRemoteHarbors(db: D1Database): Promise<FeatureHook> {
  const name = 'x2_remote_harbors';
  try {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM harbors').first<{ n: number }>();
    const n = row?.n ?? 0;
    if (n === 0) {
      return { name, status: 'green', metric: 0, detail: 'no remote harbors registered — nothing to verify' };
    }
    return {
      name,
      status: 'unknown',
      metric: n,
      detail: `${n} harbor(s) registered; per-harbor canary round-trip not yet shipped (X2 v2) — liveness unproven`,
    };
  } catch {
    return unknownHook(name, 'harbors unreadable — remote-harbors verdict unmeasured');
  }
}

/**
 * X8: quota exhaustion + shadow delta, from the hook ledger the publish path
 * feeds (handlers.ts). Two hooks from one query: enforced 429s (exhaustion)
 * and shadow would-have-denied events (the enforcement-flip signal the plan
 * requires be published BEFORE any flip).
 */
async function hooksQuota(db: D1Database, now: number): Promise<FeatureHook[]> {
  try {
    const row = await db
      .prepare(
        `SELECT SUM(CASE WHEN hook = 'x8_quota_exhausted' THEN 1 ELSE 0 END) AS exhausted,
                SUM(CASE WHEN hook = 'x8_quota_shadow_denied' THEN 1 ELSE 0 END) AS shadow_denied
         FROM mercy_hook_events WHERE at >= ?`,
      )
      .bind(now - DAY_SECONDS)
      .first<{ exhausted: number | null; shadow_denied: number | null }>();
    const exhausted = row?.exhausted ?? 0;
    const shadowDenied = row?.shadow_denied ?? 0;
    return [
      {
        name: 'x8_quota_exhaustion',
        status: exhausted > 0 ? 'yellow' : 'green',
        metric: exhausted,
        detail:
          exhausted > 0
            ? `${exhausted} publish(es) refused 429 QUOTA_EXHAUSTED in 24h — a harbor is out of budget`
            : 'no enforced budget refusals in 24h',
      },
      {
        name: 'x8_shadow_delta',
        status: shadowDenied > 0 ? 'yellow' : 'green',
        metric: shadowDenied,
        detail:
          shadowDenied > 0
            ? `${shadowDenied} event(s) in 24h passed in shadow that enforcement WOULD refuse — review before any flip`
            : 'shadow-vs-enforce delta is zero in 24h',
      },
    ];
  } catch {
    return [
      unknownHook('x8_quota_exhaustion', 'mercy_hook_events unreadable — exhaustion signal unmeasured'),
      unknownHook('x8_shadow_delta', 'mercy_hook_events unreadable — shadow delta unmeasured'),
    ];
  }
}

/**
 * N3/HITL: interruptions. The open count already rides /mercy; the hook adds
 * the failure signal — asks that EXPIRED unanswered in the last 24h (the nag
 * engine gave up on a human who never came).
 */
async function hookInterruptions(db: D1Database, now: number): Promise<FeatureHook> {
  const name = 'hitl_interruptions';
  try {
    const row = await db
      .prepare(
        `SELECT SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN state = 'expired' AND closed_at >= ? THEN 1 ELSE 0 END) AS expired
         FROM operator_interruptions`,
      )
      .bind(now - DAY_SECONDS)
      .first<{ open: number | null; expired: number | null }>();
    const open = row?.open ?? 0;
    const expired = row?.expired ?? 0;
    return {
      name,
      status: expired > 0 ? 'yellow' : 'green',
      metric: open,
      detail:
        expired > 0
          ? `${open} open ask(s); ${expired} expired UNANSWERED in 24h — blocking questions died waiting`
          : `${open} open ask(s); none expired unanswered in 24h`,
    };
  } catch {
    return unknownHook(name, 'operator_interruptions unreadable — HITL signal unmeasured');
  }
}

/**
 * X7 slice 2: run-concluded reconciliation summary. Reads the rows the
 * run-report route writes (src/run-report.ts). `unknown` while no run has
 * reported — fire-and-forget loss is exactly the thing that cannot be
 * assumed zero without evidence.
 */
async function hookSquidReconciliation(db: D1Database, now: number): Promise<FeatureHook> {
  const name = 'squid_reconciliation';
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS runs,
                SUM(CASE WHEN gap != 0 THEN 1 ELSE 0 END) AS gapped,
                SUM(CASE WHEN gap > 0 THEN gap ELSE 0 END) AS lost
         FROM squid_run_reconciliation WHERE reported_at >= ?`,
      )
      .bind(now - RECONCILIATION_WINDOW_SECONDS)
      .first<{ runs: number; gapped: number | null; lost: number | null }>();
    const runs = row?.runs ?? 0;
    if (runs === 0) {
      return unknownHook(name, 'no executor run reports in 7d — event loss unmeasured (not assumed zero)');
    }
    const gapped = row?.gapped ?? 0;
    const lost = row?.lost ?? 0;
    return {
      name,
      status: gapped > 0 ? 'yellow' : 'green',
      metric: lost,
      detail:
        gapped > 0
          ? `${gapped}/${runs} run(s) in 7d show a claimed-vs-received gap (${lost} event(s) lost) — fire-and-forget loss made visible`
          : `${runs} run(s) reconciled in 7d, zero gaps`,
    };
  } catch {
    return unknownHook(name, 'squid_run_reconciliation unreadable — event loss unmeasured');
  }
}

/**
 * X7 slice 3: multiwindow SLO burn. Availability target 99.9%; burn = the
 * multiple of the error budget the window is consuming. Both windows ≥ 14x is
 * red (budget gone within hours); the fast window alone is yellow (spike,
 * possibly transient); no samples is `unknown`, never green.
 */
async function hookSloBurn(db: D1Database, now: number): Promise<FeatureHook> {
  const name = 'slo_burn';
  const windowRate = async (seconds: number): Promise<{ req: number; err: number }> => {
    const row = await db
      .prepare('SELECT SUM(requests) AS req, SUM(errors) AS err FROM mercy_slo_windows WHERE window_start >= ?')
      .bind(now - seconds)
      .first<{ req: number | null; err: number | null }>();
    return { req: row?.req ?? 0, err: row?.err ?? 0 };
  };
  try {
    const [fast, slow] = await Promise.all([
      windowRate(SLO_FAST_WINDOW_SECONDS),
      windowRate(SLO_SLOW_WINDOW_SECONDS),
    ]);
    if (slow.req === 0) {
      return unknownHook(name, 'no request samples in 6h — burn unmeasured');
    }
    const fastBurn = fast.req === 0 ? 0 : fast.err / fast.req / SLO_ERROR_BUDGET;
    const slowBurn = slow.err / slow.req / SLO_ERROR_BUDGET;
    const status: HookStatus =
      fastBurn >= SLO_BURN_THRESHOLD && slowBurn >= SLO_BURN_THRESHOLD
        ? 'red'
        : fastBurn >= SLO_BURN_THRESHOLD
          ? 'yellow'
          : 'green';
    return {
      name,
      status,
      metric: Math.round(fastBurn * 10) / 10,
      detail: `burn ×${fastBurn.toFixed(1)} (1h) / ×${slowBurn.toFixed(1)} (6h) of the 99.9% error budget; alert ≥ ×${SLO_BURN_THRESHOLD} (${slow.err}/${slow.req} 5xx in 6h)`,
    };
  } catch {
    return unknownHook(name, 'mercy_slo_windows unreadable — burn unmeasured');
  }
}

/**
 * Compute every per-feature hook. Each hook is individually fenced: an
 * unreadable table yields that hook as `unknown` with the reason, never a
 * throw and never a silent omission — the returned array ALWAYS contains
 * every declared hook.
 */
export async function computeFeatureHooks(env: Env, now: number): Promise<FeatureHook[]> {
  const db = env.DB;
  const [summonsAck, fatigue, staleHelm, contention, remoteHarbors, quota, interruptions, reconciliation, sloBurn] =
    await Promise.all([
      hookSummonsAck(db, now),
      hookParleyFatigue(db, now),
      hookStaleHelm(db),
      hookHelmContention(db, now),
      hookRemoteHarbors(db),
      hooksQuota(db, now),
      hookInterruptions(db, now),
      hookSquidReconciliation(db, now),
      hookSloBurn(db, now),
    ]);
  return [summonsAck, fatigue, staleHelm, contention, remoteHarbors, ...quota, interruptions, reconciliation, sloBurn];
}

/**
 * The worst status across hooks, for the one-line summary. Ordering:
 * green < unknown < yellow < red — an unmeasured signal is WORSE than a
 * measured-healthy one (it never renders green) but does not outrank a
 * measured problem.
 */
export function worstHookStatus(hooks: FeatureHook[]): HookStatus {
  const rank: Record<HookStatus, number> = { green: 0, unknown: 1, yellow: 2, red: 3 };
  let worst: HookStatus = 'green';
  for (const h of hooks) {
    if (rank[h.status] > rank[worst]) worst = h.status;
  }
  return worst;
}

/** Parse a stored hooks_json; malformed / pre-migration rows yield []. */
export function parseHooks(json: string | null | undefined): FeatureHook[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: FeatureHook[] = [];
    for (const x of arr) {
      if (
        typeof x === 'object' && x !== null &&
        typeof (x as FeatureHook).name === 'string' &&
        ['green', 'yellow', 'red', 'unknown'].includes((x as FeatureHook).status)
      ) {
        const h = x as FeatureHook;
        out.push({
          name: h.name,
          status: h.status,
          metric: typeof h.metric === 'number' ? h.metric : null,
          detail: typeof h.detail === 'string' ? h.detail : '',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Bounded growth for the hook tables, called from the MERCY sweep. Fenced
 * per-table and silent on failure: on a deployment where the additive
 * migration has not landed yet these tables do not exist, and their absence
 * is already reported (as `unknown` hooks) — a prune error would only repeat
 * the same fact as noise.
 */
export async function pruneHookTables(db: D1Database, now: number): Promise<void> {
  const runs: Array<{ sql: string; bound: number }> = [
    { sql: 'DELETE FROM mercy_hook_events WHERE at < ?', bound: now - HOOK_EVENT_RETENTION_SECONDS },
    { sql: 'DELETE FROM squid_run_reconciliation WHERE reported_at < ?', bound: now - RECONCILIATION_RETENTION_SECONDS },
    { sql: 'DELETE FROM mercy_slo_windows WHERE window_start < ?', bound: now - SLO_WINDOW_RETENTION_SECONDS },
  ];
  for (const r of runs) {
    try {
      await db.prepare(r.sql).bind(r.bound).run();
    } catch {
      // Table absent or D1 hiccup — tolerated; see docstring.
    }
  }
}
