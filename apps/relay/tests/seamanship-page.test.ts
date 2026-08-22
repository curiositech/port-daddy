/**
 * Tests for the Seamanship HTML surfaces (src/seamanship-page.ts):
 *   - /account/seamanship auth-gates anonymously (302 /login, like /account).
 *   - PRIVATE RENDERS UNMARKED — the load-bearing design law of this page.
 *     `listed` and `public` are the only tiers that get a badge, because they
 *     are the only tiers anyone chose.
 *   - the public directory never shows a private skill, never shows a body, and
 *     never shows which repository a skill lives in.
 *   - a listed skill's body page renders the listed payload and refuses the body;
 *     a public skill's body page requires a session.
 *   - hostile skill names / descriptions / tags render escaped.
 *   - transport: no-store + noindex + script-free CSP on the member page.
 *   - empty states teach instead of fabricating rows, including the primary
 *     empty state (nothing opted in, which is the truth today).
 *   - the Snipe section states the ship's REAL pd-fleet.yml configuration.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handlePublicSkillPage,
  handlePublicSkillsPage,
  handleSeamanshipPage,
  handleSeamanshipPublishForm,
  renderPublicDirectory,
  visibilityMarker,
} from '../src/seamanship-page.js';
import { syncSkillListings } from '../src/seamanship.js';
import { resolveSession } from '../src/auth-github.js';
import {
  BASE,
  LOGIN,
  makeSeamanshipFixture,
  req,
  skillMd,
  type FakeRepo,
} from './support/seamanship-fixture.js';

afterEach(() => vi.unstubAllGlobals());

const PRIVATE_SKILL = skillMd(
  [
    'name: harbor-quota-tuner',
    'description: Tune per-harbor daily budgets from observed traffic.',
    'metadata:',
    '  category: operations',
    '  tags:',
    '    - quota',
  ].join('\n'),
  'PRIVATE BODY SENTINEL.\n',
);

const LISTED_SKILL = skillMd(
  [
    'name: signal-flag-composer',
    'description: Pick an ICS flag whose real meaning matches the section.',
    'visibility: listed',
    'metadata:',
    "  pairs-with:",
    '    - skill: color-contrast-auditor',
    '    - never-authored-skill',
  ].join('\n'),
  'LISTED BODY SENTINEL.\n',
);

const PUBLIC_SKILL = skillMd(
  ['name: skill-architect', 'description: Author a new skill from a brief.', 'visibility: public'].join('\n'),
  'PUBLIC BODY SENTINEL.\n',
);

const COLOR_SKILL = skillMd(
  ['name: color-contrast-auditor', 'description: Check contrast in both themes.'].join('\n'),
);

function fullRepo(): FakeRepo {
  return {
    fullName: 'curiositech/port-daddy',
    defaultBranch: 'main',
    skills: {
      'harbor-quota-tuner': PRIVATE_SKILL,
      'signal-flag-composer': LISTED_SKILL,
      'skill-architect': PUBLIC_SKILL,
      'color-contrast-auditor': COLOR_SKILL,
    },
  };
}

async function session(env: Parameters<typeof resolveSession>[1]) {
  const s = await resolveSession(req('/account/seamanship'), env);
  if (!s) throw new Error('fixture session did not resolve');
  return s;
}

// ══════════════════════════════════════════════════════════════════════════
//  /account/seamanship — the session gate
// ══════════════════════════════════════════════════════════════════════════

describe('GET /account/seamanship — session gate', () => {
  it('redirects to /login with no session cookie', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const res = await handleSeamanshipPage(new Request(`${BASE}/account/seamanship`), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('redirects to /login on an unknown session cookie', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const res = await handleSeamanshipPage(req('/account/seamanship', { cookie: '__Host-pd_session=nope' }), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('reads nothing from GitHub before the session resolves', async () => {
    const { env, store } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    await handleSeamanshipPage(new Request(`${BASE}/account/seamanship`), env);
    expect(store.ghCalls).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  Visibility markers — private is the UNMARKED case
// ══════════════════════════════════════════════════════════════════════════

describe('visibilityMarker', () => {
  it('renders nothing at all for private', () => {
    expect(visibilityMarker('private')).toBe('');
  });

  it('marks the two tiers somebody chose', () => {
    expect(visibilityMarker('listed')).toContain('listed');
    expect(visibilityMarker('public')).toContain('public');
    expect(visibilityMarker('public')).toContain('vis-public');
  });
});

describe('GET /account/seamanship — the catalog', () => {
  it('lists every skill grouped by repo, with description and category', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('curiositech/port-daddy');
    expect(html).toContain('harbor-quota-tuner');
    expect(html).toContain('Tune per-harbor daily budgets');
    expect(html).toContain('operations');
    expect(html).toContain('4 skills');
  });

  it('badges listed and public, and leaves private skills unmarked', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('vis vis-listed');
    expect(html).toContain('vis vis-public');
    // Exactly two badges for four skills — the other two carry none.
    expect(html.match(/class="vis /g) ?? []).toHaveLength(2);
    // ...and no invented "private" badge anywhere in the catalog markup.
    expect(html).not.toContain('vis-private');
  });

  it('never renders a SKILL.md body on the account page', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).not.toContain('BODY SENTINEL');
  });

  it('renders curated pairs-with neighbours, marking undeclared ones as absent', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('pairs');
    expect(html).toContain('color-contrast-auditor');
    expect(html).toContain('never-authored-skill');
    expect(html).toContain('class="absent"');
  });

  it('teaches the opt-in rather than offering a bulk publish switch', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('visibility: listed');
    expect(html).toContain('scoped to');
    expect(html).toContain('your repos');
    expect(html).toContain('per skill');
  });

  it('says "degraded", not "empty", when the repos could not be read', async () => {
    const { env } = await makeSeamanshipFixture(
      { repos: [fullRepo()], installationsUnavailable: true },
      vi.stubGlobal,
    );
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('could not be read');
    expect(html).not.toContain('harbor-quota-tuner');
  });

  it('teaches instead of fabricating rows when no skills/ directory exists', async () => {
    const { env } = await makeSeamanshipFixture(
      { repos: [{ fullName: 'acme/plain', skills: {}, noSkillsDir: true }] },
      vi.stubGlobal,
    );
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('No <span class="cmd">skills/</span> directory found');
    expect(html).not.toContain('class="skill-row"');
  });

  it('states that graft history lives in the daemon, and renders no graft rows', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('Graft history lives in your daemon');
    expect(html).toContain('pd seamanship outcomes');
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  The Snipe section — real config, not filler
// ══════════════════════════════════════════════════════════════════════════

describe('GET /account/seamanship — the Snipe section', () => {
  it('describes the engine-room rate and the ship’s real configuration', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('Snipe, the Engineman');
    expect(html).toContain('engine-room crew');
    expect(html).toContain('below the waterline');
    // Facts checkable against pd-fleet.yml / fleet/ships/snipe.md
    expect(html).toContain('pull_request:opened');
    expect(html).toContain('ideation');
    expect(html).toContain('advisory');
    expect(html).toContain('FLEET-VERDICT: PASS (advisory)');
    expect(html).toContain('singleton: true');
    expect(html).toContain('<code>Read</code>');
    expect(html).toContain('<code>Grep</code>');
    expect(html).toContain('<code>Glob</code>');
    expect(html).toContain('pd dispatch propose');
    expect(html).toContain('skill-architect');
  });

  it('does not claim Snipe writes code, opens PRs, or blocks a merge', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).toContain('never block a merge');
    expect(html).toContain('cannot write a file');
    expect(html).toContain('does not write the skill');
  });

  it('names no model or backend id in the rendered page', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    // '@cf/' prefixes every Workers AI model id in this repo's config.
    expect(html).not.toContain('@cf/');
    expect(html).not.toContain('cli:');
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  Escaping + transport
// ══════════════════════════════════════════════════════════════════════════

describe('GET /account/seamanship — XSS guard', () => {
  it('escapes hostile names, descriptions, tags and pairs-with ids', async () => {
    const hostile = skillMd(
      [
        'name: "<img src=x onerror=alert(1)>"',
        'description: \'"><script>alert(2)</script>\'',
        'visibility: listed',
        'metadata:',
        '  category: "<b>cat</b>"',
        '  tags:',
        '    - "<i>tag</i>"',
        "  pairs-with:",
        '    - "<svg onload=alert(3)>"',
      ].join('\n'),
    );
    const { env } = await makeSeamanshipFixture(
      { repos: [{ fullName: 'acme/widgets', skills: { hostile } }] },
      vi.stubGlobal,
    );
    const html = await (await handleSeamanshipPage(req('/account/seamanship'), env)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<svg onload=');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('GET /account/seamanship — transport headers', () => {
  it('serves no-store, noindex HTML under a script-free CSP', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const res = await handleSeamanshipPage(req('/account/seamanship'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    // The publish control is a plain form, so form-action must allow self.
    expect(csp).toContain("form-action 'self'");
    expect(await res.text()).not.toContain('<script');
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  The publish form
// ══════════════════════════════════════════════════════════════════════════

describe('POST /account/seamanship/publish', () => {
  it('publishes and redirects back with the count', async () => {
    const { env, store } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const res = await handleSeamanshipPublishForm(
      req('/account/seamanship/publish', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/seamanship?listed=2');
    expect([...store.listings.values()].map((r) => r.skill_id).sort()).toEqual([
      'signal-flag-composer',
      'skill-architect',
    ]);
  });

  it('refuses an anonymous POST and a cross-origin POST, changing nothing', async () => {
    const { env, store } = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    const anon = await handleSeamanshipPublishForm(
      new Request(`${BASE}/account/seamanship/publish`, { method: 'POST' }),
      env,
    );
    expect(anon.status).toBe(302);

    const cross = await handleSeamanshipPublishForm(
      new Request(`${BASE}/account/seamanship/publish`, {
        method: 'POST',
        headers: { Cookie: req('/').headers.get('Cookie') ?? '', Origin: 'https://evil.example' },
      }),
      env,
    );
    expect(cross.status).toBe(403);
    expect(store.listings.size).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  /skills — the public directory
// ══════════════════════════════════════════════════════════════════════════

describe('GET /skills — public directory', () => {
  async function published() {
    const fx = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    await syncSkillListings(fx.env, await session(fx.env));
    return fx;
  }

  it('shows opted-in skills to an anonymous visitor, namespaced', async () => {
    const { env } = await published();
    const res = await handlePublicSkillsPage(new Request(`${BASE}/skills`), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`@${LOGIN}/signal-flag-composer`);
    expect(html).toContain(`@${LOGIN}/skill-architect`);
  });

  it('never shows a private skill, a body, or a repository name', async () => {
    const { env } = await published();
    const html = await (await handlePublicSkillsPage(new Request(`${BASE}/skills`), env)).text();
    expect(html).not.toContain('harbor-quota-tuner');
    expect(html).not.toContain('color-contrast-auditor');
    expect(html).not.toContain('BODY SENTINEL');
    expect(html).not.toContain('curiositech/port-daddy');
  });

  it('renders the primary empty state when nothing has been opted in', () => {
    const html = renderPublicDirectory([], null);
    expect(html).toContain('Nothing is published here yet, and that is the default');
    expect(html).toContain('private by default');
    expect(html).not.toContain('class="dir-row"');
  });

  it('escapes hostile listed text', () => {
    const html = renderPublicDirectory(
      [
        {
          qualifiedId: '@erichowens/<img src=x onerror=alert(1)>',
          name: 'x',
          description: '"><script>alert(2)</script>',
        },
      ],
      null,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  /skills/@login/id — the body page
// ══════════════════════════════════════════════════════════════════════════

describe('GET /skills/@login/id', () => {
  async function published() {
    const fx = await makeSeamanshipFixture({ repos: [fullRepo()] }, vi.stubGlobal);
    await syncSkillListings(fx.env, await session(fx.env));
    return fx;
  }

  it('renders the full body for a public skill to a signed-in visitor', async () => {
    const { env } = await published();
    const res = await handlePublicSkillPage(
      req(`/skills/@${LOGIN}/skill-architect`),
      env,
      `@${LOGIN}/skill-architect`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.text()).toContain('PUBLIC BODY SENTINEL');
  });

  it('refuses the body to an anonymous visitor and explains why', async () => {
    const { env } = await published();
    const res = await handlePublicSkillPage(
      new Request(`${BASE}/skills/@${LOGIN}/skill-architect`),
      env,
      `@${LOGIN}/skill-architect`,
    );
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).not.toContain('BODY SENTINEL');
    expect(html).toContain('portdaddy.dev account');
    expect(html).toContain('/login');
  });

  it('refuses a LISTED skill’s body even to a signed-in visitor', async () => {
    const { env } = await published();
    const res = await handlePublicSkillPage(
      req(`/skills/@${LOGIN}/signal-flag-composer`),
      env,
      `@${LOGIN}/signal-flag-composer`,
    );
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).not.toContain('LISTED BODY SENTINEL');
    // The listed payload it WAS entitled to still renders.
    expect(html).toContain('ICS flag');
  });

  it('404s an unpublished skill exactly as it 404s a nonexistent one', async () => {
    const { env } = await published();
    const unpublished = await handlePublicSkillPage(
      req(`/skills/@${LOGIN}/harbor-quota-tuner`),
      env,
      `@${LOGIN}/harbor-quota-tuner`,
    );
    const nonexistent = await handlePublicSkillPage(
      req(`/skills/@${LOGIN}/no-such-thing`),
      env,
      `@${LOGIN}/no-such-thing`,
    );
    expect(unpublished.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(await unpublished.text()).toBe(await nonexistent.text());
  });

  it('404s a malformed qualified id', async () => {
    const { env } = await published();
    const res = await handlePublicSkillPage(req('/skills/not-a-namespace'), env, 'not-a-namespace');
    expect(res.status).toBe(404);
  });
});
