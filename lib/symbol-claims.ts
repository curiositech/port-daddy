/**
 * Symbol claims — typed, symbol-level claims with automatic blast-radius reservation.
 *
 * The Silent Consumer fix (semantic-conflict-prediction discipline): when an agent
 * declares it will `modify` a symbol, this auto-derives `read` claims over that
 * symbol's blast radius (every downstream caller, via `lib/blast-radius.ts`). So a
 * contract change holds its callers stable *without the agent having to enumerate
 * them*, and any other agent that touches the radius gets an advisory conflict.
 *
 * This realizes the skill's Symbol Claims model on top of the shipped pieces:
 *   - `symbol-index.predictConflicts` — the rich taxonomy (direct/dependency/
 *     signature/transitive) over typed claims.
 *   - `blast-radius.computeBlastRadius` — the reverse-dep closure to auto-reserve.
 *
 * Blocking semantics: `claim()` itself records and *returns* the conflicts — the
 * module never throws on conflict. But its HTTP caller (POST /sessions/:id/symbols,
 * the ast-a2-1 pre-flight validator, #983) REFUSES `blocking`-severity conflicts
 * with 409 BLOCKING_CONFLICT, so over the wire a blocking claim does not land.
 * Non-blocking conflicts stay advisory. Claims release with the session.
 */

import type Database from 'better-sqlite3';
import { computeBlastRadius } from './blast-radius.js';
import { isContractChanging, type ClaimType } from './symbol-conflict-matrix.js';

export type SymbolClaimType = ClaimType;

export interface SymbolClaimInput {
  filePath: string;
  symbolPath: string;
  type: SymbolClaimType;
}

export interface SymbolClaimRow {
  id: number;
  sessionId: string;
  filePath: string;
  symbolPath: string;
  type: SymbolClaimType;
  autoDerived: boolean;
  derivedFrom: string | null;
  createdAt: number;
}

/** As returned by `symbol-index.predictConflicts`, annotated with the other session. */
export interface SymbolConflict {
  type: string;
  severity: 'blocking' | 'warning' | 'info';
  confidence: number;
  a: SymbolClaimInput;
  b: SymbolClaimInput;
  chain?: string[];
  otherSessionId: string;
  otherAgentId?: string | null;
}

/** The slice of `symbol-index` this needs (so it's faked in tests). */
export interface SymbolClaimsSymbolIndex {
  getDependents(
    filePath: string,
    symbolPath?: string,
  ): Array<{ sourceFile: string; sourceSymbol: string | null; dependencyType: string }>;
  predictConflicts(a: SymbolClaimInput[], b: SymbolClaimInput[]): Array<{
    type: string;
    severity: 'blocking' | 'warning' | 'info';
    confidence: number;
    a: SymbolClaimInput;
    b: SymbolClaimInput;
    chain?: string[];
  }>;
}

export interface SymbolClaimsDeps {
  symbolIndex: SymbolClaimsSymbolIndex;
  now?: () => number;
  /** Map a session id → its agent id, for annotating conflicts (optional). */
  agentForSession?: (sessionId: string) => string | null;
  /** Default blast-radius depth when auto-deriving. */
  defaultRadiusDepth?: number;
}

export interface ClaimOptions {
  /** Auto-reserve `read` over each modify-claim's blast radius. Default true. */
  autoDeriveRadius?: boolean;
  radiusDepth?: number;
}

export interface ClaimResult {
  claimed: SymbolClaimRow[];
  autoDerived: SymbolClaimRow[];
  conflicts: SymbolConflict[];
}

interface DbRow {
  id: number;
  session_id: string;
  file_path: string;
  symbol_path: string;
  claim_type: string;
  auto_derived: number;
  derived_from: string | null;
  created_at: number;
}

function rowToClaim(r: DbRow): SymbolClaimRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    filePath: r.file_path,
    symbolPath: r.symbol_path,
    type: r.claim_type as SymbolClaimType,
    autoDerived: r.auto_derived === 1,
    derivedFrom: r.derived_from,
    createdAt: r.created_at,
  };
}

const keyOf = (c: { filePath: string; symbolPath: string }) => `${c.filePath}::${c.symbolPath}`;

export function createSymbolClaims(db: Database.Database, deps: SymbolClaimsDeps) {
  const now = deps.now ?? (() => Date.now());
  const defaultDepth = deps.defaultRadiusDepth ?? 3;

  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      symbol_path TEXT NOT NULL,
      claim_type TEXT NOT NULL,
      auto_derived INTEGER NOT NULL DEFAULT 0,
      derived_from TEXT,
      created_at INTEGER NOT NULL,
      released_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_symbol_claims_active ON symbol_claims(session_id, released_at);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO symbol_claims (session_id, file_path, symbol_path, claim_type, auto_derived, derived_from, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    get: db.prepare<[number], DbRow>(`SELECT * FROM symbol_claims WHERE id = ?`),
    activeForSession: db.prepare<[string], DbRow>(
      `SELECT * FROM symbol_claims WHERE session_id = ? AND released_at IS NULL`,
    ),
    allActive: db.prepare(`SELECT * FROM symbol_claims WHERE released_at IS NULL ORDER BY session_id, id`),
    existsActive: db.prepare<[string, string, string], { id: number }>(
      `SELECT id FROM symbol_claims WHERE session_id = ? AND file_path = ? AND symbol_path = ? AND released_at IS NULL`,
    ),
    release: db.prepare(`UPDATE symbol_claims SET released_at = ? WHERE session_id = ? AND released_at IS NULL`),
  };

  /** Collapse to one claim per (file,symbol); `modify` wins over `read`, explicit over auto. */
  /** Higher precedence wins when one (file,symbol) is claimed several ways: an EXPLICIT
   *  claim beats an auto-derived one; a contract-changing type (modify/delete/rename)
   *  beats an add, which beats a read. */
  function precedence(c: { type: SymbolClaimType; autoDerived: boolean }): number {
    const explicitBonus = c.autoDerived ? 0 : 10;
    const typeRank = isContractChanging(c.type) ? 3 : c.type === 'read' ? 1 : 2;
    return explicitBonus + typeRank;
  }

  function dedupe(
    inputs: Array<SymbolClaimInput & { autoDerived?: boolean; derivedFrom?: string | null }>,
  ): Array<SymbolClaimInput & { autoDerived: boolean; derivedFrom: string | null }> {
    const byKey = new Map<string, SymbolClaimInput & { autoDerived: boolean; derivedFrom: string | null }>();
    for (const c of inputs) {
      const k = keyOf(c);
      const next = { ...c, autoDerived: c.autoDerived ?? false, derivedFrom: c.derivedFrom ?? null };
      const existing = byKey.get(k);
      if (!existing || precedence(next) > precedence(existing)) byKey.set(k, next);
    }
    return [...byKey.values()];
  }

  function activeClaimsBySession(): Map<string, SymbolClaimInput[]> {
    const rows = stmts.allActive.all() as DbRow[];
    const bySession = new Map<string, SymbolClaimInput[]>();
    for (const r of rows) {
      const arr = bySession.get(r.session_id) ?? [];
      arr.push({ filePath: r.file_path, symbolPath: r.symbol_path, type: r.claim_type as SymbolClaimType });
      bySession.set(r.session_id, arr);
    }
    return bySession;
  }

  return {
    /**
     * Record an agent's symbol claims, auto-reserving each modify's blast radius, and
     * return any predicted conflicts with other active sessions. Idempotent per
     * (session,file,symbol): an already-held symbol is not re-inserted.
     */
    claim(sessionId: string, inputClaims: SymbolClaimInput[], options: ClaimOptions = {}): ClaimResult {
      const at = now();
      const autoDeriveRadius = options.autoDeriveRadius ?? true;
      const depth = options.radiusDepth ?? defaultDepth;

      // 1. Expand modify-claims into auto-derived read-claims over each blast radius.
      const expanded: Array<SymbolClaimInput & { autoDerived?: boolean; derivedFrom?: string | null }> = [
        ...inputClaims.map((c) => ({ ...c })),
      ];
      if (autoDeriveRadius) {
        for (const c of inputClaims) {
          // Contract-changing claims (modify/delete/rename) break their callers, so
          // reserve `read` over the blast radius. A rename's radius is its reference
          // sites — exactly the "implicit read-claim on every reference" the skill names.
          if (!isContractChanging(c.type)) continue;
          const radius = computeBlastRadius(deps.symbolIndex, { filePath: c.filePath, symbolPath: c.symbolPath }, depth);
          for (const n of radius) {
            expanded.push({ filePath: n.filePath, symbolPath: n.symbolPath, type: 'read', autoDerived: true, derivedFrom: keyOf(c) });
          }
        }
      }

      // 2. Dedupe (modify > read, explicit > auto) and persist the ones not already held.
      const claimed: SymbolClaimRow[] = [];
      const autoDerived: SymbolClaimRow[] = [];
      for (const c of dedupe(expanded)) {
        if (stmts.existsActive.get(sessionId, c.filePath, c.symbolPath)) continue;
        const res = stmts.insert.run(sessionId, c.filePath, c.symbolPath, c.type, c.autoDerived ? 1 : 0, c.derivedFrom, at);
        const row = rowToClaim(stmts.get.get(Number(res.lastInsertRowid))!);
        claimed.push(row);
        if (row.autoDerived) autoDerived.push(row);
      }

      // 3. Predict conflicts: this session's full active claim set vs every other session's.
      const bySession = activeClaimsBySession();
      const mine = bySession.get(sessionId) ?? [];
      const conflicts: SymbolConflict[] = [];
      for (const [otherSession, theirs] of bySession) {
        if (otherSession === sessionId || !theirs.length || !mine.length) continue;
        for (const p of deps.symbolIndex.predictConflicts(mine, theirs)) {
          conflicts.push({
            ...p,
            otherSessionId: otherSession,
            otherAgentId: deps.agentForSession?.(otherSession) ?? null,
          });
        }
      }
      conflicts.sort((x, y) => {
        const order = { blocking: 0, warning: 1, info: 2 } as const;
        return order[x.severity] - order[y.severity] || y.confidence - x.confidence;
      });

      return { claimed, autoDerived, conflicts };
    },

    list(sessionId: string): SymbolClaimRow[] {
      return (stmts.activeForSession.all(sessionId) as DbRow[]).map(rowToClaim);
    },

    listAllActive(): SymbolClaimRow[] {
      return (stmts.allActive.all() as DbRow[]).map(rowToClaim);
    },

    /** Release all of a session's symbol claims (call on session done). Returns count. */
    release(sessionId: string): number {
      return stmts.release.run(now(), sessionId).changes;
    },
  };
}

export type SymbolClaims = ReturnType<typeof createSymbolClaims>;
