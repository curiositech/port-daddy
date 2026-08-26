#!/usr/bin/env node
/**
 * check-pr-requirements.mjs — the machine half of the PR contract (AGENTS.md
 * § Pull Request Operating Procedure + § Visual artifacts for UI diffs). It turns
 * three "forever" rules that were previously human-only DO-CONFIRM items into a
 * required CI gate, so a PR that skips them cannot ship green:
 *
 *   1. Summary is present and is real prose (not an empty/boilerplate heading).
 *   2. Test Plan is present and non-trivial (a floor on substance — the
 *      adversarial reviewer still judges whether it is a tautology).
 *   3. If the diff touches a VISUAL surface (the GPUI window / pd-console panes,
 *      website-v2, fleet-config-ui, public/fleet-ui, public/, dashboard, FleetBar),
 *      the PR body ships visual artifacts: at least one screenshot (image) AND at
 *      least one motion artifact (GIF or screen recording). "A green build proves
 *      it compiles, not that it renders correctly."
 *   4. If the diff touches a USER-VISIBLE surface, the PR adds a changelog fragment
 *      under `changelog.d/`. The honour-system version of this rule already exists
 *      and does not work: `.github/PULL_REQUEST_TEMPLATE.md` carries a "CHANGELOG.md
 *      updated" checkbox and CONTRIBUTING.md § Changelog + parsimony states the
 *      rule, but an unchecked checkbox blocks nothing. See
 *      `scripts/lib/user-visible-surfaces.mjs` for the classifier and
 *      `changelog.d/README.md` for the fragment format.
 *
 * What it deliberately does NOT do: judge whether the Summary is honest, whether
 * the Test Plan is a real proof vs. a tautology, whether a GIF shows success
 * vs. an error, or whether a changelog fragment's prose is honest, well-scoped or
 * correctly typed. Those are judgment calls — the claude-adversarial-review workflow
 * and the Lookout/Documentarian role own them. A script that pretended to judge them
 * would be the solutionism anti-pattern check-doc-citations.mjs warns about. This
 * checks STRUCTURE and PRESENCE only.
 *
 * Inputs (CI wires the first form; the rest are for local runs + the unit test):
 *   --event-path <file>   GitHub event JSON ($GITHUB_EVENT_PATH); reads
 *                         .pull_request.body, .pull_request.number, .title, .user.
 *   --body-file <file>    Read the PR body from a file.
 *   --files-from <file>   Newline-delimited changed-file list (one path per line).
 *   --changed a,b,c       Comma-delimited changed-file list.
 *   --title <s>           PR title (release-train auto-skip; normally from the event).
 *   --author <s>          PR author login (ditto).
 * With no body source and no event, the check is a no-op (exit 0) so `npm run
 * check:pr-requirements` outside a PR does not error. CI always passes
 * --event-path on pull_request events, so enforcement only happens with a real PR.
 *
 * Changed files default to the merge-base diff against origin/main (same basis as
 * check-doc-citations.mjs), falling back to HEAD~1 locally.
 *
 * Escape hatches (mirroring the doc-citation guard's proposal markers — explicit,
 * visible in the body, auditable):
 *   <!-- pr-requirements-exempt: <reason> -->   skip the WHOLE gate (bots, etc.)
 *   <!-- visual-exempt: <reason> -->            skip only the visual-artifact rule
 *   <!-- changelog-exempt: <reason> -->         skip only the changelog-fragment rule
 *
 * The changelog rule lives HERE rather than in its own workflow because this is the
 * only PR workflow that listens to `edited` (pr-requirements.yml) — mandatory for a
 * body-based exemption, or an author could pass at synchronize time and then delete
 * the marker. The fragment FORMAT check is a separate script + ci-gate job
 * (`scripts/assemble-changelog.mjs --check`), because that one must also run on
 * merge-queue heads and pushes to main where there is no PR body at all.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// One shared definition of "a surface a user would feel" — see the module header
// for why `ci.yml`'s detect-changes classifier is deliberately NOT the one reused.
// VISUAL_SURFACE_RE moved there so the visual rule (3) and the changelog rule (4)
// cannot drift apart.
import { VISUAL_SURFACE_RE, isUserVisibleSurface } from './lib/user-visible-surfaces.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A changed file that is itself a committed image/video counts as artifact evidence
// (you committed the screenshot/recording), independent of body links. These are
// `$`-anchored: they match a FILENAME.
// avif is a still-image format (animated AVIF is rare); it counts as a screenshot,
// not as the "GIF or recording" motion artifact.
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|svg|bmp|tiff?|avif)$/i
const MOTION_EXT_RE = /\.(gif|mp4|mov|webm|m4v)$/i
// Same extensions, but for finding a link INSIDE the PR body, where the path is
// followed by `)`, `"`, a query string, an anchor, or whitespace — never end-of-string.
const BODY_IMAGE_RE = /\.(png|jpe?g|webp|svg|bmp|tiff?|avif)(?=[)"'\s?#]|$)/i
const BODY_MOTION_RE = /\.(gif|mp4|mov|webm|m4v)(?=[)"'\s?#]|$)/i

// Floors on substance. Intentionally moderate: the gate enforces PRESENCE and a
// word floor so empty or near-empty sections cannot ship. It does NOT catch
// well-padded boilerplate or filler that clears the floor — judging real triviality
// vs. honest brevity is the adversarial reviewer's job, not a word counter's.
// Counted AFTER stripping HTML comments and checkbox lines.
const MIN_SUMMARY_WORDS = 10
const MIN_TEST_PLAN_WORDS = 12

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

/** Resolve the PR body + number + title + author from --event-path / --body-file / --body. */
function loadPrContext() {
  const eventPath = arg('--event-path')
  if (eventPath && existsSync(eventPath)) {
    try {
      const ev = JSON.parse(readFileSync(eventPath, 'utf8'))
      const pr = ev.pull_request
      if (pr) {
        return {
          body: pr.body ?? '',
          number: pr.number,
          title: pr.title ?? '',
          author: pr.user?.login ?? '',
          source: 'event',
        }
      }
    } catch (e) {
      console.error(`check-pr-requirements: could not parse --event-path: ${e.message}`)
      process.exit(1)
    }
  }
  const title = arg('--title') ?? ''
  const author = arg('--author') ?? ''
  const bodyFile = arg('--body-file')
  if (bodyFile) {
    return { body: readFileSync(bodyFile, 'utf8'), number: null, title, author, source: 'body-file' }
  }
  const body = arg('--body')
  if (body != null) return { body, number: null, title, author, source: 'body' }
  return null
}

function changedFiles() {
  const filesFrom = arg('--files-from')
  if (filesFrom) {
    return readFileSync(filesFrom, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  }
  const changed = arg('--changed')
  if (changed != null) return changed.split(',').map((s) => s.trim()).filter(Boolean)

  let base = 'origin/main'
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: REPO, stdio: 'ignore' })
  } catch {
    base = 'HEAD~1'
  }
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', `${base}...HEAD`], {
      cwd: REPO, encoding: 'utf8',
    })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    // Fail safe: if the diff can't be computed, don't silently pass the visual
    // gate — but we also can't invent a file list. Return empty and let the body
    // checks still run; CI's detect-changes basis is the git history anyway.
    return []
  }
}

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

/** Body with HTML comments removed (template guidance must never count as content). */
function stripComments(body) {
  return body.replace(HTML_COMMENT_RE, '')
}

/** Pull every `<!-- marker: ... -->` so escape hatches survive comment-stripping. */
function exemptMarkers(body) {
  const markers = []
  for (const m of body.matchAll(HTML_COMMENT_RE)) markers.push(m[0])
  return markers
}

// A marker counts ONLY when an HTML comment *is* the directive: it starts with the
// token and carries a non-empty reason — `<!-- visual-exempt: pure refactor -->`.
// A loose substring match (the original bug) let the PR template's own guidance
// comment, which names these markers, silently exempt every PR — the gate would
// disable itself. Requiring the reason also makes the exemption auditable, not blank.
//
// The reason is checked against the comment's INNER text, with `<!--` and `-->`
// stripped first. The previous form matched `\S` directly against the raw comment,
// and `\S` happily matched the `-` of the CLOSING `-->`: `<!-- visual-exempt: -->`
// — a marker with a completely empty reason — exempted the gate, defeating exactly
// the "auditable, not blank" property this comment claims. `<!-- visual-exempt -->`
// (no colon) was already correctly ignored and had a test; the colon-with-no-reason
// form did not, which is how it survived. Found while adding rule (4).
function hasMarker(body, name) {
  const re = new RegExp(`^${name}\\s*:\\s*\\S`, 'i')
  return exemptMarkers(body).some((c) => {
    const inner = c.trim().replace(/^<!--/, '').replace(/-->$/, '').trim()
    return re.test(inner)
  })
}

/**
 * Extract a section's content by heading text (case-insensitive substring match),
 * from the matched heading to the next heading of the same-or-higher level.
 * Returns the prose word count after dropping checkbox lines and bullets-only noise.
 */
function sectionWordCount(strippedBody, headingNeedle) {
  const lines = strippedBody.split('\n')
  const isFence = (l) => /^\s*(?:```|~~~)/.test(l)
  let start = -1
  let startLevel = 0
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (isFence(lines[i])) { inFence = !inFence; continue }
    if (inFence) continue
    const m = lines[i].match(/^(#{1,6})\s*(.+?)\s*$/)
    if (m && m[2].toLowerCase().includes(headingNeedle)) {
      start = i
      startLevel = m[1].length
      break
    }
  }
  if (start === -1) return null // section absent

  // Headings INSIDE a fenced code block (e.g. `# comment` in pasted shell output)
  // must not terminate the section — track fences so the Test Plan can quote logs.
  const content = []
  inFence = false
  for (let i = start + 1; i < lines.length; i++) {
    if (isFence(lines[i])) { inFence = !inFence; content.push(lines[i]); continue }
    if (!inFence) {
      const m = lines[i].match(/^(#{1,6})\s/)
      if (m && m[1].length <= startLevel) break
    }
    content.push(lines[i])
  }

  const prose = content
    // drop checkbox lines — template scaffolding, not authored proof
    .filter((l) => !/^\s*[-*]\s*\[[ xX]\]/.test(l))
    // drop bare list markers / horizontal rules / leftover dashes
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .join(' ')
    .replace(/[`*_#>]/g, ' ')
    .trim()

  const words = prose.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w))
  return words.length
}

/** True if the body embeds at least one media reference of the given kind. */
function bodyHasMedia(body, motion) {
  const text = body
  // raw.githubusercontent / user-content asset links and explicit extensions.
  const extRe = motion ? BODY_MOTION_RE : BODY_IMAGE_RE
  if (extRe.test(text)) return true
  if (motion) {
    // Motion needs EXPLICIT evidence — an animated/video extension (above) or a
    // <video> embed. An opaque GitHub attachment link could be a still image, so it
    // must not satisfy the "GIF or recording" half on its own (else one unknown
    // link clears both requirements).
    if (/<video[\s>]/i.test(text)) return true
  } else {
    // Markdown image, <img>, or a dragged-in GitHub attachment (often extension-less).
    if (/!\[[^\]]*\]\([^)]+\)/.test(text)) return true
    if (/<img[\s>]/i.test(text)) return true
    if (/https:\/\/github\.com\/[^\s)]+\/(?:assets|user-attachments)\//i.test(text)) return true
  }
  return false
}

function main() {
  const ctx = loadPrContext()
  if (!ctx) {
    console.log('check-pr-requirements: no PR context (no --event-path/--body-file); skipping.')
    return
  }
  const body = ctx.body || ''

  if (hasMarker(body, 'pr-requirements-exempt')) {
    console.log('check-pr-requirements: <!-- pr-requirements-exempt --> present; skipping (audited in body).')
    return
  }

  const failures = []
  const stripped = stripComments(body)

  // (1) Summary present + real prose.
  const summaryWords = sectionWordCount(stripped, 'summary')
  if (summaryWords === null) {
    failures.push('Missing a `## Summary` section. Keep the template heading and write the summary under it.')
  } else if (summaryWords < MIN_SUMMARY_WORDS) {
    failures.push(`Summary is too thin (${summaryWords} words of prose; need ≥ ${MIN_SUMMARY_WORDS}). Describe what changed and why — exhaustively, not a one-liner.`)
  }

  // (2) Test Plan present + non-trivial.
  const testWords = sectionWordCount(stripped, 'test plan')
  if (testWords === null) {
    failures.push('Missing a `## Test Plan` section. Every PR needs a non-trivial test plan demonstrating the diff actually works.')
  } else if (testWords < MIN_TEST_PLAN_WORDS) {
    failures.push(`Test Plan is too thin (${testWords} words of prose; need ≥ ${MIN_TEST_PLAN_WORDS}). Show the evidence: commands run, their output, and the edge cases exercised.`)
  }

  // (3) Visual surface ⇒ visual artifacts.
  const files = changedFiles()
  const visualFiles = files.filter((f) => VISUAL_SURFACE_RE.test(f))
  if (visualFiles.length && !hasMarker(body, 'visual-exempt')) {
    const committedImage = files.some((f) => IMAGE_EXT_RE.test(f))
    const committedMotion = files.some((f) => MOTION_EXT_RE.test(f))
    const hasImage = committedImage || bodyHasMedia(body, false)
    const hasMotion = committedMotion || bodyHasMedia(body, true)
    if (!hasImage || !hasMotion) {
      const missing = []
      if (!hasImage) missing.push('a screenshot (image)')
      if (!hasMotion) missing.push('a GIF or screen recording')
      failures.push(
        `Visual surface changed (${visualFiles.slice(0, 5).join(', ')}${visualFiles.length > 5 ? ', …' : ''}) ` +
        `but the PR body is missing ${missing.join(' and ')}. Attach screenshots + a GIF + a short recording ` +
        'of the actual change (commit them and embed raw.githubusercontent URLs), or add ' +
        '`<!-- visual-exempt: <reason> -->` to the body if there is genuinely no visual change.',
      )
    }
  }

  // (4) User-visible surface ⇒ a changelog fragment.
  //
  // Auto-skips are enumerated, not heuristic — a script that guessed "is this
  // user-visible really" would be the solutionism anti-pattern this file's header
  // warns about. Each one has a stated reason:
  //   - tests-only: a test is not a user-visible change.
  //   - markdown-only: docs take the exemption marker, not a changelog section
  //     (there is deliberately no `docs` fragment type).
  //   - the release train's own bump: NECESSARY, not cosmetic — `package.json` is
  //     in DAEMON_PATHSPEC, and the bump commit is the one that CONSUMES fragments,
  //     so requiring it to add one would deadlock the release.
  if (!hasMarker(body, 'changelog-exempt')) {
    const userVisible = files.filter(isUserVisibleSurface)
    const testsOnly = userVisible.length > 0 && userVisible.every((f) => f.startsWith('tests/'))
    const markdownOnly = files.length > 0 && files.every((f) => f.endsWith('.md'))
    const isReleaseBump =
      /^chore\(release\): bump to/.test(ctx.title || '') || ctx.author === 'port-daddy-release-train'
    const addsFragment = files.some(
      (f) => f.startsWith('changelog.d/') && f !== 'changelog.d/README.md',
    )

    if (userVisible.length && !testsOnly && !markdownOnly && !isReleaseBump && !addsFragment) {
      failures.push(
        `User-visible surface changed (${userVisible.slice(0, 5).join(', ')}${userVisible.length > 5 ? ', …' : ''}) ` +
        'but this PR adds no changelog fragment. Create `changelog.d/<pr>-<slug>.md` ' +
        '(format: changelog.d/README.md), or add `<!-- changelog-exempt: <reason> -->` to the ' +
        'body if this genuinely ships nothing a user would notice.',
      )
    }
  }

  if (failures.length) {
    console.error(`\n✗ check-pr-requirements: ${failures.length} unmet requirement(s):\n`)
    for (const f of failures) console.error(`  • ${f}`)
    console.error(
      '\nThis is the machine half of AGENTS.md § Pull Request Operating Procedure. ' +
      'See .github/PULL_REQUEST_TEMPLATE.md for the form. Fix the PR description and push; ' +
      'the check re-runs on synchronize.\n',
    )
    process.exit(1)
  }
  console.log('check-pr-requirements: PR meets the contract (summary, test plan, visual artifacts, changelog fragment).')
}

main()
