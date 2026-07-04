/**
 * lib/safe/trust-ledger.ts — A5 of ADR-0088 Phase A (`pd safe`).
 *
 * The durable binary-trust ledger: a daemon-resident SQLite table that BOTH the
 * read-only `pd safe scan` and every future enforcement phase (Phase E's
 * Santa-fronted AUTH_EXEC lockdown / NEFilterDataProvider allowlist) read from.
 * It is the spine the build-stage spec (docs/adr/0088-build-stage-spec.md § A5)
 * names: keyed by `cdhash` (a sha256 fallback for unsigned binaries that have no
 * code-directory hash), carrying the signature identity, provenance, the
 * verdict, and its source.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  RUNTIME — this is DAEMON-RESIDENT STATE → bun:sqlite, not jest
 * ════════════════════════════════════════════════════════════════════════
 * The live daemon runs on Bun and opens its database through
 * `lib/sqlite-runtime.ts`, which dispatches to `bun:sqlite` when running under
 * Bun and `better-sqlite3` under Node/jest. This module takes an already-open
 * `DatabaseInstance` (the daemon's handle, or a `:memory:` handle in a test) so
 * it never reaches for an engine itself. Its regression tests run under BUN
 * (see tests/bun/safe-trust-ledger.bun.test.ts), per the repo's
 * "regression test under the REAL runtime" rule — the schema migration must boot
 * clean under the bun daemon, not merely green-in-jest.
 *
 * NO RAW SECRET is ever stored here. A binary's trust record is signature +
 * provenance metadata (team id, signing id, cdhash, notarization, quarantine).
 * None of that is a credential.
 */

import { createHash } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type {
  BinaryTrust,
  BinaryTrustClass,
  QuarantineOrigin,
} from './types.js';

// ════════════════════════════════════════════════════════════════════════
//  Ledger types
// ════════════════════════════════════════════════════════════════════════

/** A Santa-style verdict on whether a binary may run. */
export type LedgerVerdict = 'allow' | 'prompt' | 'deny';

/**
 * Where a ledger row's verdict came from, most-authoritative last. `default` =
 * derived from the scan's trust classification with no operator/Santa override.
 * `santa-sync` = imported from a synced Santa ruleset. `user` = an explicit
 * operator decision (the strongest — it wins ties on equal precedence).
 */
export type LedgerSource = 'default' | 'santa-sync' | 'user';

/** The precedence axis a resolved rule matched on. cdhash > signing_id > team_id. */
export type LedgerScope = 'cdhash' | 'signing_id' | 'team_id';

/** One durable trust-ledger row. NEVER carries a raw secret. */
export interface TrustLedgerRow {
  /** The ledger key: the binary's cdhash, or `sha256:<hex>` for unsigned. */
  cdhash: string;
  /** True when `cdhash` is a sha256 content-hash fallback (binary was unsigned). */
  cdhashIsFallback: boolean;
  /** Newline-joined set of disk paths this cdhash has been seen at. */
  paths: string[];
  teamId: string | null;
  signingId: string | null;
  /** The Authority chain (leaf → root) captured at first sight. */
  signerChain: string[];
  notarized: boolean;
  adhoc: boolean;
  trustClass: BinaryTrustClass;
  quarantineOrigin: QuarantineOrigin;
  /** Unix-ms timestamps. */
  firstSeen: number;
  lastSeen: number;
  verdict: LedgerVerdict;
  source: LedgerSource;
}

/**
 * The Santa-style precedence resolution: which rule (cdhash > signing_id >
 * team_id) decided a binary's verdict, plus the verdict itself.
 */
export interface ResolvedVerdict {
  verdict: LedgerVerdict;
  /** Which axis the matching rule keyed on. null when no rule matched at all. */
  scope: LedgerScope | null;
  source: LedgerSource | null;
  /** The matching row's cdhash, or null when only signing_id/team_id matched. */
  matchedCdhash: string | null;
}

// ════════════════════════════════════════════════════════════════════════
//  Schema
// ════════════════════════════════════════════════════════════════════════

/**
 * The ledger schema. `CREATE TABLE IF NOT EXISTS` throughout so `ensureSchema`
 * is idempotent and boots clean on a fresh daemon (the migration test). The
 * indexes back the Santa precedence resolver (signing_id, team_id lookups) and
 * the re-scan cache (path lookup).
 */
export const TRUST_LEDGER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS safe_trust_ledger (
    cdhash             TEXT PRIMARY KEY,
    cdhash_is_fallback INTEGER NOT NULL DEFAULT 0,
    paths              TEXT NOT NULL DEFAULT '',
    team_id            TEXT,
    signing_id         TEXT,
    signer_chain       TEXT NOT NULL DEFAULT '[]',
    notarized          INTEGER NOT NULL DEFAULT 0,
    adhoc              INTEGER NOT NULL DEFAULT 0,
    trust_class        TEXT NOT NULL DEFAULT 'unknown',
    quarantine_origin  TEXT NOT NULL DEFAULT 'unknown',
    first_seen         INTEGER NOT NULL,
    last_seen          INTEGER NOT NULL,
    verdict            TEXT NOT NULL DEFAULT 'prompt',
    source             TEXT NOT NULL DEFAULT 'default'
  );
  CREATE INDEX IF NOT EXISTS idx_safe_trust_signing_id ON safe_trust_ledger(signing_id);
  CREATE INDEX IF NOT EXISTS idx_safe_trust_team_id    ON safe_trust_ledger(team_id);

  CREATE TABLE IF NOT EXISTS safe_trust_scan_cache (
    path        TEXT NOT NULL,
    cdhash      TEXT NOT NULL,
    last_scan   INTEGER NOT NULL,
    PRIMARY KEY (path, cdhash)
  );
`;

/** Idempotently create the ledger tables on an open DB handle. */
export function ensureTrustLedgerSchema(db: DatabaseInstance): void {
  db.exec(TRUST_LEDGER_SCHEMA_SQL);
}

// ════════════════════════════════════════════════════════════════════════
//  Key derivation
// ════════════════════════════════════════════════════════════════════════

/**
 * Derive the ledger key for a binary. A signed binary keys on its `cdhash`
 * (the code-directory hash — the strongest cryptographic identity). An unsigned
 * binary has no cdhash, so we key on a `sha256:` content hash of its path-stable
 * identity. The caller passes the on-disk content hash for the unsigned case;
 * when none is supplied we fall back to hashing the absolute path so the row is
 * at least stable per-location (a weaker but non-colliding key).
 */
export function ledgerKey(
  trust: Pick<BinaryTrust, 'cdhash' | 'path'>,
  contentHash?: string | null,
): { cdhash: string; cdhashIsFallback: boolean } {
  if (trust.cdhash && trust.cdhash.trim().length > 0) {
    return { cdhash: trust.cdhash.trim(), cdhashIsFallback: false };
  }
  const basis = contentHash && contentHash.trim().length > 0
    ? contentHash.trim()
    : createHash('sha256').update(trust.path).digest('hex');
  // Normalise to a `sha256:` form so a fallback key is never mistaken for a
  // real cdhash by a downstream Santa importer.
  const hex = basis.startsWith('sha256:') ? basis.slice('sha256:'.length) : basis;
  return { cdhash: `sha256:${hex}`, cdhashIsFallback: true };
}

/** Map a trust classification to its DEFAULT verdict (pre-operator-override). */
export function defaultVerdictFor(trustClass: BinaryTrustClass): LedgerVerdict {
  switch (trustClass) {
    case 'platform':
    case 'dev-id-notarized':
      return 'allow';
    case 'dev-id-unnotarized':
    case 'ad-hoc':
      return 'prompt';
    case 'unsigned':
    case 'unknown':
    default:
      return 'prompt';
  }
}

// ════════════════════════════════════════════════════════════════════════
//  The ledger
// ════════════════════════════════════════════════════════════════════════

interface RawLedgerRow {
  cdhash: string;
  cdhash_is_fallback: number;
  paths: string;
  team_id: string | null;
  signing_id: string | null;
  signer_chain: string;
  notarized: number;
  adhoc: number;
  trust_class: string;
  quarantine_origin: string;
  first_seen: number;
  last_seen: number;
  verdict: string;
  source: string;
}

function hydrate(raw: RawLedgerRow): TrustLedgerRow {
  let signerChain: string[] = [];
  try {
    const parsed = JSON.parse(raw.signer_chain);
    if (Array.isArray(parsed)) signerChain = parsed.map((s) => String(s));
  } catch {
    signerChain = [];
  }
  return {
    cdhash: raw.cdhash,
    cdhashIsFallback: raw.cdhash_is_fallback === 1,
    paths: raw.paths ? raw.paths.split('\n').filter(Boolean) : [],
    teamId: raw.team_id,
    signingId: raw.signing_id,
    signerChain,
    notarized: raw.notarized === 1,
    adhoc: raw.adhoc === 1,
    trustClass: raw.trust_class as BinaryTrustClass,
    quarantineOrigin: raw.quarantine_origin as QuarantineOrigin,
    firstSeen: raw.first_seen,
    lastSeen: raw.last_seen,
    verdict: raw.verdict as LedgerVerdict,
    source: raw.source as LedgerSource,
  };
}

/** Rank a source so a stronger origin wins on equal precedence. */
function sourceRank(source: LedgerSource): number {
  switch (source) {
    case 'user':
      return 3;
    case 'santa-sync':
      return 2;
    case 'default':
    default:
      return 1;
  }
}

/**
 * The daemon-resident binary-trust ledger. Wraps an open SQLite handle (the
 * daemon's, or a `:memory:` handle under test). Self-initialises its schema on
 * construction — booting clean on a fresh daemon is the A5 migration test.
 */
export class TrustLedger {
  private readonly db: DatabaseInstance;
  private readonly now: () => number;

  constructor(db: DatabaseInstance, opts: { now?: () => number } = {}) {
    this.db = db;
    this.now = opts.now ?? (() => Date.now());
    ensureTrustLedgerSchema(db);
  }

  /**
   * Record a binary's trust posture. First sight inserts (first_seen=last_seen,
   * a `default` verdict derived from the trust class). A re-observation updates
   * last_seen, unions the path set, and refreshes the signature metadata —
   * but NEVER downgrades an operator (`user`) or `santa-sync` verdict back to a
   * `default` one. Returns the resulting row.
   */
  record(
    trust: BinaryTrust,
    opts: { contentHash?: string | null; verdict?: LedgerVerdict; source?: LedgerSource } = {},
  ): TrustLedgerRow {
    const { cdhash, cdhashIsFallback } = ledgerKey(trust, opts.contentHash);
    const now = this.now();
    const existing = this.get(cdhash);

    const signerChainJson = JSON.stringify(trust.authority ?? []);

    if (!existing) {
      const verdict = opts.verdict ?? defaultVerdictFor(trust.trustClass);
      const source = opts.source ?? 'default';
      this.db
        .prepare(
          `INSERT INTO safe_trust_ledger (
             cdhash, cdhash_is_fallback, paths, team_id, signing_id, signer_chain,
             notarized, adhoc, trust_class, quarantine_origin,
             first_seen, last_seen, verdict, source
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          cdhash,
          cdhashIsFallback ? 1 : 0,
          trust.path,
          trust.teamId,
          trust.signingId,
          signerChainJson,
          trust.notarized ? 1 : 0,
          trust.adhoc ? 1 : 0,
          trust.trustClass,
          trust.quarantine,
          now,
          now,
          verdict,
          source,
        );
      this.touchCache(trust.path, cdhash, now);
      return this.get(cdhash)!;
    }

    // Re-observation: union paths, refresh metadata, advance last_seen.
    const paths = new Set(existing.paths);
    paths.add(trust.path);

    // Verdict/source resolution: an explicit caller-supplied decision wins only
    // when it is at least as authoritative as the stored one. A bare re-scan
    // (no opts.verdict) NEVER overwrites a user/santa decision with a default.
    let verdict = existing.verdict;
    let source = existing.source;
    if (opts.verdict !== undefined) {
      const incomingSource = opts.source ?? 'user';
      if (sourceRank(incomingSource) >= sourceRank(existing.source)) {
        verdict = opts.verdict;
        source = incomingSource;
      }
    }

    this.db
      .prepare(
        `UPDATE safe_trust_ledger SET
           paths = ?, team_id = ?, signing_id = ?, signer_chain = ?,
           notarized = ?, adhoc = ?, trust_class = ?, quarantine_origin = ?,
           last_seen = ?, verdict = ?, source = ?
         WHERE cdhash = ?`,
      )
      .run(
        Array.from(paths).join('\n'),
        trust.teamId,
        trust.signingId,
        signerChainJson,
        trust.notarized ? 1 : 0,
        trust.adhoc ? 1 : 0,
        trust.trustClass,
        trust.quarantine,
        now,
        verdict,
        source,
        cdhash,
      );
    this.touchCache(trust.path, cdhash, now);
    return this.get(cdhash)!;
  }

  /** Set an explicit operator/Santa verdict for a cdhash. */
  setVerdict(cdhash: string, verdict: LedgerVerdict, source: LedgerSource = 'user'): void {
    this.db
      .prepare(`UPDATE safe_trust_ledger SET verdict = ?, source = ? WHERE cdhash = ?`)
      .run(verdict, source, cdhash);
  }

  /** Fetch one row by cdhash. */
  get(cdhash: string): TrustLedgerRow | null {
    const raw = this.db
      .prepare(`SELECT * FROM safe_trust_ledger WHERE cdhash = ?`)
      .get(cdhash) as RawLedgerRow | undefined;
    return raw ? hydrate(raw) : null;
  }

  /** All rows (for the posture report's aggregate + the Phase E rule export). */
  all(): TrustLedgerRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM safe_trust_ledger ORDER BY last_seen DESC`)
      .all() as RawLedgerRow[];
    return rows.map(hydrate);
  }

  /**
   * Santa-style precedence resolver: given a binary's identity, resolve its
   * verdict by the strongest matching rule, in order cdhash > signing_id >
   * team_id. On a tie within one axis (multiple signing_id/team_id rows) the
   * stronger `source` wins, then `deny` over `prompt` over `allow` (fail-safe:
   * an explicit block is never overridden by a sibling allow). Returns the
   * matched scope/source so the caller can show WHY.
   */
  resolve(identity: {
    cdhash?: string | null;
    signingId?: string | null;
    teamId?: string | null;
  }): ResolvedVerdict {
    // 1. cdhash — the exact-binary rule, highest precedence.
    if (identity.cdhash) {
      const row = this.get(identity.cdhash);
      if (row) {
        return {
          verdict: row.verdict,
          scope: 'cdhash',
          source: row.source,
          matchedCdhash: row.cdhash,
        };
      }
    }

    // 2. signing_id — same-publisher rule.
    if (identity.signingId) {
      const rows = (this.db
        .prepare(`SELECT * FROM safe_trust_ledger WHERE signing_id = ?`)
        .all(identity.signingId) as RawLedgerRow[]).map(hydrate);
      const winner = this.pickWinner(rows);
      if (winner) {
        return {
          verdict: winner.verdict,
          scope: 'signing_id',
          source: winner.source,
          matchedCdhash: winner.cdhash,
        };
      }
    }

    // 3. team_id — same-team rule, broadest.
    if (identity.teamId) {
      const rows = (this.db
        .prepare(`SELECT * FROM safe_trust_ledger WHERE team_id = ?`)
        .all(identity.teamId) as RawLedgerRow[]).map(hydrate);
      const winner = this.pickWinner(rows);
      if (winner) {
        return {
          verdict: winner.verdict,
          scope: 'team_id',
          source: winner.source,
          matchedCdhash: winner.cdhash,
        };
      }
    }

    return { verdict: 'prompt', scope: null, source: null, matchedCdhash: null };
  }

  /** Tie-break within one precedence axis: stronger source, then fail-safe verdict. */
  private pickWinner(rows: TrustLedgerRow[]): TrustLedgerRow | null {
    if (rows.length === 0) return null;
    const verdictRank = (v: LedgerVerdict): number =>
      v === 'deny' ? 3 : v === 'prompt' ? 2 : 1;
    return rows.reduce((best, cur) => {
      if (sourceRank(cur.source) !== sourceRank(best.source)) {
        return sourceRank(cur.source) > sourceRank(best.source) ? cur : best;
      }
      return verdictRank(cur.verdict) > verdictRank(best.verdict) ? cur : best;
    });
  }

  /**
   * Re-scan cache probe. Returns true when this exact (path, cdhash) pair was
   * already recorded — so the scanner can SKIP re-shelling `codesign` for an
   * unchanged binary. The cdhash comes from a cheap content/signature probe the
   * caller already holds; an unchanged binary yields the same cdhash, a tampered
   * one yields a different cdhash and misses the cache (so it gets re-assessed).
   */
  isCached(path: string, cdhash: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM safe_trust_scan_cache WHERE path = ? AND cdhash = ?`)
      .get(path, cdhash);
    return row !== undefined && row !== null;
  }

  private touchCache(path: string, cdhash: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO safe_trust_scan_cache (path, cdhash, last_scan)
         VALUES (?, ?, ?)
         ON CONFLICT(path, cdhash) DO UPDATE SET last_scan = excluded.last_scan`,
      )
      .run(path, cdhash, now);
  }

  /** Count of distinct ledger rows (for the report's coverage line). */
  count(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM safe_trust_ledger`)
      .get() as { n: number };
    return row.n;
  }
}
