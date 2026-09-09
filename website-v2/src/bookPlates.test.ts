import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { TEXTBOOK } from '@/data/whitePapers'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public')

// The naming convention, which is the thing under test. These used to be
// exported by the /library page and imported here; that page has no route and
// no importer any more, but the invariant is not the page's -- the Book's own
// LaTeX prints these same plates, so a part or chapter added to textbook.json
// without its plate breaks the build whether or not any page renders it.
const partPlate = (numeral: string) => `/whitepaper/plates/part-${numeral}.jpg`
const chapterPlate = (prefix: string) => `/whitepaper/plates/chapter-${prefix}.jpg`

/**
 * Every part and every chapter in textbook.json has a plate on disk, named
 * from its numeral or prefix alone. A part or chapter added without its plate
 * is a missing file the Book's own build would fail on; this turns it into a
 * test failure first, where the cause is one line rather than a TeX log.
 */
describe('the Book\'s part and chapter plates', () => {
  test('plate paths are derived from the numeral and the chapter prefix alone', () => {
    expect(partPlate('II')).toBe('/whitepaper/plates/part-II.jpg')
    expect(chapterPlate(TEXTBOOK.chapters[0].prefix)).toBe(`/whitepaper/plates/chapter-${TEXTBOOK.chapters[0].prefix}.jpg`)
  })

  test('every part in textbook.json has a plate file', () => {
    for (const part of TEXTBOOK.parts) {
      expect(existsSync(resolve(publicDir, `.${partPlate(part.numeral)}`)), `part ${part.numeral}`).toBe(true)
    }
  })

  test('every chapter in textbook.json has a plate file', () => {
    for (const chapter of TEXTBOOK.chapters) {
      expect(existsSync(resolve(publicDir, `.${chapterPlate(chapter.prefix)}`)), `chapter ${chapter.prefix}`).toBe(true)
    }
  })
})
