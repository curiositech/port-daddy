import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { randomBytes, createSecretKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { createTestDb } from '../setup-unit.js';
import {
  createHarborTokens,
  DEFAULT_TOKEN_TTL_MS,
  HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID,
  HARBOR_TOKEN_PHASE2_KEY_ID,
  HARBOR_TOKEN_PHASE2_VERSION,
  LHB_TOLERANCE_MS,
} from '../../lib/harbor-tokens.js';

function decodeHeader(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

function replaceHeader(token, header) {
  const parts = token.split('.');
  parts[0] = Buffer.from(JSON.stringify(header)).toString('base64url');
  return parts.join('.');
}

function replacePayload(token, payload) {
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return parts.join('.');
}

function tamperSignature(token) {
  const parts = token.split('.');
  const replacement = parts[2][0] === 'A' ? 'B' : 'A';
  parts[2] = `${replacement}${parts[2].slice(1)}`;
  return parts.join('.');
}

function makeAlgNoneToken(payload, header = { alg: 'none', typ: 'JWT' }) {
  return [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    '',
  ].join('.');
}

async function issueLegacyPhase1Token(db, {
  agentId,
  harborName,
  capabilities = [],
  lastHeartbeat = Date.now(),
  ttlMs = DEFAULT_TOKEN_TTL_MS,
  jti = randomBytes(16).toString('hex'),
  protectedHeader = { alg: 'HS256' },
  extraClaims = {},
}) {
  const row = db.prepare('SELECT key_hex FROM daemon_keys WHERE id = ?').get(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID);
  const signingKey = createSecretKey(Buffer.from(row.key_hex, 'hex'));
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const nowSec = Math.floor(now / 1000);
  const expSec = Math.floor(expiresAt / 1000);

  db.prepare(
    'INSERT INTO harbor_issued_tokens (jti, agent_id, harbor_name, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(jti, agentId, harborName, now, expiresAt);

  return new SignJWT({
    cap: capabilities,
    lhb: lastHeartbeat,
    ...extraClaims,
  })
    .setProtectedHeader(protectedHeader)
    .setSubject(agentId)
    .setAudience(harborName)
    .setIssuer('port-daddy')
    .setJti(jti)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(signingKey);
}

describe('Harbor Tokens Module', () => {
  let db;
  let ht;

  beforeEach(async () => {
    db = createTestDb();
    ht = createHarborTokens(db);
    await ht.initDaemonIdentity();
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('constants and identity bootstrap', () => {
    it('exports the expected public constants', () => {
      expect(LHB_TOLERANCE_MS).toBe(120_000);
      expect(DEFAULT_TOKEN_TTL_MS).toBe(3_600_000);
      expect(HARBOR_TOKEN_PHASE2_VERSION).toBe(2);
      expect(HARBOR_TOKEN_PHASE2_KEY_ID).toBe('harbor-daemon-ed25519-v1');
      expect(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID).toBe('singleton');
    });

    it('creates and preserves both signing identities', async () => {
      const legacyRow = db.prepare('SELECT * FROM daemon_keys WHERE id = ?').get(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID);
      const phase2Row = db.prepare('SELECT * FROM harbor_token_signing_keys WHERE id = ?').get(HARBOR_TOKEN_PHASE2_KEY_ID);

      expect(legacyRow.key_hex).toMatch(/^[0-9a-f]{64}$/);
      expect(phase2Row.alg).toBe('Ed25519');
      expect(phase2Row.private_key_pem).toMatch(/BEGIN PRIVATE KEY/);
      expect(phase2Row.public_key_pem).toMatch(/BEGIN PUBLIC KEY/);

      await ht.initDaemonIdentity();

      const legacyRows = db.prepare('SELECT * FROM daemon_keys').all();
      const phase2Rows = db.prepare('SELECT * FROM harbor_token_signing_keys').all();
      expect(legacyRows).toHaveLength(1);
      expect(phase2Rows).toHaveLength(1);
      expect(legacyRows[0].key_hex).toBe(legacyRow.key_hex);
      expect(phase2Rows[0].public_key_pem).toBe(phase2Row.public_key_pem);
    });

    it('verifies daemon digest signatures only with the pinned phase 2 key', async () => {
      const digest = randomBytes(32).toString('hex');
      const signature = await ht.signHex(digest);
      const changedDigest = `${(parseInt(digest.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0')}${digest.slice(2)}`;
      const changedSignature = `${(parseInt(signature.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0')}${signature.slice(2)}`;

      expect(ht.verifyHex(digest, signature)).toBe(true);
      expect(ht.verifyHex(changedDigest, signature)).toBe(false);
      expect(ht.verifyHex(digest, changedSignature)).toBe(false);
      expect(ht.verifyHex('not-hex', signature)).toBe(false);

      const otherDb = createTestDb();
      const other = createHarborTokens(otherDb);
      await other.initDaemonIdentity();
      expect(other.verifyHex(digest, signature)).toBe(false);
      otherDb.close();
    });
  });

  describe('Phase 2 issuance', () => {
    const defaults = {
      agentId: 'agent-phase2',
      harborName: 'myapp:security-review',
      capabilities: ['code:read', 'notes:write'],
      lastHeartbeat: Date.now(),
    };

    it('issues Ed25519 harbor cards with explicit Phase 2 markers', async () => {
      const token = await ht.issueHarborCard(defaults);
      const header = decodeHeader(token);
      const payload = decodePayload(token);

      expect(token.split('.')).toHaveLength(3);
      expect(header.alg).toBe('EdDSA');
      expect(header.kid).toBe(HARBOR_TOKEN_PHASE2_KEY_ID);
      expect(payload.hv).toBe(HARBOR_TOKEN_PHASE2_VERSION);
      expect(payload.sub).toBe(defaults.agentId);
      expect(payload.aud).toBe(defaults.harborName);
      expect(payload.cap).toEqual(defaults.capabilities);
      expect(payload.lhb).toBe(defaults.lastHeartbeat);
    });

    it('persists the JTI before returning the token', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = decodePayload(token);
      const row = db.prepare('SELECT * FROM harbor_issued_tokens WHERE jti = ?').get(payload.jti);

      expect(row).toBeDefined();
      expect(row.agent_id).toBe(defaults.agentId);
      expect(row.harbor_name).toBe(defaults.harborName);
    });

    it('detects newly issued cards as phase2', async () => {
      const token = await ht.issueHarborCard(defaults);
      expect(ht.detectHarborCardVersion(token)).toBe('phase2');
    });

    it('throws if initDaemonIdentity() was not called', async () => {
      const freshDb = createTestDb();
      const freshHt = createHarborTokens(freshDb);

      await expect(freshHt.issueHarborCard(defaults)).rejects.toThrow(
        'initDaemonIdentity() must be called before issueHarborCard()',
      );

      freshDb.close();
    });
  });

  describe('Phase 2 verification', () => {
    const defaults = {
      agentId: 'agent-verify-phase2',
      harborName: 'myapp:phase2-verify',
      capabilities: ['deploy'],
      lastHeartbeat: Date.now(),
    };

    it('verifies a valid Phase 2 token', async () => {
      const token = await ht.issueHarborCard(defaults);
      const result = await ht.verifyHarborCard(token, defaults.harborName);

      expect(result).not.toBeNull();
      expect(result.sub).toBe(defaults.agentId);
      expect(result.aud).toBe(defaults.harborName);
      expect(result.cap).toEqual(defaults.capabilities);
      expect(result.hv).toBe(HARBOR_TOKEN_PHASE2_VERSION);
      expect(result.tokenVersion).toBe('phase2');
    });

    it('rejects the wrong harbor', async () => {
      const token = await ht.issueHarborCard(defaults);
      await expect(ht.verifyHarborCard(token, 'myapp:other')).resolves.toBeNull();
    });

    it('rejects a tampered payload', async () => {
      const token = await ht.issueHarborCard(defaults);
      const tampered = replacePayload(token, {
        ...decodePayload(token),
        cap: ['ADMIN', 'root:*'],
      });

      await expect(ht.verifyHarborCard(tampered, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects a tampered signature', async () => {
      const token = await ht.issueHarborCard(defaults);
      await expect(ht.verifyHarborCard(tamperSignature(token), defaults.harborName)).resolves.toBeNull();
    });

    it('rejects an expired token', async () => {
      const token = await ht.issueHarborCard({ ...defaults, ttlMs: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));
      await expect(ht.verifyHarborCard(token, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects a revoked token', async () => {
      const token = await ht.issueHarborCard(defaults);
      expect(ht.revokeHarborCardsForAgent(defaults.agentId)).toBe(1);
      await expect(ht.verifyHarborCard(token, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects alg:none', async () => {
      const noneToken = makeAlgNoneToken({
        iss: 'port-daddy',
        sub: defaults.agentId,
        aud: defaults.harborName,
        jti: 'alg-none',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        lhb: Date.now(),
        cap: ['ADMIN'],
        hv: HARBOR_TOKEN_PHASE2_VERSION,
      });

      expect(ht.detectHarborCardVersion(noneToken)).toBeNull();
      await expect(ht.verifyHarborCard(noneToken, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects algorithm-switch attempts from a Phase 2 token', async () => {
      const token = await ht.issueHarborCard(defaults);
      const tamperedHeader = replaceHeader(token, {
        ...decodeHeader(token),
        alg: 'HS256',
      });

      expect(ht.detectHarborCardVersion(tamperedHeader)).toBeNull();
      await expect(ht.verifyHarborCard(tamperedHeader, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects a valid Phase 2 token when explicitly sent through the legacy verifier', async () => {
      const token = await ht.issueHarborCard(defaults);
      await expect(ht.verifyLegacyPhase1HarborCard(token, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects a Phase 2 token signed by a different daemon identity', async () => {
      const otherDb = createTestDb();
      const otherHt = createHarborTokens(otherDb);
      await otherHt.initDaemonIdentity();
      const token = await otherHt.issueHarborCard(defaults);

      await expect(ht.verifyHarborCard(token, defaults.harborName)).resolves.toBeNull();
      otherDb.close();
    });
  });

  describe('legacy Phase 1 compatibility', () => {
    const defaults = {
      agentId: 'agent-legacy',
      harborName: 'myapp:legacy',
      capabilities: ['code:read'],
      lastHeartbeat: Date.now(),
    };

    it('verifies a legacy HS256 token only through the explicit compatibility path', async () => {
      const token = await issueLegacyPhase1Token(db, defaults);

      expect(ht.detectHarborCardVersion(token)).toBe('phase1-legacy');
      await expect(ht.verifyHarborCard(token, defaults.harborName)).resolves.toBeNull();

      const verified = await ht.verifyLegacyPhase1HarborCard(token, defaults.harborName);
      expect(verified).not.toBeNull();
      expect(verified.sub).toBe(defaults.agentId);
      expect(verified.cap).toEqual(defaults.capabilities);
      expect(verified.hv).toBeUndefined();
      expect(verified.tokenVersion).toBe('phase1-legacy');
    });

    it('rejects the wrong harbor for a legacy token', async () => {
      const token = await issueLegacyPhase1Token(db, defaults);
      await expect(ht.verifyLegacyPhase1HarborCard(token, 'myapp:other')).resolves.toBeNull();
    });

    it('rejects a tampered payload for a legacy token', async () => {
      const token = await issueLegacyPhase1Token(db, defaults);
      const tampered = replacePayload(token, {
        ...decodePayload(token),
        cap: ['root:*'],
      });

      await expect(ht.verifyLegacyPhase1HarborCard(tampered, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects a tampered signature for a legacy token', async () => {
      const token = await issueLegacyPhase1Token(db, defaults);
      await expect(ht.verifyLegacyPhase1HarborCard(tamperSignature(token), defaults.harborName)).resolves.toBeNull();
    });

    it('rejects an expired legacy token', async () => {
      const token = await issueLegacyPhase1Token(db, { ...defaults, ttlMs: 1 });
      await new Promise(resolve => setTimeout(resolve, 10));
      await expect(ht.verifyLegacyPhase1HarborCard(token, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects a revoked legacy token', async () => {
      const token = await issueLegacyPhase1Token(db, defaults);
      expect(ht.revokeHarborCardsForAgent(defaults.agentId)).toBe(1);
      await expect(ht.verifyLegacyPhase1HarborCard(token, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects alg:none for the legacy path', async () => {
      const noneToken = makeAlgNoneToken({
        iss: 'port-daddy',
        sub: defaults.agentId,
        aud: defaults.harborName,
        jti: 'legacy-none',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        lhb: Date.now(),
        cap: ['code:read'],
      });

      expect(ht.detectHarborCardVersion(noneToken)).toBeNull();
      await expect(ht.verifyLegacyPhase1HarborCard(noneToken, defaults.harborName)).resolves.toBeNull();
    });

    it('rejects HS256 tokens that try to impersonate Phase 2', async () => {
      const token = await issueLegacyPhase1Token(db, {
        ...defaults,
        protectedHeader: {
          alg: 'HS256',
          kid: HARBOR_TOKEN_PHASE2_KEY_ID,
        },
        extraClaims: {
          hv: HARBOR_TOKEN_PHASE2_VERSION,
        },
      });

      expect(ht.detectHarborCardVersion(token)).toBeNull();
      await expect(ht.verifyHarborCard(token, defaults.harborName)).resolves.toBeNull();
      await expect(ht.verifyLegacyPhase1HarborCard(token, defaults.harborName)).resolves.toBeNull();
    });
  });

  describe('mixed-version behavior and revocation bookkeeping', () => {
    it('distinguishes supported versions deterministically', async () => {
      const phase2Token = await ht.issueHarborCard({
        agentId: 'agent-mixed',
        harborName: 'myapp:mixed',
        capabilities: ['code:read'],
        lastHeartbeat: Date.now(),
      });
      const legacyToken = await issueLegacyPhase1Token(db, {
        agentId: 'agent-mixed',
        harborName: 'myapp:mixed',
        capabilities: ['code:read'],
      });

      expect(ht.detectHarborCardVersion(phase2Token)).toBe('phase2');
      expect(ht.detectHarborCardVersion(legacyToken)).toBe('phase1-legacy');
      expect(await ht.verifyHarborCard(phase2Token, 'myapp:mixed')).not.toBeNull();
      expect(await ht.verifyHarborCard(legacyToken, 'myapp:mixed')).toBeNull();
      expect(await ht.verifyLegacyPhase1HarborCard(phase2Token, 'myapp:mixed')).toBeNull();
      expect(await ht.verifyLegacyPhase1HarborCard(legacyToken, 'myapp:mixed')).not.toBeNull();
    });

    it('revokes both legacy and Phase 2 cards for the same agent', async () => {
      const phase2Token = await ht.issueHarborCard({
        agentId: 'agent-revoke-both',
        harborName: 'myapp:shared',
        capabilities: [],
        lastHeartbeat: Date.now(),
      });
      const legacyToken = await issueLegacyPhase1Token(db, {
        agentId: 'agent-revoke-both',
        harborName: 'myapp:shared',
        capabilities: [],
      });

      expect(ht.revokeHarborCardsForAgent('agent-revoke-both')).toBe(2);
      await expect(ht.verifyHarborCard(phase2Token, 'myapp:shared')).resolves.toBeNull();
      await expect(ht.verifyLegacyPhase1HarborCard(legacyToken, 'myapp:shared')).resolves.toBeNull();
    });

    it('cleans up expired revocations and leaves live ones alone', async () => {
      await ht.issueHarborCard({
        agentId: 'cleanup-phase2',
        harborName: 'myapp:cleanup',
        capabilities: [],
        lastHeartbeat: Date.now(),
        ttlMs: 1,
      });
      await issueLegacyPhase1Token(db, {
        agentId: 'cleanup-legacy',
        harborName: 'myapp:cleanup',
        capabilities: [],
        ttlMs: DEFAULT_TOKEN_TTL_MS,
      });

      ht.revokeHarborCardsForAgent('cleanup-phase2');
      ht.revokeHarborCardsForAgent('cleanup-legacy');

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(ht.cleanupExpiredRevocations()).toBe(1);

      const remaining = db.prepare('SELECT agent_id FROM harbor_token_revocations ORDER BY agent_id ASC').all();
      expect(remaining).toEqual([{ agent_id: 'cleanup-legacy' }]);
    });
  });
});
