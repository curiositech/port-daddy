/**
 * Unit tests for lib/actor-souls.ts — ADR-0040 daemon-minted actor identity.
 *
 * Proves the three keystone properties:
 *   (a) a minted id verifies against its credential;
 *   (b) a self-asserted / forged / mismatched credential is REJECTED (never mints);
 *   (c) the exhaustive register() outcome table + fail-mode semantics hold;
 *   plus the grandfather migration maps existing ids forward losslessly.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir as _osTmp } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { migrateActorSouls } from '../../scripts/migrate-actor-souls.js';

// CLAUDE.md hard rule: never scratch to /tmp. Use ~/coding/tmp.
function scratchDir(prefix) {
  const base = join(homedir(), 'coding', 'tmp');
  try { require('node:fs').mkdirSync(base, { recursive: true }); } catch { /* ok */ }
  return mkdtempSync(join(base, prefix));
}

describe('actor-souls: mint + verify (property a)', () => {
  let db, souls;
  beforeEach(() => { db = createTestDb(); souls = createActorSouls(db); });
  afterEach(() => db.close());

  test('a minted credential verifies back to the same actor_id', () => {
    const { actorId, credential } = souls.mint({ alias: 'proj:stack:ctx' });
    expect(actorId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID (Crockford base32)
    expect(credential.startsWith(`${actorId}.`)).toBe(true);

    const verified = souls.verifyCredential(credential);
    expect(verified).toBe(actorId);
  });

  test('the credential is a selector.verifier lookup token (O(1) by selector)', () => {
    const a = souls.mint();
    const b = souls.mint();
    // Each verifies only to its own id.
    expect(souls.verifyCredential(a.credential)).toBe(a.actorId);
    expect(souls.verifyCredential(b.credential)).toBe(b.actorId);
    expect(a.actorId).not.toBe(b.actorId);
  });
});

describe('actor-souls: forged / self-asserted rejection (property b)', () => {
  let db, souls;
  beforeEach(() => { db = createTestDb(); souls = createActorSouls(db); });
  afterEach(() => db.close());

  test('a mismatched verifier for a REAL selector is rejected', () => {
    const { actorId } = souls.mint();
    expect(souls.verifyCredential(`${actorId}.not-the-secret`)).toBeNull();
  });

  test('an unknown selector (self-asserted id) is rejected', () => {
    expect(souls.verifyCredential('01SELFASSERTEDFORGEDID00000.anything')).toBeNull();
  });

  test('a malformed credential is rejected', () => {
    expect(souls.verifyCredential('no-dot-here')).toBeNull();
    expect(souls.verifyCredential('.leadingdot')).toBeNull();
    expect(souls.verifyCredential('trailingdot.')).toBeNull();
  });

  test('register() with an invalid credential rejects 401 and mints NOTHING', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM actor_souls').get().n;
    const out = souls.register({ credential: 'unknownid.secret' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('CREDENTIAL_INVALID');
    expect(out.httpStatus).toBe(401);
    const after = db.prepare('SELECT COUNT(*) AS n FROM actor_souls').get().n;
    expect(after).toBe(before); // never mint from a failed credential
  });
});

describe('actor-souls: register() outcome table (property c)', () => {
  let db, souls;
  beforeEach(() => {
    db = createTestDb();
    souls = createActorSouls(db, { operatorSecret: 'operator-shibboleth', newcomerAdmitMax: 3 });
  });
  afterEach(() => db.close());

  test('unknown alias, no credential ⇒ mints a fresh newcomer + returns credential once', () => {
    const out = souls.register({ alias: 'proj:stack:new' });
    expect(out.ok && out.status).toBe('minted');
    expect(out.soulClass).toBe('newcomer');
    expect(typeof out.credential).toBe('string');
    // Re-presenting the issued credential is idempotent → same id, resolved.
    const again = souls.register({ credential: out.credential });
    expect(again.ok && again.status).toBe('resolved');
    expect(again.actorId).toBe(out.actorId);
  });

  test('known alias WITHOUT credential fails closed to a NEW newcomer (F2 impersonation guard)', () => {
    const first = souls.register({ alias: 'proj:stack:shared' });
    const second = souls.register({ alias: 'proj:stack:shared' });
    expect(first.actorId).not.toBe(second.actorId); // never resolves to the existing id
    expect(second.soulClass).toBe('newcomer');
  });

  test('valid operatorToken ⇒ mints operator-trusted, skipping the newcomer pool', () => {
    const out = souls.register({ operatorToken: 'operator-shibboleth', alias: 'proj:stack:op' });
    expect(out.ok && out.status).toBe('minted');
    expect(out.soulClass).toBe('operator');
    expect(souls.classify(out.actorId)).toBe('operator');
  });

  test('a wrong operatorToken falls through to a plain newcomer (advisory-above-floor)', () => {
    const out = souls.register({ operatorToken: 'wrong', alias: 'proj:stack:notop' });
    expect(out.ok && out.soulClass).toBe('newcomer');
  });

  test('admission rate-limit rejects 429 past newcomerAdmitMax per project/day', () => {
    const day = '2026-07-15';
    for (let i = 0; i < 3; i++) {
      const ok = souls.register({ alias: `p:s:${i}`, project: 'proj', day });
      expect(ok.ok).toBe(true);
    }
    const over = souls.register({ alias: 'p:s:overflow', project: 'proj', day });
    expect(over.ok).toBe(false);
    expect(over.code).toBe('NEWCOMER_ADMIT_LIMIT');
    expect(over.httpStatus).toBe(429);
  });
});

describe('actor-souls: graduation on clean exits', () => {
  let db, souls;
  beforeEach(() => { db = createTestDb(); souls = createActorSouls(db, { graduationThreshold: 3 }); });
  afterEach(() => db.close());

  test('a newcomer graduates only after THRESHOLD daemon-witnessed clean exits', () => {
    const { actorId } = souls.mint();
    expect(souls.classify(actorId)).toBe('newcomer');
    souls.recordCleanExit(actorId);
    souls.recordCleanExit(actorId);
    expect(souls.classify(actorId)).toBe('newcomer'); // 2 < 3
    souls.recordCleanExit(actorId);
    expect(souls.classify(actorId)).toBe('graduated'); // 3 >= 3
  });
});

describe('actor-souls: grandfather migration (§7, lossless + idempotent)', () => {
  let db, credDir;
  beforeEach(() => {
    db = createTestDb();
    // Seed historical self-asserted principals across ledger/escrow/agents.
    db.prepare(`CREATE TABLE IF NOT EXISTS budget_ledger (
      project TEXT, agent_id TEXT, day TEXT, spend_usd REAL, cancel_armed_at INTEGER,
      PRIMARY KEY (project, agent_id, day))`).run();
    db.prepare(`INSERT INTO budget_ledger VALUES ('p','legacy-qa','2026-07-15',0.5,NULL)`).run();
    db.prepare(`CREATE TABLE IF NOT EXISTS bond_escrow (
      id TEXT, project TEXT, agent_id TEXT, archetype TEXT, bond_usd REAL, state TEXT, escrowed_at INTEGER)`).run();
    db.prepare(`INSERT INTO bond_escrow VALUES ('b1','p','legacy-spider','x',0.1,'refunded',1)`).run();
    // agents table already exists in setup-unit schema (registered_at/last_heartbeat,
    // not created_at/last_seen — current main's agents schema).
    db.prepare(`INSERT INTO agents (id, registered_at, last_heartbeat) VALUES ('legacy-gardener', 1, 1)`).run();
    credDir = scratchDir('actor-souls-mig-');
  });
  afterEach(() => { db.close(); rmSync(credDir, { recursive: true, force: true }); });

  test('dry-run reports principals but writes nothing', () => {
    const res = migrateActorSouls(db, { apply: false, credentialsDir: credDir });
    expect(res.scanned).toBe(3);
    const souls = createActorSouls(db);
    expect(souls.getSoul('legacy-qa')).toBeNull(); // nothing minted in dry-run
  });

  test('apply mints identity-mapped, credentialed, operator-trusted souls (no ledger rewrite)', () => {
    const res = migrateActorSouls(db, { apply: true, credentialsDir: credDir });
    expect(res.minted).toBe(3);

    const souls = createActorSouls(db);
    for (const id of ['legacy-qa', 'legacy-spider', 'legacy-gardener']) {
      const soul = souls.getSoul(id);
      expect(soul).not.toBeNull();
      expect(soul.actorId).toBe(id);          // identity mapping — PK unchanged
      expect(soul.credentialKind).toBe('migrated');
      expect(soul.operatorTrusted).toBe(true); // trusted-by-history, not throttled
      // A real credential file was delivered 0600 and re-authenticates the id.
      const credPath = join(credDir, `${encodeURIComponent(id)}.cred`);
      expect(existsSync(credPath)).toBe(true);
      const cred = readFileSync(credPath, 'utf8');
      expect(souls.verifyCredential(cred)).toBe(id);
    }
    // Ledger row untouched (lossless).
    const row = db.prepare(`SELECT spend_usd FROM budget_ledger WHERE agent_id='legacy-qa'`).get();
    expect(row.spend_usd).toBe(0.5);
  });

  test('re-running apply is idempotent (skips existing souls)', () => {
    migrateActorSouls(db, { apply: true, credentialsDir: credDir });
    const second = migrateActorSouls(db, { apply: true, credentialsDir: credDir });
    expect(second.minted).toBe(0);
    expect(second.skipped).toBe(3);
  });
});
