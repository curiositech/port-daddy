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
  sign as cryptoSign,
} from 'node:crypto';
import { SignJWT, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';

// ─── Keychain accounts for daemon-held signing keys ─────────────────────────
//
// These are the root-of-trust secrets for Harbor Card issuance. Exposing
// either lets an attacker forge cards that verify as authentic under the
// daemon's identity. Until the move to macOS Keychain, they sat in
// plaintext in the SQLite DB — readable by any same-user process. See
// docs/shipwright/SECURITY-ASSESSMENT.md F-03 for the threat model.
const KEYCHAIN_PHASE2_PRIVATE_ACCOUNT = 'harbor-signing-private-v2';
const KEYCHAIN_PHASE1_LEGACY_ACCOUNT  = 'harbor-signing-phase1-legacy';

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

      // ════════════════════════════════════════════════════════════════════
      //  PHASE 1 LEGACY KEY (HS256) — VERIFY-ONLY PATH FOR OLD TOKENS
      // ════════════════════════════════════════════════════════════════════
      // Acquisition priority:
      //   1. macOS Keychain
      //   2. DB plaintext column (migrate → Keychain; blank out DB)
      //   3. Generate fresh → store in Keychain (or DB fallback)
      //
      // We never issue HS256 tokens anymore; this key only verifies old
      // cards that are still within their TTL. Exposure is still bad —
      // an attacker with the key can forge legacy cards for the TTL window.
      let legacyKeyHex = keychain.loadSecret(KEYCHAIN_SERVICE, KEYCHAIN_PHASE1_LEGACY_ACCOUNT);

      if (!legacyKeyHex) {
        const legacyRow = stmts.getLegacyPhase1Key.get(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID);
        if (legacyRow?.key_hex && legacyRow.key_hex.length > 0) {
          // Migration: move from DB to keychain, clear DB row (NOT NULL → empty string).
          legacyKeyHex = legacyRow.key_hex;
          if (keychain.available() && keychain.saveSecret(KEYCHAIN_SERVICE, KEYCHAIN_PHASE1_LEGACY_ACCOUNT, legacyKeyHex)) {
            db.prepare('UPDATE daemon_keys SET key_hex = ? WHERE id = ?')
              .run('', HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID);
            console.error(
              '[HarborTokens] Migrated phase1 legacy HMAC secret from DB to macOS Keychain. DB row sanitized.',
            );
          }
        } else {
          // First-ever boot on this machine: generate.
          legacyKeyHex = randomBytes(32).toString('hex');
          const stashed = keychain.available() && keychain.saveSecret(
            KEYCHAIN_SERVICE, KEYCHAIN_PHASE1_LEGACY_ACCOUNT, legacyKeyHex,
          );
          if (stashed) {
            // Write a sentinel row so future boots know the key exists somewhere
            // (even on platforms where keychain isn't available later).
            stmts.insertLegacyPhase1Key.run(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID, '', now);
            console.error('[HarborTokens] Generated phase1 legacy HMAC secret in macOS Keychain');
          } else {
            // Keychain unavailable — fall back to plaintext DB storage.
            stmts.insertLegacyPhase1Key.run(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID, legacyKeyHex, now);
            console.error(
              '[HarborTokens] Generated phase1 legacy HMAC secret in DB plaintext (keychain unavailable)',
            );
          }
        }
      }

      if (!legacyKeyHex) {
        throw new Error('daemon_keys: failed to initialize legacy phase1 signing key');
      }
      legacyPhase1SigningKey = createSecretKey(Buffer.from(legacyKeyHex, 'hex'));

      // ════════════════════════════════════════════════════════════════════
      //  PHASE 2 ED25519 KEYPAIR — ACTIVE ISSUANCE KEY
      // ════════════════════════════════════════════════════════════════════
      // This is THE root of trust. Anything that holds the private half can
      // sign cards that verify authentic. Same three-tier acquisition as
      // phase 1, but the stakes are higher — every current-daemon Harbor
      // Card is signed with this key.
      //
      // The PUBLIC key remains in the DB (it is not secret; callers need to
      // verify locally-cached tokens before the daemon is fully up). Only
      // the PRIVATE half moves.
      let privatePem = keychain.loadSecret(KEYCHAIN_SERVICE, KEYCHAIN_PHASE2_PRIVATE_ACCOUNT);
      let publicPem: string | null = null;

      const phase2Row = stmts.getPhase2KeyPair.get(HARBOR_TOKEN_PHASE2_KEY_ID);

      if (privatePem) {
        // Keychain is authoritative. Use the DB public key if present; else
        // derive it from the private key and cache it in the DB for future reads.
        if (phase2Row?.public_key_pem) {
          publicPem = phase2Row.public_key_pem;
        } else {
          const derivedPublic = createPublicKey(createPrivateKey(privatePem));
          publicPem = exportKeyToPem(derivedPublic);
          stmts.insertPhase2KeyPair.run(
            HARBOR_TOKEN_PHASE2_KEY_ID, 'Ed25519', '', publicPem, now,
          );
        }
      } else if (phase2Row?.private_key_pem && phase2Row.private_key_pem.length > 0) {
        // Migration path: key lives in DB plaintext. Move it to the keychain
        // and clear the DB column (NOT NULL → empty string sentinel).
        privatePem = phase2Row.private_key_pem;
        publicPem  = phase2Row.public_key_pem;
        if (keychain.available() && keychain.saveSecret(
          KEYCHAIN_SERVICE, KEYCHAIN_PHASE2_PRIVATE_ACCOUNT, privatePem,
        )) {
          db.prepare('UPDATE harbor_token_signing_keys SET private_key_pem = ? WHERE id = ?')
            .run('', HARBOR_TOKEN_PHASE2_KEY_ID);
          console.error(
            '[HarborTokens] Migrated phase2 signing key from DB to macOS Keychain. DB row sanitized.',
          );
        }
      } else {
        // Brand-new install: generate, prefer keychain storage.
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        privatePem = exportKeyToPem(privateKey);
        publicPem  = exportKeyToPem(publicKey);
        const stashed = keychain.available() && keychain.saveSecret(
          KEYCHAIN_SERVICE, KEYCHAIN_PHASE2_PRIVATE_ACCOUNT, privatePem,
        );
        if (stashed) {
          // Store only the public key in the DB. Private lives in keychain.
          stmts.insertPhase2KeyPair.run(
            HARBOR_TOKEN_PHASE2_KEY_ID, 'Ed25519', '', publicPem, now,
          );
          console.error('[HarborTokens] Generated phase2 signing key in macOS Keychain');
        } else {
          // Keychain unavailable — file-fallback (Linux/Windows for now).
          stmts.insertPhase2KeyPair.run(
            HARBOR_TOKEN_PHASE2_KEY_ID, 'Ed25519', privatePem, publicPem, now,
          );
          console.error(
            '[HarborTokens] Generated phase2 signing key in DB plaintext (keychain unavailable)',
          );
        }
      }

      if (!privatePem || !publicPem) {
        throw new Error('harbor_token_signing_keys: failed to initialize phase2 keypair');
      }

      phase2PrivateSigningKey = createPrivateKey(privatePem);
      phase2PublicVerifyKey   = createPublicKey(publicPem);
    },

    /**
     * Sign the hex-decoded bytes of `msgHex` with the daemon's Phase 2
     * Ed25519 identity; returns the hex signature.
     *
     * WHY THIS LIVES HERE and not in a caller holding the PEM: the design
     * intent of this module is that the private key never leaves it — callers
     * ask for an operation and receive a result ("use without see", the same
     * custody posture as pd-vault). The relay connection lifecycle
     * (lib/relay-connection.ts) needs exactly one operation — sign the
     * SHA-256 handshake/binding digest the relay verifies with the daemon's
     * registered pub_key (apps/relay verifyEd25519 signs/verifies the
     * hex-DECODED digest bytes, so this must too) — and this method is that
     * operation, nothing wider.
     *
     * @param msgHex Hex-encoded message digest to sign.
     * @returns Hex-encoded Ed25519 signature.
     */
    async signHex(msgHex: string): Promise<string> {
      if (!phase2PrivateSigningKey) {
        throw new Error('initDaemonIdentity() must be called before signHex()');
      }
      return cryptoSign(null, Buffer.from(msgHex, 'hex'), phase2PrivateSigningKey).toString('hex');
    },

    /**
     * The daemon's Phase 2 Ed25519 public key as raw 32-byte hex — the form
     * the relay stores as `identity.pub_key` and the envelope signature's
     * `key_id` carries.
     *
     * Purpose: gives wiring code (server.ts, the seal chokepoint's signer)
     * the public half without ever exposing the private key object, keeping
     * key custody inside this module.
     *
     * @returns Lowercase hex of the raw Ed25519 public key.
     */
    phase2PublicKeyHex(): string {
      if (!phase2PublicVerifyKey) {
        throw new Error('initDaemonIdentity() must be called before phase2PublicKeyHex()');
      }
      const der = phase2PublicVerifyKey.export({ type: 'spki', format: 'der' }) as Buffer;
      // The raw Ed25519 key is the last 32 bytes of the SPKI DER (RFC 8410).
      return der.subarray(-32).toString('hex');
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
