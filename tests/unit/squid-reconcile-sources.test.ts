/**
 * Contract tests for the store→matrix adapters (`lib/squid/reconcile-sources.ts`).
 *
 * These are the mappings that turn Port Daddy's durable state into Ink Cloud
 * keys, and every one of them is a place a bug hides in plain sight: a wrong
 * mapping still type-checks and still projects *something*, so the only way it
 * surfaces is an agent being told a thing that is not true.
 *
 * The cases below are therefore written around the decisions, not the happy
 * path — what counts as a contested file, who is actually being summoned, and
 * the asymmetry that makes CI the one class where silence is a claim.
 */
import { describe, expect, test } from '@jest/globals';

import {
  ACCOMPLISHMENT_WINDOW_MS,
  CI_WINDOW_MS,
  SUMMARY_MAX,
  accomplishmentsSource,
  ciIngestionIsLive,
  ciSource,
  claimsSource,
  inboxSource,
  oneLine,
  parleySource,
} from '../../lib/squid/reconcile-sources.js';

const NOW = 1_700_000_000_000;
const now = () => NOW;

// ─── INBOX ───────────────────────────────────────────────────────────────────

describe('inboxSource', () => {
  const store = (rows: unknown[]) => ({ listAllUnread: () => rows as never });

  test('addresses each message to its recipient with a stable id', () => {
    const src = inboxSource(
      store([
        { id: 7, agentId: 'alpha', from: 'beta', content: 'rebase landed', createdAt: 10 },
        { id: 8, agentId: 'gamma', from: null, content: 'ping', createdAt: 20 },
      ]),
    );
    expect(src()).toEqual([
      { actor: 'alpha', msgId: '7', summary: 'rebase landed', from: 'beta', ts: 10 },
      { actor: 'gamma', msgId: '8', summary: 'ping', ts: 20 },
    ]);
  });

  test('the same row mints the same msgId on every call', () => {
    const src = inboxSource(store([{ id: 42, agentId: 'a', from: null, content: 'x', createdAt: 1 }]));
    // Key stability is what lets the loop overwrite instead of accumulate, and
    // what lets GC recognise a message as the same one once it is read.
    expect(src()[0].msgId).toBe(src()[0].msgId);
    expect(src()[0].msgId).toBe('42');
  });

  test('omits `from` rather than emitting a null sender', () => {
    const src = inboxSource(store([{ id: 1, agentId: 'a', from: null, content: 'x', createdAt: 1 }]));
    expect(src()[0]).not.toHaveProperty('from');
  });
});

// ─── CLAIMS ──────────────────────────────────────────────────────────────────

describe('claimsSource', () => {
  const store = (claims: unknown[]) => ({
    listAllActiveClaims: () => ({ claims: claims as never }),
    list: () => ({ sessions: [] }),
  });

  test('a file held by one session is NOT an overlap', () => {
    // Every active session holds claims; projecting all of them would flood the
    // matrix with the fleet's entire working set. Only contention is news.
    const src = claimsSource(store([{ filePath: 'a.ts', sessionId: 's1', agentId: 'alpha', claimedAt: 1 }]));
    expect(src()).toEqual([]);
  });

  test('a file held by two sessions IS an overlap', () => {
    const src = claimsSource(
      store([
        { filePath: 'a.ts', sessionId: 's1', agentId: 'alpha', claimedAt: 5 },
        { filePath: 'a.ts', sessionId: 's2', agentId: 'beta', claimedAt: 9 },
      ]),
    );
    expect(src()).toEqual([{ path: 'a.ts', holders: ['alpha', 'beta'], ts: 9 }]);
  });

  test('one session claiming three regions of a file is ONE holder, not three', () => {
    // Headline regression: counting rows instead of distinct holders reports a
    // phantom overlap of a session against itself — a false alarm that teaches
    // agents to ignore the whole class.
    const src = claimsSource(
      store([
        { filePath: 'big.ts', sessionId: 's1', agentId: 'alpha', claimedAt: 1 },
        { filePath: 'big.ts', sessionId: 's1', agentId: 'alpha', claimedAt: 2 },
        { filePath: 'big.ts', sessionId: 's1', agentId: 'alpha', claimedAt: 3 },
      ]),
    );
    expect(src()).toEqual([]);
  });

  test('the overlap is dated by the newest claim — when contention began', () => {
    const src = claimsSource(
      store([
        { filePath: 'a.ts', sessionId: 's1', agentId: 'alpha', claimedAt: 100 },
        { filePath: 'a.ts', sessionId: 's2', agentId: 'beta', claimedAt: 400 },
      ]),
    );
    expect(src()[0].ts).toBe(400);
  });

  test('holders are sorted, so an unchanged overlap projects an unchanged value', () => {
    const a = claimsSource(
      store([
        { filePath: 'f', sessionId: 's1', agentId: 'zeta', claimedAt: 1 },
        { filePath: 'f', sessionId: 's2', agentId: 'alpha', claimedAt: 2 },
      ]),
    )();
    const b = claimsSource(
      store([
        { filePath: 'f', sessionId: 's2', agentId: 'alpha', claimedAt: 2 },
        { filePath: 'f', sessionId: 's1', agentId: 'zeta', claimedAt: 1 },
      ]),
    )();
    expect(a).toEqual(b);
  });

  test('falls back to sessionId when a claim has no agentId', () => {
    const src = claimsSource(
      store([
        { filePath: 'a.ts', sessionId: 's1', agentId: null, claimedAt: 1 },
        { filePath: 'a.ts', sessionId: 's2', agentId: undefined, claimedAt: 2 },
      ]),
    );
    expect(src()[0].holders).toEqual(['s1', 's2']);
  });
});

// ─── PARLEY ──────────────────────────────────────────────────────────────────

describe('parleySource', () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    parley: { parleyId: 'c1', reason: 'rotate the prod key', parties: ['alpha', 'beta'], createdAt: 50 },
    status: 'SUMMONED',
    missingParties: ['beta'],
    expired: false,
    ...over,
  });

  test('summons only the parties who still owe a reply', () => {
    // Fanning out over `parties` would re-summon someone who already spoke on
    // every tick until the parley closed.
    const src = parleySource({ list: () => [summary()] as never });
    expect(src()).toEqual([{ actor: 'beta', convId: 'c1', summary: 'rotate the prod key', ts: 50 }]);
  });

  test('one summons per missing party', () => {
    const src = parleySource({ list: () => [summary({ missingParties: ['beta', 'gamma'] })] as never });
    expect(src().map((s) => s.actor)).toEqual(['beta', 'gamma']);
    expect(new Set(src().map((s) => s.convId))).toEqual(new Set(['c1']));
  });

  test.each(['COLLAPSED', 'ESCALATED', 'VOIDED'])('a %s parley summons nobody', (status) => {
    const src = parleySource({ list: () => [summary({ status })] as never });
    expect(src()).toEqual([]);
  });

  test('an expired parley summons nobody', () => {
    const src = parleySource({ list: () => [summary({ expired: true })] as never });
    expect(src()).toEqual([]);
  });

  test('a resolved parley drops out so GC can retract its keys', () => {
    // This is how a parley goes quiet without anyone explicitly retracting it:
    // the source stops offering the key and the loop deletes it.
    const open = parleySource({ list: () => [summary()] as never })();
    const closed = parleySource({ list: () => [summary({ status: 'COLLAPSED' })] as never })();
    expect(open).toHaveLength(1);
    expect(closed).toHaveLength(0);
  });
});

// ─── ACCOMPLISHMENTS ─────────────────────────────────────────────────────────

describe('accomplishmentsSource', () => {
  const store = (sessions: unknown[]) => ({
    listAllActiveClaims: () => ({ claims: [] }),
    list: () => ({ success: true, sessions }),
  });

  test('reports work completed inside the window', () => {
    const src = accomplishmentsSource(store([{ id: 's1', purpose: 'ship the loop', completedAt: NOW - 1000 }]), now);
    expect(src()).toEqual([{ id: 's1', summary: 'ship the loop', ts: NOW - 1000 }]);
  });

  test('drops work older than the window — ambience has a shelf life', () => {
    const src = accomplishmentsSource(
      store([{ id: 'old', purpose: 'ancient', completedAt: NOW - ACCOMPLISHMENT_WINDOW_MS - 1 }]),
      now,
    );
    expect(src()).toEqual([]);
  });

  test('skips sessions with no completion timestamp', () => {
    const src = accomplishmentsSource(store([{ id: 's1', purpose: 'x', completedAt: null }]), now);
    expect(src()).toEqual([]);
  });

  test('accepts both the bare-array and { sessions } list shapes', () => {
    const row = { id: 's1', purpose: 'x', completedAt: NOW };
    const enveloped = accomplishmentsSource(store([row]), now)();
    const bare = accomplishmentsSource(
      { listAllActiveClaims: () => ({ claims: [] }), list: () => [row] },
      now,
    )();
    expect(bare).toEqual(enveloped);
  });

  test('an unrecognised list shape yields nothing instead of throwing', () => {
    // A throwing source degrades the class; for pure ambience that is a worse
    // outcome than reporting none.
    const src = accomplishmentsSource(
      { listAllActiveClaims: () => ({ claims: [] }), list: () => 'unexpected' as never },
      now,
    );
    expect(src()).toEqual([]);
  });
});

// ─── CI ──────────────────────────────────────────────────────────────────────

describe('CI — the class where silence is a claim', () => {
  const ev = (over: Record<string, unknown> = {}) => ({
    event: 'check_run',
    conclusion: 'failure',
    owner: 'curiositech',
    repo: 'port-daddy',
    prNumber: 4925,
    sha: 'abcdef1234',
    ts: NOW - 1000,
    metadata: null,
    ...over,
  });

  test('ingestion probe is false for an empty table', () => {
    // The load-bearing case: with no events ever recorded, `ciSource` would
    // answer null and assert that a build nobody has observed is green.
    expect(ciIngestionIsLive({ recent: () => [] })).toBe(false);
  });

  test('ingestion probe is true once any event exists', () => {
    expect(ciIngestionIsLive({ recent: () => [ev()] as never })).toBe(true);
  });

  test('ingestion probe fails closed when the store throws', () => {
    expect(
      ciIngestionIsLive({
        recent: () => {
          throw new Error('db locked');
        },
      }),
    ).toBe(false);
  });

  test('reports the most recent red check', () => {
    const src = ciSource({ recent: () => [ev()] as never }, now);
    expect(src()).toEqual({
      branch: 'PR #4925',
      summary: 'check_run failed on curiositech/port-daddy',
      ts: NOW - 1000,
    });
  });

  test('green events yield null', () => {
    const src = ciSource({ recent: () => [ev({ conclusion: 'success' })] as never }, now);
    expect(src()).toBeNull();
  });

  test('takes the FIRST failure, since recent() is newest-first', () => {
    const src = ciSource(
      { recent: () => [ev({ prNumber: 2, ts: NOW - 10 }), ev({ prNumber: 1, ts: NOW - 9999 })] as never },
      now,
    );
    expect(src()?.branch).toBe('PR #2');
  });

  test('prefers an explicit branch from metadata over the PR fallback', () => {
    const src = ciSource({ recent: () => [ev({ metadata: { branch: 'feat/squid' } })] as never }, now);
    expect(src()?.branch).toBe('feat/squid');
  });

  test('falls back to a short sha when there is no branch and no PR', () => {
    const src = ciSource({ recent: () => [ev({ prNumber: null, metadata: null })] as never }, now);
    expect(src()?.branch).toBe('abcdef12');
  });

  test('asks only for events inside the window', () => {
    let askedSince = -1;
    const src = ciSource(
      {
        recent: (_l?: number, since?: number) => {
          askedSince = since ?? -1;
          return [];
        },
      },
      now,
    );
    src();
    expect(askedSince).toBe(NOW - CI_WINDOW_MS);
  });
});

// ─── oneLine ─────────────────────────────────────────────────────────────────

describe('oneLine', () => {
  test('collapses newlines — the matrix is a flat KEY="value" file', () => {
    // An embedded newline does not just look bad: it terminates the line the
    // POSIX hook is parsing, so the rest of the value becomes a stray key.
    expect(oneLine('a\nb\r\nc')).toBe('a b c');
    expect(oneLine('a\nb')).not.toContain('\n');
  });

  test('truncates to the summary budget with an ellipsis', () => {
    const out = oneLine('x'.repeat(1000));
    expect(out.length).toBe(SUMMARY_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  test('survives objects, null and undefined', () => {
    expect(oneLine({ text: 'hello' })).toBe('hello');
    expect(oneLine({ message: 'hi' })).toBe('hi');
    expect(oneLine(null)).toBe('(empty)');
    expect(oneLine(undefined)).toBe('(empty)');
    expect(oneLine('   ')).toBe('(empty)');
    expect(oneLine({ a: 1 })).toBe('{"a":1}');
  });

  test('survives a circular object rather than throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => oneLine(circular)).not.toThrow();
  });
});
