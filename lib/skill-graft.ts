/**
 * Skill Graft — native, local skill-injection for Port Daddy's autonomous
 * fleet ships.
 *
 * Mirrors the windags MCP tool pattern (`windags_skill_graft` /
 * `windags_skill_reference` / `windags_skill_inventory`): given a task
 * description, return a CHEAP ranked shortlist of candidate skills (id +
 * one-line description + similarity) across every scanned skill, plus the
 * FULL `SKILL.md` body for only the top few (context-cost capped). A
 * companion function fetches one specific reference/example/script file
 * from a skill's own directory on demand — the local equivalent of
 * `windags_skill_reference`.
 *
 * Deliberately local, deliberately not a windags client: no MCP call, no
 * network dependency on the windags server being configured. This exists
 * because `apps/fleet-executor` (autonomous ships spawned from
 * `pd-fleet.yml`) has zero windags integration today — windags only covers
 * interactive sessions where it happens to be wired in as an MCP server.
 * Borrows windags' *design*, not windags itself, matching the
 * shared-library-not-hard-runtime-dependency precedent this repo already
 * applies elsewhere (see the M8 semantic-conflict-predictor architecture
 * recommendation, `docs/architecture/agent-harbor-technical-binder/
 * work-packets/m8-semantic-conflict-predictor-architecture-recommendation.md`
 * on branch `m8/semantic-conflict-research` / PR #722 at time of writing —
 * unmerged, so not citable from `main` yet, but the pattern it argues for
 * is the one this module follows).
 *
 * Reuse, not reinvention:
 * - Embeddings: `createLocalEmbedder` from `./semantic-resolver.js` — the
 *   ONE shared local MiniLM encoder. This module never loads a second
 *   embedding pipeline.
 * - Skill scanning: `loadSkillCatalog` from `./shipwright/skill-index.ts` —
 *   the existing defensive SKILL.md frontmatter parser Shipwright already
 *   uses for `pd shipwright propose`. Skill Graft does NOT delegate ranking
 *   to that module's own `createSkillIndex()` search, though — see below.
 * - Path safety: `containPath` from `./fleet/path-guard.ts` guards
 *   `getReference()` against path traversal / symlink escape out of a
 *   skill's own directory, the same primitive `lib/fleet/outputs/file.ts`
 *   and the file trigger use.
 *
 * Ranking — BM25 + Tool2Vec, fused via RRF (why NOT cosine-vs-description):
 * An earlier version of this module ranked skills by cosine similarity
 * between the task's embedding and an embedding of the SKILL'S OWN
 * description text. That's a vocabulary-mismatch trap: a task phrased in
 * user/action language ("fix a memory leak in the daemon") often has low
 * cosine similarity to a skill's own description phrased differently
 * ("detects unbounded heap growth via snapshot diffing") even when the
 * skill is exactly right — comparing a shovel to a bonsai tree. Both sides
 * need to live in the same semantic space for cosine to mean anything.
 *
 * Fixed the way windags' Tool2Vec cascade fixes it (see
 * https://windags.ai/blog/the-skill-matching-cascade): `./skill-graft-tool2vec.js`
 * generates ~15 synthetic user-phrased task descriptions per skill via a
 * cheap LLM call, embeds them with the shared local embedder, and averages
 * them into a centroid — comparing the task against "what would you use
 * this for," not "what is this." Centroids are cached content-hash-keyed
 * (skill id + SKILL.md hash) so the LLM call happens once per skill, not
 * per query. `./skill-graft-bm25.js` adds a second, independent lexical
 * signal (BM25 + Porter stemming) so genuine keyword overlap isn't lost
 * when it happens to disagree with the semantic tier. `reciprocalRankFusion()`
 * below (k=60) combines the two ranked lists into one. When no synthetic-
 * query generator is configured (no LLM backend available), ranking
 * degrades honestly to BM25-only (`SkillGraftResult.semanticTier:
 * 'lexical-only'`) rather than silently reintroducing the cosine-vs-
 * description bug as a "fallback."
 *
 * Scoped deliberately: windags' full cascade also has cross-encoder
 * reranking, local attribution k-NN, and cross-installation global priors.
 * None of those are built here — they need a second (reranker) model, an
 * outcomes-tracking DB, and a multi-installation telemetry population
 * respectively, none of which exist yet for this native single-repo
 * version. BM25 + Tool2Vec + RRF is the real fix for the reported bug
 * without building infrastructure nothing here asked for yet.
 *
 * First-hop candidate expansion (2026-08-19 operator directive): the fused
 * RRF list above is still bounded to whatever BM25/Tool2Vec directly
 * scored — a skill's own `pairs-with` neighbors, or the skills it names by
 * id in its SKILL.md prose, never got a look-in unless they ALSO scored
 * well lexically or semantically. `expandFirstHopCandidates()` (next to
 * `reciprocalRankFusion()` below) widens the pool by exactly one graph hop
 * from the top seeds AFTER fusion, competing for the same unchanged
 * shortlist/top/body caps. See that section's doc comment for the
 * graph-analysis rationale (median/max degree, why first-hop only and not
 * full transitive closure).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createLocalEmbedder, defaultTransformersCacheDir } from './semantic-resolver.js';
import {
  loadSkillCatalog,
  type SkillEmbedder,
  type SkillEntry,
} from './shipwright/skill-index.js';
import { containPath, PathEscapeError } from './fleet/path-guard.js';
import type { LLMClient } from './llm-call.js';
import { bm25Rank } from './skill-graft-bm25.js';
import { extractPairsWithTargets } from './skill-pairs-with.js';
import {
  createLLMClientSyntheticQueryGenerator,
  createTool2VecStore,
  getOrBuildCentroid,
  tool2VecRank,
  type SyntheticQueryGenerator,
  type Tool2VecRankedEntry,
  type Tool2VecStore,
} from './skill-graft-tool2vec.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** One directory Skill Graft scans for `SKILL.md` files (recursively). */
export interface SkillGraftRoot {
  label: string;
  path: string;
}

/** The cheap side of the shortlist: everything callers need to DECIDE
 *  whether a skill is worth pulling in full, but not the full body. */
export interface SkillShortlistEntry {
  id: string;
  description: string;
  category: string;
  tags: string[];
  /** Cosine similarity to the query — mathematically in [-1, 1] (MiniLM
   *  vectors are L2-normalized so this is a dot product); in practice
   *  related short-text embeddings tend to land in a narrow positive band,
   *  but don't assume it's bounded at 0. Higher is more relevant. */
  similarity: number;
  /**
   * Provenance for the first-hop candidate expansion (see
   * `expandFirstHopCandidates()`) — auditable ranking, not silent magic.
   * Present ONLY when this entry's score actually came from a one-hop
   * graph boost: either it wasn't in the directly BM25/Tool2Vec-ranked
   * list at all, or the boosted score beat what direct ranking gave it.
   * Absent for every ordinary direct match — including every entry when
   * the first-hop skill graph has no edges at all — so a zero-degree
   * catalog is byte-identical to the pre-expansion shape (no `via` key,
   * not `via: 'direct'` — which is also why the type has no 'direct'
   * member: a direct match is the unmarked case).
   */
  via?: 'first-hop';
  /** The shortlisted seed skill whose first-hop edge produced this entry's
   *  boosted score. Set iff `via === 'first-hop'`. */
  hopSeed?: string;
}

/** A shortlist entry PLUS the full `SKILL.md` body — reserved for the
 *  top `topLimit` matches so context cost stays bounded. */
export interface SkillGraftEntry extends SkillShortlistEntry {
  body: string;
  sourcePath: string;
}

export interface SkillGraftResult {
  query: string;
  /** Total skills scanned across all roots (not just the shortlist size). */
  scannedCount: number;
  roots: SkillGraftRoot[];
  /** Cheap: id + description + similarity for up to `shortlistLimit` skills. */
  shortlist: SkillShortlistEntry[];
  /** Expensive: full SKILL.md body for up to `topLimit` skills (<= shortlist.length). */
  top: SkillGraftEntry[];
  /**
   * Which signals actually contributed to THIS ranking (not merely whether
   * a generator is theoretically configured).
   * - `'hybrid'`: at least one skill's Tool2Vec centroid was already
   *   cached and contributed a semantic score alongside BM25, fused via
   *   reciprocal rank fusion (the intended default path once `refresh()`
   *   has run at least once).
   * - `'lexical-only'`: either no synthetic-query generator is configured,
   *   or one is configured but no centroids have been built for this
   *   catalog yet (`craft()` never triggers generation itself — see
   *   `refresh()`), so ranking is BM25 alone. Still correct, just missing
   *   the semantic tier's ability to match on meaning rather than shared
   *   vocabulary.
   */
  semanticTier: 'hybrid' | 'lexical-only';
}

export interface SkillReferenceResult {
  skillId: string;
  filePath: string;
  found: boolean;
  content: string | null;
  absolutePath: string | null;
  error?: string;
}

export interface SkillGraftCraftOptions {
  /** How many skills to include in the cheap shortlist. Default 10, capped at 50. */
  shortlistLimit?: number;
  /** How many of the shortlist get their full SKILL.md body attached. Default 3. */
  topLimit?: number;
}

export interface SkillGraftOptions extends SkillGraftCraftOptions {
  /** Skill roots to scan. Defaults to just `<projectRoot>/skills`. */
  roots?: SkillGraftRoot[];
  /** Used to compute the default root when `roots` is omitted. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Inject a fake embedder for deterministic tests. Defaults to `createLocalEmbedder()`. */
  embedder?: SkillEmbedder;
  /**
   * Synthetic-query generator for the Tool2Vec semantic tier (see
   * `./skill-graft-tool2vec.js`) — the thing that fixes the vocabulary-
   * mismatch bug. Tests inject a deterministic function directly. When
   * omitted, the default generator is built from `llmClient` (below); when
   * NEITHER is provided, the semantic tier is skipped and `craft()` falls
   * back to BM25-only ranking (never throws — see `SkillGraftResult.semanticTier`).
   */
  generateSyntheticQueries?: SyntheticQueryGenerator;
  /**
   * Request-shape LLM client (`lib/llm-call.ts createLLMClient`) used to
   * build the default synthetic-query generator when
   * `generateSyntheticQueries` is not injected directly. Same
   * backend-agnostic convention `lib/shipwright/survey.ts` and
   * `lib/coordination-judge.ts` use: caller resolves whichever backend is
   * configured (see `lib/llm-backend-resolver.ts`) and passes a ready client.
   */
  llmClient?: LLMClient;
  /** Model id for the synthetic-query generation call. Caller picks a cheap
   *  (Haiku-class) model — same convention as `SurveyOptions.model`. Required
   *  when `llmClient` is set and `generateSyntheticQueries` is not. */
  llmModel?: string;
  /** Inject a fake/shared Tool2Vec centroid cache for tests (e.g.
   *  `createTool2VecStore({ db: new Database(':memory:'), ... })`). Defaults
   *  to the real on-disk cache at `~/.port-daddy/skill-graft-tool2vec.sqlite`,
   *  keyed by skill id + SKILL.md content hash so a skill's centroid is only
   *  regenerated when its frontmatter actually changes. */
  centroidStore?: Tool2VecStore;
  /**
   * Hard cap, in characters, on each `top[].body` before it's inlined into a
   * ship's task text. Default 8000 (~2k tokens). Some SKILL.md files in this
   * repo run past 1200 lines (e.g. semantic-conflict-prediction); with the
   * default `topLimit: 3` that's several such files with NO cap, which can
   * bloat a spawned task enough to raise cost or trip transport/413 limits on
   * `/spawn`. A body over the cap is truncated with a `[truncated N chars]`
   * marker (same idiom `trimMessage()` uses elsewhere in this engine for
   * trigger message content) rather than silently dropped.
   */
  maxBodyChars?: number;
  /** Called with a human-readable message when a SKILL.md is skipped
   *  (malformed frontmatter, missing name/description) or a reference read
   *  fails. Never throws on the caller's behalf. */
  onWarning?: (message: string) => void;
}

export interface SkillGraftIndex {
  /**
   * Rank every scanned skill against `query` — BM25 lexical score fused
   * with Tool2Vec synthetic-query-centroid semantic score via reciprocal
   * rank fusion (k=60), then widened by exactly one first-hop graph step
   * from the top seeds (`expandFirstHopCandidates()`) — and return a cheap
   * shortlist plus the full body for the top few. Scans the catalog on
   * first call if it hasn't been already, but NEVER builds Tool2Vec centroids
   * itself (that's `refresh()`'s
   * job, an explicit and potentially expensive step) — `craft()` only reads
   * whatever centroids are already cached, so it stays fast and bounded
   * even the very first time it's called on a fully cold cache. See
   * `SkillGraftResult.semanticTier` for whether the semantic tier actually
   * had anything cached to contribute for this particular call.
   */
  craft(query: string, options?: SkillGraftCraftOptions): Promise<SkillGraftResult>;
  /**
   * Fetch one file from within a specific skill's own directory — the
   * on-demand companion to `craft()`, mirroring `windags_skill_reference`.
   * Guards against the requested path escaping the skill's directory.
   * Lazily scans the catalog when needed; fetching one reference must never
   * trigger the expensive centroid build.
   */
  getReference(skillId: string, filePath: string): SkillReferenceResult;
  /** Skill ids known as of the last scan (empty until `craft()`/`refresh()` runs). */
  listSkillIds(): string[];
  /**
   * The explicit, potentially-expensive precompute step: re-scan the
   * catalog and rebuild every scanned skill's Tool2Vec centroid (cache
   * misses only — a skill whose content hash is unchanged is a `reused`
   * hit, not an `embedded` regeneration). This is the ONLY thing that
   * generates centroids — `craft()` never does, deliberately, so a live
   * ship spawn can never block on hundreds of LLM calls across a cold
   * cache. Call this out of band from any spawn path: a maintenance
   * script, a future `pd skill-graft warm` CLI command, or
   * `scripts/verify-skill-graft.ts`'s manual verification run. Returns
   * cache-hit accounting so operators can see the one-time cost happen and
   * then disappear on subsequent runs. When no synthetic-query generator
   * is configured, this only re-scans the catalog — `embedded`/`reused`
   * are both 0 and `craft()` stays BM25-only.
   */
  refresh(): Promise<{ scannedCount: number; embedded: number; reused: number; removed: number }>;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_SHORTLIST_LIMIT = 10;
const DEFAULT_TOP_LIMIT = 3;
const MAX_LIMIT = 50;
const DEFAULT_MAX_BODY_CHARS = 8000;
const MIN_MAX_BODY_CHARS = 500;
const MAX_MAX_BODY_CHARS = 50000;

/** Just this repo's `skills/` directory — "start with this repo's skills/
 *  dir" per the task brief. Callers who want the fuller windags/workgroup-ai/
 *  user-level catalog can pass `lib/skill-sync.ts`'s `defaultSkillCatalogRoots()`
 *  as `roots` explicitly; Skill Graft does not reach for those on its own so
 *  a bare `createSkillGraftIndex()` call never depends on another tool being
 *  installed on the operator's machine. */
export function defaultSkillGraftRoots(projectRoot: string = process.cwd()): SkillGraftRoot[] {
  return [{ label: 'port-daddy', path: join(projectRoot, 'skills') }];
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createSkillGraftIndex(options: SkillGraftOptions = {}): SkillGraftIndex {
  const roots = options.roots && options.roots.length > 0
    ? options.roots
    : defaultSkillGraftRoots(options.projectRoot);
  // Default embedder reuses the ONE shared, already-downloaded local MiniLM
  // cache (`~/.port-daddy/transformers-cache`, ADR-0061) — NOT
  // `createLocalEmbedder()`'s own bare default of `<cwd>/.cache/transformers`,
  // which would silently re-download the model per-repo/per-cwd instead of
  // reusing what every other reader (the resolver, the daemon, the
  // shipwright skill index) already paid for.
  const embedder: SkillEmbedder = options.embedder
    ?? createLocalEmbedder({ cacheDir: defaultTransformersCacheDir() });
  const defaultShortlistLimit = clampLimit(options.shortlistLimit, DEFAULT_SHORTLIST_LIMIT);
  const defaultTopLimit = clampLimit(options.topLimit, DEFAULT_TOP_LIMIT);
  const maxBodyChars = clampBodyChars(options.maxBodyChars, DEFAULT_MAX_BODY_CHARS);

  // Synthetic-query generator resolution: explicit injection (tests) wins,
  // then a default built from an injected LLM client, then nothing — the
  // semantic tier is opt-in-by-configuration, never a hard requirement
  // (see `SkillGraftResult.semanticTier`).
  const generateQueries: SyntheticQueryGenerator | null = options.generateSyntheticQueries
    ?? (options.llmClient && options.llmModel
      ? createLLMClientSyntheticQueryGenerator(options.llmClient, options.llmModel)
      : null);
  const centroidStore: Tool2VecStore | null = generateQueries
    ? (options.centroidStore ?? createTool2VecStore({
      embedderModelId: embedder.modelId,
      generatorId: options.llmModel ?? 'injected-generator',
    }))
    : null;

  let catalog: SkillEntry[] = [];
  let catalogById = new Map<string, SkillEntry>();
  let adjacency: SkillAdjacency = new Map();
  let scanned = false;

  function scan(): SkillEntry[] {
    catalog = loadSkillCatalog(roots.map((root) => root.path), { onWarning: options.onWarning });
    catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
    // Pure text scan (frontmatter `pairs-with` + prose id mentions), no LLM
    // calls — cheap enough to build on every scan, unlike Tool2Vec's
    // centroids which need their own `refresh()`-gated precompute step.
    adjacency = buildSkillAdjacency(catalog);
    scanned = true;
    return catalog;
  }

  /**
   * The CHEAP step: (re-)scan the catalog only. This is what `craft()` runs
   * lazily on first use — a spawn-path ranking call must never block on an
   * LLM call. Tool2Vec ranking (`tool2VecRank()`) only ever READS whatever
   * centroids are already cached; a skill with no cached centroid yet
   * simply doesn't contribute to the semantic signal for that call (it
   * still gets a fair shot via BM25). See `ensureIndexed()` for the
   * separate, EXPLICIT precompute step that actually builds centroids.
   */
  function ensureScanned(): void {
    if (!scanned) scan();
  }

  /**
   * The EXPENSIVE step: (re-)scan the catalog and, when a synthetic-query
   * generator is configured, build every scanned skill's Tool2Vec centroid
   * (cache misses only). Deliberately NOT called automatically by `craft()`
   * — with ~290 skills and 15 synthetic queries each, a cold cache means
   * hundreds of LLM calls and thousands of embeddings, which would block a
   * real ship spawn for an unacceptable amount of time (Copilot review
   * finding on this fix's own diff). Callers that want the semantic tier
   * warm — an operator maintenance script, a future `pd skill-graft warm`
   * CLI command, `scripts/verify-skill-graft.ts` — call `refresh()`
   * explicitly, out of band from any live spawn path.
   */
  async function ensureIndexed(): Promise<{ embedded: number; reused: number; removed: number }> {
    const entries = scan();
    if (!generateQueries || !centroidStore) {
      return { embedded: 0, reused: 0, removed: 0 };
    }
    let embedded = 0;
    let reused = 0;
    for (const skill of entries) {
      const before = centroidStore.get(skill.id, skill.contentHash);
      if (before) { reused++; continue; }
      const built = await getOrBuildCentroid(skill, centroidStore, embedder, generateQueries);
      if (built) embedded++;
      else options.onWarning?.(`skill-graft: Tool2Vec centroid generation failed for "${skill.id}" — will rank via BM25 only`);
    }
    const removed = centroidStore.prune(entries.map((entry) => entry.id));
    return { embedded, reused, removed };
  }

  return {
    async craft(query, callOptions = {}) {
      ensureScanned();

      const trimmed = query.trim();
      const shortlistLimit = clampLimit(callOptions.shortlistLimit, defaultShortlistLimit);
      const topLimit = Math.min(clampLimit(callOptions.topLimit, defaultTopLimit), shortlistLimit);

      if (!trimmed) {
        return { query, scannedCount: catalog.length, roots, shortlist: [], top: [], semanticTier: 'lexical-only' };
      }

      const lexicalRank = bm25Rank(trimmed, catalog);
      let semanticRank: Tool2VecRankedEntry[] = [];
      if (centroidStore) {
        const [queryVector] = await embedder.embed([trimmed]);
        semanticRank = queryVector ? tool2VecRank(queryVector, catalog, centroidStore) : [];
      }

      const fusedFull = reciprocalRankFusion(lexicalRank, semanticRank);
      // Widen the pool by one graph hop from the top-K (K = shortlistLimit)
      // fused seeds, THEN apply the same cap `craft()` always applied —
      // expansion only widens who competes, never raises the cap itself.
      // See `expandFirstHopCandidates()` for the weight/decay rationale.
      const fused = expandFirstHopCandidates(fusedFull, shortlistLimit, adjacency).slice(0, shortlistLimit);
      const semanticById = new Map(semanticRank.map((entry) => [entry.id, entry.similarity]));

      const shortlist: SkillShortlistEntry[] = [];
      for (const { id, via, hopSeed } of fused) {
        const skill = catalogById.get(id);
        // Stale/unknown id: either a fused list computed before a rescan,
        // or a `pairs-with`/prose-mention target that isn't a real skill id
        // (typo, or a skill outside the scanned roots) — defensive, not
        // expected on a well-formed catalog.
        if (!skill) continue;
        const entry: SkillShortlistEntry = {
          id: skill.id,
          description: skill.description,
          category: skill.category,
          tags: skill.tags,
          similarity: semanticById.get(id) ?? 0,
        };
        // Only ever set for a candidate whose score actually came from a
        // hop boost — see SkillShortlistEntry.via's doc comment for why an
        // ordinary direct match carries no `via` key at all.
        if (via) { entry.via = via; entry.hopSeed = hopSeed; }
        shortlist.push(entry);
      }

      const top: SkillGraftEntry[] = [];
      for (const entry of shortlist.slice(0, topLimit)) {
        const skill = catalogById.get(entry.id);
        if (!skill) continue;
        const body = readSkillBody(skill.sourcePath, maxBodyChars, options.onWarning);
        if (body === null) continue;
        top.push({ ...entry, body, sourcePath: skill.sourcePath });
      }

      return {
        query,
        scannedCount: catalog.length,
        roots,
        shortlist,
        top,
        // Reflects whether the semantic tier actually contributed a cached
        // centroid to THIS result — not merely whether a generator is
        // configured. Centroid generation is a separate, explicit step
        // (`refresh()`, never run automatically by `craft()`), so a cold
        // cache genuinely means 'lexical-only' even with a generator wired.
        semanticTier: semanticRank.length > 0 ? 'hybrid' : 'lexical-only',
      };
    },

    getReference(skillId, filePath) {
      ensureScanned();
      const skill = catalogById.get(skillId);
      if (!skill) {
        return {
          skillId,
          filePath,
          found: false,
          content: null,
          absolutePath: null,
          error: `unknown skill id "${skillId}" (check the id and configured skill roots)`,
        };
      }

      const skillDir = dirname(skill.sourcePath);
      try {
        const absolutePath = containPath(filePath, { roots: [skillDir], expandTokens: false });
        const content = readFileSync(absolutePath, 'utf-8');
        return { skillId, filePath, found: true, content, absolutePath };
      } catch (err) {
        if (err instanceof PathEscapeError) {
          return {
            skillId, filePath, found: false, content: null, absolutePath: null,
            error: `refused: ${err.message}`,
          };
        }
        const code = (err as NodeJS.ErrnoException)?.code;
        const message = code === 'ENOENT'
          ? `file not found in skill "${skillId}": ${filePath}`
          : `failed to read reference: ${(err as Error).message}`;
        return { skillId, filePath, found: false, content: null, absolutePath: null, error: message };
      }
    },

    listSkillIds() {
      return catalog.map((entry) => entry.id);
    },

    async refresh() {
      const stats = await ensureIndexed();
      return { scannedCount: catalog.length, ...stats };
    },
  };
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * Render a `craft()` result as a plain-text context block, suitable for
 * splicing into an autonomous ship's task/prompt text (mirrors the
 * "Trigger context" section `lib/fleet-engine.ts`'s `buildAgentTask()`
 * already appends). Kept here — not in `fleet-engine.ts` — so every caller
 * (fleet ships today, a future CLI command or a different agent runtime
 * tomorrow) gets the exact same rendering. Returns '' when there is nothing
 * worth injecting (empty query, no skills scanned) so callers can splice it
 * in unconditionally without an extra emptiness check.
 */
export function renderSkillGraftContext(result: SkillGraftResult): string {
  if (result.shortlist.length === 0) return '';

  const lines: string[] = [
    `Relevant skills (${result.shortlist.length} of ${result.scannedCount} scanned):`,
  ];
  for (const entry of result.shortlist) {
    // Only entries the semantic tier actually scored carry a meaningful
    // similarity. A BM25-only match — the whole 'lexical-only' tier (no
    // centroids / no generator), or a single entry the semantic list didn't
    // surface in an otherwise 'hybrid' result — has similarity 0, which reads
    // as "zero relevance" when it really means "ranked lexically, not
    // semantically". Label those honestly instead of printing a misleading
    // `similarity 0.00` (Copilot review finding).
    const relevance = entry.similarity > 0
      ? `similarity ${entry.similarity.toFixed(2)}`
      : 'lexical match';
    lines.push(`- ${entry.id} (${relevance}): ${truncate(entry.description, 160)}`);
  }

  if (result.top.length > 0) {
    lines.push('', 'Full guidance for the top match(es) — read before writing code in this area:');
    for (const entry of result.top) {
      lines.push('', `--- ${entry.id} (SKILL.md) ---`, entry.body.trim());
    }
  }

  return lines.join('\n');
}

// ─── Reciprocal rank fusion ─────────────────────────────────────────────────

const RRF_K = 60;

interface RankedId { id: string }

/**
 * Fuse two independently-ranked lists (BM25 lexical, Tool2Vec semantic)
 * into one order via reciprocal rank fusion: `score = Σ 1/(k + rank)` for
 * each list the id appears in (1-indexed rank), k=60 — the standard RRF
 * constant. An id in both lists sums both contributions and outranks an id
 * in only one; an id in only one list still contributes and ranks below
 * anything both signals agree on. This is what actually closes the
 * vocabulary-mismatch bug: BM25 catches literal overlap Tool2Vec might
 * miss, Tool2Vec catches meaning-overlap BM25 can't see, and neither
 * signal has to be "right" alone for a genuinely relevant skill to surface.
 *
 * @example
 *   reciprocalRankFusion(
 *     [{ id: 'a', score: 4.1 }, { id: 'b', score: 2.0 }],
 *     [{ id: 'b', similarity: 0.9 }, { id: 'c', similarity: 0.5 }],
 *   )
 *   // → [{ id: 'b', ... }, { id: 'a', ... }, { id: 'c', ... }] by fused score
 */
export function reciprocalRankFusion(
  lexical: readonly RankedId[],
  semantic: readonly RankedId[],
): Array<{ id: string; fusedScore: number }> {
  const scores = new Map<string, number>();
  lexical.forEach((entry, i) => {
    scores.set(entry.id, (scores.get(entry.id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  semantic.forEach((entry, i) => {
    scores.set(entry.id, (scores.get(entry.id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  return [...scores.entries()]
    .map(([id, fusedScore]) => ({ id, fusedScore }))
    .sort((a, b) => b.fusedScore - a.fusedScore || a.id.localeCompare(b.id));
}

// ─── First-hop candidate graph & expansion ─────────────────────────────────
//
// 2026-08-19 operator directive: the fused list above only surfaces a skill
// that BM25 or Tool2Vec directly scored. A skill's own `pairs-with`
// neighbors, or the skills its SKILL.md prose names by id, never got a
// look-in unless they ALSO happened to score well on lexical or semantic
// grounds — even though a curated `pairs-with` link or an explicit "see
// also X" mention is a strong, human-authored relevance signal in its own
// right. This section builds a directed, weighted skill graph from those
// two signals and widens the post-fusion candidate pool by exactly one hop.
//
// Why first-hop only, not full transitive closure (graph analysis verified
// on this repo's 301-skill catalog as of the directive):
//   first-hop out-degree:        median 3,  max 10,  70 skills at zero-degree
//   full transitive closure:     median 40, max 145, 39 skills' closures >100
// The catalog has a giant connected component hubbed on
// `multi-agent-coordination` and `skill-architect` (21 in-links each) — a
// convergence/closure walk would pull most of the catalog into most
// queries once it touched that hub, which is indistinguishable from not
// filtering at all. Convergence closure was REJECTED on this data. A
// single hop keeps expansion proportional to what a skill actually,
// deliberately points at, and lets `HOP_DECAY` keep it subordinate to
// genuine direct matches.

/** `pairs-with` is a curated, intentional edge — an author said "these two
 *  belong together." Weighted higher than an incidental prose mention. */
export const PAIRS_WITH_WEIGHT = 1.0;
/** A bare id mentioned in another skill's prose is a weaker, incidental
 *  signal — the author was writing about something else and happened to
 *  name this skill, not necessarily endorsing it as a companion. */
export const PROSE_MENTION_WEIGHT = 0.4;
/** Discount applied on top of the edge weight when converting a seed's own
 *  fused score into a first-hop neighbor's candidate score. A neighbor is
 *  never worth more than half its best possible (pairs-with, weight 1.0)
 *  share of the seed's score — one hop away is strictly less certain than
 *  the seed's own direct match. */
export const HOP_DECAY = 0.5;

/** One directed, weighted edge in the first-hop skill graph. `weight` is
 *  `PAIRS_WITH_WEIGHT` or `PROSE_MENTION_WEIGHT` — whichever is higher, when
 *  both signals fire for the same (source, target) pair (see
 *  `buildSkillAdjacency`). */
export interface SkillGraphEdge {
  target: string;
  weight: number;
}

/** skill id → its outgoing first-hop edges. Built once per `scan()` (see
 *  the factory below) and reused until the next scan — same lifecycle as
 *  `catalog`/`catalogById`, unlike `centroidStore` (this needs no LLM call,
 *  so unlike Tool2Vec it doesn't need its own `refresh()`-gated precompute
 *  step; a pure text scan is cheap enough to do lazily on first use). */
export type SkillAdjacency = Map<string, SkillGraphEdge[]>;

const ID_HAS_HYPHEN = /-/;

function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * Re-read one skill's SKILL.md — `loadSkillCatalog` already parsed the
 * frontmatter fields IT needs (name/description/category/tags) but never
 * kept the raw frontmatter object or the prose body around — to pull both
 * first-hop signals: (a) explicit `pairs-with` targets, (b) every OTHER
 * hyphenated skill id mentioned as a whole word in the prose that follows
 * the frontmatter. Never throws: a read or YAML-parse failure here yields
 * zero edges for that skill, the same "skip, don't poison the whole
 * catalog" discipline `parseSkillMd` in `shipwright/skill-index.ts`
 * already applies (which will already have warned about a genuinely
 * malformed file).
 */
function extractSkillEdges(
  skill: SkillEntry,
  mentionRegex: RegExp | null,
): { pairsWith: string[]; prose: string[] } {
  let raw: string;
  try {
    raw = readFileSync(skill.sourcePath, 'utf-8');
  } catch {
    return { pairsWith: [], prose: [] };
  }

  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  let pairsWith: string[] = [];
  if (frontmatterMatch) {
    try {
      const frontmatter = parseYaml(frontmatterMatch[1]) as Record<string, unknown>;
      pairsWith = extractPairsWithTargets(frontmatter, skill.id);
    } catch {
      // Malformed frontmatter — loadSkillCatalog already warned about this
      // file; it just contributes no pairs-with edges here.
    }
  }
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;

  const prose: string[] = [];
  if (mentionRegex) {
    mentionRegex.lastIndex = 0;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(body))) {
      const id = match[1];
      if (id !== skill.id && !seen.has(id)) {
        seen.add(id);
        prose.push(id);
      }
    }
  }

  return { pairsWith, prose };
}

/**
 * Build the directed, weighted first-hop skill graph: skill A → skill B
 * when (a) A's frontmatter names B via `pairs-with` (weight
 * `PAIRS_WITH_WEIGHT`) or (b) B's exact id appears as a whole word in A's
 * SKILL.md prose (weight `PROSE_MENTION_WEIGHT`) — signal (b) only
 * considers ids that contain a hyphen, so a skill id that also happens to
 * be a common English word (`docx`, `liaison`, `init`, ...) never fires on
 * ordinary prose. When both signals fire for the same (A, B) pair, the
 * edge keeps the HIGHER weight — `pairs-with` is curated and intentional,
 * a prose mention is incidental, and they shouldn't stack.
 *
 * Pure text scan, no LLM calls — see the section banner above for why
 * that's what makes it safe to build eagerly on every `scan()` rather than
 * behind its own `refresh()`-gated precompute like Tool2Vec's centroids.
 *
 * Known, accepted limitation: `\b`-bounded matching treats a hyphen as a
 * word-boundary character, so a skill id that is itself a hyphenated
 * PREFIX of a longer compound id (e.g. `windags-ops` inside a mention of
 * `windags-ops-extended`) can still match. The operator directive calls
 * for plain word-boundary matching with a hyphen-presence guard against
 * common-word false positives, not a longest-match / prefix-free scheme —
 * that's what this implements.
 */
export function buildSkillAdjacency(skills: readonly SkillEntry[]): SkillAdjacency {
  const adjacency: SkillAdjacency = new Map();
  if (skills.length === 0) return adjacency;

  const hyphenatedIds = skills.map((s) => s.id).filter((id) => ID_HAS_HYPHEN.test(id));
  // Hyphen-aware boundaries, NOT plain \b: a hyphen IS a \b word boundary,
  // so `\bwindags-ops\b` would match inside `windags-ops-extended` — a false
  // edge to the shorter id, and (with the g-flag cursor advanced past it)
  // the longer id's own mention consumed and missed. Lookarounds excluding
  // [\w-] make an id match only when it is not embedded in a longer
  // hyphenated token, regardless of alternation order.
  const mentionRegex = hyphenatedIds.length > 0
    ? new RegExp(`(?<![\\w-])(${hyphenatedIds.map(escapeRegExpLiteral).join('|')})(?![\\w-])`, 'g')
    : null;

  for (const skill of skills) {
    const { pairsWith, prose } = extractSkillEdges(skill, mentionRegex);
    if (pairsWith.length === 0 && prose.length === 0) continue;
    const edges = new Map<string, number>();
    for (const target of pairsWith) edges.set(target, Math.max(edges.get(target) ?? 0, PAIRS_WITH_WEIGHT));
    for (const target of prose) edges.set(target, Math.max(edges.get(target) ?? 0, PROSE_MENTION_WEIGHT));
    adjacency.set(skill.id, [...edges.entries()].map(([target, weight]) => ({ target, weight })));
  }
  return adjacency;
}

/** A first-hop-fused candidate — `reciprocalRankFusion`'s `{ id, fusedScore }`
 *  shape, plus optional provenance (see `SkillShortlistEntry.via`). */
export interface FirstHopCandidate {
  id: string;
  fusedScore: number;
  via?: 'first-hop';
  hopSeed?: string;
}

/**
 * Widen the RRF-fused candidate pool with each of the top-K seeds' 1-hop
 * neighbors — K = `shortlistLimit`, the SAME cap `craft()` applies to the
 * final result, not a separate expansion budget (INJECTION CAPS UNCHANGED:
 * the caller re-slices to `shortlistLimit` after this runs). A neighbor's
 * boosted score is `seedScore × edgeWeight × HOP_DECAY` — always a
 * fraction of the seed's own score, so a first-hop neighbor of a mediocre
 * seed can still lose to a strong direct match ranked elsewhere in the
 * fused list, and a first-hop neighbor never simply inherits its seed's
 * rank outright. An id already present in `fused` keeps `max(ownScore,
 * boostedScore)` — expansion can only raise a candidate's position, never
 * lower one a direct signal already earned.
 *
 * Provenance (`via`/`hopSeed`) is attached ONLY to a candidate whose
 * returned score actually came from a hop boost — a brand-new id the
 * direct signals never ranked at all, or an existing id whose boosted
 * score beat its own fused score. Every other entry is returned exactly as
 * `reciprocalRankFusion` produced it, with no extra fields — so a skill
 * with no first-hop edges anywhere, or an empty adjacency map altogether,
 * degrades byte-identically to the pre-expansion result: same ids, same
 * order, same scores, nothing new to see.
 *
 * @example
 *   expandFirstHopCandidates(
 *     [{ id: 'seed', fusedScore: 0.03 }],
 *     10,
 *     new Map([['seed', [{ target: 'paired-skill', weight: PAIRS_WITH_WEIGHT }]]]),
 *   )
 *   // → [{ id: 'seed', fusedScore: 0.03 },
 *   //    { id: 'paired-skill', fusedScore: 0.015, via: 'first-hop', hopSeed: 'seed' }]
 */
export function expandFirstHopCandidates(
  fused: readonly { id: string; fusedScore: number }[],
  shortlistLimit: number,
  adjacency: SkillAdjacency,
): FirstHopCandidate[] {
  const byId = new Map<string, FirstHopCandidate>();
  for (const entry of fused) byId.set(entry.id, { id: entry.id, fusedScore: entry.fusedScore });

  const seeds = fused.slice(0, shortlistLimit);
  for (const seed of seeds) {
    const edges = adjacency.get(seed.id);
    if (!edges) continue;
    for (const edge of edges) {
      if (edge.target === seed.id) continue; // self-edges never contribute (shouldn't occur — extractPairsWithTargets/prose scan both already exclude the source's own id, this is belt-and-suspenders)
      const boosted = seed.fusedScore * edge.weight * HOP_DECAY;
      const existing = byId.get(edge.target);
      if (!existing || boosted > existing.fusedScore) {
        byId.set(edge.target, { id: edge.target, fusedScore: boosted, via: 'first-hop', hopSeed: seed.id });
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore || a.id.localeCompare(b.id));
}

// ─── Internals ──────────────────────────────────────────────────────────────

function clampLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function clampBodyChars(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.floor(value), MIN_MAX_BODY_CHARS), MAX_MAX_BODY_CHARS);
}

/**
 * Read a skill's full SKILL.md body, hard-capped at `maxBodyChars`. Some
 * SKILL.md files in this repo run past 1200 lines; with no cap, a handful of
 * `top` entries could bloat a spawned ship's task enough to raise cost or
 * trip transport/413 limits on `/spawn`. A truncated body gets the same
 * `[truncated N chars]` marker idiom `lib/fleet-engine.ts`'s `trimMessage()`
 * uses for trigger message content, so a human reading a spawned task
 * recognizes it regardless of which subsystem produced it.
 */
function readSkillBody(sourcePath: string, maxBodyChars: number, onWarning?: (message: string) => void): string | null {
  try {
    const body = readFileSync(sourcePath, 'utf-8');
    if (body.length <= maxBodyChars) return body;
    return `${body.slice(0, maxBodyChars)}\n\n[truncated ${body.length - maxBodyChars} chars]`;
  } catch (err) {
    onWarning?.(`skill-graft: failed to read ${sourcePath}: ${(err as Error).message}`);
    return null;
  }
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
