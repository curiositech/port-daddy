/**
 * Unit Tests for Harbor Tokens Module (harbor-tokens.ts)
 *
 * TDD — ALL TESTS WRITTEN BEFORE ANY IMPLEMENTATION.
 * These tests define the contract. Run first: expect all to fail.
 *
 * Covers:
 *   - Schema: daemon_keys, harbor_issued_tokens, harbor_token_revocations
 *   - initDaemonIdentity(): key generation + idempotency
 *   - issueHarborCard(): JWT structure, claims, JTI-first DB write
 *   - verifyHarborCard(): happy path, expired, revoked, wrong harbor, tampered
 *   - revokeHarborCardsForAgent(): bulk revocation on agent death
 *   - cleanupExpiredRevocations(): JTI reaper
 *   - Constants: LHB_TOLERANCE_MS, DEFAULT_TOKEN_TTL_MS
 *   - Adversarial: alg:none, algorithm confusion, key substitution, claim tampering
 *
 * Security requirements (from council review, 2026-03-10):
 *   - Algorithm MUST be pinned to HS256 in every jwtVerify call
 *   - alg header from token MUST NOT be trusted for dispatch
 *   - JTI MUST be written to DB before JWT string is returned
 *   - lhb claim MUST be present (zombie detection)
 *   - Revoked tokens MUST return null from verifyHarborCard
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  createHarborTokens,
  LHB_TOLERANCE_MS,
  DEFAULT_TOKEN_TTL_MS,
} from '../../lib/harbor-tokens.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeAlgNoneToken(payload) {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const body = base64url(payload);
  return `${header}.${body}.`; // empty signature
}

// ─── Tests ───────────────────────────────────────────────────────────────────

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

  // ─── Constants ──────────────────────────────────────────────────────────────

  describe('exported constants', () => {
    it('exports LHB_TOLERANCE_MS as a positive number', () => {
      expect(typeof LHB_TOLERANCE_MS).toBe('number');
      expect(LHB_TOLERANCE_MS).toBeGreaterThan(0);
    });

    it('LHB_TOLERANCE_MS is 120_000 (4 × 30s heartbeat interval)', () => {
      expect(LHB_TOLERANCE_MS).toBe(120_000);
    });

    it('exports DEFAULT_TOKEN_TTL_MS as a positive number', () => {
      expect(typeof DEFAULT_TOKEN_TTL_MS).toBe('number');
      expect(DEFAULT_TOKEN_TTL_MS).toBeGreaterThan(0);
    });

    it('DEFAULT_TOKEN_TTL_MS is at least 60_000ms (1 minute)', () => {
      expect(DEFAULT_TOKEN_TTL_MS).toBeGreaterThanOrEqual(60_000);
    });
  });

  // ─── Schema ─────────────────────────────────────────────────────────────────

  describe('schema initialization', () => {
    it('creates daemon_keys table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daemon_keys'").get();
      expect(row).toBeDefined();
    });

    it('creates harbor_issued_tokens table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='harbor_issued_tokens'").get();
      expect(row).toBeDefined();
    });

    it('creates harbor_token_revocations table', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='harbor_token_revocations'").get();
      expect(row).toBeDefined();
    });

    it('creates index on harbor_issued_tokens(agent_id)', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_hit_agent'").get();
      expect(row).toBeDefined();
    });

    it('creates index on harbor_issued_tokens(expires_at)', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_hit_expires'").get();
      expect(row).toBeDefined();
    });

    it('creates index on harbor_token_revocations(agent_id)', () => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_revocations_agent'").get();
      expect(row).toBeDefined();
    });

    it('creates partial index on harbor_token_revocations(expires_at) WHERE NOT NULL', () => {
      const row = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_revocations_expires'").get();
      expect(row).toBeDefined();
      // Partial index: WHERE clause must be present in the SQL
      expect(row.sql).toMatch(/WHERE/i);
      expect(row.sql).toMatch(/expires_at\s+IS\s+NOT\s+NULL/i);
    });
  });

  // ─── initDaemonIdentity ──────────────────────────────────────────────────────

  describe('initDaemonIdentity()', () => {
    it('creates a key row in daemon_keys on first call', () => {
      const row = db.prepare('SELECT * FROM daemon_keys WHERE id = ?').get('singleton');
      expect(row).toBeDefined();
      expect(row.key_hex).toBeDefined();
    });

    it('stores key as 64-char hex string (32 bytes for HS256)', () => {
      const row = db.prepare('SELECT key_hex FROM daemon_keys WHERE id = ?').get('singleton');
      expect(typeof row.key_hex).toBe('string');
      expect(row.key_hex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is idempotent — second call does not change the key', async () => {
      const firstRow = db.prepare('SELECT key_hex FROM daemon_keys WHERE id = ?').get('singleton');
      await ht.initDaemonIdentity(); // second call
      const secondRow = db.prepare('SELECT key_hex FROM daemon_keys WHERE id = ?').get('singleton');
      expect(secondRow.key_hex).toBe(firstRow.key_hex);
    });

    it('is idempotent — third call does not change the key', async () => {
      const firstRow = db.prepare('SELECT key_hex FROM daemon_keys WHERE id = ?').get('singleton');
      await ht.initDaemonIdentity();
      await ht.initDaemonIdentity();
      const thirdRow = db.prepare('SELECT key_hex FROM daemon_keys WHERE id = ?').get('singleton');
      expect(thirdRow.key_hex).toBe(firstRow.key_hex);
    });

    it('stores exactly one row in daemon_keys', () => {
      const rows = db.prepare('SELECT * FROM daemon_keys').all();
      expect(rows.length).toBe(1);
    });
  });

  // ─── issueHarborCard ────────────────────────────────────────────────────────

  describe('issueHarborCard()', () => {
    const defaults = {
      agentId: 'agent-test-1',
      harborName: 'myapp:security-review',
      capabilities: ['code:read', 'notes:write'],
      lastHeartbeat: Date.now(),
    };

    it('returns a JWT string (three base64url segments)', async () => {
      const token = await ht.issueHarborCard(defaults);
      expect(typeof token).toBe('string');
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });

    it('JWT header declares alg:HS256', async () => {
      const token = await ht.issueHarborCard(defaults);
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('HS256');
    });

    it('JWT payload contains sub = agentId', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.sub).toBe(defaults.agentId);
    });

    it('JWT payload contains aud = harborName', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.aud).toBe(defaults.harborName);
    });

    it('JWT payload contains iss = "port-daddy"', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.iss).toBe('port-daddy');
    });

    it('JWT payload contains cap array with declared capabilities', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.cap).toEqual(defaults.capabilities);
    });

    it('JWT payload contains lhb = lastHeartbeat', async () => {
      const lhb = Date.now();
      const token = await ht.issueHarborCard({ ...defaults, lastHeartbeat: lhb });
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.lhb).toBe(lhb);
    });

    it('JWT payload contains jti (unique token ID)', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(typeof payload.jti).toBe('string');
      expect(payload.jti.length).toBeGreaterThan(0);
    });

    it('JWT payload jti is unique across two calls', async () => {
      const t1 = await ht.issueHarborCard(defaults);
      const t2 = await ht.issueHarborCard(defaults);
      const jti1 = JSON.parse(Buffer.from(t1.split('.')[1], 'base64url').toString()).jti;
      const jti2 = JSON.parse(Buffer.from(t2.split('.')[1], 'base64url').toString()).jti;
      expect(jti1).not.toBe(jti2);
    });

    it('JWT payload exp is in the future', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('JWT payload exp defaults to DEFAULT_TOKEN_TTL_MS from now', async () => {
      const before = Date.now();
      const token = await ht.issueHarborCard(defaults);
      const after = Date.now();
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const expectedMinExp = Math.floor((before + DEFAULT_TOKEN_TTL_MS) / 1000);
      const expectedMaxExp = Math.floor((after + DEFAULT_TOKEN_TTL_MS) / 1000);
      expect(payload.exp).toBeGreaterThanOrEqual(expectedMinExp);
      expect(payload.exp).toBeLessThanOrEqual(expectedMaxExp + 1);
    });

    it('JWT payload exp respects custom ttlMs', async () => {
      const customTtl = 60_000; // 1 minute
      const before = Date.now();
      const token = await ht.issueHarborCard({ ...defaults, ttlMs: customTtl });
      const after = Date.now();
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const expectedMinExp = Math.floor((before + customTtl) / 1000);
      const expectedMaxExp = Math.floor((after + customTtl) / 1000);
      expect(payload.exp).toBeGreaterThanOrEqual(expectedMinExp);
      expect(payload.exp).toBeLessThanOrEqual(expectedMaxExp + 1);
    });

    // CRITICAL: JTI must be stored in DB BEFORE token string is returned
    it('JTI is persisted in harbor_issued_tokens before function returns', async () => {
      const token = await ht.issueHarborCard(defaults);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const jti = payload.jti;
      const row = db.prepare('SELECT * FROM harbor_issued_tokens WHERE jti = ?').get(jti);
      expect(row).toBeDefined();
      expect(row.agent_id).toBe(defaults.agentId);
      expect(row.harbor_name).toBe(defaults.harborName);
    });

    it('harbor_issued_tokens row stores correct expires_at (within 2s tolerance)', async () => {
      const before = Date.now();
      const token = await ht.issueHarborCard(defaults);
      const after = Date.now();
      const jti = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti;
      const row = db.prepare('SELECT expires_at FROM harbor_issued_tokens WHERE jti = ?').get(jti);
      expect(row.expires_at).toBeGreaterThanOrEqual(before + DEFAULT_TOKEN_TTL_MS - 1000);
      expect(row.expires_at).toBeLessThanOrEqual(after + DEFAULT_TOKEN_TTL_MS + 1000);
    });

    it('throws if initDaemonIdentity() was not called', async () => {
      const freshDb = createTestDb();
      const freshHt = createHarborTokens(freshDb);
      // Do NOT call initDaemonIdentity
      await expect(freshHt.issueHarborCard(defaults)).rejects.toThrow();
      freshDb.close();
    });
  });

  // ─── verifyHarborCard ────────────────────────────────────────────────────────

  describe('verifyHarborCard()', () => {
    const defaults = {
      agentId: 'agent-verify-1',
      harborName: 'myapp:verify-harbor',
      capabilities: ['code:read'],
      lastHeartbeat: Date.now(),
    };

    it('returns payload for a valid token', async () => {
      const token = await ht.issueHarborCard(defaults);
      const result = await ht.verifyHarborCard(token, defaults.harborName);
      expect(result).not.toBeNull();
      expect(result.sub).toBe(defaults.agentId);
    });

    it('returns capability list in payload', async () => {
      const token = await ht.issueHarborCard(defaults);
      const result = await ht.verifyHarborCard(token, defaults.harborName);
      expect(result.cap).toEqual(defaults.capabilities);
    });

    it('returns lhb in payload', async () => {
      const lhb = Date.now();
      const token = await ht.issueHarborCard({ ...defaults, lastHeartbeat: lhb });
      const result = await ht.verifyHarborCard(token, defaults.harborName);
      expect(result.lhb).toBe(lhb);
    });

    it('returns null for a token targeting a different harbor (audience mismatch)', async () => {
      const token = await ht.issueHarborCard(defaults);
      const result = await ht.verifyHarborCard(token, 'different:harbor');
      expect(result).toBeNull();
    });

    it('returns null for a tampered token (signature invalid)', async () => {
      const token = await ht.issueHarborCard(defaults);
      // Flip last 4 chars of signature to break it
      const parts = token.split('.');
      parts[2] = parts[2].slice(0, -4) + 'XXXX';
      const tampered = parts.join('.');
      const result = await ht.verifyHarborCard(tampered, defaults.harborName);
      expect(result).toBeNull();
    });

    it('returns null for a token with tampered payload (cap changed)', async () => {
      const token = await ht.issueHarborCard(defaults);
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.cap = ['ADMIN', 'root:write'];
      parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tampered = parts.join('.');
      const result = await ht.verifyHarborCard(tampered, defaults.harborName);
      expect(result).toBeNull();
    });

    it('returns null for an expired token', async () => {
      // Issue token with 1ms TTL so it expires immediately
      const token = await ht.issueHarborCard({ ...defaults, ttlMs: 1 });
      // Wait 10ms to ensure expiry
      await new Promise(r => setTimeout(r, 10));
      const result = await ht.verifyHarborCard(token, defaults.harborName);
      expect(result).toBeNull();
    });

    it('returns null for a revoked token', async () => {
      const token = await ht.issueHarborCard(defaults);
      ht.revokeHarborCardsForAgent(defaults.agentId);
      const result = await ht.verifyHarborCard(token, defaults.harborName);
      expect(result).toBeNull();
    });

    it('returns null for a completely invalid string', async () => {
      const result = await ht.verifyHarborCard('not.a.jwt', defaults.harborName);
      expect(result).toBeNull();
    });

    it('returns null for empty string', async () => {
      const result = await ht.verifyHarborCard('', defaults.harborName);
      expect(result).toBeNull();
    });

    it('verifies without expectedHarbor when not provided', async () => {
      const token = await ht.issueHarborCard(defaults);
      // No expectedHarbor — should still return a result (audience not checked)
      const result = await ht.verifyHarborCard(token);
      expect(result).not.toBeNull();
    });
  });

  // ─── revokeHarborCardsForAgent ───────────────────────────────────────────────

  describe('revokeHarborCardsForAgent()', () => {
    it('moves all agent tokens to revocations table', async () => {
      const agentId = 'agent-to-revoke';
      await ht.issueHarborCard({ agentId, harborName: 'harbor-1', capabilities: [], lastHeartbeat: Date.now() });
      await ht.issueHarborCard({ agentId, harborName: 'harbor-2', capabilities: [], lastHeartbeat: Date.now() });

      ht.revokeHarborCardsForAgent(agentId);

      const revocations = db.prepare('SELECT * FROM harbor_token_revocations WHERE agent_id = ?').all(agentId);
      expect(revocations.length).toBe(2);
    });

    it('revoked token fails verification immediately', async () => {
      const agentId = 'agent-revoked-verify';
      const token = await ht.issueHarborCard({
        agentId, harborName: 'myapp:test', capabilities: ['code:read'], lastHeartbeat: Date.now(),
      });

      ht.revokeHarborCardsForAgent(agentId);

      const result = await ht.verifyHarborCard(token, 'myapp:test');
      expect(result).toBeNull();
    });

    it('returns the count of revoked tokens', async () => {
      const agentId = 'agent-count-revoked';
      await ht.issueHarborCard({ agentId, harborName: 'h1', capabilities: [], lastHeartbeat: Date.now() });
      await ht.issueHarborCard({ agentId, harborName: 'h2', capabilities: [], lastHeartbeat: Date.now() });
      await ht.issueHarborCard({ agentId, harborName: 'h3', capabilities: [], lastHeartbeat: Date.now() });

      const count = ht.revokeHarborCardsForAgent(agentId);
      expect(count).toBe(3);
    });

    it('returns 0 for an agent with no issued tokens', () => {
      const count = ht.revokeHarborCardsForAgent('nobody');
      expect(count).toBe(0);
    });

    it('does not affect other agents tokens', async () => {
      const agentA = 'agent-a';
      const agentB = 'agent-b';
      const harbor = 'shared:harbor';

      const tokenB = await ht.issueHarborCard({ agentId: agentB, harborName: harbor, capabilities: [], lastHeartbeat: Date.now() });
      await ht.issueHarborCard({ agentId: agentA, harborName: harbor, capabilities: [], lastHeartbeat: Date.now() });

      ht.revokeHarborCardsForAgent(agentA);

      // Agent B's token should still be valid
      const result = await ht.verifyHarborCard(tokenB, harbor);
      expect(result).not.toBeNull();
    });

    it('revocation row stores the original expires_at', async () => {
      const agentId = 'agent-expiry-test';
      const ttlMs = 600_000;
      const before = Date.now();
      const token = await ht.issueHarborCard({
        agentId, harborName: 'h1', capabilities: [], lastHeartbeat: Date.now(), ttlMs,
      });
      const after = Date.now();
      const jti = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti;

      ht.revokeHarborCardsForAgent(agentId);

      const rev = db.prepare('SELECT * FROM harbor_token_revocations WHERE jti = ?').get(jti);
      expect(rev).toBeDefined();
      expect(rev.expires_at).toBeGreaterThanOrEqual(before + ttlMs - 1000);
      expect(rev.expires_at).toBeLessThanOrEqual(after + ttlMs + 1000);
    });
  });

  // ─── cleanupExpiredRevocations ────────────────────────────────────────────────

  describe('cleanupExpiredRevocations()', () => {
    it('returns 0 when no expired revocations exist', () => {
      const count = ht.cleanupExpiredRevocations();
      expect(count).toBe(0);
    });

    it('deletes expired revocation entries and returns count', async () => {
      const agentId = 'agent-cleanup';
      // Issue token with 1ms TTL so revocation row expires immediately
      await ht.issueHarborCard({ agentId, harborName: 'h1', capabilities: [], lastHeartbeat: Date.now(), ttlMs: 1 });
      ht.revokeHarborCardsForAgent(agentId);

      await new Promise(r => setTimeout(r, 10)); // let expires_at pass
      const count = ht.cleanupExpiredRevocations();
      expect(count).toBe(1);
    });

    it('does not delete non-expired revocations', async () => {
      const agentId = 'agent-cleanup-2';
      // Long TTL — revocation row will not expire during test
      await ht.issueHarborCard({ agentId, harborName: 'h1', capabilities: [], lastHeartbeat: Date.now(), ttlMs: 3_600_000 });
      ht.revokeHarborCardsForAgent(agentId);

      const count = ht.cleanupExpiredRevocations();
      expect(count).toBe(0);

      const remaining = db.prepare('SELECT * FROM harbor_token_revocations WHERE agent_id = ?').all(agentId);
      expect(remaining.length).toBe(1);
    });

    it('correctly handles mix of expired and non-expired entries', async () => {
      const agentA = 'cleanup-agent-a';
      const agentB = 'cleanup-agent-b';
      await ht.issueHarborCard({ agentId: agentA, harborName: 'h1', capabilities: [], lastHeartbeat: Date.now(), ttlMs: 1 });
      await ht.issueHarborCard({ agentId: agentB, harborName: 'h1', capabilities: [], lastHeartbeat: Date.now(), ttlMs: 3_600_000 });
      ht.revokeHarborCardsForAgent(agentA);
      ht.revokeHarborCardsForAgent(agentB);

      await new Promise(r => setTimeout(r, 10)); // agentA's row expires
      const count = ht.cleanupExpiredRevocations();
      expect(count).toBe(1);

      // agentB's row should remain
      const remaining = db.prepare('SELECT * FROM harbor_token_revocations WHERE agent_id = ?').all(agentB);
      expect(remaining.length).toBe(1);
    });
  });

  // ─── Adversarial / Security Tests ────────────────────────────────────────────

  describe('adversarial: algorithm attacks', () => {
    const victim = {
      agentId: 'victim-agent',
      harborName: 'secure:harbor',
      capabilities: ['read'],
      lastHeartbeat: Date.now(),
    };

    it('rejects alg:none token (classic JWT bypass)', async () => {
      const fakePayload = {
        sub: victim.agentId,
        aud: victim.harborName,
        iss: 'port-daddy',
        jti: 'fake-jti-none',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        lhb: Date.now(),
        cap: ['ADMIN', 'root:*'],
      };
      const noneToken = makeAlgNoneToken(fakePayload);
      const result = await ht.verifyHarborCard(noneToken, victim.harborName);
      expect(result).toBeNull();
    });

    it('rejects alg:none token with uppercase ALG:NONE', async () => {
      const header = base64url({ ALG: 'NONE', typ: 'JWT' });
      const body = base64url({ sub: victim.agentId, aud: victim.harborName, iss: 'port-daddy', jti: 'x', exp: 9999999999, iat: 1, lhb: 1, cap: [] });
      const token = `${header}.${body}.`;
      const result = await ht.verifyHarborCard(token, victim.harborName);
      expect(result).toBeNull();
    });

    it('rejects token signed by a different HMAC key', async () => {
      // Stand up a second harbor-tokens with a completely fresh DB (different key)
      const otherDb = createTestDb();
      const otherHt = createHarborTokens(otherDb);
      await otherHt.initDaemonIdentity();

      const evilToken = await otherHt.issueHarborCard({
        agentId: victim.agentId,
        harborName: victim.harborName,
        capabilities: ['ADMIN', 'root:*'],
        lastHeartbeat: Date.now(),
      });

      otherDb.close();

      // Our verifier should reject a token signed by a different key
      const result = await ht.verifyHarborCard(evilToken, victim.harborName);
      expect(result).toBeNull();
    });

    it('rejects token with forged admin capabilities (payload tampered)', async () => {
      const token = await ht.issueHarborCard(victim);
      const [h, p, s] = token.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      payload.cap = ['ADMIN', 'root:*'];
      const tamperedToken = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
      const result = await ht.verifyHarborCard(tamperedToken, victim.harborName);
      expect(result).toBeNull();
    });

    it('rejects token where iss was changed to a trusted issuer name (iss spoofing)', async () => {
      const token = await ht.issueHarborCard(victim);
      const [h, p, s] = token.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      payload.iss = 'port-daddy'; // Already correct, but changing sub to escalate
      payload.sub = 'SYSTEM';
      const tamperedToken = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
      const result = await ht.verifyHarborCard(tamperedToken, victim.harborName);
      expect(result).toBeNull();
    });

    it('rejects token with extended expiry (exp tampered)', async () => {
      const token = await ht.issueHarborCard({ ...victim, ttlMs: 1 }); // expires in 1ms
      await new Promise(r => setTimeout(r, 10));
      // Attempt to manually extend exp
      const [h, p, s] = token.split('.');
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
      payload.exp = Math.floor(Date.now() / 1000) + 86400; // 1 day
      const tamperedToken = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
      const result = await ht.verifyHarborCard(tamperedToken, victim.harborName);
      expect(result).toBeNull();
    });

    it('rejects token with mismatched audience even with valid signature', async () => {
      const token = await ht.issueHarborCard(victim);
      // Token was issued for 'secure:harbor' — reject if audience says something else
      const result = await ht.verifyHarborCard(token, 'evil:harbor');
      expect(result).toBeNull();
    });

    it('prevents replay after revocation: cannot re-use a valid token after agent is revoked', async () => {
      const token = await ht.issueHarborCard(victim);

      // Confirm it was valid
      const before = await ht.verifyHarborCard(token, victim.harborName);
      expect(before).not.toBeNull();

      // Agent dies — tokens revoked
      ht.revokeHarborCardsForAgent(victim.agentId);

      // Replay attempt must fail
      const after = await ht.verifyHarborCard(token, victim.harborName);
      expect(after).toBeNull();
    });
  });
});
