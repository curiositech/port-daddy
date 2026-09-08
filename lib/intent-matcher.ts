// TODO(intent-matcher): wire into begin_session (lib/sugar.ts) + intent_match MCP tool — see docs/architecture/agent-harbor-technical-binder/28-agent-coordination-and-onboarding.md
/**
 * Intent Matcher — semantic intent → salvage/roadmap ranking (onboarding keystone MVP).
 *
 * When an agent states a `purpose` at onboarding time, this ranks two candidate
 * sets — dead-agent salvage and roadmap items — by how semantically close each
 * candidate is to that purpose, so Port Daddy can surface "here's the abandoned
 * work and the roadmap item your intent is really about" instead of a generic
 * hint.
 *
 * HARD RULE (repo policy): ranking is PURE cosine over embeddings. There are no
 * keyword lists, substring scans, or signal-word arrays anywhere in this module.
 * The one shared cosine metric is imported from lib/semantic-resolver.ts; the
 * embedder is injected (the caller supplies the shared local MiniLM pipeline —
 * this module never stands up its own model).
 *
 * This MVP is a pure ranking function over caller-supplied candidates. It does
 * NOT read the resurrection queue, roadmap store, or a DB, and it is NOT yet
 * wired into `begin_session` or an MCP tool — see the top-of-file TODO.
 *
 * Example:
 * ```ts
 * const matcher = createIntentMatcher({ embedder });
 * const result = await matcher.match('fix the merge queue dedup', {
 *   salvage: [{ id: 'agent-merge', text: 'Deduplicate entries in the merge queue' }],
 *   roadmap: [{ id: 'merge-queue-dedup', title: 'Merge dedup', text: 'collapse duplicate PRs' }],
 * });
 * // result.salvage[0].id === 'agent-merge', result.roadmap[0].id === 'merge-queue-dedup'
 * ```
 */

import { cosineSimilarity } from './semantic-resolver.js';

/**
 * Minimal embedder contract: text → normalized vectors. Injected so callers pass
 * the shared local MiniLM pipeline (e.g. `createLocalEmbedder`) and tests pass a
 * deterministic fake — this module never constructs an embedder itself.
 */
export interface IntentEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** A single thing an intent might be "about" — a dead agent or a roadmap item. */
export interface Candidate {
  /** Stable identifier echoed back in the ranked result. */
  id: string;
  /** The free text embedded and compared against the purpose. */
  text: string;
  /** Optional human-facing label; defaults to `id` when absent. */
  title?: string;
}

/** The two candidate sets ranked independently against one purpose. */
export interface IntentMatchCandidates {
  salvage: Candidate[];
  roadmap: Candidate[];
}

/** One ranked candidate with its cosine score and a short explanation. */
export interface Ranked {
  id: string;
  title: string;
  /** Cosine similarity of the purpose to this candidate, higher = closer. */
  score: number;
  /** Human-readable reason — always the cosine score, never a matched keyword. */
  why: string;
}

/** The ranked bundle returned by {@link IntentMatcher.match}. */
export interface IntentMatchResult {
  salvage: Ranked[];
  roadmap: Ranked[];
}

export interface IntentMatchOptions {
  /** Max ranked entries returned per set. Defaults to 3. */
  topN?: number;
}

export interface IntentMatcher {
  /**
   * Rank `candidates.salvage` and `candidates.roadmap` by cosine similarity of
   * each candidate's text to `purpose`. Returns at most `opts.topN` (default 3)
   * per set, sorted by score descending, with ties broken by original input
   * order (stable). Empty candidate sets yield empty arrays and never throw.
   */
  match(
    purpose: string,
    candidates: IntentMatchCandidates,
    opts?: IntentMatchOptions,
  ): Promise<IntentMatchResult>;
}

const DEFAULT_TOP_N = 3;

/**
 * Rank one candidate set against the purpose vector. Pure cosine; ties preserve
 * the caller's original ordering via the carried index.
 */
function rankSet(
  purposeVector: number[],
  candidates: Candidate[],
  vectors: number[][],
  topN: number,
): Ranked[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: cosineSimilarity(purposeVector, vectors[index] ?? []),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, topN)
    .map(({ candidate, score }) => ({
      id: candidate.id,
      title: candidate.title ?? candidate.id,
      score,
      why: `semantic match — cosine ${score.toFixed(2)}`,
    }));
}

/**
 * Create an Intent Matcher backed by the injected embedder.
 *
 * The matcher embeds the purpose and every candidate text in ONE batched call,
 * then ranks each set by cosine similarity to the purpose.
 */
export function createIntentMatcher({ embedder }: { embedder: IntentEmbedder }): IntentMatcher {
  return {
    async match(purpose, candidates, opts) {
      const topN = Math.max(0, opts?.topN ?? DEFAULT_TOP_N);
      const salvage = candidates.salvage ?? [];
      const roadmap = candidates.roadmap ?? [];

      // Nothing to rank — don't bother the embedder.
      if (salvage.length === 0 && roadmap.length === 0) {
        return { salvage: [], roadmap: [] };
      }

      // One batched embed: [purpose, ...salvage texts, ...roadmap texts]. Slicing
      // back out relies on the embedder returning vectors in input order (the
      // documented contract for both the shared pipeline and the test fake).
      const salvageTexts = salvage.map((c) => c.text);
      const roadmapTexts = roadmap.map((c) => c.text);
      const vectors = await embedder.embed([purpose, ...salvageTexts, ...roadmapTexts]);

      const purposeVector = vectors[0] ?? [];
      const salvageVectors = vectors.slice(1, 1 + salvageTexts.length);
      const roadmapVectors = vectors.slice(1 + salvageTexts.length);

      return {
        salvage: rankSet(purposeVector, salvage, salvageVectors, topN),
        roadmap: rankSet(purposeVector, roadmap, roadmapVectors, topN),
      };
    },
  };
}
