/**
 * The Reconcile Loop — daemon → Ink Cloud projection (ADR-0108 / ADR-0051 phase 0)
 * ================================================================================
 *
 * Motivation: the Ink Cloud matrix (`lib/squid/matrix.ts`) is the hot cache the
 * shell tentacles grep each turn, but until this loop existed NOTHING projected
 * durable daemon state into it — `PD_INBOX_*`, `PD_PARLEY_*`, `PD_CLAIM_*`,
 * `PD_CI_*`, `PD_HALT` were written by nobody, raw shell pheromone appends grew
 * the file forever, and the enforced pre-tool gate checked key families the
 * daemon never populated. This module is the single owner of every projected
 * key class: each tick it computes the FULL desired state, applies it in one
 * lock/one atomic rename via `applyProjection` (draining raw pheromone appends
 * under the same lock), and refreshes `PD_RECON_HEARTBEAT_TS` so every reader
 * can fail OPEN the moment the daemon dies (staleness > PD_RECON_STALE_MS).
 *
 * Design doctrine applied:
 *  - One owner per matrix key class (the approvals alert migrated here from
 *    fleet-daemon's inline syncApprovalAlert — byte-compatible message).
 *  - Advisory-first: the loop only writes hints; enforcement (the pre-tool HALT
 *    rung) is dial-gated and fails open on a stale heartbeat.
 *  - No DB work under the matrix lock: gather (phase 1) and drain-ingest
 *    (phase 3) happen outside the lock; only the map rewrite holds it.
 *  - A projection bug must never kill the daemon: the entire tick is wrapped
 *    in try/catch → logger.warn. Degraded coordination beats a dead loop.
 *
 * CI honesty note: the PD_CI_* latch is PROCESS MEMORY fed by
 * `github:webhook:workflow_run` / `check_suite` events. After a daemon restart
 * the latch is empty until the next webhook arrives — degraded-but-honest, and
 * every latched entry carries a 6h ceiling so nothing is immortal.
 *
 * Retention: drained pheromones land in the durable `ink_pheromones` table,
 * bounded three ways — read-time decay prune (eff < 0.01 deleted on query),
 * a 7-day max-age policy on updated_at, and a 500-row cap (both registered in
 * lib/observability/maintenance.ts per the db-retention doctrine).
 */

import type Database from 'better-sqlite3';
import {
  applyProjection,
  keySuffix,
  inboxKey,
  parleyKey,
  HALT_KEY,
  RECON_HEARTBEAT_KEY,
  RECON_OWNED_PREFIXES,
  escapeValue,
} from './matrix.js';
import { getSharedApprovalStream } from '../fleet/approval-stream.js';
import { detectClaimOverlaps, type ActiveClaim } from '../suggestion-broker.js';
import { decayedValue, type PheromoneConfig } from '../pheromone.js';

// ─── Deps ────────────────────────────────────────────────────────────────────

/** One attention item as returned by lib/attention.ts compose(). Structural
 *  subset — only the fields the projection renders. */
interface AttentionItemLike {
  from?: string | null;
  type?: string | null;
  channel?: string | null;
  content?: unknown;
  receivedAt?: number;
}

/** Tuple row subset (lib/tuples.ts Tuple). */
interface TupleLike {
  fields: unknown[];
  createdAt: number;
  expiresAt: number | null;
}

export interface ReconcileDeps {
  /**
   * Session surface: enumerate live actors and their active claims. Actor id =
   * session.agentId (fallback session.id). NOTE (spec deviation, recorded):
   * lib/sessions.ts exposes active sessions through `list({status:'active',
   * allWorktrees:true, limit})`, not a bare `listActive(limit)` — we consume
   * the real API. `allWorktrees: true` is load-bearing: the daemon's cwd is not
   * an agent worktree, and the default worktree filter would hide every actor.
   */
  sessions: {
    listAllActiveClaims(): { success: boolean; claims: ActiveClaim[] };
    list(options: {
      status?: string;
      limit?: number;
      allWorktrees?: boolean;
    }): { success: boolean; sessions: Array<Record<string, unknown>> };
  };
  /**
   * lib/attention.ts createAttention return. compose(actor,{peek:true,limit:3})
   * — peek is LOAD-BEARING: projection must NOT advance cursors or mark-read;
   * consumption happens when the agent actually reads via pd attention/inbox.
   */
  attention: {
    compose(
      agentId: string,
      options?: { peek?: boolean; limit?: number },
    ): { success: boolean; items: AttentionItemLike[] };
  };
  /** Tuple space reader — parley:summons projection source. */
  tuples: { rd(pattern: unknown[], options?: { limit?: number }): TupleLike[] };
  /** Pub/sub for the event fast-paths (panic/unpanic/CI webhooks). */
  messaging: {
    subscribe(channel: string, cb: (msg: unknown) => void): (() => void) | null;
  };
  /** routes/panic.ts module-level state readers (same process). */
  isPanicArmed(): boolean;
  getPanicState?(): { armed?: boolean; reason?: string; armedBy?: string; armedAt?: number };
  /** Daemon DB — hosts the durable ink_pheromones drain target. */
  db: Database.Database;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Optional per-fleet matrix shard. W1 scope: global matrix only. */
  fleet?: string;
  /** Tick cadence; default PD_RECONCILE_INTERVAL_MS || 15_000. */
  intervalMs?: number;
  /** Documented staleness horizon (readers enforce it, not this loop). */
  staleMs?: number;
}

export interface ReconcileLoop {
  start(): void;
  stop(): void;
  /** Coalesced immediate pass (event fast-path). */
  poke(reason: string): void;
  /** Test hook: run one synchronous tick right now. */
  tickNow(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const APPROVALS_ALERT_KEY = 'PD_ALERT_FLEET_APPROVALS';
const MAX_ACTORS_PER_TICK = 25;
const INBOX_SLOTS_PER_ACTOR = 3;
const PARLEY_PER_ACTOR = 2;
const CLAIM_OVERLAP_TOP = 5;
const PHEROMONE_TOP = 5;
const CI_RED_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const BUDGET_BYTES = 4096;
const POKE_COALESCE_MS = 500;
const PHEROMONE_CFG: PheromoneConfig = { decayRate: 0.95, intervalMs: 60_000 };

/** Durable drain target for raw shell pheromone appends. Kept separate from
 *  pheromone.ts's entity-metadata engine (that one is keyed to
 *  services/projects/sessions rows, which file-subjects are not); we reuse its
 *  DECAY SEMANTICS via decayedValue(), not its tables. */
export const INK_PHEROMONES_DDL = `
  CREATE TABLE IF NOT EXISTS ink_pheromones (
    subject    TEXT PRIMARY KEY,
    note       TEXT,
    intensity  REAL NOT NULL,
    actor      TEXT,
    updated_at INTEGER NOT NULL
  );
`;

/**
 * Idempotently create the ink_pheromones table.
 *
 * Motivation/design: exported so lib/observability/maintenance.ts can ensure
 * the table exists BEFORE registering its retention policies (maintenance is
 * constructed earlier in server.ts than the reconcile loop) — one schema, one
 * implementation, no ordering hazard.
 *
 * @param db the daemon database
 */
export function ensureInkPheromonesTable(db: Database.Database): void {
  db.exec(INK_PHEROMONES_DDL);
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/**
 * Render a timestamp as ISO-8601, never throwing. Purpose: every projected
 * matrix value carries a human-readable timestamp; a bad input must degrade to
 * "now", not crash the tick.
 * @param ts epoch ms (or missing)
 * @returns an ISO-8601 string
 */
function iso(ts: number | undefined | null): string {
  const n = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now();
  try {
    return new Date(n).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Flatten whitespace and clip to a byte budget. Purpose: matrix values are
 * single-line grep targets with a ~4KB whole-projection budget — every free-
 * text field is clipped by design so one chatty message can't eat the file.
 * @param s raw text
 * @param max maximum output length
 * @returns a single-line string of at most `max` chars (… suffix when clipped)
 */
function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Best-effort string form of an attention item's content. Design intent:
 * inbox payloads are arbitrary JSON; the projection needs SOMETHING readable
 * and must never throw on a cyclic or exotic value.
 * @param content arbitrary message content
 * @returns a display string ('' for null/undefined)
 */
function stringifyContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Round to 2 decimals. Purpose: projected pheromone intensities are display
 * values; full float precision is noise in a grep-oriented cache.
 * @param n a finite number
 * @returns n rounded to 2 decimal places
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Serialized byte size of the desired map as it will land in matrix.env.
 * Why: the ~4KB budget is enforced against the REAL serialized form
 * (`K="escaped-V"\n`), not object counts, so escaping overhead is included.
 * @param desired the desired key→value projection
 * @returns total bytes the projection will occupy in the matrix file
 */
function desiredBytes(desired: Record<string, string>): number {
  let total = 0;
  for (const [k, v] of Object.entries(desired)) {
    total += k.length + escapeValue(v).length + 4; // K="V"\n
  }
  return total;
}

// ─── The loop ────────────────────────────────────────────────────────────────

/**
 * Construct the daemon reconcile loop.
 *
 * Lifecycle design: constructed in server.ts (it needs sessions/attention/
 * tuples/messaging/db, which fleet-daemon does not hold) and passed into
 * createFleetDaemon as the optional `reconcile` dep; fleet-daemon start()/
 * stop() drive it so fleet-daemon remains the single lifecycle owner. stop()
 * deliberately writes NOTHING special: a dying daemon simply stops
 * heartbeating and every reader fails open — that IS the staleness contract.
 *
 * @param deps see {@link ReconcileDeps}
 * @returns start/stop/poke plus the tickNow test hook
 */
export function createReconcileLoop(deps: ReconcileDeps): ReconcileLoop {
  const {
    sessions,
    attention,
    tuples,
    messaging,
    isPanicArmed,
    getPanicState,
    db,
    logger,
    fleet,
  } = deps;

  const intervalMs =
    deps.intervalMs ?? (Number(process.env.PD_RECONCILE_INTERVAL_MS) || 15_000);

  ensureInkPheromonesTable(db);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO ink_pheromones (subject, note, intensity, actor, updated_at)
      VALUES (@subject, @note, @intensity, @actor, @updatedAt)
      ON CONFLICT(subject) DO UPDATE SET
        note = excluded.note,
        intensity = @intensity,
        actor = excluded.actor,
        updated_at = excluded.updated_at
    `),
    get: db.prepare('SELECT subject, note, intensity, actor, updated_at FROM ink_pheromones WHERE subject = ?'),
    all: db.prepare('SELECT subject, note, intensity, actor, updated_at FROM ink_pheromones'),
    del: db.prepare('DELETE FROM ink_pheromones WHERE subject = ?'),
  };

  // CI latch: process-memory map of `${repo}#${branch}` → red state. Fed by
  // webhook fast-path events; empty after restart (documented degradation).
  interface CiRed {
    repo: string;
    branch: string;
    name: string;
    conclusion: string;
    url: string;
    updatedAt: number;
  }
  const ciLatch = new Map<string, CiRed>();

  let timer: NodeJS.Timeout | null = null;
  let trailing: NodeJS.Timeout | null = null;
  let unsubscribers: Array<() => void> = [];
  let running = false;
  let lastTickAt = 0;

  // ── CI webhook ingestion ──────────────────────────────────────────────────

  /**
   * Ingest a `github:webhook:workflow_run` / `check_suite` message into the
   * CI latch. Design: only completed runs on the repository's DEFAULT branch
   * latch (red feature branches are normal work); `failure`/`timed_out` sets
   * red, `success` clears. Tolerates both object and JSON-string messages;
   * any parse failure is logged and dropped — a bad webhook must never kill
   * the loop (that is the whole failure philosophy of this module).
   * @param msg the published webhook message (shape: routes/github-webhook.ts)
   * @returns nothing — mutates the in-memory latch and pokes the loop
   */
  function onCiEvent(msg: unknown): void {
    try {
      let m: Record<string, unknown> | null = null;
      if (typeof msg === 'string') {
        try {
          m = JSON.parse(msg) as Record<string, unknown>;
        } catch {
          return;
        }
      } else if (msg && typeof msg === 'object') {
        m = msg as Record<string, unknown>;
      }
      if (!m) return;
      const payload = (m.payload ?? m) as Record<string, unknown>;
      const repository = (m.repository ?? payload.repository ?? {}) as Record<string, unknown>;
      const repoName = typeof repository.full_name === 'string' ? repository.full_name : '';
      const defaultBranch =
        typeof repository.default_branch === 'string' ? repository.default_branch : '';
      const run = (payload.workflow_run ?? payload.check_suite ?? null) as
        | Record<string, unknown>
        | null;
      if (!run || !repoName) return;
      const branch = typeof run.head_branch === 'string' ? run.head_branch : '';
      // Only the default branch latches: red feature branches are normal work.
      if (!branch || !defaultBranch || branch !== defaultBranch) return;
      const status = typeof run.status === 'string' ? run.status : '';
      if (status && status !== 'completed') return; // in-progress runs decide nothing
      const conclusion = typeof run.conclusion === 'string' ? run.conclusion : '';
      const key = `${repoName}#${branch}`;
      if (conclusion === 'failure' || conclusion === 'timed_out') {
        ciLatch.set(key, {
          repo: repoName,
          branch,
          name: typeof run.name === 'string' ? run.name : 'ci',
          conclusion,
          url: typeof run.html_url === 'string' ? run.html_url : '',
          updatedAt: Date.now(),
        });
        poke('ci');
      } else if (conclusion === 'success') {
        if (ciLatch.delete(key)) poke('ci');
      }
    } catch (err) {
      logger.warn('reconcile_ci_event_parse_failed', { error: (err as Error).message });
    }
  }

  // ── Phase 1: gather desired state (no matrix lock, DB reads allowed) ──────

  /**
   * Phase 1 of a tick: compute the FULL desired state of every reconcile-owned
   * matrix key. Why full-state: the diff/GC in applyProjection is what fixes
   * "matrix.env grows forever" — desired-state absence IS deletion, so each
   * class's writer never needs a matching deleter. All DB/tuple reads happen
   * here, outside the matrix lock (microscopic-lock-window design).
   * @param now the tick timestamp (epoch ms)
   * @returns the desired key→value map, already trimmed to the ~4KB budget
   */
  function gatherDesired(now: number): Record<string, string> {
    const desired: Record<string, string> = {};

    // (h) Heartbeat — ALWAYS, every tick and every poke.
    desired[RECON_HEARTBEAT_KEY] = String(now);

    // (halt) Panic → PD_HALT with provenance. Absence ⇒ diffed away (the
    // "disarm → key gone" verification scenario).
    if (isPanicArmed()) {
      const p = getPanicState?.() ?? {};
      const reason = p.reason ?? 'fleet panic armed';
      const by = p.armedBy ?? 'operator';
      const since = iso(p.armedAt ?? now);
      desired[HALT_KEY] =
        `HALT: ${reason} | by:${by} | since:${since} | repo-wide pause — ` +
        `pause non-essential work; read-only tools exempt. Resume signal: this key disappears.`;
    }

    // (approvals) MIGRATED from fleet-daemon syncApprovalAlert — byte-compatible message.
    try {
      const pending = getSharedApprovalStream().list();
      if (pending.length > 0) {
        const head = pending
          .slice(0, 3)
          .map((pr) => `${pr.agent} ← ${pr.trigger}`)
          .join('; ');
        const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : '';
        desired[APPROVALS_ALERT_KEY] =
          `HITL: ${pending.length} spawn approval(s) waiting — ${head}${more}. ` +
          `Decide: pd fleet approvals | pd fleet approve <id> | pd fleet reject <id>`;
      }
    } catch (err) {
      logger.warn('reconcile_approvals_read_failed', { error: (err as Error).message });
    }

    // (inbox) top attention items per live actor, peeked (cursors untouched).
    try {
      const res = sessions.list({ status: 'active', allWorktrees: true, limit: 200 });
      const actors: string[] = [];
      const seen = new Set<string>();
      for (const s of res.sessions ?? []) {
        const actor =
          (typeof s.agentId === 'string' && s.agentId) ||
          (typeof s.id === 'string' ? s.id : '');
        if (!actor || seen.has(actor)) continue;
        seen.add(actor);
        actors.push(actor);
      }
      if (actors.length > MAX_ACTORS_PER_TICK) {
        logger.info('reconcile_actor_clamp', { actors: actors.length, cap: MAX_ACTORS_PER_TICK });
      }
      for (const actor of actors.slice(0, MAX_ACTORS_PER_TICK)) {
        try {
          const summary = attention.compose(actor, { peek: true, limit: INBOX_SLOTS_PER_ACTOR });
          const items = (summary.items ?? []).slice(0, INBOX_SLOTS_PER_ACTOR);
          items.forEach((item, i) => {
            desired[inboxKey(actor, i + 1)] =
              `[FOR YOU] from:${item.from ?? '?'} | ${item.type ?? item.channel ?? 'msg'} | ` +
              `${clip(stringifyContent(item.content), 160)} | ts:${iso(item.receivedAt)}`;
          });
        } catch (err) {
          logger.warn('reconcile_inbox_compose_failed', { actor, error: (err as Error).message });
        }
      }
    } catch (err) {
      logger.warn('reconcile_inbox_gather_failed', { error: (err as Error).message });
    }

    // (parley) unexpired summons → addressed PD_PARLEY_* keys, ≤2/actor.
    try {
      const rows = tuples.rd(['parley:summons', '*', '*', '*'], { limit: 200 });
      const perActor = new Map<string, Array<{ parleyId: string; due: number; value: string }>>();
      for (const t of rows) {
        const parleyId = typeof t.fields[1] === 'string' ? t.fields[1] : '';
        const party = typeof t.fields[2] === 'string' ? t.fields[2] : '';
        if (!parleyId || !party) continue;
        const payload = (t.fields[3] ?? {}) as Record<string, unknown>;
        const due =
          typeof payload.responseDueAt === 'number' ? payload.responseDueAt : Number.POSITIVE_INFINITY;
        // TTL re-check even for summons written without a tuple ttl.
        if (due !== Number.POSITIVE_INFINITY && due <= now) continue;
        const reason = typeof payload.reason === 'string' ? payload.reason : 'parley convened';
        const channel = typeof payload.channel === 'string' ? payload.channel : `parley:${parleyId}`;
        const value =
          `[FOR YOU] PARLEY SUMMONS ${parleyId}: ${clip(reason, 120)} | ` +
          `respond-by:${due === Number.POSITIVE_INFINITY ? 'open' : iso(due)} | ` +
          `channel:${channel} | pd parley join ${parleyId}`;
        const list = perActor.get(party) ?? [];
        list.push({ parleyId, due, value });
        perActor.set(party, list);
      }
      for (const [party, list] of perActor) {
        list.sort((a, b) => a.due - b.due); // soonest-due first
        for (const s of list.slice(0, PARLEY_PER_ACTOR)) {
          desired[parleyKey(party, s.parleyId)] = s.value;
        }
      }
    } catch (err) {
      logger.warn('reconcile_parley_gather_failed', { error: (err as Error).message });
    }

    // (claims) overlap projection — pure detector only; W3.4's
    // suggestion-emitting runOverlapScan stays manual and is NOT called here.
    try {
      const res = sessions.listAllActiveClaims();
      if (res.success) {
        const overlaps = detectClaimOverlaps(res.claims);
        overlaps.sort(
          (x, y) =>
            Math.max(y.a.claimedAt, y.b.claimedAt) - Math.max(x.a.claimedAt, x.b.claimedAt),
        );
        for (const o of overlaps.slice(0, CLAIM_OVERLAP_TOP)) {
          desired[`PD_CLAIM_${keySuffix(o.filePath)}`] =
            `OVERLAP ${o.filePath}: sessions ${o.a.sessionId}+${o.b.sessionId} both claim it — ` +
            `coordinate before cutting (pd notes)`;
        }
      }
    } catch (err) {
      logger.warn('reconcile_claims_gather_failed', { error: (err as Error).message });
    }

    // (ci) red default-branch latch entries younger than 6h.
    for (const [key, red] of ciLatch) {
      if (now - red.updatedAt > CI_RED_MAX_AGE_MS) {
        ciLatch.delete(key);
        continue;
      }
      desired[`PD_CI_${keySuffix(key)}`] =
        `CI RED on ${red.repo}@${red.branch}: ${red.name} ${red.conclusion} — ` +
        `do not stack commits on a red default branch. ${red.url}`;
    }

    // (accomplishment) NO PD_ACCOMPLISHMENT_* writers in W1 — the prefix stays
    // registered in ownedPrefixes so strays are GC'd and W3.1's writer plugs in
    // with zero new plumbing.

    // (pheromone projection) decayed top-N from the durable store, DETERMINISTIC
    // keys (no timestamp suffix ⇒ non-raw ⇒ owned/diffed by applyProjection).
    try {
      for (const row of queryTopPheromones(now, PHEROMONE_TOP)) {
        desired[`PD_PHEROMONE_${keySuffix(row.subject)}`] =
          `${row.subject} | ${row.note} | intensity:${round2(row.eff)} | ` +
          `actor:${row.actor} | last:${iso(row.updatedAt)}`;
      }
    } catch (err) {
      logger.warn('reconcile_pheromone_project_failed', { error: (err as Error).message });
    }

    trimToBudget(desired);
    return desired;
  }

  // ── Budget: bound the reconcile-OWNED footprint at ~4KB ───────────────────
  // Trim whole classes in priority order. NEVER trim PD_HALT, the heartbeat,
  // or the approvals alert. NOTE the guarantee is "owned classes bounded, file
  // not monotonic" — PD_LOCK_*/operator alerts/raw appends between ticks can
  // still push the whole file past 4KB transiently.

  /**
   * Enforce the ~4KB projection budget by dropping WHOLE classes in priority
   * order (accomplishments → pheromone projections → CI → claims → inbox slot
   * 3 → slot 2 → parley). Rationale: a predictable class-level trim keeps the
   * surviving keys coherent — half a class is worse than none. PD_HALT, the
   * heartbeat, and the approvals alert are never trimmed (the loudest,
   * cheapest, most safety-relevant keys).
   * @param desired the desired projection — mutated in place
   * @returns nothing — logs `reconcile_budget_trimmed` when anything dropped
   */
  function trimToBudget(desired: Record<string, string>): void {
    if (desiredBytes(desired) <= BUDGET_BYTES) return;
    const droppedClasses: string[] = [];
    /**
     * Drop every desired key under one class prefix. Purpose: whole-class
     * trimming (see above) — records the prefix for the trim log.
     * @param prefix the class prefix to drop
     * @returns nothing — mutates `desired`
     */
    const dropPrefix = (prefix: string): void => {
      for (const k of Object.keys(desired)) {
        if (k.startsWith(prefix)) delete desired[k];
      }
      droppedClasses.push(prefix);
    };

    const order: Array<() => void> = [
      () => dropPrefix('PD_ACCOMPLISHMENT_'),
      () => dropPrefix('PD_PHEROMONE_'),
      () => dropPrefix('PD_CI_'),
      () => dropPrefix('PD_CLAIM_'),
      // Oldest inbox slots first: slot 3 across actors, then slot 2.
      () => {
        for (const k of Object.keys(desired)) if (/^PD_INBOX_.*_3$/.test(k)) delete desired[k];
        droppedClasses.push('PD_INBOX_*_3');
      },
      () => {
        for (const k of Object.keys(desired)) if (/^PD_INBOX_.*_2$/.test(k)) delete desired[k];
        droppedClasses.push('PD_INBOX_*_2');
      },
      () => dropPrefix('PD_PARLEY_'),
    ];
    for (const step of order) {
      if (desiredBytes(desired) <= BUDGET_BYTES) break;
      step();
    }
    logger.warn('reconcile_budget_trimmed', {
      bytes: desiredBytes(desired),
      droppedClasses,
    });
  }

  // ── Durable pheromone store (drain target) ────────────────────────────────

  interface InkPheromoneRow {
    subject: string;
    note: string | null;
    intensity: number;
    actor: string | null;
    updated_at: number;
  }

  /**
   * Top-N durable pheromones by effective (read-time decayed) intensity.
   * Design: decay is computed at READ time via the shared `decayedValue` law
   * (one implementation with lib/pheromone.ts), and rows whose effective value
   * fell below 0.01 are DELETED here — a self-pruning read path, so the table
   * shrinks with use rather than waiting for the retention sweep.
   * @param now current time (epoch ms) for the decay computation
   * @param limit maximum rows to return
   * @returns the top rows with their effective intensities, strongest first
   */
  function queryTopPheromones(
    now: number,
    limit: number,
  ): Array<{ subject: string; note: string; eff: number; actor: string; updatedAt: number }> {
    const rows = stmts.all.all() as InkPheromoneRow[];
    const out: Array<{ subject: string; note: string; eff: number; actor: string; updatedAt: number }> = [];
    for (const row of rows) {
      const eff = decayedValue(row.intensity, now - row.updated_at, PHEROMONE_CFG);
      if (eff < 0.01) {
        try {
          stmts.del.run(row.subject);
        } catch {
          /* prune failure is not fatal */
        }
        continue;
      }
      out.push({
        subject: row.subject,
        note: row.note ?? '',
        eff,
        actor: row.actor ?? 'unknown',
        updatedAt: row.updated_at,
      });
    }
    out.sort((a, b) => b.eff - a.eff);
    return out.slice(0, limit);
  }

  /**
   * Phase 3 of a tick: parse drained matrix appends (tolerant split on ' | ')
   * and upsert into ink_pheromones. Design: on conflict the EXISTING intensity
   * is first decayed to `now`, then the new intensity is added, capped at 5 —
   * repeated edits reinforce a trace without letting it grow unbounded. Why
   * parse failures are dropped (with a log) instead of thrown: degraded
   * coordination beats a dead loop.
   * @param drained raw pheromone appends harvested by applyProjection
   * @param now the tick timestamp (epoch ms)
   * @returns nothing — writes rows, never throws
   */
  function ingestDrains(
    drained: Array<{ key: string; value: string }>,
    now: number,
  ): void {
    for (const { key, value } of drained) {
      try {
        // Value shape: `subject | note | intensity:n | actor:a | ts:iso`
        const parts = value.split(' | ');
        const subject = (parts[0] ?? '').trim();
        if (!subject) throw new Error('empty subject');
        const note = (parts[1] ?? '').trim();
        let intensity = 1;
        let actor = 'unknown';
        for (const part of parts.slice(2)) {
          const p = part.trim();
          if (p.startsWith('intensity:')) {
            const n = Number(p.slice('intensity:'.length));
            if (Number.isFinite(n) && n > 0) intensity = n;
          } else if (p.startsWith('actor:')) {
            actor = p.slice('actor:'.length) || 'unknown';
          }
        }
        const existing = stmts.get.get(subject) as InkPheromoneRow | undefined;
        let merged = intensity;
        if (existing) {
          const decayed = decayedValue(existing.intensity, now - existing.updated_at, PHEROMONE_CFG);
          merged = Math.min(5, decayed + intensity);
        }
        stmts.upsert.run({
          subject,
          note: note || (existing?.note ?? ''),
          intensity: merged,
          actor,
          updatedAt: now,
        });
      } catch (err) {
        logger.warn('reconcile_pheromone_drain_dropped', {
          key,
          error: (err as Error).message,
        });
      }
    }
  }

  // ── The tick ──────────────────────────────────────────────────────────────

  /**
   * One full reconcile pass: gather (no lock) → apply (one lock, one atomic
   * rename) → ingest drains (no lock). Why the whole pass is wrapped in
   * try/catch: this is an advisory surface — a projection bug must degrade
   * coordination, never kill (or restart-loop) the daemon.
   * @returns nothing — all effects land in the matrix file and ink_pheromones
   */
  function tick(): void {
    // The entire pass is defensive: an advisory surface must never kill the
    // daemon (daemon-development doctrine — no restart loop from a projection bug).
    try {
      const now = Date.now();
      lastTickAt = now;
      const desired = gatherDesired(now);

      // Phase 2 — APPLY (one lock, one read, one atomic rename).
      const res = applyProjection(
        {
          ownedExactKeys: [HALT_KEY, RECON_HEARTBEAT_KEY, APPROVALS_ALERT_KEY],
          // PD_PHEROMONE_ ownership applies to NON-RAW (projection) keys only;
          // raw appends are drained before the GC scan inside applyProjection.
          ownedPrefixes: [...RECON_OWNED_PREFIXES, 'PD_PHEROMONE_'],
          desired,
        },
        fleet,
      );

      // Phase 3 — INGEST DRAINS (no lock).
      if (res.drainedPheromones.length > 0) {
        ingestDrains(res.drainedPheromones, now);
      }
    } catch (err) {
      logger.warn('reconcile_tick_failed', { error: (err as Error).message });
    }
  }

  // ── poke: coalesced immediate pass ────────────────────────────────────────

  /**
   * Event fast-path: run a pass NOW unless one ran <500ms ago, in which case
   * schedule ONE trailing pass (single-flight). Why coalescing: event bursts
   * (approval floods, webhook storms) must not stampede the matrix lock — the
   * trailing tick still captures the final state of the burst.
   * @param reason short label for the poke log line
   * @returns nothing — no-op before start() / after stop()
   */
  function poke(reason: string): void {
    if (!running) return;
    const since = Date.now() - lastTickAt;
    if (since >= POKE_COALESCE_MS) {
      logger.info('reconcile_poke', { reason });
      tick();
      return;
    }
    // A tick ran <500ms ago: schedule ONE trailing tick (single-flight) so
    // event bursts (approval floods, webhook storms) can't stampede the lock.
    if (trailing) return;
    logger.info('reconcile_poke_coalesced', { reason });
    trailing = setTimeout(() => {
      trailing = null;
      tick();
    }, POKE_COALESCE_MS);
    trailing.unref?.();
  }

  // ── start/stop ────────────────────────────────────────────────────────────

  /**
   * Arm the loop: interval timer (unref'd — the loop must never keep a dying
   * process alive), event fast-path subscriptions, and an immediate first tick
   * so the heartbeat exists before the first agent turn. Why idempotent:
   * fleet-daemon reload() may call start() after stop() repeatedly.
   * @returns nothing
   */
  function start(): void {
    if (running) return;
    running = true;

    timer = setInterval(tick, intervalMs);
    timer.unref?.();

    // Event fast-paths → poke.
    try {
      unsubscribers.push(getSharedApprovalStream().subscribe(() => poke('approvals')));
    } catch (err) {
      logger.warn('reconcile_approval_subscribe_failed', { error: (err as Error).message });
    }
    for (const [channel, handler] of [
      ['fleet:panic', () => poke('panic')],
      ['fleet:unpanic', () => poke('unpanic')],
      ['github:webhook:workflow_run', onCiEvent],
      ['github:webhook:check_suite', onCiEvent],
    ] as Array<[string, (msg: unknown) => void]>) {
      try {
        const unsub = messaging.subscribe(channel, handler);
        if (unsub) unsubscribers.push(unsub);
      } catch (err) {
        logger.warn('reconcile_subscribe_failed', { channel, error: (err as Error).message });
      }
    }

    // Immediate first tick so the heartbeat exists before the first agent turn.
    tick();
    logger.info('reconcile_loop_started', { intervalMs });
  }

  /**
   * Disarm the loop: clear timers, drop subscriptions — and deliberately write
   * NOTHING to the matrix. Why: a stopping daemon simply stops heartbeating;
   * readers fail open on staleness. That asymmetry (loud while alive, silent
   * when dead) IS the staleness contract the whole surface is built on.
   * @returns nothing
   */
  function stop(): void {
    if (!running) return;
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (trailing) {
      clearTimeout(trailing);
      trailing = null;
    }
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    unsubscribers = [];
    // Deliberately NO final matrix write: a stopping daemon just stops
    // heartbeating; readers fail open on staleness. That asymmetry (loud while
    // alive, silent when dead) is the whole staleness contract.
    logger.info('reconcile_loop_stopped', {});
  }

  return { start, stop, poke, tickNow: tick };
}
