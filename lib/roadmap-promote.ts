/**
 * Roadmap Promote — atomic linkage between feedback and roadmap_items.
 *
 * The pitch: when cartographer (or any subscriber) decides a feedback
 * entry deserves a place on the roadmap, the promotion should be a
 * single transactional operation that
 *
 *   (1) upserts a roadmap_item with `promotedFromFeedbackId` set, AND
 *   (2) marks the feedback entry harvested with `harvestedIntoSlug`
 *       pointing at the new roadmap_item slug.
 *
 * Today cartographer rewrites docs/ROADMAP.md prose and never updates
 * the feedback row's `harvestedAt` / `harvestedIntoSlug` fields, so the
 * linkage is lost. This module fixes that: a single call writes both
 * tuple sides and returns the resulting pair so callers (route, CLI,
 * MCP, fleet agents) all share the same atomic shape.
 *
 * NOTE on "atomic": tuples are append-only with their own write path,
 * so we cannot wrap the two outs in a single SQLite transaction without
 * reaching into the tuple-space internals. The contract here is
 * *operational* atomicity: if the feedback exists, both writes happen
 * back-to-back from the same process. The roadmap_item write is
 * intentionally first so that a partial failure leaves the feedback
 * unharvested (idempotent: callers can retry).
 *
 * Not for: bare CRUD on roadmap items (use `lib/roadmap-items.ts`
 * directly) or bare feedback harvest (use `lib/feedback.ts`). This
 * module is for the *linkage*.
 */

import type { Feedback, FeedbackEntry } from './feedback.js';
import type {
  RoadmapItem,
  RoadmapItems,
  RoadmapStatus,
} from './roadmap-items.js';
import { DEFAULT_ROADMAP_HARBOR } from './roadmap-items.js';
import { isSuspiciousHarbor } from './harbor-guard.js';

export interface PromoteFromFeedbackInput {
  feedbackId: string;
  /**
   * Roadmap slug for the new item. Defaults to the feedback's slug.
   * Callers can override when they want a different slug shape on the
   * roadmap (e.g. shorter, or grouped under a parent slug).
   */
  slug?: string;
  /**
   * Markdown summary for the roadmap entry. If omitted, falls back to
   * the feedback's `suggested` field, then `summary`. Cartographer
   * typically wants to *synthesize* a tighter summary, so the
   * `summaryMd` override is the normal path.
   */
  summaryMd?: string;
  status?: RoadmapStatus;
  dependencies?: string[];
  notes?: Array<{ at: number; by: string; text: string }>;
  /** Agent doing the promotion. Stamped on both sides. */
  promotedBy: string;
  /** Harbor override; defaults to the feedback's harbor. */
  harbor?: string;
}

export interface PromoteResult {
  roadmapItem: RoadmapItem;
  feedback: FeedbackEntry;
}

export interface RoadmapPromoteDeps {
  feedback: Pick<Feedback, 'get' | 'harvest'>;
  roadmapItems: Pick<RoadmapItems, 'upsert'>;
  /** Optional clock injection for tests. Defaults to Date.now(). */
  now?: () => number;
}

export function createRoadmapPromote(deps: RoadmapPromoteDeps) {
  const now = deps.now ?? (() => Date.now());

  function promoteFromFeedback(input: PromoteFromFeedbackInput): PromoteResult {
    if (!input.feedbackId || typeof input.feedbackId !== 'string') {
      throw new Error('roadmap.promoteFromFeedback: feedbackId is required (string)');
    }
    if (!input.promotedBy || typeof input.promotedBy !== 'string') {
      throw new Error('roadmap.promoteFromFeedback: promotedBy is required (string)');
    }

    const fb = deps.feedback.get(input.feedbackId, input.harbor);
    if (!fb) {
      throw new Error(
        `roadmap.promoteFromFeedback: no feedback '${input.feedbackId}' found`,
      );
    }

    const slug = (input.slug ?? fb.slug).trim();
    if (!slug) {
      throw new Error(
        'roadmap.promoteFromFeedback: slug must be non-empty after fallback to feedback.slug',
      );
    }

    const summaryMd = (
      input.summaryMd ?? fb.suggested ?? fb.summary
    ).trim();
    if (!summaryMd) {
      throw new Error(
        'roadmap.promoteFromFeedback: no summaryMd, suggested, or summary text to promote',
      );
    }

    const promotedAt = now();
    // `input.harbor` is caller-supplied free text (route/MCP body); `fb.harbor`
    // is inherited from whatever the ORIGINAL feedback.drop() call used — both
    // are unauthenticated. A value shaped like a session/PR/workflow-run id
    // (rather than a real project name) must not be allowed to fork the
    // roadmap into a one-off harbor. Prefer the caller's harbor if it's clean;
    // otherwise fall back to the feedback's own harbor if THAT is clean;
    // otherwise the roadmap default. (feedback.drop() now guards new drops at
    // the source, but this covers promotion of pre-existing, unguarded rows.)
    let harbor = input.harbor ?? fb.harbor;
    if (isSuspiciousHarbor(harbor)) {
      const safeFallback = isSuspiciousHarbor(fb.harbor) ? DEFAULT_ROADMAP_HARBOR : fb.harbor;
      console.warn(
        `roadmap.promoteFromFeedback: rejected suspicious harbor '${harbor}' (looks like a ` +
          `session/PR/workflow-run id, not a project name) — using '${safeFallback}' instead.`,
      );
      harbor = safeFallback;
    }

    // Write the roadmap item first. If this throws, the feedback stays
    // open and the caller can retry. If it succeeds, we proceed to mark
    // the feedback harvested — even if THAT throws, the link is half
    // there and a retry will be idempotent for the upsert side.
    const roadmapItem = deps.roadmapItems.upsert({
      slug,
      summaryMd,
      status: input.status ?? 'now',
      promotedFromFeedbackId: input.feedbackId,
      promotedByAgentId: input.promotedBy,
      promotedAt,
      dependencies: input.dependencies,
      notes: input.notes,
      harbor,
    });

    const feedback = deps.feedback.harvest({
      feedbackId: input.feedbackId,
      harvestedBy: input.promotedBy,
      intoSlug: roadmapItem.slug,
    });

    return { roadmapItem, feedback };
  }

  return { promoteFromFeedback };
}

export type RoadmapPromote = ReturnType<typeof createRoadmapPromote>;
