/**
 * D1-backed fleet idea tracking + semantic dedup.
 *
 * Ideation ships (Spark, Spider, Lookout, Snipe) propose forward work. Until now
 * those proposals lived only in a PR comment: if the operator never clicked the
 * prefilled-issue link, the idea evaporated when the PR scrolled away. And the
 * only "is this already tracked?" surface was a keyword search over a **markdown
 * file** (`docs/recovery/IDEAS-TROVE.md`) — the wrong tool given we run on
 * Cloudflare.
 *
 * This module tracks ideas in the **relay D1** (`port-daddy-relay`, the same DB
 * that already holds `fleet_runs`), deduplicates them **semantically** (cosine
 * over Workers-AI embeddings, `duplicateOf` at ≥ 0.92 — the exact contract of the
 * ADR-0085 idea-intake `consult()` core), and auto-captures each NOVEL proposal
 * as a GitHub issue so nothing is lost and nothing is double-filed.
 *
 * Discipline mirrors ADR-0085's pure core: the two IO effects — embedding a
 * string and opening an issue — are INJECTED, so the capture logic is
 * exhaustively unit-testable without Workers AI or the GitHub API. `cosineSimilarity`
 * is copied here (a leaf pure fn) rather than importing the daemon's
 * `lib/idea-intake.ts`, exactly as that module copies it from `semantic-resolver`
 * to avoid dragging a model loader across a package boundary.
 */

import type { Proposal } from './proposals.js';
import { slugify } from './proposals.js';

/**
 * Semantic-duplicate cosine threshold. Identical to
 * `DEFAULT_INTAKE_THRESHOLDS.dedup` in `lib/idea-intake.ts` (ADR-0085): at/above
 * this, a proposal is "already tracked" and is NOT filed again.
 */
export const DEDUP_THRESHOLD = 0.92;

/** Workers AI embedding model. 768-dim, normalized vectors. */
export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

/** The GitHub label every auto-captured fleet idea carries. */
export const FLEET_IDEA_LABEL = 'fleet-idea';

export interface IdeaCtx {
  owner: string;
  repo: string;
  prNumber: number;
  shipName: string;
}

/** Injected: embed a string to a vector (execute.ts wires this to Workers AI). */
export type Embedder = (text: string) => Promise<number[]>;

/** Injected: open a GitHub issue, return its number + url (wired to github.ts). */
export type IssueOpener = (
  title: string,
  body: string,
  labels: string[],
) => Promise<{ number: number; url: string }>;

export type CaptureOutcome = 'tracked-new' | 'duplicate' | 'already-tracked' | 'skipped' | 'error';

export interface CaptureResult {
  slug: string;
  outcome: CaptureOutcome;
  issueUrl?: string;
  duplicateOf?: string;
}

// ---------------------------------------------------------------------------

/**
 * Cosine similarity. bge returns normalized vectors (so this is a dot product),
 * but we divide by the norms anyway so it is correct for any injected vectors
 * (tests, a future embedder). Copied leaf fn — see the module note.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The text an idea is embedded from — title + rationale, the semantic payload. */
export function ideaText(p: Pick<Proposal, 'title' | 'rationale'>): string {
  return `${p.title}\n\n${p.rationale}`.trim();
}

/**
 * Create the ideas table if it doesn't exist. Idempotent; safe to call every run.
 * `slug` is the primary key, giving cheap exact-idempotency (a retried delivery
 * re-proposing the same idea is a no-op via INSERT OR IGNORE).
 */
export async function ensureIdeasTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS fleet_ideas (
         slug          TEXT PRIMARY KEY,
         title         TEXT NOT NULL,
         rationale     TEXT NOT NULL,
         evidence_json TEXT,
         action        TEXT NOT NULL,
         ship          TEXT NOT NULL,
         owner         TEXT,
         repo          TEXT,
         pr_number     INTEGER,
         embedding_json TEXT NOT NULL,
         issue_number  INTEGER,
         issue_url     TEXT,
         duplicate_of  TEXT,
         status        TEXT NOT NULL DEFAULT 'tracked',
         created_at    INTEGER NOT NULL
       )`,
    )
    .run();
}

interface CanonicalRow {
  slug: string;
  embedding_json: string;
  issue_url: string | null;
}

/**
 * Find the closest already-tracked CANONICAL idea (not itself a duplicate) whose
 * cosine similarity is at/above {@link DEDUP_THRESHOLD}. Returns null when the
 * proposal is genuinely novel. Loads canonical rows and scores in-Worker — fine
 * for the current idea volume (hundreds); Cloudflare Vectorize is the scale path
 * when this grows, noted in the ADR follow-up.
 */
export async function findDuplicate(
  db: D1Database,
  vector: number[],
): Promise<{ slug: string; similarity: number; issueUrl: string | null } | null> {
  const res = await db
    .prepare(`SELECT slug, embedding_json, issue_url FROM fleet_ideas WHERE duplicate_of IS NULL`)
    .all<CanonicalRow>();
  let best: { slug: string; similarity: number; issueUrl: string | null } | null = null;
  for (const row of res.results ?? []) {
    let stored: number[];
    try {
      stored = JSON.parse(row.embedding_json) as number[];
    } catch {
      continue; // corrupt vector — skip, never throw in the capture path
    }
    const sim = cosineSimilarity(vector, stored);
    if (sim >= DEDUP_THRESHOLD && (!best || sim > best.similarity)) {
      best = { slug: row.slug, similarity: sim, issueUrl: row.issue_url };
    }
  }
  return best;
}

/** True if a canonical or duplicate row already exists for this slug. */
async function slugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT slug FROM fleet_ideas WHERE slug = ? LIMIT 1`)
    .bind(slug)
    .first<{ slug: string }>();
  return !!row;
}

/**
 * Render the GitHub issue body for a captured idea. Deterministic; carries the
 * proposal's rationale, evidence, and provenance so the operator can act on it
 * without opening the source PR.
 */
export function renderIdeaIssueBody(p: Proposal, ctx: IdeaCtx): string {
  const lines = [
    `**Source:** pd-${ctx.shipName} on [PR #${ctx.prNumber}](https://github.com/${ctx.owner}/${ctx.repo}/pull/${ctx.prNumber})`,
    `**Kind:** \`${p.action}\`${p.severity ? ` · severity \`${p.severity}\`` : ''}`,
    '',
    p.rationale,
  ];
  if (p.evidence.length) {
    lines.push('', `**Evidence:** ${p.evidence.map(e => `\`${e}\``).join(', ')}`);
  }
  if (p.prompt) {
    lines.push('', '**Ready-to-run:**', '', '```text', p.prompt.trim(), '```');
  }
  lines.push('', '---', '*Auto-captured by the Port Daddy fleet (semantic-deduped). Advisory.*');
  return lines.join('\n');
}

/**
 * Capture a ship's proposals into the D1 idea store, deduplicating semantically
 * and opening a GitHub issue for each NOVEL one. Best-effort by contract: every
 * per-proposal failure is caught and reported as `outcome: 'error'` — capture
 * NEVER throws, so it can't destabilize an advisory ideation ship.
 *
 * Per proposal:
 *   1. exact slug already in the store → `already-tracked` (idempotent no-op).
 *   2. embed; cosine ≥ 0.92 against a canonical idea → `duplicate` (record the
 *      link, open no new issue).
 *   3. otherwise novel → open a `fleet-idea` issue, store the row → `tracked-new`.
 */
export async function captureProposals(opts: {
  db: D1Database;
  proposals: Proposal[];
  ctx: IdeaCtx;
  embed: Embedder;
  openIssue: IssueOpener;
  now: number;
}): Promise<CaptureResult[]> {
  const { db, proposals, ctx, embed, openIssue, now } = opts;
  const results: CaptureResult[] = [];

  for (const p of proposals) {
    const slug = slugify(p.title);
    try {
      if (await slugExists(db, slug)) {
        results.push({ slug, outcome: 'already-tracked' });
        continue;
      }

      const vector = await embed(ideaText(p));
      if (!vector.length) {
        results.push({ slug, outcome: 'skipped' });
        continue;
      }

      const dup = await findDuplicate(db, vector);
      if (dup) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO fleet_ideas
               (slug, title, rationale, evidence_json, action, ship, owner, repo, pr_number,
                embedding_json, duplicate_of, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'duplicate', ?)`,
          )
          .bind(
            slug, p.title, p.rationale, JSON.stringify(p.evidence), p.action, ctx.shipName,
            ctx.owner, ctx.repo, ctx.prNumber, JSON.stringify(vector), dup.slug, now,
          )
          .run();
        results.push({ slug, outcome: 'duplicate', duplicateOf: dup.slug, issueUrl: dup.issueUrl ?? undefined });
        continue;
      }

      // Novel → open the issue, then record the canonical row.
      const issue = await openIssue(
        `[fleet-idea] ${p.title}`,
        renderIdeaIssueBody(p, ctx),
        [FLEET_IDEA_LABEL, `pd-${ctx.shipName}`],
      );
      await db
        .prepare(
          `INSERT OR IGNORE INTO fleet_ideas
             (slug, title, rationale, evidence_json, action, ship, owner, repo, pr_number,
              embedding_json, issue_number, issue_url, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tracked', ?)`,
        )
        .bind(
          slug, p.title, p.rationale, JSON.stringify(p.evidence), p.action, ctx.shipName,
          ctx.owner, ctx.repo, ctx.prNumber, JSON.stringify(vector), issue.number, issue.url, now,
        )
        .run();
      results.push({ slug, outcome: 'tracked-new', issueUrl: issue.url });
    } catch (err) {
      console.error(`[fleet-executor] idea capture failed slug=${slug}: ${String(err)}`);
      results.push({ slug, outcome: 'error' });
    }
  }

  return results;
}
