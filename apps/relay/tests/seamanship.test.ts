/**
 * Tests for the Seamanship data plane (src/seamanship.ts) — G'3's catalog read
 * and G'7's opt-in public listing.
 *
 * The operator's ruling is the spec these tests enforce:
 *
 *   "Skills need to be particular to a person and a repo for now. We do not
 *    distribute these 300 skills, they're Erich Owens' and they are particular
 *    to his repos."
 *
 * So the suite is organised around the ways that could quietly stop being true:
 *   - a private skill reaching the public projection,
 *   - a listed skill's BODY reaching anyone,
 *   - a public body reaching an anonymous caller,
 *   - a garbage `visibility:` value being read as permission,
 *   - a stale published row outliving the repo line that authorised it,
 *   - the public JSON leaking which repositories these skills live in.
 *
 * Catalogs are parsed by the production parser from real SKILL.md TEXT served by
 * the GitHub stub (tests/support/seamanship-fixture.ts) — never from hand-built
 * entry objects, so `parseVisibility` is genuinely in the loop.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  allSkills,
  handlePublicSkillBody,
  handlePublicSkillsListing,
  handleSeamanshipPublish,
  isPublishableSkill,
  listedProjection,
  parseQualifiedSkillId,
  parseSkillEntry,
  qualifySkillId,
  resolvePairsWith,
  resolveSkillBody,
  scanOperatorCatalog,
  splitSkillMarkdown,
  syncSkillListings,
  type RelaySkillEntry,
} from '../src/seamanship.js';
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

// ── fixture SKILL.md set ─────────────────────────────────────────────────────
//
// One file per tier, plus the malformed cases. These are the "fixture SKILL.md
// set" the catalog-parse tests read; every other test reuses them so the tiers
// under test are always the tiers a real parse produced.

const PRIVATE_SKILL = skillMd(
  [
    'name: harbor-quota-tuner',
    'description: Tune per-harbor daily budgets from observed traffic.',
    'metadata:',
    '  category: operations',
    '  tags:',
    '    - quota',
    '    - budgets',
  ].join('\n'),
  'THIS BODY IS PRIVATE AND MUST NEVER BE SERVED.\n',
);

const LISTED_SKILL = skillMd(
  [
    'name: signal-flag-composer',
    'description: Pick an ICS flag whose real meaning matches the section.',
    'visibility: listed',
    'owner: Erich Owens',
    'metadata:',
    '  category: design',
    '  tags:',
    '    - flags',
    "  pairs-with:",
    '    - skill: color-contrast-auditor',
    '      reason: flags must survive both themes',
    '    - never-authored-skill',
  ].join('\n'),
  'LISTED BODY SENTINEL - name and description only, never this text.\n',
);

const PUBLIC_SKILL = skillMd(
  [
    'name: skill-architect',
    'description: Author a new skill from a brief, with research first.',
    '  ',
    'visibility: "  PUBLIC  "',
    'repos:',
    '  - curiositech/port-daddy',
  ].join('\n'),
  'PUBLIC BODY SENTINEL - the whole SKILL.md is open to signed-in accounts.\n',
);

const GARBAGE_VISIBILITY_SKILL = skillMd(
  [
    'name: typo-tier',
    'description: Its author typed a tier that does not exist.',
    'visibility: publik',
  ].join('\n'),
  'GARBAGE TIER BODY SENTINEL.\n',
);

const ARRAY_VISIBILITY_SKILL = skillMd(
  [
    'name: array-tier',
    'description: Its visibility is a list, not a string.',
    'visibility:',
    '  - public',
  ].join('\n'),
  'ARRAY TIER BODY SENTINEL.\n',
);

const NO_FRONTMATTER_SKILL = 'Just prose. No frontmatter at all.\n';

const MISSING_DESCRIPTION_SKILL = skillMd('name: nameless-purpose', 'Body.\n');

const COLOR_SKILL = skillMd(
  ['name: color-contrast-auditor', 'description: Check contrast in both themes.', 'visibility: listed'].join('\n'),
);

function repoWithEverything(): FakeRepo {
  return {
    fullName: 'curiositech/port-daddy',
    defaultBranch: 'main',
    skills: {
      'harbor-quota-tuner': PRIVATE_SKILL,
      'signal-flag-composer': LISTED_SKILL,
      'skill-architect': PUBLIC_SKILL,
      'typo-tier': GARBAGE_VISIBILITY_SKILL,
      'array-tier': ARRAY_VISIBILITY_SKILL,
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
//  Catalog parse from a fixture SKILL.md set
// ══════════════════════════════════════════════════════════════════════════

describe('parseSkillEntry — catalog parse from fixture SKILL.md files', () => {
  const at = (t: string, id = 'x') => parseSkillEntry(t, 'acme/widgets', `skills/${id}/SKILL.md`);

  it('reads name, description, category, tags, owner, repos and pairs-with', () => {
    const e = at(LISTED_SKILL, 'signal-flag-composer');
    expect(e).not.toBeNull();
    expect(e?.id).toBe('signal-flag-composer');
    expect(e?.description).toContain('ICS flag');
    expect(e?.category).toBe('design');
    expect(e?.tags).toEqual(['flags']);
    expect(e?.owner).toBe('Erich Owens');
    expect(e?.visibility).toBe('listed');
    // Both `pairs-with` entry shapes count as the same curated edge.
    expect(e?.pairsWith).toEqual(['color-contrast-auditor', 'never-authored-skill']);
    expect(e?.repoFullName).toBe('acme/widgets');
  });

  it('defaults an undeclared visibility to private, and records no owner', () => {
    const e = at(PRIVATE_SKILL, 'harbor-quota-tuner');
    expect(e?.visibility).toBe('private');
    expect(e?.owner).toBeUndefined();
    expect(e?.declaredRepos).toEqual([]);
  });

  it('normalises whitespace and case in a declared tier', () => {
    // `visibility: "  PUBLIC  "` is a real, deliberate opt-in — trimmed and
    // lowercased, not rejected for cosmetics.
    const e = at(PUBLIC_SKILL, 'skill-architect');
    expect(e?.visibility).toBe('public');
    expect(e?.declaredRepos).toEqual(['curiositech/port-daddy']);
  });

  it('fails closed to private on an unknown tier, and warns', () => {
    const warnings: string[] = [];
    const e = parseSkillEntry(GARBAGE_VISIBILITY_SKILL, 'acme/widgets', 'skills/typo-tier/SKILL.md', (w) =>
      warnings.push(w),
    );
    expect(e?.visibility).toBe('private');
    expect(warnings.join(' ')).toContain('unknown visibility');
  });

  it('fails closed to private when visibility is a list, not a string', () => {
    // ['public'] must not stringify its way into a grant.
    expect(at(ARRAY_VISIBILITY_SKILL, 'array-tier')?.visibility).toBe('private');
  });

  it('skips a file with no frontmatter and one missing a description', () => {
    expect(at(NO_FRONTMATTER_SKILL)).toBeNull();
    expect(at(MISSING_DESCRIPTION_SKILL)).toBeNull();
  });

  it('splits frontmatter from body without swallowing the body', () => {
    const split = splitSkillMarkdown(PUBLIC_SKILL);
    expect(split?.body).toContain('PUBLIC BODY SENTINEL');
    expect(split?.frontmatter.name).toBe('skill-architect');
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  The ONE gate
// ══════════════════════════════════════════════════════════════════════════

describe('isPublishableSkill — the single predicate, reached through this module', () => {
  it('is the same function object the Node catalog loader exports', async () => {
    const shared = await import('../../../lib/shipwright/skill-visibility.js');
    // Not "behaves the same" — literally the same binding. A second copy is the
    // drift the operator's ruling forbids.
    expect(isPublishableSkill).toBe(shared.isPublishableSkill);
  });

  it('holds the full truth table', () => {
    const e = (visibility: 'private' | 'listed' | 'public') => ({ visibility });
    expect(isPublishableSkill(e('private'), 'listed')).toBe(false);
    expect(isPublishableSkill(e('private'), 'public')).toBe(false);
    expect(isPublishableSkill(e('listed'), 'listed')).toBe(true);
    expect(isPublishableSkill(e('listed'), 'public')).toBe(false);
    expect(isPublishableSkill(e('public'), 'listed')).toBe(true);
    expect(isPublishableSkill(e('public'), 'public')).toBe(true);
  });

  it('fails closed on an unknown tier even for a public skill', () => {
    for (const tier of ['internal', '', 'LISTED', 'Public', 'full-bodies']) {
      expect(isPublishableSkill({ visibility: 'public' }, tier as 'listed')).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  The scan
// ══════════════════════════════════════════════════════════════════════════

describe('scanOperatorCatalog', () => {
  it('reads every SKILL.md at the default branch, grouped by repo', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const scan = await scanOperatorCatalog(env, await session(env));
    expect(scan.installationsKnown).toBe(true);
    expect(scan.repos).toHaveLength(1);
    expect(scan.repos[0]?.repoFullName).toBe('curiositech/port-daddy');
    expect(scan.repos[0]?.ref).toBe('main');
    expect(allSkills(scan).map((s) => s.id).sort()).toEqual([
      'array-tier',
      'color-contrast-auditor',
      'harbor-quota-tuner',
      'signal-flag-composer',
      'skill-architect',
      'typo-tier',
    ]);
  });

  it('never reads a ref other than the repo default branch', async () => {
    const { env, store } = await makeSeamanshipFixture(
      { repos: [{ ...repoWithEverything(), defaultBranch: 'trunk' }] },
      vi.stubGlobal,
    );
    await scanOperatorCatalog(env, await session(env));
    const refs = store.ghCalls
      .map((u) => new URL(u).searchParams.get('ref'))
      .filter((r): r is string => r !== null);
    expect(refs.length).toBeGreaterThan(0);
    expect([...new Set(refs)]).toEqual(['trunk']);
  });

  it('reports "unknown", not "empty", when the installations cannot be read', async () => {
    const { env } = await makeSeamanshipFixture(
      { repos: [repoWithEverything()], installationsUnavailable: true },
      vi.stubGlobal,
    );
    const scan = await scanOperatorCatalog(env, await session(env));
    expect(scan.installationsKnown).toBe(false);
    expect(scan.repos).toEqual([]);
  });

  it('treats a repo with no skills/ directory as empty, not as an error', async () => {
    const { env } = await makeSeamanshipFixture(
      { repos: [{ fullName: 'acme/plain', skills: {}, noSkillsDir: true }] },
      vi.stubGlobal,
    );
    const scan = await scanOperatorCatalog(env, await session(env));
    expect(scan.repos[0]?.noSkillsDir).toBe(true);
    expect(allSkills(scan)).toEqual([]);
  });

  it('honours the per-view read budget and says the view is partial', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const scan = await scanOperatorCatalog(env, await session(env), { maxSkillReads: 2 });
    expect(scan.skillsTruncated).toBe(true);
    expect(allSkills(scan)).toHaveLength(2);
  });

  it('serves a second view from the D1 frontmatter cache, not from GitHub', async () => {
    const { env, store } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const s = await session(env);
    await scanOperatorCatalog(env, s);
    const afterFirst = store.ghCalls.filter((u) => u.includes('SKILL.md')).length;
    expect(afterFirst).toBe(6);
    await scanOperatorCatalog(env, s);
    const afterSecond = store.ghCalls.filter((u) => u.includes('SKILL.md')).length;
    expect(afterSecond).toBe(6); // not one more file read
    // ...and the cached rows still resolve to the tiers the repo declared.
    const again = await scanOperatorCatalog(env, s);
    const byId = new Map(allSkills(again).map((e) => [e.id, e.visibility]));
    expect(byId.get('skill-architect')).toBe('public');
    expect(byId.get('signal-flag-composer')).toBe('listed');
    expect(byId.get('typo-tier')).toBe('private');
  });

  it('caches frontmatter only — no body text is written to D1', async () => {
    const { env, store } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    await scanOperatorCatalog(env, await session(env));
    const serialized = JSON.stringify([...store.cache.values()]);
    expect(serialized).not.toContain('BODY SENTINEL');
    expect(serialized).not.toContain('THIS BODY IS PRIVATE');
  });
});

describe('resolvePairsWith — curated edges only, honestly labelled', () => {
  it('marks declared neighbours present in the scan as known and others as not', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const scan = await scanOperatorCatalog(env, await session(env));
    const entry = allSkills(scan).find((s) => s.id === 'signal-flag-composer') as RelaySkillEntry;
    expect(resolvePairsWith(entry, scan)).toEqual([
      { id: 'color-contrast-auditor', known: true },
      { id: 'never-authored-skill', known: false },
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  G'7 — the listed projection
// ══════════════════════════════════════════════════════════════════════════

describe('listedProjection', () => {
  it('carries listed and public skills, and NEVER a private one', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const scan = await scanOperatorCatalog(env, await session(env));
    const ids = listedProjection(allSkills(scan), LOGIN).map((p) => p.listed.qualifiedId);
    expect(ids.sort()).toEqual([
      `@${LOGIN}/color-contrast-auditor`,
      `@${LOGIN}/signal-flag-composer`,
      `@${LOGIN}/skill-architect`,
    ]);
    // the private one, the typo'd one and the array one are all absent
    expect(ids.join(' ')).not.toContain('harbor-quota-tuner');
    expect(ids.join(' ')).not.toContain('typo-tier');
    expect(ids.join(' ')).not.toContain('array-tier');
  });

  it('emits exactly a qualified id, a name and a description — nothing else', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const scan = await scanOperatorCatalog(env, await session(env));
    const [first] = listedProjection(allSkills(scan), LOGIN);
    expect(Object.keys(first?.listed ?? {}).sort()).toEqual(['description', 'name', 'qualifiedId']);
  });
});

describe('qualified ids', () => {
  it('namespaces on the account login', () => {
    expect(qualifySkillId('erichowens', 'skill-architect')).toBe('@erichowens/skill-architect');
  });

  it('round-trips a well-formed id', () => {
    expect(parseQualifiedSkillId('@erichowens/skill-architect')).toEqual({
      login: 'erichowens',
      id: 'skill-architect',
    });
  });

  it('rejects the shapes a path segment could smuggle in', () => {
    for (const bad of [
      'erichowens/skill',        // no @
      '@/skill',                 // empty login
      '@erichowens',             // no skill
      '@erichowens/',            // empty skill
      '@erich owens/skill',      // space
      "@erichowens/%' OR 1=1--", // SQL-ish
      '@erichowens/../../etc',   // traversal
      '@erichowens/a/b',         // extra segment
    ]) {
      expect(parseQualifiedSkillId(bad)).toBeNull();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  Publish / withdraw
// ══════════════════════════════════════════════════════════════════════════

describe('syncSkillListings', () => {
  it('publishes only what the gate authorises at the listed tier', async () => {
    const { env, store } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const out = await syncSkillListings(env, await session(env));
    expect(out.ok).toBe(true);
    expect([...store.listings.values()].map((r) => r.skill_id).sort()).toEqual([
      'color-contrast-auditor',
      'signal-flag-composer',
      'skill-architect',
    ]);
    expect(JSON.stringify([...store.listings.values()])).not.toContain('BODY SENTINEL');
  });

  it('withdraws a skill whose visibility line was removed from the repo', async () => {
    const repo = repoWithEverything();
    const { env, store } = await makeSeamanshipFixture({ repos: [repo] }, vi.stubGlobal);
    const s = await session(env);
    await syncSkillListings(env, s);
    expect(store.listings.has(`${LOGIN} signal-flag-composer`)).toBe(true);

    // The author deletes the visibility line, and the cache expires.
    repo.skills['signal-flag-composer'] = skillMd(
      ['name: signal-flag-composer', 'description: Pick an ICS flag whose meaning matches.'].join('\n'),
    );
    store.cache.clear();

    await syncSkillListings(env, s);
    expect(store.listings.has(`${LOGIN} signal-flag-composer`)).toBe(false);
    expect(store.listings.has(`${LOGIN} skill-architect`)).toBe(true);
  });

  it('publishes and withdraws NOTHING when the repos could not be read', async () => {
    const { env, store } = await makeSeamanshipFixture(
      {
        repos: [repoWithEverything()],
        installationsUnavailable: true,
        listings: [
          {
            namespace: LOGIN,
            skill_id: 'skill-architect',
            name: 'skill-architect',
            description: 'Author a new skill from a brief.',
            repo_full_name: 'curiositech/port-daddy',
            source_path: 'skills/skill-architect/SKILL.md',
          },
        ],
      },
      vi.stubGlobal,
    );
    const out = await syncSkillListings(env, await session(env));
    expect(out.ok).toBe(false);
    // A GitHub outage must not empty someone's directory.
    expect(store.listings.size).toBe(1);
  });

  /**
   * The sibling of the test above, and the one that was missing.
   *
   * That test proves the invariant for a 500 on `/user/installations`. The
   * fixture's `/user/installations/:id/repositories` stub always answered 200,
   * so nothing could reach the OTHER degraded read — and a GitHub rate limit
   * lands there far more often, because it is called once per installation.
   *
   * `listInstallationRepos` swallowed a non-ok repositories response with a
   * bare `continue` and returned `{ repos: [], truncated: false }` — an empty
   * array, not null. `scanOperatorCatalog` only treats NULL as degraded, so
   * `installationsKnown` went true, `syncSkillListings` sailed past its guard,
   * and its unconditional `DELETE FROM skill_listings WHERE namespace = ?`
   * un-published the operator's entire public directory because GitHub was
   * briefly rate-limiting them.
   *
   * The module's own doc forbids exactly this: "A scan that could not read the
   * repos publishes and un-publishes NOTHING: a GitHub outage must not be able
   * to silently empty a directory."
   */
  it('a 429 on the repositories read is UNKNOWN, not an empty catalog', async () => {
    const { env, store } = await makeSeamanshipFixture(
      { repos: [repoWithEverything()], reposUnavailable: true },
      vi.stubGlobal,
    );
    const scan = await scanOperatorCatalog(env, await session(env));

    // Premise: the installations list read FINE and the repositories call was
    // actually attempted. Without this the test would also pass for a failure
    // one step earlier, which the neighbouring test already covers — and would
    // prove nothing about this path.
    const paths = store.ghCalls.map((u) => new URL(u).pathname);
    expect(paths).toContain('/user/installations');
    expect(paths.some((p) => /^\/user\/installations\/\d+\/repositories$/.test(p))).toBe(true);

    expect(scan.installationsKnown).toBe(false);
    expect(scan.repos).toEqual([]);
  });

  it('publishes and withdraws NOTHING when a 429 truncates the repo read', async () => {
    const { env, store } = await makeSeamanshipFixture(
      {
        repos: [repoWithEverything()],
        reposUnavailable: true,
        listings: [
          {
            namespace: LOGIN,
            skill_id: 'skill-architect',
            name: 'skill-architect',
            description: 'Author a new skill from a brief.',
            repo_full_name: 'curiositech/port-daddy',
            source_path: 'skills/skill-architect/SKILL.md',
          },
        ],
      },
      vi.stubGlobal,
    );
    // Premise: there is something to lose. Without this the survival assertion
    // below passes against an empty table.
    expect(store.listings.size).toBe(1);

    const out = await syncSkillListings(env, await session(env));
    expect(out.ok).toBe(false);
    expect(out.ok === false ? out.code : null).toBe('CATALOG_UNAVAILABLE');
    // The whole point: a rate limit must not silently unpublish a directory.
    expect(store.listings.size).toBe(1);
  });

  it('refuses a cross-origin POST and an anonymous POST', async () => {
    const { env } = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    const anon = await handleSeamanshipPublish(
      new Request(`${BASE}/v1/seamanship/publish`, { method: 'POST' }),
      env,
    );
    expect(anon.status).toBe(401);

    const cross = await handleSeamanshipPublish(
      new Request(`${BASE}/v1/seamanship/publish`, {
        method: 'POST',
        headers: { Cookie: req('/').headers.get('Cookie') ?? '', Origin: 'https://evil.example' },
      }),
      env,
    );
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ code: 'CROSS_ORIGIN' });
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  The public API surfaces
// ══════════════════════════════════════════════════════════════════════════

describe('GET /v1/skills — the public directory', () => {
  async function published() {
    const fx = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    await syncSkillListings(fx.env, await session(fx.env));
    return fx;
  }

  it('serves names and descriptions to an anonymous caller', async () => {
    const { env } = await published();
    const res = await handlePublicSkillsListing(new Request(`${BASE}/v1/skills`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tier: string; skills: Array<Record<string, unknown>> };
    expect(body.tier).toBe('listed');
    expect(body.skills.map((s) => s.qualifiedId).sort()).toEqual([
      `@${LOGIN}/color-contrast-auditor`,
      `@${LOGIN}/signal-flag-composer`,
      `@${LOGIN}/skill-architect`,
    ]);
  });

  it('never carries a body, a tag, or a repository name', async () => {
    const { env } = await published();
    const res = await handlePublicSkillsListing(new Request(`${BASE}/v1/skills`), env);
    const text = await res.text();
    expect(text).not.toContain('BODY SENTINEL');
    expect(text).not.toContain('curiositech/port-daddy');
    expect(text).not.toContain('SKILL.md');
    const body = JSON.parse(text) as { skills: Array<Record<string, unknown>> };
    for (const s of body.skills) {
      expect(Object.keys(s).sort()).toEqual(['description', 'name', 'qualifiedId']);
    }
  });

  it('never carries a private skill', async () => {
    const { env } = await published();
    const text = await (await handlePublicSkillsListing(new Request(`${BASE}/v1/skills`), env)).text();
    expect(text).not.toContain('harbor-quota-tuner');
    expect(text).not.toContain('typo-tier');
    expect(text).not.toContain('array-tier');
  });

  it('rejects a malformed namespace filter instead of querying with it', async () => {
    const { env } = await published();
    const res = await handlePublicSkillsListing(
      new Request(`${BASE}/v1/skills?namespace=${encodeURIComponent("' OR 1=1--")}`),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/skills/@login/id — the public-tier body', () => {
  async function published() {
    const fx = await makeSeamanshipFixture({ repos: [repoWithEverything()] }, vi.stubGlobal);
    await syncSkillListings(fx.env, await session(fx.env));
    return fx;
  }

  it('serves the full body for a public skill to a signed-in account', async () => {
    const { env } = await published();
    const res = await handlePublicSkillBody(
      req(`/v1/skills/@${LOGIN}/skill-architect`),
      env,
      `@${LOGIN}/skill-architect`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tier: string; skill: { body: string } };
    expect(body.tier).toBe('public');
    expect(body.skill.body).toContain('PUBLIC BODY SENTINEL');
  });

  it('refuses the body to an anonymous caller, handing back only the listed payload', async () => {
    const { env } = await published();
    const res = await handlePublicSkillBody(
      new Request(`${BASE}/v1/skills/@${LOGIN}/skill-architect`),
      env,
      `@${LOGIN}/skill-architect`,
    );
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain('ACCOUNT_REQUIRED');
    expect(text).not.toContain('PUBLIC BODY SENTINEL');
  });

  it('refuses the body of a LISTED skill even to a signed-in account', async () => {
    const { env } = await published();
    const res = await handlePublicSkillBody(
      req(`/v1/skills/@${LOGIN}/signal-flag-composer`),
      env,
      `@${LOGIN}/signal-flag-composer`,
    );
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain('LISTED BODY SENTINEL');
    // ...but the listed payload it WAS entitled to still comes back.
    expect(text).toContain('signal-flag-composer');
  });

  it('re-checks the LIVE repo file, so a withdrawn tier revokes the body at once', async () => {
    const repo = repoWithEverything();
    const fx = await makeSeamanshipFixture({ repos: [repo] }, vi.stubGlobal);
    await syncSkillListings(fx.env, await session(fx.env));
    // The stored row still says "published". The repo no longer says "public".
    repo.skills['skill-architect'] = skillMd(
      ['name: skill-architect', 'description: Author a new skill from a brief.', 'visibility: listed'].join('\n'),
      'PUBLIC BODY SENTINEL - now behind a narrower tier.\n',
    );
    const res = await handlePublicSkillBody(
      req(`/v1/skills/@${LOGIN}/skill-architect`),
      fx.env,
      `@${LOGIN}/skill-architect`,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('BODY SENTINEL');
  });

  it('is not an existence oracle: unpublished and nonexistent answer identically', async () => {
    const { env } = await published();
    const unpublished = await handlePublicSkillBody(
      req(`/v1/skills/@${LOGIN}/harbor-quota-tuner`),
      env,
      `@${LOGIN}/harbor-quota-tuner`,
    );
    const nonexistent = await handlePublicSkillBody(
      req(`/v1/skills/@${LOGIN}/no-such-skill-anywhere`),
      env,
      `@${LOGIN}/no-such-skill-anywhere`,
    );
    expect(unpublished.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(await unpublished.text()).toBe(await nonexistent.text());
  });

  it('404s a malformed qualified id without touching D1', async () => {
    const { env } = await published();
    const res = await handlePublicSkillBody(req('/v1/skills/nonsense'), env, 'nonsense');
    expect(res.status).toBe(404);
  });

  it('resolveSkillBody hands back no body on any refusal path', async () => {
    const { env } = await published();
    for (const id of [`@${LOGIN}/signal-flag-composer`, `@${LOGIN}/harbor-quota-tuner`, 'garbage']) {
      const outcome = await resolveSkillBody(env, null, id);
      expect(outcome.kind).not.toBe('ok');
      expect(JSON.stringify(outcome)).not.toContain('BODY SENTINEL');
    }
  });
});
