/**
 * lib/shipwright/skill-visibility.ts — the skill visibility LAW, and nothing else.
 *
 * WHY THIS FILE EXISTS AS ITS OWN MODULE
 * --------------------------------------
 * The operator's ruling on this catalog is narrow and absolute:
 *
 *   "Skills need to be particular to a person and a repo for now. We do not
 *    distribute these 300 skills, they're Erich Owens' and they are particular
 *    to his repos."
 *
 * Which makes `isPublishableSkill` the single most consequential predicate in
 * the codebase: it is the ONE gate standing between a private, person-scoped
 * catalog and any surface that shows it to somebody else. The law that follows
 * from that is "one implementation, called by every exposure path" — never a
 * second copy that can drift a tier wider.
 *
 * `skill-index.ts` (the file this used to live in) is a Node module: it imports
 * `node:fs`, `node:crypto`, and a better-sqlite3-backed vector store. The relay
 * is a Cloudflare Worker and can import none of that. Rather than let the
 * Worker re-implement the predicate — which is exactly the drift the law
 * forbids — the law moved HERE, into a module with ZERO imports, so the Node
 * catalog loader and the workerd publish paths call the same function object.
 *
 * KEEP THIS FILE DEPENDENCY-FREE. No `node:` builtins, no npm packages, no
 * `Env`, no I/O. Anything that would make it unimportable from a Worker belongs
 * in `skill-index.ts`, not here. `skill-index.ts` re-exports both public
 * symbols, so every existing import site keeps working unchanged.
 */

/**
 * Visibility tier a skill has opted into, from frontmatter `visibility`.
 *
 * These skills are not a distributed catalog — they're one operator's, scoped to their own
 * repos. `'private'` (the default) means nothing beyond that: no export path, no directory
 * listing, no publish target ever sees the entry. `'listed'` and `'public'` are each a
 * deliberate, per-skill opt-in a person wrote into their own SKILL.md — never a tier a parser
 * infers or a default anyone lands in by omission.
 */
export type SkillVisibility = 'private' | 'listed' | 'public';

/**
 * The single predicate any future export, publish, or directory-listing path MUST call before
 * showing a skill entry to anyone beyond its owner's own machine and repos. Never gate a
 * publish path on `entry.visibility` directly — route it through here so the widening logic
 * lives in exactly one place.
 *
 * Two tiers, two payloads (the derived-index consent doctrine — see
 * `skills/local-first-tenancy-boundary`'s scope-ladder: private -> repo -> team -> public,
 * where silent tier crossing is always a critical finding, never a shrug):
 *
 * - `tier: 'listed'` authorizes the *smaller* payload — name + description only, the kind of
 *   thing a directory or search result shows. Satisfied by `visibility` `'listed'` OR
 *   `'public'` (public implies listed).
 * - `tier: 'public'` authorizes the *larger* payload — the full SKILL.md body. Satisfied only
 *   by `visibility === 'public'`.
 *
 * Pure and total: decides from the entry's already-parsed `visibility` alone, never reads disk,
 * never throws.
 *
 * @example
 *   const listable = catalog.filter((s) => isPublishableSkill(s, 'listed'));
 *   const fullBodyOk = isPublishableSkill(entry, 'public');
 */
export function isPublishableSkill(
  entry: { visibility: SkillVisibility },
  tier: 'listed' | 'public',
): boolean {
  if (tier === 'public') return entry.visibility === 'public';
  // Only the exact 'listed' tier earns listed-tier semantics. TS can't stop
  // a plain-JS caller (or a typo'd cast) from passing some other string, and
  // falling through to the listed branch would hand that unknown tier the
  // WIDER grant — a listed skill's payload served for a tier nobody defined.
  // Unknown narrows, never widens (same law parseVisibility follows).
  if (tier !== 'listed') return false;
  return entry.visibility === 'listed' || entry.visibility === 'public';
}

const KNOWN_VISIBILITIES: ReadonlySet<SkillVisibility> = new Set(['private', 'listed', 'public']);

/**
 * Parses frontmatter `visibility` defensively. Absence is privacy, never exposure: a missing
 * field, a non-string value, or a string that isn't exactly one of the three known tiers all
 * resolve to `'private'` — the narrowest tier, never a guess at something wider. An unrecognized
 * value warns (when a warning sink is given) so a typo in someone's frontmatter surfaces instead
 * of silently doing nothing, but it still never coerces upward.
 */
export function parseVisibility(
  raw: unknown,
  path: string,
  onWarning?: (msg: string) => void,
): SkillVisibility {
  if (raw === undefined || raw === null) return 'private';
  if (typeof raw !== 'string') {
    // Deliberately doesn't fall through to String(raw): a single-element array
    // like ['public'] would otherwise stringify to "public" and slip past the
    // check below as if it were a real string value.
    onWarning?.(`${path}: visibility must be a string, got ${typeof raw}, defaulting to private`);
    return 'private';
  }
  const normalized = raw.trim().toLowerCase();
  if (KNOWN_VISIBILITIES.has(normalized as SkillVisibility)) return normalized as SkillVisibility;
  onWarning?.(`${path}: unknown visibility "${raw}", defaulting to private`);
  return 'private';
}
