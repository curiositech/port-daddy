/**
 * lib/skill-pairs-with.ts — how a `pairs-with` edge is read out of SKILL.md
 * frontmatter, and nothing else.
 *
 * Extracted from `lib/skill-graft.ts` (which imports `node:fs` and a local
 * Transformers.js embedder, so a Cloudflare Worker cannot load it) for the same
 * reason `skill-visibility.ts` was extracted from `skill-index.ts`: the relay's
 * Seamanship page renders each skill's curated `pairs-with` neighbours, and two
 * parsers that disagree about where the field lives would render two different
 * graphs from one catalog.
 *
 * KEEP THIS FILE DEPENDENCY-FREE — it is imported from workerd.
 *
 * SCOPE NOTE: this is the CURATED half of the first-hop graph only. The graft
 * index's other edge signal — a skill id mentioned as a whole word in another
 * skill's prose body (`PROSE_MENTION_WEIGHT`) — needs the prose, which a
 * frontmatter-only reader does not have. Any surface built on this function
 * must say "curated pairs-with edges", never "the first-hop graph".
 */

/**
 * Pull `pairs-with` targets out of one skill's already-YAML-parsed
 * frontmatter. Real SKILL.md files in this repo disagree on where the
 * field lives — most nest it under `metadata:` (e.g.
 * `rag-retrieval-pattern-design`), a few put it at the frontmatter top
 * level (e.g. `dag-performance-profiler`) — so both locations are checked
 * and merged. Entry shape also varies: most are `{ skill, reason }`
 * objects, but 22 skills (e.g. `wave-by-wave-parley`, the imported windags
 * grafts, and several port-daddy-* skills) list bare id strings instead —
 * both shapes count as the same curated edge. Only the target id matters
 * here — `reason` is operator-facing prose this module never reads.
 *
 * Total: never throws on a malformed frontmatter, returns `[]` instead.
 * Self-edges (`selfId`) are dropped.
 */
export function extractPairsWithTargets(
  frontmatter: Record<string, unknown>,
  selfId: string,
): string[] {
  const metadata = (frontmatter.metadata && typeof frontmatter.metadata === 'object')
    ? frontmatter.metadata as Record<string, unknown>
    : {};
  const rawEntries = [
    ...(Array.isArray(frontmatter['pairs-with']) ? frontmatter['pairs-with'] as unknown[] : []),
    ...(Array.isArray(metadata['pairs-with']) ? metadata['pairs-with'] as unknown[] : []),
  ];
  const targets: string[] = [];
  for (const entry of rawEntries) {
    const id = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object') ? (entry as Record<string, unknown>).skill : undefined;
    if (typeof id === 'string' && id.trim() && id.trim() !== selfId) targets.push(id.trim());
  }
  return targets;
}
