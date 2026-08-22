/**
 * Skill Graft Events — turns a successful skill-graft craft-and-splice into
 * auditable `pd.agent-harbor.skill-graft.v0` records
 * (schemas/agent-harbor/v0/skill-graft.schema.json) instead of leaving the
 * injection silent.
 *
 * That schema's own description is the mandate: "Grafts are auditable facts
 * with a reason and an outcome, not silent prompt injection." Before this
 * module, `lib/fleet-engine.ts`'s `appendSkillGraftContext` spliced
 * `craft()`'s top-ranked skill bodies straight into a ship's task text and
 * nothing else ever recorded that it happened — the exact "native fleet
 * graft injects silently" gap `skills/legibility-for-agentic-systems`
 * (F5 — the sovereign that can't be audited) calls out. This module is the
 * missing half: for every skill actually spliced (`SkillGraftResult.top` —
 * the ones whose FULL SKILL.md body landed in the task, level 'full' per
 * binder ch09), build one schema-conformant graft record the caller can
 * hand to its own transcript-event sink. It does not record anything
 * itself — see `lib/fleet-engine.ts`'s `recordSkillGraftEvents` for the
 * wiring into the engine's existing `emit()` path.
 */

import { randomUUID } from 'node:crypto';
import type { SkillGraftEntry, SkillGraftResult } from './skill-graft.js';

/** Mirrors schemas/agent-harbor/v0/skill-graft.schema.json's `level` enum. */
export type SkillGraftEventLevel = 'light' | 'reference' | 'full' | 'tool' | 'team';

/** Mirrors schemas/agent-harbor/v0/skill-graft.schema.json's `outcome` enum. */
export type SkillGraftEventOutcome = 'pending' | 'used' | 'unused' | 'helpful' | 'unhelpful' | 'revoked' | null;

/** Freshly built records always start here — nothing has consumed the graft yet. */
export const SKILL_GRAFT_INITIAL_OUTCOME: SkillGraftEventOutcome = 'pending';

/**
 * One `pd.agent-harbor.skill-graft.v0` record. Covers the schema's required
 * fields (schema, graftId, agentNodeId, skillName, level, reason, createdAt)
 * plus the optional fields this module always fills; the schema itself wins
 * on any disagreement (ADR-0095 tolerant-reader posture — its
 * `additionalProperties: true` makes this type a floor, not a ceiling).
 */
export interface SkillGraftEvent {
  schema: 'pd.agent-harbor.skill-graft.v0';
  graftId: string;
  agentNodeId: string;
  sessionId: string | null;
  runId: string | null;
  skillCardId: string | null;
  skillName: string;
  skillVersion: string | null;
  level: SkillGraftEventLevel;
  reason: string;
  grantedBy: string;
  expiresAt: string | null;
  sourceEventId: string | null;
  outcome: SkillGraftEventOutcome;
  createdAt: string;
}

export interface BuildSkillGraftEventParams {
  /** The agent node this graft was spliced into (schema's `agentNodeId`).
   *  Fleet ships pass their already-computed `identity` — Agent Harbor's own
   *  node-id assignment (ADR-0095) hasn't reached the fleet-engine spawn
   *  path yet, so the identity string IS the ship's addressable name today. */
  agentNodeId: string;
  /** `craft()`'s own result — source of truth for which skills were
   *  actually spliced (`.top`) and how they were matched (`.shortlist`,
   *  `.semanticTier`). */
  result: SkillGraftResult;
  /** The ship/config that opted this graft in (schema's `grantedBy`:
   *  "planner, operator, or staff agent that approved the graft"). A fleet
   *  ship has none of those — its own `pd-fleet.yml` `skill_graft: true`
   *  flag IS the approval, so callers pass an identifier for that ship/
   *  config (e.g. `fleet-ship:<identity>`). */
  grantedBy: string;
  sessionId?: string | null;
  runId?: string | null;
  /** Injected for deterministic tests; defaults to `randomUUID`. */
  newId?: () => string;
  /** Injected for deterministic tests; defaults to `() => new Date().toISOString()`. */
  now?: () => string;
}

/**
 * Build one schema-conformant skill-graft record per FULLY spliced skill —
 * `result.top`, the entries whose complete SKILL.md body actually landed in
 * the ship's task text (level 'full'). `result.shortlist`-only entries were
 * ranked but never injected, so they get no record: a graft is a record of
 * what was actually spliced, not of what was merely considered. Returns
 * `[]` when nothing was spliced — a `craft()` call with an empty `top` is
 * not a graft.
 *
 * Pure given its inputs: the same `result` plus the same injected
 * `newId`/`now` always produces the same array.
 */
export function buildSkillGraftEvent(params: BuildSkillGraftEventParams): SkillGraftEvent[] {
  const { agentNodeId, result, grantedBy, sessionId = null, runId = null } = params;
  const newId = params.newId ?? (() => randomUUID());
  const now = params.now ?? (() => new Date().toISOString());
  const createdAt = now();

  return result.top.map((entry) => ({
    schema: 'pd.agent-harbor.skill-graft.v0' as const,
    graftId: `graft_${newId()}`,
    agentNodeId,
    sessionId,
    runId,
    skillCardId: null,
    skillName: entry.id,
    skillVersion: null,
    level: 'full' as const,
    reason: buildGraftReason(entry, result),
    grantedBy,
    expiresAt: null,
    sourceEventId: null,
    outcome: SKILL_GRAFT_INITIAL_OUTCOME,
    createdAt,
  }));
}

/**
 * The task-match rationale: which query this graft matched, this skill's
 * own relevance signal, which ranking tier produced it (hybrid vs.
 * lexical-only per `SkillGraftResult.semanticTier`), and the sibling skill
 * ids it was shortlisted alongside — an auditor reading only this string
 * can see why the planner/index chose this skill over the rest of the
 * catalog. Mirrors `renderSkillGraftContext()`'s own honest-relevance
 * framing (lib/skill-graft.ts): a BM25-only match reports 0 similarity,
 * which reads as "no relevance" when it really means "not semantically
 * scored" — label that case as a lexical match instead of printing a
 * misleading `0.000`.
 */
function buildGraftReason(entry: SkillGraftEntry, result: SkillGraftResult): string {
  const relevance = entry.similarity > 0
    ? `similarity ${entry.similarity.toFixed(3)}`
    : 'lexical match';
  const shortlistIds = result.shortlist.map((candidate) => candidate.id).join(', ');
  return `craft() matched "${entry.id}" (${relevance}, ${result.semanticTier}) for task "${truncate(result.query, 120)}" among shortlist [${shortlistIds}]`;
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
