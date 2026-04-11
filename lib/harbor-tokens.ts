/**
 * Harbor Capability Tokens
 *
 * Active path in this slice:
 *   - Phase 2 tokens are Ed25519-signed JWTs (`alg: EdDSA`) with `hv: 2`
 *   - New issuance always uses the daemon-held Phase 2 signing identity
 *
 * Compatibility boundary preserved in this slice:
 *   - Legacy Phase 1 HS256 tokens remain verifiable
 *   - Legacy verification is explicit via `verifyLegacyPhase1HarborCard()`
 *   - New issuance never falls back to HS256
 *
 * Deliberately out of scope here:
 *   - Per-harbor signing keys
 *   - Delegation chains / attenuation
 *   - Cross-machine federation
 *
 * Security properties:
 *   - Verification dispatch is version-gated, not header-trusting
 *   - Phase 2 requires `alg: EdDSA`, fixed `kid`, and `hv: 2`
 *   - Legacy Phase 1 requires `alg: HS256` and no Phase 2 version claim
 *   - JTIs are written to DB before a token string is returned
 *   - Revoked JTIs are checked on every successful verification path
 */

import type Database from 'better-sqlite3';
import {
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import { SignJWT, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';

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

export const HARBOR_TOKEN_PHASE2_VERSION = 2;
export const HARBOR_TOKEN_PHASE2_KEY_ID = 'harbor-daemon-ed25519-v1';
export const HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID = 'singleton';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HarborTokenVersion = 'phase1-legacy' | 'phase2';

export interface HarborCardPayload {
  iss: string;      // 'port-daddy'
  sub: string;      // agentId
  aud: string;      // harborName
  jti: string;      // unique token ID (stored in DB before return)
  exp: number;      // expiry (unix seconds)
  iat: number;      // issued at (unix seconds)
  lhb: number;      // last heartbeat at issue time (unix ms)
  cap: string[];    // capability array
  hv?: number;      // harbor token version (Phase 2 uses hv=2; legacy Phase 1 omits it)
  tokenVersion?: HarborTokenVersion; // attached by verifier, not serialized into the JWT
}

export interface IssueHarborCardParams {
  agentId: string;
  harborName: string;
  capabilities: string[];
  lastHeartbeat: number; // unix ms
  ttlMs?: number;        // default: DEFAULT_TOKEN_TTL_MS
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exportKeyToPem(key: ReturnType<typeof createPrivateKey> | ReturnType<typeof createPublicKey>): string {
  const type = key.type === 'private' ? 'pkcs8' : 'spki';
  return key.export({ format: 'pem', type }).toString();
}

function readHeaderAndPayload(token: string): {
  header: ReturnType<typeof decodeProtectedHeader>;
  payload: Record<string, unknown>;
} | null {
  try {
    return {
      header: decodeProtectedHeader(token),
      payload: decodeJwt(token) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function withVersion(payload: HarborCardPayload, tokenVersion: HarborTokenVersion): HarborCardPayload {
  return {
    ...payload,
    tokenVersion,
  };
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

    CREATE TABLE IF NOT EXISTS harbor_token_signing_keys (
      id              TEXT PRIMARY KEY,
      alg             TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      public_key_pem  TEXT NOT NULL,
      created_at      INTEGER NOT NULL
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
    getLegacyPhase1Key: db.prepare<[string], { key_hex: string }>(
      'SELECT key_hex FROM daemon_keys WHERE id = ?',
    ),
    insertLegacyPhase1Key: db.prepare(
      'INSERT OR IGNORE INTO daemon_keys (id, key_hex, created_at) VALUES (?, ?, ?)',
    ),

    getPhase2KeyPair: db.prepare<[string], { private_key_pem: string; public_key_pem: string }>(
      'SELECT private_key_pem, public_key_pem FROM harbor_token_signing_keys WHERE id = ?',
    ),
    insertPhase2KeyPair: db.prepare(
      'INSERT OR IGNORE INTO harbor_token_signing_keys (id, alg, private_key_pem, public_key_pem, created_at) VALUES (?, ?, ?, ?, ?)',
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

  // Key material loaded once per daemon lifecycle.
  let legacyPhase1SigningKey: ReturnType<typeof createSecretKey> | null = null;
  let phase2PrivateSigningKey: ReturnType<typeof createPrivateKey> | null = null;
  let phase2PublicVerifyKey: ReturnType<typeof createPublicKey> | null = null;

  function detectHarborCardVersion(token: string): HarborTokenVersion | null {
    if (!token) return null;
    const decoded = readHeaderAndPayload(token);
    if (!decoded) return null;

    const { header, payload } = decoded;
    if (
      header.alg === 'EdDSA'
      && header.kid === HARBOR_TOKEN_PHASE2_KEY_ID
      && payload.hv === HARBOR_TOKEN_PHASE2_VERSION
    ) {
      return 'phase2';
    }

    if (
      header.alg === 'HS256'
      && header.kid === undefined
      && payload.hv === undefined
    ) {
      return 'phase1-legacy';
    }

    return null;
  }

  async function verifyPhase2HarborCard(
    token: string,
    expectedHarbor?: string,
  ): Promise<HarborCardPayload | null> {
    if (!phase2PublicVerifyKey || !token) return null;
    if (detectHarborCardVersion(token) !== 'phase2') return null;

    try {
      const { payload, protectedHeader } = await jwtVerify(token, phase2PublicVerifyKey, {
        algorithms: ['EdDSA'],
        issuer: 'port-daddy',
        ...(expectedHarbor ? { audience: expectedHarbor } : {}),
      });

      if (protectedHeader.kid !== HARBOR_TOKEN_PHASE2_KEY_ID) return null;
      if (payload.hv !== HARBOR_TOKEN_PHASE2_VERSION) return null;

      const revoked = stmts.isRevoked.get(payload.jti as string);
      if (revoked) return null;

      return withVersion(payload as unknown as HarborCardPayload, 'phase2');
    } catch {
      return null;
    }
  }

  async function verifyLegacyPhase1HarborCard(
    token: string,
    expectedHarbor?: string,
  ): Promise<HarborCardPayload | null> {
    if (!legacyPhase1SigningKey || !token) return null;
    if (detectHarborCardVersion(token) !== 'phase1-legacy') return null;

    try {
      const { payload, protectedHeader } = await jwtVerify(token, legacyPhase1SigningKey, {
        algorithms: ['HS256'],
        issuer: 'port-daddy',
        ...(expectedHarbor ? { audience: expectedHarbor } : {}),
      });

      if (protectedHeader.kid !== undefined) return null;
      if (payload.hv !== undefined) return null;

      const revoked = stmts.isRevoked.get(payload.jti as string);
      if (revoked) return null;

      return withVersion(payload as unknown as HarborCardPayload, 'phase1-legacy');
    } catch {
      return null;
    }
  }

  return {
    /**
     * Load or generate the daemon's signing identities.
     *
     * Phase 1 compatibility:
     *   - preserves the legacy singleton HS256 secret so old tokens can still be verified
     *
     * Phase 2 active path:
     *   - provisions a daemon-held Ed25519 keypair used for all new issuance in this slice
     *   - per-harbor keys are intentionally deferred to a later phase
     */
    async initDaemonIdentity(): Promise<void> {
      const now = Date.now();

      // Preserve the pre-existing Phase 1 singleton row so legacy HS256 tokens remain verifiable.
      const newLegacyKeyHex = randomBytes(32).toString('hex');
      stmts.insertLegacyPhase1Key.run(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID, newLegacyKeyHex, now);

      const legacyRow = stmts.getLegacyPhase1Key.get(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID);
      if (!legacyRow) throw new Error('daemon_keys: failed to initialize singleton row');
      legacyPhase1SigningKey = createSecretKey(Buffer.from(legacyRow.key_hex, 'hex'));

      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      stmts.insertPhase2KeyPair.run(
        HARBOR_TOKEN_PHASE2_KEY_ID,
        'Ed25519',
        exportKeyToPem(privateKey),
        exportKeyToPem(publicKey),
        now,
      );

      const phase2Row = stmts.getPhase2KeyPair.get(HARBOR_TOKEN_PHASE2_KEY_ID);
      if (!phase2Row) {
        throw new Error('harbor_token_signing_keys: failed to initialize phase2 keypair');
      }

      phase2PrivateSigningKey = createPrivateKey(phase2Row.private_key_pem);
      phase2PublicVerifyKey = createPublicKey(phase2Row.public_key_pem);
    },

    /**
     * Issue a Phase 2 harbor card (JWT) granting an agent access to a specific harbor.
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
      if (!phase2PrivateSigningKey) {
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

      return new SignJWT({
        cap: capabilities,
        lhb: lastHeartbeat,
        hv: HARBOR_TOKEN_PHASE2_VERSION,
      })
        .setProtectedHeader({
          alg: 'EdDSA',
          kid: HARBOR_TOKEN_PHASE2_KEY_ID,
          typ: 'JWT',
        })
        .setSubject(agentId)
        .setAudience(harborName)
        .setIssuer('port-daddy')
        .setJti(jti)
        .setIssuedAt(nowSec)
        .setExpirationTime(expSec)
        .sign(phase2PrivateSigningKey);
    },

    /**
     * Inspect the token envelope and return the supported version it claims to be.
     *
     * This does not verify the signature. It is only used to route a token to
     * an explicit verification path with pinned expectations.
     */
    detectHarborCardVersion,

    /**
     * Verify a current Phase 2 harbor card and return its payload, or null if invalid.
     *
     * This path only accepts Phase 2 (`EdDSA` + `hv:2`). Legacy Phase 1 tokens
     * must go through `verifyLegacyPhase1HarborCard()`.
     */
    async verifyHarborCard(
      token: string,
      expectedHarbor?: string,
    ): Promise<HarborCardPayload | null> {
      return verifyPhase2HarborCard(token, expectedHarbor);
    },

    /**
     * Verify a legacy Phase 1 HS256 harbor card.
     *
     * This path exists strictly for compatibility with already-issued Phase 1
     * tokens. New issuance never uses it.
     */
    async verifyLegacyPhase1HarborCard(
      token: string,
      expectedHarbor?: string,
    ): Promise<HarborCardPayload | null> {
      return verifyLegacyPhase1HarborCard(token, expectedHarbor);
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
