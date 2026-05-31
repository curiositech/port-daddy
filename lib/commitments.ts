/**
 * Durable Commitments — the obligation half of agent accountability (ADR-0041).
 *
 * Resurrection (`lib/resurrection.ts`) asks *"is the agent alive?"* — a heartbeat
 * watchdog. This module is its dual: a durable record of an agent's PROMISE,
 * monitored against a clock the agent does not set. Resurrection watches liveness;
 * commitments watch whether the agent KEPT ITS WORD.
 *
 * A commitment encodes **commitment as a persistent goal** (Cohen & Levesque 1990,
 * *Intention Is Choice with Commitment* — a goal dropped only when achieved,
 * believed impossible, or unmotivated). The three `*_check` columns are the
 * executable drop conditions; firing any one transitions the row's `state`.
 *
 * Five-laws hardening enforced HERE (the rest live in the monitor + future ADRs):
 *
 *   Law 1 (load-bearing fact outside agent control): `due_at` is DERIVED by this
 *     module from a policy keyed on the commitment scope. The agent picks the
 *     *work*; the daemon picks the *deadline*. We never trust an agent-supplied
 *     absolute deadline — that is the property that makes resurrection
 *     Goodhart-resistant, preserved here.
 *
 *   Law 2 (closure binds to an oracle): `close()` REFUSES to move a row to 'done'
 *     without a non-empty `closed_by_oracle_ref` — a released claim, a merged
 *     commit SHA, a passing test id, or a satisfied Arbiter sub-check. Free-text
 *     "Result: …" notes do not close a commitment.
 *
 * Mirrors the module-factory pattern: `createCommitments(db)` returns a methods
 * object, self-initializes its table with idempotent CREATE TABLE IF NOT EXISTS,
 * and uses prepared statements throughout (see `lib/roadmap-items.ts`).
 *
 * Out of scope for this slice (separate roadmap items / ADRs):
 *   - sanction ladder (`graduated-sanction-ladder`)
 *   - accountability ledger (`accountability-ledger`)
 *   - non-forgeable actor identity (ADR-0040) — owner_actor_id is the
 *     self-asserted session/actor id for now. See TODO below.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/** A goal is dropped only when achieved, impossible, or unmotivated. */
export type CommitmentState = 'open' | 'done' | 'abandoned' | 'superseded';

/**
 * single-minded: drop only on achievement/impossibility (Cohen & Levesque).
 * open-minded: also droppable when the motivating reason lapses.
 */
export type CommitmentStrategy = 'single' | 'open';

/**
 * Commitment scope/type. `due_at` is derived from this — the agent selects a
 * scope, the module owns the deadline policy. Add scopes here as new
 * commitment kinds are introduced; do NOT let an agent author the number.
 */
export type CommitmentScope = 'claim' | 'review' | 'standing' | 'default';

export interface Commitment {
  id: string;
  ownerActorId: string;
  objectText: string;
  successCheck: string | null;
  impossibleCheck: string | null;
  motivationCheck: string | null;
  dueAt: number;
  commitmentStrategy: CommitmentStrategy;
  scope: CommitmentScope;
  state: CommitmentState;
  closedByOracleRef: string | null;
  createdAt: number;
  lastTouchedAt: number;
}

export interface CreateCommitmentInput {
  ownerActorId: string;
  objectText: string;
  successCheck?: string | null;
  impossibleCheck?: string | null;
  motivationCheck?: string | null;
  /**
   * The commitment SCOPE/type — the daemon derives `due_at` from it (Law 1).
   * Defaults to 'default'. An agent-supplied absolute deadline is intentionally
   * NOT accepted by this method.
   */
  scope?: CommitmentScope;
  commitmentStrategy?: CommitmentStrategy;
}

export interface ListCommitmentsOptions {
  ownerActorId?: string;
  state?: CommitmentState | 'all';
  limit?: number;
}

export interface CloseResult {
  success: boolean;
  commitment?: Commitment;
  error?: string;
}

export interface CommitmentsDeps {
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
  /**
   * Optional override for the deadline policy (Law 1). Maps a scope to a
   * duration in ms from creation. The default policy lives below; tests and
   * the daemon may inject SLA-derived numbers, but the AGENT never can.
   */
  deadlinePolicyMs?: Partial<Record<CommitmentScope, number>>;
}

interface CommitmentRow {
  id: string;
  owner_actor_id: string;
  object_text: string;
  success_check: string | null;
  impossible_check: string | null;
  motivation_check: string | null;
  due_at: number;
  commitment_strategy: CommitmentStrategy;
  scope: CommitmentScope;
  state: CommitmentState;
  closed_by_oracle_ref: string | null;
  created_at: number;
  last_touched_at: number;
}

const STRATEGIES: CommitmentStrategy[] = ['single', 'open'];
const SCOPES: CommitmentScope[] = ['claim', 'review', 'standing', 'default'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * DEFAULT deadline policy (Law 1). The agent picks the scope; the daemon owns
 * how long that scope gets. These are deliberate, conservative defaults; an SLA
 * layer can override per-scope via `deps.deadlinePolicyMs`.
 */
const DEFAULT_DEADLINE_POLICY_MS: Record<CommitmentScope, number> = {
  claim: 2 * HOUR, // a file/region claim should close out within a couple hours
  review: 4 * HOUR, // a review obligation
  standing: 24 * HOUR, // a standing job (keep tests green) re-evaluated daily
  default: 2 * HOUR,
};

function asEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function rowToCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    ownerActorId: row.owner_actor_id,
    objectText: row.object_text,
    successCheck: row.success_check,
    impossibleCheck: row.impossible_check,
    motivationCheck: row.motivation_check,
    dueAt: row.due_at,
    commitmentStrategy: row.commitment_strategy,
    scope: row.scope,
    state: row.state,
    closedByOracleRef: row.closed_by_oracle_ref,
    createdAt: row.created_at,
    lastTouchedAt: row.last_touched_at,
  };
}

export function createCommitments(db: Database.Database, deps: CommitmentsDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const deadlinePolicy: Record<CommitmentScope, number> = {
    ...DEFAULT_DEADLINE_POLICY_MS,
    ...(deps.deadlinePolicyMs ?? {}),
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      owner_actor_id TEXT NOT NULL,
      object_text TEXT NOT NULL,
      success_check TEXT,
      impossible_check TEXT,
      motivation_check TEXT,
      due_at INTEGER NOT NULL,
      commitment_strategy TEXT NOT NULL DEFAULT 'single',
      scope TEXT NOT NULL DEFAULT 'default',
      state TEXT NOT NULL DEFAULT 'open',
      closed_by_oracle_ref TEXT,
      created_at INTEGER NOT NULL,
      last_touched_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_commitments_owner ON commitments(owner_actor_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_commitments_state ON commitments(state)`);
  // Hot path for the obligation monitor: open commitments ordered by due_at.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_commitments_state_due ON commitments(state, due_at)`);

  // NOTE: positional `?` parameters throughout (mirroring lib/resurrection.ts),
  // NOT `@named` params. The compiled daemon runs on bun:sqlite (see
  // lib/sqlite-runtime.ts), whose object-binding of `@name` placeholders does
  // not match better-sqlite3's bare-key semantics — `@named` binds null in the
  // compiled binary. Positional binding is portable across both engines, so the
  // monitor cannot silently degrade in the daemon (Law 4).
  const stmts = {
    insert: db.prepare(`
      INSERT INTO commitments (
        id, owner_actor_id, object_text,
        success_check, impossible_check, motivation_check,
        due_at, commitment_strategy, scope, state,
        closed_by_oracle_ref, created_at, last_touched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    get: db.prepare<[string], CommitmentRow>(`SELECT * FROM commitments WHERE id = ?`),
    close: db.prepare(`
      UPDATE commitments
         SET state = 'done', closed_by_oracle_ref = ?, last_touched_at = ?
       WHERE id = ? AND state = 'open'
    `),
    listAll: db.prepare<[number], CommitmentRow>(
      `SELECT * FROM commitments ORDER BY due_at ASC LIMIT ?`,
    ),
    listByState: db.prepare<[CommitmentState, number], CommitmentRow>(
      `SELECT * FROM commitments WHERE state = ? ORDER BY due_at ASC LIMIT ?`,
    ),
    listByOwner: db.prepare<[string, number], CommitmentRow>(
      `SELECT * FROM commitments WHERE owner_actor_id = ? ORDER BY due_at ASC LIMIT ?`,
    ),
    listByOwnerState: db.prepare<[string, CommitmentState, number], CommitmentRow>(
      `SELECT * FROM commitments WHERE owner_actor_id = ? AND state = ? ORDER BY due_at ASC LIMIT ?`,
    ),
  };

  /**
   * Derive the deadline for a scope (Law 1). This is the only place a `due_at`
   * is computed for a fresh commitment, and it never reads an agent-supplied
   * absolute time.
   */
  function deriveDueAt(scope: CommitmentScope, createdAt: number): number {
    const durationMs = deadlinePolicy[scope] ?? deadlinePolicy.default;
    return createdAt + durationMs;
  }

  /**
   * Create a durable commitment. The agent supplies the WORK (object + checks +
   * scope); the module supplies the DEADLINE. `state` always starts 'open' and
   * `closed_by_oracle_ref` always starts null — there is no way to mint a
   * pre-closed commitment.
   */
  function create(input: CreateCommitmentInput): Commitment {
    const ownerActorId = typeof input.ownerActorId === 'string' ? input.ownerActorId.trim() : '';
    if (!ownerActorId) {
      throw new Error('commitments.create: ownerActorId is required (non-empty string)');
    }
    // TODO(ADR-0040): bind owner_actor_id to a non-forgeable, daemon-minted
    // principal instead of the self-asserted session/actor id. Until then a
    // respawn under a fresh identity can shed its commitment history.
    const objectText = typeof input.objectText === 'string' ? input.objectText.trim() : '';
    if (!objectText) {
      throw new Error('commitments.create: objectText is required (non-empty string)');
    }

    const scope = asEnum<CommitmentScope>(input.scope, SCOPES, 'default');
    const commitmentStrategy = asEnum<CommitmentStrategy>(
      input.commitmentStrategy,
      STRATEGIES,
      'single',
    );
    const createdAt = now();
    const dueAt = deriveDueAt(scope, createdAt);

    const commitment: Commitment = {
      id: randomUUID(),
      ownerActorId,
      objectText,
      successCheck: input.successCheck?.trim() || null,
      impossibleCheck: input.impossibleCheck?.trim() || null,
      motivationCheck: input.motivationCheck?.trim() || null,
      dueAt,
      commitmentStrategy,
      scope,
      state: 'open',
      closedByOracleRef: null,
      createdAt,
      lastTouchedAt: createdAt,
    };

    stmts.insert.run(
      commitment.id,
      commitment.ownerActorId,
      commitment.objectText,
      commitment.successCheck,
      commitment.impossibleCheck,
      commitment.motivationCheck,
      commitment.dueAt,
      commitment.commitmentStrategy,
      commitment.scope,
      commitment.state,
      commitment.closedByOracleRef,
      commitment.createdAt,
      commitment.lastTouchedAt,
    );

    return commitment;
  }

  function get(id: string): Commitment | null {
    const row = stmts.get.get(id);
    return row ? rowToCommitment(row) : null;
  }

  function list(options: ListCommitmentsOptions = {}): Commitment[] {
    const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : 1000;
    const wantState = options.state && options.state !== 'all' ? options.state : undefined;
    let rows: CommitmentRow[];
    if (options.ownerActorId && wantState) {
      rows = stmts.listByOwnerState.all(options.ownerActorId, wantState, limit);
    } else if (options.ownerActorId) {
      rows = stmts.listByOwner.all(options.ownerActorId, limit);
    } else if (wantState) {
      rows = stmts.listByState.all(wantState, limit);
    } else {
      rows = stmts.listAll.all(limit);
    }
    return rows.map(rowToCommitment);
  }

  /**
   * Close a commitment against an ORACLE (Law 2). Refuses to mark 'done'
   * without a non-empty `oracleRef`. An oracle is a trusted source of ground
   * truth the agent cannot author — a released claim, a merged commit SHA, a
   * passing test id, or a satisfied Arbiter sub-check. This is the wall that
   * stops a free-text note from counting as completion.
   */
  function close(id: string, oracleRef: string): CloseResult {
    const ref = typeof oracleRef === 'string' ? oracleRef.trim() : '';
    if (!ref) {
      // Law 2: no oracle, no close. This is non-negotiable.
      return {
        success: false,
        error:
          'close requires a non-empty oracle ref (released claim / commit SHA / test id / arbiter sub-check). A free-text note does not close a commitment (ADR-0041 Law 2).',
      };
    }
    const existing = stmts.get.get(id);
    if (!existing) {
      return { success: false, error: `no commitment with id '${id}'` };
    }
    if (existing.state !== 'open') {
      return {
        success: false,
        error: `commitment '${id}' is '${existing.state}', not 'open' — cannot close`,
      };
    }
    stmts.close.run(ref, now(), id);
    const closed = stmts.get.get(id);
    return { success: true, commitment: closed ? rowToCommitment(closed) : undefined };
  }

  return {
    create,
    get,
    list,
    close,
    /** Exposed for the obligation monitor + tests. */
    deriveDueAt,
    deadlinePolicy,
  };
}

export type Commitments = ReturnType<typeof createCommitments>;
