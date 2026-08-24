/**
 * X4 PARLEY HTML SURFACE tests (src/parleys-page.ts; `parleys-html-ui`).
 *
 * Coverage, per the node's gate:
 *   - SESSION GATE: no/unknown cookie → 302 /login on every route, including
 *     the form POST (a page is a browser act; the pdu_ bearer path stays on
 *     the JSON API);
 *   - MEMBER GATE + NO EXISTENCE ORACLE: a non-member's 404 is BYTE-IDENTICAL
 *     to the 404 for a parley that does not exist, and to the 404 for a parley
 *     that exists in someone else's harbor — the page cannot be used to
 *     enumerate harbors or parley ids;
 *   - CSRF: the sign form refuses a cross-origin POST and records nothing;
 *   - TERMINAL STATE: an agreed/lapsed parley renders as CLOSED with no sign
 *     button anywhere on the page (no dead buttons);
 *   - XSS: hostile subject and position text are escaped in list and detail;
 *   - MEDIATOR SEAT: rendered, labeled as an observer that cannot sign, with
 *     an honest "nothing to add" when silent and its note when it has one;
 *   - TRANSPORT: script-free (zero <script> tags), no-store, noindex, and a
 *     CSP with no script-src at all;
 *   - HONEST STATES: empty harbor, no harbors at all, and a failed read
 *     rendering as "unknown" rather than as a fabricated empty list;
 *   - the sign form's happy path actually signing through the shared respond
 *     implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';
import {
  handleParleysIndex,
  handleParleyListPage,
  handleParleyDetailPage,
  handleParleySignForm,
  fmtRemaining,
} from '../src/parleys-page.js';
import { handleCreateParley, handleRespondParley, MEDIATOR_ID } from '../src/parleys.js';
import { handleCreateHarbor, handleAddHarborMember } from '../src/harbors.js';
import {
  makeParleyDb,
  makeParleyEnv,
  req,
  BASE,
  ALICE_TOKEN,
  BOB_TOKEN,
  ALICE_SESSION,
  BOB_SESSION,
  CAROL_SESSION,
  MALLORY_SESSION,
  PUBKEY,
  type ParleyFixture,
} from './support/parley-fixture.js';
import type { Env } from '../src/types.js';

const T0 = 1_800_000_000;
const at = (sec: number) => vi.setSystemTime(new Date(sec * 1000));

/** Harbor alice/dock: alice owner; bob + carol members; mallory a non-member. */
async function seedDock(env: Env): Promise<void> {
  expect(
    (await handleCreateHarbor(
      req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'dock', pubkey: PUBKEY } }),
      env,
    )).status,
  ).toBe(201);
  for (const body of [{ user: 'bob' }, { user: 'carol' }]) {
    expect(
      (await handleAddHarborMember(
        req('/v1/harbors/alice/dock/members', { method: 'POST', token: ALICE_TOKEN, body }),
        env, 'alice', 'dock',
      )).status,
    ).toBe(201);
  }
}

async function convene(env: Env, subject = 'who merges the auth refactor first'): Promise<string> {
  const res = await handleCreateParley(
    req('/v1/harbors/alice/dock/parleys', {
      method: 'POST', token: ALICE_TOKEN, body: { subject, parties: [{ user: 'bob' }] },
    }),
    env, 'alice', 'dock',
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { parley: { id: string } }).parley.id;
}

const listPath = '/account/parleys/alice/dock';
const detailPath = (id: string) => `/account/parleys/alice/dock/${id}`;
const signPath = (id: string) => `/account/parleys/alice/dock/${id}/sign`;

beforeEach(() => {
  vi.useFakeTimers();
  at(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Session gate ─────────────────────────────────────────────────────────────

describe('session gate', () => {
  let fx: ParleyFixture;
  let env: Env;
  let id: string;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
    id = await convene(env);
  });

  it('302s to /login without a session — index, list, and detail', async () => {
    const index = await handleParleysIndex(req('/account/parleys'), env);
    const list = await handleParleyListPage(req(listPath), env, 'alice', 'dock');
    const detail = await handleParleyDetailPage(req(detailPath(id)), env, 'alice', 'dock', id);
    for (const res of [index, list, detail]) {
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/login');
    }
  });

  it('302s to /login on the sign POST, and signs nothing', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', origin: BASE, form: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
    expect(fx.positions.filter((p) => p.parley_id === id && p.signed_at !== null)).toHaveLength(0);
  });

  it('an unknown session cookie is the same as none', async () => {
    const res = await handleParleyListPage(req(listPath, { session: 'not-a-real-session' }), env, 'alice', 'dock');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('a pdu_ bearer token does NOT open the HTML page (pages are session-gated)', async () => {
    const res = await handleParleyListPage(req(listPath, { token: ALICE_TOKEN }), env, 'alice', 'dock');
    expect(res.status).toBe(302);
  });
});

// ── Member gate + no existence oracle ────────────────────────────────────────

describe('member gate — no existence oracle', () => {
  let fx: ParleyFixture;
  let env: Env;
  let id: string;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
    id = await convene(env);
  });

  it("a non-member's list 404 is byte-identical to a nonexistent harbor's", async () => {
    const notMine = await handleParleyListPage(req(listPath, { session: MALLORY_SESSION }), env, 'alice', 'dock');
    const noSuch = await handleParleyListPage(
      req('/account/parleys/alice/ghost', { session: MALLORY_SESSION }), env, 'alice', 'ghost',
    );
    expect(notMine.status).toBe(404);
    expect(noSuch.status).toBe(404);
    expect(await notMine.text()).toBe(await noSuch.text());
  });

  it("a non-member's detail 404 is byte-identical to a nonexistent parley's", async () => {
    const realParleyWrongPerson = await handleParleyDetailPage(
      req(detailPath(id), { session: MALLORY_SESSION }), env, 'alice', 'dock', id,
    );
    const fakeParleyWrongPerson = await handleParleyDetailPage(
      req(detailPath('p_doesnotexist'), { session: MALLORY_SESSION }), env, 'alice', 'dock', 'p_doesnotexist',
    );
    const fakeParleyRealMember = await handleParleyDetailPage(
      req(detailPath('p_doesnotexist'), { session: ALICE_SESSION }), env, 'alice', 'dock', 'p_doesnotexist',
    );
    const bodies = await Promise.all([
      realParleyWrongPerson.text(), fakeParleyWrongPerson.text(), fakeParleyRealMember.text(),
    ]);
    expect(realParleyWrongPerson.status).toBe(404);
    expect(fakeParleyWrongPerson.status).toBe(404);
    expect(fakeParleyRealMember.status).toBe(404);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[1]).toBe(bodies[2]);
  });

  it('the 404 body leaks neither the subject nor the parley id', async () => {
    const res = await handleParleyDetailPage(req(detailPath(id), { session: MALLORY_SESSION }), env, 'alice', 'dock', id);
    const html = await res.text();
    expect(html).not.toContain(id);
    expect(html).not.toContain('auth refactor');
  });

  it('a parley reached through the WRONG harbor is a 404 even for a member of both', async () => {
    // alice owns a second harbor; bob's parley in dock must not resolve there.
    expect(
      (await handleCreateHarbor(
        req('/v1/harbors', { method: 'POST', token: ALICE_TOKEN, body: { name: 'yard', pubkey: PUBKEY } }),
        env,
      )).status,
    ).toBe(201);
    const res = await handleParleyDetailPage(
      req(`/account/parleys/alice/yard/${id}`, { session: ALICE_SESSION }), env, 'alice', 'yard', id,
    );
    expect(res.status).toBe(404);
  });

  it('a member of the harbor who is NOT a party can still read it', async () => {
    const res = await handleParleyDetailPage(req(detailPath(id), { session: CAROL_SESSION }), env, 'alice', 'dock', id);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('You are not a named party');
    expect(html).not.toContain('class="btn-sign"'); // the CSS rule may exist; the BUTTON must not
  });

  it('the sign POST from a non-member 404s and records nothing', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: MALLORY_SESSION, origin: BASE, form: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(404);
    expect(fx.positions.filter((p) => p.parley_id === id && p.signed_at !== null)).toHaveLength(0);
  });
});

// ── CSRF on the sign form ────────────────────────────────────────────────────

describe('CSRF — the sign form is same-origin only', () => {
  let fx: ParleyFixture;
  let env: Env;
  let id: string;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
    id = await convene(env);
  });

  it('refuses a cross-origin POST with 403 and signs nothing', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), {
        method: 'POST', session: ALICE_SESSION, origin: 'https://evil.example', form: { stance: 'accept' },
      }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Cross-origin request refused');
    const alice = fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!;
    expect(alice.signed_at).toBeNull();
    expect(alice.stance).toBeNull();
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('open');
  });

  it('refuses a cross-origin POST even routed through the real worker dispatcher', async () => {
    const res = await worker.fetch(
      req(signPath(id), {
        method: 'POST', session: ALICE_SESSION, origin: 'https://evil.example', form: { stance: 'reject' },
      }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(403);
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('open');
  });

  it('accepts a same-origin POST (the guard is not simply always-refuse)', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: ALICE_SESSION, origin: BASE, form: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(303);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!.stance).toBe('accept');
  });
});

// ── The sign form's behavior ─────────────────────────────────────────────────

describe('sign form', () => {
  let fx: ParleyFixture;
  let env: Env;
  let id: string;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
    id = await convene(env);
  });

  it('signs a position and 303s back with a success notice', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), {
        method: 'POST', session: ALICE_SESSION, origin: BASE,
        form: { stance: 'accept', position: 'fine, but the migration lands first' },
      }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`${detailPath(id)}?notice=signed`);
    const alice = fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!;
    expect(alice.stance).toBe('accept');
    expect(alice.position).toBe('fine, but the migration lands first');
    expect(alice.signed_at).toBe(T0);
  });

  it('a reject lapses the parley immediately (the shared state machine ran)', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: BOB_SESSION, origin: BASE, form: { stance: 'reject', position: 'no' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.status).toBe(303);
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('lapsed');
  });

  it('a full set of accepts agrees the parley', async () => {
    for (const session of [ALICE_SESSION, BOB_SESSION]) {
      await handleParleySignForm(
        req(signPath(id), { method: 'POST', session, origin: BASE, form: { stance: 'accept' } }),
        env, 'alice', 'dock', id,
      );
    }
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('agreed');
  });

  it('a second signature from the same party is refused (write-once)', async () => {
    await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: ALICE_SESSION, origin: BASE, form: { stance: 'accept', position: 'first' } }),
      env, 'alice', 'dock', id,
    );
    const again = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: ALICE_SESSION, origin: BASE, form: { stance: 'reject', position: 'changed my mind' } }),
      env, 'alice', 'dock', id,
    );
    expect(again.headers.get('Location')).toBe(`${detailPath(id)}?notice=already-signed`);
    const alice = fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!;
    expect(alice.stance).toBe('accept');
    expect(alice.position).toBe('first');
  });

  it('a non-party member gets the not-a-party notice and signs nothing', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: CAROL_SESSION, origin: BASE, form: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.headers.get('Location')).toBe(`${detailPath(id)}?notice=not-a-party`);
    expect(fx.positions.filter((p) => p.parley_id === id && p.signed_at !== null)).toHaveLength(0);
  });

  it('a missing stance is refused with the bad-stance notice', async () => {
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: ALICE_SESSION, origin: BASE, form: { position: 'no stance given' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.headers.get('Location')).toBe(`${detailPath(id)}?notice=bad-stance`);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!.signed_at).toBeNull();
  });

  it('signing a closed parley is refused with the closed notice', async () => {
    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: BOB_TOKEN, body: { stance: 'reject' } }),
      env, 'alice', 'dock', id,
    );
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('lapsed');
    const res = await handleParleySignForm(
      req(signPath(id), { method: 'POST', session: ALICE_SESSION, origin: BASE, form: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    expect(res.headers.get('Location')).toBe(`${detailPath(id)}?notice=closed`);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!.signed_at).toBeNull();
  });
});

// ── Terminal-state rendering: no dead buttons ────────────────────────────────

describe('terminal states render as closed, never as a dead button', () => {
  let fx: ParleyFixture;
  let env: Env;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
  });

  it('an OPEN parley shows the sign form to an unsigned named party', async () => {
    const id = await convene(env);
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain('Sign your position');
    expect(html).toContain('btn-sign');
    expect(html).toContain(`action="${signPath(id)}"`);
  });

  it('an AGREED parley renders CLOSED with no form and no button', async () => {
    const id = await convene(env);
    for (const token of [ALICE_TOKEN, BOB_TOKEN]) {
      await handleRespondParley(
        req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token, body: { stance: 'accept' } }),
        env, 'alice', 'dock', id,
      );
    }
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain('This parley is closed');
    expect(html).toContain('agreed');
    expect(html).toContain('immutable');
    expect(html).not.toContain('class="btn-sign"'); // the CSS rule may exist; the BUTTON must not
    expect(html).not.toContain('<form');
  });

  it('a LAPSED (rejected) parley renders CLOSED with no form', async () => {
    const id = await convene(env);
    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: BOB_TOKEN, body: { stance: 'reject' } }),
      env, 'alice', 'dock', id,
    );
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain('This parley is closed');
    expect(html).toContain('lapsed');
    expect(html).not.toContain('<form');
  });

  it('an EXPIRED parley lapses lazily on page read and renders closed', async () => {
    const id = await convene(env);
    at(T0 + 25 * 3600); // past the 24h default deadline
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(fx.parleys.find((p) => p.id === id)!.state).toBe('lapsed');
    expect(html).toContain('This parley is closed');
    expect(html).not.toContain('<form');
  });

  it('a party who already signed sees their signature, not a form', async () => {
    const id = await convene(env);
    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, { method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept' } }),
      env, 'alice', 'dock', id,
    );
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain('You signed this parley on');
    expect(html).toContain('write-once');
    expect(html).not.toContain('class="btn-sign"'); // the CSS rule may exist; the BUTTON must not
  });
});

// ── XSS ──────────────────────────────────────────────────────────────────────

describe('XSS — model- and user-supplied text is escaped everywhere', () => {
  const HOSTILE_SUBJECT = `<script>alert('subject')</script>`;
  const HOSTILE_POSITION = `</textarea><img src=x onerror="alert('pos')">`;
  const HOSTILE_NOTE = `<script>alert('mediator')</script>`;

  let fx: ParleyFixture;
  let env: Env;
  let id: string;

  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
    id = await convene(env, HOSTILE_SUBJECT);
    await handleRespondParley(
      req(`/v1/harbors/alice/dock/parleys/${id}/respond`, {
        method: 'POST', token: ALICE_TOKEN, body: { stance: 'accept', position: HOSTILE_POSITION },
      }),
      env, 'alice', 'dock', id,
    );
    // The mediator's note is model output — as hostile as anything else.
    fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position = HOSTILE_NOTE;
  });

  it('escapes a hostile subject on the DETAIL page', async () => {
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&#39;subject&#39;)&lt;/script&gt;');
  });

  it('escapes a hostile subject on the LIST page', async () => {
    const html = await (await handleParleyListPage(req(listPath, { session: ALICE_SESSION }), env, 'alice', 'dock')).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes hostile POSITION text (no textarea break-out, no img tag)', async () => {
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</textarea><img');
    expect(html).toContain('&lt;/textarea&gt;&lt;img src=x onerror=&quot;alert(&#39;pos&#39;)&quot;&gt;');
  });

  it("escapes the MEDIATOR's model-written note", async () => {
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&#39;mediator&#39;)&lt;/script&gt;');
  });

  it('the rendered pages contain ZERO script tags in any state', async () => {
    const list = await (await handleParleyListPage(req(listPath, { session: ALICE_SESSION }), env, 'alice', 'dock')).text();
    const detail = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    for (const html of [list, detail]) {
      expect(html).not.toMatch(/<script[\s>]/i);
      // No LIVE inline handler: the hostile position's `onerror=` survives only
      // in its escaped form (`onerror=&quot;`), which the browser never runs.
      expect(html).not.toContain('onerror="');
      expect(html).not.toContain('javascript:');
    }
  });
});

// ── Mediator seat rendering ──────────────────────────────────────────────────

describe('the reserved mediator seat renders as an observer that cannot sign', () => {
  let fx: ParleyFixture;
  let env: Env;
  let id: string;
  beforeEach(async () => {
    fx = makeParleyDb();
    env = makeParleyEnv(fx.db);
    await seedDock(env);
    id = await convene(env);
  });

  it('renders the seat, labeled, with an honest empty state when silent', async () => {
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain(MEDIATOR_ID);
    expect(html).toContain('Observer &mdash; cannot sign');
    expect(html).toContain('The mediator had nothing to add.');
    expect(html).toContain('cannot cause or block agreement');
  });

  it('renders its observation when it has one, still labeled as an observer', async () => {
    fx.positions.find((p) => p.parley_id === id && p.party_kind === 'mediator')!.position =
      'Alice accepts on condition of migration order; Bob has not signed.';
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain('Alice accepts on condition of migration order');
    expect(html).toContain('Observer &mdash; cannot sign');
    expect(html).toContain('not a signature');
  });

  it('the mediator is NOT counted in the signature tally on the list page', async () => {
    // 2 named parties + 1 observer seat. The list must say "0 of 2", never "of 3".
    const html = await (await handleParleyListPage(req(listPath, { session: ALICE_SESSION }), env, 'alice', 'dock')).text();
    expect(html).toContain('0 of 2 signed');
    expect(html).not.toContain('of 3 signed');
  });

  it('the mediator is NOT counted in the detail page tally either', async () => {
    const html = await (await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id)).text();
    expect(html).toContain('0 of 2');
  });
});

// ── Honest empty / degraded states ───────────────────────────────────────────

describe('honest empty and degraded states', () => {
  it('a harbor with no parleys teaches, and does not pretend to be broken', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    const html = await (await handleParleyListPage(req(listPath, { session: ALICE_SESSION }), env, 'alice', 'dock')).text();
    expect(html).toContain('No parleys in alice/dock yet.');
    expect(html).toContain('POST /v1/harbors/alice/dock/parleys');
  });

  it('a user in no harbors gets an honest empty index (not a redirect to nowhere)', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    const res = await handleParleysIndex(req('/account/parleys', { session: MALLORY_SESSION }), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('not a member of any harbor yet');
  });

  it('the index redirects a member straight to their harbor', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    const res = await handleParleysIndex(req('/account/parleys', { session: ALICE_SESSION }), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account/parleys/alice/dock');
  });

  it('a failed read renders "unknown", NEVER a fabricated empty list', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    await convene(env);
    fx.failReads.value = true;

    const html = await (await handleParleyListPage(req(listPath, { session: ALICE_SESSION }), env, 'alice', 'dock')).text();
    expect(html).toContain('could not read this harbor');
    expect(html).not.toContain('No parleys in alice/dock yet.');
  });

  it('only whitelisted ?notice= codes render; raw query text is never echoed', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    const evil = encodeURIComponent('<b>Enter your password</b>');
    const html = await (await handleParleyListPage(
      req(`${listPath}?notice=${evil}`, { session: ALICE_SESSION }), env, 'alice', 'dock',
    )).text();
    expect(html).not.toContain('Enter your password');
    expect(html).not.toContain('class="notice-strip'); // the CSS rule exists; no STRIP renders
  });
});

// ── Transport ────────────────────────────────────────────────────────────────

describe('transport headers', () => {
  it('serves no-store, noindex, and a CSP with no script-src at all', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    const id = await convene(env);
    for (const res of [
      await handleParleyListPage(req(listPath, { session: ALICE_SESSION }), env, 'alice', 'dock'),
      await handleParleyDetailPage(req(detailPath(id), { session: ALICE_SESSION }), env, 'alice', 'dock', id),
    ]) {
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src'); // script-free: nothing to allow
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });

  it('the 404 page carries the same hardened headers', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    const res = await handleParleyListPage(req(listPath, { session: MALLORY_SESSION }), env, 'alice', 'dock');
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });
});

// ── Routing through the real worker dispatcher ───────────────────────────────

describe('route wiring (worker.fetch)', () => {
  /**
   * `notFoundPage` in parleys-page.ts says the quiet part out loud: "telling
   * you a parley exists but is closed to you would be its own kind of leak."
   * The router did not hold up its end.
   *
   * `.map(decodeURIComponent)` on the /account/parleys/ branch was UNGUARDED,
   * so a malformed percent-escape threw URIError straight past the routing and
   * into the worker's global boundary — which answers 500 INTERNAL_ERROR. A 500
   * and a 404 are as distinguishable as answers get, so "your escape sequence
   * was bad" was a different reply from "no such parley", on a surface whose
   * whole design is that those must be one reply.
   *
   * The sibling harbors branch already guarded its decode. This one did not,
   * and nothing tested it.
   */
  it('a malformed percent-escape in a parley path is a 404, not a 500', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);

    const malformed = await worker.fetch(
      req('/account/parleys/%ZZ/dock', { session: ALICE_SESSION }), env, {} as ExecutionContext,
    );
    expect(malformed.status).toBe(404);
    const body = await malformed.text();
    expect(body).not.toMatch(/INTERNAL_ERROR/);

    // Premise: a real page came back, not an empty body. Without this the
    // byte-identity assertion below passes for two empty strings.
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('Not found');

    // …and byte-identical to the 404 a well-formed but nonexistent parley
    // gets, because two 404s with different bodies are still two answers.
    const ghost = await worker.fetch(
      req('/account/parleys/alice/ghost', { session: ALICE_SESSION }), env, {} as ExecutionContext,
    );
    expect(ghost.status).toBe(404);
    expect(body).toBe(await ghost.text());
  });

  /**
   * The router builds this 404 itself, on a construction path the handler tests
   * never reach. A 404 that is cacheable or indexable leaks the same fact the
   * body is careful not to state.
   */
  it('the router-built parley 404 carries no-store, noindex and a script-free CSP', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);

    for (const path of ['/account/parleys/%ZZ/dock', '/account/parleys/alice/ghost']) {
      const res = await worker.fetch(
        req(path, { session: ALICE_SESSION }), env, {} as ExecutionContext,
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src');
      expect(await res.text()).not.toMatch(/<script[\s>]/i);
    }
  });

  it('dispatches list, detail, and sign to the right handlers', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    await seedDock(env);
    const id = await convene(env);

    const list = await worker.fetch(req(listPath, { session: ALICE_SESSION }), env, {} as ExecutionContext);
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('who merges the auth refactor first');

    const detail = await worker.fetch(req(detailPath(id), { session: ALICE_SESSION }), env, {} as ExecutionContext);
    expect(detail.status).toBe(200);

    const sign = await worker.fetch(
      req(signPath(id), { method: 'POST', session: ALICE_SESSION, origin: BASE, form: { stance: 'accept' } }),
      env, {} as ExecutionContext,
    );
    expect(sign.status).toBe(303);
    expect(fx.positions.find((p) => p.parley_id === id && p.party_id === 'u_alice')!.stance).toBe('accept');
  });

  it('404s an unknown shape under /account/parleys/', async () => {
    const fx = makeParleyDb();
    const env = makeParleyEnv(fx.db);
    const res = await worker.fetch(
      req('/account/parleys/a/b/c/d/e', { session: ALICE_SESSION }), env, {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });
});

// ── Deadline formatting ──────────────────────────────────────────────────────

describe('fmtRemaining', () => {
  it('renders days, hours, and minutes at human scale', () => {
    expect(fmtRemaining(T0 + 90, T0)).toBe('1m left');
    expect(fmtRemaining(T0 + 45 * 60, T0)).toBe('45m left');
    expect(fmtRemaining(T0 + 3 * 3600 + 12 * 60, T0)).toBe('3h 12m left');
    expect(fmtRemaining(T0 + 50 * 3600, T0)).toBe('2d 2h left');
  });

  it('says the deadline passed rather than rendering negative time', () => {
    expect(fmtRemaining(T0 - 1, T0)).toBe('deadline passed');
    expect(fmtRemaining(T0, T0)).toBe('deadline passed');
  });
});
