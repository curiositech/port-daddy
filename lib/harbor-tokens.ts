/**
 * Harbor Capability Tokens — Phase 1 (HMAC / HS256)
 *
 * Issues and verifies short-lived JWT "harbor cards" that prove an agent
 * is authorized to operate within a specific harbor (permission namespace).
 *
 * Security properties (per council review, 2026-03-10):
 *   - Algorithm PINNED to HS256 — alg header from tokens is never trusted
 *   - JTI written to DB BEFORE JWT string is returned (atomic audit trail)
 *   - `lhb` claim carries last-heartbeat timestamp for zombie detection
 *   - Revoked JTIs are stored and checked on every verification
 *   - Partial index on revocations(expires_at) for cheap reaper queries
 *
 * Phase roadmap:
 *   Phase 1 (this module): HMAC symmetric key, single daemon
 *   Phase 2: Asymmetric keys, per-harbor key rotation
 *   Phase 3: Biscuit/Macaroon delegation chains (A2A multi-hop)
 *
 * References:
 *   - arXiv 2509.13597 (Agentic JWT) — lhb, delegation_chain, jti pattern
 *   - arXiv 2602.11865 (Google DeepMind DCTs) — capability caveat design
 *   - CVE-2026-22817 (Hono alg confusion) — why we pin algorithms: ['HS256']
 */

import type Database from 'better-sqlite3';
import { randomBytes, createSecretKey } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

// ─── Constants ───────────────────────────────────────────────────────────────

/** 30-second default heartbeat interval — matches agent heartbeat config. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * How stale a `lhb` claim is tolerated.
 * 4 × heartbeat interval gives room for timing jitter while still catching
 * zombie agents whose heartbeat has flatlined.
 */
export const LHB_TOLERANCE_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 4; // 120_000

/** Default harbor card lifetime. */
export const DEFAULT_TOKEN_TTL_MS = 3_600_000; // 1 hour

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HarborCardPayload {
  iss: string;      // 'port-daddy'
  sub: string;      // agentId
  aud: string;      // harborName
  jti: string;      // unique token ID (stored in DB before return)
  exp: number;      // expiry (unix seconds)
  iat: number;      // issued at (unix seconds)
  lhb: number;      // last heartbeat at issue time (unix ms)
  cap: string[];    // capability array
}

export interface IssueHarborCardParams {
  agentId: string;
  harborName: string;
  capabilities: string[];
  lastHeartbeat: number; // unix ms
  ttlMs?: number;        // default: DEFAULT_TOKEN_TTL_MS
}

// ─── Module ──────────────────────────────────────────────────────────────────

export function createHarborTokens(db: Database.Database) {
  // Schema — idempotent, self-initializing
  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_keys (
      id       TEXT PRIMARY KEY,
      key_hex  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS harbor_issued_tokens (
      jti         TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      harbor_name TEXT NOT NULL,
      issued_at   INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hit_agent   ON harbor_issued_tokens(agent_id);
    CREATE INDEX IF NOT EXISTS idx_hit_expires ON harbor_issued_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS harbor_token_revocations (
      jti        TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      revoked_at INTEGER NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_revocations_agent ON harbor_token_revocations(agent_id);
    -- Partial index: only rows with a known expiry — supports efficient reaper
    CREATE INDEX IF NOT EXISTS idx_revocations_expires ON harbor_token_revocations(expires_at)
      WHERE expires_at IS NOT NULL;
  `);

  const stmts = {
    getKey: db.prepare<[string], { key_hex: string }>(
      'SELECT key_hex FROM daemon_keys WHERE id = ?',
    ),
    insertKey: db.prepare(
      'INSERT OR IGNORE INTO daemon_keys (id, key_hex, created_at) VALUES (?, ?, ?)',
    ),

    insertToken: db.prepare(
      'INSERT INTO harbor_issued_tokens (jti, agent_id, harbor_name, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),

    isRevoked: db.prepare<[string], { 1: number }>(
      'SELECT 1 FROM harbor_token_revocations WHERE jti = ?',
    ),

    getTokensByAgent: db.prepare<[string], { jti: string; expires_at: number }>(
      'SELECT jti, expires_at FROM harbor_issued_tokens WHERE agent_id = ?',
    ),

    insertRevocation: db.prepare(
      'INSERT OR IGNORE INTO harbor_token_revocations (jti, agent_id, revoked_at, expires_at) VALUES (?, ?, ?, ?)',
    ),

    deleteExpiredRevocations: db.prepare(
      'DELETE FROM harbor_token_revocations WHERE expires_at IS NOT NULL AND expires_at < ?',
    ),
  };

  // In-memory signing key — loaded/derived once per daemon lifecycle.
  // Type: KeyObject (from Node.js crypto) — compatible with jose.
  let signingKey: ReturnType<typeof createSecretKey> | null = null;

  return {
    /**
     * Load or generate the daemon's HMAC signing key.
     * Idempotent — safe to call multiple times; DB key is preserved.
     * Must be called before issueHarborCard().
     */
    async initDaemonIdentity(): Promise<void> {
      // Generate a new key if none exists. OR IGNORE ensures race safety.
      const newKeyHex = randomBytes(32).toString('hex');
      stmts.insertKey.run('singleton', newKeyHex, Date.now());

      // Load the canonical key (either the one we just inserted or the pre-existing one)
      const row = stmts.getKey.get('singleton');
      if (!row) throw new Error('daemon_keys: failed to initialize singleton row');

      signingKey = createSecretKey(Buffer.from(row.key_hex, 'hex'));
    },

    /**
     * Issue a harbor card (JWT) granting an agent access to a specific harbor.
     *
     * Security: JTI is written to `harbor_issued_tokens` BEFORE the JWT
     * string is returned, ensuring an audit record exists even if the caller
     * crashes before recording the token elsewhere.
     */
    async issueHarborCard({
      agentId,
      harborName,
      capabilities,
      lastHeartbeat,
      ttlMs = DEFAULT_TOKEN_TTL_MS,
    }: IssueHarborCardParams): Promise<string> {
      if (!signingKey) {
        throw new Error('initDaemonIdentity() must be called before issueHarborCard()');
      }

      const jti = randomBytes(16).toString('hex');
      const now = Date.now();
      const expiresAt = now + ttlMs;
      const nowSec = Math.floor(now / 1000);
      const expSec = Math.floor(expiresAt / 1000);

      // ─── CRITICAL: Write JTI to DB first, before signing ───────────────────
      // This ensures the audit record exists even if signing fails.
      stmts.insertToken.run(jti, agentId, harborName, now, expiresAt);

      const token = await new SignJWT({ cap: capabilities, lhb: lastHeartbeat })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(agentId)
        .setAudience(harborName)
        .setIssuer('port-daddy')
        .setJti(jti)
        .setIssuedAt(nowSec)
        .setExpirationTime(expSec)
        .sign(signingKey);

      return token;
    },

    /**
     * Verify a harbor card and return its payload, or null if invalid.
     *
     * Security: Algorithm is PINNED to HS256. The `alg` field in the JWT
     * header is never used to select the verification algorithm — doing so
     * would expose us to algorithm confusion attacks (e.g. CVE-2026-22817).
     *
     * Returns null for: invalid signature, wrong audience, expired, revoked.
     */
    async verifyHarborCard(
      token: string,
      expectedHarbor?: string,
    ): Promise<HarborCardPayload | null> {
      if (!signingKey) return null;
      if (!token) return null;

      try {
        const { payload } = await jwtVerify(token, signingKey, {
          // ─── Algorithm pinning: explicit allowlist, never trust header ──────
          algorithms: ['HS256'],
          issuer: 'port-daddy',
          ...(expectedHarbor ? { audience: expectedHarbor } : {}),
        });

        // Check JTI revocation
        const revoked = stmts.isRevoked.get(payload.jti as string);
        if (revoked) return null;

        return payload as unknown as HarborCardPayload;
      } catch {
        return null;
      }
    },

    /**
     * Revoke all harbor cards for a dead/unregistering agent.
     * Called by the reaper when an agent's heartbeat flatlines.
     *
     * Moves JTIs from `harbor_issued_tokens` to `harbor_token_revocations`
     * so that in-flight tokens are rejected on next verification.
     *
     * Returns the number of tokens revoked.
     */
    revokeHarborCardsForAgent(agentId: string): number {
      const tokens = stmts.getTokensByAgent.all(agentId);
      const now = Date.now();
      for (const t of tokens) {
        stmts.insertRevocation.run(t.jti, agentId, now, t.expires_at);
      }
      return tokens.length;
    },

    /**
     * Delete expired entries from `harbor_token_revocations`.
     * Once the underlying token's expiry has passed, the revocation entry
     * is no longer needed — an expired token would be rejected by jwtVerify
     * regardless of the revocation table.
     *
     * Returns the number of rows deleted.
     */
    cleanupExpiredRevocations(): number {
      const result = stmts.deleteExpiredRevocations.run(Date.now());
      return result.changes;
    },
  };
}

export type HarborTokens = ReturnType<typeof createHarborTokens>;
