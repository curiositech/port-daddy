/**
 * Cloud skill graft — prepend repo skills to a ship's prompt.
 *
 * A ship declared with `graft: [skill-id, ...]` in pd-fleet.yml gets each
 * skill's `skills/<id>/SKILL.md` prepended to its system prompt under a
 * `## Grafted skill: <id>` heading, so a cloud ship inherits the repo's own
 * playbooks (the same files local agents load via the Skill tool).
 *
 * ZERO-TRUST INVARIANT: skill files are fetched from the TRUSTED default
 * branch ONLY (the caller binds the fetcher to that ref) — never from the PR
 * head. A PR that edits skills/ must not be able to steer the ships that
 * review it.
 *
 * Bounds:
 *   - at most {@link MAX_GRAFTS_PER_SHIP} skills per ship (fleet.ts also caps
 *     at parse time; this is belt-and-suspenders),
 *   - each skill truncated to ~{@link SKILL_GRAFT_CHAR_LIMIT} chars,
 *   - skill ids validated against a conservative slug regex so a hostile
 *     config value can never become a path traversal.
 *
 * CACHED PER RUN: one cache instance is created per fleet run; each skill file
 * is fetched at most once no matter how many ships graft it.
 *
 * Unknown ids are reported in `missing` — the caller records a transcript
 * WARNING, never a failure: a typo'd graft must not sink a review.
 */

/** Hard cap on grafted skills per ship. */
export const MAX_GRAFTS_PER_SHIP = 3;
/** Per-skill content budget (chars ≈ bytes for the mostly-ASCII SKILL.md files). */
export const SKILL_GRAFT_CHAR_LIMIT = 6 * 1024;

/** Conservative skill-id slug: no slashes, no dots-only segments, no traversal. */
const SKILL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface SkillGraft {
  /** The prompt prefix — '' when nothing loaded. Ends with a separator when non-empty. */
  text: string;
  /** Skill ids successfully fetched and grafted, in order. */
  loaded: string[];
  /** Skill ids that were invalid or not found on the trusted branch. */
  missing: string[];
}

export interface SkillGraftCache {
  graftFor(ids: string[]): Promise<SkillGraft>;
}

/** Truncate one skill body to the graft budget, marking the cut honestly. */
function truncateSkill(content: string): string {
  if (content.length <= SKILL_GRAFT_CHAR_LIMIT) return content.trimEnd();
  return (
    content.slice(0, SKILL_GRAFT_CHAR_LIMIT).trimEnd() +
    `\n… (skill truncated at ${SKILL_GRAFT_CHAR_LIMIT} chars)`
  );
}

/**
 * Create a per-run skill-graft cache. `fetchFile` is expected to be bound to
 * the TRUSTED default branch (e.g. `path => fetchRepoFile(owner, repo, path,
 * DEFAULT_BRANCH, token)`); it returns the file body or null when absent.
 * Fetch errors are treated as "missing" — a graft can never crash a run.
 */
export function createSkillGraftCache(
  fetchFile: (path: string) => Promise<string | null>,
): SkillGraftCache {
  const cache = new Map<string, string | null>();

  async function fetchSkill(id: string): Promise<string | null> {
    if (cache.has(id)) return cache.get(id) ?? null;
    let body: string | null;
    try {
      body = await fetchFile(`skills/${id}/SKILL.md`);
    } catch {
      body = null;
    }
    cache.set(id, body);
    return body;
  }

  return {
    async graftFor(ids: string[]): Promise<SkillGraft> {
      const unique = [...new Set(ids)].slice(0, MAX_GRAFTS_PER_SHIP);
      const loaded: string[] = [];
      const missing: string[] = [];
      const sections: string[] = [];

      for (const id of unique) {
        if (!SKILL_ID_RE.test(id)) {
          missing.push(id);
          continue;
        }
        const body = await fetchSkill(id);
        if (body == null || !body.trim()) {
          missing.push(id);
          continue;
        }
        loaded.push(id);
        sections.push(`## Grafted skill: ${id}\n\n${truncateSkill(body)}`);
      }

      const text = sections.length > 0 ? `${sections.join('\n\n')}\n\n---\n\n` : '';
      return { text, loaded, missing };
    },
  };
}
