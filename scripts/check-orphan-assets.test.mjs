/**
 * check-orphan-assets.test.mjs — MUTATION tests for scripts/check-orphan-assets.mjs.
 *
 * This repo's recurring defect is validation that checks shape but not existence, and
 * mechanisms that report success while not doing their job. A reference checker is
 * unusually prone to it: the trivial implementation that marks everything referenced
 * passes every "it runs green" test forever. So these tests prove BOTH directions on a
 * sandbox tree built from the shapes this repository actually uses:
 *
 *   1. an unreferenced asset IS named;
 *   2. a referenced asset is NOT named — in particular one reachable only through a
 *      JS template literal and one reachable only through a LaTeX macro parameter,
 *      which is how the Swiss plates are printed and which a literal grep misses;
 *   3. removing the last reference to a referenced asset makes it appear;
 *   4. the unmutated tree is green.
 *
 * Plus the allow-list's own contract: an entry with no reason fails the check, because
 * a list of bare paths is the failure mode the list exists to prevent.
 *
 * Run: node --test scripts/check-orphan-assets.test.mjs
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'check-orphan-assets.mjs')

let SANDBOX

/** Write a file (creating parents) inside the sandbox. */
function put(rel, body) {
  const abs = join(SANDBOX, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

/** A 1x1 GIF, so the "assets" are real bytes with a real size. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

function run(...args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, '--root', SANDBOX, ...args], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' }
  }
}

function json(...args) {
  const { stdout } = run('--json', ...args)
  return JSON.parse(stdout)
}

/** Rebuild the sandbox from scratch. Every test mutates and then restores by calling
 *  this, so no test can leak a mutation into the next one. */
function seed() {
  if (SANDBOX) rmSync(SANDBOX, { recursive: true, force: true })
  SANDBOX = mkdtempSync(join(tmpdir(), 'orphan-assets-'))
  mkdirSync(join(SANDBOX, 'scripts'), { recursive: true })

  // ── Assets, in the trees the checker scopes itself to ──────────────────────
  put('website-v2/public/whitepaper/plates/swiss/chapter-anchor.jpg', PIXEL)   // TeX macro only
  put('website-v2/public/whitepaper/plates/swiss/chapter-bonded.jpg', PIXEL)   // TeX macro only
  put('website-v2/public/img/orphan-render.jpg', PIXEL)                        // nothing
  put('website-v2/public/whitepaper/plates/chapter-anchor.jpg', PIXEL)         // JS template literal only
  put('website-v2/public/whitepaper/plates/jacket.jpg', PIXEL)                 // plain literal
  put('website-v2/public/whitepaper/figures/fig-live.pdf', PIXEL)              // \input, no extension
  put('website-v2/public/img/manifesto/collision.webp', PIXEL)                 // plain literal
  put('website-v2/public/img/manifesto/collision-dark.webp', PIXEL)            // derived at runtime
  put('docs/pr-assets/pr-1/evidence.png', PIXEL)                               // nothing
  // Figure fragments: .tex inside a figures/ directory is an asset, reached by \input.
  put('whitepaper/figures/fig-drawn.tex', '% a live fragment\n')               // \input by a chapter
  put('whitepaper/figures/pd-language-swiss.tex', '% edition override\n')      // \input via \pdedition
  put('whitepaper/single-writer-kernel.tex',                                   // an ENTRY POINT, never an asset
    '\\input{figures/fig-drawn}\n\\input{figures/pd-language}\n')
  put('whitepaper/figures/pd-language.tex',
    '\\ifdefined\\pdedition\\input{figures/pd-language-\\pdedition}\\fi\n')

  // ── References, each in the shape the real repo uses ───────────────────────
  // A LaTeX macro parameter — the Swiss plate file's actual mechanism.
  put(
    'website-v2/public/whitepaper/mega-swiss-plates.tex',
    '\\newcommand{\\pdchapterplate}[2]{%\n' +
      '  \\IfFileExists{plates/swiss/chapter-#1.jpg}{%\n' +
      '    \\includegraphics[width=#2]{plates/swiss/chapter-#1.jpg}}{}}\n' +
      '\\includegraphics{figures/fig-live}\n',
  )
  // A JS template literal — how the site builds a plate path from record data.
  put(
    'website-v2/src/bookPlates.ts',
    "export const chapterPlate = (prefix: string) => `/whitepaper/plates/chapter-${prefix}.jpg`\n",
  )
  // A plain literal in a component.
  put(
    'website-v2/src/LibraryBanner.tsx',
    'export const Banner = () => <img src="/whitepaper/plates/jacket.jpg" alt="" />\n',
  )
  // A light source whose dark sibling is derived at runtime by toDarkSrc().
  put(
    'website-v2/src/Manifesto.tsx',
    'export const Art = () => <ThemedImage src="/img/manifesto/collision.webp" alt="" />\n',
  )
  put(
    'website-v2/src/components/site/ThemedImageSrc.ts',
    'export function toDarkSrc(src: string) { return src.replace(/\\.(\\w+)$/, "-dark.$1") }\n',
  )
  put('scripts/orphan-assets-allow.json', JSON.stringify({ allow: [] }, null, 2))

  execFileSync('git', ['init', '-q'], { cwd: SANDBOX })
  execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
}

/** Orphan paths, as a Set, from the sandbox's current contents. */
function orphans() {
  // git ls-files drives the scan, so newly written files must be staged first.
  execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
  return new Set(json().orphans.map((o) => o.path))
}

describe('check-orphan-assets', () => {
  before(seed)
  after(() => rmSync(SANDBOX, { recursive: true, force: true }))

  // ── 4. green on the unmutated tree ──────────────────────────────────────────
  test('the unmutated tree names exactly the assets nothing points at', () => {
    assert.deepEqual(
      [...orphans()].sort(),
      [
        'docs/pr-assets/pr-1/evidence.png',
        'website-v2/public/img/orphan-render.jpg',
      ].sort(),
    )
  })

  // ── 2. referenced assets are NOT named ──────────────────────────────────────
  test('a plate reachable ONLY through a LaTeX macro parameter is not an orphan', () => {
    const o = orphans()
    assert.ok(!o.has('website-v2/public/whitepaper/plates/swiss/chapter-anchor.jpg'))
    assert.ok(!o.has('website-v2/public/whitepaper/plates/swiss/chapter-bonded.jpg'))
    const why = run('--why', 'website-v2/public/whitepaper/plates/swiss/chapter-anchor.jpg').stdout
    assert.match(why, /\[pattern\] plates\/swiss\/chapter-#1\.jpg/)
  })

  test('a plate reachable ONLY through a JS template literal is not an orphan', () => {
    const o = orphans()
    assert.ok(!o.has('website-v2/public/whitepaper/plates/chapter-anchor.jpg'))
    const why = run('--why', 'website-v2/public/whitepaper/plates/chapter-anchor.jpg').stdout
    assert.match(why, /\[pattern\] whitepaper\/plates\/chapter-\$\{prefix\}\.jpg/)
  })

  test('an extension-less \\input and a runtime-derived dark sibling are not orphans', () => {
    const o = orphans()
    assert.ok(!o.has('website-v2/public/whitepaper/figures/fig-live.pdf'))
    assert.ok(!o.has('website-v2/public/img/manifesto/collision-dark.webp'))
  })

  // ── 1. a genuinely unreferenced asset IS named ──────────────────────────────
  test('adding an unreferenced asset makes the check name it', () => {
    put('website-v2/public/whitepaper/plates/swiss/mutant-plate.jpg', PIXEL)
    try {
      assert.ok(orphans().has('website-v2/public/whitepaper/plates/swiss/mutant-plate.jpg'))
      const { code, stderr } = run('--check')
      assert.equal(code, 1, '--check must fail on an orphan inside a deny-list directory')
      assert.match(stderr, /mutant-plate\.jpg/)
    } finally {
      seed()
    }
  })

  // ── 3. removing the last reference makes a live asset appear ────────────────
  test('deleting the ONLY template-literal reference turns its plate into an orphan', () => {
    rmSync(join(SANDBOX, 'website-v2/src/bookPlates.ts'))
    try {
      assert.ok(orphans().has('website-v2/public/whitepaper/plates/chapter-anchor.jpg'))
    } finally {
      seed()
    }
  })

  test('deleting the ONLY LaTeX macro reference turns both Swiss plates into orphans', () => {
    rmSync(join(SANDBOX, 'website-v2/public/whitepaper/mega-swiss-plates.tex'))
    try {
      const o = orphans()
      assert.ok(o.has('website-v2/public/whitepaper/plates/swiss/chapter-anchor.jpg'))
      assert.ok(o.has('website-v2/public/whitepaper/plates/swiss/chapter-bonded.jpg'))
      assert.ok(o.has('website-v2/public/whitepaper/figures/fig-live.pdf'))
    } finally {
      seed()
    }
  })

  test('deleting the light original turns its runtime-derived dark sibling into an orphan', () => {
    rmSync(join(SANDBOX, 'website-v2/src/Manifesto.tsx'))
    try {
      const o = orphans()
      assert.ok(o.has('website-v2/public/img/manifesto/collision.webp'))
      assert.ok(o.has('website-v2/public/img/manifesto/collision-dark.webp'),
        'the dark sibling inherits reachability, so it must fall with the light original')
    } finally {
      seed()
    }
  })

  // ── The gate's own edges ────────────────────────────────────────────────────
  test('an interpolation with no literal stem does not mark every file referenced', () => {
    put('website-v2/src/Broad.tsx', 'const any = `${slug}.jpg`\n')
    try {
      assert.ok(orphans().has('website-v2/public/img/orphan-render.jpg'),
        '`${slug}.jpg` must not be compiled into "any jpg anywhere"')
      assert.match(run().stdout, /too broad to match on/)
    } finally {
      seed()
    }
  })

  test('an allow-list entry suppresses the gate but the report still lists the file', () => {
    put('website-v2/public/whitepaper/plates/swiss/mutant-plate.jpg', PIXEL)
    put('scripts/orphan-assets-allow.json', JSON.stringify({
      allow: [{
        path: 'website-v2/public/whitepaper/plates/swiss/mutant-plate.jpg',
        reason: 'a deliberate spare render kept for the next edition',
      }],
    }))
    try {
      execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
      assert.equal(run('--check').code, 0)
      assert.match(run().stdout, /mutant-plate\.jpg.*allowed: a deliberate spare render/)
    } finally {
      seed()
    }
  })

  test('an allow-list entry without a reason fails the check itself', () => {
    put('scripts/orphan-assets-allow.json', JSON.stringify({
      allow: ['website-v2/public/img/orphan-render.jpg'],
    }))
    try {
      execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
      const { code, stderr } = run()
      assert.equal(code, 1)
      assert.match(stderr, /bare path/)
    } finally {
      seed()
    }
  })

  test('an allow-list "reason" that is not a real sentence fails the check itself', () => {
    put('scripts/orphan-assets-allow.json', JSON.stringify({
      allow: [{ path: 'website-v2/public/img/orphan-render.jpg', reason: 'keep' }],
    }))
    try {
      execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
      const { code, stderr } = run()
      assert.equal(code, 1)
      assert.match(stderr, /must be a real sentence/)
    } finally {
      seed()
    }
  })

  // ── Figure fragments and the deny directory's stricter contract ─────────────
  test('a figure fragment reached only through a LaTeX macro-expanded \\input is not an orphan', () => {
    const o = orphans()
    assert.ok(!o.has('whitepaper/figures/pd-language-swiss.tex'),
      '\\input{figures/pd-language-\\pdedition} must be read as a wildcard, not a literal')
    assert.ok(!o.has('whitepaper/figures/fig-drawn.tex'))
    // The chapter source itself is an entry point, compiled directly, and must never
    // be counted as an asset — nothing in the repo references it by path.
    assert.ok(!o.has('whitepaper/single-writer-kernel.tex'))
  })

  test('deleting the chapter that \\inputs a fragment turns the fragment into an orphan', () => {
    rmSync(join(SANDBOX, 'whitepaper/single-writer-kernel.tex'))
    try {
      const o = orphans()
      assert.ok(o.has('whitepaper/figures/fig-drawn.tex'))
      const { code, stderr } = run('--check')
      assert.equal(code, 1)
      assert.match(stderr, /fig-drawn\.tex/)
    } finally {
      seed()
    }
  })

  test('a bare directory mention does NOT vouch for files inside a deny directory', () => {
    put('website-v2/public/whitepaper/plates/swiss/unused-render.jpg', PIXEL)
    // Prose naming the directory — the shape a changelog entry takes.
    put('changelog.d/plates.md',
      'Thirteen plates live under `website-v2/public/whitepaper/plates/swiss/`.\n')
    try {
      assert.ok(orphans().has('website-v2/public/whitepaper/plates/swiss/unused-render.jpg'),
        'naming the directory must not vouch for every plate ever dropped into it')
      assert.equal(run('--check').code, 1)
    } finally {
      seed()
    }
  })

  test('a bare directory mention DOES vouch for files outside the deny directories', () => {
    put('docs/evidence/2026/shot.png', PIXEL)
    put('docs/evidence/README.md', 'Frames are written to `docs/evidence/2026` by the capture script.\n')
    try {
      assert.ok(!orphans().has('docs/evidence/2026/shot.png'))
    } finally {
      seed()
    }
  })

  // ── The island rule ─────────────────────────────────────────────────────────
  test('an asset cited only by a dead sidecar beside it is reported as an island', () => {
    put('docs/artifacts/dead-set/proof-manifest.md', 'See `page-001.png` for the render.\n')
    put('docs/artifacts/dead-set/page-001.png', PIXEL)
    try {
      execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
      const j = json()
      assert.ok(!j.orphans.some((o) => o.path === 'docs/artifacts/dead-set/page-001.png'),
        'it IS referenced — by the manifest — so it is not an orphan')
      assert.ok(j.siblingOnly.some((s) => s.path === 'docs/artifacts/dead-set/page-001.png'),
        'but nothing reaches the manifest either, so it is an island')
    } finally {
      seed()
    }
  })

  test('an island is still an island when the dead sidecar lives in another tree', () => {
    // The #10171 shape exactly: illuminated-mega-volume/proof-manifest.md was the
    // sole referrer of art committed under website-v2/public/whitepaper/art/.
    put('docs/artifacts/dead-set/proof-manifest.md',
      'Rendered from `website-v2/public/whitepaper/art/old/jacket.png`.\n')
    put('website-v2/public/whitepaper/art/old/jacket.png', PIXEL)
    try {
      execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
      const j = json()
      assert.ok(j.siblingOnly.some((s) => s.path === 'website-v2/public/whitepaper/art/old/jacket.png'))
    } finally {
      seed()
    }
  })

  test('a manifest the world DOES reach is a real index, not an island', () => {
    put('docs/artifacts/live-set/proof-manifest.md', 'See `page-001.png`.\n')
    put('docs/artifacts/live-set/page-001.png', PIXEL)
    put('docs/INDEX.md', 'The record is `docs/artifacts/live-set/proof-manifest.md`.\n')
    try {
      execFileSync('git', ['add', '-A'], { cwd: SANDBOX })
      const j = json()
      assert.ok(!j.orphans.some((o) => o.path === 'docs/artifacts/live-set/page-001.png'))
      assert.ok(!j.siblingOnly.some((s) => s.path === 'docs/artifacts/live-set/page-001.png'),
        'a manifest something outside cites is an index; its contents are not islands')
    } finally {
      seed()
    }
  })

  test('the allow-list that ships with the repo parses and every entry carries a reason', () => {
    const shipped = JSON.parse(readFileSync(join(REPO, 'scripts', 'orphan-assets-allow.json'), 'utf8'))
    assert.ok(Array.isArray(shipped.allow))
    for (const e of shipped.allow) {
      assert.equal(typeof e.path, 'string')
      assert.ok(e.reason.split(/\s+/).length >= 5, `${e.path} needs a real reason`)
    }
  })
})
