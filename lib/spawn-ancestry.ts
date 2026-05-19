/**
 * Spawn Ancestry — parent/child tracking and cycle detection for `pd spawn`.
 *
 * The Anchor capability layer caps token attenuation at depth 2; spawn had no
 * equivalent, so two agents that can both spawn each other could ping-pong
 * forever and a deep spawn chain could fork-bomb the daemon. This module
 * fixes both gaps:
 *
 *  - records every parent->child spawn in `spawn_ancestry`
 *  - walks the chain to refuse cycles (refuse, not just warn — Ostrom
 *    rule-monitoring invariant: never silently allow a coordination foot-gun)
 *  - refuses spawns beyond MAX_SPAWN_DEPTH (default 4)
 *
 * Schema is self-initialized via `ensureSchema(db)` so this module composes
 * cleanly with both the daemon's central initDatabase() and ad-hoc test DBs.
 */

import type { DatabaseInstance } from './sqlite-runtime.js';

export const DEFAULT_MAX_SPAWN_DEPTH = 4;

export const SPAWN_ANCESTRY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS spawn_ancestry (
    child_session_id TEXT PRIMARY KEY,
    parent_session_id TEXT,
    depth INTEGER NOT NULL,
    spawn_chain_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spawn_ancestry_parent
    ON spawn_ancestry(parent_session_id);
  CREATE INDEX IF NOT EXISTS idx_spawn_ancestry_depth
    ON spawn_ancestry(depth);
`;

export interface AncestryRow {
  childSessionId: string;
  parentSessionId: string | null;
  depth: number;
  chain: string[];       // root..parent
  createdAt: number;
}

export interface CheckSpawnInput {
  /** Calling session id (from PD_SESSION_ID or --from-session). Null = root. */
  parentSessionId: string | null;
  /**
   * Identity proposed for the child. Used to spot "A spawns B spawns A" by
   * matching against the identity_project of sessions already in the chain.
   * Optional — if absent, we only check session-id cycles + depth.
   */
  proposedChildIdentity?: string | null;
  /** Override the default depth ceiling for this spawn. */
  maxDepth?: number;
}

export interface CheckSpawnOk {
  ok: true;
  /** Depth the child will sit at. Root = 0, first child = 1, etc. */
  depth: number;
  /** Full chain root..parent (parent is the tail). Empty if root spawn. */
  chain: string[];
}

export class CycleDetectedError extends Error {
  readonly code = 'SPAWN_CYCLE_DETECTED';
  readonly chain: string[];
  readonly collidingIdentity: string;
  constructor(chain: string[], collidingIdentity: string) {
    const arrow = [...chain, `<cycle:${collidingIdentity}>`].join(' -> ');
    super(
      `Spawn cycle refused: identity '${collidingIdentity}' already appears in the ancestry chain.\n` +
      `  Chain: ${arrow}\n` +
      `  Two agents that can spawn each other will ping-pong forever; refactor the workflow ` +
      `so the child is invoked by a different identity, or coordinate via pub/sub instead of spawn.`,
    );
    this.chain = chain;
    this.collidingIdentity = collidingIdentity;
  }
}

export class MaxDepthError extends Error {
  readonly code = 'SPAWN_MAX_DEPTH';
  readonly depth: number;
  readonly maxDepth: number;
  readonly chain: string[];
  constructor(depth: number, maxDepth: number, chain: string[]) {
    super(
      `Spawn refused: depth ${depth} exceeds max ${maxDepth}.\n` +
      `  Chain: ${chain.join(' -> ')}\n` +
      (maxDepth < 8
        ? `  If this depth is legitimate, raise the cap with --max-depth ${depth + 1} (or higher) ` +
          `or 'pd config set spawn.max_depth <N>'. Otherwise refactor: deep spawn chains are ` +
          `usually a sign the work should be parallelized or coordinated through pub/sub.`
        : `  Refactor the workflow — depth ${depth} is almost certainly a runaway recursion.`),
    );
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.chain = chain;
  }
}

export interface Ancestry {
  /**
   * Validate a proposed spawn against the chain.
   * Throws CycleDetectedError or MaxDepthError. Returns { ok, depth, chain }
   * for the caller to record once the spawn actually launches.
   */
  checkSpawn(input: CheckSpawnInput): CheckSpawnOk;
  /**
   * Record a parent->child spawn. Idempotent on child_session_id (UPSERT).
   */
  record(args: {
    childSessionId: string;
    parentSessionId: string | null;
    depth: number;
    chain: string[];
    now?: number;
  }): void;
  /**
   * Walk the chain for a session. Returns root..session (inclusive of tail).
   * For a root session this is just [sessionId].
   */
  getChain(sessionId: string): string[];
  /** Direct row lookup. Returns null if no ancestry recorded. */
  getRow(sessionId: string): AncestryRow | null;
  /**
   * Children of a session (one hop). Used by tree rendering.
   */
  childrenOf(sessionId: string): AncestryRow[];
  /**
   * Render an ASCII tree starting at rootSessionId. Each line is a session id
   * with depth indentation. Cheap, single SQL pass per level.
   */
  tree(rootSessionId: string): string;
}

interface SessionIdentityResolver {
  /**
   * Look up the identity_project for a session row. Returns null if the
   * session is unknown (which we treat as "not in chain").
   */
  (sessionId: string): string | null;
}

interface AncestryDeps {
  /**
   * Optional: resolve a session id to its `identity_project` string so we can
   * detect identity-level cycles ("agent X spawns agent X"). If omitted, only
   * session-id-level cycles are caught (which is still better than nothing).
   */
  resolveIdentity?: SessionIdentityResolver;
  /**
   * Optional: resolve the active daemon-wide max-depth ceiling. Called once
   * per checkSpawn() so a `pd config set spawn.max_depth N` takes effect
   * immediately without a daemon restart. When unset, falls back to
   * DEFAULT_MAX_SPAWN_DEPTH. A per-spawn `maxDepth` argument always
   * overrides this resolver.
   */
  getMaxDepth?: () => number;
}

function ensureSchema(db: DatabaseInstance): void {
  db.exec(SPAWN_ANCESTRY_SCHEMA_SQL);
}

function defaultResolveIdentity(db: DatabaseInstance): SessionIdentityResolver {
  // Resolve session_id -> identity_project. The sessions table is owned by
  // CORE_SCHEMA_SQL in lib/db.ts; we read it, never write it.
  // Wrapped in try/catch so ancestry stays usable even on stripped-down test
  // databases that don't have a sessions table.
  let stmt: { get: (id: string) => { identity_project?: string | null } | undefined } | null;
  try {
    stmt = db.prepare('SELECT identity_project FROM sessions WHERE id = ?');
  } catch {
    stmt = null;
  }
  return (sessionId: string): string | null => {
    if (!stmt) return null;
    try {
      const row = stmt.get(sessionId);
      return (row?.identity_project as string) || null;
    } catch {
      return null;
    }
  };
}

export function createAncestry(
  db: DatabaseInstance,
  deps: AncestryDeps = {},
): Ancestry {
  ensureSchema(db);

  const resolveIdentity = deps.resolveIdentity ?? defaultResolveIdentity(db);
  const getMaxDepth = deps.getMaxDepth;

  // Prepared statements — cheaper than re-parsing on every spawn.
  const selRow = db.prepare(
    'SELECT child_session_id, parent_session_id, depth, spawn_chain_json, created_at ' +
    '  FROM spawn_ancestry WHERE child_session_id = ?',
  );
  const selChildren = db.prepare(
    'SELECT child_session_id, parent_session_id, depth, spawn_chain_json, created_at ' +
    '  FROM spawn_ancestry WHERE parent_session_id = ? ORDER BY created_at ASC',
  );
  const insRow = db.prepare(
    'INSERT INTO spawn_ancestry (child_session_id, parent_session_id, depth, spawn_chain_json, created_at) ' +
    '  VALUES (?, ?, ?, ?, ?) ' +
    '  ON CONFLICT(child_session_id) DO UPDATE SET ' +
    '    parent_session_id = excluded.parent_session_id, ' +
    '    depth = excluded.depth, ' +
    '    spawn_chain_json = excluded.spawn_chain_json, ' +
    '    created_at = excluded.created_at',
  );

  function rowFromRaw(raw: {
    child_session_id: string;
    parent_session_id: string | null;
    depth: number;
    spawn_chain_json: string;
    created_at: number;
  }): AncestryRow {
    let chain: string[] = [];
    try {
      const parsed = JSON.parse(raw.spawn_chain_json);
      if (Array.isArray(parsed)) chain = parsed.filter((v): v is string => typeof v === 'string');
    } catch { /* malformed JSON — treat as empty chain */ }
    return {
      childSessionId: raw.child_session_id,
      parentSessionId: raw.parent_session_id,
      depth: raw.depth,
      chain,
      createdAt: raw.created_at,
    };
  }

  function getRow(sessionId: string): AncestryRow | null {
    const raw = selRow.get(sessionId) as Parameters<typeof rowFromRaw>[0] | undefined;
    return raw ? rowFromRaw(raw) : null;
  }

  function getChain(sessionId: string): string[] {
    const row = getRow(sessionId);
    if (!row) return [sessionId];
    return [...row.chain, sessionId];
  }

  function checkSpawn(input: CheckSpawnInput): CheckSpawnOk {
    // Priority: explicit per-spawn override > daemon-config getter > built-in default.
    let maxDepth: number;
    if (Number.isFinite(input.maxDepth) && (input.maxDepth as number) > 0) {
      maxDepth = Math.floor(input.maxDepth as number);
    } else if (getMaxDepth) {
      let resolved: number;
      try {
        resolved = getMaxDepth();
      } catch {
        resolved = DEFAULT_MAX_SPAWN_DEPTH;
      }
      maxDepth = Number.isFinite(resolved) && resolved > 0
        ? Math.floor(resolved)
        : DEFAULT_MAX_SPAWN_DEPTH;
    } else {
      maxDepth = DEFAULT_MAX_SPAWN_DEPTH;
    }

    // Root spawn: no parent, depth 0, empty chain.
    if (!input.parentSessionId) {
      return { ok: true, depth: 0, chain: [] };
    }

    const parentRow = getRow(input.parentSessionId);
    const parentChain = parentRow ? parentRow.chain : [];
    // Effective chain root..parent (parent included as the tail).
    const chain = [...parentChain, input.parentSessionId];
    const childDepth = chain.length;  // root=0, first child=1, etc.

    if (childDepth >= maxDepth) {
      throw new MaxDepthError(childDepth, maxDepth, chain);
    }

    // Identity-level cycle check: would the proposed child re-enter an
    // identity already present in the chain?
    const proposed = input.proposedChildIdentity?.trim();
    if (proposed) {
      for (const ancestorId of chain) {
        const ancestorIdentity = resolveIdentity(ancestorId);
        if (ancestorIdentity && ancestorIdentity === proposed) {
          throw new CycleDetectedError(chain, proposed);
        }
      }
    }

    return { ok: true, depth: childDepth, chain };
  }

  function record(args: {
    childSessionId: string;
    parentSessionId: string | null;
    depth: number;
    chain: string[];
    now?: number;
  }): void {
    insRow.run(
      args.childSessionId,
      args.parentSessionId,
      args.depth,
      JSON.stringify(args.chain),
      args.now ?? Date.now(),
    );
  }

  function childrenOf(sessionId: string): AncestryRow[] {
    const raws = selChildren.all(sessionId) as Array<Parameters<typeof rowFromRaw>[0]>;
    return raws.map(rowFromRaw);
  }

  function tree(rootSessionId: string): string {
    const lines: string[] = [];
    const walk = (id: string, depth: number, prefix: string, isLast: boolean): void => {
      if (depth === 0) {
        lines.push(id);
      } else {
        const connector = isLast ? '+-- ' : '|-- ';
        lines.push(`${prefix}${connector}${id}`);
      }
      const kids = childrenOf(id);
      const nextPrefix = depth === 0
        ? ''
        : prefix + (isLast ? '    ' : '|   ');
      kids.forEach((kid, idx) => {
        walk(kid.childSessionId, depth + 1, nextPrefix, idx === kids.length - 1);
      });
    };
    walk(rootSessionId, 0, '', true);
    return lines.join('\n');
  }

  return { checkSpawn, record, getChain, getRow, childrenOf, tree };
}
