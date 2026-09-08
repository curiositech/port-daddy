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
 *  THE CREDENTIAL IS A VERSIONED SELECTOR.VERIFIER TOKEN (verifiable, O(1))
 * ════════════════════════════════════════════════════════════════════════════
 *   credential = "pdab1.<actor_id>.<body_id>.<secret>"
 *
 * The `(actor_id, body_id)` pair is the **selector**: parse it, look the row up
 * by the PK `(harbor, actor_id, body_id)` in O(1), read *that row's* salt, and check
 * `sha256(salt | secret) == credential_hash` in constant time. This is the
 * standard "lookup-token" pattern. The durable actor is a person/principal;
 * each revocable body credential is a disposable invocation lease. A daemon or
 * computer restart therefore does not manufacture a new actor.
 *
 * Historical `<actor_id>.<secret>` roots are retired on first startup of this
 * version. Their database hashes are deleted, their plaintext delivery files
 * are removed from the exact state root, and the parser accepts only `pdab1`
 * credentials. Restart continuity therefore never depends on a compatibility
 * root that cannot be scoped, expired, or independently revoked.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  HONEST POSTURE — fail-CLOSED above the floor, fail-OPEN at a bounded floor
 * ════════════════════════════════════════════════════════════════════════════
 * Per ADR-0040 the adversary is a **lazy/self-interested agent in a fleet the
 * operator owns**, NOT a hostile human operator. This module is calibrated to
 * that bar and no higher:
 *
 *   - ABOVE the newcomer floor (any ceiling > NEWCOMER_*): admission REQUIRES a
 *     credentialed, graduated soul (or operator-trusted). No soul ⇒ REJECT. This
 *     is genuine fail-closed — enforced at the spend choke in budget-guard.
 *   - AT/BELOW the floor: an uncredentialed registration is ADMITTED as a
 *     newcomer that draws from a SHARED per-project pool (see budget-guard). This
 *     is fail-OPEN-at-a-bounded-floor. It is safe only because the floor is a
 *     shared, capped pool — minting fresh ids buys NO new budget.
 *
 * NOT CLAIMED: this slice is not "Sybil-proof" against a process that can write
 * the daemon's SQLite database directly. Operator recovery is deliberately NOT
 * an alternate mint door: it proves operator presence and re-binds the same
 * durable actor without rotating actor_souls credentials or creating a person.
 */

import type { Database } from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { isReservedIdentityName } from './reserved-identity-names.js';

// ─── Branded principal type (ADR-0040 §8 widening boundary) ─────────────────────
// A minted ULID *or* a migrated legacy string satisfies this via asActorId().
export type ActorId = string & { readonly __brand: 'actor_id' };
export function asActorId(raw: string): ActorId {
  return raw as ActorId;
}

/**
 * Reserved newcomer-pool bucket for registrations that name no project. The
 * doubled-underscore sentinel is a reserved key; a project literally named
 * "__projectless__" would merely share this bucket, which is harmless (still
 * metered). Metering projectless registrations under one shared bucket is what
 * stops `POST /actors/register` with no `project` from minting unlimited
 * free souls.
 */
export const PROJECTLESS_POOL_KEY = '__projectless__';

// ─── Tunable policy constants ───────────────────────────────────────────────────
export interface ActorSoulsConfig {
  /** Default multi-tenant scope when a caller does not name one. */
  defaultHarbor?: string;
  /** Daemon-witnessed clean exits required to leave the newcomer pool. */
  graduationThreshold?: number;
  /** Project-wide daily USD cap shared by ALL uncredentialed newcomers. */
  newcomerPoolCeilingUsd?: number;
  /** Distinct newcomer souls admitted per project per day before 429. */
  newcomerAdmitMax?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
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
}

export interface MintResult {
  actorId: ActorId;
  bodyCredentialId: string;
  credentialProfile: 'actor-root';
  /** Plaintext credential — returned to the caller ONCE, never stored plaintext. */
  credential: string;
}

export const ACTOR_BODY_CREDENTIAL_VERSION = 'pdab1';
const RETIRED_LEGACY_ROOT_BODY_CREDENTIAL_ID = 'legacy-root';
export const MAX_ACTIVE_BODY_CREDENTIALS = 16;

export interface LegacyActorCredentialRetirementReceipt {
  directory: string;
  removedFiles: number;
  directoryRemoved: boolean;
}

export class LegacyActorCredentialRetirementError extends Error {
  readonly code = 'LEGACY_ACTOR_CREDENTIAL_RETIREMENT_UNSAFE';

  constructor(message: string) {
    super(message);
    this.name = 'LegacyActorCredentialRetirementError';
  }
}

/**
 * Remove plaintext files emitted by the deleted historical actor migration.
 *
 * The purpose is exhaustive retirement, not compatibility cleanup: callers
 * pass the daemon's exact state root so a named development berth can never
 * mutate the canonical harbor. The function refuses symlinked directories and
 * unexpected nested content, unlinks only the migration's `.cred` leaves, and
 * fsyncs the parent directory before reporting success.
 *
 * @param stateRoot Canonical state-plane root containing `actor-credentials`.
 * @returns A credential-free receipt with the exact removal count.
 */
export function retireLegacyActorCredentialFiles(
  stateRoot: string,
): LegacyActorCredentialRetirementReceipt {
  const directory = join(stateRoot, 'actor-credentials');
  if (!existsSync(directory)) {
    return { directory, removedFiles: 0, directoryRemoved: false };
  }

  const directoryStat = lstatSync(directory);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || (currentUid !== null && directoryStat.uid !== currentUid)
  ) {
    throw new LegacyActorCredentialRetirementError(
      'the historical actor credential directory is not an owner-controlled directory',
    );
  }

  const retiredEntries = readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const entryPath = join(directory, entry.name);
    const entryStat = lstatSync(entryPath);
    if (
      !entry.name.endsWith('.cred')
      || (!entryStat.isFile() && !entryStat.isSymbolicLink())
      || (currentUid !== null && entryStat.uid !== currentUid)
    ) {
      throw new LegacyActorCredentialRetirementError(
        'refusing unexpected content in the historical actor credential directory',
      );
    }
    return {
      path: entryPath,
      dev: entryStat.dev,
      ino: entryStat.ino,
      uid: entryStat.uid,
      symbolicLink: entryStat.isSymbolicLink(),
    };
  });

  let removedFiles = 0;
  for (const entry of retiredEntries) {
    const current = lstatSync(entry.path);
    if (
      current.dev !== entry.dev
      || current.ino !== entry.ino
      || current.uid !== entry.uid
      || current.isSymbolicLink() !== entry.symbolicLink
    ) {
      throw new LegacyActorCredentialRetirementError(
        'the historical actor credential directory changed during retirement',
      );
    }
    unlinkSync(entry.path);
    removedFiles += 1;
  }
  rmdirSync(directory);

  let parentDescriptor: number | null = null;
  try {
    parentDescriptor = openSync(stateRoot, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    fsyncSync(parentDescriptor);
  } finally {
    if (parentDescriptor !== null) closeSync(parentDescriptor);
  }
  return { directory, removedFiles, directoryRemoved: true };
}

export type ActorBodyCredentialProfile = 'actor-root' | 'session-body-v1';

export const SESSION_BODY_CREDENTIAL_ACTIONS = [
  'session.note.write',
  'session.plan.write',
  'session.claim.add',
  'session.claim.release',
  'session.phase.write',
  'session.symbol.claim',
  'session.end',
  'session.archive',
  'session.relink',
  'session.done',
] as const;
export type SessionBodyCredentialAction = (typeof SESSION_BODY_CREDENTIAL_ACTIONS)[number];
export type CredentialSessionStatus = 'active' | 'completed' | 'abandoned';

/** Daemon-derived facts at the exact write being authorized. Never accept these from a request body. */
export interface ActorCredentialUseContext {
  action: SessionBodyCredentialAction;
  resource: {
    sessionId: string;
    intendedAgentId: string;
    project: string;
    canonicalWorktree: string;
    branch: string;
    status: CredentialSessionStatus;
  };
}

export type ActorBodyCredentialScope =
  | { profile: 'actor-root' }
  | {
      profile: 'session-body-v1';
      intendedAgentId: string;
      successorSessionId: string;
      project: string;
      canonicalWorktree: string;
      branch: string;
      recoveryId: string;
      contextSlot: string | null;
      /** Receipt evidence only. Later use deliberately survives daemon restarts. */
      issuedDaemonGeneration: string;
    };

export interface IssuedBodyCredential {
  actorId: ActorId;
  bodyCredentialId: string;
  profile: ActorBodyCredentialProfile;
  scope: ActorBodyCredentialScope;
  issuedAt: number;
  expiresAt: number | null;
  /** Plaintext is returned exactly once and is never persisted. */
  credential: string;
}

export type IssueBodyCredentialInput =
  | {
      actorId: string;
      harbor?: string;
      profile: 'actor-root';
      expiresAt?: null;
    }
  | {
      actorId: string;
      harbor?: string;
      profile: 'session-body-v1';
      scope: Omit<Extract<ActorBodyCredentialScope, { profile: 'session-body-v1' }>, 'profile'>;
      expiresAt: number;
    };

export interface RevokeBodyCredentialInput {
  actorId: string;
  bodyCredentialId: string;
  harbor?: string;
  revokedAt?: number;
}

export interface VerifyCredentialUseInput {
  harbor?: string;
  /** Required for session-body-v1; ignored by unrestricted actor-root credentials. */
  context?: ActorCredentialUseContext | null;
}

export type CredentialUseVerdict =
  | {
      ok: true;
      actorId: ActorId;
      bodyCredentialId: string;
      profile: ActorBodyCredentialProfile;
      scope: ActorBodyCredentialScope;
      intendedAgentId: string | null;
    }
  | {
      ok: false;
      code:
        | 'CREDENTIAL_INVALID'
        | 'CREDENTIAL_EXPIRED'
        | 'CREDENTIAL_REVOKED'
        | 'CREDENTIAL_SCOPE_MISMATCH';
    };

export class ActorBodyCredentialError extends Error {
  constructor(
    public readonly code:
      | 'ACTOR_NOT_FOUND'
      | 'BODY_CREDENTIAL_LIMIT'
      | 'BODY_CREDENTIAL_SCOPE_INVALID'
      | 'BODY_CREDENTIAL_EXPIRY_INVALID'
      | 'BODY_CREDENTIAL_REVOCATION_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ActorBodyCredentialError';
  }
}

export type RegisterOutcome =
  | { ok: true; status: 'resolved';   actorId: ActorId; soulClass: SoulClass }              // valid credential ⇒ same id
  | {
      ok: true;
      status: 'minted';
      actorId: ActorId;
      soulClass: SoulClass;
      bodyCredentialId: string;
      credentialProfile: 'actor-root';
      credential: string;
    }
  | { ok: false; status: 'rejected';  code: 'CREDENTIAL_INVALID'; httpStatus: 401 }
  | { ok: false; status: 'rejected';  code: 'NEWCOMER_ADMIT_LIMIT'; httpStatus: 429 }
  | { ok: false; status: 'rejected';  code: 'RESERVED_ALIAS'; httpStatus: 403 }
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

type ParsedCredential = {
  actorId: string;
  bodyCredentialId: string;
  secret: string;
};

/** Parse the sole supported versioned body-token shape. */
function parseCredential(credential: string): ParsedCredential | null {
  if (!credential.startsWith(`${ACTOR_BODY_CREDENTIAL_VERSION}.`)) return null;
  const payload = credential.slice(ACTOR_BODY_CREDENTIAL_VERSION.length + 1);
  const secretDot = payload.lastIndexOf('.');
  if (secretDot > 0 && secretDot < payload.length - 1) {
    const selector = payload.slice(0, secretDot);
    const bodyDot = selector.lastIndexOf('.');
    if (bodyDot > 0 && bodyDot < selector.length - 1) {
      const actorId = selector.slice(0, bodyDot);
      const bodyCredentialId = selector.slice(bodyDot + 1);
      const secret = payload.slice(secretDot + 1);
      if (actorId && bodyCredentialId && secret) {
        return { actorId, bodyCredentialId, secret };
      }
    }
  }
  return null;
}

const DUMMY_CREDENTIAL_SALT = 'pd-actor-body-dummy-salt-v1';
const DUMMY_CREDENTIAL_HASH = hashCredential(DUMMY_CREDENTIAL_SALT, 'pd-actor-body-dummy-secret-v1');

// ─── Module factory ─────────────────────────────────────────────────────────────
export function createActorSouls(db: Database, config: ActorSoulsConfig = {}) {
  const defaultHarbor = config.defaultHarbor ?? 'local';
  const graduationThreshold = Math.max(1, config.graduationThreshold ?? 3);
  const newcomerPoolCeilingUsd = Math.max(0, config.newcomerPoolCeilingUsd ?? 1.0);
  const newcomerAdmitMax = Math.max(1, config.newcomerAdmitMax ?? 25);
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
  // The legacy hash columns stay only so existing databases can be upgraded in
  // place. They become inert immediately after the transaction below.
  runDDL(`DROP INDEX IF EXISTS uq_soul_cred`);
  runDDL(`
    CREATE TABLE IF NOT EXISTS actor_body_credentials (
      harbor                    TEXT NOT NULL,
      actor_id                  TEXT NOT NULL,
      body_credential_id        TEXT NOT NULL,
      credential_hash           TEXT NOT NULL,
      credential_salt           TEXT NOT NULL,
      profile                   TEXT NOT NULL CHECK (profile IN ('actor-root', 'session-body-v1')),
      intended_agent_id         TEXT,
      successor_session_id      TEXT,
      project                   TEXT,
      canonical_worktree        TEXT,
      branch                    TEXT,
      recovery_id               TEXT,
      context_slot              TEXT,
      issued_daemon_generation  TEXT,
      issued_at                 INTEGER NOT NULL,
      expires_at                INTEGER,
      revoked_at                INTEGER,
      CHECK (
        profile = 'actor-root' OR (
          intended_agent_id IS NOT NULL AND successor_session_id IS NOT NULL
          AND project IS NOT NULL AND canonical_worktree IS NOT NULL
          AND branch IS NOT NULL AND recovery_id IS NOT NULL
          AND issued_daemon_generation IS NOT NULL AND expires_at IS NOT NULL
        )
      ),
      PRIMARY KEY (harbor, actor_id, body_credential_id),
      FOREIGN KEY (harbor, actor_id) REFERENCES actor_souls(harbor, actor_id) ON DELETE CASCADE
    )
  `);
  runDDL(`
    CREATE INDEX IF NOT EXISTS idx_actor_body_credentials_active
      ON actor_body_credentials(harbor, actor_id, revoked_at, expires_at)
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
  runDDL(`
    CREATE TABLE IF NOT EXISTS newcomer_pool (
      project    TEXT NOT NULL,
      day        TEXT NOT NULL,
      spend_usd  REAL NOT NULL DEFAULT 0,
      souls_seen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project, day)
    )
  `);

  // One-time authority retirement. Supplanting the restart-fragile root means
  // deleting both possible database selectors in one transaction. Durable
  // actors remain; FleetBar can bind a fresh, scoped session body to the exact
  // actor without any compatibility credential surviving the upgrade.
  const retireLegacyCredentialRows = () => {
    db.prepare(`
      DELETE FROM actor_body_credentials
       WHERE body_credential_id = ?
    `).run(RETIRED_LEGACY_ROOT_BODY_CREDENTIAL_ID);
    db.prepare(`
      UPDATE actor_souls
         SET credential_hash = NULL, credential_salt = NULL
       WHERE credential_hash IS NOT NULL OR credential_salt IS NOT NULL
    `).run();
  };
  if (db.inTransaction) retireLegacyCredentialRows();
  else db.transaction(retireLegacyCredentialRows)();

  const selectSoul = db.prepare(`
    SELECT actor_id, harbor, credential_kind,
           display_alias, clean_exits, operator_trusted, created_at, last_seen_at
      FROM actor_souls WHERE harbor = ? AND actor_id = ?
  `);
  const insertSoul = db.prepare(`
    INSERT INTO actor_souls
      (actor_id, harbor, credential_hash, credential_salt, credential_kind,
       display_alias, clean_exits, operator_trusted, created_at, last_seen_at)
    VALUES (?, ?, NULL, NULL, ?, ?, 0, ?, ?, ?)
  `);
  const selectBodyCredential = db.prepare(`
    SELECT actor_id, body_credential_id, credential_hash, credential_salt,
           profile, intended_agent_id, successor_session_id, project,
           canonical_worktree, branch, recovery_id, context_slot,
           issued_daemon_generation, issued_at, expires_at, revoked_at
      FROM actor_body_credentials
     WHERE harbor = ? AND actor_id = ? AND body_credential_id = ?
  `);
  const hasSessionsTable = db.prepare(`
    SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = 'sessions'
    LIMIT 1
  `);
  const countActiveBodyCredentials = (harbor: string, actorId: string, timestamp: number) => {
    // Some isolated stores construct actor souls before the sessions module.
    // Prepare the join only when that table exists; once sessions appears,
    // terminal successor bodies stop consuming the cap. Without the table we
    // conservatively count every live body rather than weakening the limit.
    const sessionsAvailable = Boolean(hasSessionsTable.get());
    const statement = sessionsAvailable
      ? db.prepare(`
          SELECT COUNT(*) AS count
            FROM actor_body_credentials AS body
            LEFT JOIN sessions AS successor ON successor.id = body.successor_session_id
           WHERE body.harbor = ? AND body.actor_id = ?
             AND body.revoked_at IS NULL
             AND (body.expires_at IS NULL OR body.expires_at > ?)
             AND (
               body.profile = 'actor-root'
               OR (body.profile = 'session-body-v1' AND successor.status = 'active')
             )
        `)
      : db.prepare(`
          SELECT COUNT(*) AS count
            FROM actor_body_credentials
           WHERE harbor = ? AND actor_id = ?
             AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)
        `);
    return statement.get(harbor, actorId, timestamp) as { count: number };
  };
  const insertBodyCredential = db.prepare(`
    INSERT INTO actor_body_credentials
      (harbor, actor_id, body_credential_id, credential_hash, credential_salt,
       profile, intended_agent_id, successor_session_id, project,
       canonical_worktree, branch, recovery_id, context_slot,
       issued_daemon_generation, issued_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const revokeBodyCredentialRow = db.prepare(`
    UPDATE actor_body_credentials
       SET revoked_at = ?
     WHERE harbor = ? AND actor_id = ? AND body_credential_id = ?
       AND revoked_at IS NULL
  `);
  const touchSoul = db.prepare(`
    UPDATE actor_souls SET last_seen_at = ?, display_alias = ?
     WHERE harbor = ? AND actor_id = ?
  `);
  const bumpCleanExits = db.prepare(`
    UPDATE actor_souls SET clean_exits = clean_exits + 1, last_seen_at = ?
     WHERE harbor = ? AND actor_id = ?
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
    SELECT spend_usd, souls_seen FROM newcomer_pool WHERE project = ? AND day = ?
  `);
  const bumpPoolSpend = db.prepare(`
    INSERT INTO newcomer_pool (project, day, spend_usd, souls_seen)
    VALUES (?, ?, ?, 0)
    ON CONFLICT(project, day) DO UPDATE SET spend_usd = spend_usd + excluded.spend_usd
  `);
  const bumpPoolSouls = db.prepare(`
    INSERT INTO newcomer_pool (project, day, spend_usd, souls_seen)
    VALUES (?, ?, 0, 1)
    ON CONFLICT(project, day) DO UPDATE SET souls_seen = souls_seen + 1
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
    };
  }

  function exactNonEmpty(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
      throw new ActorBodyCredentialError(
        'BODY_CREDENTIAL_SCOPE_INVALID',
        `${field} must be a non-empty, already-canonical string`,
      );
    }
    return value;
  }

  function sessionScopeFromInput(
    input: Extract<IssueBodyCredentialInput, { profile: 'session-body-v1' }>,
  ): Extract<ActorBodyCredentialScope, { profile: 'session-body-v1' }> {
    if (!input.scope || typeof input.scope !== 'object') {
      throw new ActorBodyCredentialError(
        'BODY_CREDENTIAL_SCOPE_INVALID',
        'session-body-v1 requires an exact persisted scope',
      );
    }
    const contextSlot = input.scope.contextSlot == null
      ? null
      : exactNonEmpty(input.scope.contextSlot, 'scope.contextSlot');
    return {
      profile: 'session-body-v1',
      intendedAgentId: exactNonEmpty(input.scope.intendedAgentId, 'scope.intendedAgentId'),
      successorSessionId: exactNonEmpty(input.scope.successorSessionId, 'scope.successorSessionId'),
      project: exactNonEmpty(input.scope.project, 'scope.project'),
      canonicalWorktree: exactNonEmpty(input.scope.canonicalWorktree, 'scope.canonicalWorktree'),
      branch: exactNonEmpty(input.scope.branch, 'scope.branch'),
      recoveryId: exactNonEmpty(input.scope.recoveryId, 'scope.recoveryId'),
      contextSlot,
      issuedDaemonGeneration: exactNonEmpty(
        input.scope.issuedDaemonGeneration,
        'scope.issuedDaemonGeneration',
      ),
    };
  }

  function scopeFromBodyRow(row: any): ActorBodyCredentialScope | null {
    if (row.profile === 'actor-root') return { profile: 'actor-root' };
    if (row.profile !== 'session-body-v1') return null;
    const required = [
      row.intended_agent_id,
      row.successor_session_id,
      row.project,
      row.canonical_worktree,
      row.branch,
      row.recovery_id,
      row.issued_daemon_generation,
    ];
    if (required.some((value) => typeof value !== 'string' || value.length === 0)) return null;
    if (row.context_slot !== null && typeof row.context_slot !== 'string') return null;
    return {
      profile: 'session-body-v1',
      intendedAgentId: row.intended_agent_id,
      successorSessionId: row.successor_session_id,
      project: row.project,
      canonicalWorktree: row.canonical_worktree,
      branch: row.branch,
      recoveryId: row.recovery_id,
      contextSlot: row.context_slot,
      issuedDaemonGeneration: row.issued_daemon_generation,
    };
  }

  function withCredentialTransaction<T>(operation: () => T): T {
    return db.inTransaction ? operation() : db.transaction(operation)();
  }

  /**
   * Commit one mint-door admission and its attributed work as a single write.
   *
   * The intent is narrow: `/sugar/begin` must not spend newcomer admission or
   * leave an actor-root when the session operation fails afterward. A thrown
   * callback error rolls back the pool counter, soul, root body, agent, session,
   * claim, and ledger rows together; nested callers reuse the surrounding
   * transaction rather than opening a second authority boundary.
   *
   * @param operation Exact mint-door work that must either commit or disappear.
   * @returns The callback result after one successful immediate transaction.
   */
  function withMintDoorTransaction<T>(operation: () => T): T {
    if (db.inTransaction) return operation();
    return db.transaction(operation).immediate();
  }

  function getSoul(actorId: string, harbor = defaultHarbor): ActorSoulRow | null {
    const row = selectSoul.get(harbor, actorId);
    return row ? rowToSoul(row) : null;
  }

  function issueBodyCredential(input: IssueBodyCredentialInput): IssuedBodyCredential {
    return withCredentialTransaction(() => {
      const harbor = input.harbor ?? defaultHarbor;
      const actorId = exactNonEmpty(input.actorId, 'actorId');
      const ts = now();
      if (!getSoul(actorId, harbor)) {
        throw new ActorBodyCredentialError(
          'ACTOR_NOT_FOUND',
          `cannot issue a body credential for unknown actor ${actorId}`,
        );
      }

      const active = countActiveBodyCredentials(harbor, actorId, ts);
      if (active.count >= MAX_ACTIVE_BODY_CREDENTIALS) {
        throw new ActorBodyCredentialError(
          'BODY_CREDENTIAL_LIMIT',
          `actor ${actorId} already has ${MAX_ACTIVE_BODY_CREDENTIALS} active body credentials`,
        );
      }

      let scope: ActorBodyCredentialScope;
      let expiresAt: number | null;
      if (input.profile === 'actor-root') {
        if ('scope' in input || input.expiresAt != null) {
          throw new ActorBodyCredentialError(
            'BODY_CREDENTIAL_SCOPE_INVALID',
            'actor-root credentials cannot carry session scope or expiry',
          );
        }
        scope = { profile: 'actor-root' };
        expiresAt = null;
      } else if (input.profile === 'session-body-v1') {
        scope = sessionScopeFromInput(input);
        expiresAt = input.expiresAt;
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= ts) {
          throw new ActorBodyCredentialError(
            'BODY_CREDENTIAL_EXPIRY_INVALID',
            'session-body-v1 expiresAt must be a future integer timestamp',
          );
        }
      } else {
        throw new ActorBodyCredentialError(
          'BODY_CREDENTIAL_SCOPE_INVALID',
          'unsupported body credential profile',
        );
      }

      const bodyCredentialId = randomBytes(16).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      const salt = randomBytes(16).toString('base64url');
      const credentialHash = hashCredential(salt, secret);
      const sessionScope = scope.profile === 'session-body-v1' ? scope : null;
      insertBodyCredential.run(
        harbor,
        actorId,
        bodyCredentialId,
        credentialHash,
        salt,
        scope.profile,
        sessionScope?.intendedAgentId ?? null,
        sessionScope?.successorSessionId ?? null,
        sessionScope?.project ?? null,
        sessionScope?.canonicalWorktree ?? null,
        sessionScope?.branch ?? null,
        sessionScope?.recoveryId ?? null,
        sessionScope?.contextSlot ?? null,
        sessionScope?.issuedDaemonGeneration ?? null,
        ts,
        expiresAt,
      );
      return {
        actorId: asActorId(actorId),
        bodyCredentialId,
        profile: scope.profile,
        scope,
        issuedAt: ts,
        expiresAt,
        credential: `${ACTOR_BODY_CREDENTIAL_VERSION}.${actorId}.${bodyCredentialId}.${secret}`,
      };
    });
  }

  function revokeBodyCredential(input: RevokeBodyCredentialInput): boolean {
    return withCredentialTransaction(() => {
      const harbor = input.harbor ?? defaultHarbor;
      const ts = now();
      const revokedAt = input.revokedAt ?? ts;
      if (!Number.isSafeInteger(revokedAt) || revokedAt < 0 || revokedAt > ts) {
        throw new ActorBodyCredentialError(
          'BODY_CREDENTIAL_REVOCATION_INVALID',
          'revokedAt must be a non-negative integer timestamp no later than now',
        );
      }
      const result = revokeBodyCredentialRow.run(
        revokedAt,
        harbor,
        exactNonEmpty(input.actorId, 'actorId'),
        exactNonEmpty(input.bodyCredentialId, 'bodyCredentialId'),
      );
      return result.changes === 1;
    });
  }

  /** Classify a KNOWN soul row. Newcomer until it graduates on clean exits. */
  function classifyRow(soul: ActorSoulRow): SoulClass {
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

  /** Mint a fresh daemon-selected soul and its initial actor-root body. */
  function mint(opts: {
    harbor?: string;
    alias?: string | null;
    operatorTrusted?: boolean;
    credentialKind?: 'soul-secret' | 'operator';
  } = {}): MintResult {
    return withCredentialTransaction(() => {
      const harbor = opts.harbor ?? defaultHarbor;
      const ts = now();
      const actorId = ulid(ts);
      insertSoul.run(
        actorId,
        harbor,
        opts.credentialKind ?? 'soul-secret',
        opts.alias ?? null,
        opts.operatorTrusted ? 1 : 0,
        ts,
        ts,
      );
      if (opts.alias) upsertAlias.run(harbor, opts.alias, actorId, ts);
      const body = issueBodyCredential({ actorId, harbor, profile: 'actor-root' });
      return {
        actorId: asActorId(actorId),
        bodyCredentialId: body.bodyCredentialId,
        credentialProfile: 'actor-root',
        credential: body.credential,
      };
    });
  }

  /**
   * Verify a body credential for one exact daemon-derived use. Unknown selectors
   * still perform the same hash/compare work against a dummy row. A scoped body
   * is cryptographically valid but refuses every non-session and cross-session
   * use with a typed scope-mismatch verdict.
   */
  function verifyCredentialUse(
    credential: string,
    input: VerifyCredentialUseInput = {},
  ): CredentialUseVerdict {
    const harbor = input.harbor ?? defaultHarbor;
    const parsed = parseCredential(credential);
    const row = parsed
      ? selectBodyCredential.get(harbor, parsed.actorId, parsed.bodyCredentialId) as any
      : undefined;
    const candidate = hashCredential(
      row?.credential_salt ?? DUMMY_CREDENTIAL_SALT,
      parsed?.secret ?? credential,
    );
    const matches = constantTimeEqualHex(
      candidate,
      row?.credential_hash ?? DUMMY_CREDENTIAL_HASH,
    );
    if (!parsed || !row || !matches) return { ok: false, code: 'CREDENTIAL_INVALID' };

    const scope = scopeFromBodyRow(row);
    if (!scope) return { ok: false, code: 'CREDENTIAL_INVALID' };
    if (row.revoked_at !== null) return { ok: false, code: 'CREDENTIAL_REVOKED' };
    if (row.expires_at !== null && now() >= row.expires_at) {
      return { ok: false, code: 'CREDENTIAL_EXPIRED' };
    }

    if (scope.profile === 'session-body-v1') {
      const use = input.context;
      const allowedAction = typeof use?.action === 'string'
        && (SESSION_BODY_CREDENTIAL_ACTIONS as readonly string[]).includes(use.action);
      const resource = use?.resource;
      const exactResource = allowedAction
        && resource?.status === 'active'
        && resource.sessionId === scope.successorSessionId
        && resource.intendedAgentId === scope.intendedAgentId
        && resource.project === scope.project
        && resource.canonicalWorktree === scope.canonicalWorktree
        && resource.branch === scope.branch;
      if (!exactResource) return { ok: false, code: 'CREDENTIAL_SCOPE_MISMATCH' };
    }

    return {
      ok: true,
      actorId: asActorId(parsed.actorId),
      bodyCredentialId: parsed.bodyCredentialId,
      profile: scope.profile,
      scope,
      intendedAgentId: scope.profile === 'session-body-v1' ? scope.intendedAgentId : null,
    };
  }

  /** Root-only convenience check, implemented solely by the canonical body table. */
  function verifyCredential(credential: string, harbor = defaultHarbor): ActorId | null {
    const verdict = verifyCredentialUse(credential, { harbor });
    return verdict.ok ? verdict.actorId : null;
  }

  // ─── Newcomer pool accessors (metered by budget-guard's spend choke) ──────────
  function poolState(project: string, day: string): { spendUsd: number; soulsSeen: number } {
    const row = selectPool.get(project, day) as { spend_usd: number; souls_seen: number } | undefined;
    return row ? { spendUsd: row.spend_usd, soulsSeen: row.souls_seen } : { spendUsd: 0, soulsSeen: 0 };
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
    /** For the admit rate-limit — the project the newcomer will spend against. */
    project?: string;
    /** UTC day bucket for the admit rate-limit. */
    day?: string;
  }): RegisterOutcome {
    const harbor = params.harbor ?? defaultHarbor;
    const ts = now();

    try {
      // 1. Credential present ⇒ MUST verify. Never mint from a failed credential.
      if (params.credential) {
        const actorId = verifyCredential(params.credential, harbor);
        if (!actorId) {
          return { ok: false, status: 'rejected', code: 'CREDENTIAL_INVALID', httpStatus: 401 };
        }
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

      // 2. No credential. A KNOWN alias WITHOUT a matching
      //    credential MUST NOT resolve to the existing id — it fails closed to a
      //    NEW newcomer (F2 impersonation guard). So we intentionally do NOT look
      //    the alias up here; every uncredentialed registration mints fresh.

      // Reserved-alias guard (#8877): an uncredentialed caller is pure
      // self-service and may NEVER bind a reserved authority alias. Refuse
      // BEFORE minting or spending an admission slot — otherwise this door
      // provisions `system → attacker`, poisoning /sugar/begin's guard.
      if (params.alias && isReservedIdentityName(params.alias)) {
        return { ok: false, status: 'rejected', code: 'RESERVED_ALIAS', httpStatus: 403 };
      }

      // 2a. Admission rate-limit: bound distinct newcomer souls per project/day.
      //     A registration with NO project must still be metered — otherwise
      //     omitting `project` skipped the pool entirely and minted unlimited
      //     free souls (the anti-launder floor became opt-in). Projectless
      //     registrations share one reserved global bucket (PROJECTLESS_POOL_KEY)
      //     so the same 429 admission path applies.
      const trimmedProject = params.project?.trim();
      const project = trimmedProject && trimmedProject.length > 0
        ? trimmedProject
        : PROJECTLESS_POOL_KEY;
      const day = params.day ?? new Date(ts).toISOString().slice(0, 10);
      const { soulsSeen } = poolState(project, day);
      if (soulsSeen >= newcomerAdmitMax) {
        return { ok: false, status: 'rejected', code: 'NEWCOMER_ADMIT_LIMIT', httpStatus: 429 };
      }
      bumpPoolSouls.run(project, day);

      // 2b. Mint a fresh newcomer soul; issue a credential ONCE.
      const minted = mint({ harbor, alias: params.alias ?? null, credentialKind: 'soul-secret' });
      return {
        ok: true,
        status: 'minted',
        actorId: minted.actorId,
        soulClass: 'newcomer',
        bodyCredentialId: minted.bodyCredentialId,
        credentialProfile: minted.credentialProfile,
        credential: minted.credential,
      };
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

  return {
    mint,
    register,
    withMintDoorTransaction,
    verifyCredential,
    verifyCredentialUse,
    issueBodyCredential,
    revokeBodyCredential,
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
      newcomerAdmitMax,
    },
  };
}

export type ActorSouls = ReturnType<typeof createActorSouls>;
