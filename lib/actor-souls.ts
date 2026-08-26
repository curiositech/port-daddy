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
 *   - ABOVE the newcomer floor (any ceiling > NEWCOMER_*): admission REQUIRES a
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
  /** Plaintext credential — returned to the caller ONCE, never stored plaintext. */
  credential: string;
}

export type RegisterOutcome =
  | { ok: true; status: 'resolved';   actorId: ActorId; soulClass: SoulClass }              // valid credential ⇒ same id
  | { ok: true; status: 'minted';     actorId: ActorId; soulClass: SoulClass; credential: string }
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
  // Kept only to reject accidental hash reuse; NOT the lookup path (lookup is by PK).
  runDDL(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_soul_cred
      ON actor_souls(harbor, credential_hash) WHERE credential_hash IS NOT NULL
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

  const selectSoul = db.prepare(`
    SELECT actor_id, harbor, credential_hash, credential_salt, credential_kind,
           display_alias, clean_exits, operator_trusted, created_at, last_seen_at
      FROM actor_souls WHERE harbor = ? AND actor_id = ?
  `);
  const insertSoul = db.prepare(`
    INSERT INTO actor_souls
      (actor_id, harbor, credential_hash, credential_salt, credential_kind,
       display_alias, clean_exits, operator_trusted, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
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

  function getSoul(actorId: string, harbor = defaultHarbor): ActorSoulRow | null {
    const row = selectSoul.get(harbor, actorId);
    return row ? rowToSoul(row) : null;
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
    const parsed = parseCredential(credential);
    if (!parsed) return null;
    const soul = selectSoul.get(harbor, parsed.actorId) as
      | { credential_hash: string | null; credential_salt: string | null }
      | undefined;
    if (!soul || !soul.credential_hash || !soul.credential_salt) return null;
    const candidate = hashCredential(soul.credential_salt, parsed.secret);
    return constantTimeEqualHex(candidate, soul.credential_hash)
      ? asActorId(parsed.actorId)
      : null;
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
    operatorToken?: string | null;
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
      // BEFORE minting or spending an admission slot — otherwise this door
      // provisions `system → attacker`, poisoning /sugar/begin's guard.
      if (params.alias && isReservedIdentityName(params.alias)) {
        return { ok: false, status: 'rejected', code: 'RESERVED_ALIAS', httpStatus: 403 };
      }

      // 3a. Admission rate-limit: bound distinct newcomer souls per project/day.
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

      // 3b. Mint a fresh newcomer soul; issue a credential ONCE.
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

  return {
    mint,
    register,
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
      newcomerAdmitMax,
    },
  };
}

export type ActorSouls = ReturnType<typeof createActorSouls>;
