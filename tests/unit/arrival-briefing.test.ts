/**
 * Ranking tests for the arrival briefing.
 *
 * The failure mode this guards is not a crash — it is a briefing that fires on
 * every session with content nobody asked for, which is indistinguishable from
 * noise and gets ignored within a day. So the cases below are mostly about what
 * must NOT appear: the weak match, the shipped roadmap item, the agent
 * introduced to itself, the cross-project salvage that merely reads similar.
 *
 * The other half pins the weighting that makes the section useful: a shared
 * file has to beat topical similarity, because two agents editing one path are
 * heading for a collision whether or not the words match.
 */
import { describe, expect, test } from '@jest/globals';

import {
  MAX_TEXT_SCORE,
  MIN_SCORE,
  SHARED_FILE_WEIGHT,
  buildArrivalBriefing,
  contextQuery,
  overlapScore,
  rankNeighbours,
  rankRoadmap,
  rankSalvage,
  rankSkills,
  renderArrivalBriefing,
  sharedTerms,
} from '../../lib/arrival-briefing.js';

const ctx = {
  actor: 'alpha',
  purpose: 'wire the reconcile loop producers',
  project: 'port-daddy',
  files: ['lib/squid/reconcile.ts'],
};

// ─── scoring primitives ──────────────────────────────────────────────────────

describe('weighting invariants', () => {
  test('one shared file strictly dominates the best possible text match', () => {
    // Regression: these were both 1.0, so a shared file merely TIED a perfect
    // text overlap and the winner fell out of sort stability rather than any
    // decision. A file collision is not a topical similarity — it is two agents
    // about to overwrite each other.
    expect(SHARED_FILE_WEIGHT).toBeGreaterThan(MAX_TEXT_SCORE);
  });

  test('a stopword alone can never carry a match', () => {
    // Regression: "watering the plants" matched "wire the reconcile loop" on
    // the word `the`, rendering `similar goal: the`. The scoring here is
    // simpler than BM25 and so has no IDF to suppress ubiquitous terms.
    const hits = rankNeighbours({ actor: 'a', purpose: 'the and of to' }, [
      { actor: 'b', sessionId: 's', purpose: 'the and of to' },
    ]);
    expect(hits).toEqual([]);
  });

  test('a bare file extension can never carry a match', () => {
    // `contextQuery` includes basenames, so `ts` is shared by every TypeScript
    // file in the repo — left in, it introduces every agent to every agent.
    const hits = rankNeighbours({ actor: 'a', files: ['lib/alpha.ts'] }, [
      { actor: 'b', sessionId: 's', purpose: 'totally unrelated', files: ['other/beta.ts'] },
    ]);
    expect(hits).toEqual([]);
  });
});

describe('overlapScore', () => {
  test('normalises by the SMALLER set so a short query can match a long doc', () => {
    // Union normalisation is the trap: with it, a three-word purpose scores
    // near zero against every long roadmap body and the section never fires.
    const short = ['reconcil', 'loop'];
    const long = ['reconcil', 'loop', ...Array.from({ length: 50 }, (_, i) => `filler${i}`)];
    expect(overlapScore(short, long)).toBe(1);
  });

  test('is zero for disjoint sets and for empty input', () => {
    expect(overlapScore(['a'], ['b'])).toBe(0);
    expect(overlapScore([], ['a'])).toBe(0);
    expect(overlapScore(['a'], [])).toBe(0);
  });

  test('counts a repeated query term once', () => {
    expect(overlapScore(['a', 'a', 'a'], ['a', 'b'])).toBe(1);
  });
});

describe('sharedTerms', () => {
  test('returns the overlap, deduped and capped', () => {
    expect(sharedTerms(['a', 'b', 'a', 'c'], ['a', 'c'])).toEqual(['a', 'c']);
    expect(sharedTerms(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a', 'b']);
  });
});

describe('contextQuery', () => {
  test('folds purpose, hints and file basenames into one query', () => {
    const q = contextQuery({ actor: 'x', purpose: 'fix parser', hints: ['PD-12'], files: ['a/b/lexer.ts'] });
    expect(q).toContain('fix parser');
    expect(q).toContain('PD-12');
    expect(q).toContain('lexer.ts');
    // Directory noise is dropped: every file in the repo shares 'lib' and 'src'.
    expect(q).not.toContain('a/b');
  });
});

// ─── salvage ─────────────────────────────────────────────────────────────────

describe('rankSalvage', () => {
  test('a held file you are about to touch outranks topical similarity', () => {
    const hits = rankSalvage(ctx, [
      { agentId: 'wordy', purpose: 'wire the reconcile loop producers exactly', project: 'port-daddy' },
      { agentId: 'holder', purpose: 'unrelated', project: 'port-daddy', files: ['lib/squid/reconcile.ts'] },
    ]);
    expect(hits[0].item.agentId).toBe('holder');
    expect(hits[0].why).toContain('reconcile.ts');
  });

  test('a different project is excluded even when the text matches perfectly', () => {
    const hits = rankSalvage(ctx, [
      { agentId: 'elsewhere', purpose: 'wire the reconcile loop producers', project: 'other-repo' },
    ]);
    expect(hits).toEqual([]);
  });

  test('a candidate with no project declared is still eligible', () => {
    const hits = rankSalvage(ctx, [{ agentId: 'unscoped', purpose: 'reconcile loop producers' }]);
    expect(hits.map((h) => h.item.agentId)).toEqual(['unscoped']);
  });

  test('notes count toward the match, not just purpose', () => {
    const hits = rankSalvage(ctx, [
      { agentId: 'noted', purpose: '', project: 'port-daddy', notes: ['stuck wiring reconcile producers'] },
    ]);
    expect(hits).toHaveLength(1);
  });

  test('every hit carries evidence for why it is there', () => {
    const hits = rankSalvage(ctx, [
      { agentId: 'holder', purpose: 'x', project: 'port-daddy', files: ['lib/squid/reconcile.ts'] },
    ]);
    expect(hits[0].why).toBeTruthy();
  });
});

// ─── roadmap ─────────────────────────────────────────────────────────────────

describe('rankRoadmap', () => {
  test('matches an open item on shared terms', () => {
    const hits = rankRoadmap(ctx, [{ id: 'R-1', title: 'Reconcile loop producers', status: 'open' }]);
    expect(hits[0].item.id).toBe('R-1');
  });

  test.each(['done', 'shipped', 'closed', 'complete', 'Done'])('a %s item is history, not a destination', (status) => {
    const hits = rankRoadmap(ctx, [{ id: 'R-1', title: 'Reconcile loop producers', status }]);
    expect(hits).toEqual([]);
  });

  test('an item with no status is treated as open', () => {
    const hits = rankRoadmap(ctx, [{ id: 'R-1', title: 'Reconcile loop producers' }]);
    expect(hits).toHaveLength(1);
  });
});

// ─── skills ──────────────────────────────────────────────────────────────────

describe('rankSkills', () => {
  test('the hyphenated skill id alone is enough to match', () => {
    // Ids are topic phrases, so they tokenize into the same terms a matching
    // purpose uses — a skill with no description still gets found.
    const hits = rankSkills({ actor: 'a', purpose: 'postgres connection pooling' }, [
      { id: 'postgres-connection-pooling' },
      { id: 'metal-shader-expert' },
    ]);
    expect(hits.map((h) => h.item.id)).toEqual(['postgres-connection-pooling']);
  });

  test('an unrelated catalog produces no section rather than a weak one', () => {
    const hits = rankSkills({ actor: 'a', purpose: 'wire reconcile producers' }, [
      { id: 'amazon-flex-guide' },
      { id: 'collage-layout-expert' },
    ]);
    expect(hits).toEqual([]);
  });
});

// ─── neighbours ──────────────────────────────────────────────────────────────

describe('rankNeighbours', () => {
  test('never introduces an agent to itself', () => {
    const hits = rankNeighbours(ctx, [
      { actor: 'alpha', sessionId: 's0', purpose: 'wire the reconcile loop producers', project: 'port-daddy' },
    ]);
    expect(hits).toEqual([]);
  });

  test('a shared file beats a wordier topical match', () => {
    const hits = rankNeighbours(ctx, [
      { actor: 'wordy', sessionId: 's1', purpose: 'wire the reconcile loop producers now', project: 'port-daddy' },
      { actor: 'collider', sessionId: 's2', purpose: 'unrelated', files: ['lib/squid/reconcile.ts'] },
    ]);
    expect(hits[0].item.actor).toBe('collider');
    expect(hits[0].why).toContain('reconcile.ts');
  });

  test('cross-project neighbours are allowed — shared expertise still counts', () => {
    // Unlike salvage, project is corroboration rather than a gate: an agent in
    // another repo who has solved this exact problem is worth meeting.
    const hits = rankNeighbours(ctx, [
      { actor: 'far', sessionId: 's3', purpose: 'wire reconcile loop producers', project: 'other-repo' },
    ]);
    expect(hits.map((h) => h.item.actor)).toEqual(['far']);
  });

  test('same project breaks a tie toward the closer neighbour', () => {
    const hits = rankNeighbours(ctx, [
      { actor: 'far', sessionId: 's1', purpose: 'wire the reconcile loop producers', project: 'other' },
      { actor: 'near', sessionId: 's2', purpose: 'wire the reconcile loop producers', project: 'port-daddy' },
    ]);
    expect(hits[0].item.actor).toBe('near');
  });

  test('plural evidence when several files collide', () => {
    const hits = rankNeighbours(
      { ...ctx, files: ['a.ts', 'b.ts'] },
      [{ actor: 'both', sessionId: 's1', purpose: 'x', files: ['a.ts', 'b.ts'] }],
    );
    expect(hits[0].why).toContain('2 of the same files');
  });
});

// ─── assembly + rendering ────────────────────────────────────────────────────

describe('buildArrivalBriefing', () => {
  test('is empty when nothing matches, and renders to nothing', () => {
    const b = buildArrivalBriefing(ctx, {
      salvage: [{ agentId: 'x', purpose: 'knitting patterns', project: 'port-daddy' }],
      roadmap: [{ id: 'R', title: 'redesign the marketing site' }],
      skills: [{ id: 'amazon-flex-guide' }],
      neighbours: [{ actor: 'z', sessionId: 's', purpose: 'watering the plants' }],
    });
    expect(b.empty).toBe(true);
    // A section that always prints teaches agents to skip the block that will
    // one day matter — silence has to stay meaningful.
    expect(renderArrivalBriefing(b)).toBe('');
  });

  test('absent corpora are handled like empty ones', () => {
    const b = buildArrivalBriefing(ctx, {});
    expect(b.empty).toBe(true);
    expect(b.salvage).toEqual([]);
  });

  test('respects the per-section cap', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      actor: `n${i}`,
      sessionId: `s${i}`,
      purpose: 'wire the reconcile loop producers',
    }));
    expect(buildArrivalBriefing(ctx, { neighbours: many }, { perSection: 2 }).neighbours).toHaveLength(2);
  });

  test('a weak incidental match is filtered out by MIN_SCORE', () => {
    const weak = buildArrivalBriefing(
      { actor: 'a', purpose: 'update the tests' },
      { skills: [{ id: 'rust-code-testing', description: 'x '.repeat(200) }] },
      { minScore: 0.9 },
    );
    expect(weak.empty).toBe(true);
    expect(MIN_SCORE).toBeGreaterThan(0);
  });

  test('renders every populated section with its actionable next step', () => {
    const b = buildArrivalBriefing(ctx, {
      salvage: [{ agentId: 'ghost', purpose: 'reconcile loop producers', project: 'port-daddy' }],
      neighbours: [{ actor: 'beta', sessionId: 's1', purpose: 'x', files: ['lib/squid/reconcile.ts'] }],
      roadmap: [{ id: 'R-1', title: 'Reconcile loop producers' }],
      skills: [{ id: 'reconcile-loop-producers' }],
    });
    const out = renderArrivalBriefing(b);
    expect(out).toContain('beta');
    expect(out).toContain('pd parley call');
    expect(out).toContain('ghost');
    expect(out).toContain('pd salvage claim');
    expect(out).toContain('R-1');
    expect(out).toContain('reconcile-loop-producers');
  });

  test('omits sections that matched nothing instead of rendering them empty', () => {
    const b = buildArrivalBriefing(ctx, {
      neighbours: [{ actor: 'beta', sessionId: 's1', purpose: 'x', files: ['lib/squid/reconcile.ts'] }],
    });
    const out = renderArrivalBriefing(b);
    expect(out).toContain('Agents on adjacent work');
    expect(out).not.toContain('Salvageable work');
    expect(out).not.toContain('Roadmap items');
    expect(out).not.toContain('Skills for this work');
  });
});

// ─── route seam ──────────────────────────────────────────────────────────────

describe('GET /briefing/arrival', () => {
  const deps = {
    briefing: {
      generate: () => ({ success: true }),
      sync: () => ({ success: true }),
      gatherData: () => ({}),
      detectProject: () => 'p',
    },
    resurrection: {
      listPending: () => ({
        agents: [
          { agentId: 'ghost-7', purpose: 'wire reconcile loop producers', identityProject: 'port-daddy' },
          { agentId: 'unrelated', purpose: 'knitting patterns', identityProject: 'port-daddy' },
        ],
      }),
    },
    sessions: {
      list: () => ({
        sessions: [
          { id: 's1', agentId: 'beta', purpose: 'reconcile producers wiring', files: ['lib/squid/reconcile.ts'] },
          { id: 's2', agentId: 'gamma', purpose: 'watering the plants' },
        ],
      }),
    },
    roadmapItems: {
      list: () => ({
        items: [
          { id: 'ADR-108', title: 'Reconcile loop producers', status: 'open' },
          { id: 'ADR-999', title: 'Marketing site redesign', status: 'open' },
        ],
      }),
    },
    skills: { list: () => ({ skills: [{ id: 'reconcile-loop-design' }, { id: 'amazon-flex-guide' }] }) },
  };

  const build = async (overrides: Record<string, unknown> = {}) => {
    const { default: Fastify } = await import('fastify');
    const { briefingPlugin } = await import('../../routes/briefing.js');
    const app = Fastify();
    await app.register(briefingPlugin as never, { deps: { ...deps, ...overrides } } as never);
    return app;
  };

  const url =
    '/briefing/arrival?actor=alpha&purpose=' +
    encodeURIComponent('wire the reconcile loop producers') +
    '&project=port-daddy&files=lib/squid/reconcile.ts';

  test('ranks all four corpora and drops the irrelevant candidates', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    const rendered = JSON.parse(res.body).rendered as string;

    expect(rendered).toContain('beta');
    expect(rendered).toContain('ghost-7');
    expect(rendered).toContain('ADR-108');
    expect(rendered).toContain('reconcile-loop-design');
    // The whole value of the feature is what it leaves out.
    expect(rendered).not.toContain('knitting');
    expect(rendered).not.toContain('Marketing');
    expect(rendered).not.toContain('amazon-flex');
    expect(rendered).not.toContain('gamma');
    await app.close();
  });

  test('an actor-less request is a 400, not a briefing for nobody', async () => {
    const app = await build();
    expect((await app.inject({ method: 'GET', url: '/briefing/arrival' })).statusCode).toBe(400);
    await app.close();
  });

  test('nothing relevant renders as the empty string', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/briefing/arrival?actor=zeta&purpose=' + encodeURIComponent('quantum basket weaving'),
    });
    expect(JSON.parse(res.body).rendered).toBe('');
    await app.close();
  });

  test('a store that throws costs its own section, not the request', async () => {
    // This runs on an agent's first turn; one broken corpus must never be the
    // difference between a briefing and a 500.
    const app = await build({
      resurrection: {
        listPending: () => {
          throw new Error('db locked');
        },
      },
    });
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.briefing.salvage).toEqual([]);
    expect(body.rendered).toContain('beta'); // other sections survived
    await app.close();
  });

  test('a daemon with no arrival stores at all still answers', async () => {
    const app = await build({ resurrection: undefined, sessions: undefined, roadmapItems: undefined, skills: undefined });
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).rendered).toBe('');
    await app.close();
  });

  test('a bare request derives context from the actor\'s own live session', async () => {
    // Regression (caught in review): the ranking query is built from purpose +
    // hints + file basenames and deliberately EXCLUDES the actor, so a request
    // carrying only `actor` produced an empty query, matched nothing in all
    // four corpora, and rendered as silence — indistinguishable from "nothing
    // relevant" when the truth was "nobody told me what I am working on".
    const app = await build({
      sessions: {
        list: () => ({
          sessions: [
            // The arriving agent's own session supplies the context.
            {
              id: 'mine',
              agentId: 'alpha',
              purpose: 'wire the reconcile loop producers',
              identityProject: 'port-daddy',
              files: ['lib/squid/reconcile.ts'],
              createdAt: 200,
            },
            { id: 's1', agentId: 'beta', purpose: 'x', files: ['lib/squid/reconcile.ts'], createdAt: 100 },
          ],
        }),
      },
    });
    const res = await app.inject({ method: 'GET', url: '/briefing/arrival?actor=alpha' });
    expect(res.statusCode).toBe(200);
    const rendered = JSON.parse(res.body).rendered as string;
    expect(rendered).not.toBe('');
    expect(rendered).toContain('beta');   // neighbour on the same file
    expect(rendered).toContain('ghost-7'); // salvage matching the derived purpose
    await app.close();
  });

  test('explicit flags still win over the derived session', async () => {
    const app = await build({
      sessions: {
        list: () => ({
          sessions: [
            { id: 'mine', agentId: 'alpha', purpose: 'quantum basket weaving', createdAt: 200 },
          ],
        }),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/briefing/arrival?actor=alpha&purpose=' + encodeURIComponent('wire the reconcile loop producers'),
    });
    expect(JSON.parse(res.body).rendered).toContain('ghost-7');
    await app.close();
  });

  test('the newest active session wins when an actor holds several', async () => {
    const app = await build({
      sessions: {
        list: () => ({
          sessions: [
            { id: 'old', agentId: 'alpha', purpose: 'quantum basket weaving', createdAt: 1 },
            { id: 'new', agentId: 'alpha', purpose: 'wire the reconcile loop producers', createdAt: 999 },
          ],
        }),
      },
    });
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/briefing/arrival?actor=alpha' })).body).rendered)
      .toContain('ghost-7');
    await app.close();
  });

  test('an actor with no session still answers, just thinly', async () => {
    const app = await build({ sessions: { list: () => ({ sessions: [] }) } });
    const res = await app.inject({ method: 'GET', url: '/briefing/arrival?actor=nobody' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).rendered).toBe('');
    await app.close();
  });
});
