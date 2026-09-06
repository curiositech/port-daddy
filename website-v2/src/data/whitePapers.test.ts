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
import { prunePagesOnlyAssets } from '../../scripts/prune-pages-assets.mjs'

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const whitePapersSrc = resolve(websiteRoot, 'src/data/whitePapers.ts')

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
      expect(paper.pdfPath).toBe(`/whitepaper/${record!.pdf}`)
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

  test('collected pagination is composed independently from standalone PDFs', () => {
    if (!pdfinfoAvailable()) return
    const standalonePages = WHITE_PAPERS.reduce((sum, paper) => sum + paper.pages, 0)
    const actualPages = pdfFactsFromDisk(resolvePdfPath(COLLECTED_VOLUME.pdfPath)).pages

    // The collected edition strips standalone front matter and inserts its own
    // front matter, chapter openings and handoffs, result atlas, and collated
    // references. The built PDF is authoritative; summing the seven separately
    // typeset editions or copying a page-count literal into this test is not.
    expect(COLLECTED_VOLUME.pages).toBe(actualPages)
    expect(standalonePages).not.toBe(actualPages)
  })

  test('every paper declares an on-disk PDF', () => {
    for (const paper of WHITE_PAPERS) {
      const abs = resolvePdfPath(paper.pdfPath)
      expect(existsSync(abs), `${paper.id} PDF missing at ${abs}`).toBe(true)
    }
  })

  test('metadata pages and sizeKb match the actual PDFs (requires pdfinfo)', () => {
    if (!pdfinfoAvailable()) {
      // Per the script contract: pdfinfo missing is a CI runner defect, not
      // a test failure. Surface it loudly without breaking the suite.
      console.warn(
        'pdfinfo not on PATH; whitepaper metadata sync test skipped. Fix the runner: brew install poppler.',
      )
      return
    }

    const drift = detectDrift(WHITE_PAPERS, pdfFactsFromDisk)
    expect(
      drift,
      drift.length
        ? `Whitepaper metadata drift detected: ${JSON.stringify(drift, null, 2)}`
        : 'no drift',
    ).toEqual([])
  })

  test('drift detection trips when metadata is wrong (fixture)', () => {
    // Lie to detectDrift via the injected getFacts callback. Proves the
    // detector actually catches a mismatch — guards against the check
    // silently passing because of a logic regression.
    const fakeFacts: PdfFacts = { pages: 9999, sizeKb: 9999 }
    const drift = detectDrift(WHITE_PAPERS, () => fakeFacts)
    expect(drift.length).toBe(WHITE_PAPERS.length)
    expect(drift[0].pagesDrift).toBe(true)
    expect(drift[0].sizeDrift).toBe(true)
  })

  test('size tolerance allows sub-2% wobble on large PDFs', () => {
    // sizeKb off by 1% — under 2% tolerance, should NOT report drift.
    const slightlyOff = (paper: (typeof WHITE_PAPERS)[number]): PdfFacts => ({
      pages: paper.pages,
      sizeKb: Math.round(paper.sizeKb * 1.01),
    })
    const facts = new Map(WHITE_PAPERS.map((p) => [resolvePdfPath(p.pdfPath), slightlyOff(p)]))
    const drift = detectDrift(WHITE_PAPERS, (abs) => {
      const f = facts.get(abs)
      if (!f) throw new Error(`unexpected path: ${abs}`)
      return f
    })
    expect(drift).toEqual([])
  })

  test('size tolerance rejects > 2% wobble (large PDFs)', () => {
    // 5% on the 863 KB paper is ~43 KB — well over both 2% and 4 KB.
    const wayOff = (paper: (typeof WHITE_PAPERS)[number]): PdfFacts => ({
      pages: paper.pages,
      sizeKb: Math.round(paper.sizeKb * 1.05),
    })
    const facts = new Map(WHITE_PAPERS.map((p) => [resolvePdfPath(p.pdfPath), wayOff(p)]))
    const drift = detectDrift(WHITE_PAPERS, (abs) => {
      const f = facts.get(abs)
      if (!f) throw new Error(`unexpected path: ${abs}`)
      return f
    })
    expect(drift.length).toBe(WHITE_PAPERS.length)
    for (const r of drift) {
      expect(r.sizeDrift).toBe(true)
      expect(r.pagesDrift).toBe(false)
    }
  })

  test('size tolerance floor: 4 KB absolute minimum for small PDFs', () => {
    // A hypothetical 50 KB paper: 2% = 1 KB. The 4 KB floor should kick in
    // and accept up to ±4 KB. Verified by handing detectDrift a fake paper
    // entry off by exactly 3 KB (within floor) and one off by 5 KB (over).
    const tinyPaper = { id: 't', pdfPath: WHITE_PAPERS[0].pdfPath, pages: 1, sizeKb: 50 }
    const withinFloor = detectDrift([tinyPaper], () => ({ pages: 1, sizeKb: 53 }))
    expect(withinFloor).toEqual([])
    const overFloor = detectDrift([tinyPaper], () => ({ pages: 1, sizeKb: 55 }))
    expect(overFloor.length).toBe(1)
    expect(overFloor[0].sizeDrift).toBe(true)
  })

  test('rewriteMetadata patches pages/sizeKb in place without touching prose', () => {
    const original = readFileSync(whitePapersSrc, 'utf8')
    const updates = new Map<string, { pages: number; sizeKb: number }>([
      ['anchor-protocol', { pages: 99, sizeKb: 1234 }],
    ])
    const next = rewriteMetadata(original, updates)
    expect(next).not.toBe(original)
    expect(next).toContain('pages: 99')
    expect(next).toContain('sizeKb: 1234')
    // Other paper's metadata untouched.
    const bondedExpected = WHITE_PAPERS.find((p) => p.id === 'bonded-commons')!
    expect(next).toContain(`pages: ${bondedExpected.pages}`)
    expect(next).toContain(`sizeKb: ${bondedExpected.sizeKb}`)
    // Prose-bearing fields untouched.
    expect(next).toContain('The Anchor Protocol')
    expect(next).toContain('Bonded Commons')
  })

  test('on-disk PDF byte sizes are reasonable (sanity, no pdfinfo needed)', () => {
    // Cheap belt-and-braces check that runs even without poppler. Catches
    // the case where someone replaced a PDF with a 0-byte placeholder.
    for (const paper of WHITE_PAPERS) {
      const abs = resolvePdfPath(paper.pdfPath)
      const bytes = statSync(abs).size
      expect(bytes, `${paper.id} PDF should be > 10 KB`).toBeGreaterThan(10_000)
    }
  })

  test('audited Harbor metadata names the textbook edition', () => {
    const byId = new Map(WHITE_PAPERS.map((paper) => [paper.id, paper]))
    expect(byId.get('harbor-economy')).toMatchObject({
      pages: 37,
      status: 'Version 1.3 (textbook edition)',
    })
  })

  test('audited Legible metadata names the textbook edition', () => {
    const byId = new Map(WHITE_PAPERS.map((paper) => [paper.id, paper]))
    expect(byId.get('legible-swarm')).toMatchObject({
      pages: 46,
      status: 'Version 1.2 (textbook edition)',
    })
  })

  test('audited Single-Writer Kernel metadata names its textbook edition', () => {
    const kernel = WHITE_PAPERS.find((paper) => paper.id === 'single-writer-kernel')
    expect(kernel).toMatchObject({
      pages: 40,
      status: 'Version 1.2 (textbook edition)',
    })
  })
})

describe('Pages deployment boundary', () => {
  test('only the oversized collected-volume duplicate is pruned from dist', () => {
    const fixtureRoot = resolve(websiteRoot, '.cache/pages-prune-test')
    const whitepaperDir = resolve(fixtureRoot, 'whitepaper')
    const collected = resolve(whitepaperDir, 'coordination-papers-mega-volume.pdf')
    const chapter = resolve(whitepaperDir, 'legible-swarm-whitepaper.pdf')
    try {
      mkdirSync(whitepaperDir, { recursive: true })
      writeFileSync(collected, 'full fidelity collected volume')
      writeFileSync(chapter, 'chapter remains on Pages')

      expect(prunePagesOnlyAssets(fixtureRoot)).toEqual([collected])
      expect(existsSync(collected)).toBe(false)
      expect(existsSync(chapter)).toBe(true)
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
