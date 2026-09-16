/**
 * HARBORS HTML SURFACE tests (src/harbors-page.ts; grand-plan wave E1/E2).
 *
 * Coverage, per the relay's page-test checklist (parleys-page.test.ts):
 *   - SESSION GATE: no/unknown cookie → 302 /login on both routes; a pdu_
 *     bearer token does NOT open the HTML pages;
 *   - TENANCY: the list renders ONLY the viewer's own memberships — another
 *     account's harbor never appears, in either direction;
 *   - MEMBER GATE + NO EXISTENCE ORACLE: a non-member's detail 404 is
 *     BYTE-IDENTICAL to the 404 for a harbor that does not exist, and leaks
 *     neither members nor daemon fingerprints;
 *   - REACHABILITY VERDICT derivation unit-tested across TTL fixtures
 *     (boundary at exactly PRESENCE_TTL_SECONDS, all/some/none online, zero
 *     daemon members, unreadable membership, unreadable presence);
 *   - DEGRADE-IN-PLACE: a dead presence DO or a failed member read renders
 *     honest "unknown" chips on a 200 page — never a splash-block;
 *   - XSS: a hostile member login is escaped;
 *   - TRANSPORT: script-free (zero <script>), no-store, noindex, CSP with no
 *     script-src at all — on list, detail, AND the 404;
 *   - HONEST STATES: no harbors at all teaches; the roadmap-head slot is a
 *     marked placeholder, not fabricated data;
 *   - routing pinned through worker.fetch for each route at least once.
 *
 * Idiom: the shared parley fixture (stateful fake D1 + real resolveSession /
 * resolveUserFromRequest paths), seeded through the REAL X2 harbor handlers,
 * with the REAL HarborChannel DO on a Map-backed fake DurableObjectState so
 * presence reads exercise the actual DO code (presence.test.ts idiom).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import {
  handleHarborsPage,
  handleHarborDetailPage,
  deriveReachability,
  memberPresence,
  fmtAgo,
} from '../src/harbors-page.js';
import { handleCreateHarbor, handleAddHarborMember } from '../src/harbors.js';
import { handlePresenceBeat, PRESENCE_TTL_SECONDS } from '../src/presence.js';
import { HarborChannel, type PresenceEntry } from '../src/harbor-channel.js';
import {
  makeParleyDb,
  makeParleyEnv,
  req,
  ALICE_TOKEN,
  BOB_TOKEN,
  ALICE_SESSION,
  BOB_SESSION,
  MALLORY_SESSION,
  DAEMON_FP,
  PUBKEY,
  type ParleyFixture,
} from './support/parley-fixture.js';
import type { Env } from '../src/types.js';

const T0 = 1_800_000_000;
const at = (sec: number) => vi.setSystemTime(new Date(sec * 1000));

// ── Real HarborChannel DO on a Map-backed fake state (presence.test.ts idiom) ─

function makeFakeDoNamespace(env: () => Env): DurableObjectNamespace {
  const instances = new Map<string, HarborChannel>();
  function instanceFor(key: string): HarborChannel {
    let inst = instances.get(key);
    if (!inst) {
      const map = new Map<string, unknown>();
      let alarm: number | null = null;
      const storage = {
        async get(k: string) { return map.get(k); },
        async put(k: string, v: unknown) { map.set(k, v); },
        async delete(keys: string | string[]) {
          const arr = Array.isArray(keys) ? keys : [keys];
          let n = 0;
          for (const k of arr) if (map.delete(k)) n++;
          return n;
        },
        async list(opts?: { prefix?: string }) {
          const out = new Map<string, unknown>();
          for (const [k, v] of map) {
            if (!opts?.prefix || k.startsWith(opts.prefix)) out.set(k, v);
          }
          return out;
        },
        async getAlarm() { return alarm; },
        async setAlarm(atMs: number) { alarm = atMs; },
      };
      const state = { storage } as unknown as DurableObjectState;
      inst = new HarborChannel(state, env());
      instances.set(key, inst);
    }
    return inst;
  }
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: (id: DurableObjectId) => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        instanceFor(String(id)).fetch(new Request(input as string | URL, init as RequestInit)),
    }),
  } as unknown as DurableObjectNamespace;
}

/** A DO namespace whose every fetch throws — the "presence unreadable" case. */
const DEAD_DO = {
  idFromName: (name: string) => name as unknown as DurableObjectId,
  get: () => ({
    fetch: async () => {
      throw new Error('DO unreachable (simulated)');
    },
  }),
} as unknown as DurableObjectNamespace;

function makeEnv(db: D1Database, doNs?: DurableObjectNamespace): Env {
  const env = makeParleyEnv(db, { RATE_LIMIT_WINDOW_MS: '60000' } as unknown as Partial<Env>);
  (env as unknown as { HARBOR_CHANNEL: DurableObjectNamespace }).HARBOR_CHANNEL =
    doNs ?? makeFakeDoNamespace(() => env);
  return env;
}

/** Harbor alice/dock: alice owner; bob member; DAEMON_FP a daemon member. */
async function seedDock(env: Env): Promise<void> {
  expect(
    (await handleCreateHarbor(
      req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }),
      env,
    )).status,
  ).toBe(201);
  for (const body of [{ user: 'bob' }, { daemon: DAEMON_FP }]) {
    expect(
      (await handleAddHarborMember(
        req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body }),
        env, 'alice', 'dock',
      )).status,
    ).toBe(201);
  }
}

/** Vouch a heartbeat for dock's daemon member through the real presence path. */
async function beatDaemon(env: Env): Promise<void> {
  expect(
    (await handlePresenceBeat(
      req('/v1/harbors/alice/dock/presence', { method: 'POST', token: ALICE_TOKEN, body: { daemon: DAEMON_FP } }),
      env, 'alice', 'dock',
    )).status,
  ).toBe(200);
}

const listPath = '/account/harbors';
const detailPath = '/account/harbors/alice/dock';

beforeEach(() => {
  vi.useFakeTimers();
  at(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Reachability derivation (pure; TTL fixtures) ─────────────────────────────

describe('deriveReachability — TTL fixtures', () => {
  const daemon = (id: string, lastSeen: number): PresenceEntry => ({
    kind: 'daemon', id, label: id, tier: 'oidc', last_seen: lastSeen,
  });
  const human = (id: string, lastSeen: number): PresenceEntry => ({
    kind: 'user', id, label: id, tier: 'human', last_seen: lastSeen,
  });

  it('possible when every daemon member has a live heartbeat', () => {
    const r = deriveReachability(['d1', 'd2'], [daemon('d1', T0 - 5), daemon('d2', T0 - 30)], T0);
    expect(r).toEqual({ verdict: 'possible', onlineDaemons: 2, totalDaemons: 2 });
  });

  it('a heartbeat at EXACTLY the TTL boundary still counts as online', () => {
    const r = deriveReachability(['d1'], [daemon('d1', T0 - PRESENCE_TTL_SECONDS)], T0);
    expect(r.verdict).toBe('possible');
  });

  it('one second past the TTL and the daemon is offline', () => {
    const r = deriveReachability(['d1'], [daemon('d1', T0 - PRESENCE_TTL_SECONDS - 1)], T0);
    expect(r).toEqual({ verdict: 'impossible', onlineDaemons: 0, totalDaemons: 1 });
  });

  it('degraded when some (not all) daemon members are live', () => {
    const r = deriveReachability(
      ['d1', 'd2', 'd3'],
      [daemon('d1', T0 - 10), daemon('d2', T0 - PRESENCE_TTL_SECONDS - 300)],
      T0,
    );
    expect(r).toEqual({ verdict: 'degraded', onlineDaemons: 1, totalDaemons: 3 });
  });

  it('impossible when the harbor has no daemon members at all', () => {
    const r = deriveReachability([], [human('u1', T0)], T0);
    expect(r).toEqual({ verdict: 'impossible', onlineDaemons: 0, totalDaemons: 0 });
  });

  it('a live HUMAN never counts toward daemon reachability', () => {
    const r = deriveReachability(['d1'], [human('d1', T0), human('u2', T0)], T0);
    expect(r.verdict).toBe('impossible');
  });

  it('a live daemon that is NOT a member proves nothing', () => {
    const r = deriveReachability(['d1'], [daemon('stranger', T0)], T0);
    expect(r.verdict).toBe('impossible');
  });

  it('unknown when the presence roster was unreadable', () => {
    const r = deriveReachability(['d1'], null, T0);
    expect(r.verdict).toBe('unknown');
  });

  it('unknown when the MEMBERSHIP read failed (even with a readable roster)', () => {
    const r = deriveReachability(null, [daemon('d1', T0)], T0);
    expect(r.verdict).toBe('unknown');
  });
});

describe('memberPresence — per-member chip state', () => {
  const member = {
    member_kind: 'daemon' as const, member_id: 'd1', role: 'member' as const, added_at: 1, login: null,
  };
  const entry = (lastSeen: number): PresenceEntry => ({ kind: 'daemon', id: 'd1', label: 'd1', tier: 'oidc', last_seen: lastSeen });

  it('online within the TTL, stale past it, with the real last-seen time', () => {
    expect(memberPresence(member, [entry(T0 - PRESENCE_TTL_SECONDS)], T0).state).toBe('online');
    const stale = memberPresence(member, [entry(T0 - PRESENCE_TTL_SECONDS - 1)], T0);
    expect(stale.state).toBe('stale');
    expect(stale.lastSeenAt).toBe(T0 - PRESENCE_TTL_SECONDS - 1);
  });

  it('never when there is no roster entry; unknown when the roster is unreadable', () => {
    expect(memberPresence(member, [], T0).state).toBe('never');
    expect(memberPresence(member, null, T0).state).toBe('unknown');
  });

  it('a same-id entry of the WRONG kind does not match', () => {
    const impostor: PresenceEntry = { kind: 'user', id: 'd1', label: 'd1', tier: 'human', last_seen: T0 };
    expect(memberPresence(member, [impostor], T0).state).toBe('never');
  });
});

describe('fmtAgo', () => {
  it('coarsens with distance', () => {
    expect(fmtAgo(42)).toBe('42s ago');
    expect(fmtAgo(60)).toBe('1m ago');
    expect(fmtAgo(59 * 60)).toBe('59m ago');
    expect(fmtAgo(3 * 3600 + 40 * 60)).toBe('3h ago');
    expect(fmtAgo(49 * 3600)).toBe('2d ago');
  });
});

// ── Session gate ─────────────────────────────────────────────────────────────

describe('session gate', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeParleyDb().db);
    await seedDock(env);
  });

  it('302s to /login without a session — list and detail', async () => {
    for (const res of [
      await handleHarborsPage(req(listPath), env),
      await handleHarborDetailPage(req(detailPath), env, 'alice', 'dock'),
    ]) {
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/login');
    }
  });

  it('an unknown session cookie is the same as none', async () => {
    const res = await handleHarborsPage(req(listPath, { session: 'not-a-real-session' }), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('a pdu_ bearer token does NOT open the HTML pages (pages are session-gated)', async () => {
    for (const res of [
      await handleHarborsPage(req(listPath, { token: ALICE_TOKEN }), env),
      await handleHarborDetailPage(req(detailPath, { token: ALICE_TOKEN }), env, 'alice', 'dock'),
    ]) {
      expect(res.status).toBe(302);
    }
  });
});

// ── Tenancy: the list is scoped to the viewer's own memberships ──────────────

describe('list — own memberships only', () => {
  let fx: ParleyFixture;
  let env: Env;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeEnv(fx.db);
    await seedDock(env);
    // bob's own harbor, without alice.
    expect(
      (await handleCreateHarbor(
        req('/v1/harbors', { method: 'POST', token: BOB_TOKEN, body: { name: 'bobs-yard', pubkey: PUBKEY } }),
        env,
      )).status,
    ).toBe(201);
  });

  it("alice sees dock and never bob's harbor", async () => {
    const html = await (await handleHarborsPage(req(listPath, { session: ALICE_SESSION }), env)).text();
    expect(html).toContain('alice/dock');
    expect(html).not.toContain('bobs-yard');
    expect(html).toContain('3 members'); // alice + bob + the daemon
    expect(html).toContain('owner');
  });

  it('bob sees both his memberships, with honest roles', async () => {
    const html = await (await handleHarborsPage(req(listPath, { session: BOB_SESSION }), env)).text();
    expect(html).toContain('alice/dock');
    expect(html).toContain('bob/bobs-yard');
    expect(html).toContain('>member<');
    expect(html).toContain('>owner<');
  });

  it('a user in no harbors gets the honest teaching empty state', async () => {
    const res = await handleHarborsPage(req(listPath, { session: MALLORY_SESSION }), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Personal harbor only.');
    expect(html).toContain('POST /v1/harbors');
    expect(html).not.toContain('alice/dock'); // nothing of anyone else's leaks
  });

  it('the list carries a reachability chip per harbor (live daemon ⇒ possible)', async () => {
    await beatDaemon(env);
    const html = await (await handleHarborsPage(req(listPath, { session: ALICE_SESSION }), env)).text();
    expect(html).toContain('reach-possible');
    expect(html).toContain('1/1 daemons online');
    // bob's daemon-less harbor on bob's list is honestly impossible
    const bobHtml = await (await handleHarborsPage(req(listPath, { session: BOB_SESSION }), env)).text();
    expect(bobHtml).toContain('no daemon members');
  });
});

// ── Member gate + no existence oracle ────────────────────────────────────────

describe('detail — member gate, no existence oracle', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeParleyDb().db);
    await seedDock(env);
  });

  it("a non-member's 404 is byte-identical to a nonexistent harbor's", async () => {
    const notMine = await handleHarborDetailPage(req(detailPath, { session: MALLORY_SESSION }), env, 'alice', 'dock');
    const noSuchForOutsider = await handleHarborDetailPage(
      req('/account/harbors/alice/ghost', { session: MALLORY_SESSION }), env, 'alice', 'ghost',
    );
    const noSuchForMember = await handleHarborDetailPage(
      req('/account/harbors/alice/ghost', { session: ALICE_SESSION }), env, 'alice', 'ghost',
    );
    const bodies = await Promise.all([notMine.text(), noSuchForOutsider.text(), noSuchForMember.text()]);
    expect(notMine.status).toBe(404);
    expect(noSuchForOutsider.status).toBe(404);
    expect(noSuchForMember.status).toBe(404);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toBe(bodies[2]);
  });

  it('the 404 leaks neither member logins nor the daemon fingerprint', async () => {
    const html = await (
      await handleHarborDetailPage(req(detailPath, { session: MALLORY_SESSION }), env, 'alice', 'dock')
    ).text();
    expect(html).not.toContain(DAEMON_FP);
    expect(html).not.toContain('bob');
    expect(html).not.toContain(PUBKEY);
  });

  it('a member (not only the owner) can read the detail page', async () => {
    const res = await handleHarborDetailPage(req(detailPath, { session: BOB_SESSION }), env, 'alice', 'dock');
    expect(res.status).toBe(200);
  });
});

// ── Detail rendering: roster, presence chips, verdict, honest placeholders ───

describe('detail — roster + presence + verdict', () => {
  let env: Env;
  beforeEach(async () => {
    env = makeEnv(makeParleyDb().db);
    await seedDock(env);
  });

  const detail = async () =>
    (await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', 'dock')).text();

  it('renders every member with kind, role, and the harbor pubkey', async () => {
    const html = await detail();
    expect(html).toContain('alice');
    expect(html).toContain('bob');
    expect(html).toContain(DAEMON_FP);
    expect(html).toContain(PUBKEY);
    expect(html).toContain('>owner<');
    expect(html).toContain('>member<');
    expect(html).toContain('Hotel &mdash; I have a pilot on board');
  });

  it('with no heartbeats: everyone "never seen", verdict impossible', async () => {
    const html = await detail();
    expect(html).toContain('Never seen here');
    expect(html).toContain('reach-impossible');
    expect(html).toContain('0/1 daemons online');
  });

  it('a vouched daemon heartbeat flips its chip to online and the verdict to possible', async () => {
    await beatDaemon(env);
    const html = await detail();
    expect(html).toContain('reach-possible');
    expect(html).toContain('1/1 daemons online');
    expect(html).toContain('>Online<');
  });

  it('past the TTL the chip goes STALE with the real gap, and the verdict impossible — degrade-in-place', async () => {
    await beatDaemon(env);
    at(T0 + PRESENCE_TTL_SECONDS + 5 * 60); // 5m past expiry
    const html = await detail();
    expect(html).toContain('reach-impossible');
    expect(html).toContain('Last seen 6m ago'); // 90s TTL + 300s ≈ 390s → 6m
    expect(html).not.toContain('>Online<');
  });

  it('a human heartbeat shows the operator online but does NOT make the harbor reachable', async () => {
    await handlePresenceBeat(
      req('/v1/harbors/alice/dock/presence', { method: 'POST', token: ALICE_TOKEN }),
      env, 'alice', 'dock',
    );
    const html = await detail();
    expect(html).toContain('>Online<');
    expect(html).toContain('reach-impossible'); // the daemon is still silent
  });

  it('the roadmap-head slot is a MARKED placeholder, never fabricated data', async () => {
    const html = await detail();
    expect(html).toContain('Landing with the roadmap-projection wave');
    expect(html).toContain('honestly empty');
  });

  it('doors go to real surfaces: this harbor&rsquo;s parleys and account receipts', async () => {
    const html = await detail();
    expect(html).toContain('href="/account/parleys/alice/dock"');
    expect(html).toContain('href="/account/runs"');
    expect(html).toContain('account-scoped today'); // honest about no per-harbor filter
  });
});

// ── Degrade-in-place: unreadable presence / members never sink the page ──────

describe('degrade-in-place', () => {
  it('a dead presence DO renders unknown chips + unknown verdict on a 200 page', async () => {
    const fx = makeParleyDb();
    const seedEnv = makeEnv(fx.db); // healthy DO for seeding
    await seedDock(seedEnv);
    const env = makeEnv(fx.db, DEAD_DO);

    const res = await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', 'dock');
    expect(res.status).toBe(200); // never a splash-block
    const html = await res.text();
    expect(html).toContain('reach-unknown');
    expect(html).toContain('presence unreadable');
    expect(html).toContain('Presence unknown');
    expect(html).toContain('bob'); // the D1-backed roster still renders

    const list = await handleHarborsPage(req(listPath, { session: ALICE_SESSION }), env);
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('reach-unknown');
  });

  it('a failed member read renders "unknown" — never a fabricated roster or zero count', async () => {
    const fx = makeParleyDb();
    const env = makeEnv(fx.db);
    await seedDock(env);
    fx.failReads.value = true;

    const res = await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', 'dock');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('could not read this harbor');
    expect(html).toContain('reach-unknown');
    expect(html).not.toContain('Never seen here'); // no invented member rows

    const listHtml = await (await handleHarborsPage(req(listPath, { session: ALICE_SESSION }), env)).text();
    expect(listHtml).toContain('members unknown');
    expect(listHtml).not.toContain('0 members');
  });
});

// ── XSS ──────────────────────────────────────────────────────────────────────

describe('XSS — member identities are escaped', () => {
  it('escapes a hostile login on the detail page', async () => {
    const fx = makeParleyDb();
    const env = makeEnv(fx.db);
    await seedDock(env);
    // A hostile login cannot arrive through the API (GitHub logins are tame),
    // but the page must not TRUST that: inject one at the storage layer.
    fx.users.push({
      id: 'u_evil', github_user_id: 666, login: `<img src=x onerror="alert('m')">`,
      display_name: null, avatar_url: null, primary_email: null, email_verified: 1,
      created_at: 1000, last_login_at: null, deleted_at: null,
    });
    const dock = fx.harbors.find((h) => h.name === 'dock')!;
    fx.memberships.push({
      harbor_id: dock.id, member_kind: 'user', member_id: 'u_evil',
      role: 'member', added_at: 2000, added_by: 'u_alice',
    });
    const html = await (
      await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', 'dock')
    ).text();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(&#39;m&#39;)&quot;&gt;');
  });

  it('escapes a hostile HARBOR NAME on both the list and the detail page', async () => {
    // Logins are not the only operator-supplied string on these pages. The
    // harbor namespace/name reaches the <h1>, the breadcrumb, the <title>, and
    // the list row link — every one of those must escape, not just the one the
    // first test happened to cover.
    const fx = makeParleyDb();
    const env = makeEnv(fx.db);
    await seedDock(env);
    const evil = `dock"><script>alert(1)</script>`;
    const dock = fx.harbors.find((h) => h.name === 'dock')!;
    dock.name = evil;

    const listHtml = await (
      await handleHarborsPage(req(listPath, { session: ALICE_SESSION }), env)
    ).text();
    expect(listHtml).not.toMatch(/<script[\s>]/i);
    expect(listHtml).toContain('&lt;script&gt;');

    const detailHtml = await (
      await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', evil)
    ).text();
    expect(detailHtml).not.toMatch(/<script[\s>]/i);
  });

  it('escapes a hostile member_kind label (the other user-shaped column)', async () => {
    const fx = makeParleyDb();
    const env = makeEnv(fx.db);
    await seedDock(env);
    const dock = fx.harbors.find((h) => h.name === 'dock')!;
    fx.memberships.push({
      harbor_id: dock.id, member_kind: `<b>spoofed</b>` as never, member_id: 'u_alice',
      role: `owner"><script>x</script>` as never, added_at: 2000, added_by: 'u_alice',
    });
    const html = await (
      await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', 'dock')
    ).text();
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toContain('<b>spoofed</b>');
  });
});

// ── Transport ────────────────────────────────────────────────────────────────

describe('transport headers', () => {
  it('serves no-store, noindex, and a CSP with no script-src — list, detail, and 404', async () => {
    const env = makeEnv(makeParleyDb().db);
    await seedDock(env);
    for (const res of [
      await handleHarborsPage(req(listPath, { session: ALICE_SESSION }), env),
      await handleHarborDetailPage(req(detailPath, { session: ALICE_SESSION }), env, 'alice', 'dock'),
      await handleHarborDetailPage(req(detailPath, { session: MALLORY_SESSION }), env, 'alice', 'dock'),
    ]) {
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src'); // script-free: nothing to allow
      expect(csp).toContain("frame-ancestors 'none'");
      expect(await res.text()).not.toMatch(/<script[\s>]/i);
    }
  });
});

// ── Routing through the real worker dispatcher ───────────────────────────────

describe('route wiring (worker.fetch)', () => {
  it('a malformed percent-escape in the path is a 404, not a 500', async () => {
    // decodeURIComponent throws URIError on "%ZZ". The worker's global boundary
    // would turn that into 500 INTERNAL_ERROR — a different answer than every
    // other unservable harbor URL on this surface gets. The whole point here is
    // that non-member and nonexistent are one response; a third status for
    // "your escape sequence was bad" is a distinguishable reply and an infra
    // error reported for a client mistake.
    const env = makeEnv(makeParleyDb().db);
    await seedDock(env);

    const malformed = await worker.fetch(
      req('/account/harbors/%ZZ/dock', { session: ALICE_SESSION }), env, {} as ExecutionContext,
    );
    expect(malformed.status).toBe(404);
    const body = await malformed.text();
    expect(body).not.toMatch(/INTERNAL_ERROR/);

    // …and identical to the 404 a well-formed but nonexistent harbor gets, so
    // the malformed case does not become its own oracle.
    //
    // That sentence used to be the whole of it: the code below fetched `ghost`
    // and asserted only that it was ALSO 404. Two 404s with different bodies
    // are still two distinguishable answers — the existence-oracle property is
    // about the BYTES, and it was stated in this comment and checked nowhere.
    // `notFoundPage()` (harbors-page.ts:221-236) takes no arguments and
    // interpolates nothing, so byte-identity is not merely desirable here, it
    // is what the implementation already guarantees and what a future edit
    // threading the requested name into the page would silently break.
    const ghost = await worker.fetch(
      req('/account/harbors/alice/ghost', { session: ALICE_SESSION }), env, {} as ExecutionContext,
    );
    expect(ghost.status).toBe(404);
    const ghostBody = await ghost.text();

    // Premise: both bodies are real pages. Without this, `toBe` passes for two
    // empty strings and the assertion below proves nothing.
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('Not found');
    expect(body).toBe(ghostBody);
  });

  // Obligation 4 applies to EVERY response on this surface, and the transport
  // test above reaches the list and detail pages through their handlers —
  // never through the router. The malformed-path 404 is produced by the
  // router's own URIError branch (index.ts:505-520), which is a different
  // construction path, so nothing asserted that it carries the same headers.
  // A 404 that is cacheable or indexable leaks the same fact the body is
  // careful not to state.
  it('the router-built 404 carries the same no-store, noindex, script-free headers', async () => {
    const env = makeEnv(makeParleyDb().db);
    await seedDock(env);

    for (const path of ['/account/harbors/%ZZ/dock', '/account/harbors/alice/ghost']) {
      const res = await worker.fetch(
        req(path, { session: ALICE_SESSION }), env, {} as ExecutionContext,
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src');
      expect(csp).toContain("frame-ancestors 'none'");
      expect(await res.text()).not.toMatch(/<script[\s>]/i);
    }
  });

  it('dispatches list and detail to the right handlers', async () => {
    const env = makeEnv(makeParleyDb().db);
    await seedDock(env);

    const list = await worker.fetch(req(listPath, { session: ALICE_SESSION }), env, {} as ExecutionContext);
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('alice/dock');

    const detail = await worker.fetch(req(detailPath, { session: ALICE_SESSION }), env, {} as ExecutionContext);
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain(DAEMON_FP);
  });

  it('404s an unknown shape under /account/harbors/', async () => {
    const env = makeEnv(makeParleyDb().db);
    const res = await worker.fetch(
      req('/account/harbors/a/b/c', { session: ALICE_SESSION }), env, {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });
});
