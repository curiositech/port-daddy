/**
 * Daemon-side grant & discharge store (ADR-0053 Phase 1 integration).
 *
 * The macaroon core (`macaroon.ts`) is pure crypto over keys the caller holds.
 * This module is the stateful daemon side: it mints push grants, keeps their
 * root keys where the agent can never read them, and discharges rent caveats
 * against live lease facts.
 *
 * KEY STORAGE — the load-bearing security decision. A grant's root key and its
 * rent-caveat key are daemon secrets: anyone holding them can mint or forge.
 * They therefore live in the OS keychain (`lib/keychain.ts`), NEVER in plaintext
 * SQLite. SQLite holds only non-secret metadata (which session, which repo, when
 * it expires, the caveat id). The secret backend is injected (`SecretStore`) so
 * tests and non-macOS hosts use an in-memory store without touching the real
 * keychain. Hard revocation (Appendix A §A.4) deletes the keys — every macaroon
 * derived from them dies immediately.
 */

import type { Database } from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { keychain, KEYCHAIN_SERVICE } from '../keychain.js';
import type { LeaseFacts, RentPolicy } from '../coast-guard/compulsion.js';
import {
  mintActorBoundPushGrant,
  dischargeRentPaid,
  type DischargeResult,
} from './discharge.js';
import { verifyPushGrant, type GateResult } from './gate.js';
import type { Macaroon, RequestContext } from './types.js';

/**
 * A namespace of daemon-held secrets (hex-encoded). The production binding is
 * the OS keychain; tests inject an in-memory map. Mirrors the keychain API but
 * scoped to the macaroon service account space.
 */
export interface SecretStore {
  put(account: string, hexSecret: string): boolean;
  get(account: string): string | null;
  del(account: string): boolean;
}

/** Keychain-backed secret store (production default). */
export const keychainSecretStore: SecretStore = {
  put: (account, value) => keychain.saveSecret(KEYCHAIN_SERVICE, account, value),
  get: (account) => keychain.loadSecret(KEYCHAIN_SERVICE, account),
  del: (account) => keychain.deleteSecret(KEYCHAIN_SERVICE, account),
};

/** In-memory secret store for tests and non-keychain hosts. NOT for production
 *  daemons (secrets vanish on restart — which for short-lived grants is merely
 *  a forced re-mint, but still: production injects the keychain store). */
export class InMemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();
  put(account: string, value: string): boolean {
    this.map.set(account, value);
    return true;
  }
  get(account: string): string | null {
    return this.map.get(account) ?? null;
  }
  del(account: string): boolean {
    return this.map.delete(account);
  }
}

const rootAccount = (grantId: string) => `macaroon/actor-bound-push/${grantId}/root`;
const rentAccount = (grantId: string) => `macaroon/actor-bound-push/${grantId}/rent`;

export interface MintGrantOptions {
  /** Repository the grant authorizes pushes to. */
  repoId: string;
  /** Canonical daemon-minted actor principal. */
  actor: string;
  /** Session the grant is bound to. */
  session: string;
  /** Hard expiry of the grant (unix ms). */
  expiresMs: number;
  /** Creation time (unix ms) — injected for determinism. */
  nowMs: number;
  /** Protected branch the grant must never push to. Default `main`. */
  protectedBranch?: string;
}

export interface MintGrantResult {
  /** Opaque grant id (also the macaroon identifier). */
  grantId: string;
  /** The push grant — safe to hand to the agent; carries no keys. */
  macaroon: Macaroon;
  /** The rent caveat id the daemon will discharge. */
  rentCaveatId: string;
}

export interface GrantRow {
  grantId: string;
  repo: string;
  actor: string;
  session: string;
  expiresMs: number;
  rentCaveatId: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface DischargeForSessionOptions {
  grantId: string;
  /** Session requesting the discharge — must match the grant. */
  session: string;
  /** Current lease facts (from `compulsion-facts.ts` in production). */
  facts: LeaseFacts;
  /** Verification clock (unix ms). */
  nowMs: number;
  policy?: RentPolicy;
  ttlMs?: number;
}

/**
 * Create the grant/discharge store over a SQLite database and a secret backend.
 * Idempotent table init follows the repo's `createFoo(db, deps)` convention.
 */
export function createMacaroonStore(db: Database, secrets: SecretStore = keychainSecretStore) {
  const runDDL = (sql: string): void => {
    db.prepare(sql).run();
  };

  runDDL(`
    CREATE TABLE IF NOT EXISTS actor_bound_push_grants (
      grant_id        TEXT PRIMARY KEY,
      repo            TEXT NOT NULL,
      actor           TEXT NOT NULL,
      session         TEXT NOT NULL,
      expires_ms      INTEGER NOT NULL,
      rent_caveat_id  TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      revoked_at      INTEGER
    )
  `);
  runDDL(`CREATE INDEX IF NOT EXISTS idx_actor_bound_push_grants_session ON actor_bound_push_grants(session)`);

  // Positional `?` placeholders, NOT @named object binding: under bun:sqlite
  // (the compiled daemon's runtime via lib/sqlite-runtime.ts) @named binding can
  // silently bind NULL even though it works under better-sqlite3 in jest — a
  // green-in-tests/broken-in-daemon trap. Some older modules predate this and
  // still use @named; this module avoids it deliberately. See the bun:sqlite
  // binding note in lib/roadmap-items.ts:163-169.
  const insertGrant = db.prepare(`
    INSERT INTO actor_bound_push_grants
      (grant_id, repo, actor, session, expires_ms, rent_caveat_id, created_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const selectGrant = db.prepare(`SELECT * FROM actor_bound_push_grants WHERE grant_id = ?`);
  const markRevoked = db.prepare(
    `UPDATE actor_bound_push_grants SET revoked_at = ? WHERE grant_id = ?`,
  );

  function rowToGrant(r: Record<string, unknown> | undefined): GrantRow | null {
    if (!r) return null;
    return {
      grantId: r.grant_id as string,
      repo: r.repo as string,
      actor: r.actor as string,
      session: r.session as string,
      expiresMs: r.expires_ms as number,
      rentCaveatId: r.rent_caveat_id as string,
      createdAt: r.created_at as number,
      revokedAt: (r.revoked_at as number | null) ?? null,
    };
  }

  return {
    /**
     * Mint a push grant: generate fresh root + caveat keys, stash them in the
     * secret store, persist the metadata, and return the agent-safe macaroon.
     * `grantId` and the rent nonce are derived from fresh randomness here (this
     * is the impure, stateful boundary — the pure actor-bound recipe takes them as
     * inputs so it stays testable).
     */
    mintGrant(opts: MintGrantOptions): MintGrantResult {
      const grantSeed = `grant-${randomBytes(12).toString('hex')}`;
      const rentNonce = randomBytes(12).toString('hex');
      const rootKey = randomBytes(32);
      const caveatKey = randomBytes(32);

      const { macaroon, rentCaveatId } = mintActorBoundPushGrant({
        rootKey,
        grantId: grantSeed,
        repoId: opts.repoId,
        actor: opts.actor,
        session: opts.session,
        expiresMs: opts.expiresMs,
        caveatKey,
        rentNonce,
        protectedBranch: opts.protectedBranch,
      });
      const grantId = macaroon.identifier;

      // Fail closed: persist the secrets FIRST and only write the metadata row
      // if both succeeded. If the secret store is unavailable (no keychain),
      // minting a grant whose keys don't exist would leave an orphaned DB row
      // and a macaroon that can never be discharged or verified. Best-effort
      // cleanup of any partial write, then throw.
      const okRoot = secrets.put(rootAccount(grantId), rootKey.toString('hex'));
      const okCaveat = secrets.put(rentAccount(grantId), caveatKey.toString('hex'));
      if (!okRoot || !okCaveat) {
        secrets.del(rootAccount(grantId));
        secrets.del(rentAccount(grantId));
        throw new Error(
          'macaroon: secret store unavailable — grant not minted (no orphaned row written)',
        );
      }

      try {
        insertGrant.run(
          grantId,
          opts.repoId,
          opts.actor,
          opts.session,
          opts.expiresMs,
          rentCaveatId,
          opts.nowMs,
        );
      } catch (err) {
        // The row write failed AFTER the secrets were stored (DB locked,
        // readonly, full…). Roll the secrets back so we never leave orphaned
        // keychain entries without a matching grant row, then rethrow.
        secrets.del(rootAccount(grantId));
        secrets.del(rentAccount(grantId));
        throw err;
      }

      return { grantId, macaroon, rentCaveatId };
    },

    /** Fetch grant metadata (no secrets). */
    getGrant(grantId: string): GrantRow | null {
      return rowToGrant(selectGrant.get(grantId) as Record<string, unknown> | undefined);
    },

    /**
     * Discharge a grant's rent caveat for a session: load the caveat key, gather
     * the verdict via `dischargeRentPaid` (which refuses anything but `paid`),
     * and return the discharge macaroon when rent is current. A revoked or
     * unknown grant refuses.
     */
    discharge(opts: DischargeForSessionOptions): DischargeResult | { ok: false; reason: string } {
      const grant = rowToGrant(selectGrant.get(opts.grantId) as Record<string, unknown> | undefined);
      if (!grant) return { ok: false, reason: 'unknown grant' };
      if (grant.revokedAt !== null) return { ok: false, reason: 'grant has been revoked' };
      const caveatHex = secrets.get(rentAccount(opts.grantId));
      if (!caveatHex) return { ok: false, reason: 'grant key unavailable (revoked or evicted)' };

      return dischargeRentPaid({
        record: { caveatKey: Buffer.from(caveatHex, 'hex'), session: grant.session },
        rentCaveatId: grant.rentCaveatId,
        session: opts.session,
        facts: opts.facts,
        nowMs: opts.nowMs,
        policy: opts.policy,
        ttlMs: opts.ttlMs,
      });
    },

    /**
     * Verify a presented grant + discharges against a request. Loads the grant's
     * root key; an unknown or revoked grant is unauthorized. This is the
     * server-side gate (Relay / `pd guard` push broker call it).
     */
    verify(grant: Macaroon, discharges: Macaroon[], ctx: RequestContext): GateResult {
      const row = rowToGrant(selectGrant.get(grant.identifier) as Record<string, unknown> | undefined);
      if (!row) return { authorized: false, reason: 'unknown grant' };
      if (row.revokedAt !== null) return { authorized: false, reason: 'grant has been revoked' };
      const rootHex = secrets.get(rootAccount(grant.identifier));
      if (!rootHex) return { authorized: false, reason: 'grant key unavailable (revoked or evicted)' };
      // The verifier holds the discharge key (HMAC-commitment model): resolve it
      // from the store for this grant's rent caveat id.
      const resolveCaveatKey = (caveatId: string): Buffer | null => {
        if (caveatId !== row.rentCaveatId) return null;
        const caveatHex = secrets.get(rentAccount(grant.identifier));
        return caveatHex ? Buffer.from(caveatHex, 'hex') : null;
      };
      return verifyPushGrant(
        grant,
        Buffer.from(rootHex, 'hex'),
        discharges,
        row.actor,
        ctx,
        resolveCaveatKey,
      );
    },

    /**
     * Hard revocation (Appendix A §A.4): delete the root + caveat keys and mark
     * the row revoked. Every macaroon derived from this grant fails immediately
     * — there is nothing to re-discharge against.
     */
    revokeGrant(grantId: string, nowMs: number): boolean {
      const grant = selectGrant.get(grantId);
      if (!grant) return false;
      secrets.del(rootAccount(grantId));
      secrets.del(rentAccount(grantId));
      markRevoked.run(nowMs, grantId);
      return true;
    },
  };
}

export type MacaroonStore = ReturnType<typeof createMacaroonStore>;
