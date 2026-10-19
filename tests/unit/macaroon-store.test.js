/**
 * Unit tests for the daemon-side macaroon grant/discharge store
 * (ADR-0053 Phase 1 integration).
 *
 * Exercises the stateful boundary: minting stashes keys in the (injected) secret
 * store and only metadata in SQLite; discharge gates on live rent facts; verify
 * loads the root key server-side; revocation kills the grant.
 */
import { describe, expect, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createMacaroonStore, InMemorySecretStore } from '../../lib/macaroon/store.js';
import { prepareForRequest } from '../../lib/macaroon/macaroon.js';

const T = 1_700_000_000_000;
const ACTOR = '01K3YR6M1WPZB8Q6V1J8K7D4MC';

const paidFacts = () => ({
  commitsSinceLastNote: 0,
  commitsTotal: 3,
  notesTotal: 3,
  claimsTotal: 1,
  commitsBehindBase: 0,
  ageMs: 60_000,
  lastSignalAgeMs: 1_000,
});

function setup() {
  const db = createTestDb();
  const secrets = new InMemorySecretStore();
  const store = createMacaroonStore(db, secrets);
  const minted = store.mintGrant({
    repoId: 'curiositech/port-daddy',
    actor: ACTOR,
    session: 'session-abc',
    expiresMs: T + 60 * 60 * 1000,
    nowMs: T,
  });
  return { db, secrets, store, minted };
}

const pushCtx = (over = {}) => ({
  op: 'push',
  repo: 'curiositech/port-daddy',
  branch: 'feat/dom-daddy-x',
  session: 'session-abc',
  nowMs: T + 5 * 60 * 1000,
  ...over,
});

describe('mintGrant — keys in the secret store, metadata in SQLite', () => {
  test('persists grant metadata but never a key column', () => {
    const { db, minted } = setup();
    const row = db
      .prepare('SELECT * FROM actor_bound_push_grants WHERE grant_id = ?')
      .get(minted.grantId);
    expect(row.session).toBe('session-abc');
    expect(row.repo).toBe('curiositech/port-daddy');
    expect(row.actor).toBe(ACTOR);
    expect(row.rent_caveat_id).toBe(minted.rentCaveatId);
    // The identifier deliberately carries a public SHA-256 commitment, so test
    // the schema rather than mistaking any 64 hex characters for secret bytes.
    expect(Object.keys(row)).not.toContain('root_key');
    expect(Object.keys(row)).not.toContain('caveat_key');
  });

  test('the returned macaroon carries no key, only caveats + a signature', () => {
    const { minted } = setup();
    expect(minted.macaroon.identifier).toBe(minted.grantId);
    expect(minted.macaroon.caveats.length).toBeGreaterThan(0);
    // op/repo/protected-deny/expiry/session first-party caveats + one 3rd-party.
    const thirdParty = minted.macaroon.caveats.filter((c) => c.vid);
    expect(thirdParty).toHaveLength(1);
  });
});

describe('mintGrant — fail closed when the secret store is unavailable', () => {
  test('a failing SecretStore aborts the mint and writes no orphaned row', () => {
    const db = createTestDb();
    // A secret store that rejects writes (e.g. keychain unavailable).
    const failing = {
      put: () => false,
      get: () => null,
      del: () => true,
    };
    const store = createMacaroonStore(db, failing);
    expect(() =>
      store.mintGrant({
        repoId: 'a/b',
        actor: ACTOR,
        session: 's',
        expiresMs: T + 1000,
        nowMs: T,
      }),
    ).toThrow(/secret store unavailable/);
    const count = db.prepare('SELECT COUNT(*) AS n FROM actor_bound_push_grants').get();
    expect(count.n).toBe(0);
  });

  test('an INSERT failure rolls back the already-stored secrets (no orphaned keys)', () => {
    const db = createTestDb();
    // Counting secret store so we can assert every put() was matched by a del().
    const map = new Map();
    const puts = [];
    const dels = [];
    const secrets = {
      put(a, v) {
        puts.push(a);
        map.set(a, v);
        return true;
      },
      get(a) {
        return map.get(a) ?? null;
      },
      del(a) {
        dels.push(a);
        return map.delete(a);
      },
    };
    const store = createMacaroonStore(db, secrets);
    // Force the INSERT to throw by removing the table out from under it.
    db.prepare('DROP TABLE actor_bound_push_grants').run();
    expect(() =>
      store.mintGrant({
        repoId: 'a/b',
        actor: ACTOR,
        session: 's',
        expiresMs: T + 1000,
        nowMs: T,
      }),
    ).toThrow();
    // Both secrets were written, both were rolled back — nothing left behind.
    expect(puts).toHaveLength(2);
    expect(dels.sort()).toEqual(puts.sort());
    expect(map.size).toBe(0);
  });
});

describe('end-to-end through the store', () => {
  test('paid rent → discharge → verify authorizes the push', () => {
    const { store, minted } = setup();
    const d = store.discharge({
      grantId: minted.grantId,
      session: 'session-abc',
      facts: paidFacts(),
      nowMs: T,
    });
    expect(d.ok).toBe(true);
    const bound = prepareForRequest(minted.macaroon, d.discharge);
    expect(store.verify(minted.macaroon, [bound], pushCtx()).authorized).toBe(true);
  });

  test('rent-due refuses the discharge with a corrective reason', () => {
    const { store, minted } = setup();
    const d = store.discharge({
      grantId: minted.grantId,
      session: 'session-abc',
      facts: { ...paidFacts(), commitsSinceLastNote: 1 },
      nowMs: T,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/coordination note/);
  });

  test('discharge for the wrong session is refused', () => {
    const { store, minted } = setup();
    const d = store.discharge({
      grantId: minted.grantId,
      session: 'session-other',
      facts: paidFacts(),
      nowMs: T,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/different session/);
  });
});

describe('unknown / revoked grants', () => {
  test('verify rejects an unknown grant', () => {
    const { store } = setup();
    const res = store.verify({ location: 'x', identifier: 'grant-nope', caveats: [], signature: 'a'.repeat(64) }, [], pushCtx());
    expect(res.authorized).toBe(false);
    expect(res.reason).toMatch(/unknown grant/);
  });

  test('discharge rejects an unknown grant', () => {
    const { store } = setup();
    const d = store.discharge({ grantId: 'grant-nope', session: 's', facts: paidFacts(), nowMs: T });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/unknown grant/);
  });

  test('revokeGrant kills discharge and verify (hard revocation)', () => {
    const { store, minted } = setup();
    // It works before revocation.
    const before = store.discharge({
      grantId: minted.grantId,
      session: 'session-abc',
      facts: paidFacts(),
      nowMs: T,
    });
    expect(before.ok).toBe(true);

    expect(store.revokeGrant(minted.grantId, T + 1000)).toBe(true);

    const afterDischarge = store.discharge({
      grantId: minted.grantId,
      session: 'session-abc',
      facts: paidFacts(),
      nowMs: T,
    });
    expect(afterDischarge.ok).toBe(false);
    expect(afterDischarge.reason).toMatch(/revoked/);

    // Even a previously-valid discharge no longer verifies (root key is gone).
    const bound = prepareForRequest(minted.macaroon, before.discharge);
    expect(store.verify(minted.macaroon, [bound], pushCtx()).authorized).toBe(false);
  });

  test('revokeGrant on a nonexistent grant returns false', () => {
    const { store } = setup();
    expect(store.revokeGrant('grant-nope', T)).toBe(false);
  });
});
