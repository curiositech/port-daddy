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
 * NOT COVERED HERE, and covered next door rather than faked: anything that
 * reads a row before deciding. Chief among them the claim compare-and-set,
 * whose correctness lives entirely in one INSERT ... ON CONFLICT ... DO UPDATE
 * whose WHERE clause is what stops two agents holding one slug. A hand-written
 * fake D1 would have to reimplement that clause to answer, which proves the
 * fake works and leaves the shipped statement unexamined. Those tests run
 * against real SQLite over the committed migration instead:
 * work-register-race.test.ts for the statement, work-register-surface.test.ts
 * for the HTTP paths that read before they answer.
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
  REGISTRY_STALE_AFTER_SECONDS,
  dateCacheMeta,
  describeAge,
  registryWarning,
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

describe('the registry projection knows how old it is', () => {
  // S4: read_at was returned from the first version and nothing looked at it,
  // so a week-old item list rendered exactly like a fresh one. These are the
  // boundary and the wording, because a warning is only as good as the moment
  // it starts appearing and the sentence it appears as.
  const meta = (read_at: number) => ({
    ref: 'main', path: SNAPSHOT_PATH, read_at, item_count: 318, refreshed_by: '@erich-owens',
  });

  it('a projection read a minute ago is not stale', () => {
    expect(dateCacheMeta(meta(at - 60), at)?.stale).toBe(false);
  });

  it('one second inside the threshold is still fresh', () => {
    expect(dateCacheMeta(meta(at - REGISTRY_STALE_AFTER_SECONDS), at)?.stale).toBe(false);
  });

  it('one second past it is stale', () => {
    expect(dateCacheMeta(meta(at - REGISTRY_STALE_AFTER_SECONDS - 1), at)?.stale).toBe(true);
  });

  it('a clock that ran backwards reads as "just now", never as a negative age', () => {
    // The relay's clock and the row's can disagree by a second across a
    // deploy. Reporting "-1 seconds ago" would make a correct board look broken.
    const dated = dateCacheMeta(meta(at + 30), at);
    expect(dated?.age_seconds).toBe(0);
    expect(dated?.age).toBe('just now');
  });

  it('no cache row at all is not the same condition as an old one', () => {
    expect(dateCacheMeta(null, at)).toBeNull();
  });

  it('describes an age in the units a reader would use', () => {
    expect(describeAge(5)).toBe('just now');
    expect(describeAge(600)).toBe('10 minutes ago');
    expect(describeAge(3600)).toBe('1 hour ago');
    expect(describeAge(7200)).toBe('2 hours ago');
    expect(describeAge(86_400 * 3)).toBe('3 days ago');
  });
});

describe('registryWarning — the sentence the page and the JSON share', () => {
  it('says nothing when there is nothing to say', () => {
    expect(registryWarning(dateCacheMeta({
      ref: 'main', path: SNAPSHOT_PATH, read_at: at - 60, item_count: 318,
    }, at))).toBeNull();
  });

  it('a never-read registry warns that slugs will queue as proposed', () => {
    const w = registryWarning(null);
    expect(w).toMatch(/proposed queue/i);
  });

  it('a stale one names the age, the ref and the count, and what to do', () => {
    const w = registryWarning(dateCacheMeta({
      ref: 'main', path: SNAPSHOT_PATH, read_at: at - 86_400, item_count: 318,
    }, at));
    expect(w).toContain('1 day ago');
    expect(w).toContain('main');
    expect(w).toContain('318');
    expect(w).toMatch(/unknown rather than as absent/);
  });
});
