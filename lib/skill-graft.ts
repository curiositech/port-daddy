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
 * - Skill scanning + vector cache: `loadSkillCatalog` / `createSkillIndex`
 *   from `./shipwright/skill-index.ts` — the existing defensive SKILL.md
 *   frontmatter parser and SQLite-backed cosine index Shipwright already
 *   uses for `pd shipwright propose`. Skill Graft injects the shared local
 *   embedder into it instead of letting it lazily build its own (equivalent
 *   but separate) loader, and layers the windags-style shortlist/full-body
 *   split and the reference-file fetch on top — neither of which
 *   `createSkillIndex` does today (it only stores `description`, by
 *   design, to keep embeddings cheap).
 * - Path safety: `containPath` from `./fleet/path-guard.ts` guards
 *   `getReference()` against path traversal / symlink escape out of a
 *   skill's own directory, the same primitive `lib/fleet/outputs/file.ts`
 *   and the file trigger use.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createLocalEmbedder, defaultTransformersCacheDir } from './semantic-resolver.js';
import {
  createSkillIndex,
  loadSkillCatalog,
  type SkillEmbedder,
  type SkillEntry,
  type SkillIndex,
} from './shipwright/skill-index.js';
import { containPath, PathEscapeError } from './fleet/path-guard.js';

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
  /** Cosine similarity to the query, roughly 0..1 (MiniLM vectors are
   *  L2-normalized so this is a dot product). Higher is more relevant. */
  similarity: number;
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
  /** Inject a fake/shared index for tests or to share a cache. Defaults to
   *  `createSkillIndex({ embedder })` (the same on-disk cache Shipwright uses
   *  at `~/.port-daddy/skill-index.sqlite`, keyed by skill id + content hash,
   *  so re-embedding only happens when a SKILL.md's indexed fields change). */
  index?: SkillIndex;
  /** Called with a human-readable message when a SKILL.md is skipped
   *  (malformed frontmatter, missing name/description) or a reference read
   *  fails. Never throws on the caller's behalf. */
  onWarning?: (message: string) => void;
}

export interface SkillGraftIndex {
  /**
   * Rank every scanned skill against `query` and return a cheap shortlist
   * plus the full body for the top few. Scans + (re-)indexes on first call
   * (and whenever `refresh()` is called explicitly); subsequent calls reuse
   * the persisted vector cache and only re-embed skills whose frontmatter
   * changed.
   */
  craft(query: string, options?: SkillGraftCraftOptions): Promise<SkillGraftResult>;
  /**
   * Fetch one file from within a specific skill's own directory — the
   * on-demand companion to `craft()`, mirroring `windags_skill_reference`.
   * Guards against the requested path escaping the skill's directory.
   * Requires `craft()` or `refresh()` to have run at least once (so the
   * catalog is populated); returns `found: false` otherwise rather than
   * throwing.
   */
  getReference(skillId: string, filePath: string): SkillReferenceResult;
  /** Skill ids known as of the last scan (empty until `craft()`/`refresh()` runs). */
  listSkillIds(): string[];
  /** Force a re-scan + re-index. Returns cache-hit accounting. */
  refresh(): Promise<{ scannedCount: number; embedded: number; reused: number; removed: number }>;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_SHORTLIST_LIMIT = 10;
const DEFAULT_TOP_LIMIT = 3;
const MAX_LIMIT = 50;

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
  const index: SkillIndex = options.index ?? createSkillIndex({ embedder });
  const defaultShortlistLimit = clampLimit(options.shortlistLimit, DEFAULT_SHORTLIST_LIMIT);
  const defaultTopLimit = clampLimit(options.topLimit, DEFAULT_TOP_LIMIT);

  let catalog: SkillEntry[] = [];
  let catalogById = new Map<string, SkillEntry>();
  let indexed = false;

  function scan(): SkillEntry[] {
    catalog = loadSkillCatalog(roots.map((root) => root.path), { onWarning: options.onWarning });
    catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
    return catalog;
  }

  async function ensureIndexed(): Promise<{ embedded: number; reused: number; removed: number }> {
    const entries = scan();
    const stats = await index.index(entries);
    indexed = true;
    return stats;
  }

  return {
    async craft(query, callOptions = {}) {
      if (!indexed) await ensureIndexed();

      const trimmed = query.trim();
      const shortlistLimit = clampLimit(callOptions.shortlistLimit, defaultShortlistLimit);
      const topLimit = Math.min(clampLimit(callOptions.topLimit, defaultTopLimit), shortlistLimit);

      if (!trimmed) {
        return { query, scannedCount: catalog.length, roots, shortlist: [], top: [] };
      }

      const results = await index.search(trimmed, { k: shortlistLimit });
      const shortlist: SkillShortlistEntry[] = results.map((result) => ({
        id: result.skill.id,
        description: result.skill.description,
        category: result.skill.category,
        tags: result.skill.tags,
        similarity: result.similarity,
      }));

      const top: SkillGraftEntry[] = [];
      for (const result of results.slice(0, topLimit)) {
        const body = readSkillBody(result.skill.sourcePath, options.onWarning);
        if (body === null) continue;
        top.push({
          id: result.skill.id,
          description: result.skill.description,
          category: result.skill.category,
          tags: result.skill.tags,
          similarity: result.similarity,
          body,
          sourcePath: result.skill.sourcePath,
        });
      }

      return { query, scannedCount: catalog.length, roots, shortlist, top };
    },

    getReference(skillId, filePath) {
      const skill = catalogById.get(skillId);
      if (!skill) {
        return {
          skillId,
          filePath,
          found: false,
          content: null,
          absolutePath: null,
          error: `unknown skill id "${skillId}" (call craft()/refresh() first, or check the id)`,
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
    lines.push(`- ${entry.id} (similarity ${entry.similarity.toFixed(2)}): ${truncate(entry.description, 160)}`);
  }

  if (result.top.length > 0) {
    lines.push('', 'Full guidance for the top match(es) — read before writing code in this area:');
    for (const entry of result.top) {
      lines.push('', `--- ${entry.id} (SKILL.md) ---`, entry.body.trim());
    }
  }

  return lines.join('\n');
}

// ─── Internals ──────────────────────────────────────────────────────────────

function clampLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function readSkillBody(sourcePath: string, onWarning?: (message: string) => void): string | null {
  try {
    return readFileSync(sourcePath, 'utf-8');
  } catch (err) {
    onWarning?.(`skill-graft: failed to read ${sourcePath}: ${(err as Error).message}`);
    return null;
  }
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
