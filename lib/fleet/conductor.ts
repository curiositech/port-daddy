/**
 * The Daemon Fleet Conductor — ADR-0060.
 *
 * One daemon-resident entity that owns ONE spawn primitive, `conductor.launch`,
 * which is the *only* code path that ever reaches `spawner.spawn`. `dispatch`,
 * `sortie`, `fleet`, the reactive orchestrator, and agent-proposed recursion all
 * become thin `LaunchIntent` constructors that call the Conductor; none of them
 * owns spawning anymore.
 *
 * The Conductor merges the two half-answers that existed before it:
 *   • dispatch's strong lifecycle + worktree-off-main + reviewable PR artifact, and
 *   • sortie's bond escrow + harbor card + slash/refund economics,
 * onto one admission→embodiment→run→settle path, and erases the redundant
 * private spawn callsites the surfaces used to hold.
 *
 * SAFETY (each gate is named and enforced at admission, inside ONE SQLite
 * transaction so there is no time-of-check/time-of-use window — Sagas' "funds
 * in transit" principle: the reservation is durable before the child is admitted):
 *
 *   I1 NO_SPAWN_WITHOUT_BOND      — escrow must succeed (spawner enforces escrow;
 *                                   the Conductor first reserves the bond against
 *                                   the lineage ceiling).
 *   I2 NO_SPAWN_ON_MAIN          — a `worktree:'create'` intent must yield a real
 *                                   off-main worktree; `worktree:'inherit'` must
 *                                   not point at a main checkout.
 *   I3 DEPTH_CAPPED              — depth > PD_FLEET_MAX_DEPTH is refused. Depth is
 *                                   Conductor-stamped from the DURABLE parent row,
 *                                   never from the intent. An `agent` source can
 *                                   NEVER mint a root (parentId:'operator'/absent
 *                                   is rejected) — it MUST name a real, existing,
 *                                   non-terminal parent, so it cannot reset its
 *                                   depth/rootId/ceiling by re-parenting.
 *   I4 LINEAGE_BUDGET_CONSERVED  — the subtree under one rootId shares one
 *                                   ceiling; a child's bond is RESERVED against it
 *                                   *before* admission, in the same txn, so a
 *                                   burst of concurrent children can't each pass
 *                                   the check before debits land (TOCTOU).
 *   I5 GLOBAL_BREAKER            — no admission while the global breaker is open.
 *   I6 CAPABILITY_SCOPED         — a child's cap[] must be a subset of its
 *                                   parent's cap[] (capabilities only narrow).
 *                                   Empty/absent child caps INHERIT the parent's
 *                                   effective caps — they never fall through to
 *                                   the spawner's full-tier default. Root caps are
 *                                   bounded by an operator ceiling (rootCapability-
 *                                   Ceiling) when configured.
 *   I7 HALT_IS_TOTAL            — operator halt on a scope transitions every
 *                                   running launch to `halted` and refuses every
 *                                   proposed one. Operator halt ALWAYS REFUNDS,
 *                                   never slashes (refund-before-cancel, like the
 *                                   panic path) — the operator is not punished for
 *                                   using the cancellation control.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  createFleetCircuitBreaker,
  GLOBAL_SCOPE,
  type FleetCircuitBreaker,
  type BreakerScope,
} from './circuit-breaker.js';
import { isSubscriptionBackend } from '../backend-catalog.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LaunchSource =
  | 'operator'
  | 'dispatch'
  | 'sortie'
  | 'fleet'
  | 'orchestrator'
  | 'nightshift'
  | 'agent';

export type WorktreePolicy = 'create' | 'inherit';
export type MergePolicy = 'review' | 'never' | 'auto';

/** ADR-0060 §"The unified state machine". */
export type LaunchState =
  | 'proposed'
  | 'admitted'
  | 'embodied'
  | 'running'
  | 'produced'
  | 'review_pending'
  | 'accepted'
  | 'rejected'
  | 'settled'
  | 'failed'
  | 'halted'
  | 'salvage'
  | 'refused';

export const LAUNCH_TERMINAL_STATES: ReadonlyArray<LaunchState> = [
  'settled',
  'failed',
  'salvage',
  'refused',
];

/**
 * The unified intent. `dispatch`/`sortie`/`fleet`/`orchestrator`/`nightshift`/
 * agent-recursion construct this with different defaults; they no longer spawn.
 */
export interface LaunchIntent {
  // identity & lineage (Conductor-stamped; a caller MAY NOT forge depth) —
  /** Top-of-tree operator launch id. If omitted, this launch IS a root. */
  rootId?: string;
  /** Who proposed this launch: a launch id, or 'operator'. */
  parentId?: string | 'operator';

  // work —
  goal: string;
  /** Which durable actor this body embodies (ADR-0028). Optional pre-Phase-4. */
  actor?: string;
  backend: string;
  model?: string;
  modelTier?: 'low' | 'mid' | 'high';

  // safety envelope —
  capabilities?: string[];
  /** Per-launch hard cap enforced by the spawner against final telemetry. */
  budgetUsd?: number;
  bondUsd?: number;
  /** Shared ceiling for the whole subtree under rootId. Required for roots. */
  lineageCeilingUsd?: number;
  deadlineMs?: number;
  timeoutMs?: number;

  // artifact policy —
  worktree?: WorktreePolicy;
  mergePolicy?: MergePolicy;

  // dispatch passthrough (ADR-0060 fold-in) — carried through admission UNTOUCHED;
  // these inform worktree minting and PR publishing but MUST NOT affect any
  // gate/admission decision. A dispatch supplies the worktree it wants minted
  // (path/branch/baseRef), the env to run under, and the tube channel to publish
  // its exchange on. The Conductor's `mintWorktree`/`publishArtifact` hooks read
  // these; admission never branches on them.
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseRef?: string;
  env?: Record<string, string>;
  tubeChannel?: string;

  // execution context (passed through to the spawner spec) —
  workdir?: string;
  identity?: string;
  purpose?: string;
  task?: string;
  allowedTools?: string;
  maxTokens?: number;
  harborName?: string;
  /** Opt-in: agent genuinely needs a shared/main checkout (read-only observers). */
  allowSharedCheckout?: boolean;

  // provenance —
  source: LaunchSource;
}

/** The fully-stamped, persisted launch. */
export interface Launch {
  id: string;
  rootId: string;
  parentId: string;
  depth: number;
  goal: string;
  source: LaunchSource;
  backend: string;
  state: LaunchState;
  capabilities: string[];
  bondUsd: number | null;
  lineageCeilingUsd: number | null;
  worktree: WorktreePolicy;
  mergePolicy: MergePolicy;
  agentId: string | null;
  resultArtifact: string | null;
  costUsd: number | null;
  errorMessage: string | null;
  refusedReason: string | null;
  createdAt: number;
  settledAt: number | null;
}

/** Minimal shape of the spawner the Conductor drives (the real `Spawner`). */
export interface ConductorSpawner {
  spawn(spec: Record<string, unknown>): Promise<{
    agentId: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'over_budget';
    output: string | null;
    error: string | null;
    [k: string]: unknown;
  }>;
  cancel(agentId: string): void;
}

/**
 * Minimal shape of the bonds module the Conductor needs for refund-before-cancel
 * on operator halt. Mirrors the panic route's convention exactly: list the
 * `running` bonds, refund the ones whose agentId is being halted, THEN cancel —
 * so the spawner's cancellation-path slash becomes a no-op (the bond is already
 * operator-resolved). Operator halt therefore ALWAYS REFUNDS, never slashes.
 */
export interface ConductorBonds {
  refund(id: number): boolean;
  listBonds(opts: { state?: string; limit?: number }): Array<{ id: number; agentId: string }>;
}

export interface ConductorDeps {
  db: Database.Database;
  spawner: ConductorSpawner;
  bonds?: ConductorBonds;
  breaker?: FleetCircuitBreaker;
  /** Broadcast `fleet:state` and `fleet:launch` events (messaging.publish shape). */
  broadcast?: (channel: string, payload: unknown) => void;
  /** Max lineage depth; ADR default 3. */
  maxDepth?: number;
  /** Injectable clock. */
  now?: () => number;
  /**
   * Is the given workdir a main checkout (NO_SPAWN_ON_MAIN)? Injected so the
   * gate is testable without a real git repo. Defaults to a conservative probe.
   */
  isMainCheckout?: (workdir: string | undefined) => boolean;
  /**
   * Create an off-main worktree for `worktree:'create'` intents, returning the
   * workdir to run in. Injected; defaults to a no-op that reuses `workdir`
   * (Phase-1 behavior) — real worktree minting wires in via this hook.
   */
  mintWorktree?: (
    launch: Launch,
    intent: LaunchIntent,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * AFTER a successful run on the `mergePolicy:'review'` path, publish a
   * reviewable artifact (e.g. push the dispatch branch and open a draft PR),
   * returning its URL — stored as `resultArtifact`. Injected so the Conductor
   * owns the dispatch's draft-PR step without importing git/gh directly. This is
   * a PURE SIDE-EFFECT: it runs OUTSIDE the cost breaker and bonds, never flips a
   * successful run to failed, and a throw is swallowed (resultArtifact stays
   * null — the run is not lost). NOT called on `mergePolicy:'never'` (which
   * settles immediately with no review artifact) nor on a failed run.
   */
  publishArtifact?: (
    launch: Launch,
    intent: LaunchIntent,
    spawnResult: Awaited<ReturnType<ConductorSpawner['spawn']>>,
  ) => Promise<string | null>;
  /**
   * Upper bound (ms) on `publishArtifact`. The publish (`git push` + `gh pr
   * create`) is an unbounded await INSIDE the run that HOLDS the launch's
   * in-flight slot: a hung push/PR (network wedge, gh outage, NFS stall) would
   * otherwise stall the slot until the OS TCP timeout (minutes-to-forever).
   * Dispatch is autonomous/overnight, so we bound it: when publish exceeds this,
   * the await is abandoned (it becomes a swallowed throw → resultArtifact null,
   * the run stays produced, the slot is released). Default 120_000ms (2 min).
   * Set to 0/negative/Infinity to disable the bound (legacy unbounded await).
   */
  publishTimeoutMs?: number;
  /**
   * Operator-set ceiling on the capabilities a ROOT launch may declare (I6 for
   * roots). A root's effective caps are intersected with this list. Empty/absent
   * = no ceiling (roots may declare any caps — the legacy behavior). Non-root
   * launches are bounded by their parent's caps, never by this list.
   */
  rootCapabilityCeiling?: string[];
  /**
   * Default per-subtree lineage ceiling (USD) stamped on a ROOT launch when the
   * intent omits `lineageCeilingUsd`. This ARMS I4 on the live sortie/orchestrator
   * paths (which don't set a ceiling), bounding each tree's total spend. Null /
   * absent = unbounded (legacy). The reservation floor (`defaultBondUsd`) is what
   * makes the breaker actually accrue against this ceiling.
   */
  defaultLineageCeilingUsd?: number | null;
  /**
   * Reservation floor (USD) used when an intent omits `bondUsd`. Returned by
   * `effectiveBond` so the breaker RESERVES a non-zero amount per launch — arming
   * I4/I5 on the live paths. This is a BREAKER reservation only; it is NOT
   * forwarded to the spawner spec (the spawner prices its own escrow), so the
   * observable spawn stays byte-identical. Default 0 (legacy: reserve nothing).
   */
  defaultBondUsd?: number;
}

export interface LaunchResult {
  launch: Launch;
  admitted: boolean;
  refusedReason: string | null;
  spawn: Awaited<ReturnType<ConductorSpawner['spawn']>> | null;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS fleet_launches (
    id                  TEXT PRIMARY KEY,
    root_id             TEXT NOT NULL,
    parent_id           TEXT NOT NULL,
    depth               INTEGER NOT NULL,
    goal                TEXT NOT NULL,
    source              TEXT NOT NULL,
    backend             TEXT NOT NULL,
    state               TEXT NOT NULL DEFAULT 'proposed'
      CHECK(state IN (
        'proposed','admitted','embodied','running','produced','review_pending',
        'accepted','rejected','settled','failed','halted','salvage','refused'
      )),
    capabilities_json   TEXT NOT NULL DEFAULT '[]',
    bond_usd            REAL,
    lineage_ceiling_usd REAL,
    worktree            TEXT NOT NULL DEFAULT 'inherit',
    merge_policy        TEXT NOT NULL DEFAULT 'review',
    agent_id            TEXT,
    result_artifact     TEXT,
    cost_usd            REAL,
    error_message       TEXT,
    refused_reason      TEXT,
    created_at          INTEGER NOT NULL,
    settled_at          INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fleet_launches_root  ON fleet_launches(root_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_fleet_launches_state ON fleet_launches(state, created_at);
  CREATE INDEX IF NOT EXISTS idx_fleet_launches_agent ON fleet_launches(agent_id);
`;

interface LaunchRow {
  id: string;
  root_id: string;
  parent_id: string;
  depth: number;
  goal: string;
  source: LaunchSource;
  backend: string;
  state: LaunchState;
  capabilities_json: string;
  bond_usd: number | null;
  lineage_ceiling_usd: number | null;
  worktree: WorktreePolicy;
  merge_policy: MergePolicy;
  agent_id: string | null;
  result_artifact: string | null;
  cost_usd: number | null;
  error_message: string | null;
  refused_reason: string | null;
  created_at: number;
  settled_at: number | null;
}

function rowToLaunch(row: LaunchRow): Launch {
  let capabilities: string[] = [];
  try {
    const parsed = JSON.parse(row.capabilities_json);
    if (Array.isArray(parsed)) capabilities = parsed.filter((c) => typeof c === 'string');
  } catch {
    /* corruption is non-fatal */
  }
  return {
    id: row.id,
    rootId: row.root_id,
    parentId: row.parent_id,
    depth: row.depth,
    goal: row.goal,
    source: row.source,
    backend: row.backend,
    state: row.state,
    capabilities,
    bondUsd: row.bond_usd,
    lineageCeilingUsd: row.lineage_ceiling_usd,
    worktree: row.worktree,
    mergePolicy: row.merge_policy,
    agentId: row.agent_id,
    resultArtifact: row.result_artifact,
    costUsd: row.cost_usd,
    errorMessage: row.error_message,
    refusedReason: row.refused_reason,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

// ─── Conductor ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 3;

/**
 * Default upper bound (ms) on the `publishArtifact` slot-hold (FIX 3 / ADR-0060).
 * A hung `git push`/`gh pr create` must not pin a dispatch's in-flight slot until
 * the OS TCP timeout. 2 minutes is generous for a push + draft-PR open yet bounds
 * an overnight dispatch from stalling indefinitely.
 */
const DEFAULT_PUBLISH_TIMEOUT_MS = 120_000;

/**
 * Race a promise against a timeout. On timeout the returned promise REJECTS with
 * a timeout error (caught by the publish try/catch → resultArtifact null, run
 * stays produced, slot released). The abandoned underlying promise is left to
 * settle on its own (we cannot cancel a raw `git push`), but it no longer holds
 * the launch path. A non-finite/≤0 `ms` disables the bound (legacy unbounded).
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Sources entitled to mint a ROOT launch (depth 0, fresh rootId, self-chosen
 * ceiling/caps). These are the daemon's own operator-initiated surfaces — the
 * operator typing a command, a sortie POST, an orchestrator rule firing,
 * dispatch, the fleet engine, nightshift. They are NOT attacker-influenced: the
 * intent is constructed daemon-side, not by a running agent.
 *
 * `agent` is the ONE excluded source: it is the recursion surface where a
 * running (potentially adversarial) body proposes a sub-launch. An `agent`
 * proposer can NEVER mint a root — it MUST name a real, existing, non-terminal
 * parent, and its depth/rootId/parentCaps/lineageCeiling are derived from that
 * durable parent row, never from the agent-supplied intent. This is the trust
 * boundary that makes I3/I4/I6 un-forgeable (white-hat HIGH #2, red-team #2).
 */
const ROOT_MINTING_SOURCES: ReadonlySet<LaunchSource> = new Set<LaunchSource>([
  'operator',
  'sortie',
  'fleet',
  'orchestrator',
  'nightshift',
  'dispatch',
]);

export function createConductor(deps: ConductorDeps) {
  const { db, spawner } = deps;
  const bonds = deps.bonds;
  const broadcast = deps.broadcast;
  const now = deps.now ?? (() => Date.now());
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  const breaker = deps.breaker ?? createFleetCircuitBreaker({ now });
  const isMainCheckout = deps.isMainCheckout ?? defaultIsMainCheckout;
  const mintWorktree = deps.mintWorktree ?? ((_l, intent) => intent.workdir);
  const publishArtifact = deps.publishArtifact;
  // Bound the publish slot-hold. A finite positive value arms the race below; 0,
  // a negative, or Infinity (or absent + the DEFAULT_PUBLISH_TIMEOUT_MS) leaves
  // the publish unbounded only when explicitly disabled.
  const publishTimeoutMs = deps.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
  const rootCapabilityCeiling = deps.rootCapabilityCeiling ?? null;
  const defaultLineageCeilingUsd = deps.defaultLineageCeilingUsd ?? null;
  const defaultBondUsd = deps.defaultBondUsd != null && deps.defaultBondUsd > 0 ? deps.defaultBondUsd : 0;

  // Launches halted while their `spawner.spawn` is still pending: we do not yet
  // hold the agentId (the spawner returns it only on resolution), so we cannot
  // signal mid-flight. We record the intent-to-cancel here; the moment the spawn
  // resolves and the body's agentId is known, the run path honors the pending
  // cancel the just-born body — so HALT stays total even against
  // a launch caught between admission and a live agentId (ADR-0060 I7).
  const pendingCancels = new Set<string>();

  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO fleet_launches (
      id, root_id, parent_id, depth, goal, source, backend, state,
      capabilities_json, bond_usd, lineage_ceiling_usd, worktree, merge_policy,
      created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?
    )
  `);
  const selectByIdStmt = db.prepare<[string], LaunchRow>(
    `SELECT * FROM fleet_launches WHERE id = ?`,
  );
  const selectByRootStmt = db.prepare<[string], LaunchRow>(
    `SELECT * FROM fleet_launches WHERE root_id = ? ORDER BY created_at ASC`,
  );
  const selectRunningStmt = db.prepare<[], LaunchRow>(
    `SELECT * FROM fleet_launches WHERE state = 'running'`,
  );
  const selectAllStmt = db.prepare<[number], LaunchRow>(
    `SELECT * FROM fleet_launches ORDER BY created_at DESC LIMIT ?`,
  );
  const setStateStmt = db.prepare(`
    UPDATE fleet_launches
       SET state = ?,
           agent_id = COALESCE(?, agent_id),
           cost_usd = COALESCE(?, cost_usd),
           result_artifact = COALESCE(?, result_artifact),
           error_message = COALESCE(?, error_message),
           refused_reason = COALESCE(?, refused_reason),
           settled_at = COALESCE(?, settled_at)
     WHERE id = ?
  `);

  function emit(channel: string, payload: Record<string, unknown>): void {
    if (!broadcast) return;
    try {
      broadcast(channel, payload);
    } catch {
      /* broadcast never blocks the launch path */
    }
  }

  function get(id: string): Launch | null {
    const row = selectByIdStmt.get(id);
    return row ? rowToLaunch(row) : null;
  }

  function lineageScope(rootId: string): BreakerScope {
    return `root:${rootId}`;
  }

  /**
   * Refund every `running` bond escrowed for `agentId`, BEFORE its body is
   * cancelled. Mirrors routes/panic.ts: refunding first makes the spawner's
   * cancellation-path slash a no-op, so operator halt ALWAYS REFUNDS and never slashes.
   */
  function refundBondsForAgent(agentId: string | null | undefined): void {
    if (!bonds || !agentId) return;
    try {
      const running = bonds.listBonds({ state: 'running', limit: 1000 });
      for (const b of running) {
        if (b.agentId === agentId) {
          try {
            bonds.refund(b.id);
          } catch {
            /* refund failure never blocks the halt */
          }
        }
      }
    } catch {
      /* listing failure never blocks the halt */
    }
  }

  /**
   * Bond resolution for the BREAKER RESERVATION (not the spawner escrow): a
   * per-spawn `bondUsd` wins; else fall back to the configured `defaultBondUsd`
   * floor so the breaker reserves a non-zero amount on every launch (arming
   * I4/I5 on the live sortie/orchestrator paths). A 0 floor preserves the legacy
   * "reserve nothing, let the spawner price it" behavior.
   *
   * EXEMPTION (2026-07-14 halt-mandate, BUG 1): a `backend` classified as
   * `costModel:'subscription'` in lib/backend-catalog.ts (cli:claude-code,
   * cli:codex, and the other CLI-tube backends riding a flat-rate account) has
   * ZERO marginal dollar cost to Port Daddy — the operator already pays the
   * subscription regardless of spawn volume. Reserving a real-dollar bond
   * against a $0 backend is a category error: it lets a burst of ordinary,
   * free CLI dispatches exhaust a finite ceiling (lineage OR global) and
   * permanently trip GLOBAL_BREAKER for every future launch, metered or not —
   * exactly the 2026-07-14 daemon-death incident's root cause. This override
   * is UNCONDITIONAL: it ignores both `intent.bondUsd` and `defaultBondUsd` for
   * a subscription backend, because there is no "operator override" that makes
   * a $0-marginal-cost backend cost real dollars. Metered backends (claude,
   * gemini, cloudflare, openai, groq, …) are completely unaffected.
   */
  function effectiveBond(intent: LaunchIntent): number {
    if (isSubscriptionBackend(intent.backend)) return 0;
    if (intent.bondUsd != null && Number.isFinite(intent.bondUsd) && intent.bondUsd > 0) {
      return intent.bondUsd;
    }
    return defaultBondUsd;
  }

  /**
   * Admission — runs every gate inside ONE synchronous SQLite transaction so the
   * breaker-state read, the lineage-budget reservation, and the launch-row write
   * are atomic. better-sqlite3 is synchronous, which makes this honest: no async
   * boundary can interleave a sibling admission between check and reserve.
   */
  function admit(intent: LaunchIntent): { launch: Launch; reserved: number } {
    const at = now();
    const id = randomUUID();
    const declaredCaps = intent.capabilities ?? [];
    const bond = effectiveBond(intent);

    const tx = db.transaction((): { launch: Launch; reserved: number } => {
      // ── Roothood is SOURCE-gated (I3/I6/I4 anti-forgery) ───────────────────
      // Only `source:'operator'` may mint a ROOT: depth 0, fresh rootId, self-
      // chosen ceiling and caps. EVERY non-operator source (agent/sortie/
      // orchestrator/dispatch/fleet/nightshift) MUST name a real, existing,
      // non-terminal parent — depth/rootId/parentCaps/lineageCeiling are derived
      // from THAT parent row, never from caller-supplied intent fields. This
      // closes the `parentId:'operator'` (or absent-parent) re-parenting spoof:
      // an agent can no longer mint a fresh depth-0 root with its own ceiling and
      // arbitrary caps to escape the depth cap, the lineage budget, and cap
      // narrowing (white-hat HIGH #2 / red-team Attack 2).
      const mayMintRoot = ROOT_MINTING_SOURCES.has(intent.source);
      const claimsRoot = intent.parentId == null || intent.parentId === 'operator';

      let depth = 0;
      let parentCaps: string[] | null = null;
      let resolvedRootId = intent.rootId ?? id;
      let parentId: string = 'operator';
      let lineageCeiling = intent.lineageCeilingUsd ?? null;
      // Effective caps: mutated below to enforce inheritance + root ceiling.
      let effectiveCaps = declaredCaps;

      if (mayMintRoot && claimsRoot) {
        // Root-minting source minting a root. Bound the declared caps by the
        // operator ceiling (if configured) so even a root cannot free-declare
        // beyond policy.
        parentId = 'operator';
        resolvedRootId = intent.rootId ?? id;
        // ARM I4: a root that omits its own ceiling gets the operator's default
        // per-subtree ceiling, so the live sortie/orchestrator paths are bounded.
        lineageCeiling = intent.lineageCeilingUsd ?? defaultLineageCeilingUsd;
        if (rootCapabilityCeiling) {
          effectiveCaps = declaredCaps.filter((c) => rootCapabilityCeiling.includes(c));
        }
      } else {
        // Non-root admission: a real parent MUST be named and resolvable. An
        // `agent` source may NEVER claim roothood; a root-minting source may
        // still launch a child by naming a real parentId.
        if (claimsRoot) {
          // A non-root-minting source (agent) tried to mint a root, or named
          // 'operator'/no parent — forged/absent parent. Reject.
          return refuse(id, resolvedRootId, intent.parentId ?? 'operator', 0, intent, effectiveCaps, bond,
            `source '${intent.source}' may not mint a root; a real parent launch id is required (LINEAGE_BINDING)`, at);
        }
        const namedParentId = intent.parentId!;
        const parentRow = selectByIdStmt.get(namedParentId);
        if (!parentRow) {
          return refuse(id, resolvedRootId, namedParentId, 0, intent, effectiveCaps, bond,
            `parent launch '${namedParentId}' not found`, at);
        }
        const parent = rowToLaunch(parentRow);
        // I7 — a child of a halted/terminal parent may not spawn.
        if (parent.state === 'halted') {
          return refuse(id, parent.rootId, namedParentId, parent.depth + 1, intent, effectiveCaps, bond,
            `parent launch '${namedParentId}' is halted (HALT_IS_TOTAL)`, at);
        }
        if (LAUNCH_TERMINAL_STATES.includes(parent.state)) {
          return refuse(id, parent.rootId, namedParentId, parent.depth + 1, intent, effectiveCaps, bond,
            `parent launch '${namedParentId}' is terminal (${parent.state})`, at);
        }
        // Lineage is DERIVED from the durable parent, never from the intent.
        parentId = namedParentId;
        depth = parent.depth + 1;
        parentCaps = parent.capabilities;
        resolvedRootId = parent.rootId;
        // A child inherits the lineage ceiling established at the root (ignore any
        // caller-supplied lineageCeilingUsd — it cannot widen the subtree budget).
        lineageCeiling = parent.lineageCeilingUsd ?? null;
      }

      // I3 — DEPTH_CAPPED.
      if (depth > maxDepth) {
        return refuse(id, resolvedRootId, parentId, depth, intent, effectiveCaps, bond,
          `depth ${depth} exceeds cap ${maxDepth} (DEPTH_CAPPED)`, at);
      }

      // I6 — CAPABILITY_SCOPED. A child's caps must be a subset of its parent's,
      // and empty/absent child caps INHERIT the parent's effective caps — they do
      // NOT fall through to the spawner's full-tier default. This closes the
      // capability-DOWNGRADE escalation: declaring `capabilities:[]` from a
      // read-only parent no longer silently widens the child to full write+spawn
      // (white-hat HIGH #1).
      if (parentCaps) {
        if (declaredCaps.length === 0) {
          // Inherit the parent's effective caps verbatim.
          effectiveCaps = parentCaps;
        } else {
          const widened = declaredCaps.filter((c) => !parentCaps!.includes(c));
          if (widened.length > 0) {
            return refuse(id, resolvedRootId, parentId, depth, intent, declaredCaps, bond,
              `capabilities widen beyond parent [${widened.join(', ')}] (CAPABILITY_SCOPED)`, at);
          }
          effectiveCaps = declaredCaps;
        }
      }
      const capabilities = effectiveCaps;

      // Register the lineage scope ceiling once (idempotent) so the breaker can
      // reserve against it. The global scope is registered by the caller.
      breaker.registerScope(lineageScope(resolvedRootId), lineageCeiling);

      // I5 — GLOBAL_BREAKER (and any open lineage breaker): no admission while open.
      if (breaker.isOpen(lineageScope(resolvedRootId))) {
        return refuse(id, resolvedRootId, parentId, depth, intent, capabilities, bond,
          `breaker open for scope (GLOBAL_BREAKER)`, at);
      }

      // I4 — LINEAGE_BUDGET_CONSERVED: reserve the bond against the shared
      // ceiling *inside this transaction*. If it would exceed, refuse — and the
      // reservation never lands, so two concurrent children can't both pass.
      let reserved = 0;
      if (bond > 0) {
        const ok = breaker.reserve(lineageScope(resolvedRootId), bond);
        if (!ok) {
          return refuse(id, resolvedRootId, parentId, depth, intent, capabilities, bond,
            `lineage budget would be exceeded by $${bond.toFixed(4)} (LINEAGE_BUDGET_CONSERVED)`, at);
        }
        // Also reserve against the global ceiling (no-op if global is unbounded).
        if (!breaker.reserve(GLOBAL_SCOPE, bond)) {
          breaker.release(lineageScope(resolvedRootId), bond);
          return refuse(id, resolvedRootId, parentId, depth, intent, capabilities, bond,
            `global budget would be exceeded by $${bond.toFixed(4)} (GLOBAL_BREAKER)`, at);
        }
        reserved = bond;
      }

      // All gates passed → write the launch row in `admitted`.
      insertStmt.run(
        id,
        resolvedRootId,
        parentId,
        depth,
        intent.goal,
        intent.source,
        intent.backend,
        'admitted',
        JSON.stringify(capabilities),
        bond > 0 ? bond : null,
        lineageCeiling,
        intent.worktree ?? 'inherit',
        intent.mergePolicy ?? 'review',
        at,
      );
      return { launch: get(id)!, reserved };
    });

    return tx();
  }

  /** Write a `refused` row and return it (called inside the admission txn). */
  function refuse(
    id: string,
    rootId: string,
    parentId: string,
    depth: number,
    intent: LaunchIntent,
    capabilities: string[],
    bond: number,
    reason: string,
    at: number,
  ): { launch: Launch; reserved: number } {
    insertStmt.run(
      id,
      rootId,
      parentId,
      depth,
      intent.goal,
      intent.source,
      intent.backend,
      'refused',
      JSON.stringify(capabilities),
      bond > 0 ? bond : null,
      intent.lineageCeilingUsd ?? null,
      intent.worktree ?? 'inherit',
      intent.mergePolicy ?? 'review',
      at,
    );
    setStateStmt.run('refused', null, null, null, null, reason, at, id);
    return { launch: get(id)!, reserved: 0 };
  }

  /**
   * Translate a LaunchIntent into the spawner spec. This is the ONE place that
   * builds the spec; the golden test pins these fields so the merged path stays
   * byte-identical to what the legacy sortie/orchestrator callsites produced.
   */
  function intentToSpawnSpec(
    intent: LaunchIntent,
    workdir: string | undefined,
    effectiveCaps?: string[],
  ): Record<string, unknown> {
    const spec: Record<string, unknown> = {
      backend: intent.backend,
      task: intent.task ?? intent.goal,
    };
    if (intent.model != null) spec.model = intent.model;
    if (intent.modelTier != null) spec.modelTier = intent.modelTier;
    if (intent.identity != null) spec.identity = intent.identity;
    if (intent.purpose != null) spec.purpose = intent.purpose;
    if (workdir != null) spec.workdir = workdir;
    if (intent.allowedTools != null) spec.allowedTools = intent.allowedTools;
    const deadlineMs = intent.deadlineMs ?? intent.timeoutMs;
    if (deadlineMs != null) spec.deadlineMs = deadlineMs;
    if (intent.maxTokens != null) spec.maxTokens = intent.maxTokens;
    if (intent.budgetUsd != null) spec.budgetUsd = intent.budgetUsd;
    if (intent.bondUsd != null) spec.bondUsd = intent.bondUsd;
    if (intent.harborName != null) spec.harborName = intent.harborName;
    // ALWAYS forward the ADMITTED launch's effective caps (inherited / floored /
    // ceiling-bounded), not the raw intent caps. A child that declared `[]` and
    // inherited `['read']` must spawn with `['read']`, never the spawner's
    // full-tier default (white-hat HIGH #1). Falls back to the raw intent caps
    // for the golden/pure path that calls this without an admitted launch.
    const caps = effectiveCaps ?? intent.capabilities;
    if (caps != null && caps.length > 0) {
      spec.capabilities = caps;
    }
    if (intent.allowSharedCheckout != null) spec.allowSharedCheckout = intent.allowSharedCheckout;
    // ADR-0060 dispatch passthrough: forward env + tube channel ONLY when present
    // so the golden spec stays byte-identical for every non-dispatch caller (the
    // sortie/orchestrator paths set neither). Additive-only.
    if (intent.env != null) spec.env = intent.env;
    if (intent.tubeChannel != null) spec.tubeChannel = intent.tubeChannel;
    return spec;
  }

  function setState(id: string, state: LaunchState, patch: Partial<{
    agentId: string | null;
    costUsd: number | null;
    resultArtifact: string | null;
    errorMessage: string | null;
    settledAt: number | null;
  }> = {}): void {
    setStateStmt.run(
      state,
      patch.agentId ?? null,
      patch.costUsd ?? null,
      patch.resultArtifact ?? null,
      patch.errorMessage ?? null,
      null,
      patch.settledAt ?? null,
      id,
    );
    emit('fleet:state', { launchId: id, state });
  }

  /**
   * The ONE spawn primitive. Admit → embody → run → produce/fail → settle.
   * The only caller of `spawner.spawn`.
   */
  async function launch(intent: LaunchIntent): Promise<LaunchResult> {
    if (!intent.goal || typeof intent.goal !== 'string' || !intent.goal.trim()) {
      throw new Error('conductor.launch: goal is required');
    }
    if (!intent.backend || typeof intent.backend !== 'string') {
      throw new Error('conductor.launch: backend is required');
    }

    // ── Admission (all gates, one transaction) ──────────────────────────────
    const { launch: admitted, reserved } = admit(intent);
    if (admitted.state === 'refused') {
      emit('fleet:launch', { launchId: admitted.id, state: 'refused', reason: admitted.refusedReason });
      return { launch: admitted, admitted: false, refusedReason: admitted.refusedReason, spawn: null };
    }
    emit('fleet:launch', { launchId: admitted.id, rootId: admitted.rootId, depth: admitted.depth, state: 'admitted' });

    // ── Embodiment ──────────────────────────────────────────────────────────
    // I2 — NO_SPAWN_ON_MAIN. For `worktree:'create'`, mint an off-main worktree;
    // for `inherit`, the workdir must not be a main checkout (unless explicitly
    // opted in for a read-only observer).
    let workdir = intent.workdir;
    if (intent.worktree === 'create') {
      // mintWorktree may be async (real git worktree add). Await it so the
      // NO_SPAWN_ON_MAIN check below sees the freshly-minted off-main workdir.
      // CRITICAL: a real `gitWorktreeAdd` can THROW (branch already exists, a
      // stale `.git/worktrees` lock, a full disk, a slow/wedged NFS mount). If
      // we let that escape `launch()`, the reservation reserved at admission is
      // NEVER released and the row stays `'admitted'` forever — over time the
      // leaked reservations wall off the lineage/global ceiling and every
      // subsequent dispatch is refused with LINEAGE_BUDGET_CONSERVED /
      // GLOBAL_BREAKER. Mirror the isMainCheckout release below and the
      // spawn-threw handler: release the reservation, settle the row `'failed'`,
      // and return a failed LaunchResult rather than throwing.
      try {
        workdir = await mintWorktree(admitted, intent);
      } catch (err) {
        if (reserved > 0) {
          breaker.release(lineageScope(admitted.rootId), reserved);
          breaker.release(GLOBAL_SCOPE, reserved);
        }
        setState(admitted.id, 'failed', {
          errorMessage: `mintWorktree failed: ${err instanceof Error ? err.message : String(err)}`,
          settledAt: now(),
        });
        return { launch: get(admitted.id)!, admitted: true, refusedReason: null, spawn: null };
      }
    }
    if (!intent.allowSharedCheckout && isMainCheckout(workdir)) {
      // Release the reservation; this admission will not spawn.
      if (reserved > 0) {
        breaker.release(lineageScope(admitted.rootId), reserved);
        breaker.release(GLOBAL_SCOPE, reserved);
      }
      setState(admitted.id, 'failed', {
        errorMessage: `refused: workdir '${workdir ?? '(cwd)'}' is a main checkout (NO_SPAWN_ON_MAIN)`,
        settledAt: now(),
      });
      const failed = get(admitted.id)!;
      return { launch: failed, admitted: true, refusedReason: failed.errorMessage, spawn: null };
    }
    setState(admitted.id, 'embodied');

    // ── Run ──────────────────────────────────────────────────────────────────
    setState(admitted.id, 'running');
    // Forward the ADMITTED launch's effective caps (inherited/floored/bounded),
    // not the raw intent caps — see intentToSpawnSpec.
    const spec = intentToSpawnSpec(intent, workdir, admitted.capabilities);
    let spawnResult: Awaited<ReturnType<ConductorSpawner['spawn']>>;
    try {
      spawnResult = await spawner.spawn(spec);
    } catch (err) {
      // Spawn threw — book the outcome as a failure, release the reservation.
      breaker.recordOutcome(lineageScope(admitted.rootId), {
        success: false,
        realizedUsd: 0,
        reservedUsd: reserved,
      });
      breaker.recordOutcome(GLOBAL_SCOPE, { success: false, realizedUsd: 0, reservedUsd: reserved });
      setState(admitted.id, 'failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
        settledAt: now(),
      });
      return { launch: get(admitted.id)!, admitted: true, refusedReason: null, spawn: null };
    }

    // ── Halt-while-pending honor ───────────────────────────────────────────────
    // If an operator HALT landed while this spawn was still in flight, we now —
    // and only now — hold the body's agentId. Honor the pending cancellation:
    // signal the body, refund (never slash) its bond, release the reservation,
    // and leave the launch in `halted` (already set by halt()) for salvage.
    if (pendingCancels.has(admitted.id)) {
      pendingCancels.delete(admitted.id);
      refundBondsForAgent(spawnResult.agentId);
      try {
        spawner.cancel(spawnResult.agentId);
      } catch {
        /* cancellation is best-effort; the worktree + transcript are preserved to salvage */
      }
      if (reserved > 0) {
        breaker.release(lineageScope(admitted.rootId), reserved);
        breaker.release(GLOBAL_SCOPE, reserved);
      }
      // Record the body's agentId on the (already-halted) row for inspection.
      setStateStmt.run('halted', spawnResult.agentId, null, null, null, null, now(), admitted.id);
      return { launch: get(admitted.id)!, admitted: true, refusedReason: null, spawn: spawnResult };
    }

    // ── Settle ────────────────────────────────────────────────────────────────
    const success = spawnResult.status === 'completed';
    // Realized cost is carried on the spawn telemetry when present. CRITICAL: if
    // the spawner reports NO cost (telemetry absent / late), we floor the realized
    // amount at the bond we reserved for this launch, so the lineage/global budget
    // breaker still accrues committed spend. Otherwise a child that reports cost
    // late-or-never would forever read $0 and a runaway could evade the budget
    // breaker entirely (red-team Attack 1 / readCost-returns-0). The bond is the
    // honest lower bound on what this launch committed.
    const realizedUsd = readCost(spawnResult, reserved);
    const disposition = breaker.recordOutcome(lineageScope(admitted.rootId), {
      success,
      realizedUsd,
      reservedUsd: reserved,
    });
    breaker.recordOutcome(GLOBAL_SCOPE, { success, realizedUsd, reservedUsd: reserved });

    setState(admitted.id, success ? 'produced' : 'failed', {
      agentId: spawnResult.agentId,
      costUsd: realizedUsd > 0 ? realizedUsd : null,
      errorMessage: spawnResult.error ?? null,
      settledAt: success ? null : now(),
    });

    const effectiveMergePolicy = intent.mergePolicy ?? 'review';

    // A `mergePolicy:'never'` produced launch settles immediately (no review gate).
    if (success && effectiveMergePolicy === 'never') {
      setState(admitted.id, 'settled', { settledAt: now() });
    }

    // ── Publish a reviewable artifact (ADR-0060 dispatch fold-in) ────────────────
    // ONLY on the `review` path, ONLY on success, ONLY when a publisher is wired.
    // Why review-only: a `never` launch produced no PR-able review gate (it has
    // already settled above) and an `auto` launch is harbormaster's job, not the
    // Conductor's; a `review` launch is exactly the dispatch case — push the
    // branch and open a draft PR for the operator. This is a PURE SIDE-EFFECT,
    // deliberately OUTSIDE the cost breaker and bonds: publishing a PR is not a
    // spawn and must never accrue against the budget or trip the breaker. A throw
    // here (push rejected, gh down) MUST NOT lose the launch nor flip a green run
    // to failed — we record `resultArtifact: null` and keep the produced state.
    if (success && effectiveMergePolicy === 'review' && publishArtifact) {
      let artifactUrl: string | null = null;
      try {
        // BOUND the publish: a hung push/PR (the execFile awaits in
        // gitPushBranch/openDraftPr have no native timeout) would otherwise hold
        // this launch's in-flight slot until the OS TCP timeout. The timeout
        // surfaces as a throw, caught below exactly like any publish failure —
        // resultArtifact stays null, the run stays produced, the slot frees.
        artifactUrl = await withTimeout(
          publishArtifact(get(admitted.id)!, intent, spawnResult),
          publishTimeoutMs,
          'publishArtifact',
        );
      } catch (err) {
        // Note the failure on the launch row WITHOUT changing its (produced)
        // state. The operator can still find the branch; the missing PR is
        // surfaced as an error note, not a lost or failed launch.
        const note = `artifact publish failed: ${err instanceof Error ? err.message : String(err)}`;
        setState(admitted.id, get(admitted.id)!.state, { errorMessage: note, resultArtifact: null });
        artifactUrl = null;
      }
      if (artifactUrl) {
        // Keep the CURRENT state (produced); only attach the artifact URL.
        setState(admitted.id, get(admitted.id)!.state, { resultArtifact: artifactUrl });
      }
    }

    // If THIS outcome tripped the breaker, broadcast and (for budget) signal the
    // grace UX. Error-rate trips to PAUSE only; budget trips arm pause+refund.
    if (disposition) {
      emit('fleet:state', {
        breaker: 'open',
        scope: lineageScope(admitted.rootId),
        disposition,
      });
    }

    return { launch: get(admitted.id)!, admitted: true, refusedReason: null, spawn: spawnResult };
  }

  /**
   * Operator HALT on a scope (I7). Atomic w.r.t. admission: the breaker is
   * opened first (so no new child is admitted), then every running launch in the
   * scope is SIGTERM→SIGKILLed via the spawner. Operator halt ALWAYS REFUNDS —
   * we refund the bond BEFORE cancelling so the spawner's cancellation path sees the bond
   * already resolved and does NOT slash it (mirrors the panic path).
   */
  function halt(scope: { rootId?: string } = {}): { halted: string[] } {
    // Open the breaker scope first → admission stops immediately (I7 atomicity).
    // CRITICAL: use the breaker's operator-trip, which flips `open` WITHOUT
    // touching the scope's ceiling/realized/reserved accounting. A later resume
    // (close) restores the scope to exactly its pre-halt budget cap. The old
    // approach (`registerScope(scope, null)` then trip) erased the lineage cap
    // permanently — replacing a real budget with "unbounded" on resume.
    const target = scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE;
    breaker.forceOpen(target, 'operator-halt', 'pause');

    const runningRows = selectRunningStmt.all() as LaunchRow[];
    const targets = runningRows
      .map(rowToLaunch)
      .filter((l) => (scope.rootId ? l.rootId === scope.rootId : true));

    // CRITICAL ORDERING (mirrors routes/panic.ts): refund the live bonds of the
    // agents we're about to halt BEFORE cancelling them. spawner.cancel() slashes the
    // bond as its cleanup step by default; refunding first makes that slash a
    // no-op, so operator halt ALWAYS REFUNDS and never slashes.
    const haltedIds: string[] = [];
    for (const l of targets) {
      if (l.agentId) {
        // The body's agentId is already known → refund-then-cancel synchronously.
        refundBondsForAgent(l.agentId);
        try {
          spawner.cancel(l.agentId);
        } catch {
          /* cancellation is best-effort; the worktree+transcript are preserved to salvage */
        }
        // Release the reservation here: the body is resolved, so the run path's
        // pending-cancel branch will NOT fire a second release for this launch.
        //
        // INVARIANT (why the DB row is the correct release source): at admission
        // the breaker RESERVED exactly `effectiveBond(intent)` against both the
        // lineage and global scopes, and that SAME value was persisted to the row
        // as `bond_usd` (admit() writes `bondUsd: reserved`). So `l.bondUsd` IS
        // the outstanding reservation for this launch — releasing it unwinds the
        // admission reservation precisely, with no drift. A null/0 stored bond
        // means NOTHING was reserved (the legacy `defaultBondUsd:0` path), so the
        // guard correctly skips the release. We release the stored amount as-is;
        // `breaker.release` floors at 0, so even a stale over-release cannot push
        // the scope's reserved accounting negative.
        if (l.bondUsd) {
          breaker.release(lineageScope(l.rootId), l.bondUsd);
          breaker.release(GLOBAL_SCOPE, l.bondUsd);
        }
      } else {
        // The spawn is still in flight; we do not hold the agentId yet. Record an
        // intent-to-cancel — the run path honors it the instant the spawn resolves
        // (refund, then signal the just-born body), so HALT stays total (I7). Do
        // NOT release the reservation here: the run path's pending-cancel branch
        // releases it exactly once when the spawn resolves (no double-release).
        pendingCancels.add(l.id);
      }
      setState(l.id, 'halted', { settledAt: now() });
      haltedIds.push(l.id);
    }
    emit('fleet:state', { halted: scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE, count: haltedIds.length });
    return { halted: haltedIds };
  }

  /**
   * Soft pause: stop admitting in a scope; leave running agents alive. Uses the
   * breaker's operator-trip so the scope's ceiling/realized/reserved accounting
   * is preserved — a later resume restores the exact pre-pause budget cap and
   * does NOT brick the fleet with a zeroed ceiling.
   */
  function pause(scope: { rootId?: string } = {}): void {
    const target = scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE;
    breaker.forceOpen(target, 'operator-pause', 'pause');
    emit('fleet:state', { paused: target });
  }

  /** Resume a paused/halted scope (operator). */
  function resume(scope: { rootId?: string } = {}): void {
    breaker.close(scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE);
    emit('fleet:state', { resumed: scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE });
  }

  /** Render the lineage tree for `pd fleet tree <rootId>` / `inspect`. */
  function tree(rootId: string): Launch[] {
    return (selectByRootStmt.all(rootId) as LaunchRow[]).map(rowToLaunch);
  }

  /**
   * Every launch across all roots, newest first (bounded, hard cap 1000).
   * Powers the operator console's Conductor pane (ADR-0060): the CLI renders one
   * lineage at a time via tree(rootId); the console needs every active subtree at
   * once without first knowing a rootId. The pane groups the flat list by rootId.
   */
  function allLaunches(limit = 200): Launch[] {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 200;
    return (selectAllStmt.all(n) as LaunchRow[]).map(rowToLaunch);
  }

  /** Register the global ceiling at startup (null = unbounded). */
  function setGlobalCeiling(ceilingUsd: number | null): void {
    breaker.registerScope(GLOBAL_SCOPE, ceilingUsd);
  }

  return {
    launch,
    halt,
    pause,
    resume,
    tree,
    allLaunches,
    get,
    setGlobalCeiling,
    breaker,
    /** Exposed for tests + the golden spec assertion. */
    intentToSpawnSpec,
  };
}

export type Conductor = ReturnType<typeof createConductor>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function readCost(spawnResult: Record<string, unknown>, reservedFloorUsd = 0): number {
  const t = spawnResult.telemetry as { costUsd?: number } | null | undefined;
  if (t && typeof t.costUsd === 'number' && Number.isFinite(t.costUsd)) return t.costUsd;
  // No reported cost → charge at least the reserved bond so the budget breaker
  // accrues committed spend rather than reading $0 forever (breaker-evasion fix).
  return reservedFloorUsd > 0 && Number.isFinite(reservedFloorUsd) ? reservedFloorUsd : 0;
}

/**
 * Default NO_SPAWN_ON_MAIN probe. Conservative: treat a workdir whose `.git` is
 * a directory (a real checkout, not a worktree's `.git` file) as "main". Tests
 * inject their own probe; the daemon wires the real `assessSpawnIsolation`.
 */
function defaultIsMainCheckout(_workdir: string | undefined): boolean {
  // Without the injected probe we cannot know; default to NOT-main so the
  // spawner's own `assessSpawnIsolation` remains the authoritative gate (it
  // already refuses main checkouts). The Conductor's gate is defense-in-depth.
  return false;
}
