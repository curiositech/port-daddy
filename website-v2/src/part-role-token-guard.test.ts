import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/check-part-role-tokens.mjs walks an indirection that no compiler
// sees: whitepaper/textbook.json gives a part a `slug` and a `webRoleAlias`,
// the generated region of src/styles/tokens.roles.css turns that into
// --part-<slug> / --part-<slug>-on, and src/components/swiss/Slab.tsx paints
// var(--part-<slug>) derived from the slug alone. Every break in that chain
// fails SILENTLY in a browser -- CSS drops a declaration it cannot resolve,
// the slab paints nothing, and the build stays green.
//
// So the checker's value is entirely in what it REJECTS, and a checker whose
// rejections live only in a transcript is a checker nobody can re-run. This
// file is that transcript, mechanized: each test builds a copy of the real
// token tree in a temp directory, breaks exactly one thing, runs the real
// script against it, and asserts the message names the real problem. The
// unmutated fixture is asserted green first, so a test that fires for some
// unrelated reason is caught rather than counted as a pass.
//
// The fixture is built from the COMMITTED files, not from hand-written CSS:
// a synthetic stylesheet would exercise a parser the site does not have.
//
// One constraint this file has to respect: check 5 scans every .ts/.tsx under
// src/, this file included, for a literal slug on a Slab element. Written out
// plainly, the fixtures and expectations below would be read as real usages
// and fail the real tree -- which they did, the first time this ran. So the
// opening tag is assembled from SLAB_OPEN rather than typed, here and in the
// prose. That is a property of the checker worth knowing about, not a
// workaround: a page is scanned whether or not it is a page.

const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = join(here, '..')
const repoRoot = join(websiteRoot, '..')
const CHECKER = join(websiteRoot, 'scripts', 'check-part-role-tokens.mjs')

const REAL = {
  textbook: join(repoRoot, 'whitepaper', 'textbook.json'),
  source: join(websiteRoot, 'src', 'styles', 'tokens.source.css'),
  semantic: join(websiteRoot, 'src', 'styles', 'tokens.semantic.css'),
  roles: join(websiteRoot, 'src', 'styles', 'tokens.roles.css'),
}

/** See the header: typing this tag out would make this file a real usage. */
const SLAB_OPEN = `<${'Slab'}`

type Part = { slug: string; webRoleAlias: { bg: string; on: string } }
type Textbook = { parts: Part[] }

/** The tree the checker reads, as strings, before it is written to disk. */
type Tree = {
  textbook: Textbook
  source: string
  semantic: string
  roles: string
  /** One .tsx under src/, standing in for every surface that renders a Slab. */
  tsx: string
}

function pristine(): Tree {
  const textbook = JSON.parse(readFileSync(REAL.textbook, 'utf8')) as Textbook
  return {
    textbook,
    source: readFileSync(REAL.source, 'utf8'),
    semantic: readFileSync(REAL.semantic, 'utf8'),
    roles: readFileSync(REAL.roles, 'utf8'),
    // The real page renders a Slab with slug={part.slug}, which the checker
    // cannot and does not try to resolve. It checks LITERAL slugs, so the
    // fixture carries literals -- one per part, which is the shape a converted
    // page takes once a slab is written by hand rather than mapped over parts.
    tsx: `export const Page = () => (<>\n${textbook.parts
      .map((p) => `  ${SLAB_OPEN} slug="${p.slug}">${p.slug}</Slab>`)
      .join('\n')}\n</>)\n`,
  }
}

/**
 * Write `tree` into a temp repo laid out the way the checker resolves paths
 * (it takes the repo root as its own directory's grandparent), copy the REAL
 * script in, run it, and return its exit code and combined output.
 */
function runOn(tree: Tree): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pd-part-roles-'))
  try {
    mkdirSync(join(dir, 'whitepaper'), { recursive: true })
    mkdirSync(join(dir, 'website-v2', 'scripts'), { recursive: true })
    mkdirSync(join(dir, 'website-v2', 'src', 'styles'), { recursive: true })
    mkdirSync(join(dir, 'website-v2', 'src', 'pages'), { recursive: true })
    writeFileSync(join(dir, 'whitepaper', 'textbook.json'), JSON.stringify(tree.textbook, null, 2))
    writeFileSync(join(dir, 'website-v2', 'src', 'styles', 'tokens.source.css'), tree.source)
    writeFileSync(join(dir, 'website-v2', 'src', 'styles', 'tokens.semantic.css'), tree.semantic)
    writeFileSync(join(dir, 'website-v2', 'src', 'styles', 'tokens.roles.css'), tree.roles)
    writeFileSync(join(dir, 'website-v2', 'src', 'pages', 'fixture-page.tsx'), tree.tsx)
    const script = join(dir, 'website-v2', 'scripts', 'check-part-role-tokens.mjs')
    copyFileSync(CHECKER, script)
    const r = spawnSync('node', [script], { encoding: 'utf8' })
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A substitution that did not substitute would make a mutation test a no-op. */
function replaceOnce(text: string, from: string | RegExp, to: string): string {
  const next = text.replace(from, to)
  expect(next, `the mutation did not apply: ${String(from)}`).not.toBe(text)
  return next
}

/**
 * Delete a custom property from ONE theme block of tokens.semantic.css.
 *
 * The file is `:root, [data-theme='light'] { ... }` then `[data-theme='dark']
 * { ... }`, so the split point is the dark selector. Matching on the block
 * rather than on a committed hex keeps the mutation meaningful after a palette
 * change: it says "remove this name from this theme", not "remove #666a00".
 */
function dropFromTheme(semantic: string, name: string, theme: 'light' | 'dark'): string {
  const marker = "[data-theme='dark']"
  const at = semantic.indexOf(marker)
  expect(at, 'tokens.semantic.css no longer has a dark block to split on').toBeGreaterThan(0)
  const head = semantic.slice(0, at)
  const tail = semantic.slice(at)
  const decl = new RegExp(`^[ \\t]*${name}:[^;]*;.*\\n`, 'm')
  return theme === 'light'
    ? replaceOnce(head, decl, '') + tail
    : head + replaceOnce(tail, decl, '')
}

/** Repoint a part's alias in textbook.json AND in the CSS generated from it. */
function repointAlias(tree: Tree, slug: string, side: 'bg' | 'on', token: string): Tree {
  const part = tree.textbook.parts.find((p) => p.slug === slug)
  expect(part, `no part "${slug}" in textbook.json`).toBeDefined()
  const was = part!.webRoleAlias[side]
  part!.webRoleAlias[side] = token
  const roleName = side === 'bg' ? `--part-${slug}` : `--part-${slug}-on`
  tree.roles = replaceOnce(tree.roles, `${roleName}: var(${was});`, `${roleName}: var(${token});`)
  return tree
}

// A slug that is not a part, used wherever a rename or a bad slab is needed.
const ABSENT = 'markets'

describe('check-part-role-tokens.mjs: the real tree', () => {
  test('passes, and says what it proved', () => {
    const r = spawnSync('node', [CHECKER], { cwd: websiteRoot, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(out).toMatch(/part role tokens resolve: \d+ parts, \d+ role tokens/)
    expect(r.status).toBe(0)
  })

  test('ABSENT is genuinely not a part, so every mutation below using it is real', () => {
    const slugs = pristine().textbook.parts.map((p) => p.slug)
    expect(slugs.length).toBeGreaterThan(0)
    expect(slugs).not.toContain(ABSENT)
  })
})

describe('check-part-role-tokens.mjs: the fixture harness itself', () => {
  test('the unmutated fixture is green — so a failure below is the mutation, not the rig', () => {
    const { code, out } = runOn(pristine())
    expect(out).toContain('part role tokens resolve')
    expect(code).toBe(0)
  })
})

describe('check-part-role-tokens.mjs: each break is named', () => {
  // 1. The mirror goes stale: the data moves, the generated CSS does not.
  test('a slug renamed in textbook.json without regenerating the CSS', () => {
    const tree = pristine()
    tree.textbook.parts[3].slug = ABSENT
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      `part "${ABSENT}" (whitepaper/textbook.json) has no --part-${ABSENT} — Slab would paint var(--part-${ABSENT}), which resolves to nothing`,
    )
    // and the other half of the stale mirror: a pair for a part that is gone
    expect(out).toContain('--part-market names part "market", which is not a part in whitepaper/textbook.json')
  })

  // 2. A typo that still looks like a custom property. This is the failure the
  //    generator's shape validation cannot see: --story-golld is well-formed.
  test('an alias naming a token no file defines', () => {
    const { code, out } = runOn(repointAlias(pristine(), 'market', 'bg', '--story-golld'))
    expect(code).toBe(1)
    expect(out).toContain('--part-market aliases --story-golld, which no token file defines')
    expect(out).toContain('webRoleAlias.bg names --story-golld, which no token file defines')
  })

  // 3. THE ONE THAT SHIPPED. tokens.source.css defines every name once, in a
  //    plain :root, so a source-layer token is trivially "defined in both
  //    themes" and a naive presence check passes it. --radnika-opsz-body is the
  //    unitless number 17: as a background it is invalid, CSS drops the
  //    declaration, and the slab paints nothing while every check stays green.
  test('an alias pointing at a source-layer token, which is theme-complete for free', () => {
    const tree = pristine()
    // The fixture is honest: this really is a source-layer name, and really is
    // not a colour. If either stops being true the test must be rewritten, not
    // quietly keep passing for a different reason.
    expect(tree.source).toMatch(/^\s*--radnika-opsz-body:\s*\d+\s*;/m)
    expect(tree.semantic).not.toContain('--radnika-opsz-body')
    // And it satisfies the naive rule the check used to apply -- defined, in a
    // block that is neither light-only nor dark-only -- which is why it passed.
    expect(tree.source).toMatch(/:root\s*\{[\s\S]*--radnika-opsz-body/)

    const { code, out } = runOn(repointAlias(tree, 'market', 'bg', '--radnika-opsz-body'))
    expect(code).toBe(1)
    expect(out).toContain(
      '--part-market aliases --radnika-opsz-body, defined in website-v2/src/styles/tokens.source.css'
      + ' but not in both themes of website-v2/src/styles/tokens.semantic.css',
    )
    expect(out).toContain('a part role must alias the semantic layer')
  })

  // 4 and 5. A slab renders in both themes, so a one-theme token is a hole in
  //    the other one. Both directions, because the two branches are separate
  //    code and a copy-paste between them would go unnoticed.
  test('an alias target present in the light theme only', () => {
    const tree = pristine()
    tree.semantic = dropFromTheme(tree.semantic, '--story-gold', 'dark')
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      '--part-market aliases --story-gold, defined only in the light theme — a slab renders in both',
    )
  })

  test('an alias target present in the dark theme only', () => {
    const tree = pristine()
    tree.semantic = dropFromTheme(tree.semantic, '--story-gold', 'light')
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      '--part-market aliases --story-gold, defined only in the dark theme — a slab renders in both',
    )
  })

  // 6. Half a pair. The block paints, the numeral on it does not get its
  //    paper-coloured ink, and the page prints default ink on the part colour.
  test('a --part-<slug>-on that is missing', () => {
    const tree = pristine()
    tree.roles = replaceOnce(tree.roles, /^[ \t]*--part-market-on:[^;]*;.*\n/m, '')
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      'part "market" (whitepaper/textbook.json) has no --part-market-on — Slab would paint var(--part-market-on), which resolves to nothing',
    )
  })

  // 7. The consuming end of the indirection: a literal slug in a component.
  test('a Slab element whose literal slug is not a part', () => {
    const tree = pristine()
    tree.tsx = replaceOnce(tree.tsx, 'slug="market"', `slug="${ABSENT}"`)
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      `website-v2/src/pages/fixture-page.tsx: ${SLAB_OPEN} slug="${ABSENT}"> — no such part in whitepaper/textbook.json`,
    )
  })

  // 8. Two parts sharing a slug collapse to one --part-<slug> pair, so one of
  //    them is silently repainted in the other's colour.
  test('a duplicate part slug', () => {
    const tree = pristine()
    const victim = tree.textbook.parts[3]
    const taken = tree.textbook.parts[2].slug
    expect(victim.slug).not.toBe(taken)
    victim.slug = taken
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    // The pair for the slug that no longer exists is now orphaned, and the
    // duplicated slug's pair no longer matches what the second part asks for.
    expect(out).toContain('--part-market names part "market", which is not a part in whitepaper/textbook.json')
    expect(out).toMatch(/webRoleAlias\.bg names --story-gold, but website-v2\/src\/styles\/tokens\.roles\.css has --part-person: var\(--story-violet\)/)
  })

  // 9. The generated region hand-edited away from its source of record. Caught
  //    here rather than only by --check-shared in a different workflow.
  test('tokens.roles.css hand-edited to disagree with textbook.json', () => {
    const tree = pristine()
    tree.roles = replaceOnce(tree.roles, '--part-market: var(--story-gold);', '--part-market: var(--story-violet);')
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      'whitepaper/textbook.json: part "market": webRoleAlias.bg names --story-gold,'
      + ' but website-v2/src/styles/tokens.roles.css has --part-market: var(--story-violet)',
    )
    expect(out).toContain('regenerate with node scripts/generate-mega-whitepaper.mjs --sync-shared')
  })

  // 10 and 11. The source of record itself, on its own terms: a part with no
  //    alias at all, and an alias that is not a custom-property name.
  test('a part whose webRoleAlias is gone', () => {
    const tree = pristine()
    delete (tree.textbook.parts[0] as Partial<Part>).webRoleAlias
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      'whitepaper/textbook.json: part "machine": webRoleAlias must be an object with bg and on',
    )
  })

  test('a webRoleAlias side given a colour instead of a token name', () => {
    const tree = pristine()
    tree.textbook.parts[0].webRoleAlias.bg = '#4a6cf7'
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain(
      'webRoleAlias.bg is "#4a6cf7", not a CSS custom-property name like "--brand-primary"',
    )
  })

  // 12. A colour literal in the role layer is a source-layer value wearing a
  //     role name: it cannot follow the theme, so the slab is wrong in one of
  //     the two themes rather than missing in both.
  test('a role token carrying a literal instead of aliasing a token', () => {
    const tree = pristine()
    tree.roles = replaceOnce(tree.roles, '--part-market: var(--story-gold);', '--part-market: #666a00;')
    const { code, out } = runOn(tree)
    expect(code).toBe(1)
    expect(out).toContain('--part-market: #666a00 — a part role must alias a semantic token, not carry a literal')
  })
})
