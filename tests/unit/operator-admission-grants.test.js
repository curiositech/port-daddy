import { describe, expect, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createOperatorAdmissionGrants } from '../../lib/operator-admission-grants.js';

const ROOT = '/Users/tester/coding/tmp/port-daddy-exact-worker';
const BINDING = {
  root: ROOT,
  branch: 'codex/exact-worker',
  remote: 'github.com/curiositech/port-daddy',
  head: 'a'.repeat(40),
  base: 'b'.repeat(40),
  clean: true,
  linked: true,
};

function fixture(now = 1_000) {
  const db = createTestDb();
  let currentNow = now;
  let probe = { ...BINDING };
  const grants = createOperatorAdmissionGrants(db, {
    now: () => currentNow,
    probeWorktree: () => ({ ...probe }),
  });
  return {
    db,
    grants,
    setNow(value) { currentNow = value; },
    setProbe(value) { probe = { ...probe, ...value }; },
  };
}

function issue(grants, overrides = {}) {
  return grants.issue({
    identity: 'port-daddy:dispatch-provenance-p0',
    worktreeRoot: ROOT,
    roadmapSlug: 'workintent-dispatch-isolation',
    operatorIdentity: 'local:erichowens:uid:501',
    ttlMs: 60_000,
    ...overrides,
  });
}

describe('exact operator admission grants', () => {
  test('freezes the daemon-probed Git tuple and records an issued receipt', () => {
    const { db, grants } = fixture();
    try {
      const result = issue(grants);
      expect(result.success).toBe(true);
      expect(result.grant).toMatchObject({
        identity: 'port-daddy:dispatch-provenance-p0',
        worktreeRoot: ROOT,
        branch: BINDING.branch,
        remote: BINDING.remote,
        head: BINDING.head,
        base: BINDING.base,
        roadmapSlug: 'workintent-dispatch-isolation',
        operatorIdentity: 'local:erichowens:uid:501',
        status: 'active',
      });
      expect(result.grant.grantId).toMatch(/^oadm_/);
      expect(result.receipt.kind).toBe('issued');
      expect(result.receipt.details).not.toHaveProperty('credential');
    } finally {
      db.close();
    }
  });

  test('atomically consumes once, mints exactly once, and never mutates newcomer_pool', () => {
    const { db, grants } = fixture();
    try {
      db.exec(`CREATE TABLE newcomer_pool (project TEXT, day TEXT, spend_usd REAL, souls_seen INTEGER)`);
      db.prepare(`INSERT INTO newcomer_pool VALUES ('port-daddy', '2026-08-30', 1.25, 7)`).run();
      const issued = issue(grants);
      let mintCalls = 0;
      const first = grants.consumeAndMint({
        grantId: issued.grant.grantId,
        identity: issued.grant.identity,
        worktreeRoot: ROOT,
        roadmapSlug: issued.grant.roadmapSlug,
      }, () => {
        mintCalls += 1;
        return { actorId: 'actor-granted', credential: 'actor-granted.once-only-secret' };
      });
      expect(first.success).toBe(true);
      expect(first.actorId).toBe('actor-granted');
      expect(first.credential).toBe('actor-granted.once-only-secret');
      expect(mintCalls).toBe(1);

      const replay = grants.consumeAndMint({
        grantId: issued.grant.grantId,
        identity: issued.grant.identity,
        worktreeRoot: ROOT,
        roadmapSlug: issued.grant.roadmapSlug,
      }, () => {
        mintCalls += 1;
        return { actorId: 'actor-replay', credential: 'actor-replay.secret' };
      });
      expect(replay).toMatchObject({ success: false, code: 'GRANT_ALREADY_CONSUMED' });
      expect(mintCalls).toBe(1);
      expect(db.prepare(`SELECT * FROM newcomer_pool`).all()).toEqual([
        { project: 'port-daddy', day: '2026-08-30', spend_usd: 1.25, souls_seen: 7 },
      ]);
      expect(grants.get(issued.grant.grantId).receipts.map((entry) => entry.kind)).toEqual([
        'issued',
        'consumed',
        'rejected',
      ]);
    } finally {
      db.close();
    }
  });

  test('fails closed and records rejection when live Git provenance drifts', () => {
    const { db, grants, setProbe } = fixture();
    try {
      const issued = issue(grants);
      setProbe({ remote: 'github.com/evil/fork', head: 'c'.repeat(40) });
      const result = grants.consumeAndMint({
        grantId: issued.grant.grantId,
        identity: issued.grant.identity,
        worktreeRoot: ROOT,
        roadmapSlug: issued.grant.roadmapSlug,
      }, () => ({ actorId: 'must-not-mint', credential: 'must-not-mint.secret' }));
      expect(result).toMatchObject({ success: false, code: 'GRANT_BINDING_MISMATCH' });
      const readback = grants.get(issued.grant.grantId);
      expect(readback.grant.status).toBe('active');
      expect(readback.receipts.at(-1)).toMatchObject({ kind: 'rejected' });
      expect(readback.receipts.at(-1).details.reason).toMatch(/remote|head/);
    } finally {
      db.close();
    }
  });

  test('re-probes inside the consume transaction and refuses last-moment drift', () => {
    const db = createTestDb();
    let probes = 0;
    const grants = createOperatorAdmissionGrants(db, {
      now: () => 1_000,
      probeWorktree: () => {
        probes += 1;
        return {
          ...BINDING,
          head: probes >= 3 ? 'e'.repeat(40) : BINDING.head,
        };
      },
    });
    try {
      const issued = issue(grants); // probe 1
      let minted = false;
      const result = grants.consumeAndMint({ // probes 2 + 3
        grantId: issued.grant.grantId,
        identity: issued.grant.identity,
        worktreeRoot: ROOT,
        roadmapSlug: issued.grant.roadmapSlug,
      }, () => {
        minted = true;
        return { actorId: 'must-not-mint', credential: 'must-not-mint.secret' };
      });
      expect(result).toMatchObject({ success: false, code: 'GRANT_BINDING_MISMATCH' });
      expect(result.error).toMatch(/final worktree probe drifted: head/);
      expect(minted).toBe(false);
      expect(grants.get(issued.grant.grantId).grant.status).toBe('active');
    } finally {
      db.close();
    }
  });

  test('expires durably and cannot mint at or after the deadline', () => {
    const { db, grants, setNow } = fixture();
    try {
      const issued = issue(grants, { ttlMs: 10_000 });
      setNow(11_000);
      const result = grants.consumeAndMint({
        grantId: issued.grant.grantId,
        identity: issued.grant.identity,
        worktreeRoot: ROOT,
        roadmapSlug: issued.grant.roadmapSlug,
      }, () => ({ actorId: 'late', credential: 'late.secret' }));
      expect(result).toMatchObject({ success: false, code: 'GRANT_EXPIRED' });
      const readback = grants.get(issued.grant.grantId);
      expect(readback.grant.status).toBe('expired');
      expect(readback.receipts.map((entry) => entry.kind)).toEqual(['issued', 'expired', 'rejected']);
    } finally {
      db.close();
    }
  });

  test('is idempotent for the same exact active binding and conflicts on a changed binding', () => {
    const { db, grants, setProbe } = fixture();
    try {
      const first = issue(grants);
      const same = issue(grants);
      expect(same.success).toBe(true);
      expect(same.idempotent).toBe(true);
      expect(same.grant.grantId).toBe(first.grant.grantId);

      setProbe({ head: 'd'.repeat(40) });
      const conflict = issue(grants);
      expect(conflict).toMatchObject({ success: false, code: 'GRANT_CONFLICT' });
    } finally {
      db.close();
    }
  });

  test('refuses dirty, detached, main, or non-canonical-remote worktrees before persisting anything', () => {
    for (const badProbe of [
      { clean: false },
      { branch: null },
      { linked: false },
      { remote: null },
      { remote: 'https://github.com/curiositech/port-daddy.git' },
    ]) {
      const { db, grants, setProbe } = fixture();
      try {
        setProbe(badProbe);
        const result = issue(grants);
        expect(result).toMatchObject({ success: false, code: 'WORKTREE_PROVENANCE_INVALID' });
        expect(grants.list()).toEqual([]);
      } finally {
        db.close();
      }
    }
  });
});
