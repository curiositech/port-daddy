import { describe, it, expect, vi } from 'vitest';
import {
  captureProposals,
  cosineSimilarity,
  ideaText,
  renderIdeaIssueBody,
  DEDUP_THRESHOLD,
  type IdeaCtx,
} from '../src/ideas-store.js';
import type { Proposal } from '../src/proposals.js';

// ---------------------------------------------------------------------------
// A purpose-built in-memory D1 recognizing exactly the statements ideas-store
// issues. Not a general SQL engine — just enough to exercise the capture logic.

interface Row {
  slug: string;
  embedding_json: string;
  issue_url: string | null;
  duplicate_of: string | null;
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
          if (/INSERT OR IGNORE INTO fleet_ideas/.test(sql)) {
            const slug = bound[0] as string;
            if (!rows.find(r => r.slug === slug)) {
              const isNovel = /issue_number, issue_url/.test(sql);
              rows.push({
                slug,
                embedding_json: bound[9] as string,
                issue_url: isNovel ? (bound[11] as string) : null,
                duplicate_of: isNovel ? null : (bound[10] as string),
              });
            }
          }
          return { success: true } as unknown;
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

// A deterministic embedder: vectors chosen so cosine relationships are known.
//   "roster"-family text → near [1,0,0]; "cost"-family → [0,1,0].
const embed = async (text: string): Promise<number[]> => {
  if (/roster|parley/i.test(text)) return [1, 0, 0.01];
  if (/cost|billing/i.test(text)) return [0, 1, 0];
  return [0, 0, 1];
};

describe('cosineSimilarity + threshold', () => {
  it('DEDUP_THRESHOLD matches ADR-0085 (0.92)', () => {
    expect(DEDUP_THRESHOLD).toBe(0.92);
  });
  it('scores near-parallel vectors above the dedup threshold and orthogonal below', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0.01])).toBeGreaterThan(DEDUP_THRESHOLD);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeLessThan(DEDUP_THRESHOLD);
  });
});

describe('captureProposals — D1 semantic dedup + auto-issue', () => {
  it('opens an issue and stores a row for a NOVEL proposal', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    const [r] = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    expect(r.outcome).toBe('tracked-new');
    expect(r.issueUrl).toBe('https://gh/issues/7');
    expect(openIssue).toHaveBeenCalledOnce();
    expect(db.rows).toHaveLength(1);
  });

  it('a semantically-near proposal (cosine ≥ 0.92, different slug) is a DUPLICATE — no new issue', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    // Different title (→ different slug) but same roster/parley semantics.
    const near = prop({ title: 'Roster-driven parley party selection' });
    const [r] = await captureProposals({ db, proposals: [near], ctx: CTX, embed, openIssue, now: 2 });
    expect(r.outcome).toBe('duplicate');
    expect(r.duplicateOf).toBe('auto-pick-parley-parties-from-the-roster');
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

  it('an empty embedding → skipped (degrade to no-dedup, never throw)', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => ({ number: 7, url: 'https://gh/issues/7' }));
    const blindEmbed = async () => [];
    const [r] = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed: blindEmbed, openIssue, now: 1 });
    expect(r.outcome).toBe('skipped');
    expect(openIssue).not.toHaveBeenCalled();
  });

  it('an issue-open failure is caught per-proposal as error — capture never throws', async () => {
    const db = fakeD1();
    const openIssue = vi.fn(async () => {
      throw new Error('GitHub 503');
    });
    const results = await captureProposals({ db, proposals: [prop({})], ctx: CTX, embed, openIssue, now: 1 });
    expect(results[0].outcome).toBe('error');
    expect(db.rows).toHaveLength(0);
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
