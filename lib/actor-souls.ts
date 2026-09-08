/**
 * lib/actor-souls.ts — daemon-minted, non-forgeable actor identity (ADR-0040 keystone).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 * Port Daddy identities were **self-asserted strings** (`project:stack:context`).
 * An agent that earned a throttle, a slash, or a bad record simply re-registered
 * under a fresh string and inherited a clean slate — the "Sybil-reset" hole
 * (Douceur 2002). Every reputation / sanction / obligation mechanism built on a
 * self-asserted id is "climbing an imaginary staircase" (ADR-0040).
 *
 * This module makes the daemon the *only* component that mints principals. On
 * first registration it mints an opaque ULID `actor_id` bound to a credential the
 * agent cannot cheaply re-pick (ADR-0022 body-lease secret). The self-asserted
 * `project:stack:context` string becomes a **display alias** that resolves *to*
 * the minted id — never the other way around.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  THE CREDENTIAL IS A SELECTOR.VERIFIER LOOKUP TOKEN (verifiable, O(1))
 * ════════════════════════════════════════════════════════════════════════════
 *   credential = "<actor_id>.<secret>"     — daemon-issued once, opaque to the agent
 *
 * The `actor_id` half is the **selector**: parse it, look the row up by the PK
 * `(harbor, actor_id)` in O(1), read *that row's* salt, and check
 * `sha256(salt | secret) == credential_hash` in constant time. This is the
 * standard "lookup-token" pattern; it fixes the v1 per-row-salt scheme that could
 * not be selected without already knowing the row.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  HONEST POSTURE — fail-CLOSED above the floor, fail-OPEN at a bounded floor
 * ════════════════════════════════════════════════════════════════════════════
 * Per ADR-0040 the adversary is a **lazy/self-interested agent in a fleet the
 * operator owns**, NOT a hostile human operator. This module is calibrated to
 * that bar and no higher:
 *
 *   - ABOVE the shared newcomer-spend ceiling: execution REQUIRES a
 *     credentialed, graduated soul (or operator-trusted). No soul ⇒ REJECT. This
 *     is genuine fail-closed — enforced at the spend choke in budget-guard.
 *   - AT/BELOW the floor: an uncredentialed registration is ADMITTED as a
 *     newcomer that draws from a SHARED per-project pool (see budget-guard). This
 *     is fail-OPEN-at-a-bounded-floor. It is safe only because the floor is a
 *     shared, capped pool — minting fresh ids buys NO new budget.
 *
 * NOT CLAIMED: this slice is not "Sybil-proof". A fleet agent running as the same
 * UID as the daemon can read `~/.port-daddy/operator.secret` (0600) and forge an
 * operatorToken, and — until the `door` lane makes the SQLite write-boundary real
 * — can write a `budget_ledger`/`newcomer_pool` row directly and bypass the pool.
 * Both are explicitly within ADR-0040's non-goal (no defense against a same-UID /
 * malicious human operator). See the operator-token note below.
 */

import type { Database } from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isReservedIdentityName } from './reserved-identity-names.js';
import type { ForensicsSink } from './forensics-archive.js';

// ─── Branded principal type (ADR-0040 §8 widening boundary) ─────────────────────
// A minted ULID *or* a migrated legacy string satisfies this via asActorId().
export type ActorId = string & { readonly __brand: 'actor_id' };
export function asActorId(raw: string): ActorId {
  return raw as ActorId;
}

// ─── Tunable policy constants ───────────────────────────────────────────────────
export interface ActorSoulsConfig {
  /** Default multi-tenant scope when a caller does not name one. */
  defaultHarbor?: string;
  /** Daemon-witnessed clean exits required to leave the newcomer pool. */
  graduationThreshold?: number;
  /** Project-wide daily USD cap shared by ALL uncredentialed newcomers. */
  newcomerPoolCeilingUsd?: number;
  /**
   * Operator-trusted secret. Test/embed override. When omitted the module reads
   * ~/.port-daddy/operator.secret (0600). HONEST LIMIT: a same-UID agent can read
   * that file — the operator escape hatch is *advisory-above-floor*, not a
   * cryptographic capability (ADR-0040 non-goal).
   */
  operatorSecret?: string | null;
  /** Override for the operator secret path (testing). */
  operatorSecretPath?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /**
   * Durable security-forensics journal (ADR-0089). Every retirement and every
   * resurrection of a soul is written here, in full, the moment it happens —
   * a retire-and-respawn whitewash must leave a trail that outlives the
   * 7-day activity_log prune. Optional so embedded/test stores still work;
   * server.ts always wires it.
   */
  forensicsSink?: ForensicsSink;
}

export type SoulClass = 'newcomer' | 'graduated' | 'operator' | 'unknown';

export interface ActorSoulRow {
  actorId: ActorId;
  harbor: string;
  credentialKind: 'soul-secret' | 'operator' | 'migrated';
  displayAlias: string | null;
  cleanExits: number;
  operatorTrusted: boolean;
  createdAt: number;
  lastSeenAt: number;
  /** Retirement tombstone (ms). Non-null ⇒ the soul cannot act or be re-minted. */
  retiredAt: number | null;
  retiredReason: string | null;
  retiredBy: string | null;
  /** Set only by an audited resurrection; the trigger requires a fresh one. */
  resurrectionReceipt: string | null;
  resurrectedAt: number | null;
  resurrectedBy: string | null;
}

export type RetireOutcome =
  | { ok: true; actorId: ActorId; retiredAt: number }
  | { ok: false; code: 'SOUL_NOT_FOUND' | 'ALREADY_RETIRED' };

export type ResurrectOutcome =
  | { ok: true; actorId: ActorId; receipt: string; resurrectedAt: number }
  | { ok: false; code: 'SOUL_NOT_FOUND' | 'NOT_RETIRED' };

/** Journal rule names for the two identity-lifecycle transitions (ADR-0089). */
export const IDENTITY_RETIRED_RULE = 'IDENTITY_RETIRED';
export const IDENTITY_RESURRECTED_RULE = 'IDENTITY_RESURRECTED';

export interface MintResult {
  actorId: ActorId;
  /** Plaintext credential — returned to the caller ONCE, never stored plaintext. */
  credential: string;
}

export type RegisterOutcome =
  | { ok: true; status: 'resolved';   actorId: ActorId; soulClass: SoulClass }              // valid credential ⇒ same id
  | { ok: true; status: 'minted';     actorId: ActorId; soulClass: SoulClass; credential: string }
  | { ok: false; status: 'rejected';  code: 'CREDENTIAL_INVALID'; httpStatus: 401 }
  | { ok: false; status: 'rejected';  code: 'RESERVED_ALIAS'; httpStatus: 403 }
  // The credential VERIFIED (so nothing leaks to a guesser) but the soul is
  // retired: it may not act again until an audited resurrection.
  | { ok: false; status: 'rejected';  code: 'IDENTITY_RETIRED'; httpStatus: 403 }
  | { ok: false; status: 'rejected';  code: 'STORE_UNAVAILABLE'; httpStatus: 503 };

export interface ResolvedActor {
  actorId: ActorId;
  soulClass: SoulClass;
}

// ─── Crockford base32 ULID (48-bit time + 80-bit randomness) ────────────────────
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now: number): string {
  let ts = now;
  const time = new Array(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = CROCKFORD[ts % 32];
    ts = Math.floor(ts / 32);
  }
  const rnd = randomBytes(10); // 80 bits
  const rand = new Array(16);
  // Emit 16 base32 chars from 80 bits, 5 bits at a time.
  let bitBuffer = 0;
  let bits = 0;
  let out = 0;
  for (let i = 0; i < rnd.length; i++) {
    bitBuffer = (bitBuffer << 8) | rnd[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand[out++] = CROCKFORD[(bitBuffer >> bits) & 31];
    }
  }
  return time.join('') + rand.join('');
}

// ─── Hashing helpers ────────────────────────────────────────────────────────────
function hashCredential(salt: string, secret: string): string {
  return createHash('sha256').update(salt).update('|').update(secret).digest('hex');
}

/** Constant-time hex-string compare; false on any length mismatch. */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Split "<actor_id>.<secret>" — actor_id is the selector, secret the verifier. */
function parseCredential(credential: string): { actorId: string; secret: string } | null {
  const dot = credential.indexOf('.');
  if (dot <= 0 || dot >= credential.length - 1) return null;
  const actorId = credential.slice(0, dot);
  const secret = credential.slice(dot + 1);
  if (!actorId || !secret) return null;
  return { actorId, secret };
}

// ─── Module factory ─────────────────────────────────────────────────────────────
export function createActorSouls(db: Database, config: ActorSoulsConfig = {}) {
  const defaultHarbor = config.defaultHarbor ?? 'local';
  const graduationThreshold = Math.max(1, config.graduationThreshold ?? 3);
  const newcomerPoolCeilingUsd = Math.max(0, config.newcomerPoolCeilingUsd ?? 1.0);
  const now = config.now ?? Date.now;

  const runDDL = (sql: string): void => { db.prepare(sql).run(); };

  runDDL(`
    CREATE TABLE IF NOT EXISTS actor_souls (
      actor_id         TEXT NOT NULL,
      harbor           TEXT NOT NULL,
      credential_hash  TEXT,
      credential_salt  TEXT,
      credential_kind  TEXT NOT NULL DEFAULT 'soul-secret',
      display_alias    TEXT,
      clean_exits      INTEGER NOT NULL DEFAULT 0,
      operator_trusted INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL,
      last_seen_at     INTEGER NOT NULL,
      PRIMARY KEY (harbor, actor_id)
    )
  `);
  // Kept only to reject accidental hash reuse; NOT the lookup path (lookup is by PK).
  runDDL(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_soul_cred
      ON actor_souls(harbor, credential_hash) WHERE credential_hash IS NOT NULL
  `);

  // ─── Retirement tombstone + audited resurrection (identity keystone) ─────────
  // A soul that earned a slash, a throttle, or a halt must not come back by
  // having "its status flipped" — that is the retire-and-respawn whitewash
  // ADR-0040 exists to close. The columns are additive (PRAGMA-guarded ALTER,
  // same style as roadmap_items.deleted_at in lib/db.ts) so a DB written by an
  // older daemon migrates on first boot with no failing CREATE. The RULES live
  // in SQLite triggers, not in this module: a raw UPDATE from any code path —
  // or any process holding the file — meets the same wall as the app layer.
  //
  //   retired_at / retired_reason / retired_by   — the tombstone
  //   resurrection_receipt / resurrected_at / _by — the audited way back
  //
  // Why a same-statement receipt column and not a session PRAGMA/temp-table
  // token: the receipt is durable evidence ON THE ROW (greppable, joinable to
  // the forensics journal by value), it is unique across the table so it cannot
  // be replayed, and it needs no connection-scoped state that a second handle
  // on the same file would not see. A temp-table token would be invisible in
  // the DB after the fact — exactly the property a forensic reviewer needs.
  {
    const soulColumns = new Set(
      (db.prepare('PRAGMA table_info(actor_souls)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    const additive: Array<[string, string]> = [
      ['retired_at', 'INTEGER'],
      ['retired_reason', 'TEXT'],
      ['retired_by', 'TEXT'],
      ['resurrection_receipt', 'TEXT'],
      ['resurrected_at', 'INTEGER'],
      ['resurrected_by', 'TEXT'],
    ];
    for (const [column, type] of additive) {
      if (!soulColumns.has(column)) runDDL(`ALTER TABLE actor_souls ADD COLUMN ${column} ${type}`);
    }
    // Post-apply verification ("migration history is not migration"): inspect
    // the live table, fail closed if the ALTER did not land.
    const after = new Set(
      (db.prepare('PRAGMA table_info(actor_souls)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    const missing = additive.map(([column]) => column).filter((column) => !after.has(column));
    if (missing.length > 0) {
      throw new Error(`actor_souls retirement migration verification failed: missing ${missing.join(', ')}`);
    }
  }
  // A receipt is minted once, for one resurrection, of one soul.
  runDDL(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_soul_resurrection_receipt
      ON actor_souls(resurrection_receipt) WHERE resurrection_receipt IS NOT NULL
  `);
  // Rule 1 — no silent resurrection. Clearing retired_at requires a receipt
  // that differs from whatever receipt the row already carried (a replayed
  // receipt from a previous resurrection is not a fresh audit).
  runDDL(`
    CREATE TRIGGER IF NOT EXISTS actor_souls_retired_no_silent_resurrection
    BEFORE UPDATE ON actor_souls
    WHEN OLD.retired_at IS NOT NULL AND NEW.retired_at IS NULL
     AND (NEW.resurrection_receipt IS NULL OR NEW.resurrection_receipt IS OLD.resurrection_receipt)
    BEGIN
      SELECT RAISE(ABORT, 'ACTOR_SOUL_RETIRED: a retired soul can only be reactivated by an audited resurrection carrying a fresh resurrection_receipt');
    END
  `);
  // Rule 2 — a retired soul is frozen. While the tombstone stands, nothing that
  // confers authority or reputation may change: not the credential (re-keying
  // a retired soul is a resurrection in disguise), not operator trust, not the
  // clean-exit count, not the tombstone timestamp, not the identity key.
  runDDL(`
    CREATE TRIGGER IF NOT EXISTS actor_souls_retired_frozen
    BEFORE UPDATE ON actor_souls
    WHEN OLD.retired_at IS NOT NULL AND NEW.retired_at IS NOT NULL
     AND (NEW.credential_hash IS NOT OLD.credential_hash
       OR NEW.credential_salt IS NOT OLD.credential_salt
       OR NEW.operator_trusted IS NOT OLD.operator_trusted
       OR NEW.clean_exits IS NOT OLD.clean_exits
       OR NEW.retired_at IS NOT OLD.retired_at
       OR NEW.actor_id IS NOT OLD.actor_id
       OR NEW.harbor IS NOT OLD.harbor)
    BEGIN
      SELECT RAISE(ABORT, 'ACTOR_SOUL_RETIRED: a retired soul is frozen; resurrect it through the audited path before changing it');
    END
  `);
  // Rule 3 — the tombstone cannot be removed. Together with the (harbor,
  // actor_id) PRIMARY KEY this is what makes "re-mint under the same identity
  // key while retired" a constraint failure instead of a clean slate: the
  // only way to INSERT that key again would be to DELETE the tombstone first.
  runDDL(`
    CREATE TRIGGER IF NOT EXISTS actor_souls_retired_tombstone
    BEFORE DELETE ON actor_souls
    WHEN OLD.retired_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'ACTOR_SOUL_RETIRED: a retired soul is a tombstone; it cannot be deleted and its identity key cannot be re-minted');
    END
  `);
  runDDL(`
    CREATE TABLE IF NOT EXISTS actor_alias (
      harbor    TEXT NOT NULL,
      alias     TEXT NOT NULL,
      actor_id  TEXT NOT NULL,
      bound_at  INTEGER NOT NULL,
      PRIMARY KEY (harbor, alias)
    )
  `);
  // Shared newcomer budget pool — the anti-launder core (metered by budget-guard).
  // `souls_seen` remains in the local schema so existing daemon databases retain
  // their rows unchanged; it is no longer an admission signal.
  runDDL(`
    CREATE TABLE IF NOT EXISTS newcomer_pool (
      project    TEXT NOT NULL,
      day        TEXT NOT NULL,
      spend_usd  REAL NOT NULL DEFAULT 0,
      souls_seen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project, day)
    )
  `);

  const selectSoul = db.prepare(`
    SELECT actor_id, harbor, credential_hash, credential_salt, credential_kind,
           display_alias, clean_exits, operator_trusted, created_at, last_seen_at,
           retired_at, retired_reason, retired_by,
           resurrection_receipt, resurrected_at, resurrected_by
      FROM actor_souls WHERE harbor = ? AND actor_id = ?
  `);
  const insertSoul = db.prepare(`
    INSERT INTO actor_souls
      (actor_id, harbor, credential_hash, credential_salt, credential_kind,
       display_alias, clean_exits, operator_trusted, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  // Touch/bump are scoped to LIVE souls: a retired soul neither "was seen"
  // nor earns graduation. (The frozen trigger would abort a clean_exits bump
  // on a tombstone anyway; the WHERE keeps the app path a quiet no-op.)
  const touchSoul = db.prepare(`
    UPDATE actor_souls SET last_seen_at = ?, display_alias = ?
     WHERE harbor = ? AND actor_id = ? AND retired_at IS NULL
  `);
  const bumpCleanExits = db.prepare(`
    UPDATE actor_souls SET clean_exits = clean_exits + 1, last_seen_at = ?
     WHERE harbor = ? AND actor_id = ? AND retired_at IS NULL
  `);
  const retireSoul = db.prepare(`
    UPDATE actor_souls
       SET retired_at = ?, retired_reason = ?, retired_by = ?
     WHERE harbor = ? AND actor_id = ? AND retired_at IS NULL
  `);
  // The audited way back: clears the tombstone and stamps a fresh receipt IN
  // THE SAME STATEMENT — the only shape the no-silent-resurrection trigger lets through.
  const resurrectSoul = db.prepare(`
    UPDATE actor_souls
       SET retired_at = NULL, retired_reason = NULL, retired_by = NULL,
           resurrection_receipt = ?, resurrected_at = ?, resurrected_by = ?,
           last_seen_at = ?
     WHERE harbor = ? AND actor_id = ? AND retired_at IS NOT NULL
  `);
  const selectAlias = db.prepare(`
    SELECT actor_id FROM actor_alias WHERE harbor = ? AND alias = ?
  `);
  const upsertAlias = db.prepare(`
    INSERT INTO actor_alias (harbor, alias, actor_id, bound_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(harbor, alias) DO NOTHING
  `);
  const selectPool = db.prepare(`
    SELECT spend_usd FROM newcomer_pool WHERE project = ? AND day = ?
  `);
  const bumpPoolSpend = db.prepare(`
    INSERT INTO newcomer_pool (project, day, spend_usd)
    VALUES (?, ?, ?)
    ON CONFLICT(project, day) DO UPDATE SET spend_usd = spend_usd + excluded.spend_usd
  `);

  function rowToSoul(row: any): ActorSoulRow {
    return {
      actorId: asActorId(row.actor_id),
      harbor: row.harbor,
      credentialKind: row.credential_kind,
      displayAlias: row.display_alias ?? null,
      cleanExits: row.clean_exits,
      operatorTrusted: row.operator_trusted === 1,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      retiredAt: row.retired_at ?? null,
      retiredReason: row.retired_reason ?? null,
      retiredBy: row.retired_by ?? null,
      resurrectionReceipt: row.resurrection_receipt ?? null,
      resurrectedAt: row.resurrected_at ?? null,
      resurrectedBy: row.resurrected_by ?? null,
    };
  }

  function getSoul(actorId: string, harbor = defaultHarbor): ActorSoulRow | null {
    const row = selectSoul.get(harbor, actorId);
    return row ? rowToSoul(row) : null;
  }

  /**
   * Classify a KNOWN soul row. Newcomer until it graduates on clean exits.
   * A RETIRED soul classifies as 'unknown': every consumer already floors
   * 'unknown' to the shared newcomer pool / no verified principal, which is
   * exactly the standing a tombstone should have — no more than a forged id.
   */
  function classifyRow(soul: ActorSoulRow): SoulClass {
    if (soul.retiredAt !== null) return 'unknown';
    if (soul.operatorTrusted) return 'operator';
    if (soul.cleanExits >= graduationThreshold) return 'graduated';
    return 'newcomer';
  }

  function classify(actorId: string, harbor = defaultHarbor): SoulClass {
    const soul = getSoul(actorId, harbor);
    return soul ? classifyRow(soul) : 'unknown';
  }

  /** Alias → id, one-way only (§3). Never resolves id → alias. */
  function resolveAlias(alias: string, harbor = defaultHarbor): ActorId | null {
    const row = selectAlias.get(harbor, alias) as { actor_id: string } | undefined;
    return row ? asActorId(row.actor_id) : null;
  }

  /**
   * Resolve any agent handle (a minted actor_id OR a display alias) to a
   * principal + class, for the budget-guard spend choke. An UNKNOWN handle
   * (self-asserted / forged, no soul) resolves to soulClass 'unknown', which the
   * spend choke floors to the shared newcomer pool — NEVER an above-floor ceiling.
   */
  function resolveActor(handle: string, harbor = defaultHarbor): ResolvedActor {
    // Direct soul hit first (handle already a minted id)?
    const direct = getSoul(handle, harbor);
    if (direct) return { actorId: direct.actorId, soulClass: classifyRow(direct) };
    // Alias → id?
    const viaAlias = resolveAlias(handle, harbor);
    if (viaAlias) {
      const soul = getSoul(viaAlias, harbor);
      if (soul) return { actorId: soul.actorId, soulClass: classifyRow(soul) };
    }
    // Unknown / un-souled — pool-floored by the caller.
    return { actorId: asActorId(handle), soulClass: 'unknown' };
  }

  /** Mint a fresh soul. `explicitActorId` is used by the migration (identity map). */
  function mint(opts: {
    harbor?: string;
    alias?: string | null;
    operatorTrusted?: boolean;
    credentialKind?: 'soul-secret' | 'operator' | 'migrated';
    explicitActorId?: string;
  } = {}): MintResult {
    const harbor = opts.harbor ?? defaultHarbor;
    const ts = now();
    const actorId = opts.explicitActorId ?? ulid(ts);
    if (opts.explicitActorId) {
      // The PK would refuse this anyway (the tombstone cannot be deleted); say why.
      const existing = getSoul(opts.explicitActorId, harbor);
      if (existing?.retiredAt !== null && existing?.retiredAt !== undefined) {
        throw new Error(`ACTOR_SOUL_RETIRED: ${opts.explicitActorId} is a retired tombstone and cannot be re-minted`);
      }
    }
    const secret = randomBytes(32).toString('base64url'); // 256-bit verifier
    const salt = randomBytes(16).toString('base64url');
    const credentialHash = hashCredential(salt, secret);
    insertSoul.run(
      actorId, harbor, credentialHash, salt,
      opts.credentialKind ?? 'soul-secret',
      opts.alias ?? null,
      opts.operatorTrusted ? 1 : 0,
      ts, ts,
    );
    if (opts.alias) upsertAlias.run(harbor, opts.alias, actorId, ts);
    return { actorId: asActorId(actorId), credential: `${actorId}.${secret}` };
  }

  /**
   * Verify a "<actor_id>.<secret>" credential. Selector-then-constant-time-verify.
   * Returns the resolved actorId on a match, null on unknown selector OR mismatch
   * (the two failures are indistinguishable to the caller by design — a stolen
   * alias cannot mine ids, §2.1).
   */
  function verifyCredential(credential: string, harbor = defaultHarbor): ActorId | null {
    const verified = verifyCredentialDetailed(credential, harbor);
    return verified && !verified.retired ? verified.actorId : null;
  }

  /**
   * Same selector-then-verify, but tells a caller that already holds the
   * secret WHY it is refused. Only a VERIFIED credential can learn that its
   * soul is retired — an unknown selector and a bad verifier stay
   * indistinguishable (§2.1), so this leaks nothing to a guesser.
   */
  function verifyCredentialDetailed(
    credential: string,
    harbor = defaultHarbor,
  ): { actorId: ActorId; retired: boolean } | null {
    const parsed = parseCredential(credential);
    if (!parsed) return null;
    const soul = selectSoul.get(harbor, parsed.actorId) as
      | { credential_hash: string | null; credential_salt: string | null; retired_at: number | null }
      | undefined;
    if (!soul || !soul.credential_hash || !soul.credential_salt) return null;
    const candidate = hashCredential(soul.credential_salt, parsed.secret);
    if (!constantTimeEqualHex(candidate, soul.credential_hash)) return null;
    return { actorId: asActorId(parsed.actorId), retired: soul.retired_at !== null && soul.retired_at !== undefined };
  }

  // ─── Operator token (advisory-above-floor; see §2.4 honesty note) ─────────────
  function readOperatorSecret(): string | null {
    if (config.operatorSecret !== undefined) return config.operatorSecret;
    const path = config.operatorSecretPath ?? join(homedir(), '.port-daddy', 'operator.secret');
    try {
      if (!existsSync(path)) return null;
      const contents = readFileSync(path, 'utf8').trim();
      return contents.length > 0 ? contents : null;
    } catch {
      return null;
    }
  }
  function verifyOperatorToken(token: string): boolean {
    const secret = readOperatorSecret();
    if (!secret) return false;
    return constantTimeEqualHex(token, secret);
  }

  // ─── Newcomer pool accessors (metered by budget-guard's spend choke) ──────────
  function poolState(project: string, day: string): { spendUsd: number } {
    const row = selectPool.get(project, day) as { spend_usd: number } | undefined;
    return row ? { spendUsd: row.spend_usd } : { spendUsd: 0 };
  }
  function chargePool(project: string, day: string, usd: number): number {
    const amount = Number.isFinite(usd) ? Math.max(0, usd) : 0;
    bumpPoolSpend.run(project, day, amount);
    return poolState(project, day).spendUsd;
  }

  /**
   * Register (POST /actors/register). Implements the exhaustive §2.2 outcome
   * table and §2.5 fail-mode semantics.
   */
  function register(params: {
    harbor?: string;
    alias?: string | null;
    credential?: string | null;
    operatorToken?: string | null;
  }): RegisterOutcome {
    const harbor = params.harbor ?? defaultHarbor;
    const ts = now();

    try {
      // 1. Credential present ⇒ MUST verify. Never mint from a failed credential.
      if (params.credential) {
        const verified = verifyCredentialDetailed(params.credential, harbor);
        if (!verified) {
          return { ok: false, status: 'rejected', code: 'CREDENTIAL_INVALID', httpStatus: 401 };
        }
        // A retired soul holds a valid secret and still may not act. It is
        // refused here — never re-minted from its own credential, never
        // touched (touchSoul is scoped to live souls), never re-aliased.
        if (verified.retired) {
          return { ok: false, status: 'rejected', code: 'IDENTITY_RETIRED', httpStatus: 403 };
        }
        const actorId = verified.actorId;
        // Reserved-alias guard (#8877): a valid soul-secret is still a
        // SELF-SERVICE principal. It may re-bind a reserved authority alias
        // (`system`, `coxswain`, …) ONLY when it is an operator-trusted soul,
        // or already owns that exact alias (an operator provisioned it once).
        // Otherwise this door is a laundering bypass for /sugar/begin's guard:
        // bind `system → me`, then begin under agentId "system" passes because
        // resolveActor("system") now points at the caller's own soul.
        if (params.alias && isReservedIdentityName(params.alias)) {
          const isOperator = classify(actorId, harbor) === 'operator';
          const alreadyOwns = resolveAlias(params.alias, harbor) === actorId;
          if (!isOperator && !alreadyOwns) {
            return { ok: false, status: 'rejected', code: 'RESERVED_ALIAS', httpStatus: 403 };
          }
        }
        touchSoul.run(ts, params.alias ?? null, harbor, actorId);
        if (params.alias) upsertAlias.run(harbor, params.alias, actorId, ts);
        return { ok: true, status: 'resolved', actorId, soulClass: classify(actorId, harbor) };
      }

      // 2. Operator token ⇒ mint operator-trusted (skips the newcomer pool).
      if (params.operatorToken && verifyOperatorToken(params.operatorToken)) {
        const minted = mint({
          harbor, alias: params.alias ?? null,
          operatorTrusted: true, credentialKind: 'operator',
        });
        return { ok: true, status: 'minted', actorId: minted.actorId, soulClass: 'operator', credential: minted.credential };
      }

      // 3. No credential, no operatorToken. A KNOWN alias WITHOUT a matching
      //    credential MUST NOT resolve to the existing id — it fails closed to a
      //    NEW newcomer (F2 impersonation guard). So we intentionally do NOT look
      //    the alias up here; every uncredentialed registration mints fresh.

      // Reserved-alias guard (#8877): an uncredentialed caller is pure
      // self-service and may NEVER bind a reserved authority alias. Refuse
      // BEFORE minting — otherwise this door
      // provisions `system → attacker`, poisoning /sugar/begin's guard.
      if (params.alias && isReservedIdentityName(params.alias)) {
        return { ok: false, status: 'rejected', code: 'RESERVED_ALIAS', httpStatus: 403 };
      }

      // 3a. Mint a fresh newcomer soul; issue a credential ONCE. Identity
      // count is not an authority or spend control: credential/provenance
      // checks protect writes, and budget-guard enforces the shared spend cap.
      const minted = mint({ harbor, alias: params.alias ?? null, credentialKind: 'soul-secret' });
      return { ok: true, status: 'minted', actorId: minted.actorId, soulClass: 'newcomer', credential: minted.credential };
    } catch {
      // Store-unavailable / cannot-persist ⇒ register NOTHING. Never silently
      // fall back to a self-asserted id.
      return { ok: false, status: 'rejected', code: 'STORE_UNAVAILABLE', httpStatus: 503 };
    }
  }

  /**
   * Record a daemon-witnessed clean exit (called by bonds.refund). Graduation
   * out of the pool is priced in escrowed capital — each clean exit requires a
   * prior escrow of real collateral.
   */
  function recordCleanExit(actorId: string, harbor = defaultHarbor): void {
    bumpCleanExits.run(now(), harbor, actorId);
  }

  // ─── Retirement + audited resurrection ────────────────────────────────────────
  function journal(rule: string, actorId: string, harbor: string, metadata: Record<string, unknown>, details: string): void {
    config.forensicsSink?.record({
      timestamp: now(),
      rule,
      severity: 'warning',
      details,
      agentId: actorId,
      metadata: { surface: 'actor_souls', harbor, ...metadata },
    });
  }

  /**
   * Retire a soul: stamp the tombstone. From this moment the credential no
   * longer verifies, registration is refused (IDENTITY_RETIRED), resolution
   * floors to 'unknown', the row is frozen and undeletable, and the identity
   * key cannot be re-minted. Journaled to the forensics sink (ADR-0089).
   */
  function retire(actorId: string, opts: { reason: string; by: string; harbor?: string }): RetireOutcome {
    const harbor = opts.harbor ?? defaultHarbor;
    const soul = getSoul(actorId, harbor);
    if (!soul) return { ok: false, code: 'SOUL_NOT_FOUND' };
    if (soul.retiredAt !== null) return { ok: false, code: 'ALREADY_RETIRED' };
    const ts = now();
    const info = retireSoul.run(ts, opts.reason, opts.by, harbor, actorId);
    if (info.changes !== 1) return { ok: false, code: 'ALREADY_RETIRED' };
    journal(IDENTITY_RETIRED_RULE, actorId, harbor, { reason: opts.reason, by: opts.by, retiredAt: ts },
      `actor soul ${actorId} retired by ${opts.by}: ${opts.reason}`);
    return { ok: true, actorId: asActorId(actorId), retiredAt: ts };
  }

  /**
   * The ONLY legitimate way back from retirement. Mints a fresh, table-unique
   * receipt and clears the tombstone in the same statement (the shape the
   * trigger admits), then journals the receipt so the row and the forensics
   * journal can be joined by value.
   */
  function resurrect(actorId: string, opts: { reason: string; by: string; harbor?: string }): ResurrectOutcome {
    const harbor = opts.harbor ?? defaultHarbor;
    const soul = getSoul(actorId, harbor);
    if (!soul) return { ok: false, code: 'SOUL_NOT_FOUND' };
    if (soul.retiredAt === null) return { ok: false, code: 'NOT_RETIRED' };
    const ts = now();
    const receipt = ulid(ts);
    const info = resurrectSoul.run(receipt, ts, opts.by, ts, harbor, actorId);
    if (info.changes !== 1) return { ok: false, code: 'NOT_RETIRED' };
    journal(IDENTITY_RESURRECTED_RULE, actorId, harbor,
      { receipt, reason: opts.reason, by: opts.by, resurrectedAt: ts, retiredAt: soul.retiredAt, retiredReason: soul.retiredReason, retiredBy: soul.retiredBy },
      `actor soul ${actorId} resurrected by ${opts.by} (receipt ${receipt}): ${opts.reason}`);
    return { ok: true, actorId: asActorId(actorId), receipt, resurrectedAt: ts };
  }

  return {
    mint,
    register,
    retire,
    resurrect,
    verifyCredential,
    verifyOperatorToken,
    resolveAlias,
    resolveActor,
    classify,
    getSoul,
    recordCleanExit,
    poolState,
    chargePool,
    constants: {
      defaultHarbor,
      graduationThreshold,
      newcomerPoolCeilingUsd,
    },
  };
}

export type ActorSouls = ReturnType<typeof createActorSouls>;
