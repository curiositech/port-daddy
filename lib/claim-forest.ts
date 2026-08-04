/**
 * Claim Forest
 *
 * A claim forest is the repo/worktree-aware spine for claim-tree data. The
 * legacy session_files table stays as the compatibility surface; this module
 * owns the normalized read/write model that future repo/ref/harbor projections
 * can build on.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ClaimForestWorldKind = 'worktree' | 'ref' | 'commit' | 'harbor';
export type ClaimForestSelectorKind = 'repo' | 'directory' | 'file' | 'symbol' | 'range';
export type ClaimForestMode = 'S' | 'X' | 'IS' | 'IX' | 'SIX';

export interface ClaimForestAddress {
  repoId?: string | null;
  world?: {
    kind?: ClaimForestWorldKind | null;
    id?: string | null;
    gitOid?: string | null;
  } | null;
  selector: {
    kind: ClaimForestSelectorKind;
    path?: string | null;
    symbol?: string | null;
    symbolPath?: string | null;
    startLine?: number | null;
    endLine?: number | null;
    contentHash?: string | null;
  };
}

export interface ClaimForestClaimInput {
  sessionId: string;
  agentId?: string | null;
  mode?: ClaimForestMode;
  intent?: string | null;
  claimedAt?: number;
  releasedAt?: number | null;
  observedBy?: string | null;
  confidence?: number;
  legacySessionFileId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ClaimForestClaim {
  id: number;
  nodeId: string;
  repoId: string;
  worldKind: ClaimForestWorldKind;
  worldId: string;
  gitOid: string | null;
  selectorKind: ClaimForestSelectorKind;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath: string | null;
  sessionId: string;
  purpose: string;
  agentId: string | null;
  phase: string;
  mode: ClaimForestMode;
  intent: string | null;
  claimedAt: number;
  releasedAt: number | null;
  observedBy: string | null;
  confidence: number;
  legacySessionFileId: number | null;
}

export interface ClaimForestScope {
  repoId?: string | null;
  worldKind?: ClaimForestWorldKind | null;
  worldId?: string | null;
}

interface SessionContext {
  agent_id: string | null;
  worktree_id: string | null;
  identity_project: string | null;
}

interface LegacySessionFileRow {
  id: number;
  session_id: string;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  symbol_path: string | null;
  claimed_at: number;
  released_at: number | null;
  agent_id: string | null;
  worktree_id: string | null;
  identity_project: string | null;
}

interface ClaimForestRow {
  id: number;
  node_id: string;
  repo_id: string;
  world_kind: ClaimForestWorldKind;
  world_id: string;
  selector_kind: ClaimForestSelectorKind;
  path: string | null;
  symbol: string | null;
  symbol_path: string | null;
  start_line: number | null;
  end_line: number | null;
  git_oid: string | null;
  mode: ClaimForestMode;
  intent: string | null;
  session_id: string;
  purpose: string;
  session_agent_id: string | null;
  phase: string | null;
  claimed_at: number;
  released_at: number | null;
  observed_by: string | null;
  confidence: number;
  legacy_session_file_id: number | null;
}

const DEFAULT_REPO_ID = 'local';
const DEFAULT_WORLD_KIND: ClaimForestWorldKind = 'worktree';
const DEFAULT_WORLD_ID = 'unscoped';

/**
 * Gray-1976 multi-granularity lock compatibility (ADR-0038 mode matrix).
 * A pair of modes CONFLICTS when they are not compatible. The matrix is
 * symmetric; unknown modes conservatively conflict.
 */
const MODE_COMPATIBILITY: Record<ClaimForestMode, readonly ClaimForestMode[]> = {
  IS: ['IS', 'IX', 'S', 'SIX'],
  IX: ['IS', 'IX'],
  S: ['IS', 'S'],
  SIX: ['IS'],
  X: [],
};

export function modesConflict(a: ClaimForestMode, b: ClaimForestMode): boolean {
  const compatible = MODE_COMPATIBILITY[a];
  if (!compatible) return true;
  return !compatible.includes(b);
}

export interface ClaimTreeClaim {
  sessionId: string;
  agentId: string | null;
  purpose: string;
  mode: ClaimForestMode;
  intent: string | null;
  claimedAt: number;
  sessionStatus: string;
  /** Daemon-truthful liveness: an unreleased claim whose session is no longer
   *  active (zombie protocol's abandonByAgent flips status without releasing
   *  forest claims) renders as a dead claim, never as live intent. */
  live: boolean;
}

export interface ClaimTreeNode {
  nodeId: string;
  selectorKind: ClaimForestSelectorKind;
  path: string | null;
  symbol: string | null;
  symbolPath: string | null;
  startLine: number | null;
  endLine: number | null;
  repoId: string;
  worldKind: ClaimForestWorldKind;
  worldId: string;
  label: string;
  claims: ClaimTreeClaim[];
  /** Non-null when ≥2 unreleased claims from distinct LIVE sessions hold
   *  Gray-incompatible modes on this exact node. Dead-session claims never
   *  cause a conflict — they are stale intent, rendered dimmed. */
  conflict: { sessionIds: string[] } | null;
  /** Subtree rollup (includes this node) so a collapsed ancestor still
   *  reads conflicted/dead at a glance. */
  rollup: { claims: number; conflicts: number; deadClaims: number };
  children: ClaimTreeNode[];
}

export interface ClaimTreeStats {
  nodes: number;
  claims: number;
  conflicts: number;
  deadClaims: number;
  sessions: number;
}

interface ClaimForestNodeRow {
  id: string;
  parent_id: string | null;
  selector_kind: ClaimForestSelectorKind;
  path: string | null;
  symbol: string | null;
  symbol_path: string | null;
  start_line: number | null;
  end_line: number | null;
  repo_id: string;
  world_kind: ClaimForestWorldKind;
  world_id: string;
}

export const CLAIM_FOREST_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS claim_forest_nodes (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    world_kind TEXT NOT NULL CHECK(world_kind IN ('worktree','ref','commit','harbor')),
    world_id TEXT NOT NULL,
    parent_id TEXT REFERENCES claim_forest_nodes(id) ON DELETE CASCADE,
    selector_kind TEXT NOT NULL CHECK(selector_kind IN ('repo','directory','file','symbol','range')),
    path TEXT,
    symbol TEXT,
    symbol_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    git_oid TEXT,
    content_hash TEXT,
    created_at INTEGER NOT NULL,
    last_observed_at INTEGER NOT NULL,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_claim_forest_nodes_parent ON claim_forest_nodes(parent_id);
  CREATE INDEX IF NOT EXISTS idx_claim_forest_nodes_repo_world ON claim_forest_nodes(repo_id, world_kind, world_id);
  CREATE INDEX IF NOT EXISTS idx_claim_forest_nodes_path ON claim_forest_nodes(repo_id, path);
  CREATE INDEX IF NOT EXISTS idx_claim_forest_nodes_symbol ON claim_forest_nodes(repo_id, path, symbol_path);

  CREATE TABLE IF NOT EXISTS claim_forest_edges (
    parent_node_id TEXT NOT NULL REFERENCES claim_forest_nodes(id) ON DELETE CASCADE,
    child_node_id TEXT NOT NULL REFERENCES claim_forest_nodes(id) ON DELETE CASCADE,
    edge_kind TEXT NOT NULL DEFAULT 'contains',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (parent_node_id, child_node_id, edge_kind)
  );

  CREATE TABLE IF NOT EXISTS claim_forest_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES claim_forest_nodes(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT,
    mode TEXT NOT NULL DEFAULT 'X' CHECK(mode IN ('S','X','IS','IX','SIX')),
    intent TEXT,
    claimed_at INTEGER NOT NULL,
    released_at INTEGER,
    observed_by TEXT,
    confidence REAL NOT NULL DEFAULT 1,
    legacy_session_file_id INTEGER,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_claim_forest_claims_node_active
    ON claim_forest_claims(node_id, released_at);
  CREATE INDEX IF NOT EXISTS idx_claim_forest_claims_session
    ON claim_forest_claims(session_id, released_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_forest_claims_legacy_session_file
    ON claim_forest_claims(legacy_session_file_id)
    WHERE legacy_session_file_id IS NOT NULL;
`;

function stableId(prefix: string, parts: unknown[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
  return `${prefix}:${hash}`;
}

function normalizeRepoId(repoId?: string | null): string {
  const value = repoId?.trim();
  return value || DEFAULT_REPO_ID;
}

function normalizeWorld(address: ClaimForestAddress): { kind: ClaimForestWorldKind; id: string; gitOid: string | null } {
  const kind = address.world?.kind ?? DEFAULT_WORLD_KIND;
  const id = address.world?.id?.trim() || DEFAULT_WORLD_ID;
  return { kind, id, gitOid: address.world?.gitOid ?? null };
}

function normalizePath(path?: string | null): string | null {
  const value = path?.trim();
  if (!value) return null;
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/').replace(/\/$/g, '');
}

function dirnameParts(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    dirs.push(parts.slice(0, i).join('/'));
  }
  return dirs;
}

function nodeIdFor(address: ClaimForestAddress, selectorKind: ClaimForestSelectorKind, path: string | null): string {
  const repoId = normalizeRepoId(address.repoId);
  const world = normalizeWorld(address);
  const selector = address.selector;
  const identityParts: unknown[] = [
    repoId,
    world.kind,
    world.id,
    world.gitOid ?? '',
    selectorKind,
    path ?? '',
  ];
  if (selectorKind === 'symbol') {
    identityParts.push(selector.symbolPath ?? selector.symbol ?? '');
  } else if (selectorKind === 'range') {
    identityParts.push(selector.startLine ?? '', selector.endLine ?? '', selector.symbolPath ?? '');
  }
  return stableId('claim-node', identityParts);
}

function scopeForSession(session: SessionContext): Required<ClaimForestScope> {
  return {
    repoId: normalizeRepoId(session.identity_project),
    worldKind: DEFAULT_WORLD_KIND,
    worldId: session.worktree_id?.trim() || DEFAULT_WORLD_ID,
  };
}

function matchesScope(claim: ClaimForestClaim, scope?: ClaimForestScope): boolean {
  if (!scope) return true;
  if (scope.repoId !== undefined && claim.repoId !== normalizeRepoId(scope.repoId)) return false;
  if (scope.worldKind !== undefined && claim.worldKind !== (scope.worldKind ?? DEFAULT_WORLD_KIND)) return false;
  if (scope.worldId !== undefined) {
    const worldId = scope.worldId?.trim() || DEFAULT_WORLD_ID;
    if (claim.worldId !== worldId) return false;
  }
  return true;
}

function sessionAddressForLegacy(row: LegacySessionFileRow): ClaimForestAddress {
  const selectorKind: ClaimForestSelectorKind =
    row.symbol_path || row.symbol ? 'symbol'
      : row.start_line != null || row.end_line != null ? 'range'
        : 'file';
  return {
    repoId: row.identity_project,
    world: { kind: 'worktree', id: row.worktree_id },
    selector: {
      kind: selectorKind,
      path: row.file_path,
      symbol: row.symbol,
      symbolPath: row.symbol_path,
      startLine: row.start_line,
      endLine: row.end_line,
    },
  };
}

function rowToClaim(row: ClaimForestRow): ClaimForestClaim {
  return {
    id: row.id,
    nodeId: row.node_id,
    repoId: row.repo_id,
    worldKind: row.world_kind,
    worldId: row.world_id,
    gitOid: row.git_oid,
    selectorKind: row.selector_kind,
    filePath: row.path ?? '',
    startLine: row.start_line,
    endLine: row.end_line,
    symbol: row.symbol,
    symbolPath: row.symbol_path,
    sessionId: row.session_id,
    purpose: row.purpose,
    agentId: row.session_agent_id,
    phase: row.phase || 'in_progress',
    mode: row.mode,
    intent: row.intent,
    claimedAt: row.claimed_at,
    releasedAt: row.released_at,
    observedBy: row.observed_by,
    confidence: row.confidence,
    legacySessionFileId: row.legacy_session_file_id,
  };
}

function nodeLabel(row: ClaimForestNodeRow): string {
  const pathTail = (row.path ?? '').split('/').filter(Boolean).pop() ?? '';
  switch (row.selector_kind) {
    case 'repo': {
      const world = row.world_id && row.world_id !== DEFAULT_WORLD_ID ? ` @ ${row.world_id}` : '';
      return `${row.repo_id}${world}`;
    }
    case 'directory':
      return `${pathTail || row.path || row.id}/`;
    case 'file':
      return pathTail || row.path || row.id;
    case 'symbol':
      return row.symbol_path || row.symbol || pathTail || row.id;
    case 'range':
      return `${pathTail}:${row.start_line ?? '?'}-${row.end_line ?? '?'}`;
    default:
      return row.path ?? row.id;
  }
}

function ensureLegacySessionFileColumns(db: Database.Database): void {
  const table = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'session_files'
    LIMIT 1
  `).get();
  if (!table) return;

  const columns = db.prepare('PRAGMA table_info(session_files)').all() as Array<{ name: string }>;
  const names = new Set(columns.map(column => column.name));
  const legacyColumns: Array<[string, string]> = [
    ['start_line', 'INTEGER'],
    ['end_line', 'INTEGER'],
    ['symbol', 'TEXT'],
    ['symbol_path', 'TEXT'],
  ];
  const missingColumns = legacyColumns.filter(([name]) => !names.has(name));

  for (const [name, type] of missingColumns) {
    db.prepare(`ALTER TABLE session_files ADD COLUMN ${name} ${type}`).run();
  }
}

export function createClaimForest(db: Database.Database) {
  ensureLegacySessionFileColumns(db);
  db.exec(CLAIM_FOREST_SCHEMA_SQL);

  const stmts = {
    upsertNode: db.prepare(`
      INSERT INTO claim_forest_nodes (
        id, repo_id, world_kind, world_id, parent_id, selector_kind, path,
        symbol, symbol_path, start_line, end_line, git_oid, content_hash,
        created_at, last_observed_at, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        path = excluded.path,
        symbol = excluded.symbol,
        symbol_path = excluded.symbol_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        git_oid = excluded.git_oid,
        last_observed_at = excluded.last_observed_at,
        content_hash = COALESCE(excluded.content_hash, claim_forest_nodes.content_hash),
        metadata = COALESCE(excluded.metadata, claim_forest_nodes.metadata)
    `),
    insertEdge: db.prepare(`
      INSERT OR IGNORE INTO claim_forest_edges (parent_node_id, child_node_id, edge_kind, created_at)
      VALUES (?, ?, ?, ?)
    `),
    releaseExistingNodeSession: db.prepare(`
      UPDATE claim_forest_claims
      SET released_at = ?
      WHERE node_id = ? AND session_id = ? AND released_at IS NULL
    `),
    insertClaim: db.prepare(`
      INSERT OR IGNORE INTO claim_forest_claims (
        node_id, session_id, agent_id, mode, intent, claimed_at, released_at,
        observed_by, confidence, legacy_session_file_id, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listActive: db.prepare(`
      SELECT c.id, c.node_id, c.session_id, c.mode, c.intent, c.claimed_at,
             c.released_at, c.observed_by, c.confidence, c.legacy_session_file_id,
             n.repo_id, n.world_kind, n.world_id, n.selector_kind, n.path, n.symbol,
             n.symbol_path, n.start_line, n.end_line, n.git_oid,
             s.purpose, s.agent_id AS session_agent_id, s.phase
      FROM claim_forest_claims c
      JOIN claim_forest_nodes n ON n.id = c.node_id
      JOIN sessions s ON s.id = c.session_id
      WHERE c.released_at IS NULL AND s.status = 'active'
      ORDER BY n.path ASC, n.start_line ASC, c.claimed_at ASC
    `),
    // listActive minus the `s.status = 'active'` predicate, plus the session's
    // status in the SELECT: the zombie protocol (sessions.abandonByAgent) flips
    // sessions to 'abandoned' WITHOUT releasing forest claims, so unreleased
    // dead-session claims are real daemon state the tree must surface (dimmed).
    listUnreleasedWithSessionStatus: db.prepare(`
      SELECT c.id, c.node_id, c.session_id, c.mode, c.intent, c.claimed_at,
             c.released_at, c.observed_by, c.confidence, c.legacy_session_file_id,
             n.repo_id, n.world_kind, n.world_id, n.selector_kind, n.path, n.symbol,
             n.symbol_path, n.start_line, n.end_line, n.git_oid,
             s.purpose, s.agent_id AS session_agent_id, s.phase,
             s.status AS session_status
      FROM claim_forest_claims c
      JOIN claim_forest_nodes n ON n.id = c.node_id
      JOIN sessions s ON s.id = c.session_id
      WHERE c.released_at IS NULL
      ORDER BY n.path ASC, n.start_line ASC, c.claimed_at ASC
    `),
    getNodeById: db.prepare(`
      SELECT id, parent_id, selector_kind, path, symbol, symbol_path,
             start_line, end_line, repo_id, world_kind, world_id
      FROM claim_forest_nodes
      WHERE id = ?
    `),
    listBySession: db.prepare(`
      SELECT c.id, c.node_id, c.session_id, c.mode, c.intent, c.claimed_at,
             c.released_at, c.observed_by, c.confidence, c.legacy_session_file_id,
             n.repo_id, n.world_kind, n.world_id, n.selector_kind, n.path, n.symbol,
             n.symbol_path, n.start_line, n.end_line, n.git_oid,
             s.purpose, s.agent_id AS session_agent_id, s.phase
      FROM claim_forest_claims c
      JOIN claim_forest_nodes n ON n.id = c.node_id
      JOIN sessions s ON s.id = c.session_id
      WHERE c.session_id = ? AND (? = 1 OR c.released_at IS NULL)
      ORDER BY c.claimed_at ASC
    `),
    releaseByPath: db.prepare(`
      UPDATE claim_forest_claims
      SET released_at = ?
      WHERE session_id = ? AND released_at IS NULL
        AND node_id IN (SELECT id FROM claim_forest_nodes WHERE path = ?)
    `),
    releaseBySymbolPath: db.prepare(`
      UPDATE claim_forest_claims
      SET released_at = ?
      WHERE session_id = ? AND released_at IS NULL
        AND node_id IN (SELECT id FROM claim_forest_nodes WHERE path = ? AND symbol_path = ?)
    `),
    releaseByRange: db.prepare(`
      UPDATE claim_forest_claims
      SET released_at = ?
      WHERE session_id = ? AND released_at IS NULL
        AND node_id IN (
          SELECT id FROM claim_forest_nodes
          WHERE path = ? AND start_line = ? AND end_line = ?
        )
    `),
    releaseAllBySession: db.prepare(`
      UPDATE claim_forest_claims
      SET released_at = ?
      WHERE session_id = ? AND released_at IS NULL
    `),
    legacyRowsMissingForest: db.prepare(`
      SELECT sf.rowid AS id, sf.session_id, sf.file_path, sf.start_line, sf.end_line,
             sf.symbol, sf.symbol_path, sf.claimed_at, sf.released_at,
             s.agent_id, s.worktree_id, s.identity_project
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      LEFT JOIN claim_forest_claims c ON c.legacy_session_file_id = sf.id
      WHERE c.id IS NULL
      ORDER BY CASE WHEN sf.released_at IS NULL THEN 0 ELSE 1 END ASC, sf.id ASC
      LIMIT ?
    `),
  };

  function ensureNode(address: ClaimForestAddress) {
    const repoId = normalizeRepoId(address.repoId);
    const world = normalizeWorld(address);
    const now = Date.now();
    const selector = address.selector;
    const path = normalizePath(selector.path);
    const repoAddress: ClaimForestAddress = {
      repoId,
      world,
      selector: { kind: 'repo' },
    };
    const repoNodeId = nodeIdFor(repoAddress, 'repo', null);
    stmts.upsertNode.run(
      repoNodeId,
      repoId,
      world.kind,
      world.id,
      null,
      'repo',
      null,
      null,
      null,
      null,
      null,
      world.gitOid,
      null,
      now,
      now,
      null,
    );

    if (selector.kind === 'repo') {
      return { id: repoNodeId, repoId, worldKind: world.kind, worldId: world.id };
    }

    if (!path) {
      throw new Error('claim forest selector path required');
    }

    let parentId = repoNodeId;
    for (const dirPath of dirnameParts(path)) {
      const dirAddress: ClaimForestAddress = { repoId, world, selector: { kind: 'directory', path: dirPath } };
      const dirNodeId = nodeIdFor(dirAddress, 'directory', dirPath);
      stmts.upsertNode.run(
        dirNodeId,
        repoId,
        world.kind,
        world.id,
        parentId,
        'directory',
        dirPath,
        null,
        null,
        null,
        null,
        world.gitOid,
        null,
        now,
        now,
        null,
      );
      stmts.insertEdge.run(parentId, dirNodeId, 'contains', now);
      parentId = dirNodeId;
    }

    const baseKind = selector.kind === 'directory' ? 'directory' : 'file';
    const basePath = selector.kind === 'directory' ? path : path;
    const baseNodeId = nodeIdFor({ repoId, world, selector: { kind: baseKind, path: basePath } }, baseKind, basePath);
    stmts.upsertNode.run(
      baseNodeId,
      repoId,
      world.kind,
      world.id,
      parentId,
      baseKind,
      basePath,
      null,
      null,
      null,
      null,
      world.gitOid,
      null,
      now,
      now,
      null,
    );
    stmts.insertEdge.run(parentId, baseNodeId, 'contains', now);

    if (selector.kind === 'file' || selector.kind === 'directory') {
      return { id: baseNodeId, repoId, worldKind: world.kind, worldId: world.id };
    }

    const nodeKind = selector.kind;
    const nodeId = nodeIdFor({ repoId, world, selector: { ...selector, path } }, nodeKind, path);
    stmts.upsertNode.run(
      nodeId,
      repoId,
      world.kind,
      world.id,
      baseNodeId,
      nodeKind,
      path,
      selector.symbol ?? null,
      selector.symbolPath ?? null,
      selector.startLine ?? null,
      selector.endLine ?? null,
      world.gitOid,
      selector.contentHash ?? null,
      now,
      now,
      null,
    );
    stmts.insertEdge.run(baseNodeId, nodeId, 'contains', now);
    return { id: nodeId, repoId, worldKind: world.kind, worldId: world.id };
  }

  function claim(address: ClaimForestAddress, input: ClaimForestClaimInput) {
    const claimedAt = input.claimedAt ?? Date.now();
    const node = ensureNode(address);
    if (input.releasedAt == null) {
      stmts.releaseExistingNodeSession.run(claimedAt, node.id, input.sessionId);
    }
    const result = stmts.insertClaim.run(
      node.id,
      input.sessionId,
      input.agentId ?? null,
      input.mode ?? 'X',
      input.intent ?? null,
      claimedAt,
      input.releasedAt ?? null,
      input.observedBy ?? null,
      input.confidence ?? 1,
      input.legacySessionFileId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );
    return { nodeId: node.id, claimId: Number(result.lastInsertRowid), changes: result.changes };
  }

  function listActiveClaims(filters: {
    path?: string;
    symbol?: string;
    symbolPath?: string;
    agentId?: string;
    purpose?: string;
    repoId?: string | null;
    worldKind?: ClaimForestWorldKind | null;
    worldId?: string | null;
  } = {}) {
    const pathNeedle = filters.path?.replace(/\*/g, '').toLowerCase();
    const symbolNeedle = filters.symbol?.replace(/\*/g, '').toLowerCase();
    const symbolPathNeedle = filters.symbolPath?.replace(/\*/g, '').toLowerCase();
    const agentNeedle = filters.agentId?.replace(/\*/g, '').toLowerCase();
    const purposeNeedle = filters.purpose?.replace(/\*/g, '').toLowerCase();
    return (stmts.listActive.all() as ClaimForestRow[])
      .map(rowToClaim)
      .filter(row => {
        if (pathNeedle && !row.filePath.toLowerCase().includes(pathNeedle)) return false;
        if (symbolNeedle && !(row.symbol ?? '').toLowerCase().includes(symbolNeedle)) return false;
        if (symbolPathNeedle && !(row.symbolPath ?? '').toLowerCase().includes(symbolPathNeedle)) return false;
        if (agentNeedle && !(row.agentId ?? '').toLowerCase().includes(agentNeedle)) return false;
        if (purposeNeedle && !row.purpose.toLowerCase().includes(purposeNeedle)) return false;
        if (!matchesScope(row, filters)) return false;
        return true;
      });
  }

  function getActiveClaimsForFileExcludingSession(filePath: string, sessionId: string, scope?: ClaimForestScope) {
    const normalizedPath = normalizePath(filePath);
    return listActiveClaims({ path: normalizedPath ?? filePath, ...scope })
      .filter(claim => claim.filePath === normalizedPath && claim.sessionId !== sessionId);
  }

  function getActiveClaimsForFile(filePath: string, scope?: ClaimForestScope) {
    const normalizedPath = normalizePath(filePath);
    return listActiveClaims({ path: normalizedPath ?? filePath, ...scope })
      .filter(claim => claim.filePath === normalizedPath);
  }

  function listClaimsForSession(sessionId: string, options: { includeReleased?: boolean } = {}) {
    const includeReleased = options.includeReleased ? 1 : 0;
    return (stmts.listBySession.all(sessionId, includeReleased) as ClaimForestRow[]).map(rowToClaim);
  }

  function releaseByFilePath(sessionId: string, filePath: string, releasedAt = Date.now()) {
    const normalizedPath = normalizePath(filePath) ?? filePath;
    return stmts.releaseByPath.run(releasedAt, sessionId, normalizedPath).changes;
  }

  function releaseBySymbolPath(sessionId: string, filePath: string, symbolPath: string, releasedAt = Date.now()) {
    const normalizedPath = normalizePath(filePath) ?? filePath;
    return stmts.releaseBySymbolPath.run(releasedAt, sessionId, normalizedPath, symbolPath).changes;
  }

  function releaseByRange(sessionId: string, filePath: string, startLine: number, endLine: number, releasedAt = Date.now()) {
    const normalizedPath = normalizePath(filePath) ?? filePath;
    return stmts.releaseByRange.run(releasedAt, sessionId, normalizedPath, startLine, endLine).changes;
  }

  function releaseAllBySession(sessionId: string, releasedAt = Date.now()) {
    return stmts.releaseAllBySession.run(releasedAt, sessionId).changes;
  }

  function backfillFromSessionFiles(limit = 10_000) {
    const batchSize = Math.max(1, Math.floor(limit));
    let backfilled = 0;

    while (true) {
      const rows = stmts.legacyRowsMissingForest.all(batchSize) as LegacySessionFileRow[];
      if (rows.length === 0) return backfilled;

      for (const row of rows) {
        claim(sessionAddressForLegacy(row), {
          sessionId: row.session_id,
          agentId: row.agent_id,
          claimedAt: row.claimed_at,
          releasedAt: row.released_at,
          observedBy: 'session_files.backfill',
          confidence: 1,
          legacySessionFileId: row.id,
        });
      }

      backfilled += rows.length;
      if (rows.length < batchSize) return backfilled;
    }
  }

  /**
   * Assemble the claim forest into a renderable tree (ADR-0038 Phase 1).
   *
   * Reads every UNRELEASED claim (including claims whose session is dead —
   * the zombie protocol abandons sessions without releasing forest claims),
   * then walks `claim_forest_nodes.parent_id` ancestry upward to the repo
   * roots. Ancestry rows already exist because `ensureNode` materializes
   * repo→dir→…→file→symbol chains on every claim; this function only reads.
   */
  function buildClaimTree(): { roots: ClaimTreeNode[]; stats: ClaimTreeStats } {
    const rows = stmts.listUnreleasedWithSessionStatus.all() as Array<ClaimForestRow & { session_status: string }>;

    const nodes = new Map<string, ClaimTreeNode>();
    const parentOf = new Map<string, string | null>();
    const nodeRowCache = new Map<string, ClaimForestNodeRow | undefined>();

    const getNodeRow = (id: string): ClaimForestNodeRow | undefined => {
      if (!nodeRowCache.has(id)) {
        nodeRowCache.set(id, stmts.getNodeById.get(id) as ClaimForestNodeRow | undefined);
      }
      return nodeRowCache.get(id);
    };

    const ensureTreeNode = (id: string): ClaimTreeNode | null => {
      const existing = nodes.get(id);
      if (existing) return existing;
      const row = getNodeRow(id);
      if (!row) return null;
      const node: ClaimTreeNode = {
        nodeId: row.id,
        selectorKind: row.selector_kind,
        path: row.path,
        symbol: row.symbol,
        symbolPath: row.symbol_path,
        startLine: row.start_line,
        endLine: row.end_line,
        repoId: row.repo_id,
        worldKind: row.world_kind,
        worldId: row.world_id,
        label: nodeLabel(row),
        claims: [],
        conflict: null,
        rollup: { claims: 0, conflicts: 0, deadClaims: 0 },
        children: [],
      };
      nodes.set(id, node);
      parentOf.set(id, row.parent_id);
      return node;
    };

    const sessionIds = new Set<string>();
    let totalClaims = 0;
    let deadClaimsTotal = 0;

    for (const row of rows) {
      const node = ensureTreeNode(row.node_id);
      if (!node) continue;
      const claim = rowToClaim(row);
      const live = row.session_status === 'active';
      node.claims.push({
        sessionId: claim.sessionId,
        agentId: claim.agentId,
        purpose: claim.purpose,
        mode: claim.mode,
        intent: claim.intent,
        claimedAt: claim.claimedAt,
        sessionStatus: row.session_status,
        live,
      });
      sessionIds.add(claim.sessionId);
      totalClaims += 1;
      if (!live) deadClaimsTotal += 1;

      // Walk ancestry to the repo root. Depth-bounded by path depth; a
      // visited set guards against pathological parent cycles.
      let currentId = row.node_id;
      const visited = new Set<string>([currentId]);
      while (true) {
        const parentId = parentOf.get(currentId) ?? null;
        if (!parentId || visited.has(parentId)) break;
        visited.add(parentId);
        if (!ensureTreeNode(parentId)) break;
        currentId = parentId;
      }
    }

    // Per-node conflict rule: ≥2 unreleased claims from DISTINCT LIVE
    // sessions whose modes are Gray-incompatible. Dead-session claims never
    // cause conflict — they are stale intent, rendered dimmed.
    let conflictNodes = 0;
    for (const node of nodes.values()) {
      const liveClaims = node.claims.filter(entry => entry.live);
      const conflicted = new Set<string>();
      for (let i = 0; i < liveClaims.length; i += 1) {
        for (let j = i + 1; j < liveClaims.length; j += 1) {
          const a = liveClaims[i];
          const b = liveClaims[j];
          if (a.sessionId === b.sessionId) continue;
          if (modesConflict(a.mode, b.mode)) {
            conflicted.add(a.sessionId);
            conflicted.add(b.sessionId);
          }
        }
      }
      if (conflicted.size > 0) {
        node.conflict = { sessionIds: [...conflicted].sort() };
        conflictNodes += 1;
      }
    }

    // Link children to parents; nodes without a materialized parent are roots.
    const roots: ClaimTreeNode[] = [];
    for (const [id, node] of nodes) {
      const parentId = parentOf.get(id);
      const parent = parentId ? nodes.get(parentId) : undefined;
      if (parent && parent !== node) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Children sorted dirs-first then path (filesystem intuition).
    const childOrder = (a: ClaimTreeNode, b: ClaimTreeNode): number => {
      const aDir = a.selectorKind === 'directory' ? 0 : 1;
      const bDir = b.selectorKind === 'directory' ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      const byPath = (a.path ?? '').localeCompare(b.path ?? '');
      if (byPath !== 0) return byPath;
      return (a.startLine ?? 0) - (b.startLine ?? 0);
    };

    // Post-order rollups so a collapsed ancestor still reads red.
    const rollUp = (node: ClaimTreeNode): void => {
      node.children.sort(childOrder);
      let claims = node.claims.length;
      let conflicts = node.conflict ? 1 : 0;
      let deadClaims = node.claims.filter(entry => !entry.live).length;
      for (const child of node.children) {
        rollUp(child);
        claims += child.rollup.claims;
        conflicts += child.rollup.conflicts;
        deadClaims += child.rollup.deadClaims;
      }
      node.rollup = { claims, conflicts, deadClaims };
    };
    roots.sort((a, b) => a.repoId.localeCompare(b.repoId) || a.worldId.localeCompare(b.worldId));
    for (const root of roots) rollUp(root);

    return {
      roots,
      stats: {
        nodes: nodes.size,
        claims: totalClaims,
        conflicts: conflictNodes,
        deadClaims: deadClaimsTotal,
        sessions: sessionIds.size,
      },
    };
  }

  function addressForSessionClaim(session: SessionContext, fields: {
    path: string;
    startLine?: number | null;
    endLine?: number | null;
    symbol?: string | null;
    symbolPath?: string | null;
  }): ClaimForestAddress {
    const selectorKind: ClaimForestSelectorKind =
      fields.symbolPath || fields.symbol ? 'symbol'
        : fields.startLine != null || fields.endLine != null ? 'range'
          : 'file';
    return {
      repoId: session.identity_project,
      world: { kind: 'worktree', id: session.worktree_id },
      selector: {
        kind: selectorKind,
        path: fields.path,
        startLine: fields.startLine ?? null,
        endLine: fields.endLine ?? null,
        symbol: fields.symbol ?? null,
        symbolPath: fields.symbolPath ?? null,
      },
    };
  }

  return {
    ensureNode,
    claim,
    listActiveClaims,
    listClaimsForSession,
    getActiveClaimsForFile,
    getActiveClaimsForFileExcludingSession,
    releaseByFilePath,
    releaseBySymbolPath,
    releaseByRange,
    releaseAllBySession,
    backfillFromSessionFiles,
    addressForSessionClaim,
    scopeForSession,
    buildClaimTree,
  };
}
