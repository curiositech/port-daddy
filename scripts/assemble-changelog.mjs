#!/usr/bin/env node
/**
 * assemble-changelog.mjs — CHANGELOG.md's `[Unreleased]` section is ASSEMBLED
 * from one file per PR under `changelog.d/`, instead of every branch editing the
 * same three lines of the same file.
 *
 * WHY THIS EXISTS (the mechanism, measured):
 *   `## [Unreleased]` is line 8 of CHANGELOG.md, `### Added` is line 10, and every
 *   feature PR inserts its bullet at line 11. 29 of the last 200 commits touch the
 *   file and effectively all of them write those same lines. Two branches cut from
 *   the same base therefore conflict on nearly every pair, and a resolver that takes
 *   "ours" DROPS the other PR's entry with nothing failing: no test reads the file,
 *   and the release gate only greps for a heading, not for content. One file per PR
 *   means two branches never touch the same file, so there is no conflict to
 *   mis-resolve and no branch can carry a stale copy of another branch's entry.
 *   NOT a fix: `CHANGELOG.md merge=union` in .gitattributes. That file's own header
 *   block records that merge-driver configuration was measured and does not rescue
 *   silent-side-loss, and union merging a changelog interleaves and duplicates
 *   entries without ever conflicting — a quieter version of the same bug.
 *
 * WHAT IT IS COUPLED TO (both verified against the workflow, both pinned by tests):
 *   A. `.github/workflows/release-train.yml` "Open the version-bump PR" step calls
 *      `--release "$NEXT" --date "$(date -u +%F)"`, replacing a `perl -0pi` one-liner
 *      that stamped the heading textually. With zero fragments the output of this
 *      script is BYTE-IDENTICAL to that perl line — that equivalence is the safety
 *      argument for the swap and is asserted in the unit test.
 *   B. `release-train.yml` job `tag-and-publish` runs a literal
 *      `grep -Fq "## [$version] -" CHANGELOG.md` and refuses to tag without it. No
 *      dated heading ⇒ no tag ⇒ no GitHub Release ⇒ no binaries. So `--release` MUST
 *      emit a heading satisfying that exact `-F` literal, including for a version
 *      with zero fragments (empty dated sections are precedented: `[3.28.2]`,
 *      `[3.28.1]`).
 *
 * WHAT IT DELIBERATELY DOES NOT DO: judge whether a fragment's prose is honest,
 * well-scoped, or correctly typed. That is the `claude-adversarial-review` workflow's
 * job and the Lookout/Documentarian role's job. This checks PRESENCE AND SHAPE only —
 * the same line check-doc-citations.mjs and check-pr-requirements.mjs both draw. A
 * script that tried to judge prose quality would be the technology-solutionism
 * anti-pattern.
 *
 * Naming note: `lib/changelog.ts` and `lib/changelog-from-note.ts` are a PRODUCT
 * feature (the per-identity DB changelog behind the `/changelog` routes) and are
 * unrelated to this file. Their `ChangelogType` enum (feature|fix|breaking|docs|
 * refactor|chore) maps to conventional-commit tokens, not to Keep a Changelog
 * sections, and is deliberately NOT shared with the `TYPES` below.
 *
 * Usage:
 *   node scripts/assemble-changelog.mjs                      # --check (the default)
 *   node scripts/assemble-changelog.mjs --check
 *   node scripts/assemble-changelog.mjs --print              # assembled Unreleased body
 *   node scripts/assemble-changelog.mjs --release 3.31.0 [--date 2026-08-23]
 *   node scripts/assemble-changelog.mjs --notes 3.30.2       # one section's body
 *   node scripts/assemble-changelog.mjs --root <dir>         # sandbox root (tests)
 *
 * Exit codes:  0 clean / nothing in scope.  1 violations.  2 the gate itself cannot
 * run (no CHANGELOG.md, no `## [Unreleased]` anchor, version already stamped).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = 'assemble-changelog'

const argv = process.argv.slice(2)
const args = new Set(argv)

/** Value of `--flag <value>`, or null. */
function arg(flag) {
  const i = argv.indexOf(flag)
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null
}

// --root <dir> overrides the repo root. Defaults to the repo this script lives in.
// Copied from check-version-drift.mjs: it is what makes the gate's own regression
// test able to run against a sandbox with injected breakage.
const ROOT = arg('--root') ?? resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRAGMENT_DIR = join(ROOT, 'changelog.d')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')

/**
 * MIGRATION FLAG. While in-flight branches still carry hand-written bullets under
 * `## [Unreleased]`, `--check` reports them as a `·` notice and exits 0, so those
 * branches stay green and merge normally. Flip to `true` once a release train run
 * has drained `[Unreleased]` on main — that flip is the moment the conflict class is
 * actually closed. `--release` merges legacy bullets either way (see assemble()),
 * which is a permanent capability, not migration scaffolding: it is what lets a
 * human hand-add an entry in an emergency without the tooling fighting them.
 */
const LEGACY_UNRELEASED_IS_ERROR = false

// Keep a Changelog's six section names, in canonical output order. Deliberately
// NOT extended with the file's historical strays (`Docs`, `Tests`, `CI / Build`):
// a changelog is for user-visible change, and a docs-only PR takes the
// `<!-- changelog-exempt: … -->` marker instead of inventing a section.
const TYPES = {
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  security: 'Security',
}
const TYPE_ORDER = Object.keys(TYPES)
const SECTION_ORDER = TYPE_ORDER.map((t) => TYPES[t])

// `changelog.d/<pr>-<slug>.md`, or `draft-<slug>.md` before the PR number exists.
const FRAGMENT_NAME_RE = /^(?:\d+|draft)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
// Files in changelog.d/ that are documentation, not fragments.
const NON_FRAGMENTS = new Set(['README.md', '.gitkeep'])

const HEADING_UNRELEASED = '## [Unreleased]'

function fatal(msg) {
  console.error(`FATAL: ${SELF}: ${msg}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

/**
 * Every candidate fragment path, ordered by FILENAME ALONE — numeric `<pr>`
 * ascending, `draft-` last, filename as tiebreak. No `git log` call, so the order
 * is identical on a shallow CI clone, in a linked worktree, and in the public
 * mirror. PR number ascending ≈ merge order, the closest thing the hand-written
 * file ever had to a convention.
 */
function fragmentFiles() {
  if (!existsSync(FRAGMENT_DIR)) return []
  const names = readdirSync(FRAGMENT_DIR).filter((n) => !NON_FRAGMENTS.has(n))
  const key = (n) => {
    const m = n.match(/^(\d+)-/)
    return m ? [0, Number(m[1]), n] : [1, 0, n]
  }
  return names.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0)
  })
}

/**
 * Parse one fragment. Two lines of header, a blank line, then the bullet(s)
 * EXACTLY as they will appear in CHANGELOG.md. No YAML parser, no dependency —
 * structured, exact, no NLP.
 *
 * Returns { name, type, body: string[] } or { name, errors: [{line, token, why}] }.
 */
function parseFragment(name) {
  const errors = []
  const push = (line, token, why) => errors.push({ name, line, token, why })

  if (!FRAGMENT_NAME_RE.test(name)) {
    push(null, null, 'filename must match <pr>-<slug>.md or draft-<slug>.md (digits or "draft", then lowercase hyphen-separated words)')
    return { name, errors }
  }

  const raw = readFileSync(join(FRAGMENT_DIR, name), 'utf8')
  if (raw.includes('\r')) push(null, null, 'file contains CR bytes — CHANGELOG.md is LF-only')
  if (!raw.endsWith('\n')) push(null, null, 'file must end with exactly one newline')
  if (raw.endsWith('\n\n')) push(null, null, 'file must end with exactly one newline (found trailing blank line(s))')

  const lines = raw.replace(/\n$/, '').split('\n')

  const typeMatch = (lines[0] ?? '').match(/^type: (\S+)$/)
  if (!typeMatch) {
    push(1, lines[0] ?? '', 'line 1 must be exactly `type: <token>`')
    return { name, errors }
  }
  const type = typeMatch[1]
  if (!Object.hasOwn(TYPES, type)) {
    push(1, `type: ${type}`, `unknown type (use one of: ${TYPE_ORDER.join(', ')})`)
  }

  if (lines[1] !== '') push(2, lines[1] ?? '', 'line 2 must be blank')

  const body = lines.slice(2)
  if (body.length === 0 || body.every((l) => l === '')) {
    push(3, '', 'body is empty — write the bullet exactly as it should appear in CHANGELOG.md')
    return { name, errors }
  }
  // Only the "a sub-bullet cannot be first" case is reported here; a body whose
  // first line is not a bullet at all is caught once by the per-line loop below
  // rather than twice by both checks.
  if (/^\s+- /.test(body[0])) {
    push(3, body[0], 'body must start with a top-level `- ` bullet, not an indented sub-bullet')
  }
  for (let i = 0; i < body.length; i++) {
    const l = body[i]
    const n = i + 3
    if (l === '') {
      push(n, '', 'blank line inside the body — one bullet is one physical line, no hard wrapping')
      continue
    }
    if (!/^(?:- |\s+- )\S/.test(l)) {
      push(n, l.length > 60 ? `${l.slice(0, 57)}…` : l, 'every body line must be a `- ` bullet or an indented `  - ` sub-bullet (no continuation lines)')
    }
    if (/[ \t]$/.test(l)) push(n, l.slice(-20), 'trailing whitespace')
  }

  if (errors.length) return { name, errors }
  return { name, type, body }
}

/** Parse every fragment; returns { fragments, errors }. */
function loadFragments() {
  const fragments = []
  const errors = []
  for (const name of fragmentFiles()) {
    const parsed = parseFragment(name)
    if (parsed.errors) errors.push(...parsed.errors)
    else fragments.push(parsed)
  }
  return { fragments, errors }
}

// ---------------------------------------------------------------------------
// CHANGELOG.md
// ---------------------------------------------------------------------------

/**
 * Split CHANGELOG.md around `## [Unreleased]`.
 * Returns { lines, headingIdx, nextIdx, sections, order } where `sections` maps a
 * `### Name` to its bullet lines and `order` is the order they appear in today.
 */
function readChangelog() {
  if (!existsSync(CHANGELOG)) fatal(`${CHANGELOG} does not exist`)
  const text = readFileSync(CHANGELOG, 'utf8')
  const lines = text.split('\n')
  const headingIdx = lines.findIndex((l) => l === HEADING_UNRELEASED)
  if (headingIdx === -1) fatal(`CHANGELOG.md has no \`${HEADING_UNRELEASED}\` anchor to assemble into`)

  let nextIdx = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { nextIdx = i; break }
  }

  const sections = new Map()
  const order = []
  let current = null
  for (let i = headingIdx + 1; i < nextIdx; i++) {
    const l = lines[i]
    const h = l.match(/^### (.+)$/)
    if (h) {
      current = h[1]
      if (!sections.has(current)) { sections.set(current, []); order.push(current) }
      continue
    }
    if (l === '') continue
    if (current == null) {
      // A bullet with no `###` above it. Park it under Changed so nothing is lost;
      // --check reports it as legacy prose either way.
      current = 'Changed'
      if (!sections.has(current)) { sections.set(current, []); order.push(current) }
    }
    sections.get(current).push(l)
  }
  return { text, lines, headingIdx, nextIdx, sections, order }
}

/** Every hand-written bullet currently sitting under `## [Unreleased]`. */
function legacyBullets(cl) {
  const out = []
  for (const name of cl.order) for (const b of cl.sections.get(name)) out.push({ section: name, bullet: b })
  return out
}

/**
 * Merge legacy bullets and fragments into ordered sections.
 *
 * Legacy bullets already under `## [Unreleased]` come FIRST within their matching
 * section, fragments after. A legacy section with no fragments survives; a fragment
 * section with no legacy bullets is created. Sections are emitted in Keep a
 * Changelog canonical order, EMPTY ONES OMITTED; a legacy section whose name is not
 * one of the six (`Docs`, `CI / Build`, … — historical strays) is preserved after
 * the canonical ones, in the order it appeared, because losing prose that is
 * already in the file would be the exact bug this whole system exists to stop.
 *
 * Returns [{ name, bullets: string[] }].
 */
function assemble(cl, fragments) {
  const merged = new Map()
  const add = (name, bullets) => {
    if (!merged.has(name)) merged.set(name, [])
    merged.get(name).push(...bullets)
  }
  for (const name of cl.order) add(name, cl.sections.get(name))
  for (const f of fragments) add(TYPES[f.type], f.body)

  const out = []
  for (const name of SECTION_ORDER) {
    if (merged.has(name) && merged.get(name).length) out.push({ name, bullets: merged.get(name) })
  }
  for (const name of cl.order) {
    if (!SECTION_ORDER.includes(name) && merged.get(name)?.length) {
      out.push({ name, bullets: merged.get(name) })
    }
  }
  return out
}

/**
 * Render sections as the lines that go under a `##` heading.
 *
 * The exact shape, measured against the real file rather than assumed: a `###`
 * heading is followed IMMEDIATELY by its first bullet (no blank line), bullets
 * have no blank lines between them, and one blank line closes the section before
 * the next `###` or `##`. `CHANGELOG.md:10-11` is `### Added` then the bullet on
 * the very next line. Getting this wrong by one blank line per section is what the
 * byte-equality assertion against the old perl one-liner exists to catch — it did.
 */
function renderSections(sections) {
  const lines = []
  for (const s of sections) {
    lines.push(`### ${s.name}`)
    lines.push(...s.bullets)
    lines.push('')
  }
  return lines
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function modeCheck() {
  const { fragments, errors } = loadFragments()
  const cl = readChangelog()
  const legacy = legacyBullets(cl)

  if (!fragments.length && !errors.length && !legacy.length) {
    console.log(`${SELF}: nothing to check.`)
    return 0
  }

  for (const f of fragments) {
    console.log(`  ✓ changelog.d/${f.name} → ### ${TYPES[f.type]} (${f.body.length} line(s))`)
  }

  if (legacy.length && !LEGACY_UNRELEASED_IS_ERROR) {
    console.log(`  · ${legacy.length} hand-written bullet(s) still under \`${HEADING_UNRELEASED}\`:`)
    for (const l of legacy) {
      const t = l.bullet.length > 72 ? `${l.bullet.slice(0, 69)}…` : l.bullet
      console.log(`      ${l.section}: ${t}`)
    }
    console.log('    They will be merged into the next release section as-is. New entries go in')
    console.log('    changelog.d/<pr>-<slug>.md — format spec: changelog.d/README.md.')
  }

  if (legacy.length && LEGACY_UNRELEASED_IS_ERROR) {
    console.error(`\n✗ ${SELF}: ${legacy.length} hand-written bullet(s) under \`${HEADING_UNRELEASED}\`:\n`)
    for (const l of legacy) console.error(`  ${l.section}: ${l.bullet}`)
    console.error('\nFix: move this entry into changelog.d/<pr>-<slug>.md. Format spec: changelog.d/README.md.\n')
    return 1
  }

  if (errors.length) {
    console.error(`\n✗ ${SELF}: ${errors.length} malformed fragment(s):\n`)
    for (const e of errors) {
      const where = e.line == null ? `changelog.d/${e.name}` : `changelog.d/${e.name}:${e.line}`
      const token = e.token ? `  \`${e.token}\`` : ''
      console.error(`  ${where}${token}  — ${e.why}`)
    }
    console.error(`\nFix the fragment and re-run \`npm run check:changelog\`. Format spec: changelog.d/README.md.\n`)
    return 1
  }

  console.log(`\n✓ ${SELF}: ${fragments.length} fragment(s) clean.`)
  return 0
}

function modePrint() {
  const { fragments, errors } = loadFragments()
  if (errors.length) return modeCheck()
  const cl = readChangelog()
  const lines = renderSections(assemble(cl, fragments))
  // Trim the trailing blank so `--print` is a clean block, not a block plus padding.
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (lines.length) console.log(lines.join('\n'))
  return 0
}

function modeRelease(version) {
  const date = arg('--date') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d+\.\d+\.\d+/.test(version)) fatal(`--release expects a semver version, got \`${version}\``)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fatal(`--date expects YYYY-MM-DD, got \`${date}\``)

  const { fragments, errors } = loadFragments()
  if (errors.length) {
    modeCheck()
    return 2
  }

  const cl = readChangelog()

  // Idempotency guard: refuse rather than stamping a second section for a version
  // that is already dated. The literal is the same one release-train.yml greps for.
  if (cl.lines.some((l) => l.startsWith(`## [${version}] -`))) {
    fatal(`CHANGELOG.md already has a dated \`## [${version}] -\` section; refusing to stamp it twice`)
  }

  const sections = renderSections(assemble(cl, fragments))
  const head = cl.lines.slice(0, cl.headingIdx + 1) // … through `## [Unreleased]`
  const tail = cl.lines.slice(cl.nextIdx) // the previous release section onwards

  const out = [...head, '', `## [${version}] - ${date}`, '', ...sections, ...tail]
  writeFileSync(CHANGELOG, out.join('\n'), 'utf8')

  // Consumed fragments are DELETED by this same commit — git history is the
  // archive, there is no changelog.d/archive/. release-train.yml's existing
  // `git add -A` stages both the CHANGELOG edit and these deletions into the one
  // `chore(release): bump to $NEXT` commit.
  for (const f of fragments) unlinkSync(join(FRAGMENT_DIR, f.name))

  console.log(`${SELF}: stamped ## [${version}] - ${date}`)
  for (const s of sections.filter((l) => l.startsWith('### '))) console.log(`  ✓ ${s}`)
  if (!sections.length) console.log('  · no entries — dated heading emitted anyway (see [3.28.2] precedent)')
  for (const f of fragments) console.log(`  ✓ consumed changelog.d/${f.name}`)
  return 0
}

function modeNotes(version) {
  const cl = readChangelog()
  const start = cl.lines.findIndex((l) => l.startsWith(`## [${version}] -`))
  if (start === -1) {
    console.error(`\n✗ ${SELF}: CHANGELOG.md has no dated \`## [${version}] -\` section.\n`)
    return 1
  }
  let end = cl.lines.length
  for (let i = start + 1; i < cl.lines.length; i++) {
    if (cl.lines[i].startsWith('## ')) { end = i; break }
  }
  const body = cl.lines.slice(start + 1, end)
  while (body.length && body[0] === '') body.shift()
  while (body.length && body[body.length - 1] === '') body.pop()
  console.log(body.join('\n'))
  return 0
}

function main() {
  const release = arg('--release')
  const notes = arg('--notes')
  if (release) process.exit(modeRelease(release))
  if (notes) process.exit(modeNotes(notes))
  if (args.has('--print')) process.exit(modePrint())
  process.exit(modeCheck())
}

main()
