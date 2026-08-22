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
const { formatVisibilityMarker, formatOwnershipLine } = await import('../../cli/commands/seamanship.js');

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
  test('private renders no marker at all — the unmarked, common-case default', () => {
    expect(formatVisibilityMarker('private')).toBe('');
  });

  test('listed and public each render a compact bracket marker', () => {
    expect(formatVisibilityMarker('listed')).toBe('  [listed]');
    expect(formatVisibilityMarker('public')).toBe('  [public]');
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
