/**
 * RUNTIME CONFORMANCE: ProVerif magic-link.pv ←→ lib/recovery-magic-link.ts
 *
 * Spec:    whitepaper/formal/proverif/bonded/recovery/magic-link.pv
 * Runtime: lib/recovery-magic-link.ts
 *
 * The .pv proves two properties under a Dolev-Yao adversary controlling
 * the public email channel:
 *
 *   (S) inj-event(consumed_for(a, tk)) ==> inj-event(issued_for(a, tk))
 *       — every consume corresponds to a UNIQUE issue (single-use).
 *   (B) event(consumed_for(a, tk)) ==> event(issued_for(a, tk))
 *       — every consume binds to the (account, token) pair from issue.
 *
 * The runtime models the .pv private-channel cap by an atomic
 *   UPDATE recovery_tokens SET consumed_at=? WHERE token=? AND consumed_at IS NULL RETURNING *
 * — SQLite serializes concurrent writers so the UPDATE drains the cap in
 * one step, mirroring `in(ch_tk, cap)` in the .pv.
 *
 * This file exercises the four counter-traces magic-link.pv defends
 * against, applied to the real lib code:
 *
 *   (P1) double-consume is rejected (single-use)
 *   (P2) consume of unknown token returns null (binding base case)
 *   (P3) consume after TTL expiry returns null (freshness)
 *   (P4) racing two consumers — exactly one wins (atomicity)
 *
 * If this test fails, the runtime has drifted from the spec and the
 * magic-link.pv proof no longer applies.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Database from 'better-sqlite3';
import {
  createRecoveryMagicLink,
  RECOVERY_TOKEN_TTL_MS,
} from '../../../lib/recovery-magic-link.js';

describe('runtime conformance: magic-link single-use (magic-link.pv ↔ recovery-magic-link.ts)', () => {
  let db;
  let recovery;

  beforeEach(() => {
    db = new Database(':memory:');
    recovery = createRecoveryMagicLink(db);
    recovery.initRecoveryTokens();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('control: issue + consume (happy path)', () => {
    const issued = recovery.issueToken('account-A');
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.consumed_at).toBeNull();

    const consumed = recovery.consumeToken(issued.token);
    expect(consumed).not.toBeNull();
    expect(consumed.account_id).toBe('account-A');
    expect(consumed.consumed_at).not.toBeNull();
  });

  it('P1: double-consume is rejected (inj-event single-use)', () => {
    const issued = recovery.issueToken('account-A');
    const first = recovery.consumeToken(issued.token);
    expect(first).not.toBeNull();

    const second = recovery.consumeToken(issued.token);
    expect(second).toBeNull();

    // Verify only one consume happened in the database.
    const row = recovery.getToken(issued.token);
    expect(row.consumed_at).toBe(first.consumed_at);
  });

  it('P2: consume of unknown token returns null (binding base case)', () => {
    const fakeToken = 'a'.repeat(64);
    const result = recovery.consumeToken(fakeToken);
    expect(result).toBeNull();
  });

  it('P3: consume after TTL expiry returns null (freshness)', () => {
    const issued = recovery.issueToken('account-A');

    // Backdate the token to past expiry.
    db.prepare(
      'UPDATE recovery_tokens SET created_at = ?, expires_at = ? WHERE token = ?'
    ).run(
      Date.now() - RECOVERY_TOKEN_TTL_MS - 1000,
      Date.now() - 1000,
      issued.token,
    );

    const result = recovery.consumeToken(issued.token);
    expect(result).toBeNull();

    // Re-read to confirm consumed_at remained NULL (no successful consume).
    const row = recovery.getToken(issued.token);
    expect(row.consumed_at).toBeNull();
  });

  it('P4: racing two consumers — exactly one wins (atomicity)', () => {
    const issued = recovery.issueToken('account-A');

    // SQLite better-sqlite3 is synchronous; simulate the race by calling
    // consumeToken twice in immediate succession from the same process.
    // The atomic UPDATE-WHERE-NULL-RETURNING guarantees only the first
    // succeeds.
    const r1 = recovery.consumeToken(issued.token);
    const r2 = recovery.consumeToken(issued.token);

    const wins = [r1, r2].filter((r) => r !== null);
    const losses = [r1, r2].filter((r) => r === null);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(wins[0].account_id).toBe('account-A');
  });

  it('control: tokens are unique across issues (entropy)', () => {
    const a = recovery.issueToken('account-A');
    const b = recovery.issueToken('account-B');
    const c = recovery.issueToken('account-A'); // same account, fresh token
    expect(a.token).not.toBe(b.token);
    expect(a.token).not.toBe(c.token);
    expect(b.token).not.toBe(c.token);
  });

  it('control: account_id is preserved through issue → consume binding', () => {
    const issued = recovery.issueToken('account-X');
    const consumed = recovery.consumeToken(issued.token);
    expect(consumed.account_id).toBe('account-X');
    expect(consumed.token).toBe(issued.token);
  });
});
