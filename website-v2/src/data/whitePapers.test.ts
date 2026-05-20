import { existsSync, statSync } from 'node:fs'
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
import { WHITE_PAPERS } from './whitePapers'

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const whitePapersSrc = resolve(websiteRoot, 'src/data/whitePapers.ts')

/**
 * Forbidden version-history phrases. Per project rule: "speak only of the
 * now. do not assume the reader read you before. do not anxiously wave to
 * the future." `Pre-print` is allowed but ONLY inside the `status:` field.
 */
const forbiddenPhrases = [
  'original draft',
  'Version 2 closes',
  'earlier draft',
  'Version~2',
]

describe('whitepaper metadata sync', () => {
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

  test('size tolerance allows small build-to-build wobble', () => {
    // Same pages, sizeKb off by 2% — should NOT report drift.
    const slightlyOff = (paper: (typeof WHITE_PAPERS)[number]): PdfFacts => ({
      pages: paper.pages,
      sizeKb: Math.round(paper.sizeKb * 1.02),
    })
    const facts = new Map(WHITE_PAPERS.map((p) => [resolvePdfPath(p.pdfPath), slightlyOff(p)]))
    const drift = detectDrift(WHITE_PAPERS, (abs) => {
      const f = facts.get(abs)
      if (!f) throw new Error(`unexpected path: ${abs}`)
      return f
    })
    expect(drift).toEqual([])
  })

  test('size tolerance rejects > 5% wobble', () => {
    const wayOff = (paper: (typeof WHITE_PAPERS)[number]): PdfFacts => ({
      pages: paper.pages,
      sizeKb: Math.round(paper.sizeKb * 1.2),
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
})

describe('whitepaper copy hygiene', () => {
  test('body copy does not lean on version-history framing', () => {
    const source = readFileSync(whitePapersSrc, 'utf8')

    for (const phrase of forbiddenPhrases) {
      // Plain substring search across the file.
      expect(
        source.toLowerCase().includes(phrase.toLowerCase()),
        `whitePapers.ts must not contain phrase: "${phrase}". Speak only of the now.`,
      ).toBe(false)
    }
  })

  test('"pre-print" appears only inside the status field', () => {
    const source = readFileSync(whitePapersSrc, 'utf8')
    // Find every line that mentions pre-print (case-insensitive).
    const offending: string[] = []
    const lines = source.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!/pre-?print/i.test(line)) continue
      // Allowed: a `status: '...Pre-print...'` line.
      if (/^\s*status:\s*['"][^'"]*['"]\s*,?\s*$/.test(line)) continue
      offending.push(`${i + 1}: ${line.trim()}`)
    }
    expect(
      offending,
      offending.length
        ? `"pre-print" must only appear in status: fields. Offending lines:\n${offending.join('\n')}`
        : 'ok',
    ).toEqual([])
  })
})
