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
  handleRegisterApi,
  CLAIM_STALE_AFTER_SECONDS,
  REGISTRY_STALE_AFTER_SECONDS,
  dateRegistryMeta,
  describeAge,
  registryWarning,
  parseBoardQuery,
  applyBoardQuery,
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

describe('the mirrored roadmap knows how old it is', () => {
  // S4: a raw timestamp was returned from the first version and nothing looked
  // at it, so a week-old item list rendered exactly like a fresh one. These are
  // the boundary and the wording, because a warning is only as good as the
  // moment it starts appearing and the sentence it appears as.
  //
  // generated_at is the DAEMON's clock in unix MILLISECONDS; every other time
  // here is unix seconds. The mixed units are the mirror's own contract, not a
  // slip, so the fixture states them.
  const meta = (generatedSeconds: number, receivedSeconds = generatedSeconds) => ({
    harbor: 'port-daddy',
    generated_at: generatedSeconds * 1000,
    received_at: receivedSeconds,
    item_count: 318,
    daemon_label: 'port-daddy-daemon',
  });

  it('a roadmap made a minute ago is not stale', () => {
    expect(dateRegistryMeta(meta(at - 60), at)?.stale).toBe(false);
  });

  it('one second inside the threshold is still fresh', () => {
    expect(dateRegistryMeta(meta(at - REGISTRY_STALE_AFTER_SECONDS), at)?.stale).toBe(false);
  });

  it('one second past it is stale', () => {
    expect(dateRegistryMeta(meta(at - REGISTRY_STALE_AFTER_SECONDS - 1), at)?.stale).toBe(true);
  });

  it('measures age from the DAEMON clock, not from when the relay received it', () => {
    // The failure this prevents: a push that landed a second ago carrying a
    // two-day-old export. Measuring arrival would call that board fresh, which
    // is the one thing the mirror's two clocks exist to stop.
    const twoDaysOldPushedJustNow = meta(at - 2 * 86_400, at - 1);
    const dated = dateRegistryMeta(twoDaysOldPushedJustNow, at);
    expect(dated?.stale).toBe(true);
    expect(dated?.age).toBe('2 days ago');
    // ... and the arrival lag is still reported, just not as freshness.
    expect(dated?.transit_seconds).toBe(2 * 86_400 - 1);
  });

  it('a clock that ran backwards reads as "just now", never as a negative age', () => {
    // The relay's clock and the daemon's can disagree by a second. Reporting
    // "-1 seconds ago" would make a correct board look broken, and a negative
    // transit would make a correct pusher look like a time traveller.
    const dated = dateRegistryMeta(meta(at + 30, at + 10), at);
    expect(dated?.age_seconds).toBe(0);
    expect(dated?.age).toBe('just now');
    expect(dated?.transit_seconds).toBe(0);
  });

  it('no mirror at all is not the same condition as an old one', () => {
    expect(dateRegistryMeta(null, at)).toBeNull();
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
  const meta = (generatedSeconds: number) => ({
    harbor: 'port-daddy',
    generated_at: generatedSeconds * 1000,
    received_at: generatedSeconds,
    item_count: 318,
    daemon_label: 'port-daddy-daemon',
  });

  it('says nothing when there is nothing to say', () => {
    expect(registryWarning(dateRegistryMeta(meta(at - 60), at))).toBeNull();
  });

  it('a repository nobody has pushed warns that slugs will queue as proposed', () => {
    const w = registryWarning(null);
    expect(w).toMatch(/proposed queue/i);
    // and names the command, because an agent reading this cannot run it and
    // needs to be able to put the operator's next step in its own note.
    expect(w).toContain('pd roadmap push');
  });

  it('a stale one names the age, the count, the daemon and what to do', () => {
    const w = registryWarning(dateRegistryMeta(meta(at - 86_400), at));
    expect(w).toContain('1 day ago');
    expect(w).toContain('318');
    expect(w).toContain('port-daddy-daemon');
    expect(w).toContain('pd roadmap push');
    expect(w).toMatch(/unknown rather than as absent/);
  });
});

describe('parseBoardQuery — the convenient API, refusing what it cannot mean', () => {
  const q = (s: string) => parseBoardQuery(new URLSearchParams(s));

  it('an empty query asks for nothing, so the default answer is unchanged', () => {
    expect(q('')).toEqual({});
  });

  it('reads order, filters, limit and cursor', () => {
    expect(q('order=priority&state=held&agent=a-1&owner=erich&provenance=proposed&limit=50&cursor=x'))
      .toEqual({
        order: 'priority', state: 'held', agent: 'a-1', owner: 'erich',
        provenance: 'proposed', limit: 50, cursor: 'x',
      });
  });

  it('refuses an unknown order or state rather than silently ignoring it', () => {
    // Ignoring an unknown parameter is how a caller comes to believe it is
    // filtering when it is reading the whole board.
    expect(q('order=whenever')).toHaveProperty('error');
    expect(q('state=vibing')).toHaveProperty('error');
    expect(q('provenance=invented')).toHaveProperty('error');
  });

  it('refuses a limit it would have to clamp', () => {
    for (const bad of ['limit=0', 'limit=-1', 'limit=501', 'limit=2.5', 'limit=lots']) {
      expect(q(bad), bad).toHaveProperty('error');
    }
    expect(q('limit=500')).toEqual({ limit: 500 });
  });
});

describe('applyBoardQuery — ordering, filtering and paging', () => {
  const row = (slug: string, priority: number | null, over: Partial<ClaimRow> | null = null) => ({
    slug, priority: priority ?? undefined, claim: over ? claim({ slug, ...over }) : null, stale: false,
  });
  // c-work is held, a-work and b-work are free; priorities are deliberately
  // not in slug order so the two orderings cannot coincide by accident.
  const board = [
    row('a-work', 3),
    row('b-work', 1),
    row('c-work', 2, { state: 'held', agent: 'agent-1', owner: 'erich' }),
    row('d-work', null),
  ];

  it('defaults to what the board returned before any of this existed', () => {
    const { items } = applyBoardQuery(board, {});
    expect(items.map((r) => r.slug)).toEqual(['c-work', 'a-work', 'b-work', 'd-work']);
  });

  it('orders by the registry priority when asked', () => {
    const { items } = applyBoardQuery(board, { order: 'priority' });
    expect(items.map((r) => r.slug)).toEqual(['b-work', 'c-work', 'a-work', 'd-work']);
  });

  it('sorts an unranked slug last, because unranked is unknown, not urgent', () => {
    const { items } = applyBoardQuery(board, { order: 'priority' });
    expect(items[items.length - 1].slug).toBe('d-work');
  });

  it('filters by state, agent, owner and provenance', () => {
    expect(applyBoardQuery(board, { state: 'held' }).items.map((r) => r.slug)).toEqual(['c-work']);
    expect(applyBoardQuery(board, { agent: 'agent-1' }).items.map((r) => r.slug)).toEqual(['c-work']);
    expect(applyBoardQuery(board, { owner: 'erich' }).items.map((r) => r.slug)).toEqual(['c-work']);
    expect(applyBoardQuery(board, { state: 'open' }).items).toHaveLength(3);
  });

  it('reports the filtered total, not just the page', () => {
    const page = applyBoardQuery(board, { order: 'slug', limit: 2 });
    expect(page.items.map((r) => r.slug)).toEqual(['a-work', 'b-work']);
    expect(page.total, 'a caller that sees only count reads a page as the board').toBe(4);
    expect(page.next_cursor).toBe('b-work');
  });

  it('pages forward from the cursor without repeating or skipping', () => {
    const first = applyBoardQuery(board, { order: 'slug', limit: 2 });
    const second = applyBoardQuery(board, { order: 'slug', limit: 2, cursor: first.next_cursor! });
    expect(second.items.map((r) => r.slug)).toEqual(['c-work', 'd-work']);
    expect(second.next_cursor, 'the last page has no next').toBeNull();
  });

  it('a cursor whose slug has left the board restarts rather than returning nothing', () => {
    // An empty page reads as "walk finished". Duplicates a caller can see.
    const page = applyBoardQuery(board, { order: 'slug', limit: 2, cursor: 'deleted-since' });
    expect(page.items.map((r) => r.slug)).toEqual(['a-work', 'b-work']);
  });

  it('does not mutate the board it was handed', () => {
    const before = board.map((r) => r.slug);
    applyBoardQuery(board, { order: 'slug' });
    expect(board.map((r) => r.slug)).toEqual(before);
  });
});
