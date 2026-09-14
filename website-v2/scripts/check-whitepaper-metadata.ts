#!/usr/bin/env tsx
/**
 * check-whitepaper-metadata.ts
 *
 * Verifies that `website-v2/src/data/whitePapers.ts` `pages` / `sizeKb`
 * metadata stays in sync with the actual PDFs shipped under
 * `website-v2/public/whitepaper/`.
 *
 * Tolerances:
 *   - `pages`  : never pinned exactly. Two rules instead — an absolute floor
 *                that catches a broken artifact, and a `max(5%, 4 pages)`
 *                drift band against the recorded baseline that fails loudly
 *                on a large move and says what to do about it. The policy and
 *                its derivation live in scripts/page-count-policy.ts.
 *   - `sizeKb` : within `max(2%, 4 KB)` of the on-disk size. Percentage
 *                catches drift on large PDFs; the 4 KB floor keeps small
 *                LaTeX rebuilds (where the same content can wobble by a
 *                kilobyte or two) from spuriously failing.
 *
 * Exit codes:
 *   0  metadata is in sync.
 *   1  drift detected, or pdfinfo missing under CI (CI=true).
 *
 * Behavior on missing pdfinfo:
 *   - Local dev (CI != 'true'): warn and skip (return 0).
 *   - CI         (CI === 'true'): hard fail (return 1).
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
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project, SyntaxKind, type ObjectLiteralExpression } from 'ts-morph'
import { COLLECTED_VOLUME, WHITE_PAPERS, type CollectedVolumeEdition } from '../src/data/whitePapers'
import { RESEARCH_PAPERS } from '../src/data/researchPapers'
import {
  formatDriftFailure,
  formatFloorFailure,
  locateBaseline,
  pagesAboveFloor,
  pagesWithinBand,
  type PageCountSubject,
} from './page-count-policy'

const __dirname = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(__dirname, '..')
const publicDir = resolve(websiteRoot, 'public')

/**
 * Splits the Book's alternate-typography editions (Swiss, Technical) into
 * PDFs that exist on disk and PDFs that don't yet. Every other entry this
 * script checks is expected to already be published; these two are a
 * deliberate exception until CI's first regeneration lands (they are new
 * driver roots — see scripts/build-whitepapers.sh — with no committed PDF
 * yet in a fresh worktree). A missing edition PDF is reported as a WARN and
 * excluded from drift/digest checking; it is never treated as a failure and
 * never gets a fabricated entry in publication-digests.json.
 */
function partitionEditions(
  editions: CollectedVolumeEdition[],
): { present: CollectedVolumeEdition[]; missing: CollectedVolumeEdition[] } {
  const present: CollectedVolumeEdition[] = []
  const missing: CollectedVolumeEdition[] = []
  for (const edition of editions) {
    if (existsSync(resolvePdfPath(edition.pdfPath))) {
      present.push(edition)
    } else {
      missing.push(edition)
    }
  }
  return { present, missing }
}

const { present: presentEditions, missing: missingEditions } = partitionEditions(COLLECTED_VOLUME.editions ?? [])

// The eight chapters no longer publish a standalone PDF (retired: an A4
// render of the same words with no margin column). WHITE_PAPERS entries
// therefore carry no `pdfPath` and are not in this list — there is nothing on
// disk left to drift-check them against. Only the Book itself, and its
// alternate-typography editions once their PDF exists (see
// partitionEditions above), are checked here.
const PUBLISHED_WHITEPAPER_PDFS = [COLLECTED_VOLUME, ...presentEditions]
// The standalone research papers (public/research/paperN.pdf) declare pages and
// sizeKb in researchPapers.ts and drift the same way; they had no guard before.
const PUBLISHED_RESEARCH_PDFS = RESEARCH_PAPERS
const whitePapersSrc = resolve(websiteRoot, 'src/data/whitePapers.ts')
const researchPapersSrc = resolve(websiteRoot, 'src/data/researchPapers.ts')
const repoRoot = resolve(websiteRoot, '..')
/**
 * SHA-256, page count and byte size of every committed publication PDF (the
 * Book and the seven chapters). The jest publication-contract tests pin against
 * this file instead of against literals, so a regenerated PDF is one `--fix`
 * away from green instead of a hand edit in two test files.
 */
export const publicationDigestsPath = resolve(publicDir, 'whitepaper/publication-digests.json')

/**
 * sizeKb drift tolerance is `max(SIZE_TOLERANCE_PCT * expected, SIZE_FLOOR_KB)`.
 * - 2% catches real content drift on the 800+KB papers (±17 KB on 863 KB).
 * - 4 KB floor keeps tiny PDFs from tripping on deterministic LaTeX wobble.
 */
const SIZE_TOLERANCE_PCT = 0.02
const SIZE_FLOOR_KB = 4

function sizeWithinTolerance(actualKb: number, expectedKb: number): boolean {
  const allowed = Math.max(expectedKb * SIZE_TOLERANCE_PCT, SIZE_FLOOR_KB)
  return Math.abs(actualKb - expectedKb) <= allowed
}

export interface PdfFacts {
  pages: number
  sizeKb: number
}

export interface DriftReport {
  id: string
  /** The record's human name, when the registry carries one. */
  title?: string
  pdfPath: string
  expected: { pages: number; sizeKb: number }
  actual: PdfFacts
  /** The built PDF came out under this document's absolute page floor. */
  pagesFloorDrift: boolean
  /** The built PDF left the `max(5%, 4 pages)` band around the baseline. */
  pagesBandDrift: boolean
  /** Either page rule broke. Kept so callers can ask one question. */
  pagesDrift: boolean
  sizeDrift: boolean
}

/**
 * Returns true if `pdfinfo` is on PATH and runnable.
 *
 * `pdfinfo -v` writes to stderr and exits with status 99 on poppler builds;
 * that is a "present, just talked back" case and counts as available.
 * Any other failure mode (ENOENT, EACCES, ETIMEDOUT, EPIPE, corrupted
 * binary, sandboxed PATH...) returns false with the reason logged so the
 * caller can decide whether to soft-skip or hard-fail.
 */
export function pdfinfoAvailable(): boolean {
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'pipe' })
    return true
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number | null }
    // poppler's `pdfinfo -v` exits 99 with version info on stderr. That's
    // "binary present" — not an error from our perspective.
    if (typeof e.status === 'number' && e.status === 99) return true
    const code = e.code ?? 'unknown'
    console.warn(`pdfinfoAvailable: treating as missing (code=${code}, msg=${e.message})`)
    return false
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
 *
 * `pages` is not compared for equality. The declared count is a recorded
 * baseline, not a mirror: a rebuild that reflows by a page or two is normal and
 * says nothing, while a rebuild that leaves the `max(5%, 4 pages)` band, or
 * lands under the document's floor, is reported and explained. See
 * scripts/page-count-policy.ts.
 */
export function detectDrift(
  papers: readonly { id: string; title?: string; pdfPath: string; pages: number; sizeKb: number }[],
  getFacts: (absPath: string) => PdfFacts = pdfFactsFromDisk,
): DriftReport[] {
  const reports: DriftReport[] = []
  for (const paper of papers) {
    const absPath = resolvePdfPath(paper.pdfPath)
    if (!existsSync(absPath)) {
      throw new Error(`Whitepaper PDF missing on disk: ${absPath} (declared as ${paper.pdfPath})`)
    }
    const actual = getFacts(absPath)
    const pagesFloorDrift = !pagesAboveFloor(actual.pages, paper.id)
    const pagesBandDrift = !pagesFloorDrift && !pagesWithinBand(actual.pages, paper.pages)
    const pagesDrift = pagesFloorDrift || pagesBandDrift
    const sizeDrift = !sizeWithinTolerance(actual.sizeKb, paper.sizeKb)
    if (pagesDrift || sizeDrift) {
      reports.push({
        id: paper.id,
        title: paper.title,
        pdfPath: paper.pdfPath,
        expected: { pages: paper.pages, sizeKb: paper.sizeKb },
        actual,
        pagesFloorDrift,
        pagesBandDrift,
        pagesDrift,
        sizeDrift,
      })
    }
  }
  return reports
}


/**
 * Every record whose declared pages/sizeKb differ from the PDF at all, in any
 * direction and by any amount. This is what `--fix` writes back; `detectDrift`
 * is what the check fails on. They are deliberately different questions: "is
 * this number stale?" and "has this number moved far enough that a person
 * should look?".
 */
export function detectResync(
  papers: readonly { id: string; pdfPath: string; pages: number; sizeKb: number }[],
  getFacts: (absPath: string) => PdfFacts = pdfFactsFromDisk,
): Map<string, { pages: number; sizeKb: number }> {
  const updates = new Map<string, { pages: number; sizeKb: number }>()
  for (const paper of papers) {
    const absPath = resolvePdfPath(paper.pdfPath)
    if (!existsSync(absPath)) continue
    const actual = getFacts(absPath)
    if (actual.pages !== paper.pages || actual.sizeKb !== paper.sizeKb) {
      updates.set(paper.id, { pages: actual.pages, sizeKb: actual.sizeKb })
    }
  }
  return updates
}

export interface PdfDigest {
  pages: number
  bytes: number
  sha256: string
}

export interface DigestDrift {
  repoPath: string
  expected: PdfDigest | null
  actual: PdfDigest | null
}

/** Repo-relative POSIX path, the key used in publication-digests.json. */
export function repoRelativePath(absPath: string): string {
  return relative(repoRoot, absPath).split(sep).join('/')
}

export function digestForPdf(absPath: string, getFacts: (absPath: string) => PdfFacts = pdfFactsFromDisk): PdfDigest {
  const buf = readFileSync(absPath)
  return {
    pages: getFacts(absPath).pages,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  }
}

export function readPublicationDigests(path: string = publicationDigestsPath): Record<string, PdfDigest> {
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { pdfs?: Record<string, PdfDigest> }
  return parsed.pdfs ?? {}
}

export function renderPublicationDigests(pdfs: Record<string, PdfDigest>): string {
  const sorted = Object.fromEntries(Object.keys(pdfs).sort().map((k) => [k, pdfs[k]]))
  return `${JSON.stringify(
    {
      $comment:
        'Generated by `npm run fix:whitepaper-metadata` in website-v2. SHA-256, page count and byte size of every committed publication PDF; tests/purser/whitepaper-hashes.test.js and tests/unit/spawn-whitepaper-contract.test.js pin against it. Do not edit by hand.',
      pdfs: sorted,
    },
    null,
    2,
  )}\n`
}

/**
 * Compares the committed publication PDFs against publication-digests.json.
 * Pure given `getFacts` and `expected`, so it is unit-testable.
 */
export function detectDigestDrift(
  papers: readonly { pdfPath: string }[],
  expected: Record<string, PdfDigest> = readPublicationDigests(),
  getFacts: (absPath: string) => PdfFacts = pdfFactsFromDisk,
): { drifts: DigestDrift[]; actual: Record<string, PdfDigest> } {
  const actual: Record<string, PdfDigest> = {}
  const drifts: DigestDrift[] = []
  for (const paper of papers) {
    const absPath = resolvePdfPath(paper.pdfPath)
    if (!existsSync(absPath)) {
      throw new Error(`Whitepaper PDF missing on disk: ${absPath} (declared as ${paper.pdfPath})`)
    }
    const key = repoRelativePath(absPath)
    const digest = digestForPdf(absPath, getFacts)
    actual[key] = digest
    const want = expected[key] ?? null
    if (!want || want.sha256 !== digest.sha256 || want.pages !== digest.pages || want.bytes !== digest.bytes) {
      drifts.push({ repoPath: key, expected: want, actual: digest })
    }
  }
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) drifts.push({ repoPath: key, expected: expected[key], actual: null })
  }
  return { drifts, actual }
}

export function formatDigestReport(drifts: DigestDrift[]): string {
  const lines = [`Publication digests drift (${drifts.length}):`, '']
  for (const d of drifts) {
    if (!d.actual) {
      lines.push(`  ${d.repoPath}: listed in publication-digests.json but no longer published`)
    } else if (!d.expected) {
      lines.push(`  ${d.repoPath}: not listed in publication-digests.json (sha256 ${d.actual.sha256.slice(0, 12)}…)`)
    } else {
      lines.push(
        `  ${d.repoPath}: expected ${d.expected.pages}pp/${d.expected.bytes}B/${d.expected.sha256.slice(0, 12)}…, ` +
          `got ${d.actual.pages}pp/${d.actual.bytes}B/${d.actual.sha256.slice(0, 12)}…`,
      )
    }
  }
  lines.push('')
  lines.push('Run `npx tsx scripts/check-whitepaper-metadata.ts --fix` to resync.')
  return lines.join('\n')
}

/**
 * Rewrites `whitePapers.ts` in place using a TypeScript AST edit (ts-morph),
 * replacing the `pages` and `sizeKb` literals inside each paper's object
 * literal. Other fields are untouched.
 *
 * Why AST and not regex: the previous regex implementation assumed a 2-4
 * space indent on the closing `},` and used first-match `.replace()` on
 * `pages: \d+`. That broke under Prettier reformat or any prose containing
 * `pages: <n>`. ts-morph navigates the object literal directly — there is
 * no surface for indent or prose to confuse it.
 *
 * Input contract: the source must define a `WHITE_PAPERS` array (either as
 * `WHITE_PAPERS = [...]` or as `defineWhitePapers([...])`) of object
 * literals each with an `id: '<string>'` property.
 */
export function rewriteMetadata(
  source: string,
  updates: Map<string, { pages: number; sizeKb: number }>,
): string {
  if (updates.size === 0) return source

  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile('whitePapers.ts', source, { overwrite: true })

  // Find every object literal that has an `id: '<known>'` property.
  const remaining = new Map(updates)
  const objectLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)

  for (const obj of objectLiterals) {
    if (remaining.size === 0) break
    const idValue = readStringProperty(obj, 'id')
    if (idValue === undefined) continue
    // Cross-reference edges ({ id: '<chapter>', why }) and other small records
    // reuse chapter ids; only the paper record itself carries `pages`.
    if (!obj.getProperty('pages')) continue
    const next = remaining.get(idValue)
    if (!next) continue

    setNumericProperty(obj, 'pages', next.pages, idValue)
    setNumericProperty(obj, 'sizeKb', next.sizeKb, idValue)
    remaining.delete(idValue)
  }

  if (remaining.size > 0) {
    const missing = [...remaining.keys()].join(', ')
    throw new Error(`rewriteMetadata: could not locate paper(s) by id: ${missing}`)
  }

  return sourceFile.getFullText()
}

function readStringProperty(obj: ObjectLiteralExpression, name: string): string | undefined {
  const prop = obj.getProperty(name)
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined
  const init = prop.getInitializer()
  if (!init) return undefined
  if (init.isKind(SyntaxKind.StringLiteral) || init.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return init.getLiteralText()
  }
  return undefined
}

function setNumericProperty(
  obj: ObjectLiteralExpression,
  name: string,
  value: number,
  paperIdForError: string,
): void {
  const prop = obj.getProperty(name)
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) {
    throw new Error(`rewriteMetadata: paper '${paperIdForError}' is missing the '${name}' property`)
  }
  prop.setInitializer(String(value))
}

/**
 * Builds the policy's description of one record: what to call it, and the exact
 * file and line holding the baseline a reader may need to edit.
 */
export function pageCountSubject(report: DriftReport, absSourcePath: string, displayPath: string): PageCountSubject {
  return {
    id: report.id,
    label: report.title ?? report.id,
    baselineLocation: locateBaseline(absSourcePath, report.id, displayPath),
    resyncCommand: 'npm run fix:whitepaper-metadata',
    resyncCommandCwd: 'website-v2/',
  }
}

function formatReport(reports: DriftReport[], absSourcePath: string, displayPath: string): string {
  const lines: string[] = []
  lines.push('Whitepaper metadata drift detected:')
  lines.push('')
  for (const r of reports) {
    lines.push(`  - ${r.id} (${r.pdfPath})`)
    // Page counts get the full policy message, not a two-number diff: whoever
    // reads this needs to know which of the two things happened and what to do.
    if (r.pagesFloorDrift) {
      lines.push(formatFloorFailure(pageCountSubject(r, absSourcePath, displayPath), r.actual.pages))
    } else if (r.pagesBandDrift) {
      lines.push(
        formatDriftFailure(pageCountSubject(r, absSourcePath, displayPath), r.expected.pages, r.actual.pages),
      )
    }
    if (r.sizeDrift) {
      const allowed = Math.max(r.expected.sizeKb * SIZE_TOLERANCE_PCT, SIZE_FLOOR_KB)
      lines.push(
        `      sizeKb: metadata=${r.expected.sizeKb}  pdf=${r.actual.sizeKb} ` +
          `(tolerance max(${(SIZE_TOLERANCE_PCT * 100).toFixed(0)}%, ${SIZE_FLOOR_KB}KB) = ±${allowed.toFixed(1)}KB)`,
      )
    }
  }
  lines.push('')
  lines.push('Run `npx tsx scripts/check-whitepaper-metadata.ts --fix` to resync.')
  return lines.join('\n')
}

function main(argv: string[]): number {
  const fix = argv.includes('--fix')

  for (const edition of missingEditions) {
    console.warn(
      `WARN: edition PDF not yet built: ${edition.pdfPath} (id=${edition.id}) — skipping metadata check ` +
        'until scripts/build-whitepapers.sh regenerates it (see coordination-papers-mega-volume-*.tex).',
    )
  }

  if (!pdfinfoAvailable()) {
    const inCI = process.env.CI === 'true'
    const lines = [
      'pdfinfo not found on PATH. Whitepaper metadata cannot be verified.',
      '  Install: brew install poppler   (macOS)',
      '           apt-get install -y poppler-utils   (Linux/CI)',
    ]
    if (inCI) {
      lines.unshift('ERROR: poppler missing in CI environment (CI=true).')
      lines.push('CI runners MUST have poppler installed so this check actually runs.')
      console.error(lines.join('\n'))
      return 1
    }
    lines.unshift('WARNING: skipping whitepaper metadata check (local dev).')
    lines.push('Set CI=true to make this a hard failure.')
    console.warn(lines.join('\n'))
    return 0
  }

  let chapterReports: DriftReport[]
  let researchReports: DriftReport[]
  let digests: { drifts: DigestDrift[]; actual: Record<string, PdfDigest> }
  try {
    chapterReports = detectDrift(PUBLISHED_WHITEPAPER_PDFS)
    researchReports = detectDrift(PUBLISHED_RESEARCH_PDFS)
    digests = detectDigestDrift(PUBLISHED_WHITEPAPER_PDFS)
  } catch (err) {
    console.error(`Whitepaper metadata check failed: ${(err as Error).message}`)
    return 1
  }
  const reports = [...chapterReports, ...researchReports]

  if (reports.length === 0 && digests.drifts.length === 0) {
    const editionsNote =
      presentEditions.length > 0 ? ` + ${presentEditions.length} Book edition(s)` : ''
    console.log(
      `Whitepaper metadata in sync (the Book (${WHITE_PAPERS.length} chapters)${editionsNote} + ${RESEARCH_PAPERS.length} research papers checked; publication digests match).`,
    )
    return 0
  }

  if (chapterReports.length > 0) {
    console.error(formatReport(chapterReports, whitePapersSrc, 'website-v2/src/data/whitePapers.ts'))
  }
  if (researchReports.length > 0) {
    console.error(formatReport(researchReports, researchPapersSrc, 'website-v2/src/data/researchPapers.ts'))
  }
  if (digests.drifts.length > 0) console.error(formatDigestReport(digests.drifts))

  if (!fix) return 1

  let rewrote = 0
  if (digests.drifts.length > 0) {
    writeFileSync(publicationDigestsPath, renderPublicationDigests(digests.actual), 'utf8')
    console.log(`Rewrote ${publicationDigestsPath} for ${digests.drifts.length} drifted digest(s).`)
    rewrote += digests.drifts.length
  }

  // Each registry is rewritten from its own resync list; an id never appears in
  // both. `--fix` resyncs on ANY divergence, not only on the ones the check
  // reports: the check tolerates a page or two of reflow so routine work stays
  // green, but the number the website prints should still be the true one. When
  // the move was large enough to fail the check, this is also the one-command
  // form of the baseline edit the failure message asks for — and it lands in
  // the diff, where a reviewer sees it.
  const targets: Array<[string, readonly { id: string; pdfPath: string; pages: number; sizeKb: number }[]]> = [
    [whitePapersSrc, PUBLISHED_WHITEPAPER_PDFS],
    [researchPapersSrc, PUBLISHED_RESEARCH_PDFS],
  ]
  for (const [src, papers] of targets) {
    const updates = detectResync(papers)
    if (updates.size === 0) continue
    const original = readFileSync(src, 'utf8')
    const next = rewriteMetadata(original, updates)
    if (next === original) {
      console.error(`--fix requested, but rewriteMetadata produced no change in ${src}. Inspect manually.`)
      return 1
    }
    writeFileSync(src, next, 'utf8')
    console.log(`Rewrote ${src} with corrected pages/sizeKb for ${updates.size} paper(s).`)
    rewrote += updates.size
  }
  return rewrote > 0 ? 0 : 1
}

// Run when invoked directly (tsx / node), but not when imported by tests.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
