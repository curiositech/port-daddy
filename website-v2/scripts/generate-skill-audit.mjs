#!/usr/bin/env node
/**
 * Regenerate website-v2/public/skill-audit.json from the live skill library.
 *
 * Runs at build time (wired into npm run prebuild) so every preview and
 * production deploy ships a fresh snapshot of the skill-hygiene audit.
 *
 * Delegates to python3 skills/skill-hygiene/scripts/audit_skill_library.py
 * with --no-persist (CI runs are stateless; the SQLite history is a local
 * developer concern, not a build artifact).
 *
 * This generator is the source half of a drift gate (generated-artifact-drift
 * in ci.yml): CI regenerates the snapshot and then `git diff --exit-code`s it.
 * That gate is only honest if a generator that CANNOT run fails LOUD. If it
 * exits 0 without regenerating, it leaves the committed snapshot untouched, the
 * diff is empty, and the required check goes GREEN while serving a frozen stale
 * dashboard — the exact silent-staleness failure #5497 had to clean up by hand.
 * So every path out of this script that did not produce a fresh, well-formed
 * snapshot is a NONZERO exit, and the "snapshot regenerated" line is printed
 * ONLY after we have proven on disk that regeneration actually happened.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '..')
const repoRoot = resolve(websiteRoot, '..')

const auditor = resolve(repoRoot, 'skills/skill-hygiene/scripts/audit_skill_library.py')
const skillsRoot = resolve(repoRoot, 'skills')
const snapshotPath = resolve(websiteRoot, 'public/skill-audit.json')

// A drift/hygiene gate whose generator cannot run must fail, not silently serve
// stale. There is a legitimate "auditor genuinely absent from this checkout"
// case (a partial clone, someone building only the website subtree), but it is
// rare enough that it must be OPTED INTO explicitly — never the default — so
// that a rename, move, or accidental deletion of the auditor reds the build
// instead of freezing the snapshot behind a green check. CI never sets this.
const allowMissingAuditor = process.env.PD_ALLOW_MISSING_AUDITOR === '1'

if (!existsSync(auditor)) {
  console.error(`[generate-skill-audit] auditor missing at ${auditor}`)
  if (allowMissingAuditor) {
    console.error('  PD_ALLOW_MISSING_AUDITOR=1 set; serving the committed snapshot as-is.')
    process.exit(0)
  }
  console.error('  Cannot regenerate the snapshot, so the committed copy cannot be trusted fresh.')
  console.error('  Set PD_ALLOW_MISSING_AUDITOR=1 only for checkouts that legitimately lack the auditor.')
  process.exit(1)
}

if (!existsSync(skillsRoot)) {
  console.error(`[generate-skill-audit] skills/ root missing at ${skillsRoot}`)
  if (allowMissingAuditor) {
    console.error('  PD_ALLOW_MISSING_AUDITOR=1 set; serving the committed snapshot as-is.')
    process.exit(0)
  }
  console.error('  Cannot regenerate the snapshot without the skill library to audit.')
  process.exit(1)
}

console.log(`[generate-skill-audit] regenerating ${snapshotPath}`)

// The snapshot's mtime BEFORE the run is our proof-of-write oracle. The auditor
// writes the snapshot only after its audit loop completes, so a Python
// traceback mid-loop exits nonzero WITHOUT touching the file — leaving the old,
// still-well-formed committed snapshot in place. Checking "is there a valid
// snapshot on disk" would pass on that stale file. Checking "did the mtime
// advance" is what actually distinguishes a real regeneration from a crash that
// left yesterday's snapshot untouched. The run audits hundreds of skills over
// several seconds, so mtime resolution is never a concern.
const priorMtimeMs = existsSync(snapshotPath) ? statSync(snapshotPath).mtimeMs : -1

// --deterministic strips run_id and generated_at so this committed file
// only diffs when actual audit findings change — no churn on rebuilds.
const result = spawnSync(
  'python3',
  [
    auditor,
    '--root',
    skillsRoot,
    '--snapshot',
    snapshotPath,
    '--no-persist',
    '--deterministic',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
)

if (result.error) {
  console.error('[generate-skill-audit] failed to spawn python3:', result.error.message)
  process.exit(1)
}

// Exit-code semantics of the auditor: 0 = clean, 1 = findings present, 2+ =
// malformed bundle / usage error. We deliberately do NOT red the website build
// on the auditor's FINDINGS verdict — a red skill bundle is skill-hygiene's job,
// and the website should ship truth including bad news, so exit 1 stays viable.
//
// BUT a Python traceback ALSO exits 1, indistinguishable from findings by the
// status code alone. We refuse to trust the status code as a proxy for "the run
// succeeded." The only thing that proves success is a fresh, well-formed
// snapshot on disk. So: exit >=2 is an unambiguous hard failure; for 0 and 1 we
// fall through to verify the snapshot itself, which is what actually gates.
if (result.status !== 0 && result.status !== 1) {
  console.error(`[generate-skill-audit] auditor exited with status ${result.status}`)
  process.exit(result.status ?? 1)
}

// Proof of regeneration, in two parts, both required.
//
// (1) The snapshot's mtime must have advanced past what it was before the run.
//     If it did not, the auditor did not reach its write step — a crash left
//     the stale committed snapshot untouched — and exit 1 was a traceback, not
//     findings. That is a build failure regardless of exit code.
if (!existsSync(snapshotPath)) {
  console.error(`[generate-skill-audit] no snapshot at ${snapshotPath} after the run`)
  console.error('  The auditor exited without writing a snapshot. Treating as a failed regeneration.')
  process.exit(1)
}
const postMtimeMs = statSync(snapshotPath).mtimeMs
if (postMtimeMs <= priorMtimeMs) {
  console.error('[generate-skill-audit] snapshot was not rewritten by this run')
  console.error(`  mtime did not advance (${priorMtimeMs} -> ${postMtimeMs}); the auditor likely`)
  console.error('  crashed before its write step, leaving the committed snapshot stale.')
  process.exit(1)
}

// (2) The written snapshot must be parseable JSON with the expected top-level
//     shape (auditor_version string, summary object carrying numeric counters,
//     skills array). A half-written or shape-shifted file is a failed
//     regeneration even if the mtime advanced.
let parsed
try {
  parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'))
} catch (err) {
  console.error('[generate-skill-audit] snapshot is not parseable JSON:', err.message)
  process.exit(1)
}

const shapeOk =
  parsed &&
  typeof parsed === 'object' &&
  typeof parsed.auditor_version === 'string' &&
  parsed.summary &&
  typeof parsed.summary === 'object' &&
  typeof parsed.summary.total === 'number' &&
  typeof parsed.summary.passing === 'number' &&
  typeof parsed.summary.failing === 'number' &&
  Array.isArray(parsed.skills)

if (!shapeOk) {
  console.error('[generate-skill-audit] snapshot is missing the expected top-level shape')
  console.error('  Expected { auditor_version: string, summary: {total,passing,failing: number}, skills: [] }.')
  process.exit(1)
}

// Only now, having proven a fresh well-formed snapshot exists, do we claim it.
console.log('[generate-skill-audit] snapshot regenerated.')
