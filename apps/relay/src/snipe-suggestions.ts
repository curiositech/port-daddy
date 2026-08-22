/**
 * apps/relay/src/snipe-suggestions.ts — the Engineman's suggestion job (G′4).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT SNIPE IS, AND WHAT IT IS NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Snipe — also rated Engineman — is the fleet's below-decks trade: the hand
 * that keeps the plant running and builds the jig so the next watch does not
 * have to improvise. Its whole question is "would a reusable skill make this
 * kind of work materially easier next time?", and its answer is ADVISORY. In
 * the fleet it is `class: ideation`, it holds read-only tools, it never gates
 * a merge, and it hands over a proposal rather than an artifact.
 *
 * This module is that same trade, running on the account surface instead of on
 * a pull request. It produces up to {@link MAX_SUGGESTIONS_PER_RUN} proposed
 * skills per (account, repo) and stores them as rows a human can approve or
 * dismiss. It writes NOTHING to any catalog. The path from a stored row to a
 * skill that exists runs through src/snipe-builder.ts, and through a pull
 * request the operator merges.
 *
 * ── THE MODEL BINDING IS DEPLOY-TIME WIRING, AND THIS FILE SAYS SO ──────────
 *
 * There is no model call in this file. Candidate generation arrives through
 * {@link SuggestionProvider}, an injected interface with exactly one method.
 * That is not indirection for its own sake; it is an honest description of the
 * deployment:
 *
 *   · The relay's `AI` binding is OPTIONAL on `Env` (types.ts) — the Worker
 *     type-checks and deploys before it is provisioned. A suggestion job that
 *     assumed the binding would 500 on a relay that is otherwise healthy.
 *   · So the sweep resolves its provider at call time via
 *     {@link resolveSuggestionProvider}. When no provider is wired, the job
 *     records `UNCONFIGURED` on the intent row and produces zero suggestions.
 *     It does not fabricate proposals, and it does not pretend to have run.
 *   · Wiring a real provider is a deploy-time act — a binding plus the small
 *     adapter that turns it into `propose()`. Until that is done, every
 *     production surface built on this module honestly shows an empty state.
 *
 * Everything downstream of `propose()` — dedup, boundary rejection, the cap,
 * storage, the status law — is pure and deterministic, and is tested without
 * any provider at all.
 *
 * ── THE TWO GATES EVERY CANDIDATE PASSES ────────────────────────────────────
 *
 * 1. DEDUP against the repo's existing catalog ids AND against suggestions
 *    already recorded for that (account, repo) in ANY status. A dismissed
 *    proposal stays dismissed: re-proposing it would make "dismiss" a button
 *    that does nothing. Comparison is on a normalized slug, so `Skill Architect`,
 *    `skill_architect` and `skill-architect` are one skill, not three.
 *
 * 2. NOT-FOR BOUNDARIES. Skills in this catalog declare their own edges in
 *    prose — "NOT for borrow-checker firefighting (use rust-toolchain-workflow)".
 *    Those clauses are the catalog explicitly REJECTING a kind of skill, and a
 *    proposer that ignores them re-proposes work the corpus has already
 *    considered and turned down. {@link extractNotForBoundaries} reads those
 *    clauses off the live catalog and {@link boundaryVerdict} refuses any
 *    candidate that lands inside one. Both are pure text; neither asks a model
 *    to adjudicate its own proposal.
 *
 * The cap is applied LAST, after both gates, so ten survivors means ten
 * proposals that actually passed — not ten candidates of which some are junk.
 *
 * ── FAIL SEMANTICS ──────────────────────────────────────────────────────────
 *
 * The job follows the relay's sweep doctrine: the admission row exists before
 * any work starts (the `fleet_run_intents` idiom), the sweep never throws, and
 * every counter it reports is a real count. A job lost to an isolate eviction
 * leaves a visible 'running' row that {@link reapStuckJobs} returns to the
 * queue with a bounded attempt count — never a silent nothing, never an
 * infinite retry.
 */

import { randomHex } from './crypto.js';
import type { Env } from './types.js';

// ══════════════════════════════════════════════════════════════════════════
//  Bounds
// ══════════════════════════════════════════════════════════════════════════

/**
 * The hard ceiling on suggestions stored by ONE job run for ONE (account,
 * repo). Ten is a reading list, not a backlog: a surface that hands an
 * operator forty proposals has handed them a chore, and the approval gate
 * downstream only means something if each row is worth reading.
 */
export const MAX_SUGGESTIONS_PER_RUN = 10;

/** Candidates a provider may return before the job stops reading them. */
export const MAX_CANDIDATES_CONSIDERED = 100;

/** Jobs drained per sweep fire. Bounds one cron invocation's work. */
export const MAX_JOBS_PER_SWEEP = 5;

/** A 'running' job older than this is presumed lost and returned to 'queued'. */
export const JOB_STUCK_SECONDS = 15 * 60;

/** Attempts before a repeatedly-lost job is failed instead of re-queued. */
export const MAX_JOB_ATTEMPTS = 3;

/** Field bounds — D1 row sanity, and a proposal nobody can read is no proposal. */
export const MAX_SKILL_NAME_CHARS = 64;
export const MAX_DESCRIPTION_CHARS = 1_000;
export const MAX_RATIONALE_CHARS = 2_000;

/** Distinct boundary terms a candidate must hit before it is refused. */
export const BOUNDARY_MATCH_MIN_TERMS = 2;

const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A skill id is a directory name: lower-kebab, and nothing else ever. */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

// ══════════════════════════════════════════════════════════════════════════
//  The status law
// ══════════════════════════════════════════════════════════════════════════

export type SuggestionStatus = 'proposed' | 'approved' | 'dismissed' | 'built';

/** What can happen TO a suggestion. Named for the act, not the destination. */
export type SuggestionEvent = 'approve' | 'dismiss' | 'build-succeeded';

export interface TransitionOk {
  ok: true;
  from: SuggestionStatus;
  to: SuggestionStatus;
}
export interface TransitionRefused {
  ok: false;
  from: SuggestionStatus;
  event: SuggestionEvent;
  reason: string;
}
export type TransitionVerdict = TransitionOk | TransitionRefused;

/**
 * The complete, closed lifecycle of a suggestion. Every legal move is listed
 * here and nothing else is legal — in particular:
 *
 *   proposed --build-succeeded--> built   IS NOT A TRANSITION.
 *
 * That absence is the whole approval gate expressed as data. A build can only
 * conclude on a row that is already `approved`, and a row only reaches
 * `approved` through an explicit human act (src/snipe-builder.ts
 * `handleSnipeApprove`). There is no path from a fresh proposal to a built
 * skill that does not pass through a person.
 *
 * `dismissed` and `built` are terminal on purpose. Un-dismissing would make a
 * dismissal a suggestion rather than a decision; re-building would mean two
 * pull requests authoring the same skill directory.
 */
const LEGAL_TRANSITIONS: ReadonlyArray<{
  from: SuggestionStatus;
  event: SuggestionEvent;
  to: SuggestionStatus;
}> = [
  { from: 'proposed', event: 'approve', to: 'approved' },
  { from: 'proposed', event: 'dismiss', to: 'dismissed' },
  // An approval is retractable right up until a build claims its grant. The
  // builder's claim excludes revoked grants, so this is a real veto and not a
  // race the operator loses.
  { from: 'approved', event: 'dismiss', to: 'dismissed' },
  { from: 'approved', event: 'build-succeeded', to: 'built' },
];

/**
 * Adjudicate one lifecycle move. PURE — no I/O, no clock, no throw. The
 * database enforces the same law a second time through conditional UPDATEs
 * that name `from` in their WHERE clause; this function is what makes the law
 * readable and testable, not what makes it true.
 *
 * @param from The status the row is believed to hold.
 * @param event The act being attempted.
 * @returns A verdict carrying the destination, or the reason for refusal.
 */
export function nextStatus(from: SuggestionStatus, event: SuggestionEvent): TransitionVerdict {
  const hit = LEGAL_TRANSITIONS.find((t) => t.from === from && t.event === event);
  if (hit) return { ok: true, from, to: hit.to };
  if (from === 'proposed' && event === 'build-succeeded') {
    return {
      ok: false,
      from,
      event,
      reason:
        'a proposal cannot become a built skill without an explicit approval — ' +
        'approve it first, which is what mints the build grant',
    };
  }
  if (from === 'dismissed' || from === 'built') {
    return { ok: false, from, event, reason: `'${from}' is terminal; no further transitions` };
  }
  return { ok: false, from, event, reason: `'${event}' is not legal from '${from}'` };
}

// ══════════════════════════════════════════════════════════════════════════
//  Normalization — one skill, one identity
// ══════════════════════════════════════════════════════════════════════════

/**
 * Fold a skill name to the slug the dedup gate compares on: lowercase, every
 * run of non-alphanumerics collapsed to a single hyphen, edges trimmed.
 *
 * `Skill Architect`, `skill_architect`, `SKILL--ARCHITECT` and
 * `skill-architect` are all one skill. Without this, dedup is a spell-checker
 * rather than an identity test, and the storage-layer UNIQUE constraint would
 * be the only thing catching near-duplicates — too late to explain the
 * rejection to anyone.
 */
export function normalizeSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Words that carry no boundary meaning; excluded from every term set. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for',
  'from', 'how', 'in', 'into', 'is', 'it', 'its', 'not', 'of', 'on', 'onto',
  'or', 'over', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'use', 'used', 'uses', 'using', 'via', 'was', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'why', 'with', 'without',
  'you', 'your', 'skill', 'skills',
]);

/**
 * Content terms of a piece of prose: lowercased alphanumeric runs of three or
 * more characters, stopwords removed. Hyphenated ids contribute BOTH their
 * whole slug and their parts, so `rust-toolchain-workflow` overlaps a boundary
 * clause that only says "rust".
 */
export function contentTerms(raw: string): Set<string> {
  const out = new Set<string>();
  for (const token of raw.toLowerCase().split(/[^a-z0-9-]+/)) {
    const t = token.replace(/^-+|-+$/g, '');
    if (!t) continue;
    if (t.includes('-')) {
      if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t);
      for (const part of t.split('-')) {
        if (part.length >= 3 && !STOPWORDS.has(part)) out.add(part);
      }
      continue;
    }
    if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
//  NOT-FOR boundaries — the catalog's own refusals, read back
// ══════════════════════════════════════════════════════════════════════════

/** One "this is not what I am for" clause, attributed to the skill that wrote it. */
export interface SkillBoundary {
  /** The skill whose description declared the boundary. */
  skillId: string;
  /** The clause as written, for an honest refusal message. */
  clause: string;
  /** Content terms of the clause — what a candidate is measured against. */
  terms: Set<string>;
  /** Skill ids the clause redirects to, e.g. `(use rust-toolchain-workflow)`. */
  redirects: string[];
}

/** The minimum a catalog entry must expose for boundary extraction. */
export interface CatalogSkill {
  id: string;
  description: string;
}

/**
 * `NOT for …` through the end of its sentence. Case-insensitive on the word
 * "for" but NOT on "NOT": the corpus writes the negation in caps precisely to
 * mark it as a boundary, and matching a lowercase "not for" would swallow
 * ordinary prose ("this is not for the faint-hearted") as a hard edge.
 *
 * The clause ends at a period followed by whitespace, or at end of string —
 * so intra-clause punctuation (commas, parentheses, slashes, hyphenated ids)
 * survives into the term extraction.
 */
const NOT_FOR_RE = /\bNOT\s+(?:for|FOR)\b([^.]*)(?:\.|$)/g;

/** `(use some-skill-id)` / `(use a-id, b-id)` inside a boundary clause. */
const REDIRECT_RE = /\(\s*use\s+([^)]+)\)/gi;

/**
 * Read every NOT-FOR boundary the catalog declares about itself.
 *
 * These clauses are load-bearing, not decoration: a corpus that says "NOT for
 * generic ML tutorials" has already weighed that skill and declined it. A
 * proposer that cannot see the refusal proposes it again on the next run, and
 * the operator dismisses it again, forever. Reading the refusals is what makes
 * the job converge.
 *
 * PURE: takes entries, returns boundaries. No disk, no network, no clock.
 */
export function extractNotForBoundaries(skills: readonly CatalogSkill[]): SkillBoundary[] {
  const out: SkillBoundary[] = [];
  for (const skill of skills) {
    const desc = skill.description ?? '';
    NOT_FOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NOT_FOR_RE.exec(desc))) {
      const clause = (m[1] ?? '').trim();
      if (!clause) continue;
      const redirects: string[] = [];
      REDIRECT_RE.lastIndex = 0;
      let r: RegExpExecArray | null;
      while ((r = REDIRECT_RE.exec(clause))) {
        for (const raw of (r[1] ?? '').split(/[,;]|\bor\b/)) {
          const id = normalizeSkillName(raw);
          if (id) redirects.push(id);
        }
      }
      out.push({ skillId: skill.id, clause, terms: contentTerms(clause), redirects });
    }
  }
  return out;
}

export interface BoundaryVerdict {
  blocked: boolean;
  /** The skill whose boundary refused the candidate (when blocked). */
  by?: string;
  /** The clause as written, so the refusal can quote its own reason. */
  clause?: string;
  /** The overlapping terms that produced the refusal. */
  matched?: string[];
}

/**
 * Does this candidate land inside a boundary the catalog already declared?
 *
 * The test is term overlap, not similarity scoring: a candidate is refused
 * when its own name+description share {@link BOUNDARY_MATCH_MIN_TERMS} or more
 * distinct content terms with one clause. Two independent terms is a
 * deliberately conservative bar — one shared word ("rust", "agent") is a topic
 * in common, two or more is the same territory.
 *
 * Deterministic and inspectable on purpose. The alternative — asking a model
 * whether its own proposal violates a boundary — lets the proposer grade its
 * own work, which is not a check.
 *
 * @returns The first refusal found, with the clause that produced it, or an
 *   unblocked verdict. Never throws.
 */
export function boundaryVerdict(
  candidate: { skillName: string; description: string },
  boundaries: readonly SkillBoundary[],
): BoundaryVerdict {
  const slug = normalizeSkillName(candidate.skillName);
  const terms = contentTerms(`${candidate.skillName} ${candidate.description}`);
  for (const b of boundaries) {
    // A clause that names a redirect target is naming an EXISTING skill; a
    // candidate proposing that same id is refused outright, however few terms
    // it happens to share.
    if (slug && b.redirects.includes(slug)) {
      return { blocked: true, by: b.skillId, clause: b.clause, matched: [slug] };
    }
    const matched: string[] = [];
    for (const t of b.terms) if (terms.has(t)) matched.push(t);
    if (matched.length >= BOUNDARY_MATCH_MIN_TERMS) {
      return { blocked: true, by: b.skillId, clause: b.clause, matched: matched.sort() };
    }
  }
  return { blocked: false };
}

// ══════════════════════════════════════════════════════════════════════════
//  The provider seam — deploy-time wiring, declared honestly
// ══════════════════════════════════════════════════════════════════════════

/** What a provider is told about the repo it is proposing for. */
export interface SuggestionRequest {
  repoFullName: string;
  /** Ids already in this repo's catalog — a provider that repeats one wastes a slot. */
  existingSkillIds: string[];
  /** The catalog's own refusals, so a provider can avoid them before the gate does. */
  boundaries: SkillBoundary[];
  /** Upper bound on useful candidates; more than this are ignored. */
  limit: number;
}

/** One raw candidate, before either gate has looked at it. */
export interface SuggestionCandidate {
  skillName: string;
  description: string;
  rationale: string;
}

/**
 * The one seam between this job and whatever generates candidates.
 *
 * DEPLOY-TIME WIRING, stated plainly: the relay has no candidate generator
 * bound on this path today. `Env.AI` is optional (types.ts) and no adapter is
 * committed, so {@link resolveSuggestionProvider} returns `null` on a stock
 * deploy and the job records `UNCONFIGURED`. Standing this up in production is
 * a deployment act — provision a binding, commit the adapter that satisfies
 * this interface, and hand it to {@link runSnipeSuggestionJob} through
 * `deps.provider`. Nothing in this file will start proposing on its own.
 *
 * A provider is UNTRUSTED. Everything it returns is re-checked here: names are
 * re-slugged and re-validated, fields are length-clamped, duplicates and
 * boundary violations are refused, and the cap is applied after the gates. A
 * provider cannot widen its own budget, cannot skip dedup, and cannot store a
 * row.
 */
export interface SuggestionProvider {
  propose(req: SuggestionRequest): Promise<SuggestionCandidate[]>;
}

/**
 * The provider in force for this deploy, or `null` when none is wired.
 *
 * Returns `null` today, always, and says why in one place rather than
 * scattering `if (!env.AI)` through the job. When a generator is provisioned,
 * this is the single function that changes.
 */
export function resolveSuggestionProvider(_env: Env): SuggestionProvider | null {
  // No candidate generator is bound on this path. Deliberately not a throw and
  // deliberately not a stub that invents proposals: an unwired surface must
  // render empty and say so, never fabricate rows that a human would then be
  // asked to approve.
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
//  The filter — dedup, boundaries, cap
// ══════════════════════════════════════════════════════════════════════════

export interface AcceptedSuggestion extends SuggestionCandidate {
  /** The normalized id the row is stored under. */
  slug: string;
}

export type RejectionReason =
  | 'malformed'
  | 'duplicate-catalog'
  | 'duplicate-suggestion'
  | 'duplicate-batch'
  | 'boundary'
  | 'capped';

export interface RejectedSuggestion {
  candidate: SuggestionCandidate;
  reason: RejectionReason;
  /** Human-readable detail — the colliding id, or the clause that refused it. */
  detail: string;
}

export interface FilterResult {
  accepted: AcceptedSuggestion[];
  rejected: RejectedSuggestion[];
}

export interface FilterInputs {
  /** Skill ids already in the repo's catalog. */
  catalogIds: readonly string[];
  /** Names already proposed for this (account, repo), in ANY status. */
  existingSuggestionNames: readonly string[];
  /** Boundaries read off the live catalog. */
  boundaries: readonly SkillBoundary[];
  /** Ceiling on accepted rows. Defaults to {@link MAX_SUGGESTIONS_PER_RUN}. */
  limit?: number;
}

/**
 * Run every candidate through both gates and the cap, in that order.
 *
 * ORDER MATTERS AND IS PART OF THE CONTRACT. The cap is applied LAST, so ten
 * accepted suggestions are ten that actually survived dedup and the boundary
 * check — not ten off the top of a list of which several are junk. Capping
 * first would let a provider spend the operator's whole reading list on
 * duplicates.
 *
 * PURE: no I/O, no clock, no randomness. Every rejection is returned with its
 * reason so the job can count and the page can explain an empty result.
 *
 * @param candidates Raw provider output. Untrusted; re-validated here.
 * @param inputs The catalog ids, prior suggestions, and boundaries to test against.
 */
export function filterSuggestions(
  candidates: readonly SuggestionCandidate[],
  inputs: FilterInputs,
): FilterResult {
  const limit = Math.max(0, Math.min(inputs.limit ?? MAX_SUGGESTIONS_PER_RUN, MAX_SUGGESTIONS_PER_RUN));
  const catalog = new Set(inputs.catalogIds.map(normalizeSkillName).filter(Boolean));
  const priorSuggestions = new Set(
    inputs.existingSuggestionNames.map(normalizeSkillName).filter(Boolean),
  );
  const seenInBatch = new Set<string>();

  const accepted: AcceptedSuggestion[] = [];
  const rejected: RejectedSuggestion[] = [];

  for (const raw of candidates.slice(0, MAX_CANDIDATES_CONSIDERED)) {
    const skillName = normalizeSkillName(String(raw?.skillName ?? ''));
    const description = String(raw?.description ?? '').trim().slice(0, MAX_DESCRIPTION_CHARS);
    const rationale = String(raw?.rationale ?? '').trim().slice(0, MAX_RATIONALE_CHARS);

    if (!skillName || skillName.length > MAX_SKILL_NAME_CHARS || !SKILL_NAME_RE.test(skillName)) {
      rejected.push({ candidate: raw, reason: 'malformed', detail: 'skillName is not a usable skill id' });
      continue;
    }
    if (!description || !rationale) {
      rejected.push({ candidate: raw, reason: 'malformed', detail: 'description and rationale are both required' });
      continue;
    }
    if (catalog.has(skillName)) {
      rejected.push({ candidate: raw, reason: 'duplicate-catalog', detail: `'${skillName}' already exists in the catalog` });
      continue;
    }
    if (priorSuggestions.has(skillName)) {
      rejected.push({
        candidate: raw,
        reason: 'duplicate-suggestion',
        detail: `'${skillName}' has already been proposed for this repo`,
      });
      continue;
    }
    if (seenInBatch.has(skillName)) {
      rejected.push({ candidate: raw, reason: 'duplicate-batch', detail: `'${skillName}' appears twice in one batch` });
      continue;
    }
    const verdict = boundaryVerdict({ skillName, description }, inputs.boundaries);
    if (verdict.blocked) {
      rejected.push({
        candidate: raw,
        reason: 'boundary',
        detail: `'${verdict.by}' declares NOT for ${verdict.clause}`,
      });
      continue;
    }
    // Both gates passed. The cap is the last word.
    if (accepted.length >= limit) {
      rejected.push({ candidate: raw, reason: 'capped', detail: `beyond the ${limit}-suggestion cap for one run` });
      continue;
    }
    seenInBatch.add(skillName);
    accepted.push({ slug: skillName, skillName, description, rationale });
  }

  return { accepted, rejected };
}

// ══════════════════════════════════════════════════════════════════════════
//  Rows
// ══════════════════════════════════════════════════════════════════════════

export interface SuggestionRow {
  id: string;
  user_id: string;
  repo_full_name: string;
  skill_name: string;
  description: string;
  rationale: string;
  status: SuggestionStatus;
  created_at: number;
  updated_at: number;
  approved_at: number | null;
  approved_by: string | null;
  pr_url: string | null;
  build_error: string | null;
  job_id: string | null;
}

export type SuggestionJobState = 'queued' | 'running' | 'done' | 'failed';

export interface SuggestionJobRow {
  job_id: string;
  user_id: string;
  repo_full_name: string;
  state: SuggestionJobState;
  attempts: number;
  requested_at: number;
  started_at: number | null;
  finished_at: number | null;
  produced: number;
  rejected_dupe: number;
  rejected_boundary: number;
  rejected_capped: number;
  error: string | null;
}

const SUGGESTION_COLUMNS =
  'id, user_id, repo_full_name, skill_name, description, rationale, status, created_at, ' +
  'updated_at, approved_at, approved_by, pr_url, build_error, job_id';

/** Every suggestion for one (account, repo), newest first. Scoped by user_id. */
export async function listSuggestions(
  db: D1Database,
  userId: string,
  repoFullName: string,
  limit = 50,
): Promise<SuggestionRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${SUGGESTION_COLUMNS} FROM seamanship_suggestions ` +
        'WHERE user_id = ? AND repo_full_name = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .bind(userId, repoFullName, limit)
    .all<SuggestionRow>();
  return rows.results ?? [];
}

/**
 * One suggestion, but ONLY if it belongs to this account. The `user_id` in the
 * WHERE clause is the whole tenancy story: a row that is not yours reads as
 * absent, byte-identically to an id that never existed.
 */
export async function getSuggestion(
  db: D1Database,
  userId: string,
  suggestionId: string,
): Promise<SuggestionRow | null> {
  return (
    (await db
      .prepare(`SELECT ${SUGGESTION_COLUMNS} FROM seamanship_suggestions WHERE id = ? AND user_id = ?`)
      .bind(suggestionId, userId)
      .first<SuggestionRow>()) ?? null
  );
}

/** All names ever proposed for one (account, repo), in any status — the dedup set. */
export async function listSuggestedNames(
  db: D1Database,
  userId: string,
  repoFullName: string,
): Promise<string[]> {
  const rows = await db
    .prepare('SELECT skill_name FROM seamanship_suggestions WHERE user_id = ? AND repo_full_name = ?')
    .bind(userId, repoFullName)
    .all<{ skill_name: string }>();
  return (rows.results ?? []).map((r) => r.skill_name);
}

/**
 * Move one suggestion from a KNOWN prior status to a new one, as a single
 * conditional UPDATE.
 *
 * The `status = ?` in the WHERE clause is what makes the status law true at
 * runtime rather than merely documented: an attempt to move a row that is no
 * longer in `from` matches zero rows and returns false. Two concurrent
 * approvals, or an approval racing a dismissal, resolve to exactly one winner
 * with no read-modify-write window between them.
 *
 * @returns true when exactly this row moved; false when it did not (already
 *   moved, wrong owner, unknown id) — the caller must not assume which.
 */
export async function applySuggestionTransition(
  db: D1Database,
  m: {
    suggestionId: string;
    userId: string;
    from: SuggestionStatus;
    to: SuggestionStatus;
    now: number;
    approvedBy?: string;
    prUrl?: string;
    buildError?: string | null;
  },
): Promise<boolean> {
  const sets = ['status = ?', 'updated_at = ?'];
  const binds: unknown[] = [m.to, m.now];
  if (m.to === 'approved') {
    sets.push('approved_at = ?', 'approved_by = ?');
    binds.push(m.now, m.approvedBy ?? m.userId);
  }
  if (m.prUrl !== undefined) {
    sets.push('pr_url = ?');
    binds.push(m.prUrl);
  }
  if (m.buildError !== undefined) {
    sets.push('build_error = ?');
    binds.push(m.buildError);
  }
  binds.push(m.suggestionId, m.userId, m.from);
  const res = await db
    .prepare(
      `UPDATE seamanship_suggestions SET ${sets.join(', ')} ` +
        'WHERE id = ? AND user_id = ? AND status = ?',
    )
    .bind(...binds)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ══════════════════════════════════════════════════════════════════════════
//  The job — admission, run, sweep
// ══════════════════════════════════════════════════════════════════════════

export type EnqueueOutcome =
  | { ok: true; jobId: string }
  | { ok: false; code: 'BAD_REPO' | 'ALREADY_QUEUED' | 'DB_ERROR'; error: string };

/**
 * Record the admission receipt for a suggestion run. The row exists BEFORE any
 * work starts — the `fleet_run_intents` idiom — so a job that never completes
 * is visible as a stuck row rather than as nothing at all.
 *
 * Concurrency is settled by the partial unique index on (user_id,
 * repo_full_name) WHERE state IN ('queued','running'): a second enqueue for a
 * repo that already has live work fails its INSERT, which is reported as
 * ALREADY_QUEUED rather than racing the first job.
 */
export async function enqueueSuggestionJob(
  db: D1Database,
  m: { userId: string; repoFullName: string; now: number; jobId?: string },
): Promise<EnqueueOutcome> {
  if (!REPO_FULL_NAME_RE.test(m.repoFullName)) {
    return { ok: false, code: 'BAD_REPO', error: "repo must be 'owner/name'" };
  }
  const jobId = m.jobId ?? `sjob_${randomHex(12)}`;
  try {
    await db
      .prepare(
        'INSERT INTO seamanship_suggestion_jobs (job_id, user_id, repo_full_name, state, attempts, requested_at) ' +
          "VALUES (?, ?, ?, 'queued', 0, ?)",
      )
      .bind(jobId, m.userId, m.repoFullName, m.now)
      .run();
    return { ok: true, jobId };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/UNIQUE|constraint/i.test(msg)) {
      return { ok: false, code: 'ALREADY_QUEUED', error: 'a suggestion run for this repo is already in flight' };
    }
    return { ok: false, code: 'DB_ERROR', error: 'could not record the suggestion job' };
  }
}

/** Reads the repo's catalog so the job can dedup and read boundaries. */
export interface CatalogReader {
  read(userId: string, repoFullName: string): Promise<CatalogSkill[]>;
}

/**
 * The default catalog reader: the operator's parsed SKILL.md frontmatter as
 * already cached by the Seamanship surface (`seamanship_skill_cache`), scoped
 * to this user and this repo.
 *
 * Deliberately reads the CACHE rather than fetching the repo. This job runs on
 * a sweep, where there is no session and therefore no user grant to read GitHub
 * with; a cache row exists precisely because the operator's own page fetched it
 * under their own installation, so reading it here stays inside the grant that
 * produced it.
 *
 * An empty cache yields an empty catalog — no dedup ids, no boundaries. That is
 * the conservative direction on purpose: the gates can only ever reject MORE
 * than they would with full knowledge, never fewer, so a cold cache cannot
 * cause a proposal to slip past a boundary it should have hit. What it can do
 * is let a duplicate through, which the storage-layer UNIQUE constraint then
 * catches and counts as a duplicate.
 */
export function makeD1CatalogReader(db: D1Database): CatalogReader {
  return {
    async read(userId, repoFullName) {
      const rows = await db
        .prepare(
          'SELECT skill_id, description FROM seamanship_skill_cache WHERE user_id = ? AND repo_full_name = ? LIMIT 500',
        )
        .bind(userId, repoFullName)
        .all<{ skill_id: string; description: string }>();
      return (rows.results ?? []).map((r) => ({ id: r.skill_id, description: r.description ?? '' }));
    },
  };
}

export interface SuggestionJobDeps {
  provider?: SuggestionProvider | null;
  catalog: CatalogReader;
  now?: () => number;
  newId?: () => string;
}

export interface SuggestionJobResult {
  jobId: string;
  state: SuggestionJobState | 'skipped';
  produced: number;
  rejectedDupe: number;
  rejectedBoundary: number;
  rejectedCapped: number;
  error: string | null;
}

/**
 * Run ONE suggestion job to completion.
 *
 * Sequence, and why it is this sequence:
 *   1. CLAIM the job with a conditional UPDATE queued→running. Zero rows
 *      changed means another invocation already has it — return 'skipped'
 *      without spending anything. This is the only concurrency control needed;
 *      there is no lock to leak.
 *   2. READ the catalog for dedup ids and NOT-FOR boundaries.
 *   3. ASK the provider. Absent provider ⇒ the job finishes as 'failed' with
 *      UNCONFIGURED and zero produced. It does not invent proposals.
 *   4. FILTER — dedup, boundaries, then the cap (see {@link filterSuggestions}).
 *   5. STORE the survivors. A row that loses the storage-layer UNIQUE race is
 *      counted as a duplicate, not an error: another job got there first, which
 *      is the correct outcome.
 *   6. FINISH the intent row with real counts.
 *
 * NEVER THROWS. Every failure lands on the intent row as a state and a message.
 */
export async function runSnipeSuggestionJob(
  env: Env,
  jobId: string,
  deps: SuggestionJobDeps,
): Promise<SuggestionJobResult> {
  const db = env.DB;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const newId = deps.newId ?? (() => `sug_${randomHex(12)}`);
  const blank: SuggestionJobResult = {
    jobId,
    state: 'skipped',
    produced: 0,
    rejectedDupe: 0,
    rejectedBoundary: 0,
    rejectedCapped: 0,
    error: null,
  };

  let job: SuggestionJobRow | null;
  try {
    const claimed = await db
      .prepare(
        "UPDATE seamanship_suggestion_jobs SET state = 'running', started_at = ?, attempts = attempts + 1 " +
          "WHERE job_id = ? AND state = 'queued'",
      )
      .bind(now(), jobId)
      .run();
    if ((claimed.meta?.changes ?? 0) === 0) return blank;
    job = await db
      .prepare(
        'SELECT job_id, user_id, repo_full_name, state, attempts, requested_at, started_at, finished_at, ' +
          'produced, rejected_dupe, rejected_boundary, rejected_capped, error ' +
          'FROM seamanship_suggestion_jobs WHERE job_id = ?',
      )
      .bind(jobId)
      .first<SuggestionJobRow>();
  } catch (e) {
    return { ...blank, state: 'failed', error: publicMessage(e) };
  }
  if (!job) return blank;

  const finish = async (
    state: 'done' | 'failed',
    counts: { produced: number; dupe: number; boundary: number; capped: number },
    error: string | null,
  ): Promise<SuggestionJobResult> => {
    try {
      await db
        .prepare(
          'UPDATE seamanship_suggestion_jobs SET state = ?, finished_at = ?, produced = ?, ' +
            'rejected_dupe = ?, rejected_boundary = ?, rejected_capped = ?, error = ? WHERE job_id = ?',
        )
        .bind(state, now(), counts.produced, counts.dupe, counts.boundary, counts.capped, error, jobId)
        .run();
    } catch {
      // The run itself already happened; failing to record its epilogue must
      // not turn a completed job into a thrown error at the call site.
    }
    return {
      jobId,
      state,
      produced: counts.produced,
      rejectedDupe: counts.dupe,
      rejectedBoundary: counts.boundary,
      rejectedCapped: counts.capped,
      error,
    };
  };

  const zero = { produced: 0, dupe: 0, boundary: 0, capped: 0 };
  const provider = deps.provider ?? resolveSuggestionProvider(env);
  if (!provider) {
    return finish(
      'failed',
      zero,
      'UNCONFIGURED: no suggestion provider is wired on this deploy — see snipe-suggestions.ts',
    );
  }

  let catalog: CatalogSkill[];
  try {
    catalog = await deps.catalog.read(job.user_id, job.repo_full_name);
  } catch (e) {
    return finish('failed', zero, `catalog read failed: ${publicMessage(e)}`);
  }

  const boundaries = extractNotForBoundaries(catalog);
  let priorNames: string[];
  try {
    priorNames = await listSuggestedNames(db, job.user_id, job.repo_full_name);
  } catch (e) {
    return finish('failed', zero, `dedup read failed: ${publicMessage(e)}`);
  }

  let candidates: SuggestionCandidate[];
  try {
    candidates = await provider.propose({
      repoFullName: job.repo_full_name,
      existingSkillIds: catalog.map((s) => s.id),
      boundaries,
      limit: MAX_SUGGESTIONS_PER_RUN,
    });
  } catch (e) {
    return finish('failed', zero, `provider failed: ${publicMessage(e)}`);
  }

  const filtered = filterSuggestions(Array.isArray(candidates) ? candidates : [], {
    catalogIds: catalog.map((s) => s.id),
    existingSuggestionNames: priorNames,
    boundaries,
    limit: MAX_SUGGESTIONS_PER_RUN,
  });

  let dupe = filtered.rejected.filter((r) => r.reason.startsWith('duplicate')).length;
  const boundaryRejects = filtered.rejected.filter((r) => r.reason === 'boundary').length;
  const capped = filtered.rejected.filter((r) => r.reason === 'capped').length;
  let produced = 0;

  for (const s of filtered.accepted) {
    try {
      await db
        .prepare(
          'INSERT INTO seamanship_suggestions (id, user_id, repo_full_name, skill_name, description, ' +
            "rationale, status, created_at, updated_at, job_id) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)",
        )
        .bind(
          newId(),
          job.user_id,
          job.repo_full_name,
          s.skillName,
          s.description,
          s.rationale,
          now(),
          now(),
          jobId,
        )
        .run();
      produced += 1;
    } catch (e) {
      // The storage-layer UNIQUE (user_id, repo_full_name, skill_name) is the
      // last line of the dedup gate. Losing that race means a concurrent job
      // proposed it first — the right outcome, counted as a duplicate rather
      // than reported as a failure.
      if (/UNIQUE|constraint/i.test(String(e instanceof Error ? e.message : e))) {
        dupe += 1;
        continue;
      }
      return finish('failed', { produced, dupe, boundary: boundaryRejects, capped }, `store failed: ${publicMessage(e)}`);
    }
  }

  return finish('done', { produced, dupe, boundary: boundaryRejects, capped }, null);
}

export interface SuggestionSweepResult {
  now: number;
  jobsRun: number;
  jobsSkipped: number;
  suggestionsProduced: number;
  stuckReaped: number;
  stuckFailed: number;
  errors: string[];
}

/**
 * Return jobs that have been 'running' longer than {@link JOB_STUCK_SECONDS} to
 * the queue, or fail them once they have burned {@link MAX_JOB_ATTEMPTS}.
 *
 * A Worker isolate can be evicted mid-job with no chance to record anything, so
 * "still running" is not evidence that anything is running. Bounded re-queueing
 * is the honest reading of that: try again a couple of times, then say it
 * failed rather than retrying forever.
 */
export async function reapStuckJobs(
  db: D1Database,
  now: number,
): Promise<{ reaped: number; failed: number }> {
  const horizon = now - JOB_STUCK_SECONDS;
  const failed = await db
    .prepare(
      "UPDATE seamanship_suggestion_jobs SET state = 'failed', finished_at = ?, " +
        "error = 'abandoned: exceeded the retry budget' " +
        "WHERE state = 'running' AND started_at < ? AND attempts >= ?",
    )
    .bind(now, horizon, MAX_JOB_ATTEMPTS)
    .run();
  const reaped = await db
    .prepare(
      "UPDATE seamanship_suggestion_jobs SET state = 'queued', started_at = NULL " +
        "WHERE state = 'running' AND started_at < ? AND attempts < ?",
    )
    .bind(horizon, MAX_JOB_ATTEMPTS)
    .run();
  return { reaped: reaped.meta?.changes ?? 0, failed: failed.meta?.changes ?? 0 };
}

/**
 * Drain queued suggestion jobs, oldest first, bounded by
 * {@link MAX_JOBS_PER_SWEEP}.
 *
 * This is a DRAINER, not a poller of operator state: jobs land here because a
 * person asked for suggestions on their repo. The cron exists so a job that
 * lost its isolate still finishes, which is maintenance — the same role the
 * retention and vitals sweeps play.
 *
 * Internally fail-safe, like every sweep the relay schedules: it returns a
 * counter struct with an `errors` array and never throws into the handler.
 */
export async function runSnipeSuggestionSweep(
  env: Env,
  now: number,
  deps: SuggestionJobDeps,
): Promise<SuggestionSweepResult> {
  const result: SuggestionSweepResult = {
    now,
    jobsRun: 0,
    jobsSkipped: 0,
    suggestionsProduced: 0,
    stuckReaped: 0,
    stuckFailed: 0,
    errors: [],
  };
  try {
    const reap = await reapStuckJobs(env.DB, now);
    result.stuckReaped = reap.reaped;
    result.stuckFailed = reap.failed;
  } catch (e) {
    result.errors.push(`reap: ${publicMessage(e)}`);
  }

  let queued: { job_id: string }[] = [];
  try {
    const rows = await env.DB.prepare(
      "SELECT job_id FROM seamanship_suggestion_jobs WHERE state = 'queued' ORDER BY requested_at ASC LIMIT ?",
    )
      .bind(MAX_JOBS_PER_SWEEP)
      .all<{ job_id: string }>();
    queued = rows.results ?? [];
  } catch (e) {
    result.errors.push(`list: ${publicMessage(e)}`);
    return result;
  }

  for (const row of queued) {
    try {
      const r = await runSnipeSuggestionJob(env, row.job_id, { ...deps, now: deps.now ?? (() => now) });
      if (r.state === 'skipped') result.jobsSkipped += 1;
      else result.jobsRun += 1;
      result.suggestionsProduced += r.produced;
      if (r.error) result.errors.push(`${row.job_id}: ${r.error}`);
    } catch (e) {
      // runSnipeSuggestionJob is written not to throw; this guard means one
      // pathological job can never abort the drain of the others.
      result.errors.push(`${row.job_id}: ${publicMessage(e)}`);
    }
  }
  return result;
}

/** Redaction-safe error text — the house `publicError` shape. */
function publicMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/[A-Za-z0-9+/=_-]{60,}/g, '[redacted]').slice(0, 240);
}
