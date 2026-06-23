/**
 * Idea Intake — the pure consult + disposition core (ADR-0085).
 *
 * "Slide an idea in and have one responsible agent consult everything that matters, ask the
 * few questions that resolve placement, and slot the work in a sensible order." This module is
 * the brain of that flow, with the same discipline as `lib/surface-overlap.ts`,
 * `lib/suggestion-broker.ts`, and `lib/adr-matrix.ts`: it is PURE. No DB, no network, no model
 * call lives here. The embedder, the roadmap list, the active-claims set, and the ADR phase
 * index are all INJECTED, so the contract (idea + substrate → report + disposition) is
 * exhaustively unit-testable without a daemon. The IO orchestrator that fetches roadmap, runs
 * the embedder, persists the draft, and delivers escalations is a separate thin layer.
 *
 * Relatedness is semantic (cosine over the local embedder's vectors), NEVER keyword matching —
 * the caller embeds the idea text and each roadmap candidate, and passes the vectors in.
 *
 * Disposition follows the operator directive: auto-commit is the norm; a human is pulled in
 * only for the non-mundane (duplicate, in-flight clash, high-impact placement, or low
 * confidence). See ADR-0085 § Disposition model.
 */

import type { RoadmapStatus } from './roadmap-items.js';

// ─── Inputs (structural; the IO layer maps real rows/vectors onto these) ─────

/** The minimal shape of a roadmap item this core needs. A structural subset of
 *  `RoadmapItem` so callers can pass real rows directly. */
export interface RoadmapCandidate {
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
}

/** One roadmap candidate paired with its embedding vector (from the local embedder). */
export interface VectoredCandidate {
  item: RoadmapCandidate;
  vector: number[];
}

/** A raw idea awaiting consultation. `answers` accumulate across `idea_answer` rounds. */
export interface IdeaDraft {
  id: string;
  text: string;
  harbor: string;
  by: string | null;
  createdAt: number;
  answers?: string[];
}

/** Tunable thresholds, in one place so the whole flow shares them. Mirrors the
 *  spirit of `lib/semantic-resolver.ts`'s auto/review thresholds. */
export interface IntakeThresholds {
  /** Min cosine to list an item as "related" at all. */
  relate: number;
  /** A related item at/above this is treated as a likely duplicate (merge, don't double-file). */
  dedup: number;
  /** A candidate dependency / strong-relation cut — used for placement inference. */
  strong: number;
  /** Below this top-match similarity (with no strong relation) we are "not confident" and escalate. */
  review: number;
}

export const DEFAULT_INTAKE_THRESHOLDS: IntakeThresholds = {
  relate: 0.5,
  dedup: 0.92,
  strong: 0.7,
  review: 0.8,
};

export interface ConsultInput {
  draft: IdeaDraft;
  /** Embedding of the idea text (caller runs the embedder). */
  ideaVector: number[];
  /** Roadmap items + their embeddings to consult against. */
  candidates: VectoredCandidate[];
  /** Slugs currently held in the roadmap-claims ledger (someone is in-flight on them). */
  claimedSlugs: Set<string>;
  /** Map of roadmap slug → ADR number that introduced it (from `lib/adr-matrix.ts`). */
  adrPhaseIndex: Map<string, string>;
  thresholds?: IntakeThresholds;
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

export interface RelatedItem {
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
  similarity: number;
}

export interface CoveringAdr {
  /** Zero-padded ADR number, e.g. "0043". */
  number: string;
  /** The related roadmap slug that maps to this ADR. */
  viaSlug: string;
}

export interface InFlightClash {
  slug: string;
  similarity: number;
}

export interface SuggestedPlacement {
  status: RoadmapStatus;
  dependsOn: string[];
  after: string[];
  before: string[];
}

export type IntakeDisposition = 'auto-commit' | 'escalate';

export interface ConsultationReport {
  draftId: string;
  relatedRoadmap: RelatedItem[];
  coveringAdrs: CoveringAdr[];
  inFlightClashes: InFlightClash[];
  duplicateOf?: string;
  suggestedPlacement: SuggestedPlacement;
  disposition: IntakeDisposition;
  escalationReasons: string[];
  clarifyingQuestions: string[];
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

const STATUS_RANK: Record<RoadmapStatus, number> = {
  now: 0,
  merge: 1,
  backlog: 2,
  parked: 3,
  done: 4,
};

/**
 * Cosine similarity. The local embedder returns normalized vectors (so this reduces to a dot
 * product — see the note in `lib/semantic-resolver.ts`), but we divide by the norms anyway so
 * the function is correct for arbitrary injected vectors (tests, future embedders). Duplicated
 * here as a small pure fn — exactly as `lib/suggestion-broker.ts` duplicates `rangesOverlap` —
 * to avoid importing `semantic-resolver`'s model-loading module into this leaf core.
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

/**
 * Rank roadmap candidates by cosine similarity to the idea, keep those at/above the `relate`
 * threshold, sorted descending (ties broken by status priority then slug for determinism).
 */
export function rankRelated(
  ideaVector: number[],
  candidates: VectoredCandidate[],
  threshold: number,
): RelatedItem[] {
  return candidates
    .map((c) => ({
      slug: c.item.slug,
      summaryMd: c.item.summaryMd,
      status: c.item.status,
      similarity: cosineSimilarity(ideaVector, c.vector),
    }))
    .filter((r) => r.similarity >= threshold)
    .sort((x, y) => {
      if (y.similarity !== x.similarity) return y.similarity - x.similarity;
      if (STATUS_RANK[x.status] !== STATUS_RANK[y.status]) {
        return STATUS_RANK[x.status] - STATUS_RANK[y.status];
      }
      return x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0;
    });
}

/**
 * Infer where the idea should slot, from the related items alone (deterministic, honest about
 * what text can and cannot tell us):
 *   - status: 'now' if any strong relation is active work ('now'); else 'backlog'.
 *   - dependsOn: strong, not-done related items (CANDIDATE deps — confirmed by a follow-up).
 *   - after: strong related items already in flight ('now'/'merge').
 *   - before: left empty — text cannot tell us what this unblocks.
 */
export function inferPlacement(related: RelatedItem[], thresholds: IntakeThresholds): SuggestedPlacement {
  const strong = related.filter((r) => r.similarity >= thresholds.strong);
  const status: RoadmapStatus = strong.some((r) => r.status === 'now') ? 'now' : 'backlog';
  const dependsOn = strong.filter((r) => r.status !== 'done').map((r) => r.slug);
  const after = strong.filter((r) => r.status === 'now' || r.status === 'merge').map((r) => r.slug);
  return { status, dependsOn, after, before: [] };
}

/** Which ADRs already cover this, derived from related slugs that are ADR phases. */
function coveringAdrsFor(related: RelatedItem[], adrPhaseIndex: Map<string, string>): CoveringAdr[] {
  const out: CoveringAdr[] = [];
  const seen = new Set<string>();
  for (const r of related) {
    const num = adrPhaseIndex.get(r.slug);
    if (num && !seen.has(num)) {
      seen.add(num);
      out.push({ number: num, viaSlug: r.slug });
    }
  }
  return out;
}

/** Related items that are currently claimed → the "unspider" warning at intake time. */
function clashesFor(related: RelatedItem[], claimedSlugs: Set<string>): InFlightClash[] {
  return related
    .filter((r) => claimedSlugs.has(r.slug))
    .map((r) => ({ slug: r.slug, similarity: r.similarity }));
}

/**
 * Decide auto-commit vs escalate, and explain why. Auto-commit is the norm (ADR-0085); a human
 * is pulled in only for the non-mundane. Pure: a function of the assembled report fields.
 */
export function decideDisposition(args: {
  duplicateOf?: string;
  inFlightClashes: InFlightClash[];
  placement: SuggestedPlacement;
  topSimilarity: number;
  hasStrongRelation: boolean;
  thresholds: IntakeThresholds;
}): { disposition: IntakeDisposition; reasons: string[] } {
  const reasons: string[] = [];
  if (args.duplicateOf) {
    reasons.push(`Looks like a duplicate of "${args.duplicateOf}" — merge or file separately?`);
  }
  if (args.inFlightClashes.length > 0) {
    const slugs = args.inFlightClashes.map((c) => c.slug).join(', ');
    reasons.push(`Active work is in flight on related item(s): ${slugs}.`);
  }
  if (args.placement.status === 'now') {
    reasons.push('Suggested placement is high priority (now), which reorders active work.');
  }
  if (!args.hasStrongRelation && args.topSimilarity < args.thresholds.review) {
    reasons.push('Could not place this confidently — no strongly related existing work.');
  }
  return { disposition: reasons.length > 0 ? 'escalate' : 'auto-commit', reasons };
}

/** Deterministic skeleton follow-ups from the gaps. The IO layer MAY enrich these with an LLM
 *  (routed through `resolveLLMBackend`), but the core always provides usable questions. */
function clarifyingQuestionsFor(args: {
  duplicateOf?: string;
  inFlightClashes: InFlightClash[];
  placement: SuggestedPlacement;
  hasStrongRelation: boolean;
  topSimilarity: number;
  thresholds: IntakeThresholds;
}): string[] {
  const qs: string[] = [];
  if (args.duplicateOf) {
    qs.push(`Should this merge into "${args.duplicateOf}", or is it genuinely separate work?`);
  }
  if (args.inFlightClashes.length > 0) {
    qs.push(
      `${args.inFlightClashes.length} related item(s) are claimed right now — coordinate with the holder(s) before adding parallel work?`,
    );
  }
  if (args.placement.dependsOn.length > 0) {
    qs.push(`Should this depend on: ${args.placement.dependsOn.join(', ')}?`);
  }
  if (args.placement.status === 'now') {
    qs.push('File at high priority (now), or queue it in backlog?');
  }
  if (!args.hasStrongRelation && args.topSimilarity < args.thresholds.review) {
    qs.push('Which area of the roadmap does this belong to? I could not place it confidently.');
  }
  return qs;
}

// ─── Top-level consult ───────────────────────────────────────────────────────

/**
 * Assemble the full ConsultationReport from the idea and the injected substrate. Pure.
 */
export function consult(input: ConsultInput): ConsultationReport {
  const thresholds = input.thresholds ?? DEFAULT_INTAKE_THRESHOLDS;
  const related = rankRelated(input.ideaVector, input.candidates, thresholds.relate);
  const topSimilarity = related.length > 0 ? related[0].similarity : 0;
  const hasStrongRelation = related.some((r) => r.similarity >= thresholds.strong);

  // Duplicate = the single closest related item, if it is at/above the dedup threshold and is
  // not already finished work (you don't "merge into" a done item; that's a fresh idea).
  const duplicateOf =
    related.length > 0 && related[0].similarity >= thresholds.dedup && related[0].status !== 'done'
      ? related[0].slug
      : undefined;

  const inFlightClashes = clashesFor(related, input.claimedSlugs);
  const coveringAdrs = coveringAdrsFor(related, input.adrPhaseIndex);
  const suggestedPlacement = inferPlacement(related, thresholds);

  const { disposition, reasons } = decideDisposition({
    duplicateOf,
    inFlightClashes,
    placement: suggestedPlacement,
    topSimilarity,
    hasStrongRelation,
    thresholds,
  });

  const clarifyingQuestions = clarifyingQuestionsFor({
    duplicateOf,
    inFlightClashes,
    placement: suggestedPlacement,
    hasStrongRelation,
    topSimilarity,
    thresholds,
  });

  return {
    draftId: input.draft.id,
    relatedRoadmap: related,
    coveringAdrs,
    inFlightClashes,
    ...(duplicateOf ? { duplicateOf } : {}),
    suggestedPlacement,
    disposition,
    escalationReasons: reasons,
    clarifyingQuestions,
  };
}

// ─── work_next: the "let Port Daddy steer them" verb ─────────────────────────

export interface NextWorkChoice {
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
  rationale: string;
}

/**
 * Pick the highest-value unclaimed item for an asking agent. Pure: filters out claimed and
 * done items, prefers higher priority (now < merge < backlog ...), then most recently touched
 * order as supplied. Returns null when there is nothing actionable.
 *
 * `candidates` should be supplied in the caller's preferred tiebreak order (e.g. roadmap
 * `list()` order, which is already status-rank then last-touched-desc).
 */
export function selectNextWork(
  candidates: RoadmapCandidate[],
  claimedSlugs: Set<string>,
  identity: string,
): NextWorkChoice | null {
  const actionable = candidates.filter(
    (c) => c.status !== 'done' && c.status !== 'parked' && !claimedSlugs.has(c.slug),
  );
  if (actionable.length === 0) return null;
  // Stable sort by priority; preserve incoming order within a tier.
  const sorted = actionable
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      const r = STATUS_RANK[x.c.status] - STATUS_RANK[y.c.status];
      return r !== 0 ? r : x.i - y.i;
    })
    .map((w) => w.c);
  const chosen = sorted[0];
  return {
    slug: chosen.slug,
    summaryMd: chosen.summaryMd,
    status: chosen.status,
    rationale: `Highest-priority unclaimed item (${chosen.status}) with no active claim; assigned to ${identity}.`,
  };
}
