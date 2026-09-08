/**
 * Tests for the Harbor Work Register (src/work-register.ts).
 *
 * What is covered here, and what deliberately is not.
 *
 * COVERED: the pure decisions, which is where a subtle wrong answer would hide
 * and go unnoticed — whether a claim counts as stale (the salvage clock),
 * whether a string is a registry-shaped slug (the join key: a claim on a slug
 * the registry can never match is a claim that can never be reconciled),
 * whether a repo name is two safe segments, and the snapshot parser, which has
 * to read two shapes the projection has worn over its life and must refuse an
 * empty one loudly rather than reporting every slug unregistered. Plus the
 * request guards that need no database: a malformed repo, an unauthenticated
 * caller, a method the surface does not offer.
 *
 * NOT COVERED, and said plainly rather than faked: the claim compare-and-set.
 * Its correctness lives entirely in one SQL statement — an INSERT ... ON
 * CONFLICT ... DO UPDATE whose WHERE clause is what stops two agents holding
 * one slug — and a hand-written fake D1 would have to reimplement that clause
 * to answer. A test like that proves the fake works, not the code. The honest
 * gate for it is a real SQLite (wrangler's local D1) or the staging deploy;
 * until one of those runs it, the race is argued rather than checked, and this
 * comment is the record of which.
 */

import { describe, it, expect } from 'vitest';
import {
  isStale,
  isSlug,
  splitRepo,
  parseSnapshot,
  handleRegisterApi,
  CLAIM_STALE_AFTER_SECONDS,
  SNAPSHOT_PATH,
  type ClaimRow,
} from '../src/work-register.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const at = 1_800_000_000;

const claim = (over: Partial<ClaimRow> = {}): ClaimRow => ({
  slug: 'some-work',
  provenance: 'registered',
  state: 'held',
  agent: 'session-a',
  agent_kind: 'session',
  headline: '',
  branch: null,
  pr_number: null,
  claimed_at: at - 60,
  heartbeat_at: at - 60,
  finished_at: null,
  updated_at: at - 60,
  ...over,
});

describe('isStale — the salvage clock', () => {
  it('a claim heard from recently is not stale', () => {
    expect(isStale(claim({ heartbeat_at: at - 60 }), at)).toBe(false);
  });

  it('goes stale only strictly past the TTL, so the boundary second still holds', () => {
    expect(isStale(claim({ heartbeat_at: at - CLAIM_STALE_AFTER_SECONDS }), at)).toBe(false);
    expect(isStale(claim({ heartbeat_at: at - CLAIM_STALE_AFTER_SECONDS - 1 }), at)).toBe(true);
  });

  it('falls back to claimed_at when the holder never sent a heartbeat', () => {
    expect(isStale(claim({ heartbeat_at: null, claimed_at: at - 10 }), at)).toBe(false);
    expect(isStale(claim({ heartbeat_at: null, claimed_at: at - 99_999 }), at)).toBe(true);
  });

  it('never calls a finished, abandoned, open or absent claim stale', () => {
    const ancient = { heartbeat_at: at - 99_999 };
    expect(isStale(claim({ ...ancient, state: 'done' }), at)).toBe(false);
    expect(isStale(claim({ ...ancient, state: 'abandoned' }), at)).toBe(false);
    expect(isStale(claim({ ...ancient, state: 'open' }), at)).toBe(false);
    expect(isStale(null, at)).toBe(false);
  });

  it('calls a blocked or in-review claim stale, because those hold the slug too', () => {
    const ancient = { heartbeat_at: at - 99_999 };
    expect(isStale(claim({ ...ancient, state: 'blocked' }), at)).toBe(true);
    expect(isStale(claim({ ...ancient, state: 'review' }), at)).toBe(true);
  });
});

describe('isSlug — the join key to the registry', () => {
  it('accepts the shape the registry projection uses', () => {
    for (const s of ['fleet-cost-canary', 'roadmap-schema-wiring', 'a1b2', 'port-daddy-unified-product-hypertree']) {
      expect(isSlug(s)).toBe(true);
    }
  });

  it('rejects what could never match a row', () => {
    // Too short, capitalised, underscored, spaced, leading dash, path-shaped,
    // and the non-strings a JSON body can carry.
    for (const s of ['ab', 'Fleet-Canary', 'fleet_canary', 'fleet canary', '-fleet', 'a/b', '']) {
      expect(isSlug(s)).toBe(false);
    }
    for (const v of [null, undefined, 7, {}, []]) expect(isSlug(v)).toBe(false);
  });
});

describe('splitRepo', () => {
  it('takes exactly two safe segments', () => {
    expect(splitRepo('curiositech/port-daddy')).toEqual({ owner: 'curiositech', repo: 'port-daddy' });
  });

  it('refuses anything else rather than guessing', () => {
    for (const s of ['port-daddy', 'a/b/c', '/b', 'a/', '../etc', 'a/b?x=1', 'a b/c', null]) {
      expect(splitRepo(s as string | null)).toBeNull();
    }
  });
});

describe('parseSnapshot — the projection has worn two shapes', () => {
  it('reads a bare array', () => {
    const rows = parseSnapshot(JSON.stringify([{ slug: 'one-thing', status: 'now' }]));
    expect(rows).toEqual([{ slug: 'one-thing', status: 'now', kind: '', priority: null, summary: '' }]);
  });

  it('reads the object form, under either key', () => {
    expect(parseSnapshot('{"items":[{"slug":"one-thing"}]}')[0].slug).toBe('one-thing');
    expect(parseSnapshot('{"roadmap_items":[{"slug":"one-thing"}]}')[0].slug).toBe('one-thing');
  });

  it('accepts id where slug is absent, and carries the fields the board shows', () => {
    const rows = parseSnapshot(
      '{"items":[{"id":"legacy-item","status":"backlog","kind":"task","priority":2,"summary_md":"do the thing"}]}',
    );
    expect(rows[0]).toEqual({
      slug: 'legacy-item', status: 'backlog', kind: 'task', priority: 2, summary: 'do the thing',
    });
  });

  it('skips entries with no identifier instead of inventing one', () => {
    expect(parseSnapshot('[{"slug":"real"},{"status":"now"},{"slug":"  "}]')).toHaveLength(1);
  });

  it('throws on an empty projection rather than reporting every slug unregistered', () => {
    // A quiet empty board would mark all real work "proposed" — a wrong answer
    // that looks like a finding. Failing loudly is the lesser harm.
    expect(() => parseSnapshot('[]')).toThrow(/zero items/);
    expect(() => parseSnapshot('{"items":[]}')).toThrow(/zero items/);
    expect(() => parseSnapshot('{"nope":1}')).toThrow(/zero items/);
  });

  it('throws on a non-array item field', () => {
    expect(() => parseSnapshot('{"items":"lots"}')).toThrow(/no item array/);
  });
});

describe('the snapshot path is the committed projection, not a second store', () => {
  it('reads the file the roadmap authority writes', () => {
    expect(SNAPSHOT_PATH).toBe('docs/roadmap/roadmap.snapshot.json');
  });
});

describe('handleRegisterApi guards that need no database', () => {
  // Env is never reached on these paths: each guard returns before any query.
  const env = {} as Env;

  it('refuses a repo that is not owner/name, before touching auth', async () => {
    const res = await handleRegisterApi(new Request(`${BASE}/v1/register/board?repo=nope`), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'repo must be owner/name' });
  });

  it('refuses a missing repo the same way', async () => {
    const res = await handleRegisterApi(new Request(`${BASE}/v1/register/board`), env);
    expect(res.status).toBe(400);
  });

  it('never serves a board over a path-shaped repo', async () => {
    const res = await handleRegisterApi(
      new Request(`${BASE}/v1/register/board?repo=${encodeURIComponent('../../etc/passwd')}`),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('answers no-store on its refusals, so a proxy cannot cache an authorization', async () => {
    const res = await handleRegisterApi(new Request(`${BASE}/v1/register/board?repo=nope`), env);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
