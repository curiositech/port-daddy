/**
 * Arrival briefing — what an agent should be told the moment it starts.
 *
 * A new session begins knowing nothing: not that someone abandoned this exact
 * work an hour ago, not that a roadmap item already describes it, not that a
 * skill in the catalog exists precisely for it, and not that another agent is
 * editing the same files right now. All four facts are already in the daemon.
 * None of them arrive unless something goes and looks.
 *
 * **Relevance, not a state dump.** `lib/briefing.ts` already projects project
 * state into `.portdaddy/` for agents to read; this module is the layer above
 * it that decides *which* of that state is worth an arriving agent's attention.
 * The distinction is the whole point — an agent that gets everything reads
 * nothing, and a briefing that fires on every session with the same content is
 * indistinguishable from noise. Sections that match nothing are omitted rather
 * than rendered empty.
 *
 * **Pure by construction.** Every function here takes already-fetched corpora
 * and returns a ranking. No database, no filesystem, no clock beyond an injected
 * one. The caller (the session-start path, or `pd briefing --arrival`) does the
 * I/O. That split is what makes the ranking decisions — which are the part that
 * can be subtly, silently wrong — testable against fixtures.
 *
 * Scoring reuses `tokenizeAndStem` from the skill-graft BM25 implementation so
 * that "reconcile"/"reconciling"/"reconciled" are one term everywhere, rather
 * than this module inventing a second, quietly different notion of similarity.
 */

import { tokenizeAndStem as rawTokenize } from './skill-graft-bm25.js';

/**
 * Terms that carry no signal for this kind of matching.
 *
 * **Why this list exists at all.** BM25 does not need one — a term appearing in
 * every document earns a near-zero IDF and disappears on its own. The scoring
 * here is deliberately simpler than BM25 (set overlap normalised by the smaller
 * side, so a three-word purpose can match a long roadmap body), and that
 * simplification throws away the corpus statistics that would have suppressed
 * these. Without the list, "watering the plants" matches "wire the reconcile
 * loop" on the word *the*, and the briefing renders `similar goal: the`.
 *
 * Bare file extensions are in here for the same reason: `contextQuery` includes
 * file basenames, and `ts` is shared by every TypeScript file in the repo, so it
 * would silently introduce every agent to every other agent.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // function words that survive stemming
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'up', 'down', 'out',
  'it', 'its', 'as', 'so', 'not', 'no', 'yes', 'do', 'doe', 'did', 'done', 'have', 'ha', 'had',
  'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall',
  'i', 'we', 'you', 'they', 'he', 'she', 'them', 'us', 'my', 'our', 'your', 'their',
  // file extensions, which ride in on basenames
  'ts', 'js', 'tsx', 'jsx', 'md', 'json', 'yml', 'yaml', 'sh', 'rs', 'py', 'go', 'toml', 'txt',
]);

/**
 * Tokenize, stem, and drop terms that would match everything.
 *
 * Single-character tokens go too: they are almost always fragments of a split
 * identifier and match promiscuously.
 */
function tokenizeAndStem(text: string): string[] {
  return rawTokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Everything known about the arriving agent at session start. */
export interface ArrivalContext {
  /** The arriving actor's id. Excluded from its own neighbour matches. */
  readonly actor: string;
  /** What this session is for, in the operator's words. The strongest signal. */
  readonly purpose?: string;
  /** Project id the session belongs to. */
  readonly project?: string;
  /** Files the session has already claimed or opened, if any. */
  readonly files?: readonly string[];
  /** Free-text branch name, ticket title, or anything else worth matching on. */
  readonly hints?: readonly string[];
}

/** A salvageable session left behind by an agent that went away. */
export interface SalvageCandidate {
  readonly agentId: string;
  readonly purpose?: string;
  readonly project?: string;
  readonly files?: readonly string[];
  readonly notes?: readonly string[];
  readonly detectedAt?: number;
}

/** A roadmap item the arriving work might belong under. */
export interface RoadmapCandidate {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly status?: string;
  readonly tags?: readonly string[];
}

/** A skill in the catalog. */
export interface SkillCandidate {
  readonly id: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

/** Another live session, and therefore a possible neighbour. */
export interface NeighbourCandidate {
  readonly actor: string;
  readonly sessionId: string;
  readonly purpose?: string;
  readonly project?: string;
  readonly files?: readonly string[];
}

/** The four corpora, already fetched by the caller. */
export interface ArrivalCorpora {
  readonly salvage?: readonly SalvageCandidate[];
  readonly roadmap?: readonly RoadmapCandidate[];
  readonly skills?: readonly SkillCandidate[];
  readonly neighbours?: readonly NeighbourCandidate[];
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

/**
 * One briefing line.
 *
 * `why` is not decoration. An agent (or operator) shown a match it cannot
 * account for learns to distrust the whole section, so every entry carries the
 * evidence that earned it a place — the overlapping terms, or the shared file.
 */
export interface BriefingHit<T> {
  readonly item: T;
  readonly score: number;
  readonly why: string;
}

export interface ArrivalBriefing {
  readonly salvage: readonly BriefingHit<SalvageCandidate>[];
  readonly roadmap: readonly BriefingHit<RoadmapCandidate>[];
  readonly skills: readonly BriefingHit<SkillCandidate>[];
  readonly neighbours: readonly BriefingHit<NeighbourCandidate>[];
  /** True when every section is empty — the caller should then say nothing. */
  readonly empty: boolean;
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Per-section ceiling. Four sections of three is already a lot to read. */
export const DEFAULT_PER_SECTION = 3;
/**
 * Minimum score a hit must clear.
 *
 * Deliberately above zero: a single incidental shared token ("the", already
 * stemmed away, but also "test", "fix", "update") is not a reason to interrupt
 * someone. A briefing is worth having only if a weak match stays out of it.
 */
export const MIN_SCORE = 0.15;
/**
 * Weight for a shared claimed file when matching neighbours.
 *
 * Far above any text signal on purpose: two agents editing the same file is not
 * a topical similarity, it is an imminent collision. One shared path should
 * outrank a paragraph of coincidental vocabulary every time.
 */
export const SHARED_FILE_WEIGHT = 2.0;

/**
 * The most any text-only match can score: a perfect overlap (1.0) plus the
 * same-project nudge. {@link SHARED_FILE_WEIGHT} is deliberately above this, so
 * a single shared file strictly *dominates* rather than merely ties the wordiest
 * possible coincidence — at equal scores the ordering would fall to sort
 * stability, which is not a decision anyone made.
 */
export const MAX_TEXT_SCORE = 1.1;

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Jaccard-style overlap between two stemmed token sets, normalised by the
 * smaller set.
 *
 * Normalising by the smaller side rather than the union is what lets a
 * three-word session purpose match a long roadmap body: with union
 * normalisation, every short query scores near zero against every long document
 * and the section silently never fires.
 */
export function overlapScore(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  const seen = new Set<string>();
  for (const t of a) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (setB.has(t)) shared += 1;
  }
  const denom = Math.min(seen.size, new Set(b).size);
  return denom === 0 ? 0 : shared / denom;
}

/** The terms two texts share, for the `why` line. */
export function sharedTerms(a: readonly string[], b: readonly string[], limit = 4): string[] {
  const setB = new Set(b);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of a) {
    if (seen.has(t) || !setB.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** The arriving context flattened into one query string. */
export function contextQuery(ctx: ArrivalContext): string {
  return [ctx.purpose ?? '', ...(ctx.hints ?? []), ...(ctx.files ?? []).map(basename)].join(' ');
}

function basename(p: string): string {
  const cut = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return cut.length ? cut[cut.length - 1] : p;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

// ─── Sections ────────────────────────────────────────────────────────────────

interface RankOpts {
  readonly perSection?: number;
  readonly minScore?: number;
}

function take<T>(hits: BriefingHit<T>[], opts: RankOpts): BriefingHit<T>[] {
  const min = opts.minScore ?? MIN_SCORE;
  return hits
    .filter((h) => h.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.perSection ?? DEFAULT_PER_SECTION);
}

/**
 * Salvage sessions worth resuming.
 *
 * Same-project is a prerequisite when both sides declare one: an abandoned
 * session in another repo is never the work in front of you, however similar it
 * reads. Shared files then dominate, because a salvage candidate holding a file
 * you are about to edit is not merely relevant — it is the reason your claim is
 * about to be contested.
 */
export function rankSalvage(
  ctx: ArrivalContext,
  candidates: readonly SalvageCandidate[],
  opts: RankOpts = {},
): BriefingHit<SalvageCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const mine = new Set((ctx.files ?? []).map(norm));
  const hits: BriefingHit<SalvageCandidate>[] = [];

  for (const c of candidates) {
    if (ctx.project && c.project && ctx.project !== c.project) continue;
    const theirs = (c.files ?? []).map(norm);
    const shared = theirs.filter((f) => mine.has(f));
    const text = tokenizeAndStem([c.purpose ?? '', ...(c.notes ?? [])].join(' '));
    const textScore = overlapScore(q, text);
    const score = shared.length * SHARED_FILE_WEIGHT + textScore;
    if (score <= 0) continue;
    hits.push({
      item: c,
      score,
      why: shared.length
        ? `holds ${shared.length === 1 ? basename(shared[0]) : `${shared.length} files you touched`}`
        : `similar work: ${sharedTerms(q, text).join(', ')}`,
    });
  }
  return take(hits, opts);
}

/** Roadmap items the arriving work plausibly belongs under. */
export function rankRoadmap(
  ctx: ArrivalContext,
  candidates: readonly RoadmapCandidate[],
  opts: RankOpts = {},
): BriefingHit<RoadmapCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const hits: BriefingHit<RoadmapCandidate>[] = [];
  for (const c of candidates) {
    // A shipped item is history: it cannot be the thing you are starting.
    if (c.status && /^(done|shipped|closed|complete)/i.test(c.status)) continue;
    const text = tokenizeAndStem([c.title, c.body ?? '', ...(c.tags ?? [])].join(' '));
    const score = overlapScore(q, text);
    if (score <= 0) continue;
    hits.push({ item: c, score, why: `matches: ${sharedTerms(q, text).join(', ')}` });
  }
  return take(hits, opts);
}

/** Skills in the catalog that fit the work about to be done. */
export function rankSkills(
  ctx: ArrivalContext,
  candidates: readonly SkillCandidate[],
  opts: RankOpts = {},
): BriefingHit<SkillCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const hits: BriefingHit<SkillCandidate>[] = [];
  for (const c of candidates) {
    // The skill id itself is a strong signal — ids are hyphenated topic phrases
    // ("postgres-connection-pooling"), so they tokenize into exactly the terms
    // a matching purpose would use.
    const text = tokenizeAndStem([c.id.replace(/[-_]/g, ' '), c.description ?? '', ...(c.tags ?? [])].join(' '));
    const score = overlapScore(q, text);
    if (score <= 0) continue;
    hits.push({ item: c, score, why: `matches: ${sharedTerms(q, text).join(', ')}` });
  }
  return take(hits, opts);
}

/**
 * Live agents worth being introduced to.
 *
 * This is the section that turns a briefing into coordination: the other three
 * tell an agent about artifacts, this one tells it about people. A shared file
 * is weighted to dominate because that pair is heading for a collision whether
 * or not either of them notices, and the introduction is what lets them settle
 * it in a parley instead of in a merge conflict.
 *
 * The arriving actor is always excluded from its own results — an agent
 * introduced to itself learns nothing and discredits the section.
 */
export function rankNeighbours(
  ctx: ArrivalContext,
  candidates: readonly NeighbourCandidate[],
  opts: RankOpts = {},
): BriefingHit<NeighbourCandidate>[] {
  const q = tokenizeAndStem(contextQuery(ctx));
  const mine = new Set((ctx.files ?? []).map(norm));
  const hits: BriefingHit<NeighbourCandidate>[] = [];

  for (const c of candidates) {
    if (c.actor === ctx.actor) continue;
    const theirs = (c.files ?? []).map(norm);
    const shared = theirs.filter((f) => mine.has(f));
    const text = tokenizeAndStem(c.purpose ?? '');
    const textScore = overlapScore(q, text);
    // Same project is corroboration, not a gate: cross-project agents with the
    // same expertise are exactly who you want to meet.
    const sameProject = ctx.project && c.project && ctx.project === c.project ? 0.1 : 0;
    const score = shared.length * SHARED_FILE_WEIGHT + textScore + sameProject;
    if (score <= 0) continue;
    hits.push({
      item: c,
      score,
      why: shared.length
        ? `editing ${shared.length === 1 ? basename(shared[0]) : `${shared.length} of the same files`}`
        : `similar goal: ${sharedTerms(q, text).join(', ')}`,
    });
  }
  return take(hits, opts);
}

// ─── Assembly ────────────────────────────────────────────────────────────────

/**
 * Rank all four corpora against one arrival.
 *
 * An absent corpus and an empty one are both rendered as an empty section here,
 * unlike the reconcile loop where the distinction is load-bearing — nothing is
 * deleted on the strength of this result, so there is no key to protect.
 */
export function buildArrivalBriefing(
  ctx: ArrivalContext,
  corpora: ArrivalCorpora,
  opts: RankOpts = {},
): ArrivalBriefing {
  const salvage = rankSalvage(ctx, corpora.salvage ?? [], opts);
  const roadmap = rankRoadmap(ctx, corpora.roadmap ?? [], opts);
  const skills = rankSkills(ctx, corpora.skills ?? [], opts);
  const neighbours = rankNeighbours(ctx, corpora.neighbours ?? [], opts);
  return {
    salvage,
    roadmap,
    skills,
    neighbours,
    empty: !salvage.length && !roadmap.length && !skills.length && !neighbours.length,
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * Render a briefing for injection into an agent's first turn.
 *
 * Returns `''` for an empty briefing rather than a "nothing to report" header:
 * the harness is quiet by design, and a section that always prints teaches
 * agents to skip the block that will one day matter.
 */
export function renderArrivalBriefing(b: ArrivalBriefing): string {
  if (b.empty) return '';
  const lines: string[] = ['⚓ Port Daddy — arrival briefing'];

  if (b.neighbours.length) {
    lines.push('', 'Agents on adjacent work:');
    for (const h of b.neighbours) {
      lines.push(`  • ${h.item.actor} — ${h.item.purpose ?? 'no stated purpose'} (${h.why})`);
    }
    lines.push('  → `pd parley call <agent> --reason "..."` to settle overlap before it lands.');
  }

  if (b.salvage.length) {
    lines.push('', 'Salvageable work that looks like yours:');
    for (const h of b.salvage) {
      lines.push(`  • ${h.item.agentId} — ${h.item.purpose ?? 'no stated purpose'} (${h.why})`);
    }
    lines.push('  → `pd salvage claim <agent>` to resume it instead of restarting it.');
  }

  if (b.roadmap.length) {
    lines.push('', 'Roadmap items this may belong under:');
    for (const h of b.roadmap) {
      lines.push(`  • ${h.item.id} — ${h.item.title} (${h.why})`);
    }
  }

  if (b.skills.length) {
    lines.push('', 'Skills for this work:');
    for (const h of b.skills) {
      lines.push(`  • ${h.item.id} (${h.why})`);
    }
  }

  return lines.join('\n');
}
