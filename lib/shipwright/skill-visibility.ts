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

/**
 * The frontmatter block, as a text span. Mirrors `splitSkillMarkdown`'s regex in
 * apps/relay/src/seamanship.ts, but keeps the raw YAML text rather than a parsed
 * object — the writer below edits lines in place and must not reserialize.
 */
const FRONTMATTER_SPAN_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;
const VISIBILITY_LINE_RE = /^([ \t]*)visibility[ \t]*:[ \t]*.*$/m;

/**
 * Rewrites a SKILL.md's `visibility:` frontmatter to `target`, returning the new
 * text — or `null` when the file has no frontmatter block to edit.
 *
 * WHY A TEXT EDIT AND NOT A YAML ROUND-TRIP
 * -----------------------------------------
 * Parsing to an object and reserializing would reformat every SKILL.md it
 * touches: comment lines dropped, key order normalized, block scalars refolded,
 * quoting style changed. Across a ~300-skill catalog that turns "set one skill
 * to listed" into a diff nobody can review, which is how a visibility change
 * gets waved through. This edits the one line and leaves every other byte
 * alone, so the diff is the decision.
 *
 * `'private'` REMOVES the line rather than writing `visibility: private`.
 * Private is the absence of a grant, not a grant of its own — `parseVisibility`
 * already resolves a missing field to `'private'`, so the two states are
 * identical to every reader, and the one that survives should be the one a
 * fully-private catalog has always looked like. It also means flipping a skill
 * public and back leaves no residue.
 *
 * Only the frontmatter span is searched, so a `visibility:` written inside a
 * fenced example in the body is never touched.
 *
 * Idempotent: setting the tier a skill already has returns the text unchanged.
 * The caller is still expected to read the result back through
 * `parseVisibility` and confirm — this function returns text, not a promise
 * that the catalog now agrees.
 */
export function withVisibility(text: string, target: SkillVisibility): string | null {
  const m = FRONTMATTER_SPAN_RE.exec(text);
  if (!m) return null;
  const open = m[1] ?? '';
  const yaml = m[2] ?? '';
  const close = m[3] ?? '';
  const eol = open.includes('\r\n') ? '\r\n' : '\n';

  let nextYaml: string;
  if (VISIBILITY_LINE_RE.test(yaml)) {
    nextYaml =
      target === 'private'
        ? // Drop the line AND the newline that followed it, so removing a key
          // does not leave a blank line where it used to be.
          yaml.replace(/^[ \t]*visibility[ \t]*:[ \t]*.*(\r?\n|$)/m, '')
        : yaml.replace(VISIBILITY_LINE_RE, `$1visibility: ${target}`);
  } else if (target === 'private') {
    return text; // already absent, which already means private
  } else {
    // Append rather than prepend: `name` and `description` are what a reader
    // looks for first, and provenance belongs under them.
    nextYaml = `${yaml}${eol}visibility: ${target}`;
  }

  // Trailing whitespace-only lines can accumulate after a removal; trim only
  // the very end of the YAML span, never the body.
  nextYaml = nextYaml.replace(/(\r?\n)+$/, '');
  return `${open}${nextYaml}${close}${text.slice(m[0].length)}`;
}
