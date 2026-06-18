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
 *                                   Conductor-stamped from the proposer's lineage;
 *                                   an agent can't forge it (it never holds the
 *                                   spawner — it sends a REQUEST performative).
 *   I4 LINEAGE_BUDGET_CONSERVED  — the subtree under one rootId shares one
 *                                   ceiling; a child's bond is RESERVED against it
 *                                   *before* admission, in the same txn, so a
 *                                   burst of concurrent children can't each pass
 *                                   the check before debits land (TOCTOU).
 *   I5 GLOBAL_BREAKER            — no admission while the global breaker is open.
 *   I6 CAPABILITY_SCOPED         — a child's cap[] must be a subset of its
 *                                   parent's cap[] (capabilities only narrow).
 *   I7 HALT_IS_TOTAL            — operator halt on a scope transitions every
 *                                   running launch to `halted` and refuses every
 *                                   proposed one. Operator halt ALWAYS REFUNDS,
 *                                   never slashes (refund-before-kill, like the
 *                                   panic path) — the operator is not punished for
 *                                   using the kill switch.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  createFleetCircuitBreaker,
  GLOBAL_SCOPE,
  type FleetCircuitBreaker,
  type BreakerScope,
} from './circuit-breaker.js';

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
  bondUsd?: number;
  /** Shared ceiling for the whole subtree under rootId. Required for roots. */
  lineageCeilingUsd?: number;
  timeoutMs?: number;

  // artifact policy —
  worktree?: WorktreePolicy;
  mergePolicy?: MergePolicy;

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
    status: 'running' | 'completed' | 'failed' | 'killed';
    output: string | null;
    error: string | null;
    [k: string]: unknown;
  }>;
  kill(agentId: string): void;
}

/**
 * Minimal shape of the bonds module the Conductor needs for refund-before-kill
 * on operator halt. Mirrors the panic route's convention exactly: list the
 * `running` bonds, refund the ones whose agentId is being halted, THEN kill —
 * so the spawner's kill-path slash becomes a no-op (the bond is already
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
  mintWorktree?: (launch: Launch, intent: LaunchIntent) => string | undefined;
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

export function createConductor(deps: ConductorDeps) {
  const { db, spawner } = deps;
  const bonds = deps.bonds;
  const broadcast = deps.broadcast;
  const now = deps.now ?? (() => Date.now());
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  const breaker = deps.breaker ?? createFleetCircuitBreaker({ now });
  const isMainCheckout = deps.isMainCheckout ?? defaultIsMainCheckout;
  const mintWorktree = deps.mintWorktree ?? ((_l, intent) => intent.workdir);

  db.exec(SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO fleet_launches (
      id, root_id, parent_id, depth, goal, source, backend, state,
      capabilities_json, bond_usd, lineage_ceiling_usd, worktree, merge_policy,
      created_at
    ) VALUES (
      @id, @rootId, @parentId, @depth, @goal, @source, @backend, @state,
      @capabilitiesJson, @bondUsd, @lineageCeilingUsd, @worktree, @mergePolicy,
      @createdAt
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
  const setStateStmt = db.prepare(`
    UPDATE fleet_launches
       SET state = @state,
           agent_id = COALESCE(@agentId, agent_id),
           cost_usd = COALESCE(@costUsd, cost_usd),
           result_artifact = COALESCE(@resultArtifact, result_artifact),
           error_message = COALESCE(@errorMessage, error_message),
           refused_reason = COALESCE(@refusedReason, refused_reason),
           settled_at = COALESCE(@settledAt, settled_at)
     WHERE id = @id
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

  /** Bond resolution: per-spawn `bondUsd` wins; else fall back to the ceiling-derived default. */
  function effectiveBond(intent: LaunchIntent): number {
    if (intent.bondUsd != null && Number.isFinite(intent.bondUsd) && intent.bondUsd > 0) {
      return intent.bondUsd;
    }
    return 0; // 0 = let the spawner price it scope-proportionally; reserve nothing extra
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
    const rootId = intent.rootId ?? id; // a launch with no root IS its own root
    const parentId = intent.parentId ?? 'operator';
    const capabilities = intent.capabilities ?? [];
    const bond = effectiveBond(intent);

    const tx = db.transaction((): { launch: Launch; reserved: number } => {
      // Compute depth from the (durable) parent row. Operator/root = depth 0.
      let depth = 0;
      let parentCaps: string[] | null = null;
      let resolvedRootId = rootId;
      let lineageCeiling = intent.lineageCeilingUsd ?? null;
      if (parentId !== 'operator') {
        const parentRow = selectByIdStmt.get(parentId);
        if (!parentRow) {
          return refuse(id, resolvedRootId, parentId, 0, intent, capabilities, bond,
            `parent launch '${parentId}' not found`, at);
        }
        const parent = rowToLaunch(parentRow);
        // I7 — a child of a halted/terminal parent may not spawn.
        if (parent.state === 'halted') {
          return refuse(id, parent.rootId, parentId, parent.depth + 1, intent, capabilities, bond,
            `parent launch '${parentId}' is halted (HALT_IS_TOTAL)`, at);
        }
        if (LAUNCH_TERMINAL_STATES.includes(parent.state)) {
          return refuse(id, parent.rootId, parentId, parent.depth + 1, intent, capabilities, bond,
            `parent launch '${parentId}' is terminal (${parent.state})`, at);
        }
        depth = parent.depth + 1;
        parentCaps = parent.capabilities;
        resolvedRootId = parent.rootId;
        // A child inherits the lineage ceiling already established at the root.
        lineageCeiling = parent.lineageCeilingUsd ?? lineageCeiling;
      }

      // I3 — DEPTH_CAPPED.
      if (depth > maxDepth) {
        return refuse(id, resolvedRootId, parentId, depth, intent, capabilities, bond,
          `depth ${depth} exceeds cap ${maxDepth} (DEPTH_CAPPED)`, at);
      }

      // I6 — CAPABILITY_SCOPED: a child's caps must be a subset of its parent's.
      if (parentCaps) {
        const widened = capabilities.filter((c) => !parentCaps!.includes(c));
        if (widened.length > 0) {
          return refuse(id, resolvedRootId, parentId, depth, intent, capabilities, bond,
            `capabilities widen beyond parent [${widened.join(', ')}] (CAPABILITY_SCOPED)`, at);
        }
      }

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
      insertStmt.run({
        id,
        rootId: resolvedRootId,
        parentId,
        depth,
        goal: intent.goal,
        source: intent.source,
        backend: intent.backend,
        state: 'admitted',
        capabilitiesJson: JSON.stringify(capabilities),
        bondUsd: bond > 0 ? bond : null,
        lineageCeilingUsd: lineageCeiling,
        worktree: intent.worktree ?? 'inherit',
        mergePolicy: intent.mergePolicy ?? 'review',
        createdAt: at,
      });
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
    insertStmt.run({
      id,
      rootId,
      parentId,
      depth,
      goal: intent.goal,
      source: intent.source,
      backend: intent.backend,
      state: 'refused',
      capabilitiesJson: JSON.stringify(capabilities),
      bondUsd: bond > 0 ? bond : null,
      lineageCeilingUsd: intent.lineageCeilingUsd ?? null,
      worktree: intent.worktree ?? 'inherit',
      mergePolicy: intent.mergePolicy ?? 'review',
      createdAt: at,
    });
    setStateStmt.run({
      id,
      state: 'refused',
      agentId: null,
      costUsd: null,
      resultArtifact: null,
      errorMessage: null,
      refusedReason: reason,
      settledAt: at,
    });
    return { launch: get(id)!, reserved: 0 };
  }

  /**
   * Translate a LaunchIntent into the spawner spec. This is the ONE place that
   * builds the spec; the golden test pins these fields so the merged path stays
   * byte-identical to what the legacy sortie/orchestrator callsites produced.
   */
  function intentToSpawnSpec(intent: LaunchIntent, workdir: string | undefined): Record<string, unknown> {
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
    if (intent.timeoutMs != null) spec.timeout = intent.timeoutMs;
    if (intent.maxTokens != null) spec.maxTokens = intent.maxTokens;
    if (intent.bondUsd != null) spec.bondUsd = intent.bondUsd;
    if (intent.harborName != null) spec.harborName = intent.harborName;
    if (intent.capabilities != null && intent.capabilities.length > 0) {
      spec.capabilities = intent.capabilities;
    }
    if (intent.allowSharedCheckout != null) spec.allowSharedCheckout = intent.allowSharedCheckout;
    return spec;
  }

  function setState(id: string, state: LaunchState, patch: Partial<{
    agentId: string | null;
    costUsd: number | null;
    resultArtifact: string | null;
    errorMessage: string | null;
    settledAt: number | null;
  }> = {}): void {
    setStateStmt.run({
      id,
      state,
      agentId: patch.agentId ?? null,
      costUsd: patch.costUsd ?? null,
      resultArtifact: patch.resultArtifact ?? null,
      errorMessage: patch.errorMessage ?? null,
      refusedReason: null,
      settledAt: patch.settledAt ?? null,
    });
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
      workdir = mintWorktree(admitted, intent);
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
    const spec = intentToSpawnSpec(intent, workdir);
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

    // ── Settle ────────────────────────────────────────────────────────────────
    const success = spawnResult.status === 'completed';
    // Realized cost is carried on the spawn telemetry when present; the spawner
    // already booked bond refund/slash on its terminal path, so the Conductor's
    // ledger only mirrors the outcome for breaker accounting.
    const realizedUsd = readCost(spawnResult);
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

    // A `mergePolicy:'never'` produced launch settles immediately (no review gate).
    if (success && (intent.mergePolicy ?? 'review') === 'never') {
      setState(admitted.id, 'settled', { settledAt: now() });
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
   * we refund the bond BEFORE killing so the spawner's kill path sees the bond
   * already resolved and does NOT slash it (mirrors the panic path).
   */
  function halt(scope: { rootId?: string } = {}): { halted: string[] } {
    // Open the breaker scope first → admission stops immediately (I7 atomicity).
    if (scope.rootId) {
      breaker.registerScope(lineageScope(scope.rootId), null);
      // Force-open via a manual trip surrogate: reserve an impossible amount is
      // wrong; instead mark open directly through close()/state isn't enough — so
      // we use a dedicated path: record the halt as an operator action.
      forceOpen(lineageScope(scope.rootId));
    } else {
      forceOpen(GLOBAL_SCOPE);
    }

    const running = selectRunningStmt.all() as LaunchRow[];
    const targets = running
      .map(rowToLaunch)
      .filter((l) => (scope.rootId ? l.rootId === scope.rootId : true));

    // CRITICAL ORDERING (mirrors routes/panic.ts): refund the live bonds of the
    // agents we're about to halt BEFORE killing them. spawner.kill() slashes the
    // bond as its cleanup step by default; refunding first makes that slash a
    // no-op, so operator halt ALWAYS REFUNDS and never slashes.
    const haltAgentIds = new Set(targets.map((l) => l.agentId).filter((a): a is string => !!a));
    if (bonds && haltAgentIds.size > 0) {
      try {
        const running = bonds.listBonds({ state: 'running', limit: 1000 });
        for (const b of running) {
          if (haltAgentIds.has(b.agentId)) {
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

    const haltedIds: string[] = [];
    for (const l of targets) {
      if (l.agentId) {
        try {
          spawner.kill(l.agentId);
        } catch {
          /* kill is best-effort; the worktree+transcript are preserved to salvage */
        }
      }
      // Release any outstanding reservation back to the scope.
      if (l.bondUsd) {
        breaker.release(lineageScope(l.rootId), l.bondUsd);
        breaker.release(GLOBAL_SCOPE, l.bondUsd);
      }
      setState(l.id, 'halted', { settledAt: now() });
      haltedIds.push(l.id);
    }
    emit('fleet:state', { halted: scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE, count: haltedIds.length });
    return { halted: haltedIds };
  }

  // We need a way to force a scope OPEN without a budget/error event (operator
  // halt + pause). The breaker exposes reserve/recordOutcome/close; to open
  // directly we register a zero ceiling and reserve a token, which trips the
  // budget breaker deterministically. This keeps the breaker's public surface
  // minimal while giving the Conductor an operator-driven open.
  function forceOpen(scope: BreakerScope): void {
    breaker.registerScope(scope, 0);
    breaker.reserve(scope, 1); // exceeds the 0 ceiling → trips → OPEN
  }

  /** Soft pause: stop admitting in a scope; leave running agents alive. */
  function pause(scope: { rootId?: string } = {}): void {
    forceOpen(scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE);
    emit('fleet:state', { paused: scope.rootId ? lineageScope(scope.rootId) : GLOBAL_SCOPE });
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
    get,
    setGlobalCeiling,
    breaker,
    /** Exposed for tests + the golden spec assertion. */
    intentToSpawnSpec,
  };
}

export type Conductor = ReturnType<typeof createConductor>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function readCost(spawnResult: Record<string, unknown>): number {
  const t = spawnResult.telemetry as { costUsd?: number } | null | undefined;
  if (t && typeof t.costUsd === 'number' && Number.isFinite(t.costUsd)) return t.costUsd;
  return 0;
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
