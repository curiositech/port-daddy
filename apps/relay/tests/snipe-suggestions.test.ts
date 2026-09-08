/**
 * Tests for the Engineman's suggestion job (src/snipe-suggestions.ts, G′4).
 *
 * What is pinned here, and why each one is worth pinning:
 *
 *   · DEDUP against the repo's live catalog ids, against prior suggestions in
 *     ANY status, and within one batch. Without the first, the job re-proposes
 *     what the operator already has; without the second, "dismiss" is a button
 *     that does nothing.
 *   · NOT-FOR BOUNDARIES read off the catalog's own descriptions. A corpus that
 *     already declined a kind of skill must not be offered it again.
 *   · THE TEN-SUGGESTION CAP, and specifically that it is applied AFTER both
 *     gates — ten accepted means ten that survived, not ten off the top.
 *   · THE STATUS LAW, including the illegal moves. proposed → built without an
 *     approval is the one that matters: it is the approval gate expressed as
 *     data, and a regression there is a skill built with nobody's consent.
 *   · The job end to end against the REAL schema, so the storage-layer UNIQUE
 *     and the conditional claim are exercised rather than described.
 */

import { describe, it, expect } from 'vitest';
import {
  BOUNDARY_MATCH_MIN_TERMS,
  MAX_SUGGESTIONS_PER_RUN,
  applySuggestionTransition,
  boundaryVerdict,
  contentTerms,
  enqueueSuggestionJob,
  extractNotForBoundaries,
  filterSuggestions,
  listSuggestions,
  makeD1CatalogReader,
  nextStatus,
  normalizeSkillName,
  reapStuckJobs,
  resolveSuggestionProvider,
  runSnipeSuggestionJob,
  runSnipeSuggestionSweep,
  type CatalogSkill,
  type SuggestionCandidate,
  type SuggestionProvider,
  type SuggestionStatus,
} from '../src/snipe-suggestions.js';
import { makeTestD1, seedSession, seedSuggestion, type TestD1 } from './support/d1-sqlite.js';
import type { Env } from '../src/types.js';

const REPO = 'octocat/port-daddy';
const USER = 'u_1';
const NOW = 1_760_000_000;

function env(t: TestD1): Env {
  return { DB: t.db } as unknown as Env;
}

function candidate(over: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    skillName: 'migration-backfill-verify',
    description: 'Walks a schema migration, its backfill and its verification as one checked dance.',
    rationale: 'Three PRs in this repo have hand-rolled the same three-step dance.',
    ...over,
  };
}

function seedUser(t: TestD1): void {
  t.raw
    .prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, 1, ?, ?, 0)')
    .run(USER, 'octocat', NOW);
}

// ── Normalization ────────────────────────────────────────────────────────────

describe('snipe suggestions — skill identity', () => {
  it('folds spacing, case and punctuation to one slug', () => {
    for (const raw of ['Skill Architect', 'skill_architect', 'SKILL--ARCHITECT', '  skill-architect  ']) {
      expect(normalizeSkillName(raw)).toBe('skill-architect');
    }
  });

  it('a hyphenated id contributes both its whole slug and its parts as terms', () => {
    const terms = contentTerms('rust-toolchain-workflow');
    expect(terms.has('rust-toolchain-workflow')).toBe(true);
    expect(terms.has('rust')).toBe(true);
  });
});

// ── Dedup ────────────────────────────────────────────────────────────────────

describe('snipe suggestions — dedup', () => {
  const inputs = { catalogIds: [] as string[], existingSuggestionNames: [] as string[], boundaries: [] };

  it('refuses a candidate whose id already exists in the repo catalog', () => {
    const out = filterSuggestions([candidate({ skillName: 'skill-architect' })], {
      ...inputs,
      catalogIds: ['skill-architect'],
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe('duplicate-catalog');
  });

  it('dedup is on the normalized slug, not the raw string', () => {
    const out = filterSuggestions([candidate({ skillName: 'Skill Architect' })], {
      ...inputs,
      catalogIds: ['skill-architect'],
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe('duplicate-catalog');
  });

  it('refuses a candidate already proposed for this repo — including a DISMISSED one', () => {
    // A dismissal that could be undone by the next job run is not a decision.
    const out = filterSuggestions([candidate({ skillName: 'flaky-test-triage' })], {
      ...inputs,
      existingSuggestionNames: ['flaky-test-triage'],
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe('duplicate-suggestion');
  });

  it('refuses the second of two identical candidates in one batch', () => {
    const out = filterSuggestions([candidate(), candidate()], inputs);
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected[0]?.reason).toBe('duplicate-batch');
  });

  it('accepts a genuinely new id', () => {
    const out = filterSuggestions([candidate()], { ...inputs, catalogIds: ['something-else'] });
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]?.slug).toBe('migration-backfill-verify');
  });
});

// ── NOT-FOR boundaries ───────────────────────────────────────────────────────

describe('snipe suggestions — NOT-FOR boundaries', () => {
  const catalog: CatalogSkill[] = [
    {
      id: 'rust-performance-and-idioms',
      description:
        'Idiomatic Rust performance work. NOT for borrow-checker firefighting or toolchain workflow (use rust-toolchain-workflow).',
    },
    {
      id: 'agent-rl-sandbox-trainer',
      description: 'Design RL simulation sandboxes. NOT for generic ML tutorials or model training operations.',
    },
  ];

  it('reads the catalog’s own refusals off its descriptions', () => {
    const bounds = extractNotForBoundaries(catalog);
    expect(bounds).toHaveLength(2);
    expect(bounds[0]?.skillId).toBe('rust-performance-and-idioms');
    expect(bounds[0]?.redirects).toContain('rust-toolchain-workflow');
  });

  it('only the capitalised NOT is a boundary — ordinary prose is not an edge', () => {
    const bounds = extractNotForBoundaries([
      { id: 'x', description: 'A thing. This is not for the faint-hearted, but do try it.' },
    ]);
    expect(bounds).toHaveLength(0);
  });

  it('refuses a candidate that lands inside a declared boundary', () => {
    const bounds = extractNotForBoundaries(catalog);
    const verdict = boundaryVerdict(
      { skillName: 'ml-tutorial-writer', description: 'Writes generic ML tutorials and training walkthroughs.' },
      bounds,
    );
    expect(verdict.blocked).toBe(true);
    expect(verdict.by).toBe('agent-rl-sandbox-trainer');
    expect((verdict.matched ?? []).length).toBeGreaterThanOrEqual(BOUNDARY_MATCH_MIN_TERMS);
  });

  it('refuses a candidate proposing an id a boundary redirects to, however few terms it shares', () => {
    const bounds = extractNotForBoundaries(catalog);
    const verdict = boundaryVerdict(
      { skillName: 'rust-toolchain-workflow', description: 'Something entirely unrelated.' },
      bounds,
    );
    expect(verdict.blocked).toBe(true);
    expect(verdict.by).toBe('rust-performance-and-idioms');
  });

  it('one shared word is a topic in common, not a boundary hit', () => {
    const bounds = extractNotForBoundaries([{ id: 'x', description: 'A thing. NOT for generic ML tutorials.' }]);
    const verdict = boundaryVerdict(
      { skillName: 'duckdb-analytics', description: 'Columnar analytics over local files.' },
      bounds,
    );
    expect(verdict.blocked).toBe(false);
  });

  it('the job-level filter reports boundary rejections with the refusing clause', () => {
    const out = filterSuggestions(
      [candidate({ skillName: 'ml-tutorials', description: 'Writes generic ML tutorials for model training.' })],
      { catalogIds: [], existingSuggestionNames: [], boundaries: extractNotForBoundaries(catalog) },
    );
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe('boundary');
    expect(out.rejected[0]?.detail).toContain('NOT for');
  });
});

// ── The cap ──────────────────────────────────────────────────────────────────

describe('snipe suggestions — the ten-suggestion cap', () => {
  const many = (n: number): SuggestionCandidate[] =>
    Array.from({ length: n }, (_, i) => candidate({ skillName: `proposal-number-${i}` }));

  it('accepts at most ten in one run', () => {
    const out = filterSuggestions(many(25), {
      catalogIds: [],
      existingSuggestionNames: [],
      boundaries: [],
    });
    expect(out.accepted).toHaveLength(MAX_SUGGESTIONS_PER_RUN);
    expect(MAX_SUGGESTIONS_PER_RUN).toBe(10);
    expect(out.rejected.filter((r) => r.reason === 'capped')).toHaveLength(15);
  });

  it('a caller cannot raise the cap by asking for more', () => {
    const out = filterSuggestions(many(25), {
      catalogIds: [],
      existingSuggestionNames: [],
      boundaries: [],
      limit: 999,
    });
    expect(out.accepted).toHaveLength(MAX_SUGGESTIONS_PER_RUN);
  });

  it('THE CAP IS APPLIED LAST: duplicates do not consume cap slots', () => {
    // Ten duplicates followed by ten novel candidates. If the cap ran first,
    // the whole reading list would be spent on rejects and nothing would land.
    const dupes = Array.from({ length: 10 }, (_, i) => candidate({ skillName: `already-have-${i}` }));
    const fresh = many(10);
    const out = filterSuggestions([...dupes, ...fresh], {
      catalogIds: dupes.map((d) => d.skillName),
      existingSuggestionNames: [],
      boundaries: [],
    });
    expect(out.accepted).toHaveLength(10);
    expect(out.accepted.every((a) => a.slug.startsWith('proposal-number-'))).toBe(true);
  });

  it('malformed candidates are refused, not clamped into shape', () => {
    const out = filterSuggestions(
      [
        candidate({ skillName: 'Has Spaces And CAPS' }), // normalizes fine
        candidate({ skillName: '' }),
        candidate({ description: '' }),
        candidate({ rationale: '' }),
      ],
      { catalogIds: [], existingSuggestionNames: [], boundaries: [] },
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected.filter((r) => r.reason === 'malformed')).toHaveLength(3);
  });
});

// ── The status law ───────────────────────────────────────────────────────────

describe('snipe suggestions — the status law', () => {
  it('legal moves are exactly the four the lifecycle names', () => {
    expect(nextStatus('proposed', 'approve')).toMatchObject({ ok: true, to: 'approved' });
    expect(nextStatus('proposed', 'dismiss')).toMatchObject({ ok: true, to: 'dismissed' });
    expect(nextStatus('approved', 'dismiss')).toMatchObject({ ok: true, to: 'dismissed' });
    expect(nextStatus('approved', 'build-succeeded')).toMatchObject({ ok: true, to: 'built' });
  });

  it('THE GATE: proposed → built without an approval is REFUSED', () => {
    const v = nextStatus('proposed', 'build-succeeded');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/without an explicit approval/i);
  });

  it('dismissed and built are terminal', () => {
    const events = ['approve', 'dismiss', 'build-succeeded'] as const;
    for (const from of ['dismissed', 'built'] as SuggestionStatus[]) {
      for (const e of events) {
        const v = nextStatus(from, e);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toContain('terminal');
      }
    }
  });

  it('an already-approved suggestion cannot be approved again', () => {
    expect(nextStatus('approved', 'approve').ok).toBe(false);
  });
});

describe('snipe suggestions — the law is enforced by SQL, not only by the verdict', () => {
  it('a transition naming the wrong prior status matches ZERO rows', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      seedSuggestion(t, { id: 'sug_aaaa', userId: USER, repo: REPO, skillName: 'a-thing' });

      // Try to record a finished build from 'approved' on a row that is still
      // 'proposed'. Even calling the recorder directly, nothing moves.
      const moved = await applySuggestionTransition(t.db, {
        suggestionId: 'sug_aaaa',
        userId: USER,
        from: 'approved',
        to: 'built',
        now: NOW,
        prUrl: 'https://github.com/octocat/port-daddy/pull/1',
      });
      expect(moved).toBe(false);
      const row = t.raw.prepare('SELECT status, pr_url FROM seamanship_suggestions WHERE id = ?').get('sug_aaaa');
      expect(row).toMatchObject({ status: 'proposed', pr_url: null });
    } finally {
      t.close();
    }
  });

  it('a suggestion belonging to another account is invisible, not merely forbidden', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      t.raw
        .prepare('INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, 2, ?, ?, 0)')
        .run('u_2', 'someoneelse', NOW);
      seedSuggestion(t, { id: 'sug_bbbb', userId: USER, repo: REPO, skillName: 'mine' });
      const theirs = await listSuggestions(t.db, 'u_2', REPO);
      expect(theirs).toHaveLength(0);
      const moved = await applySuggestionTransition(t.db, {
        suggestionId: 'sug_bbbb',
        userId: 'u_2',
        from: 'proposed',
        to: 'approved',
        now: NOW,
      });
      expect(moved).toBe(false);
    } finally {
      t.close();
    }
  });

  it('the CHECK constraint refuses a status the law does not define', () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      expect(() =>
        seedSuggestion(t, { id: 'sug_cccc', userId: USER, repo: REPO, skillName: 'x-thing', status: 'built-ish' }),
      ).toThrow();
    } finally {
      t.close();
    }
  });
});

// ── The job, end to end ──────────────────────────────────────────────────────

function provider(candidates: SuggestionCandidate[]): SuggestionProvider {
  return { propose: async () => candidates };
}

const emptyCatalog = { read: async () => [] as CatalogSkill[] };

describe('snipe suggestion job', () => {
  it('no provider is wired on a stock deploy, and the job says UNCONFIGURED rather than inventing rows', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      expect(resolveSuggestionProvider(env(t))).toBeNull();
      const q = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      expect(q.ok).toBe(true);
      if (!q.ok) return;
      const r = await runSnipeSuggestionJob(env(t), q.jobId, { catalog: emptyCatalog });
      expect(r.state).toBe('failed');
      expect(r.error).toMatch(/UNCONFIGURED/);
      expect(r.produced).toBe(0);
      expect(await listSuggestions(t.db, USER, REPO)).toHaveLength(0);
    } finally {
      t.close();
    }
  });

  it('stores the survivors, counts every rejection, and caps at ten', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      seedSuggestion(t, { id: 'sug_prior', userId: USER, repo: REPO, skillName: 'already-proposed' });
      const catalog: CatalogSkill[] = [
        { id: 'in-the-catalog', description: 'exists already' },
        { id: 'guard', description: 'A guard. NOT for generic ML tutorials or model training.' },
      ];
      const candidates: SuggestionCandidate[] = [
        candidate({ skillName: 'in-the-catalog' }),
        candidate({ skillName: 'already-proposed' }),
        candidate({ skillName: 'ml-tutorials', description: 'Writes generic ML tutorials for model training.' }),
        ...Array.from({ length: 12 }, (_, i) => candidate({ skillName: `fresh-skill-${i}` })),
      ];
      const q = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      expect(q.ok).toBe(true);
      if (!q.ok) return;

      let n = 0;
      const r = await runSnipeSuggestionJob(env(t), q.jobId, {
        catalog: { read: async () => catalog },
        provider: provider(candidates),
        now: () => NOW,
        newId: () => `sug_${String(n++).padStart(4, '0')}`,
      });

      expect(r.state).toBe('done');
      expect(r.produced).toBe(10);
      expect(r.rejectedDupe).toBe(2);
      expect(r.rejectedBoundary).toBe(1);
      expect(r.rejectedCapped).toBe(2);

      const rows = await listSuggestions(t.db, USER, REPO);
      // ten fresh + the one seeded earlier
      expect(rows).toHaveLength(11);
      expect(rows.filter((x) => x.status === 'proposed')).toHaveLength(11);

      const job = t.raw.prepare('SELECT * FROM seamanship_suggestion_jobs WHERE job_id = ?').get(q.jobId);
      expect(job).toMatchObject({ state: 'done', produced: 10, rejected_boundary: 1, rejected_capped: 2 });
    } finally {
      t.close();
    }
  });

  it('a second enqueue for a repo with live work is refused, not raced', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      const first = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      expect(first.ok).toBe(true);
      const second = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      expect(second).toMatchObject({ ok: false, code: 'ALREADY_QUEUED' });
    } finally {
      t.close();
    }
  });

  it('claiming a job twice runs it once — the second call is a no-spend skip', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      const q = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      if (!q.ok) throw new Error('enqueue failed');
      let calls = 0;
      const counting: SuggestionProvider = {
        propose: async () => {
          calls += 1;
          return [candidate()];
        },
      };
      const a = await runSnipeSuggestionJob(env(t), q.jobId, {
        catalog: emptyCatalog,
        provider: counting,
        now: () => NOW,
      });
      const b = await runSnipeSuggestionJob(env(t), q.jobId, {
        catalog: emptyCatalog,
        provider: counting,
        now: () => NOW,
      });
      expect(a.state).toBe('done');
      expect(b.state).toBe('skipped');
      expect(calls).toBe(1);
    } finally {
      t.close();
    }
  });

  it('a provider that throws fails the job without losing the receipt', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      const q = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      if (!q.ok) throw new Error('enqueue failed');
      const r = await runSnipeSuggestionJob(env(t), q.jobId, {
        catalog: emptyCatalog,
        provider: { propose: async () => { throw new Error('upstream is down'); } },
        now: () => NOW,
      });
      expect(r.state).toBe('failed');
      expect(r.error).toContain('provider failed');
      const job = t.raw.prepare('SELECT state, error FROM seamanship_suggestion_jobs WHERE job_id = ?').get(q.jobId);
      expect(job).toMatchObject({ state: 'failed' });
    } finally {
      t.close();
    }
  });

  it('the sweep drains queued work and never throws', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      const q = await enqueueSuggestionJob(t.db, { userId: USER, repoFullName: REPO, now: NOW });
      if (!q.ok) throw new Error('enqueue failed');
      const r = await runSnipeSuggestionSweep(env(t), NOW, {
        catalog: emptyCatalog,
        provider: provider([candidate()]),
        now: () => NOW,
      });
      expect(r.jobsRun).toBe(1);
      expect(r.suggestionsProduced).toBe(1);
      expect(r.errors).toEqual([]);
    } finally {
      t.close();
    }
  });

  it('a job lost mid-run is returned to the queue, then abandoned once its budget is spent', async () => {
    const t = makeTestD1();
    try {
      seedUser(t);
      t.raw
        .prepare(
          "INSERT INTO seamanship_suggestion_jobs (job_id, user_id, repo_full_name, state, attempts, requested_at, started_at) " +
            "VALUES ('sjob_stuck', ?, ?, 'running', 1, ?, ?)",
        )
        .run(USER, REPO, NOW, NOW);
      const later = NOW + 3600;
      const first = await reapStuckJobs(t.db, later);
      expect(first).toMatchObject({ reaped: 1, failed: 0 });

      t.raw.prepare("UPDATE seamanship_suggestion_jobs SET state='running', attempts=3, started_at=?").run(NOW);
      const second = await reapStuckJobs(t.db, later);
      expect(second).toMatchObject({ reaped: 0, failed: 1 });
    } finally {
      t.close();
    }
  });

  it('the default catalog reader reads the frontmatter cache, scoped to one user and repo', async () => {
    const t = makeTestD1();
    try {
      const { userId } = seedSession(t, { tokenHash: 'hash-a' });
      t.raw
        .prepare(
          'INSERT INTO seamanship_skill_cache (user_id, repo_full_name, source_path, skill_id, name, description, fetched_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(userId, REPO, 'skills/a/SKILL.md', 'alpha', 'alpha', 'Does alpha. NOT for beta things.', NOW);
      const reader = makeD1CatalogReader(t.db);
      expect(await reader.read(userId, REPO)).toEqual([
        { id: 'alpha', description: 'Does alpha. NOT for beta things.' },
      ]);
      expect(await reader.read(userId, 'someone/else')).toEqual([]);
    } finally {
      t.close();
    }
  });
});
