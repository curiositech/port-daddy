#!/usr/bin/env node
/**
 * Large-binary placement gate.
 *
 * THE DRIFT THIS EXISTS TO STOP. Evidence media — PR screenshots, capture
 * artifacts, before/after GIFs — is committed by agents constantly, several
 * times a day. .gitattributes routes the known evidence directories into Git
 * LFS, but a rule nobody enforces is a rule that decays: the next agent
 * inventing `docs/pr-evidence-v2/` or dropping a 40 MB screen recording at the
 * repo root puts it straight into pack history, permanently, and nobody
 * notices until .git is another gigabyte heavier. Git history is append-only
 * in practice here (about 40 PRs are open at any time, so rewriting SHAs is
 * off the table), which means every such mistake is unrecoverable without a
 * rewrite nobody can afford. This gate is therefore the only cheap moment to
 * catch it: before the blob lands.
 *
 * THE RULE. A file that is (a) binary, (b) at least THRESHOLD_BYTES, and
 * (c) not routed through LFS by .gitattributes must sit in a path on
 * ALLOWED_NON_LFS. Anything else fails.
 *
 * WHY AN ALLOW-LIST RATHER THAN "EVERYTHING BIG GOES TO LFS". Because for some
 * paths LFS is actively wrong, not merely unnecessary. No workflow in
 * .github/workflows/ sets `lfs: true` on actions/checkout, so an LFS path
 * arrives in CI — and in the Cloudflare Pages build — as a 130-byte pointer
 * file. For evidence media nothing reads those bytes, so pointers are
 * harmless. For website-v2/public/** the pointer IS what gets uploaded, and
 * the live site would serve 130 bytes of ASCII where a PNG or a PDF belongs.
 * The allow-list is the list of places where a big binary is deliberately
 * kept in plain git, each with the reason it has to be.
 *
 * Usage:
 *   node scripts/check-binary-lfs.mjs                 # changed files vs origin/main
 *   node scripts/check-binary-lfs.mjs --all           # every tracked file
 *   node scripts/check-binary-lfs.mjs path/a path/b   # explicit files
 */
import { execFileSync } from 'node:child_process'
import { statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 1 MiB. Deliberately not smaller: a 200 KB screenshot in pack history is not
 * worth failing a build over, and a threshold that trips constantly gets
 * `--no-verify`'d into irrelevance. The files that actually moved the needle
 * on this repository's size were all multi-megabyte.
 */
export const THRESHOLD_BYTES = 1024 * 1024

/**
 * Paths where a large binary is CORRECT in plain git. Each entry is a prefix
 * match against the repo-relative path, and each one is a deliberate decision
 * with a reason — not a convenience hatch. Adding to this list means asserting
 * that something reads these bytes during a build, a test or a deploy.
 */
export const ALLOWED_NON_LFS = [
  // Deployed by Cloudflare Pages. Vite copies public/ into dist/ verbatim, so
  // whatever the clone contains is what the live site serves. A pointer here
  // is a user-visible outage, not a nuisance.
  'website-v2/public/',
  // Source figures for the LaTeX build. pdflatex reads these bytes during
  // whitepaper-build.yml, which does a plain checkout.
  'whitepaper/figures/',
  // tests/unit/spawn-whitepaper-contract.test.js pins the sha256 of the
  // contact sheet and the colour tour, and parses the PNG IHDR for exact
  // dimensions. Under LFS it would hash a 130-byte pointer and fail.
  'docs/artifacts/whitepaper-figure-semantics/',
  // vhs.yml regenerates these GIFs from demos/*.tape and auto-commits them to
  // main with stefanzweifel/git-auto-commit-action, on a runner that never ran
  // `git lfs install`. Routing this directory through LFS risks committing
  // pointers whose objects were never uploaded — silent corruption.
  'demos/',
  // Rendered inline in PR bodies and the README through URL forms that do not
  // smudge LFS pointers. See CONTRIBUTING.md § Binary media and Git LFS.
  '.github/assets/',
]

/** True if `rel` sits under one of the deliberately-plain-git prefixes. */
export function isAllowedNonLfs(rel, allowed = ALLOWED_NON_LFS) {
  return allowed.some((prefix) => rel === prefix.replace(/\/$/, '') || rel.startsWith(prefix))
}

/**
 * DEBT, NOT POLICY. These 23 files (45.4 MiB) were already in pack history
 * when this gate was written. They are evidence media sitting in directories
 * whose safety for LFS was not proven in the migration that introduced this
 * script — docs/reports/ is written into by the a11y capture scripts,
 * docs/design/ art and docs/research/ galleries are cited from prose, and the
 * core/*-proto/docs/ GIFs had no reference audit — so converting them was
 * deliberately left out of that change rather than done blind.
 *
 * They are listed individually, not as directory prefixes, for two reasons:
 * a prefix would silently absorb every future file dropped beside them, and
 * an exact list can be checked for staleness. tests/unit/check-binary-lfs.test.js
 * asserts this list matches the tree EXACTLY — no missing entries (so it
 * cannot grow) and no stale ones (so converting a file forces its removal
 * here). Shrinking it is the follow-up work; growing it requires deleting a
 * test assertion, which is the point.
 */
export const GRANDFATHERED = [
  'apps/FleetBar/docs/artifacts/signed-update/fleetbar-signed-update.gif',
  'artifacts/pd-console-agent-switcher/agents-520px.png',
  'core/pd-conjure-proto/docs/artifacts/conjure/conjure-dag.gif',
  'core/pd-conjure-proto/docs/artifacts/conjure/conjure-dag.mp4',
  'core/pd-flag-proto/docs/flag-wave.gif',
  'core/pd-harbor-proto/docs/harbor.gif',
  'docs/design/story-linework/art/book-dark.png',
  'docs/design/story-linework/art/book-light.png',
  'docs/design/story-linework/art/program-dark.png',
  'docs/design/story-linework/art/program-light.png',
  'docs/design/story-linework/proposal-scroll.mp4',
  'docs/releases/v3.21.0/cli-overview-v3.21.0.gif',
  'docs/reports/planner-gantt/board-walkthrough.gif',
  'docs/reports/relay-roadmap-mirror/02-mirror-board.png',
  'docs/reports/roadmap-doc-chomp/walkthrough.webm',
  'docs/reports/website-rehab-screenshots/2026-04-29-mac-app/17-pd-monogram-hero-light.png',
  'docs/reports/website-rehab-screenshots/2026-04-29-mac-app/18-pd-monogram-hero-dark.png',
  'docs/reports/website-rehab-screenshots/2026-04-29-mac-app/19-pd-monogram-mobile.png',
  'docs/reports/website-rehab-screenshots/2026-04-29-mac-app/28-mac-preview-page-light.png',
  'docs/reports/website-rehab-screenshots/2026-04-29-mac-app/29-mac-preview-page-dark.png',
  'docs/reports/website-rehab-screenshots/2026-04-29-mac-app/30-home-without-embedded-mac-preview.png',
  'docs/research/flashy-rust-guis/gallery/rerun-hero.png',
  'website-v2/docs/typography-switcher/switcher-cycle.gif',
]

/**
 * True if the first `len` bytes of the buffer contain a NUL — the same sniff
 * git itself uses to decide a file is binary. Cheap, and it agrees with the
 * thing we are actually guarding against (blobs git cannot delta-compress).
 */
export function looksBinary(buf, len) {
  for (let i = 0; i < len; i += 1) if (buf[i] === 0) return true
  return false
}

/** Read at most 8000 bytes and apply the NUL sniff. */
export function fileLooksBinary(abs) {
  const fd = openSync(abs, 'r')
  try {
    const buf = Buffer.alloc(8000)
    const n = readSync(fd, buf, 0, 8000, 0)
    return looksBinary(buf, n)
  } finally {
    closeSync(fd)
  }
}

/**
 * True when .gitattributes routes `rel` through the LFS clean filter. Asking
 * git rather than re-implementing the attribute matching is the point: this
 * gate then cannot disagree with the rules that are actually in force, which
 * is exactly the drift it is meant to catch.
 */
export function isLfsTracked(rel, cwd = REPO) {
  const out = execFileSync('git', ['check-attr', 'filter', '--', rel], { cwd, encoding: 'utf8' })
  return /: filter: lfs$/m.test(out.trim())
}

/**
 * The same question for many paths at once, as a Set of the LFS-routed ones.
 *
 * `git check-attr --stdin` exists precisely for this, and using it is not a
 * micro-optimisation: one process per file over ~12k tracked files turned the
 * --all sweep into minutes, which is how a gate ends up skipped. Batched it is
 * about a tenth of a second.
 *
 * Output lines are `<path>: filter: <value>`. Paths here never contain a
 * newline (git would quote them), so splitting on newline is safe; the value
 * is the last colon-separated field.
 */
export function lfsTrackedSet(paths, cwd = REPO) {
  const set = new Set()
  if (paths.length === 0) return set
  const out = execFileSync('git', ['check-attr', 'filter', '--stdin'], {
    cwd, input: paths.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  for (const line of out.split('\n')) {
    const m = /^(.*): filter: (.*)$/.exec(line)
    if (m && m[2] === 'lfs') set.add(m[1])
  }
  return set
}

/** Files changed against the merge-base with origin/main. */
function changedFiles() {
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
    cwd: REPO, encoding: 'utf8',
  }).trim()
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', `${base}...HEAD`], {
    cwd: REPO, encoding: 'utf8',
  }).split('\n').map((s) => s.trim()).filter(Boolean)
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * The pure core, so the tests can drive it without a repository: given a list
 * of {rel, size, binary, lfs} descriptors, return the violations.
 */
export function findViolations(files, {
  threshold = THRESHOLD_BYTES,
  allowed = ALLOWED_NON_LFS,
  grandfathered = GRANDFATHERED,
} = {}) {
  const old = new Set(grandfathered)
  return files.filter((f) => f.binary
    && f.size >= threshold
    && !f.lfs
    && !isAllowedNonLfs(f.rel, allowed)
    && !old.has(f.rel))
}

export function inspect(rel, cwd = REPO, lfsSet = null) {
  const abs = join(cwd, rel)
  // A pointer on disk is small, so the size test alone would pass it. That is
  // the correct outcome: it is already in LFS.
  const size = statSync(abs).size
  const binary = size > 0 && fileLooksBinary(abs)
  const lfs = lfsSet ? lfsSet.has(rel) : isLfsTracked(rel, cwd)
  return { rel, size, binary, lfs }
}

function main() {
  const argv = process.argv.slice(2)
  const all = argv.includes('--all')
  const explicit = argv.filter((a) => !a.startsWith('--'))

  let targets
  if (explicit.length > 0) targets = explicit
  else if (all) targets = trackedFiles()
  else targets = changedFiles()

  // Deleted-in-worktree paths are not our problem; skip rather than throw.
  const present = targets.filter((r) => existsSync(join(REPO, r)))
  const lfsSet = lfsTrackedSet(present)
  const files = present.map((r) => inspect(r, REPO, lfsSet))
  const violations = findViolations(files)

  if (violations.length === 0) {
    console.log(`check-binary-lfs: OK (${files.length} file(s) inspected).`)
    return
  }

  console.error('check-binary-lfs: large binaries committed outside Git LFS.\n')
  for (const v of violations) {
    console.error(`  ${v.rel}  (${(v.size / 1048576).toFixed(1)} MiB)`)
  }
  console.error(`
Each file above is at least ${(THRESHOLD_BYTES / 1048576).toFixed(0)} MiB of binary data on a path that
.gitattributes does not route through Git LFS. Committing it puts it in pack
history permanently — history here is never rewritten, so this cannot be
undone later.

Fix it one of these ways:

  1. It is evidence media (a PR screenshot, a capture artifact, a demo GIF).
     Put it under an existing evidence directory — docs/pr-assets/,
     docs/artifacts/, website-v2/screenshots/, core/pd-console/docs/artifacts/
     — which .gitattributes already routes to LFS.

  2. It belongs in a new evidence directory. Add the matching
     '<dir>/**/*.<ext> filter=lfs diff=lfs merge=lfs -text' rules to
     .gitattributes, then 'git add --renormalize <dir>'.

  3. Something actually READS these bytes in a build, a test or the deploy.
     Then LFS is wrong for it — no workflow does an LFS checkout, so it would
     arrive as a 130-byte pointer. Add the path to ALLOWED_NON_LFS in
     scripts/check-binary-lfs.mjs WITH the reason, and say what reads it.

See CONTRIBUTING.md § Binary media and Git LFS.`)
  process.exitCode = 1
}

// Only run when executed directly, so the tests can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
