import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { checkBookSpreads } from './check-book-spreads.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const scratch = resolve(repoRoot, '.cache/book-spreads-guard-tests')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

function fixture(t, pages = 4) {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(resolve(scratch, 'case-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = resolve(root, 'website-v2/public/whitepaper')
  mkdirSync(directory, { recursive: true })
  mkdirSync(resolve(root, 'scripts'))
  // Header-bearing byte fixtures exercise integrity checks, not PDF parsing.
  const source = Buffer.from('%PDF-1.7\ncanonical source\n%%EOF\n')
  const output = Buffer.from('%PDF-1.7\nfacing output\n%%EOF\n')
  const builder = Buffer.from('# deterministic conversion fixture\n')
  const receipt = {
    schema_version: 1,
    status: 'pass',
    source: { file: 'coordination-papers-mega-volume.pdf', sha256: hash(source), bytes: source.length, pages },
    output: { file: 'coordination-papers-mega-volume-spreads.pdf', sha256: hash(output), bytes: output.length, pages: Math.ceil((pages + 1) / 2) },
    builder: { sha256: hash(builder), pymupdf: '1.26.7' },
    verification: { glyphs: 20, links: 2, bookmarks: 1, named_destinations: 1, blank_halves: Math.ceil((pages + 1) / 2) * 2 - pages, coordinate_tolerance_pt: 0.025, maximum_coordinate_error_pt: 0.0001, exact_character_streams: true, every_character_position_checked: true, bookmark_states_checked: true },
  }
  const receiptPath = resolve(directory, 'coordination-papers-mega-volume-spreads.json')
  const save = () => writeFileSync(receiptPath, JSON.stringify(receipt))
  writeFileSync(resolve(directory, receipt.source.file), source)
  writeFileSync(resolve(directory, receipt.output.file), output)
  writeFileSync(resolve(root, 'scripts/build_facing_pdf.py'), builder)
  save()
  return { root, directory, receipt, receiptPath, save }
}

test('accepts intact pairs for even and odd source page counts', (t) => {
  for (const pages of [1, 3, 4, 844]) {
    const f = fixture(t, pages)
    assert.deepEqual(checkBookSpreads({ repoRoot: f.root }), f.receipt)
  }
})

test('rejects changed canonical or facing bytes even when their lengths match', (t) => {
  for (const field of ['source', 'output']) {
    const f = fixture(t)
    const path = resolve(f.directory, f.receipt[field].file)
    const bytes = readFileSync(path)
    bytes[15] ^= 1
    writeFileSync(path, bytes)
    assert.throws(() => checkBookSpreads({ repoRoot: f.root }), /SHA-256 differs/)
  }
})

test('rejects a PDF-looking response with a non-PDF header even if hashes agree', (t) => {
  const f = fixture(t)
  const bytes = Buffer.from('<html>the missing asset shell</html>')
  writeFileSync(resolve(f.directory, f.receipt.output.file), bytes)
  f.receipt.output.sha256 = hash(bytes)
  f.receipt.output.bytes = bytes.length
  f.save()
  assert.throws(() => checkBookSpreads({ repoRoot: f.root }), /missing PDF header/)
})

test('fails closed on missing receipt, PDF or builder', (t) => {
  for (const target of ['receipt', 'source', 'output', 'builder']) {
    const f = fixture(t)
    const path = target === 'receipt' ? f.receiptPath
      : target === 'builder' ? resolve(f.root, 'scripts/build_facing_pdf.py')
        : resolve(f.directory, f.receipt[target].file)
    rmSync(path)
    assert.throws(() => checkBookSpreads({ repoRoot: f.root }), /ENOENT/)
  }
})

test('rejects malformed records, unsafe filenames and inconsistent page geometry', (t) => {
  const cases = [
    [(r) => { r.schema_version = 2 }, /schema/],
    [(r) => { r.status = 'fail' }, /passing verification/],
    [(r) => { r.verification.bookmark_states_checked = false }, /expansion-state checks/],
    [(r) => { r.verification.exact_character_streams = false }, /glyph and position/],
    [(r) => { r.verification.maximum_coordinate_error_pt = 0.1 }, /exceeds/],
    [(r) => { r.source.file = '../other.pdf' }, /canonical PDF filename/],
    [(r) => { r.output.file = 'another.pdf' }, /canonical PDF filename/],
    [(r) => { r.source.pages = 0 }, /pages must/],
    [(r) => { r.output.bytes = 1.5 }, /bytes must/],
    [(r) => { r.source.bytes += 1 }, /byte size differs/],
    [(r) => { r.output.sha256 = 'wrong' }, /invalid SHA-256/],
    [(r) => { r.output.pages -= 1 }, /page count/],
    [(r) => { r.verification.blank_halves = 0 }, /Blank-half count/],
    [(r) => { r.verification.links = -1 }, /verification count/],
    [(r) => { r.verification.coordinate_tolerance_pt = 0 }, /coordinate tolerance/],
    [(r) => { delete r.builder.pymupdf }, /renderer version/],
  ]
  for (const [change, message] of cases) {
    const f = fixture(t)
    change(f.receipt)
    f.save()
    assert.throws(() => checkBookSpreads({ repoRoot: f.root }), message)
  }
})

test('rejects changed conversion logic without a new conversion receipt', (t) => {
  const f = fixture(t)
  writeFileSync(resolve(f.root, 'scripts/build_facing_pdf.py'), '# changed conversion logic\n')
  assert.throws(() => checkBookSpreads({ repoRoot: f.root }), /builder differs/)
})
