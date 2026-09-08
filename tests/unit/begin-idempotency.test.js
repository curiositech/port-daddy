/**
 * lib/begin-idempotency.ts — the (key → session) store behind exactly-once
 * `pd begin`. Covers the key contract, request fingerprinting, the sealed
 * credential (openable only with the key), retention, and re-recording.
 */
import { createTestDb } from '../setup-unit.js';
import {
  BEGIN_IDEMPOTENCY_KEY_PATTERN,
  beginRequestFingerprint,
  beginScopeKey,
  createBeginIdempotency,
  generateBeginIdempotencyKey,
  isValidBeginIdempotencyKey,
  sealCredential,
  unsealCredential,
} from '../../lib/begin-idempotency.js';

const KEY = '7f0e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER_KEY = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

function scope(overrides = {}) {
  return { identity: 'demo:api:main', agentId: null, worktreeId: 'wt-1', ...overrides };
}

describe('begin idempotency — key contract', () => {
  test('generated keys are UUID v4 and valid', () => {
    const key = generateBeginIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isValidBeginIdempotencyKey(key)).toBe(true);
    expect(generateBeginIdempotencyKey()).not.toBe(key);
  });

  test('accepts UUIDs, ULIDs, and hex; rejects short, spaced, or non-string keys', () => {
    expect(isValidBeginIdempotencyKey(KEY)).toBe(true);
    expect(isValidBeginIdempotencyKey(OTHER_KEY)).toBe(true);
    expect(isValidBeginIdempotencyKey('a'.repeat(64))).toBe(true);
    expect(isValidBeginIdempotencyKey('tooshort')).toBe(false);
    expect(isValidBeginIdempotencyKey('has spaces in it here')).toBe(false);
    expect(isValidBeginIdempotencyKey('x'.repeat(129))).toBe(false);
    expect(isValidBeginIdempotencyKey(42)).toBe(false);
    expect(isValidBeginIdempotencyKey(null)).toBe(false);
    expect(BEGIN_IDEMPOTENCY_KEY_PATTERN.test('semi;colon;semi;colon')).toBe(false);
  });
});

describe('begin idempotency — scope and request fingerprint', () => {
  test('scope is canonical regardless of field order and treats undefined as null', () => {
    expect(beginScopeKey({ worktreeId: 'wt-1', identity: 'a:b:c', agentId: undefined }))
      .toBe(beginScopeKey({ identity: 'a:b:c', agentId: null, worktreeId: 'wt-1' }));
    expect(beginScopeKey(scope())).not.toBe(beginScopeKey(scope({ worktreeId: 'wt-2' })));
    expect(beginScopeKey(scope())).not.toBe(beginScopeKey(scope({ identity: 'other:x:y' })));
  });

  test('fingerprint is stable across key order, whitespace, and file order', () => {
    const a = beginRequestFingerprint({ purpose: 'ship it', lifecycle: 'ephemeral', files: ['b.ts', 'a.ts'] });
    const b = beginRequestFingerprint({ files: ['a.ts', 'b.ts'], lifecycle: 'ephemeral', purpose: '  ship it ' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('fingerprint ignores the key and transport-only fields but not the begin itself', () => {
    const base = { purpose: 'ship it', lifecycle: 'ephemeral', identity: 'demo:api:main' };
    expect(beginRequestFingerprint({ ...base, idempotencyKey: KEY, metadata: { x: 1 } }))
      .toBe(beginRequestFingerprint(base));
    expect(beginRequestFingerprint({ ...base, purpose: 'different work' })).not.toBe(beginRequestFingerprint(base));
    expect(beginRequestFingerprint({ ...base, lifecycle: 'durable' })).not.toBe(beginRequestFingerprint(base));
    expect(beginRequestFingerprint({ ...base, force: true })).not.toBe(beginRequestFingerprint(base));
    expect(beginRequestFingerprint({ ...base, sidequestReason: 'a real reason here' })).not.toBe(beginRequestFingerprint(base));
  });
});

describe('begin idempotency — sealed credential', () => {
  test('a credential sealed under a key opens only with that key', () => {
    const sealed = sealCredential('01HACTOR.s3cr3t-secret', KEY);
    expect(sealed).not.toContain('s3cr3t');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(unsealCredential(sealed, KEY)).toBe('01HACTOR.s3cr3t-secret');
    expect(unsealCredential(sealed, OTHER_KEY)).toBeNull();
    expect(unsealCredential('garbage', KEY)).toBeNull();
    expect(unsealCredential('v1.a.b', KEY)).toBeNull();
  });

  test('two seals of the same credential differ (random IV) and both open', () => {
    const one = sealCredential('actor.secret', KEY);
    const two = sealCredential('actor.secret', KEY);
    expect(one).not.toBe(two);
    expect(unsealCredential(one, KEY)).toBe('actor.secret');
    expect(unsealCredential(two, KEY)).toBe('actor.secret');
  });
});

describe('begin idempotency — store', () => {
  let db;
  let clock;
  let store;

  beforeEach(() => {
    db = createTestDb();
    clock = 1_000_000;
    store = createBeginIdempotency(db, { ttlMs: 10_000, now: () => clock });
  });

  afterEach(() => db.close());

  test('record then lookup returns the session, the response minus the credential, and the actor', () => {
    store.record({
      key: KEY,
      scope: scope(),
      fingerprint: 'fp-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      actorId: 'actor-1',
      response: { success: true, sessionId: 'session-1', agentId: 'agent-1', credential: 'actor-1.secret', purpose: 'x' },
      credential: 'actor-1.secret',
    });
    const found = store.lookup(KEY);
    expect(found).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      agentId: 'agent-1',
      actorId: 'actor-1',
      scope: beginScopeKey(scope()),
      fingerprint: 'fp-1',
      createdAt: clock,
      expiresAt: clock + 10_000,
    }));
    expect(found.response).toEqual({ success: true, sessionId: 'session-1', agentId: 'agent-1', purpose: 'x' });
    expect(found.response.credential).toBeUndefined();
    // The DB row never holds the plaintext credential.
    const raw = db.prepare('SELECT credential_sealed, response_json FROM begin_idempotency').get();
    expect(raw.credential_sealed).not.toContain('secret');
    expect(raw.response_json).not.toContain('secret');
    expect(store.openCredential(found, KEY)).toBe('actor-1.secret');
    expect(store.openCredential(found, OTHER_KEY)).toBeNull();
  });

  test('a record with no minted credential opens to null', () => {
    store.record({ key: KEY, scope: scope(), fingerprint: 'fp', sessionId: 's', agentId: 'a', actorId: 'x', response: { success: true }, credential: null });
    expect(store.openCredential(store.lookup(KEY), KEY)).toBeNull();
  });

  test('unknown, malformed, and expired keys are unknown; sweep removes expired rows', () => {
    expect(store.lookup(OTHER_KEY)).toBeNull();
    expect(store.lookup('nope')).toBeNull();
    store.record({ key: KEY, scope: scope(), fingerprint: 'fp', sessionId: 's', agentId: 'a', actorId: null, response: { success: true }, credential: null });
    clock += 9_999;
    expect(store.lookup(KEY)).not.toBeNull();
    clock += 1;
    expect(store.lookup(KEY)).toBeNull();
    store.record({ key: OTHER_KEY, scope: scope(), fingerprint: 'fp', sessionId: 's2', agentId: 'a', actorId: null, response: { success: true }, credential: null });
    clock += 20_000;
    expect(store.sweep()).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM begin_idempotency').get().n).toBe(0);
  });

  test('re-recording a key replaces the earlier session (a closed session is not replayed forever)', () => {
    store.record({ key: KEY, scope: scope(), fingerprint: 'fp', sessionId: 'old', agentId: 'a', actorId: null, response: { success: true }, credential: null });
    store.record({ key: KEY, scope: scope(), fingerprint: 'fp', sessionId: 'new', agentId: 'a', actorId: null, response: { success: true }, credential: null });
    expect(store.lookup(KEY).sessionId).toBe('new');
    expect(db.prepare('SELECT COUNT(*) AS n FROM begin_idempotency').get().n).toBe(1);
  });

  test('forget drops a key; record refuses a malformed key', () => {
    store.record({ key: KEY, scope: scope(), fingerprint: 'fp', sessionId: 's', agentId: 'a', actorId: null, response: { success: true }, credential: null });
    expect(store.forget(KEY)).toBe(true);
    expect(store.forget(KEY)).toBe(false);
    expect(store.lookup(KEY)).toBeNull();
    expect(() => store.record({ key: 'bad', scope: scope(), fingerprint: 'fp', sessionId: 's', agentId: 'a', actorId: null, response: {}, credential: null }))
      .toThrow(/must match/);
  });

  test('the DDL is additive and re-runnable on a database that already has the table', () => {
    const again = createBeginIdempotency(db, { ttlMs: 10_000, now: () => clock });
    store.record({ key: KEY, scope: scope(), fingerprint: 'fp', sessionId: 's', agentId: 'a', actorId: null, response: { success: true }, credential: null });
    expect(again.lookup(KEY).sessionId).toBe('s');
  });
});
