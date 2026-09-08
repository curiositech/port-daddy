/**
 * @file redirects.test.js
 * @description Adversarial check on the PR's cover-asset contract for /library.
 *
 * The original version of this file asserted two things about PR #10070
 * that turn out to be false against the actual diff:
 *
 *  1. That /whitepaper became a 301 redirect to /library. It did not:
 *     website-v2/src/pages/whitepaper/index.tsx is still a full standalone
 *     reader page in this PR (its own header, paper switcher, and embedded
 *     PDF viewer) that merely links to /library with an ordinary <Link> as
 *     one cross-reference among several. There is no redirect anywhere in
 *     the diff to test, and the deleted `test.each` block asserting one
 *     was also internally broken -- it compared its own two fixture
 *     strings ('/whitepaper' and '/whitepaper/') against the literal
 *     '/whitepaper', which is tautological for the first case and would
 *     have failed the second regardless of any real redirect behavior.
 *
 *  2. That the pre-rewrite "seven plates" hero asset
 *     (public/img/manifesto/seven-papers.webp) is deleted from the
 *     repository. It is not, and should not be: website-v2/src/data/
 *     manifestoContent.ts still carries a caption entry for it, because
 *     other pages (the manifesto) keep using it. PR #10070 only stopped
 *     the /library page itself from rendering it; it never removed the
 *     file, and nothing in the PR promises to.
 *
 * Both false assertions have been deleted rather than kept as guaranteed
 * failures or skipped stubs. What remains -- the three new cover images
 * the bookseller panel and edition thumbnails actually depend on existing
 * as real files -- is the part of the original file that matches the PR
 * (website-v2/src/pages/library/index.tsx references
 * /whitepaper/plates/cover-maritime.jpg directly, and
 * /whitepaper/plates/cover-${edition-id}.jpg for each edition in
 * COLLECTED_VOLUME.editions, i.e. cover-swiss.jpg and cover-technical.jpg).
 */

import { existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from '@jest/globals'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// tests/unit/purser -> tests/unit -> tests -> repo root
const REPO_ROOT = resolve(__dirname, '../../..')
const WEBSITE_ROOT = join(REPO_ROOT, 'website-v2')
const PUBLIC_ROOT = join(WEBSITE_ROOT, 'public')
const WHITEPAPER_ROOT = join(PUBLIC_ROOT, 'whitepaper')
const PLATES_ROOT = join(WHITEPAPER_ROOT, 'plates')

// The new cover set the library page and its editions panel depend on.
const REQUIRED_COVERS = [
  join(PLATES_ROOT, 'cover-maritime.jpg'),
  join(PLATES_ROOT, 'cover-swiss.jpg'),
  join(PLATES_ROOT, 'cover-technical.jpg'),
]

describe('PR #10070 cover asset contract', () => {
  test('the new maritime cover exists for the bookseller panel', () => {
    expect(existsSync(REQUIRED_COVERS[0])).toBe(true)
  })

  test('the Swiss and Technical edition covers exist for the edition thumbnails', () => {
    expect(existsSync(REQUIRED_COVERS[1])).toBe(true)
    expect(existsSync(REQUIRED_COVERS[2])).toBe(true)
  })

  test('every required cover is a real file, not a directory placeholder', () => {
    for (const cover of REQUIRED_COVERS) {
      expect(existsSync(cover)).toBe(true)
      // A directory named cover-maritime.jpg would pass existsSync but
      // would 404 in the browser; the page's <img> needs a real file.
      expect(statSync(cover).isFile()).toBe(true)
    }
  })
})
