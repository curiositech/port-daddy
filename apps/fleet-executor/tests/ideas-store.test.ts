import { describe, it, expect, vi } from 'vitest';
import {
  captureProposals,
  cosineSimilarity,
  ideaText,
  ideaSlug,
  renderIdeaIssueBody,
  DEDUP_THRESHOLD,
  type IdeaCtx,
} from '../src/ideas-store.js';
import type { Proposal } from '../src/proposals.js';

// ---------------------------------------------------------------------------
// A purpose-built in-memory D1 recognizing exactly the statements ideas-store
// issues (INSERT OR IGNORE reserve/dup rows, UPDATE to finalize, slug lookup,
// canonical scan). Not a general SQL engine. `run()` returns `meta.changes` so
// the reserve-first idempotency path is exercised faithfully.

interface Row {
  slug: string;
  embedding_json: string;
  issue_url: string | null;
  duplicate_of: string | null;
  status: string;
}

function fakeD1(): D1Database & { rows: Row[] } {
  const rows: Row[] = [];
  const db = {
    rows,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async run() {
          let changes = 0;
          if (/UPDATE fleet_ideas SET issue_number/.test(sql)) {
            const row = rows.find(r => r.slug === (bound[2] as string));
            if (row) {
              row.issue_url = bound[1] as string;
              row.status = 'tracked';
              changes = 1;
            }
          } else if (/INSERT OR IGNORE INTO fleet_ideas/.test(sql)) {
            const slug = bound[0] as string;
            if (!rows.find(r => r.slug === slug)) {
              const isDup = /duplicate_of, status/.test(sql);
              rows.push({
                slug,
                embedding_json: bound[9] as string,
                issue_url: null,
                duplicate_of: isDup ? (bound[10] as string) : null,
                status: isDup ? 'duplicate' : 'opening-issue',
              });
              changes = 1;
            }
          }
          return { success: true, meta: { changes } } as unknown;
        },
        async all() {
          if (/duplicate_of IS NULL/.test(sql)) {
            return {
              results: rows
                .filter(r => r.duplicate_of == null)
                .map(r => ({ slug: r.slug, embedding_json: r.embedding_json, issue_url: r.issue_url })),
            } as unknown;
          }
          return { results: [] } as unknown;
        },
        async first() {
          if (/WHERE slug = \?/.test(sql)) {
            const r = rows.find(x => x.slug === (bound[0] as string));
            return (r ? { slug: r.slug } : null) as unknown;
          }
          return null as unknown;
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  };
  return db as unknown as D1Database & { rows: Row[] };
}

const CTX: IdeaCtx = { owner: 'curiositech', repo: 'port-daddy', prNumber: 42, shipName: 'spark' };

const prop = (over: Partial<Proposal>): Proposal => ({
  title: 'Auto-pick parley parties from the roster',
  rationale: 'The roster knows agent state; parley needs parties; so parley could auto-pick.',
  evidence: ['lib/roster.ts'],
  action: 'assign',
  ...over,
});

// Deterministic embedder: vectors chosen so cosine relationships are known.
//   "roster"/"parley" text → near [1,0,0]; "cost"/"billing" → [0,1,0].
const embed = async (text: string): Promise<number[]> => {
  if (/roster|parley/i.test(text)) return [1, 0, 0.01];
  if (/cost|billing/i.test(text)) return [0, 1, 0];
  return [0, 0, 1];
};

describe('cosineSimilarity + threshold', () => {
  it('DEDUP_THRESHOLD matches ADR-0085 (0.92)', () => {
    expect(DEDUP_THRESHOLD).toBe(0.92);
  });
  it('guards empty / mismatched-length vectors, and scores parallel vs orthogonal', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0.01])).toBeGreaterThan(DEDUP_THRESHOLD);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeLessThan(DEDUP_THRESHOLD);
  });
});

describe('ideaSlug — content-addressed key', () => {
  it('same title + payload → same slug (idempotent)', () => {
    expect(ideaSlug(prop({}))).toBe(ideaSlug(prop({})));
  });
  it('SAME title, DIFFERENT payload → DIFFERENT slug (no false-drop)', () => {
    const a = ideaSlug({ title: 'Same title', rationale: 'one thing' });
    const b = ideaSlug({ title: 'Same title', rationale: 'a completely different thing' });
    expect(a).not.toBe(b);
  });
});

describe('captureProposals — D1 semantic dedup + reserve-first auto-issue', () => {
  it('opens an issue and stores a finalized row for a NOVEL proposal', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    const [r] = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    expect(r.outcome).toBe('tracked-new');
    expect(r.issueUrl).toBe('https://gh/issues/7');
    expect(openIssue).toHaveBeenCalledOnce();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].issue_url).toBe('https://gh/issues/7'); // finalized via UPDATE
    expect(db.rows[0].status).toBe('tracked');
  });

  it('a semantically-near proposal (cosine ≥ 0.92, different slug) is a DUPLICATE — no new issue', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    const firstSlug = db.rows[0].slug;
    const near = prop({ title: 'Roster-driven parley party selection' });
    const [r] = await captureProposals({ db, proposals: [near], ctx: CTX, embed, openIssue, now: 2 });
    expect(r.outcome).toBe('duplicate');
    expect(r.duplicateOf).toBe(firstSlug);
    expect(openIssue).toHaveBeenCalledOnce(); // still only the first issue
  });

  it('an unrelated proposal (low cosine) is tracked as NEW with its own issue', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async (t: string) => ({ number: t.includes('cost') ? 9 : 7, url: `https://gh/${t}` }));
    await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    const other = prop({ title: 'Cache the cost ledger', rationale: 'cost tracking is slow; cache it' });
    const [r] = await captureProposals({ db, proposals: [other], ctx: CTX, embed, openIssue, now: 2 });
    expect(r.outcome).toBe('tracked-new');
    expect(openIssue).toHaveBeenCalledTimes(2);
    expect(db.rows).toHaveLength(2);
  });

  it('re-capturing the exact same proposal is idempotent (already-tracked, no 2nd issue)', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    const [r] = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 2 });
    expect(r.outcome).toBe('already-tracked');
    expect(openIssue).toHaveBeenCalledOnce();
  });

  it('NOTHING IS LOST on an empty embedding — captured anyway, just without dedup', async () => {
    // The Copilot fix: a Workers AI outage (empty vector) must not drop the idea.
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    const blindEmbed = async () => [];
    const [r] = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed: blindEmbed, openIssue, now: 1 });
    expect(r.outcome).toBe('tracked-new');
    expect(openIssue).toHaveBeenCalledOnce();
    expect(db.rows[0].embedding_json).toBe('[]'); // stored un-dedupable, not lost
  });

  it('issue-open failure AFTER reserve keeps the row (idea not lost) and reports error — never double-files', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => {
      throw new Error('GitHub 503');
    });
    const [r] = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    expect(r.outcome).toBe('error');
    // The reservation persists — the idea is durably in D1, pending an issue.
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].status).toBe('opening-issue');
    expect(db.rows[0].issue_url).toBeNull();
  });
});

describe('renderIdeaIssueBody', () => {
  it('carries provenance, rationale, evidence, and a ready-to-run block', () => {
    const body = renderIdeaIssueBody(prop({ prompt: 'do the thing' }), CTX);
    expect(body).toContain('pd-spark on [PR #42]');
    expect(body).toContain('lib/roster.ts');
    expect(body).toContain('do the thing');
  });
});

describe('ideaText', () => {
  it('joins title + rationale as the semantic payload', () => {
    expect(ideaText({ title: 'T', rationale: 'R' })).toBe('T\n\nR');
  });
});
