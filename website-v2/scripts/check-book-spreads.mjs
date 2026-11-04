#!/usr/bin/env node
/** Verify the published facing copy is bound to the canonical Book bytes.
 * The Python builder verifies PDF geometry and navigation. This lightweight
 * deployment guard verifies that its accepted inputs and outputs have not moved.
 * It never repairs a receipt: new Book bytes require a fresh conversion.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = 'coordination-papers-mega-volume.pdf'
const OUTPUT = 'coordination-papers-mega-volume-spreads.pdf'
const RECEIPT = 'coordination-papers-mega-volume-spreads.json'
const BUILDER = 'scripts/build_facing_pdf.py'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isCount = (n) => Number.isSafeInteger(n) && n >= 0
const isPositiveInteger = (n) => isCount(n) && n > 0
const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

function checkPdfRecord(record, filename, directory) {
  requireThat(record?.file === filename, `Expected canonical PDF filename ${filename}`)
  requireThat(isPositiveInteger(record.pages), `${filename}: pages must be a positive integer`)
  requireThat(isPositiveInteger(record.bytes), `${filename}: bytes must be a positive integer`)
  requireThat(isSha256(record.sha256), `${filename}: invalid SHA-256`)
  const bytes = readFileSync(resolve(directory, filename))
  requireThat(bytes.subarray(0, 5).toString('ascii') === '%PDF-', `${filename}: missing PDF header`)
  requireThat(bytes.length === record.bytes, `${filename}: byte size differs from receipt`)
  requireThat(sha256(bytes) === record.sha256, `${filename}: SHA-256 differs from receipt`)
}

export function checkBookSpreads({ repoRoot = defaultRepoRoot } = {}) {
  const directory = resolve(repoRoot, 'website-v2/public/whitepaper')
  const receipt = JSON.parse(readFileSync(resolve(directory, RECEIPT), 'utf8'))
  requireThat(receipt?.schema_version === 1, 'Unsupported facing-copy receipt schema')
  requireThat(receipt.status === 'pass', 'Facing-copy conversion has no passing verification')
  checkPdfRecord(receipt.source, SOURCE, directory)
  checkPdfRecord(receipt.output, OUTPUT, directory)
  requireThat(
    receipt.output.pages === Math.ceil((receipt.source.pages + 1) / 2),
    'Facing-copy page count must include the blank half before the cover',
  )
  requireThat(isSha256(receipt.builder?.sha256), 'Invalid builder SHA-256')
  requireThat(
    sha256(readFileSync(resolve(repoRoot, BUILDER))) === receipt.builder.sha256,
    'Facing-copy builder differs from the verified conversion',
  )
  requireThat(
    typeof receipt.builder.pymupdf === 'string' && receipt.builder.pymupdf.length > 0,
    'Missing PDF renderer version',
  )
  const verification = receipt.verification
  requireThat(verification?.bookmark_states_checked === true, 'Facing-copy receipt must attest to bookmark expansion-state checks')
  requireThat(
    verification?.exact_character_streams === true && verification?.every_character_position_checked === true,
    'Facing-copy receipt must attest to complete glyph and position checks',
  )
  for (const field of ['glyphs', 'links', 'bookmarks', 'named_destinations', 'blank_halves']) {
    requireThat(isCount(verification?.[field]), `Missing or invalid verification count: ${field}`)
  }
  requireThat(
    verification.blank_halves === receipt.output.pages * 2 - receipt.source.pages,
    'Blank-half count disagrees with the Book and facing-copy page counts',
  )
  requireThat(
    Number.isFinite(verification.coordinate_tolerance_pt) && verification.coordinate_tolerance_pt > 0,
    'Missing or invalid glyph coordinate tolerance',
  )
  requireThat(
    Number.isFinite(verification.maximum_coordinate_error_pt) && verification.maximum_coordinate_error_pt >= 0
      && verification.maximum_coordinate_error_pt <= verification.coordinate_tolerance_pt,
    'Verified glyph coordinate error exceeds the recorded tolerance',
  )
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = checkBookSpreads()
    console.log(`Book facing copy verified: ${receipt.source.pages} pages, ${receipt.output.pages} spreads; source, output and builder hashes match.`)
  } catch (error) {
    console.error(`Book facing copy failed: ${error.message}`)
    console.error('Regenerate with scripts/build-spreads.sh after accepting the canonical Book PDF, then commit both formats and the conversion receipt together.')
    process.exitCode = 1
  }
}
