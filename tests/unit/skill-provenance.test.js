// Skill provenance — ownership/repo/visibility frontmatter on top of the
// shared `loadSkillCatalog` parser (lib/shipwright/skill-index.ts), plus the
// `isPublishableSkill` guard and the `pd seamanship list`/`show` rendering
// that surfaces it.
//
// Operator directive this encodes: these ~300 skills are Erich Owens' own,
// scoped to his own repos — not a distributed catalog. Absence of a grant
// (no owner, no visibility declared) must read as 'private', never as
// exposure, and an unrecognized visibility value must never coerce upward.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { loadSkillCatalog, isPublishableSkill } = await import('../../lib/shipwright/skill-index.js');
const skillVisibility = await import('../../lib/shipwright/skill-visibility.js');
const { extractPairsWithTargets } = await import('../../lib/skill-pairs-with.js');
const { formatVisibilityMarker, formatOwnershipLine, tierCounts } = await import('../../cli/commands/seamanship.js');
const { withVisibility, parseVisibility } = skillVisibility;

let tmpRoot;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pd-skill-provenance-test-'));
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Writes a SKILL.md. `frontmatterExtra`, when given, is spliced verbatim
 * into the frontmatter block so individual tests can hand-craft malformed
 * or edge-case `owner`/`repos`/`visibility` values (including non-string
 * YAML shapes) without fighting a helper's escaping.
 */
function writeSkill(rootDir, name, description, { category, tags, frontmatterExtra } = {}) {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  const tagLines = Array.isArray(tags) ? `\n    - ${tags.join('\n    - ')}` : '';
  const categoryLine = category ? `category: ${category}` : '';
  const extra = frontmatterExtra ? `${frontmatterExtra}\n` : '';
  const fm = `---\nname: ${name}\ndescription: |\n  ${description}\n${extra}metadata:\n  ${categoryLine}\n  tags:${tagLines}\n---\n\n# ${name}\n`;
  writeFileSync(join(dir, 'SKILL.md'), fm);
  return join(dir, 'SKILL.md');
}

// ─── Defaults: absence is privacy, never exposure ──────────────────────────

describe('loadSkillCatalog: defaults when owner/repos/visibility are absent', () => {
  test('a skill with no provenance frontmatter parses to private, owner undefined, repos empty', () => {
    writeSkill(tmpRoot, 'plain-skill', 'a skill with no provenance fields at all');

    const [entry] = loadSkillCatalog([tmpRoot]);
    expect(entry.owner).toBeUndefined();
    expect(entry.repos).toEqual([]);
    expect(entry.visibility).toBe('private');
  });

  test('declaring owner/repos without visibility still defaults visibility to private', () => {
    writeSkill(tmpRoot, 'owned-skill', 'a skill with an owner but no explicit visibility', {
      frontmatterExtra: `owner: "Erich Owens"\nrepos:\n  - "port-daddy"`,
    });

    const [entry] = loadSkillCatalog([tmpRoot]);
    expect(entry.owner).toBe('Erich Owens');
    expect(entry.repos).toEqual(['port-daddy']);
    expect(entry.visibility).toBe('private'); // no grant declared -> stays private
  });
});

// ─── Unknown-value coercion: never widen, always warn ──────────────────────

describe('loadSkillCatalog: visibility coercion never widens the tier', () => {
  test('an unrecognized string value coerces to private and warns', () => {
    writeSkill(tmpRoot, 'team-tier-skill', 'a skill that tries a tier this parser does not know', {
      frontmatterExtra: `visibility: "team"`,
    });

    const warnings = [];
    const [entry] = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
    expect(entry.visibility).toBe('private');
    expect(warnings.some((w) => /unknown visibility/.test(w))).toBe(true);
  });

  test('a non-string visibility (array) coerces to private and warns, not toString()-matched', () => {
    // A regression guard: String(['public']) === 'public', so a naive
    // `String(raw)` coercion would silently accept this as a real grant.
    writeSkill(tmpRoot, 'array-visibility-skill', 'a skill whose visibility is a YAML list, not a string', {
      frontmatterExtra: `visibility:\n  - "public"`,
    });

    const warnings = [];
    const [entry] = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
    expect(entry.visibility).toBe('private');
    expect(warnings.some((w) => /visibility must be a string/.test(w))).toBe(true);
  });

  test('a numeric visibility coerces to private and warns', () => {
    writeSkill(tmpRoot, 'numeric-visibility-skill', 'a skill whose visibility is a bare number', {
      frontmatterExtra: `visibility: 42`,
    });

    const warnings = [];
    const [entry] = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
    expect(entry.visibility).toBe('private');
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('mixed-case and padded whitespace still resolve to the real tier (tolerant, not just permissive)', () => {
    writeSkill(tmpRoot, 'padded-visibility-skill', 'a skill with sloppy but recognizable visibility casing', {
      frontmatterExtra: `visibility: " Public "`,
    });

    const warnings = [];
    const [entry] = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
    expect(entry.visibility).toBe('public');
    expect(warnings).toEqual([]); // recognized after normalization — no warning needed
  });

  test('an empty-string visibility coerces to private and warns rather than silently defaulting', () => {
    writeSkill(tmpRoot, 'empty-visibility-skill', 'a skill with visibility declared but blank', {
      frontmatterExtra: `visibility: ""`,
    });

    const warnings = [];
    const [entry] = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
    expect(entry.visibility).toBe('private');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ─── Parser tolerance for malformed owner/repos values ─────────────────────

describe('loadSkillCatalog: parser tolerance for malformed owner/repos', () => {
  test('a non-string owner (number) is dropped to undefined, never coerced to a string', () => {
    writeSkill(tmpRoot, 'numeric-owner-skill', 'a skill whose owner field is a bare number', {
      frontmatterExtra: `owner: 12345`,
    });

    const [entry] = loadSkillCatalog([tmpRoot]);
    expect(entry.owner).toBeUndefined();
  });

  test('a whitespace-only owner is treated as absent, not as an empty attribution', () => {
    writeSkill(tmpRoot, 'blank-owner-skill', 'a skill whose owner field is only whitespace', {
      frontmatterExtra: `owner: "   "`,
    });

    const [entry] = loadSkillCatalog([tmpRoot]);
    expect(entry.owner).toBeUndefined();
  });

  test('a non-array repos value (bare string) never crashes and yields an empty list', () => {
    writeSkill(tmpRoot, 'string-repos-skill', 'a skill whose repos field is a bare string, not a list', {
      frontmatterExtra: `repos: "port-daddy"`,
    });

    const [entry] = loadSkillCatalog([tmpRoot]);
    expect(entry.repos).toEqual([]);
  });

  test('repos entries that are not strings are filtered out; survivors are trimmed', () => {
    writeSkill(tmpRoot, 'mixed-repos-skill', 'a skill with a repos list containing junk entries', {
      frontmatterExtra: `repos:\n  - 1\n  - null\n  - "valid-repo"\n  - "  spaced-repo  "\n  - ""`,
    });

    const [entry] = loadSkillCatalog([tmpRoot]);
    expect(entry.repos).toEqual(['valid-repo', 'spaced-repo']);
  });

  test('malformed provenance never prevents the rest of the entry from parsing', () => {
    writeSkill(tmpRoot, 'chaos-skill', 'a skill with every provenance field malformed at once', {
      frontmatterExtra: `owner: 999\nrepos: "not-a-list"\nvisibility: "wat"`,
    });

    const warnings = [];
    const [entry] = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
    expect(entry).toBeDefined();
    expect(entry.id).toBe('chaos-skill');
    expect(entry.owner).toBeUndefined();
    expect(entry.repos).toEqual([]);
    expect(entry.visibility).toBe('private');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ─── isPublishableSkill: the single guard, truth table ─────────────────────

describe('isPublishableSkill: truth table across all 3 visibilities x 2 tiers', () => {
  test.each([
    ['private', 'listed', false],
    ['private', 'public', false],
    ['listed', 'listed', true],
    ['listed', 'public', false], // listed does NOT imply public — it's the smaller payload only
    ['public', 'listed', true],  // public implies listed (the larger grant satisfies the smaller ask)
    ['public', 'public', true],
  ])('visibility=%s, tier=%s -> %s', (visibility, tier, expected) => {
    expect(isPublishableSkill({ visibility }, tier)).toBe(expected);
  });

  test('an unknown tier fails closed for every visibility — never falls through to listed semantics', () => {
    // TS can't stop a plain-JS caller (or a typo'd cast) from passing some
    // other tier string; the guard must return false rather than hand the
    // unknown string the wider listed-tier grant.
    for (const visibility of ['private', 'listed', 'public']) {
      for (const tier of ['internal', 'full-bodies', '', 'LISTED', 'Public']) {
        expect(isPublishableSkill({ visibility }, tier)).toBe(false);
      }
    }
  });

  test('is pure: repeated calls on the same entry never mutate it or vary the result', () => {
    const entry = { visibility: 'listed' };
    const frozen = Object.freeze({ ...entry });
    expect(isPublishableSkill(frozen, 'listed')).toBe(true);
    expect(isPublishableSkill(frozen, 'public')).toBe(false);
    expect(frozen).toEqual({ visibility: 'listed' }); // untouched
  });
});

// ─── pd seamanship list/show rendering ──────────────────────────────────────

describe('formatVisibilityMarker (pd seamanship list)', () => {
  // Operator ruling 2026-08-22 reversed this: private used to render as '',
  // on the theory that the absence of a grant should read as ordinary. That is
  // right about grants and wrong about gates — an unmarked tier is one you
  // cannot audit by looking. Every tier renders now.
  test('private renders explicitly, not as an empty string', () => {
    expect(formatVisibilityMarker('private')).toContain('private');
    expect(formatVisibilityMarker('private').trim()).toBe('[private]');
  });

  test('every tier renders, and all three pad to one column width', () => {
    const widths = new Set(
      ['private', 'listed', 'public'].map((v) => formatVisibilityMarker(v).length),
    );
    expect(widths.size).toBe(1);
    for (const v of ['private', 'listed', 'public']) {
      expect(formatVisibilityMarker(v)).toContain(v);
    }
  });
});

describe('formatOwnershipLine (pd seamanship show)', () => {
  test('undefined provenance (or default private/no-owner/no-repos) renders nothing', () => {
    expect(formatOwnershipLine(undefined)).toBeNull();
    expect(formatOwnershipLine({ visibility: 'private', repos: [] })).toBeNull();
  });

  test('an owner alone is enough to render a line, even while still private', () => {
    const line = formatOwnershipLine({ owner: 'Erich Owens', visibility: 'private', repos: [] });
    expect(line).toContain('owner: Erich Owens');
    expect(line).toContain('visibility: private');
  });

  test('a non-private visibility renders a line even with no declared owner', () => {
    const line = formatOwnershipLine({ visibility: 'listed', repos: [] });
    expect(line).toContain('owner: (unattributed)');
    expect(line).toContain('visibility: listed');
  });

  test('declared repos are rendered when present', () => {
    const line = formatOwnershipLine({
      owner: 'Erich Owens',
      visibility: 'public',
      repos: ['port-daddy', 'pd-seamanship'],
    });
    expect(line).toContain('owner: Erich Owens');
    expect(line).toContain('visibility: public');
    expect(line).toContain('repos: port-daddy, pd-seamanship');
  });
});

// ── ONE implementation of the visibility law ────────────────────────────────
//
// `isPublishableSkill` moved into lib/shipwright/skill-visibility.ts — a module
// with zero imports — so the Cloudflare Worker publish surfaces (apps/relay's
// Seamanship page and public listing) can import the SAME function instead of
// re-implementing it. skill-index.ts imports better-sqlite3 and node:fs and can
// never be loaded in workerd, which is exactly why a second copy would have
// been written if the law had stayed there.
//
// These tests pin the arrangement itself, not just the behaviour: identity, so
// a future edit cannot quietly fork the predicate into two look-alikes that
// drift a tier apart.
describe('withVisibility: the writer agrees with the parser it will be read by', () => {
  // Operator directive (2026-08-22): "Null needs to be default private,
  // obviously, it should be easy to change it in the tools obviously."
  // These pin the "easy to change" half — a writer that says it set a tier
  // while the parser reads back a different one is worse than no writer.

  const SKILL = [
    '---',
    'name: example-skill',
    'description: A skill used by these tests.',
    'owner: erichowens',
    '---',
    '',
    '# Example',
    '',
    'Frontmatter in a fenced block, which must never be edited:',
    '',
    '```yaml',
    'visibility: public',
    '```',
    '',
  ].join('\n');

  /** Every assertion routes through the real parser, never a regex of its own. */
  function tierOf(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const line = m ? /^[ \t]*visibility[ \t]*:[ \t]*(.*)$/m.exec(m[1]) : null;
    return parseVisibility(line ? line[1].trim() : undefined, 'test');
  }

  it('adds the line when absent, and the parser reads back what was asked for', () => {
    for (const tier of ['listed', 'public']) {
      const out = withVisibility(SKILL, tier);
      expect(out).not.toBeNull();
      expect(tierOf(out)).toBe(tier);
    }
  });

  it('setting private REMOVES the line rather than writing visibility: private', () => {
    const listed = withVisibility(SKILL, 'listed');
    expect(listed).toContain('visibility: listed');
    const back = withVisibility(listed, 'private');
    // Only the fenced-block occurrence may remain.
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(back)[1];
    expect(frontmatter).not.toMatch(/visibility/);
    expect(tierOf(back)).toBe('private');
  });

  it('private -> listed -> private leaves no residue (byte-identical round trip)', () => {
    // The reason private is an absence and not a value: flipping a skill out
    // and back should leave the file as it was, or every experiment leaves a
    // trace in the diff and reviewers stop reading them.
    const round = withVisibility(withVisibility(SKILL, 'listed'), 'private');
    expect(round).toBe(SKILL);
  });

  it('NEVER edits a visibility: line in the body, only in the frontmatter', () => {
    // The account page ships an example `visibility: listed` snippet, and a
    // SKILL.md documenting the feature would contain one too. A writer that
    // rewrote a fenced example would silently corrupt documentation.
    const out = withVisibility(SKILL, 'public');
    const body = out.slice(out.indexOf('# Example'));
    expect(body).toContain('```yaml\nvisibility: public\n```');
    // and the fenced one is not what the parser picked up
    const fmCount = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(out)[1].match(/visibility/g) || []).length;
    expect(fmCount).toBe(1);
  });

  it('is idempotent and preserves the body byte for byte', () => {
    const once = withVisibility(SKILL, 'listed');
    const twice = withVisibility(once, 'listed');
    expect(twice).toBe(once);
    const bodyOf = (t) => t.slice(t.indexOf('# Example'));
    expect(bodyOf(once)).toBe(bodyOf(SKILL));
  });

  it('setting private on an already-private file changes nothing', () => {
    expect(withVisibility(SKILL, 'private')).toBe(SKILL);
  });

  it('returns null when there is no frontmatter to edit, rather than guessing', () => {
    expect(withVisibility('# Just a heading\n\nNo frontmatter here.\n', 'public')).toBeNull();
  });

  it('preserves CRLF line endings', () => {
    const crlf = SKILL.replace(/\n/g, '\r\n');
    const out = withVisibility(crlf, 'listed');
    expect(out).toContain('\r\nvisibility: listed\r\n---');
    expect(tierOf(out)).toBe('listed');
  });

  it('replaces an existing value rather than appending a second line', () => {
    const listed = withVisibility(SKILL, 'listed');
    const pub = withVisibility(listed, 'public');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(pub)[1];
    expect((frontmatter.match(/visibility/g) || []).length).toBe(1);
    expect(tierOf(pub)).toBe('public');
  });
});

describe('tierCounts (pd seamanship list footer)', () => {
  it('counts an absent provenance entry as private, matching the parser default', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const provenance = new Map([
      ['a', { visibility: 'public', repos: [] }],
      ['b', { visibility: 'listed', repos: [] }],
      // 'c' deliberately absent
    ]);
    expect(tierCounts(entries, provenance)).toEqual({ private: 1, listed: 1, public: 1 });
  });
});

describe('the visibility law has exactly one implementation', () => {
  test('skill-index re-exports the shared predicate — the same binding, not a copy', () => {
    expect(isPublishableSkill).toBe(skillVisibility.isPublishableSkill);
  });

  test('the shared module is importable with no Node or native dependency', () => {
    // It parsed and evaluated above without better-sqlite3, transformers.js or
    // node:fs being reachable from it. Its whole exported surface is the law:
    // the gate (isPublishableSkill), the reader (parseVisibility), and the
    // writer (withVisibility).
    //
    // withVisibility is here rather than in the CLI on purpose. It is a pure
    // text transform with no fs — the caller does the reading and writing — so
    // it keeps this module Worker-importable, and it sits beside the parser it
    // has to agree with. A writer that lived somewhere else would be free to
    // drift from the reader, which is the exact failure this module exists to
    // prevent in the other direction.
    //
    // This list is asserted exactly, not with toContain: a new export here is a
    // new piece of the law, and it should not be possible to add one without a
    // reviewer seeing this test change.
    expect(Object.keys(skillVisibility).sort()).toEqual([
      'isPublishableSkill',
      'parseVisibility',
      'withVisibility',
    ]);
  });

  test('the shared parseVisibility narrows the same way the catalog loader does', () => {
    expect(skillVisibility.parseVisibility(undefined, 'p')).toBe('private');
    expect(skillVisibility.parseVisibility(null, 'p')).toBe('private');
    expect(skillVisibility.parseVisibility(['public'], 'p')).toBe('private');
    expect(skillVisibility.parseVisibility('publik', 'p')).toBe('private');
    expect(skillVisibility.parseVisibility('  PUBLIC  ', 'p')).toBe('public');
    expect(skillVisibility.parseVisibility('listed', 'p')).toBe('listed');
  });
});

// ── the curated `pairs-with` edge parser ────────────────────────────────────
//
// Also extracted (lib/skill-pairs-with.ts) so the relay's catalog page reads a
// curated edge by the same law lib/skill-graft.ts does. Same reasoning: two
// parsers that disagreed about where the field lives would render two different
// graphs from one catalog.
describe('extractPairsWithTargets', () => {
  test('reads both frontmatter locations and both entry shapes', () => {
    const targets = extractPairsWithTargets(
      {
        'pairs-with': [{ skill: 'top-level-object', reason: 'ignored' }, 'top-level-bare'],
        metadata: { 'pairs-with': [{ skill: 'nested-object' }, 'nested-bare'] },
      },
      'self',
    );
    expect(targets).toEqual(['top-level-object', 'top-level-bare', 'nested-object', 'nested-bare']);
  });

  test('drops self-edges, blanks and non-string ids without throwing', () => {
    expect(extractPairsWithTargets({ 'pairs-with': ['self', '  ', 42, null, { reason: 'no skill' }, ' ok '] }, 'self'))
      .toEqual(['ok']);
  });

  test('returns [] for frontmatter that declares nothing', () => {
    expect(extractPairsWithTargets({}, 'self')).toEqual([]);
    expect(extractPairsWithTargets({ 'pairs-with': 'not-a-list' }, 'self')).toEqual([]);
    expect(extractPairsWithTargets({ metadata: 'not-an-object' }, 'self')).toEqual([]);
  });
});
