#!/usr/bin/env node
/**
 * check-doc-citations.mjs — the machine-checkable half of the ship checklist's
 * "citations are real" killer item (AGENTS.md § Pull Request Operating Procedure).
 *
 * The repo's cite-and-define house style requires that every cited repo-relative
 * path point at a file that actually exists — "a path that no longer exists is a
 * caught lie" (AGENTS.md § Writing Technical Documents). This session shipped a doc
 * that cited `pd whois` as a live surface (it is designed-not-built) and a fragile
 * `.gitignore:49` line cite; a human reviewer caught both. This guard mechanizes the
 * part a script CAN verify: that backtick-wrapped repo paths and relative markdown
 * links in CHANGED docs resolve to real files.
 *
 * What it canNOT verify stays a human DO-CONFIRM item: whether a *command/concept*
 * like `pd whois` is actually shipped, or whether a claim is agent-neutral. A script
 * that tried to judge those would be the technology-solutionism anti-pattern. This
 * checks file existence only — structured, exact, no NLP.
 *
 * Scope: CHANGED markdown vs the merge base by default (enforce what you touch, not
 * the whole legacy). `--all` audits every tracked markdown; explicit paths override.
 *
 *   node scripts/check-doc-citations.mjs                 # changed vs origin/main
 *   node scripts/check-doc-citations.mjs --all           # every tracked *.md
 *   node scripts/check-doc-citations.mjs docs/foo.md     # specific files
 *
 * Escape hatch: a citation is skipped when its line carries a proposal marker
 * (proposed / not yet shipped / designed-not-built / will land / when it lands /
 * planned / future / does not exist / to be built) or an explicit
 * `<!-- cite-exempt -->`. ADRs that reference files they propose to create stay green.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Backtick'd tokens are treated as repo-path citations only when they start with a
// known top-level directory AND carry a file extension. This keeps prose tokens
// (`pd whois`, `origin/main`, `feat/dom-daddy-*`, `claude-opus-4-8`) out of scope —
// they are not file citations, and judging them is a human task.
const TOP_DIRS = [
  'lib', 'routes', 'cli', 'core', 'apps', 'scripts', 'tests', 'shared', 'bin',
  'docs', 'skills', 'whitepaper', 'website-v2', 'mcp', 'fleet', 'public', 'dashboard',
  'analyses', 'proofs', 'fleet-config-ui',
]
// Excludes tokens containing `*` (globs) or `<`/`>` (template placeholders like
// `skills/<name>/SKILL.md`) — those are patterns, not concrete citations.
const REPO_PATH_RE = new RegExp(
  `^(?:${TOP_DIRS.join('|')})\\/[^\\s\\\`*<>]+\\.[A-Za-z0-9]+$`,
)

// Deliberately PRECISE markers. Broad prose words like "planned"/"future" are
// excluded: they appear in normal ADR sentences ("planned in ADR-X, see `lib/foo.ts`")
// and would mask a genuinely-broken path on the same line. Authors marking a real
// proposed-but-unbuilt path use one of these specific phrases or `<!-- cite-exempt -->`.
const PROPOSAL_MARKERS = [
  'proposed', 'not yet shipped', 'not-yet-shipped', 'designed-not-built',
  'designed but not built', 'will land', 'when it lands', 'to be built',
  'doesn’t exist yet', "doesn't exist yet", 'cite-exempt', 'not built yet',
  'unbuilt', 'salvage diff',
]

function changedMarkdown() {
  // Merge-base diff against origin/main; fall back to HEAD~1 locally.
  let base = 'origin/main'
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: REPO, stdio: 'ignore' })
  } catch {
    base = 'HEAD~1'
  }
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], {
    cwd: REPO, encoding: 'utf8',
  })
  return out.split('\n').filter((f) => f.endsWith('.md') && !isFixture(f) && !isRetired(f))
}

function allMarkdown() {
  const out = execFileSync('git', ['ls-files', '*.md'], { cwd: REPO, encoding: 'utf8' })
  return out.split('\n').filter((f) => f && !isFixture(f) && !isRetired(f))
}

// Test fixtures intentionally contain broken citations; they are scanned only when
// passed explicitly (by the unit test), never by the changed-files / --all sweeps.
function isFixture(f) {
  return f.includes('tests/fixtures/')
}

/**
 * Documents formally retired by an ADR (docs/retirement-manifest.json).
 *
 * A retired plan's citations are a record of what the repo looked like when it
 * was written, not a claim about now. V4-DAG.md cites `lib/hlc.ts` and
 * `lib/sync-protocol.ts` because Part XVII was the plan then; ADR-0049 rejected
 * that plan and the files were never built. Repairing those paths would be
 * editing history to make a dead document look current, which is the opposite
 * of what retiring it was for — and this gate's own rule is "enforce what you
 * touch", so adding a retirement banner would otherwise make every stale
 * citation in the body the retiring PR's problem.
 *
 * The banner is NOT exempt: doc-retirement-guard.mjs requires every link inside
 * it to resolve from the file's own directory. So the part a reader needs — the
 * pointer to what replaced this — stays enforced, and only the history is let
 * be. Same posture as isFixture: skipped in the sweeps, still scanned when the
 * path is passed explicitly, so the unit test can exercise it.
 */
let retiredCache = null
function isRetired(f) {
  if (retiredCache === null) {
    try {
      const raw = readFileSync(join(REPO, 'docs', 'retirement-manifest.json'), 'utf8')
      retiredCache = new Set(Object.keys(JSON.parse(raw).retired ?? {}))
    } catch {
      retiredCache = new Set()
    }
  }
  return retiredCache.has(f)
}

function hasProposalMarker(line) {
  const lower = line.toLowerCase()
  return PROPOSAL_MARKERS.some((m) => lower.includes(m))
}

/** True if `p` (repo-relative) exists as a file or directory. */
function repoPathExists(p) {
  const abs = join(REPO, p)
  return existsSync(abs)
}

/**
 * The nearest ancestor of `docAbs` that holds a SKILL.md — i.e. the skill
 * bundle root the doc belongs to — or null if the doc is not inside a skill
 * bundle. Bundle docs cite assets relative to this root.
 */
function skillBundleRoot(docAbs) {
  let dir = dirname(docAbs)
  // Stop at the repo root; never escape it.
  while (dir.startsWith(REPO) && dir !== REPO) {
    if (existsSync(join(dir, 'SKILL.md'))) return dir
    dir = dirname(dir)
  }
  return null
}

function checkFile(relFile, violations) {
  // Resolve against the repo root unless an absolute path was passed explicitly.
  const abs = isAbsolute(relFile) ? relFile : join(REPO, relFile)
  let text
  try { text = readFileSync(abs, 'utf8') } catch { return }
  const lines = text.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    if (hasProposalMarker(line)) continue

    // (a) relative markdown links [txt](path) — path not URL/anchor/mailto.
    for (const m of line.matchAll(/\]\(([^)]+)\)/g)) {
      let target = m[1].trim().split(/\s+/)[0] // drop optional "title"
      if (/^(https?:|mailto:|#|tel:)/.test(target)) continue
      // Leading-`/` links are site-absolute routes (e.g. website `/blog/...`),
      // resolved by the renderer, not filesystem citations — out of scope.
      if (target.startsWith('/')) continue
      target = target.split('#')[0] // strip in-page anchor
      if (!target) continue
      const fileDir = dirname(abs)
      if (!existsSync(resolve(fileDir, target))) {
        violations.push({ file: relFile, line: i + 1, kind: 'link', token: m[1].trim() })
      }
    }

    // (b) backtick'd repo-relative path citations.
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      let token = m[1].trim()
      // tolerate a trailing :NN line reference but check the bare path
      const lineRef = token.match(/^(.*):\d+$/)
      const bare = lineRef ? lineRef[1] : token
      if (!REPO_PATH_RE.test(bare)) continue
      // A citation is valid if it resolves at the repo root, relative to the
      // doc's own directory, OR relative to the doc's skill-bundle root (the
      // nearest ancestor holding a SKILL.md). Skill bundles cite sibling assets
      // with bare bundle-relative paths (`scripts/preflight.sh`,
      // `schemas/INDEX.md`) from any depth — e.g. schemas/INDEX.md points at the
      // bundle's `scripts/fleet-validate.sh`, not the repo's top-level scripts/.
      // Resolving against the bundle root too keeps those green without per-line
      // cite-exempt noise; a genuinely-missing path still fails all three.
      const bundleRoot = skillBundleRoot(abs)
      const okHere = existsSync(resolve(dirname(abs), bare))
      const okBundle = bundleRoot && existsSync(resolve(bundleRoot, bare))
      if (!repoPathExists(bare) && !okHere && !okBundle) {
        violations.push({ file: relFile, line: i + 1, kind: 'path', token })
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2)
  let files
  if (args.includes('--all')) files = allMarkdown()
  else if (args.length) files = args.filter((a) => !a.startsWith('--'))
  else files = changedMarkdown()

  if (!files.length) {
    console.log('check-doc-citations: no markdown to check.')
    return
  }

  const violations = []
  for (const f of files) checkFile(f, violations)

  if (violations.length) {
    console.error(`\n✗ check-doc-citations: ${violations.length} unresolved citation(s):\n`)
    for (const v of violations) {
      const why = v.kind === 'link' ? 'relative link target missing' : 'repo path does not exist'
      console.error(`  ${v.file}:${v.line}  \`${v.token}\`  — ${why}`)
    }
    console.error(
      '\nFix the path, or if it is intentionally a file you propose to create, add a ' +
      'proposal marker on the line (e.g. "(proposed)", "not yet shipped", ' +
      '"designed-not-built") or `<!-- cite-exempt -->`.\n',
    )
    process.exit(1)
  }
  console.log(`check-doc-citations: ${files.length} file(s) clean.`)
}

main()
