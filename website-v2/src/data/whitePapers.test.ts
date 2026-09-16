import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  detectDrift,
  pdfFactsFromDisk,
  pdfinfoAvailable,
  resolvePdfPath,
  rewriteMetadata,
  type PdfFacts,
} from '../../scripts/check-whitepaper-metadata'
import { COLLECTED_VOLUME, TABLE_OF_CONTENTS, TEXTBOOK, WHITE_PAPERS } from './whitePapers'
import { RESEARCH_PAPERS } from './researchPapers'
import {
  BOOK_ID,
  BOOK_PAGE_FLOOR,
  PAGE_DRIFT_MIN_PAGES,
  checkPageCount,
  describeBand,
  formatDriftFailure,
  formatFloorFailure,
  locateBaseline,
  pageDriftAllowance,
  pagesWithinBand,
  type PageCountSubject,
} from '../../scripts/page-count-policy'
import {
  PAGES_MAX_ASSET_BYTES,
  PAGES_ONLY_EXCLUSIONS,
  oversizedPagesAssets,
  prunePagesOnlyAssets,
} from '../../scripts/prune-pages-assets.mjs'

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const researchPapersSrc = resolve(websiteRoot, 'src/data/researchPapers.ts')
const whitePapersSrc = resolve(websiteRoot, 'src/data/whitePapers.ts')

/** How the page-count policy names the Book when it has something to say. */
function bookSubject(): PageCountSubject {
  return {
    id: BOOK_ID,
    label: 'The Book',
    baselineLocation: locateBaseline(whitePapersSrc, BOOK_ID, 'website-v2/src/data/whitePapers.ts'),
    resyncCommand: 'npm run fix:whitepaper-metadata',
    resyncCommandCwd: 'website-v2/',
  }
}

/**
 * COPY HYGIENE IS ENFORCED AT THE TYPE LEVEL.
 *
 * The previous version of this test reached for a runtime substring grep
 * (`source.toLowerCase().includes(phrase)`) to police a closed list of
 * forbidden phrases. That violated the user-level rule
 * `NO KEYWORD-BASED NLP. EVER.` — keyword lists can never enumerate a
 * category, fail open on synonyms, and lock the constraint into runtime
 * code instead of the type system where it belongs.
 *
 * The replacement lives in `whitePapers.ts`: a `NoForbidden<S>` template
 * literal type + a `defineWhitePapers` helper that threads literal types
 * through inference and intersects each paper with its validated form.
 * Any forbidden phrase in body prose collapses the offending paper's
 * intersection to `never` at compile time. The runtime contract here
 * shrinks to: "if `tsc` is clean, the constraint held."
 *
 * **Canonical pattern.** Future keyword bans on data files MUST follow
 * the same template-literal-type approach (see `ForbiddenPhrase` /
 * `NoForbidden` / `ValidatePaper` in `whitePapers.ts`). Do not reach for
 * regex / `includes()` / substring scans — they are the anti-pattern.
 * If a future category can't be expressed as a closed list of literal
 * strings, reach for embeddings or a Haiku-grade classifier, not a list.
 */

describe('whitepaper metadata sync', () => {
  test('the Book is separate from its chapters', () => {
    expect(WHITE_PAPERS).toHaveLength(TEXTBOOK.chapters.length)
    expect(WHITE_PAPERS.some((paper) => paper.id === COLLECTED_VOLUME.id)).toBe(false)
  })

  test('the site mirror of textbook.json is byte-identical to the source of record', () => {
    const source = readFileSync(resolve(websiteRoot, '../whitepaper/textbook.json'), 'utf8')
    const mirror = readFileSync(resolve(websiteRoot, 'src/data/textbook.json'), 'utf8')
    expect(mirror).toBe(source)
  })

  test('chapter numbers, parts, roles, and cross-references agree with textbook.json', () => {
    const byId = new Map(TEXTBOOK.chapters.map((chapter) => [chapter.id, chapter]))
    expect(WHITE_PAPERS.map((paper) => paper.chapter)).toEqual(TEXTBOOK.chapters.map((chapter) => chapter.number))
    for (const paper of WHITE_PAPERS) {
      const record = byId.get(paper.id)
      expect(record, `${paper.id} is a chapter in textbook.json`).toBeDefined()
      expect(paper.chapter).toBe(record!.number)
      expect(paper.title).toBe(record!.title)
      expect(paper.role).toBe(record!.role)
      expect(paper.formerNumeral).toBe(record!.formerNumeral)
      expect(paper.discharges).toBe(record!.discharges)
      const part = TEXTBOOK.parts.find((candidate) => candidate.chapters.includes(paper.id))
      expect(part?.id, `${paper.id} belongs to a part`).toBe(paper.part)
      if (paper.discharges) {
        expect(byId.get(paper.discharges)!.number).toBeLessThan(paper.chapter)
      }
      for (const edges of Object.values(paper.crossRefs)) {
        for (const edge of edges ?? []) {
          expect(byId.has(edge.id), `${paper.id} cross-references unknown chapter ${edge.id}`).toBe(true)
        }
      }
    }
    expect(TABLE_OF_CONTENTS.flatMap((part) => part.papers.map((paper) => paper.chapter))).toEqual(
      WHITE_PAPERS.map((paper) => paper.chapter),
    )
  })

  test('every chapter status matches the version its LaTeX source declares', () => {
    for (const record of TEXTBOOK.chapters) {
      const tex = readFileSync(resolve(websiteRoot, '..', record.source), 'utf8')
      const match = tex.match(/\\date\{[^\\}]*\\\\Version ([^}]+)\}/)
      expect(match, `${record.source} declares \\date{...\\\\Version ...}`).not.toBeNull()
      const paper = WHITE_PAPERS.find((candidate) => candidate.id === record.id)!
      expect(paper.status).toBe(`Version ${match![1]}`)
    }
  })

  test('the collected volume declares an on-disk PDF', () => {
    const abs = resolvePdfPath(COLLECTED_VOLUME.pdfPath)
    expect(existsSync(abs), `collected volume PDF missing at ${abs}`).toBe(true)
    expect(statSync(abs).size).toBeGreaterThan(10_000)
  })

  test('the full-fidelity collected volume downloads from its canonical repository artifact', () => {
    expect(COLLECTED_VOLUME.downloadUrl).toBe(
      'https://raw.githubusercontent.com/curiositech/port-daddy/main/website-v2/public/whitepaper/coordination-papers-mega-volume.pdf',
    )
  })

  test('collected-volume pages and sizeKb match the actual PDF', () => {
    if (!pdfinfoAvailable()) return
    expect(detectDrift([COLLECTED_VOLUME], pdfFactsFromDisk)).toEqual([])
  })

  test('chapters do not declare a standalone PDF of their own', () => {
    // Retired: the eight chapters used to publish an A4 render of themselves,
    // with no margin column, alongside the Book's 7x10in trim — a second,
    // worse layout of the same words. A chapter is chapter N of one book now;
    // it carries no `pdfPath` / `filename` / `pages` / `sizeKb`, and
    // textbook.json carries no per-chapter `pdf`. This is a regression guard,
    // not a metadata-sync check: there is no file left to sync against.
    for (const paper of WHITE_PAPERS) {
      expect(paper).not.toHaveProperty('pdfPath')
      expect(paper).not.toHaveProperty('filename')
      expect(paper).not.toHaveProperty('pages')
      expect(paper).not.toHaveProperty('sizeKb')
    }
    for (const record of TEXTBOOK.chapters) {
      expect(record).not.toHaveProperty('pdf')
    }
  })

  test('drift detection trips when metadata is wrong (fixture)', () => {
    // Lie to detectDrift via the injected getFacts callback. Proves the
    // detector actually catches a mismatch — guards against the check
    // silently passing because of a logic regression. Exercised against the
    // seven research papers (still individually published PDFs) rather than
    // WHITE_PAPERS, which no longer declare one.
    const fakeFacts: PdfFacts = { pages: 9999, sizeKb: 9999 }
    const drift = detectDrift(RESEARCH_PAPERS, () => fakeFacts)
    expect(drift.length).toBe(RESEARCH_PAPERS.length)
    expect(drift[0].pagesDrift).toBe(true)
    expect(drift[0].sizeDrift).toBe(true)
  })

  test('size tolerance allows sub-2% wobble on large PDFs', () => {
    // sizeKb off by 1% — under 2% tolerance, should NOT report drift.
    const slightlyOff = (paper: (typeof RESEARCH_PAPERS)[number]): PdfFacts => ({
      pages: paper.pages,
      sizeKb: Math.round(paper.sizeKb * 1.01),
    })
    const facts = new Map(RESEARCH_PAPERS.map((p) => [resolvePdfPath(p.pdfPath), slightlyOff(p)]))
    const drift = detectDrift(RESEARCH_PAPERS, (abs) => {
      const f = facts.get(abs)
      if (!f) throw new Error(`unexpected path: ${abs}`)
      return f
    })
    expect(drift).toEqual([])
  })

  test('size tolerance rejects > 2% wobble (large PDFs)', () => {
    // 5% on a 400+ KB paper is well over both 2% and 4 KB.
    const wayOff = (paper: (typeof RESEARCH_PAPERS)[number]): PdfFacts => ({
      pages: paper.pages,
      sizeKb: Math.round(paper.sizeKb * 1.05),
    })
    const facts = new Map(RESEARCH_PAPERS.map((p) => [resolvePdfPath(p.pdfPath), wayOff(p)]))
    const drift = detectDrift(RESEARCH_PAPERS, (abs) => {
      const f = facts.get(abs)
      if (!f) throw new Error(`unexpected path: ${abs}`)
      return f
    })
    expect(drift.length).toBe(RESEARCH_PAPERS.length)
    for (const r of drift) {
      expect(r.sizeDrift).toBe(true)
      expect(r.pagesDrift).toBe(false)
    }
  })

  test('size tolerance floor: 4 KB absolute minimum for small PDFs', () => {
    // A hypothetical 50 KB paper: 2% = 1 KB. The 4 KB floor should kick in
    // and accept up to ±4 KB. Verified by handing detectDrift a fake paper
    // entry off by exactly 3 KB (within floor) and one off by 5 KB (over).
    // `pages: 30` is incidental here — it only has to clear the (unrelated)
    // page-count floor so that this stays a test about the sizeKb tolerance
    // and nothing else.
    const tinyPaper = { id: 't', pdfPath: COLLECTED_VOLUME.pdfPath, pages: 30, sizeKb: 50 }
    const withinFloor = detectDrift([tinyPaper], () => ({ pages: 30, sizeKb: 53 }))
    expect(withinFloor).toEqual([])
    const overFloor = detectDrift([tinyPaper], () => ({ pages: 30, sizeKb: 55 }))
    expect(overFloor.length).toBe(1)
    expect(overFloor[0].sizeDrift).toBe(true)
  })

  test('rewriteMetadata patches pages/sizeKb in place without touching prose', () => {
    // Exercised against the research-papers registry: WHITE_PAPERS entries no
    // longer carry a `pages`/`sizeKb` pair for the rewriter to find (chapters
    // do not publish a standalone PDF), so this now proves the same in-place
    // AST patch on the registry that still does.
    const original = readFileSync(researchPapersSrc, 'utf8')
    const updates = new Map<string, { pages: number; sizeKb: number }>([
      ['price-of-a-summary', { pages: 99, sizeKb: 1234 }],
    ])
    const next = rewriteMetadata(original, updates)
    expect(next).not.toBe(original)
    expect(next).toContain('pages: 99')
    expect(next).toContain('sizeKb: 1234')
    // Other paper's metadata untouched.
    const untouchedExpected = RESEARCH_PAPERS.find((p) => p.id === 'regimented-or-enforced')!
    expect(next).toContain(`pages: ${untouchedExpected.pages}`)
    expect(next).toContain(`sizeKb: ${untouchedExpected.sizeKb}`)
    // Prose-bearing fields untouched.
    expect(next).toContain('The Price of a Summary')
    expect(next).toContain('Regimented or Enforced')
  })

  test('on-disk PDF byte sizes are reasonable (sanity, no pdfinfo needed)', () => {
    // Cheap belt-and-braces check that runs even without poppler. Catches
    // the case where someone replaced a PDF with a 0-byte placeholder. Only
    // the Book and the research papers are individually published PDFs now.
    for (const paper of [COLLECTED_VOLUME, ...RESEARCH_PAPERS]) {
      const abs = resolvePdfPath(paper.pdfPath)
      const bytes = statSync(abs).size
      expect(bytes, `${paper.id} PDF should be > 10 KB`).toBeGreaterThan(10_000)
    }
  })

  test('audited Harbor metadata names the textbook edition', () => {
    const byId = new Map(WHITE_PAPERS.map((paper) => [paper.id, paper]))
    expect(byId.get('harbor-economy')).toMatchObject({ status: 'Version 1.3 (textbook edition)' })
  })

  test('audited Legible metadata names the textbook edition', () => {
    const byId = new Map(WHITE_PAPERS.map((paper) => [paper.id, paper]))
    expect(byId.get('legible-swarm')).toMatchObject({ status: 'Version 1.2 (textbook edition)' })
  })

  test('audited Single-Writer Kernel metadata names its textbook edition', () => {
    const kernel = WHITE_PAPERS.find((paper) => paper.id === 'single-writer-kernel')
    expect(kernel).toMatchObject({ status: 'Version 1.2 (textbook edition)' })
  })
})

describe('Pages deployment boundary', () => {
  /**
   * This suite used to assert the opposite: that the collected volume was
   * pruned from `dist`, described as "the oversized collected-volume
   * duplicate". It is not oversized. The PDF is 9,740,631 bytes — 9.29 MiB
   * against Cloudflare's 25 MiB per-asset limit — and the exclusion meant
   * production answered its URL with the SPA shell (HTTP 200, `text/html`,
   * 4,829 bytes, byte-identical to a nonexistent path). The test passed the
   * whole time, because it only ever checked that the list did what the list
   * said, never that the list's premise was true.
   *
   * The replacement measures. Nothing is excluded by name; the guard reports
   * files that really are at or over the limit.
   */
  test('nothing is excluded by name — the exclusion list is empty', () => {
    expect(PAGES_ONLY_EXCLUSIONS).toEqual([])
  })

  test('the collected volume is far below the Pages per-asset limit', () => {
    const abs = resolvePdfPath(COLLECTED_VOLUME.pdfPath)
    const bytes = statSync(abs).size
    expect(bytes).toBeLessThan(PAGES_MAX_ASSET_BYTES)
    // Not a squeaker: it is under half the limit, so no rounding or
    // MiB-vs-MB confusion can make the old exclusion retroactively correct.
    expect(bytes).toBeLessThan(PAGES_MAX_ASSET_BYTES / 2)
  })

  test('no shipped public asset meets the Pages per-asset limit', () => {
    expect(oversizedPagesAssets(resolve(websiteRoot, 'public'))).toEqual([])
  })

  test('the oversize guard measures real bytes rather than trusting a list', () => {
    const fixtureRoot = resolve(websiteRoot, '.cache/pages-prune-test')
    const whitepaperDir = resolve(fixtureRoot, 'whitepaper')
    const chapter = resolve(whitepaperDir, 'legible-swarm-whitepaper.pdf')
    const huge = resolve(whitepaperDir, 'pretend-huge.bin')
    try {
      mkdirSync(whitepaperDir, { recursive: true })
      writeFileSync(chapter, 'chapter remains on Pages')
      writeFileSync(huge, Buffer.alloc(2048))

      // With an empty exclusion list, prune removes nothing at all.
      expect(prunePagesOnlyAssets(fixtureRoot)).toEqual([])
      expect(existsSync(chapter)).toBe(true)
      expect(existsSync(huge)).toBe(true)

      // The guard reports by size, and reports the size it measured, so the
      // "it is too big" claim can always be checked against the number.
      expect(oversizedPagesAssets(fixtureRoot, 1024)).toEqual([
        { path: 'whitepaper/pretend-huge.bin', bytes: 2048 },
      ])
      // Raise the limit past it and the same tree is clean — the verdict
      // tracks the bytes, not a name.
      expect(oversizedPagesAssets(fixtureRoot, 4096)).toEqual([])
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})

describe('whitepaper copy hygiene', () => {
  /**
   * The forbidden-phrase grep that used to live here is gone — it was a
   * keyword-list anti-pattern. See the long comment at the top of this
   * file for the rationale and the canonical pattern (template-literal
   * type in `whitePapers.ts`).
   *
   * The single runtime check that remains: the type assertion itself.
   * `WHITE_PAPERS` is typed as `WhitePaper[]` after passing through
   * `defineWhitePapers`, which only compiles when every prose field is
   * `NoForbidden`-clean. Importing `WHITE_PAPERS` here means: if `tsc`
   * passed, the constraint passed. The test below records that
   * intention explicitly so a future refactor doesn't accidentally
   * drop the type-level guard without realizing it owned the rule.
   */
  test('WHITE_PAPERS passes the compile-time forbidden-phrase guard', () => {
    // If this file compiled, ForbiddenPhrase did not match any body prose.
    // The type ValidatePaper<P> intersected each paper with a NoForbidden-
    // narrowed shape; the runtime value is the un-narrowed source.
    expect(Array.isArray(WHITE_PAPERS)).toBe(true)
    expect(WHITE_PAPERS.length).toBeGreaterThan(0)
    for (const paper of WHITE_PAPERS) {
      expect(typeof paper.id).toBe('string')
      expect(typeof paper.title).toBe('string')
    }
  })
})

/**
 * The page-count policy, exercised. Each of the three behaviours the policy
 * promises is demonstrated here against the Book's real baseline, so a
 * regression that quietly turns the guard back into a pin — or into a guard
 * that never fires — fails right here. The chapters themselves no longer
 * carry a `pages` field (their standalone PDFs are retired), so the Book is
 * the one subject this policy still has a live baseline to check against.
 */
describe('page-count policy', () => {
  const subject = (): PageCountSubject => bookSubject()

  test('a routine reflow inside the band passes in silence', () => {
    const baseline = COLLECTED_VOLUME.pages
    const allowance = pageDriftAllowance(baseline)
    // A ten-page reflow on a book this long is ordinary work: a figure resized,
    // a float moved, a paragraph landed. The guard must say nothing.
    expect(allowance).toBeGreaterThan(10)
    for (const moved of [baseline, baseline + 1, baseline - 1, baseline + 10, baseline - 10]) {
      expect(checkPageCount(subject(), baseline, moved), `${baseline} -> ${moved} should be silent`).toBeNull()
    }
  })

  test('a count under the floor fails, and the message says the artifact is broken', () => {
    const message = checkPageCount(subject(), COLLECTED_VOLUME.pages, 3)
    expect(message).not.toBeNull()
    expect(message).toContain('PAGE-COUNT FLOOR')
    expect(message).toContain('3 pages')
    expect(message).toContain(String(BOOK_PAGE_FLOOR))
    // It must read as "your build is broken", not as "bump a number".
    expect(message).toContain('broken artifact')
    expect(message).toContain('error page')
    expect(message).toContain('Do not lower it to get a green build.')
  })

  test('a wild move outside the band fails, names both readings, and points at the line', () => {
    // The real case this band was calibrated against: claude/book-print-geometry
    // recuts the Book as a two-sided block, 551 -> 604 pages, +9.62%. That is a
    // deliberate, legitimate, large change — exactly the kind a person should
    // look at — so it must trip, not pass.
    expect(pagesWithinBand(604, 551)).toBe(false)

    const message = checkPageCount(subject(), 551, 604)
    expect(message).not.toBeNull()
    expect(message).toContain('PAGE-COUNT DRIFT')
    // Old, new, delta in pages and percent.
    expect(message).toContain('551 → 604')
    expect(message).toContain('+53 pages')
    expect(message).toContain('+9.62%')
    // The exact file and line to edit if the move was intended.
    expect(message).toContain('website-v2/src/data/whitePapers.ts:')
    expect(message).toMatch(/website-v2\/src\/data\/whitePapers\.ts:\d+/)
    expect(message).toContain('pages: 551   →   pages: 604')
    // Both readings, spelled out, because the test cannot know which is true.
    expect(message).toContain('THIS CHANGE WAS MEANT TO MOVE THE PAGE COUNT')
    expect(message).toContain('IN THIS SAME PULL REQUEST')
    expect(message).toContain('NOTHING IN THIS CHANGE SHOULD HAVE MOVED IT')
    expect(message).toContain('Do not widen the band to make this pass.')
  })

  test('the baseline pointer resolves to the line that actually holds the number', () => {
    const location = locateBaseline(whitePapersSrc, BOOK_ID, 'website-v2/src/data/whitePapers.ts')
    const line = Number(location.split(':')[1])
    expect(Number.isInteger(line)).toBe(true)
    const text = readFileSync(whitePapersSrc, 'utf8').split('\n')[line - 1]
    expect(text).toBe(`  pages: ${COLLECTED_VOLUME.pages},`)
  })

  test('the band is far wider than the sizeKb band it is modelled on', () => {
    // Page counts move about two and a half times more than bytes do, so the
    // house 2% size tolerance would be far too tight for pages.
    expect(describeBand()).toBe('max(5%, 4 pages)')
  })
})
