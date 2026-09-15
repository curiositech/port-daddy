/**
 * Cross-runtime byte-parity (ADR-0054 I11): the TS macaroon impl must reproduce
 * the SAME signatures as the canonical Rust impl. Both assert the shared fixture
 * tests/fixtures/macaroon-parity-vectors.json (generated FROM Rust). If this and
 * the Rust `parity_vectors` test disagree, the two runtimes have diverged — which
 * is exactly the failure this gate exists to catch.
 */
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { create, addFirstPartyCaveat, prepareForRequest, verify } from '../../lib/macaroon/macaroon.js';
import {
  mintActorBoundPushGrant,
  dischargeRentPaid,
} from '../../lib/macaroon/discharge.js';
import { verifyPushGrant } from '../../lib/macaroon/gate.js';
import { makeChecker, checkCaveat } from '../../lib/macaroon/caveats.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(join(here, '../fixtures/macaroon-parity-vectors.json'), 'utf8'));
const rootKey = Buffer.from(V.root_key_utf8);
const caveatKey = Buffer.from(V.caveat_key_utf8);

const paidFacts = () => ({
  commitsSinceLastNote: 0,
  commitsTotal: 3,
  notesTotal: 3,
  claimsTotal: 1,
  commitsBehindBase: 0,
  ageMs: 60_000,
  lastSignalAgeMs: 1_000,
});

describe('macaroon byte-parity with the canonical Rust impl', () => {
  test('first-party chain reproduces the canonical signature', () => {
    const fp = V.first_party;
    let m = create(rootKey, fp.identifier, fp.location);
    for (const c of fp.caveats) m = addFirstPartyCaveat(m, c);
    expect(m.signature).toBe(fp.expected_signature_hex);
  });

  test('all caveat types reproduce the canonical signature (host/spend/glob/session)', () => {
    const ac = V.all_caveat_types;
    let m = create(rootKey, ac.identifier, ac.location);
    for (const c of ac.caveats) m = addFirstPartyCaveat(m, c);
    expect(m.signature).toBe(ac.expected_signature_hex);
  });

  test('caveat grammar EVALUATION matches the Rust semantics for every type', () => {
    // The chain signature parity (above) locks the ENCODING; this locks the
    // EVALUATION of each predicate, the red-team coverage gap. Expected results
    // are the canonical Rust check_caveat behavior.
    const ctx = (over) => ({ nowMs: 1_500_000, ...over });
    // glob branch (the two-pointer matcher must agree)
    expect(checkCaveat('branch = feat/dom-daddy-*', ctx({ branch: 'feat/dom-daddy-x' }))).toBe(true);
    expect(checkCaveat('branch = feat/dom-daddy-*', ctx({ branch: 'feat/other' }))).toBe(false);
    expect(checkCaveat('branch != main', ctx({ branch: 'main' }))).toBe(false);
    expect(checkCaveat('branch != main', ctx({ branch: 'feat/x' }))).toBe(true);
    // host
    expect(checkCaveat('host = api.anthropic.com', ctx({ host: 'api.anthropic.com' }))).toBe(true);
    expect(checkCaveat('host = api.anthropic.com', ctx({ host: 'evil.com' }))).toBe(false);
    expect(checkCaveat('host = api.anthropic.com', ctx({}))).toBe(false); // absent → fail-closed
    // spend_usd (inclusive ceiling)
    expect(checkCaveat('spend_usd <= 2.50', ctx({ spendUsd: 2.5 }))).toBe(true);
    expect(checkCaveat('spend_usd <= 2.50', ctx({ spendUsd: 2.51 }))).toBe(false);
    // expires fail-closed on an unset clock (now_ms <= 0)
    expect(checkCaveat('expires = 2000000', { nowMs: 0, branch: undefined })).toBe(false);
    expect(checkCaveat('expires = 2000000', ctx({}))).toBe(true);
    // session
    expect(checkCaveat('session = session-canon', ctx({ session: 'session-canon' }))).toBe(true);
    expect(checkCaveat('session = session-canon', ctx({ session: 'other' }))).toBe(false);
  });

  test('third-party push grant reproduces the canonical signature + vid', () => {
    const tp = V.third_party_grant;
    const { macaroon, rentCaveatId } = mintActorBoundPushGrant({
      rootKey,
      grantId: tp.grant_id,
      repoId: tp.repo,
      actor: tp.actor,
      session: tp.session,
      expiresMs: tp.expires_ms,
      caveatKey,
      rentNonce: tp.rent_nonce,
      protectedBranch: tp.protected_branch,
    });
    expect(macaroon.identifier).toBe(tp.expected_identifier);
    expect(rentCaveatId).toBe(tp.rent_caveat_id);
    const thirdParty = macaroon.caveats.find((c) => c.vid);
    expect(thirdParty.vid).toBe(tp.expected_vid_hex);
    expect(macaroon.signature).toBe(tp.expected_signature_hex);
  });

  test('bound discharge reproduces the canonical signature', () => {
    const tp = V.third_party_grant;
    const db = V.discharge_bound;
    const { macaroon, rentCaveatId, record } = mintActorBoundPushGrant({
      rootKey,
      grantId: tp.grant_id,
      repoId: tp.repo,
      actor: tp.actor,
      session: tp.session,
      expiresMs: tp.expires_ms,
      caveatKey,
      rentNonce: tp.rent_nonce,
      protectedBranch: tp.protected_branch,
    });
    const d = dischargeRentPaid({
      record,
      rentCaveatId,
      session: tp.session,
      facts: paidFacts(),
      nowMs: db.discharge_now_ms,
      ttlMs: db.discharge_ttl_ms,
    });
    expect(d.ok).toBe(true);
    const bound = prepareForRequest(macaroon, d.discharge);
    expect(bound.signature).toBe(db.expected_signature_hex);
  });

  test('the realigned verify authorizes a parity-vector grant end-to-end', () => {
    const tp = V.third_party_grant;
    const { macaroon, rentCaveatId, record } = mintActorBoundPushGrant({
      rootKey,
      grantId: tp.grant_id,
      repoId: tp.repo,
      actor: tp.actor,
      session: tp.session,
      expiresMs: tp.expires_ms,
      caveatKey,
      rentNonce: tp.rent_nonce,
      protectedBranch: tp.protected_branch,
    });
    const d = dischargeRentPaid({
      record,
      rentCaveatId,
      session: tp.session,
      facts: paidFacts(),
      nowMs: V.discharge_bound.discharge_now_ms,
      ttlMs: V.discharge_bound.discharge_ttl_ms,
    });
    const bound = prepareForRequest(macaroon, d.discharge);
    const ctx = {
      op: 'push',
      repo: tp.repo,
      branch: 'feat/x',
      session: tp.session,
      nowMs: 1_500_000,
    };
    const resolve = (cid) => (cid === rentCaveatId ? caveatKey : null);
    const res = verifyPushGrant(macaroon, rootKey, [bound], tp.actor, ctx, resolve);
    expect(res.authorized).toBe(true);
  });
});
