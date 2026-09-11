import { describe, expect, test, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// check-swiss-normalization.mjs is Wave 0 of the Swiss rollout: a RATCHET
// (not a gate) over three rules — literal colour values, radius, and
// elevation/blur/gradient — scoped to website-v2/src/{components,pages}.
// These tests prove the things a ratchet can quietly get wrong: that each
// rule only fires on its own violation, that the named false-positive
// suppressions actually suppress, that the escape hatch requires a real
// reason rather than becoming a silent mute, and — the one that matters —
// that the three ratchet failure conditions (new drift, worsening, stale)
// actually fire, with fixtures written to a temp dir rather than the real
// tree. The final test is the regression that proves the committed
// baseline was generated honestly: the real repo passes as committed.

const here = fileURLToPath(new URL('.', import.meta.url))
const websiteRoot = join(here, '..')
const guard = join(websiteRoot, 'scripts', 'check-swiss-normalization.mjs')

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeFixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-swiss-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'src', 'components'), { recursive: true })
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true })
  return dir
}

function writeFixture(root: string, relPath: string, contents: string) {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

function writeRatchet(root: string, data: unknown) {
  const path = join(root, 'ratchet.json')
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}

const EMPTY_RATCHET = { $comment: 'test', literal: {}, radius: {}, flat: {} }

function run(root: string, ratchetPath: string) {
  const r = spawnSync('node', [guard, '--root', root, '--ratchet', ratchetPath], {
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('check-swiss-normalization.mjs — rule detection', () => {
  test('R1 literal fires on a hex colour and not on radius/flat', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div style={{ color: '#ff0000' }} />\n`)
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/\[literal\]\s+#ff0000/)
    expect(out).not.toMatch(/\[radius\]/)
    expect(out).not.toMatch(/\[flat\]/)
  })

  test('R1 literal fires on rgb()/hsl()-family functions', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Foo.tsx',
      `export const Foo = () => <div style={{ background: 'oklch(0.7 0.1 200)' }} />\n`
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/\[literal\]\s+oklch\(/)
  })

  test('R2 radius fires on a rounded- class and not on literal/flat', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div className="rounded-lg" />\n`)
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/\[radius\]\s+rounded-lg/)
    expect(out).not.toMatch(/\[literal\]/)
    expect(out).not.toMatch(/\[flat\]/)
  })

  test('R2 radius fires on bare `rounded` as a class token, not as an identifier', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Foo.tsx',
      [
        `export const Foo = () => <div className="rounded" />`,
        `const surroundedValue = 3 // an identifier containing "rounded" must not fire`,
        `// a comment that says rounded corners must not fire either`,
      ].join('\n') + '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    const radiusHits = out.split('\n').filter((l) => l.includes('[radius]'))
    expect(radiusHits.length).toBe(1)
    expect(radiusHits[0]).toMatch(/:1\s/) // only the className line (line 1) fired
  })

  test('R3 flat fires on a shadow- class and not on literal/radius', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div className="shadow-lg" />\n`)
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/\[flat\]\s+shadow-lg/)
    expect(out).not.toMatch(/\[literal\]/)
    expect(out).not.toMatch(/\[radius\]/)
  })

  test('R3 flat fires on box-shadow, backdrop-blur, bg-gradient- and *-gradient(', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Foo.css',
      [
        '.a { box-shadow: 0 2px 4px rgba(0,0,0,.2); }',
        '.b { backdrop-filter: none; }',
      ].join('\n') + '\n'
    )
    writeFixture(
      root,
      'src/components/Bar.tsx',
      [
        `export const Bar = () => <div className="backdrop-blur-sm bg-gradient-to-r" />`,
        `const style = { background: 'linear-gradient(to right, red, blue)' }`,
      ].join('\n') + '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/\[flat\]\s+box-shadow: 0 2px 4px rgba\(0,0,0,\.2\)/)
    expect(out).toMatch(/\[flat\]\s+backdrop-blur-sm/)
    expect(out).toMatch(/\[flat\]\s+bg-gradient-to-r/)
    expect(out).toMatch(/\[flat\]\s+linear-gradient\(/)
  })
})

describe('check-swiss-normalization.mjs — false-positive suppression', () => {
  test('#abc in an href is not a colour; #aabbcc in a style is', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Foo.tsx',
      [
        `export const Foo = () => (`,
        `  <a href="#abc" style={{ color: '#aabbcc' }}>link</a>`,
        `)`,
      ].join('\n') + '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).not.toContain('#abc')
    expect(out).toMatch(/\[literal\]\s+#aabbcc/)
  })

  test('a 6-hex colour inside href/to/id/aria-controls is suppressed', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/pages/Foo.tsx',
      [
        `export const Foo = () => (`,
        `  <a href="/docs#aabbcc" id="#aabbcc" aria-controls="#aabbcc" to="/x#aabbcc">x</a>`,
        `)`,
      ].join('\n') + '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code } = run(root, ratchet)
    // All four are anchors/fragment identifiers, not colours.
    expect(code).toBe(0)
  })

  test('shadow-none and border-radius: 0 do not fire', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div className="shadow-none" />\n`)
    writeFixture(root, 'src/components/foo.css', `.a { border-radius: 0; }\n.b { box-shadow: none; }\n`)
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(0)
    expect(out).not.toMatch(/\[radius\]/)
    expect(out).not.toMatch(/\[flat\]/)
  })
})

describe('check-swiss-normalization.mjs — the escape hatch', () => {
  test('a well-formed swiss-allow with a real reason suppresses the violation', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Avatar.tsx',
      [
        `// swiss-allow: radius — avatar is a system primitive, BRAND.md §Hard borders`,
        `export const Avatar = () => <img className="rounded-full" />`,
      ].join('\n') + '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(0)
    expect(out).not.toMatch(/\[radius\]/)
  })

  test('a well-formed swiss-allow on the same line also suppresses', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Avatar.tsx',
      `export const Avatar = () => <img className="rounded-full" /> // swiss-allow: radius — avatar is a system primitive\n`
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(0)
    expect(out).not.toMatch(/\[radius\]/)
  })

  test('a bare swiss-allow with no reason does not suppress, and is itself a failure', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Avatar.tsx',
      [`// swiss-allow`, `export const Avatar = () => <img className="rounded-full" />`].join('\n') + '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/malformed swiss-allow/)
    // and the violation itself is NOT suppressed — it still shows up as new drift
    expect(out).toMatch(/\[radius\]\s+rounded-full/)
  })

  test('a swiss-allow with a reason under 12 characters does not suppress', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Avatar.tsx',
      [`// swiss-allow: radius — short`, `export const Avatar = () => <img className="rounded-full" />`].join('\n') +
        '\n'
    )
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/malformed swiss-allow/)
  })
})

describe('check-swiss-normalization.mjs — the ratchet', () => {
  test('worsening a listed file fails', () => {
    const root = makeFixtureRoot()
    writeFixture(
      root,
      'src/components/Foo.tsx',
      [`export const Foo = () => (`, `  <div className="rounded-lg" />`, `  <div className="rounded-full" />`, `)`].join(
        '\n'
      ) + '\n'
    )
    const ratchet = writeRatchet(root, {
      ...EMPTY_RATCHET,
      radius: { 'src/components/Foo.tsx': 1 },
    })
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/WORSENING\s+src\/components\/Foo\.tsx\s+\[radius\]\s+was 1, now 2/)
  })

  test('cleaning a listed file without updating the ratchet fails with the stale message', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div />\n`)
    const ratchet = writeRatchet(root, {
      ...EMPTY_RATCHET,
      radius: { 'src/components/Foo.tsx': 2 },
    })
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toContain(
      'ratchet is stale: src/components/Foo.tsx is now 0 (was 2); update website-v2/scripts/swiss-normalization-ratchet.json'
    )
  })

  test('cleaning it AND updating the ratchet passes', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div />\n`)
    const ratchet = writeRatchet(root, EMPTY_RATCHET) // no entry for Foo.tsx at all now
    const { code } = run(root, ratchet)
    expect(code).toBe(0)
  })

  test('a deleted, still-listed file fails as stale', () => {
    const root = makeFixtureRoot()
    // Foo.tsx is never written — the ratchet references a file that doesn't exist.
    const ratchet = writeRatchet(root, {
      ...EMPTY_RATCHET,
      radius: { 'src/components/Foo.tsx': 2 },
    })
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toContain('ratchet is stale: src/components/Foo.tsx is now 0 (was 2)')
  })

  test('a new file with a violation not in the ratchet fails as new drift', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Fresh.tsx', `export const Fresh = () => <div className="rounded-lg" />\n`)
    const ratchet = writeRatchet(root, EMPTY_RATCHET)
    const { code, out } = run(root, ratchet)
    expect(code).toBe(1)
    expect(out).toMatch(/NEW DRIFT\s+src\/components\/Fresh\.tsx:1\s+\[radius\]\s+rounded-lg/)
  })

  test('a file matching its ratchet entry exactly passes', () => {
    const root = makeFixtureRoot()
    writeFixture(root, 'src/components/Foo.tsx', `export const Foo = () => <div className="rounded-lg" />\n`)
    const ratchet = writeRatchet(root, {
      ...EMPTY_RATCHET,
      radius: { 'src/components/Foo.tsx': 1 },
    })
    const { code } = run(root, ratchet)
    expect(code).toBe(0)
  })
})

describe('check-swiss-normalization.mjs — the real tree', () => {
  test('passes the real repo tree with the committed ratchet', () => {
    const r = spawnSync('node', [guard], { cwd: websiteRoot, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(out).toContain('in-scope files scanned')
    expect(r.status).toBe(0)
  })
})
