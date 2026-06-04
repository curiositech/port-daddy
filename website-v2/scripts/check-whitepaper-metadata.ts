#!/usr/bin/env tsx
/**
 * check-whitepaper-metadata.ts
 *
 * Verifies that `website-v2/src/data/whitePapers.ts` `pages` / `sizeKb`
 * metadata stays in sync with the actual PDFs shipped under
 * `website-v2/public/whitepaper/`.
 *
 * Tolerances:
 *   - `pages`  : exact match required.
 *   - `sizeKb` : within 5% of the on-disk size (LaTeX rebuilds produce
 *                small byte-level shifts even when content is unchanged).
 *
 * Exit codes:
 *   0  metadata is in sync (or pdfinfo unavailable in CI — warning only).
 *   1  drift detected.
 *
 * Usage:
 *   npx tsx scripts/check-whitepaper-metadata.ts          # check-only
 *   npx tsx scripts/check-whitepaper-metadata.ts --fix    # rewrite source
 *
 * Notes on safety: this script invokes `pdfinfo` via execFileSync with a
 * fixed argv (no shell), and all paths come from the in-repo whitePapers.ts
 * source — never from user input. No command injection surface.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WHITE_PAPERS } from '../src/data/whitePapers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(__dirname, '..')
const publicDir = resolve(websiteRoot, 'public')
const whitePapersSrc = resolve(websiteRoot, 'src/data/whitePapers.ts')

const SIZE_TOLERANCE = 0.05 // 5%

export interface PdfFacts {
  pages: number
  sizeKb: number
}

export interface DriftReport {
  id: string
  pdfPath: string
  expected: { pages: number; sizeKb: number }
  actual: PdfFacts
  pagesDrift: boolean
  sizeDrift: boolean
}

/**
 * Returns true if `pdfinfo` is on PATH and runnable.
 */
export function pdfinfoAvailable(): boolean {
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'pipe' })
    return true
  } catch (err) {
    // `pdfinfo -v` writes to stderr and exits 99 on poppler builds; the
    // binary IS present in that case. Only treat ENOENT as missing.
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return false
    return true
  }
}

/**
 * Resolves a paper's `pdfPath` (web-absolute, e.g. `/whitepaper/foo.pdf`)
 * to an on-disk absolute path under `website-v2/public/`.
 */
export function resolvePdfPath(pdfPath: string): string {
  return resolve(publicDir, pdfPath.replace(/^\//, ''))
}

/**
 * Reads page count + byte size from a PDF via `pdfinfo`.
 * Throws if pdfinfo fails or the Pages field is absent.
 */
export function pdfFactsFromDisk(absPath: string): PdfFacts {
  const bytes = statSync(absPath).size
  const sizeKb = Math.round(bytes / 1024)

  const output = execFileSync('pdfinfo', [absPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const match = output.match(/^Pages:\s+(\d+)\s*$/m)
  if (!match) {
    throw new Error(`pdfinfo did not report Pages for ${absPath}`)
  }
  return { pages: Number(match[1]), sizeKb }
}

/**
 * Compares metadata against on-disk PDFs.
 * Pure: takes a `getFacts` callback so it is unit-testable.
 */
export function detectDrift(
  papers: readonly { id: string; pdfPath: string; pages: number; sizeKb: number }[],
  getFacts: (absPath: string) => PdfFacts = pdfFactsFromDisk,
): DriftReport[] {
  const reports: DriftReport[] = []
  for (const paper of papers) {
    const absPath = resolvePdfPath(paper.pdfPath)
    if (!existsSync(absPath)) {
      throw new Error(`Whitepaper PDF missing on disk: ${absPath} (declared as ${paper.pdfPath})`)
    }
    const actual = getFacts(absPath)
    const pagesDrift = actual.pages !== paper.pages
    const sizeDrift =
      Math.abs(actual.sizeKb - paper.sizeKb) / Math.max(paper.sizeKb, 1) > SIZE_TOLERANCE
    if (pagesDrift || sizeDrift) {
      reports.push({
        id: paper.id,
        pdfPath: paper.pdfPath,
        expected: { pages: paper.pages, sizeKb: paper.sizeKb },
        actual,
        pagesDrift,
        sizeDrift,
      })
    }
  }
  return reports
}

/**
 * Rewrites `whitePapers.ts` in place, replacing the `pages` and `sizeKb`
 * literals inside each paper's object literal. Other fields untouched.
 *
 * Strategy: locate the per-paper object by its `id: '<id>'` line, then
 * within that object's slice swap the two numeric literals. No AST dep.
 */
export function rewriteMetadata(
  source: string,
  updates: Map<string, { pages: number; sizeKb: number }>,
): string {
  let out = source
  for (const [id, next] of updates) {
    const idRe = new RegExp(`(id:\\s*['"]${escapeRegex(id)}['"])`)
    const idMatch = idRe.exec(out)
    if (!idMatch) {
      throw new Error(`Could not find id: '${id}' in whitePapers.ts to rewrite`)
    }
    // Slice from the id match through the next `  },\n` that closes this
    // object. The whitepaper objects all sit in an array, so finding the
    // next 2–4-space-indented `},` line is reliable here without an AST.
    const start = idMatch.index
    const tail = out.slice(start)
    const closeMatch = tail.match(/\n\s{2,4}\},\n/)
    if (!closeMatch || closeMatch.index === undefined) {
      throw new Error(`Could not find closing brace for paper '${id}'`)
    }
    const end = start + closeMatch.index + closeMatch[0].length
    const slice = out.slice(start, end)

    const updated = slice
      .replace(/(pages:\s*)\d+/, `$1${next.pages}`)
      .replace(/(sizeKb:\s*)\d+/, `$1${next.sizeKb}`)

    out = out.slice(0, start) + updated + out.slice(end)
  }
  return out
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatReport(reports: DriftReport[]): string {
  const lines: string[] = []
  lines.push('Whitepaper metadata drift detected:')
  lines.push('')
  for (const r of reports) {
    lines.push(`  - ${r.id} (${r.pdfPath})`)
    if (r.pagesDrift) {
      lines.push(`      pages:  metadata=${r.expected.pages}  pdf=${r.actual.pages}`)
    }
    if (r.sizeDrift) {
      lines.push(
        `      sizeKb: metadata=${r.expected.sizeKb}  pdf=${r.actual.sizeKb} (tolerance 5%)`,
      )
    }
  }
  lines.push('')
  lines.push('Run `npx tsx scripts/check-whitepaper-metadata.ts --fix` to resync.')
  return lines.join('\n')
}

function main(argv: string[]): number {
  const fix = argv.includes('--fix')

  if (!pdfinfoAvailable()) {
    const msg = [
      'WARNING: pdfinfo not found on PATH. Skipping whitepaper metadata check.',
      '  Install: brew install poppler   (macOS)',
      '           apt-get install poppler-utils   (Linux)',
      'CI runners without pdfinfo should be fixed so this check actually runs.',
    ].join('\n')
    console.warn(msg)
    return 0
  }

  let reports: DriftReport[]
  try {
    reports = detectDrift(WHITE_PAPERS)
  } catch (err) {
    console.error(`Whitepaper metadata check failed: ${(err as Error).message}`)
    return 1
  }

  if (reports.length === 0) {
    console.log(`Whitepaper metadata in sync (${WHITE_PAPERS.length} papers checked).`)
    return 0
  }

  console.error(formatReport(reports))

  if (!fix) return 1

  const updates = new Map<string, { pages: number; sizeKb: number }>()
  for (const r of reports) {
    updates.set(r.id, { pages: r.actual.pages, sizeKb: r.actual.sizeKb })
  }
  const original = readFileSync(whitePapersSrc, 'utf8')
  const next = rewriteMetadata(original, updates)
  if (next === original) {
    console.error('--fix requested, but rewriteMetadata produced no change. Inspect manually.')
    return 1
  }
  writeFileSync(whitePapersSrc, next, 'utf8')
  console.log(
    `Rewrote ${whitePapersSrc} with corrected pages/sizeKb for ${updates.size} paper(s).`,
  )
  return 0
}

// Run when invoked directly (tsx / node), but not when imported by tests.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
