/**
 * snapshot-recordings.mjs — approval test for the terminal recordings.
 *
 * The recordings job (.github/workflows/ci.yml) regenerates every .cast from the
 * real compiled daemon (`npm run record:gifs`) and then runs the reviewer. This
 * adds a *drift gate*: each cast's behavioral transcript (scripts/lib/cast-
 * transcript.mjs — timing dropped, ephemerals scrubbed) is compared to a
 * committed golden under recordings-snapshots/. If a recorded command's output
 * changed, the golden no longer matches and the check FAILS with a diff.
 *
 *   node scripts/snapshot-recordings.mjs            # --check (default): fail on drift
 *   node scripts/snapshot-recordings.mjs --update   # re-baseline goldens (the HiTL OK)
 *
 * The human-in-the-loop gate: drift turns the required `website-terminal-
 * recordings` check red. The only way to green it is to inspect the diff and, if
 * the change is intended, run `--update` and COMMIT the new transcript — that
 * commit, visible in the PR, is the explicit approval.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve, relative } from 'node:path'
import { castToTranscript, scrubEphemerals } from './lib/cast-transcript.mjs'

const websiteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const castsDir = join(websiteRoot, 'public/casts')
const snapDir = join(websiteRoot, 'recordings-snapshots')
const mode = process.argv.includes('--update') ? 'update' : 'check'

function findCasts(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findCasts(abs))
    else if (entry.name.endsWith('.cast')) out.push(abs)
  }
  return out
}

const snapPathFor = (castAbs) => join(snapDir, relative(castsDir, castAbs).replace(/\.cast$/, '.txt'))

// Minimal dependency-free unified diff (LCS over lines; transcripts are small).
function unifiedDiff(aText, bText, label) {
  const a = aText.split('\n')
  const b = bText.split('\n')
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const lines = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`)
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i++]}`)
    } else {
      lines.push(`+ ${b[j++]}`)
    }
  }
  while (i < n) lines.push(`- ${a[i++]}`)
  while (j < m) lines.push(`+ ${b[j++]}`)
  // Show only changed regions with a little context, so big transcripts stay readable.
  const changed = lines.filter((l) => l[0] !== ' ')
  const head = changed.slice(0, 40)
  const more = changed.length - head.length
  return [`--- golden: ${label}`, ...head, more > 0 ? `… (+${more} more changed lines)` : ''].filter(Boolean).join('\n')
}

const casts = findCasts(castsDir).sort()
if (casts.length === 0) {
  console.error('snapshot-recordings: no .cast files under public/casts — nothing to snapshot')
  process.exit(1)
}

const drift = []
const missingGolden = []
const idempotencyBugs = []
let created = 0
let updated = 0
let ok = 0

for (const cast of casts) {
  const rel = relative(castsDir, cast)
  const transcript = castToTranscript(readFileSync(cast, 'utf8'))
  // Safety: the normalizer must be idempotent, or CI would flake on its own output.
  if (scrubEphemerals(transcript) !== transcript) idempotencyBugs.push(rel)
  const snap = snapPathFor(cast)
  if (mode === 'update') {
    mkdirSync(dirname(snap), { recursive: true })
    const prev = existsSync(snap) ? readFileSync(snap, 'utf8') : null
    writeFileSync(snap, transcript)
    if (prev === null) created++
    else if (prev !== transcript) updated++
  } else {
    if (!existsSync(snap)) {
      missingGolden.push(rel)
      continue
    }
    const golden = readFileSync(snap, 'utf8')
    if (golden !== transcript) drift.push(unifiedDiff(golden, transcript, rel))
    else ok++
  }
}

if (idempotencyBugs.length) {
  console.error('snapshot-recordings: normalizer is NOT idempotent (would flake) for:')
  for (const r of idempotencyBugs) console.error(`  - ${r}`)
  console.error('Fix scripts/lib/cast-transcript.mjs before relying on snapshots.')
  process.exit(2)
}

if (mode === 'update') {
  console.log(`snapshot-recordings: updated goldens — ${created} created, ${updated} changed, ${casts.length} total`)
  process.exit(0)
}

if (missingGolden.length || drift.length) {
  console.error('\n════ terminal-recording drift detected ════\n')
  if (missingGolden.length) {
    console.error('No golden transcript for these recordings (new or renamed):')
    for (const r of missingGolden) console.error(`  - ${r}`)
    console.error('')
  }
  for (const d of drift) {
    console.error(d)
    console.error('')
  }
  console.error('These recordings are living integration tests: a recorded CLI command now')
  console.error('prints different output (ephemerals like ports/ids/timestamps are already')
  console.error('scrubbed, so this is a REAL behavior change).')
  console.error('')
  console.error('If the change is intended, approve it (HiTL):')
  console.error('  cd website-v2 && npm run snapshot:update')
  console.error('  git add website-v2/recordings-snapshots && git commit')
  console.error('The committed transcript diff, reviewed in the PR, is the approval.\n')
  process.exit(1)
}

console.log(`snapshot-recordings: ${ok}/${casts.length} recordings match their golden transcript`)
