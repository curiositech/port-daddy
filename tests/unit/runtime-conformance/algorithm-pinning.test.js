/**
 * RUNTIME CONFORMANCE: ProVerif algconfusion.pv ←→ lib/harbor-tokens.ts
 *
 * Spec:    whitepaper/formal/proverif/anchor/token-verify/algconfusion.pv
 * Runtime: lib/harbor-tokens.ts:201–267
 *
 * The .pv proves: a verifier pinned to algorithm A never accepts a
 * token signed under algorithm B (modulo Dolev-Yao adversary control
 * of the channel and even leakage of the symmetric AlgB key).
 *
 * The runtime under conformance: harbor tokens have two tiers (phase1
 * legacy HS256 and phase2 EdDSA). Each tier's verify path explicitly
 * pins its expected algorithm via:
 *   - detectHarborCardVersion() — header.alg + header.kid + payload.hv
 *     must match exactly one tier
 *   - jwtVerify(..., { algorithms: [<pinned>] }) — jose-level pinning
 *
 * This file exercises four attack patterns from algconfusion.pv's
 * naive-verifier counter-trace, applied to the real lib code:
 *
 *   (P1) phase2 token with header tampered alg → HS256
 *   (P2) phase1 token with header tampered alg → EdDSA
 *   (P3) cross-tier attack: HS256-signed token rebadged as
 *        alg=EdDSA + kid=PHASE2_KEY_ID
 *   (P4) cross-tier attack: EdDSA-signed token rebadged as
 *        alg=HS256 + kid=undefined
 *   (P5) classic alg=none — must reject in either tier
 *
 * Each pattern MUST cause both verify methods to return null.
 *
 * If this test fails, the runtime has drifted from the spec — the
 * algconfusion.pv proof no longer applies to lib/harbor-tokens.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { randomBytes, createSecretKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { createTestDb } from '../../setup-unit.js';
import {
  createHarborTokens,
  HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID,
  HARBOR_TOKEN_PHASE2_KEY_ID,
  HARBOR_TOKEN_PHASE2_VERSION,
} from '../../../lib/harbor-tokens.js';

function replaceHeader(token, header) {
  const parts = token.split('.');
  parts[0] = Buffer.from(JSON.stringify(header)).toString('base64url');
  return parts.join('.');
}

function decodeHeader(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
}

async function issuePhase1Legacy(db, opts) {
  const row = db
    .prepare('SELECT key_hex FROM daemon_keys WHERE id = ?')
    .get(HARBOR_TOKEN_PHASE1_LEGACY_KEY_ID);
  const signingKey = createSecretKey(Buffer.from(row.key_hex, 'hex'));
  const now = Date.now();
  const jti = randomBytes(16).toString('hex');
  db.prepare(
    'INSERT INTO harbor_issued_tokens (jti, agent_id, harbor_name, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(jti, opts.agentId, opts.harborName, now, now + 3_600_000);
  return new SignJWT({ cap: opts.capabilities ?? [], lhb: now })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.agentId)
    .setAudience(opts.harborName)
    .setIssuer('port-daddy')
    .setJti(jti)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + 3_600_000) / 1000))
    .sign(signingKey);
}

describe('runtime conformance: algorithm pinning (algconfusion.pv ↔ harbor-tokens.ts)', () => {
  let db;
  let ht;
  const harbor = 'conformance:harbor';
  const agent = 'conformance:agent';

  beforeEach(async () => {
    db = createTestDb();
    ht = createHarborTokens(db);
    await ht.initDaemonIdentity();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('P1: phase2 token with header tampered alg=HS256 is rejected', async () => {
    const token = await ht.issueHarborCard({
      agentId: agent,
      harborName: harbor,
      capabilities: [],
      lastHeartbeat: Date.now(),
    });
    expect(decodeHeader(token).alg).toBe('EdDSA');

    const tampered = replaceHeader(token, {
      alg: 'HS256',
      kid: HARBOR_TOKEN_PHASE2_KEY_ID,
      typ: 'JWT',
    });

    // detectHarborCardVersion must NOT classify this as phase2 (alg
    // mismatch) or phase1 (kid present, hv present).
    expect(ht.detectHarborCardVersion(tampered)).toBeNull();
    expect(await ht.verifyHarborCard(tampered, harbor)).toBeNull();
    expect(await ht.verifyLegacyPhase1HarborCard(tampered, harbor)).toBeNull();
  });

  it('P2: phase1 token with header tampered alg=EdDSA is rejected', async () => {
    const token = await issuePhase1Legacy(db, {
      agentId: agent,
      harborName: harbor,
    });
    expect(decodeHeader(token).alg).toBe('HS256');

    const tampered = replaceHeader(token, { alg: 'EdDSA' });

    expect(ht.detectHarborCardVersion(tampered)).toBeNull();
    expect(await ht.verifyHarborCard(tampered, harbor)).toBeNull();
    expect(await ht.verifyLegacyPhase1HarborCard(tampered, harbor)).toBeNull();
  });

  it('P3: HS256-signed token rebadged as EdDSA+phase2-kid is rejected', async () => {
    // Build a phase1 HS256 token (the attacker has its key by virtue
    // of "knowing kB" in the .pv model) and rewrite the header to
    // claim phase2.
    const token = await issuePhase1Legacy(db, {
      agentId: agent,
      harborName: harbor,
    });

    const tampered = replaceHeader(token, {
      alg: 'EdDSA',
      kid: HARBOR_TOKEN_PHASE2_KEY_ID,
      typ: 'JWT',
    });

    // detectHarborCardVersion routes by (alg, kid, hv). hv is absent
    // in phase1 payload → phase2 classification fails (hv mismatch).
    expect(ht.detectHarborCardVersion(tampered)).toBeNull();
    expect(await ht.verifyHarborCard(tampered, harbor)).toBeNull();
    expect(await ht.verifyLegacyPhase1HarborCard(tampered, harbor)).toBeNull();
  });

  it('P4: EdDSA-signed token rebadged as HS256 (no kid) is rejected', async () => {
    const token = await ht.issueHarborCard({
      agentId: agent,
      harborName: harbor,
      capabilities: [],
      lastHeartbeat: Date.now(),
    });

    const tampered = replaceHeader(token, { alg: 'HS256' });

    // Phase1 detection requires hv === undefined; phase2 token has
    // hv: 2 → phase1 classification fails. Even if classification
    // somehow passed, the HS256 signature check against a EdDSA-signed
    // payload would fail.
    expect(ht.detectHarborCardVersion(tampered)).toBeNull();
    expect(await ht.verifyHarborCard(tampered, harbor)).toBeNull();
    expect(await ht.verifyLegacyPhase1HarborCard(tampered, harbor)).toBeNull();
  });

  it('P5: alg=none classic attack is rejected on both tiers', async () => {
    const fakePayload = {
      sub: agent,
      aud: harbor,
      iss: 'port-daddy',
      jti: randomBytes(16).toString('hex'),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 3_600_000) / 1000),
      cap: ['code:read', 'notes:write'],
      hv: HARBOR_TOKEN_PHASE2_VERSION,
    };
    const algNone = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify(fakePayload)).toString('base64url'),
      '',
    ].join('.');

    expect(ht.detectHarborCardVersion(algNone)).toBeNull();
    expect(await ht.verifyHarborCard(algNone, harbor)).toBeNull();
    expect(await ht.verifyLegacyPhase1HarborCard(algNone, harbor)).toBeNull();
  });

  it('control: a properly issued phase2 token verifies (sanity)', async () => {
    const token = await ht.issueHarborCard({
      agentId: agent,
      harborName: harbor,
      capabilities: ['ok'],
      lastHeartbeat: Date.now(),
    });
    const result = await ht.verifyHarborCard(token, harbor);
    expect(result).not.toBeNull();
    expect(result.sub).toBe(agent);
  });

  it('control: a properly issued phase1 token verifies on phase1 path only', async () => {
    const token = await issuePhase1Legacy(db, { agentId: agent, harborName: harbor });
    expect(await ht.verifyLegacyPhase1HarborCard(token, harbor)).not.toBeNull();
    // And NOT on phase2 path — this is positive evidence of pinning.
    expect(await ht.verifyHarborCard(token, harbor)).toBeNull();
  });
});
