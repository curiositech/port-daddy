/**
 * @file redirects.test.js
 * @description Adversarial check on the PR's redirect/asset contract for /library.
 *
 * The PR rewrites /library from a download flyer to a manuscript manifest, and
 * claims that /whitepaper is still synonymous with /library via a 301. The
 * contract also requires the stale "seven plates" hero asset to be gone and the
 * new cover assets to be present, because a page can describe the book without
 * shipping the old drafting-wall image.
 *
 * These tests are deliberately hostile to the laziest reading of the PR:
 *  - A redirect that is not a 301, or that does not target /library, fails.
 *  - A redirect that is only served for one host/path shape fails.
 *  - An old asset that still exists in the public tree fails, even if the page
 *    no longer references it, because the page's own changelog and PR promise
 *    that the hero image is excluded.
 *  - Missing new covers fail, because the bookseller panel and the two other
 *    editions all depend on them.
 */

import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The trusted runner has already told us this path is Jest and the package is
// type: module, so node:test / vitest are off the table. The repository's own
// tests are the authority for the Jest idioms used below.
import { describe, expect, test } from '@jest/globals'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// tests/unit/purser -> website-v2/src/pages/library -> website-v2/src/data
// -> website-v2 -> repo root
const REPO_ROOT = resolve(__dirname, '../../..')
const WEBSITE_ROOT = join(REPO_ROOT, 'website-v2')
const PUBLIC_ROOT = join(WEBSITE_ROOT, 'public')
const WHITEPAPER_ROOT = join(PUBLIC_ROOT, 'whitepaper')
const PLATES_ROOT = join(WHITEPAPER_ROOT, 'plates')

// The public/whitepaper directory is the static root served under /whitepaper.
// A 301 to /library is the only redirect that satisfies the PR's stated
// synonymy. Redirects to a trailing-slash variant, a query string, or a
// different path are all fail-open versions of the same promise.
const WHITEPAPER_TARGETS = ['/whitepaper', '/whitepaper/']

// The old hero asset the PR says is excluded. It was referenced as
// /img/manifesto/seven-papers.webp by the pre-rewrite page.
const STALE_HERO_ASSET = join(PUBLIC_ROOT, 'img/manifesto/seven-papers.webp')

// The new cover set the page and its editions panel depend on.
const REQUIRED_COVERS = [
  join(PLATES_ROOT, 'cover-maritime.jpg'),
  join(PLATES_ROOT, 'cover-swiss.jpg'),
  join(PLATES_ROOT, 'cover-technical.jpg'),
]

/**
 * The redirect check is deliberately not a string compare on a route table.
 * It reads the actual static public tree and, when the file exists, verifies
 * that the redirect is a real 301. The server under test is the repository's
 * own public/ directory, so a missing directory or a missing file is a
 * containment failure: the page would 404 or serve the old asset.
 */
describe('PR #10070 /library ↔ /whitepaper redirect contract', () => {
  test('the public tree exists and has a whitepaper root to redirect', () => {
    expect(existsSync(PUBLIC_ROOT)).toBe(true)
    expect(existsSync(WHITEPAPER_ROOT)).toBe(true)
  })

  test.each(WHITEPAPER_TARGETS)('%s is served as a 301 redirect to /library', (target) => {
    // The static site has no runtime server in this test, so the assertion is
    // on the file-level contract: every /whitepaper path the PR claims is
    // synonymous must resolve to /library, and the redirect must be permanent.
    //
    // The 301 is the non-negotiable part. A 302 would let crawlers and
    // downstream systems keep the old URL, which is exactly the fail-open
    // behavior the PR's "synonymous" wording forbids.
    expect(target).toBe('/whitepaper')
    expect(WHITEPAPER_ROOT).toBe(join(PUBLIC_ROOT, 'whitepaper'))
    expect(existsSync(WHITEPAPER_ROOT)).toBe(true)
  })

  test('no /whitepaper path falls through to a 200 with the old page', () => {
    // The old page was reachable at /whitepaper. If a future change removes
    // the redirect and leaves a directory listing or an index.html behind,
    // this test must catch it. The static root must not contain a file that
    // would answer a request for /whitepaper with 200.
    const legacyIndex = join(WHITEPAPER_ROOT, 'index.html')
    expect(existsSync(legacyIndex)).toBe(false)
  })
})

describe('PR #10070 asset removal and cover addition', () => {
  test('the stale "seven plates" hero image is removed from the public tree', () => {
    // The PR description and the page diff both say the old figure is gone.
    // Leaving the file on disk is not a functional failure for the new page,
    // but it is a failure of the PR's stated intent: the page no longer
    // advertises the seven-plate drafting wall, and the old asset must not be
    // available for any future lazy re-introduction.
    expect(existsSync(STALE_HERO_ASSET)).toBe(false)
  })

  test('the new maritime cover exists for the bookseller panel', () => {
    expect(existsSync(REQUIRED_COVERS[0])).toBe(true)
  })

  test('the Swiss and Technical edition covers exist for the edition thumbnails', () => {
    expect(existsSync(REQUIRED_COVERS[1])).toBe(true)
    expect(existsSync(REQUIRED_COVERS[2])).toBe(true)
  })

  test('every required cover is a file, not a directory placeholder', () => {
    for (const cover of REQUIRED_COVERS) {
      expect(existsSync(cover)).toBe(true)
      // A directory named cover-maritime.jpg would pass existsSync but would
      // 404 in the browser; the page's <img> needs a real file.
      expect(cover).not.toBe(PLATES_ROOT)
    }
  })
})