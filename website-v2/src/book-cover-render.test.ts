import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/render-book-cover.mjs renders page 1 of the committed Book PDF into
// the image the site shows, and --check is the CI form that fails when the two
// have drifted. It exists because the site once advertised a watercolour jacket
// the Book had stopped having, for a week.
//
// WHAT IS AND IS NOT TESTED HERE, stated plainly rather than implied by the
// tests that happen to exist:
//
//   Tested: that --check FAILS when the committed cover is not page 1 of the
//   committed PDF (using page 2 of the same PDF, so the check is shown to
//   compare the right page rather than merely noticing that two files differ);
//   that a missing cover is an error; that a missing source PDF is an error
//   and not a silent skip; that the written file lands at the exact path the
//   site's <img> tags reference, at the exact intrinsic size they declare; and
//   that two renders of the same page in the same environment are byte-equal,
//   which is the property that makes a byte comparison a legitimate drift
//   test rather than a coin toss.
//
//   NOT tested, because it is not decidable here: nothing asserts what the
//   cover LOOKS like. No pixel, histogram or perceptual assertion appears
//   below -- an image renderer's output is reviewed by a person, and a test
//   that hashed the pixels would only restate the byte comparison --check
//   already does.
//
//   ALSO NOT tested, and this one is a real limit rather than a choice:
//   --check compares BYTES, so it assumes the poppler and libjpeg that run it
//   produce the same bytes as the ones that produced the committed JPEG. This
//   file can show the render is reproducible on THIS machine; it cannot show
//   it is reproducible across poppler versions, and no test run in one
//   environment can. If CI ever reports cover drift on an untouched PDF, that
//   is the first thing to check -- and the fix is to pin the renderer, not to
//   loosen the comparison.
//
// If poppler is absent the suite SKIPS rather than passing: a green run that
// silently exercised nothing is the failure mode this file exists to avoid.

const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = join(here, '..')
const repoRoot = join(websiteRoot, '..')

const SCRIPT = join(websiteRoot, 'scripts', 'render-book-cover.mjs')
// The two paths the script hard-codes, spelled out here so a move of either
// one has to be made in two places on purpose rather than in one by accident.
const PDF_REL = join('website-v2', 'public', 'whitepaper', 'coordination-papers-mega-volume.pdf')
const OUT_REL = join('website-v2', 'public', 'whitepaper', 'book-cover.jpg')
/** What the site's <img src> must be for OUT_REL to be the file it fetches. */
const PUBLIC_URL = '/whitepaper/book-cover.jpg'

const hasPoppler = spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' }).error === undefined

function run(cwd: string, args: string[] = []) {
  const r = spawnSync('node', [join(cwd, 'website-v2', 'scripts', 'render-book-cover.mjs'), ...args], {
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * A temp repo shaped the way the script resolves paths (repo root is its own
 * directory's grandparent). The PDF is SYMLINKED, not copied: it is ten
 * megabytes and the test needs the real one, since "page 2 of the same book"
 * is only a meaningful wrong answer if the book is the real book.
 */
function fixture(opts: { pdf?: boolean; cover?: 'page1' | 'page2' | 'none' } = {}) {
  const { pdf = true, cover = 'none' } = opts
  const dir = mkdtempSync(join(tmpdir(), 'pd-book-cover-'))
  mkdirSync(join(dir, 'website-v2', 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'website-v2', 'public', 'whitepaper'), { recursive: true })
  copyFileSync(SCRIPT, join(dir, 'website-v2', 'scripts', 'render-book-cover.mjs'))
  if (pdf) symlinkSync(join(repoRoot, PDF_REL), join(dir, PDF_REL))
  if (cover === 'page1') copyFileSync(join(repoRoot, OUT_REL), join(dir, OUT_REL))
  if (cover === 'page2') copyFileSync(renderPage(2), join(dir, OUT_REL))
  return dir
}

/** Render one page of the real PDF with the script's own settings. */
function renderPage(page: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-page-'))
  spawnSync('pdftoppm', [
    '-f', String(page), '-l', String(page), '-r', '110', '-jpeg', '-jpegopt', 'quality=88',
    join(repoRoot, PDF_REL), join(dir, 'p'),
  ])
  // pdftoppm pads the page number to the width of the document's last page, so
  // the file name is not knowable in advance -- read it rather than guess it.
  const [file] = readdirSync(dir).filter((f) => f.endsWith('.jpg'))
  expect(file, `pdftoppm produced no JPEG for page ${page}`).toBeDefined()
  return join(dir, file)
}

/** Intrinsic size from the JPEG's own SOF marker: no decoder, no dependency. */
function jpegSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  expect(b.readUInt16BE(0), `${file} is not a JPEG`).toBe(0xffd8)
  let i = 2
  while (i < b.length - 9) {
    expect(b[i], 'lost JPEG marker alignment').toBe(0xff)
    const marker = b[i + 1]
    // SOF0/1/2/3, 5-7, 9-11, 13-15 carry the frame header; DHT/DAC/RST do not.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  throw new Error(`${file} has no SOF marker`)
}

describe.skipIf(!hasPoppler)('render-book-cover.mjs --check', () => {
  test('passes on the committed tree', () => {
    const r = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf8' })
    expect(`${r.stdout ?? ''}${r.stderr ?? ''}`).toContain('book cover matches page 1 of the committed Book')
    expect(r.status).toBe(0)
  })

  test('FAILS when the committed cover is a different page of the same Book', () => {
    const dir = fixture({ cover: 'page2' })
    try {
      // The fixture is honest: page 2 really is a different image from page 1,
      // so this is a drift the check has to notice and not a repeat of itself.
      expect(readFileSync(join(dir, OUT_REL)).equals(readFileSync(join(repoRoot, OUT_REL)))).toBe(false)
      const { code, out } = run(dir, ['--check'])
      expect(code).toBe(1)
      expect(out).toContain('book-cover.jpg does not match page 1 of the committed Book')
      expect(out).toContain('the cover changed and the site is still showing the old one')
      expect(out).toContain('node scripts/render-book-cover.mjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('FAILS when the cover has never been written', () => {
    const dir = fixture({ cover: 'none' })
    try {
      const { code, out } = run(dir, ['--check'])
      expect(code).toBe(1)
      expect(out).toContain('website-v2/public/whitepaper/book-cover.jpg is missing')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a missing source PDF is an error, not a silent skip', () => {
    const dir = fixture({ pdf: false, cover: 'page1' })
    try {
      // Both modes: a build step that quietly succeeds with nothing to render
      // is how a stale cover ships, and --check is the one that must not.
      for (const args of [['--check'], []]) {
        const { code, out } = run(dir, args)
        expect(code, `rc for ${args.join(' ') || '(write mode)'}`).toBe(1)
        expect(out).toContain('coordination-papers-mega-volume.pdf')
        expect(out).toContain('build the Book first')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('passes once the cover is page 1 — so the failures above are the drift, not the rig', () => {
    const dir = fixture({ cover: 'page1' })
    try {
      const { code, out } = run(dir, ['--check'])
      expect(out).toContain('book cover matches page 1 of the committed Book')
      expect(code).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!hasPoppler)('render-book-cover.mjs: where the image lands', () => {
  test('write mode creates exactly the file the site fetches', () => {
    const dir = fixture({ cover: 'none' })
    try {
      const { code, out } = run(dir)
      expect(code).toBe(0)
      expect(out).toContain(`wrote ${join(dir, OUT_REL)}`)
      expect(existsSync(join(dir, OUT_REL))).toBe(true)
      // and it is page 1, which is what --check will then compare against
      expect(readFileSync(join(dir, OUT_REL)).equals(readFileSync(renderPage(1)))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('every <img> that shows the cover points at that file', () => {
    const sources = ['components/landing/LibraryBanner.tsx', 'pages/whitepaper/index.tsx']
      .map((rel) => ({ rel, text: readFileSync(join(here, rel), 'utf8') }))
    const referencing = sources.filter((s) => s.text.includes('book-cover'))
    // If the cover stops being shown anywhere, this test is measuring nothing
    // and must be updated rather than left green.
    expect(referencing.length, 'no component references the cover any more').toBe(sources.length)
    for (const { rel, text } of referencing) {
      const urls = [...text.matchAll(/["'](\/[^"']*book-cover[^"']*)["']/g)].map((m) => m[1])
      expect(urls.length, `${rel} mentions the cover but has no src for it`).toBeGreaterThan(0)
      for (const url of urls) expect(url, rel).toBe(PUBLIC_URL)
    }
    // public/ is served at the site root, so PUBLIC_URL is OUT_REL minus the
    // public prefix. Asserted rather than assumed, since the whole point of
    // the script is that the derived file lands where the page looks for it.
    expect(join('website-v2', 'public') + PUBLIC_URL).toBe(OUT_REL)
    expect(existsSync(join(repoRoot, OUT_REL))).toBe(true)
  })

  test('the cover is the intrinsic size the <img> tags declare', () => {
    // A cover rendered at a different DPI still passes --check once it is
    // committed, but shifts the layout of both surfaces that show it, because
    // width/height on the <img> are what reserve the box before it loads.
    const { width, height } = jpegSize(join(repoRoot, OUT_REL))
    for (const rel of ['components/landing/LibraryBanner.tsx', 'pages/whitepaper/index.tsx']) {
      const text = readFileSync(join(here, rel), 'utf8')
      expect(text, rel).toContain(`width={${width}}`)
      expect(text, rel).toContain(`height={${height}}`)
    }
  })

  test('the render is reproducible here, which is what makes a byte compare fair', () => {
    // See the header: this is reproducibility within one poppler build, not
    // across versions. It is still worth pinning -- if rendering the same page
    // twice ever stopped agreeing, --check would fail at random and the right
    // response would be to stop comparing bytes, not to retry the build.
    expect(readFileSync(renderPage(1)).equals(readFileSync(renderPage(1)))).toBe(true)
  })
})

// Not skipped: this one needs no renderer, and it is the assertion that would
// still catch the cover quietly falling out of CI.
test('render-book-cover --check is wired into a package script', () => {
  const pkg = JSON.parse(readFileSync(join(websiteRoot, 'package.json'), 'utf8'))
  expect(pkg.scripts['test:book-cover']).toContain('render-book-cover.mjs --check')
})
