#!/usr/bin/env node
/**
 * check-pr-comments-answered.mjs — the machine half of AGENTS.md
 * § "Respond to every review comment". An ADVISORY gate (it never blocks a
 * merge): it flags a PR whose review threads — the inline comments left ON THE
 * DIFF by humans or review bots (Copilot, the Claude code-review / adversarial
 * reviewer, etc.) — have been left unanswered, so "just ignore the nits" stops
 * being a silent option.
 *
 * Scope (deliberate): REVIEW THREADS only — the threaded, resolvable comments
 * attached to a line of the diff. Top-level PR conversation comments (Cloudflare
 * deploy status, the roadmap-link-gate note, FleetBot summaries) are NOT threads
 * and are excluded, which is exactly what keeps this low-noise. The broader
 * "answer every comment" rule lives in AGENTS.md doctrine and is judged by the
 * adversarial reviewer.
 *
 * A thread NEEDS A REPLY when both of:
 *   - it is not resolved, and
 *   - the LAST comment is from someone other than the PR author — i.e. the ball
 *     is in the author's court (a reviewer spoke last and got no response).
 * Resolving the thread, or the author replying after the reviewer, satisfies it.
 *
 * OUTDATED IS NOT AN ANSWER. GitHub marks a thread outdated exactly when the
 * author pushes a change to the lines it points at — which is precisely the
 * moment they acted on the feedback and have something worth saying. Treating
 * that as "answered" (the original behaviour, observed swallowing a real thread
 * on PR #5437) let the guard print "all N answered" while a reviewer sat there
 * with no response and a silent force-push. Outdated threads therefore still
 * count as unanswered; they are just REPORTED differently — "you changed these
 * lines, say what you changed" rather than "here is a fresh nit".
 *
 * The author can answer EITHER by replying in the thread OR by resolving it.
 * This gate checks for that engagement (presence); whether the reply is serious
 * vs. dismissive is the adversarial reviewer's call, not a script's.
 *
 * Escape hatch (visible + auditable, mirroring the other guards):
 *   <!-- pr-comments-exempt: <reason> -->   in the PR body skips the whole gate.
 *
 * I/O: reads the live PR via `gh` (GraphQL for review threads, PAGINATED to the
 * end so a >100-thread PR is not silently truncated — that truncation was itself
 * a #5437-shaped false green), so it needs no extra deps and runs the same
 * locally as in Actions. With no PR context it is a no-op (exit 0). main() is a
 * thin fetch→decide→print shell: the gate's whole verdict — exit code, label,
 * the two rendered groups, the truncation refusal — lives in the exported,
 * unit-tested pure functions `classifyThreads` and `decideCommentGate`, so no
 * pass/fail logic can hide from the test suite the way the outdated-skip once did.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const LABEL = 'needs-comment-replies'

// Outdated threads arrive in a clump — one push that reformats a file can strand
// a dozen at once — and a wall of them buries the reviewer-spoke-last group that
// needs a considered reply. Cap what we RENDER, never what we count: the number
// in the headline stays honest, the list stops being a scroll wall.
export const OUTDATED_LIMIT = 20

/**
 * Pure decision core. Given review threads + the PR author's login, return the
 * threads still waiting on the author. No I/O — trivially unit-testable.
 *
 * `isOutdated` rides along on each unanswered entry rather than filtering it out:
 * both shapes owe the reviewer a response, but only the reporting differs, and
 * that decision belongs to the caller that renders.
 *
 * @param {Array<{isResolved:boolean, isOutdated:boolean, path?:string, url?:string,
 *                comments:Array<{authorLogin:string|null}>}>} threads
 * @param {string} prAuthorLogin
 * @returns {{ unanswered: Array<object>, total:number, answered:number }}
 */
export function classifyThreads(threads, prAuthorLogin) {
  const list = Array.isArray(threads) ? threads : []
  const unanswered = list.filter((t) => {
    if (!t || t.isResolved) return false
    const comments = Array.isArray(t.comments) ? t.comments : []
    if (comments.length === 0) return false
    const last = comments[comments.length - 1]
    const lastAuthor = last?.authorLogin ?? null
    // Author (or anyone on the author's side) spoke last → engaged. Only a
    // reviewer-has-the-last-word, still-open thread counts as ignored.
    return lastAuthor !== prAuthorLogin
  }).map((t) => ({ ...t, isOutdated: Boolean(t.isOutdated) }))
  // `answered` is derived, never independently tallied: the one invariant this
  // gate lives or dies by is answered + unanswered === total, and the bug it is
  // replacing was exactly a thread going missing from both buckets' arithmetic.
  return { unanswered, total: list.length, answered: list.length - unanswered.length }
}

/**
 * The GATE's verdict — pure, so the thing CI actually acts on (exit code, which
 * label to set, the two rendered groups) is unit-testable instead of buried in
 * main(). classifyThreads answers "which threads owe a reply"; this answers the
 * question the check exists to ask: "does this PR pass, and what do we print?"
 * Testing only classifyThreads let the original PR-#5437 bug relocate one layer
 * up (a `.filter(t => !t.isOutdated)` in main) with every unit test still green
 * — the exact false-green this guard is about. So the verdict is a function too.
 *
 * `truncated` is the pagination guard (Blocker 3): if the fetch could not see
 * every thread, we CANNOT honestly say "all N answered". An unseen thread is
 * indistinguishable from an unanswered one, so we fail toward "you still owe
 * replies" — never toward a green check computed over a partial list. That is
 * verbatim the #5437 failure mode (a real unanswered thread hidden from the
 * count), so it gets the same answer: incomplete ⇒ not green.
 *
 * @param {Array<object>} threads  review threads (see classifyThreads)
 * @param {string} prAuthorLogin
 * @param {{truncated?:boolean, prNumber?:number|null}} [opts]
 * @returns {{
 *   exitCode:number, clean:boolean, truncated:boolean, total:number, answered:number,
 *   unansweredLive:Array<object>, unansweredOutdated:Array<object>,
 *   shownOutdated:Array<object>, elided:number,
 *   stdoutLine:string, stderrText:string, summaryText:string
 * }}
 */
export function decideCommentGate(threads, prAuthorLogin, opts = {}) {
  const truncated = Boolean(opts.truncated)
  const prNumber = opts.prNumber ?? null
  const head = prNumber != null ? ` — PR #${prNumber}` : ''

  const { unanswered, total, answered } = classifyThreads(threads, prAuthorLogin)
  // Two groups because they ask for two different things. A live thread wants a
  // decision (fixed / deferred / contested). An outdated one means you ALREADY
  // touched those lines — the reviewer just cannot see what you did, so the ask
  // is a one-line report. Collapsing them is what made outdated threads read as
  // noise and got them skipped in the first place.
  const unansweredLive = unanswered.filter((t) => !t.isOutdated)
  const unansweredOutdated = unanswered.filter((t) => t.isOutdated)
  // Only the outdated bucket is capped — the live one is the group you must read
  // — and ONLY the render is capped, never the count in the headline.
  const shownOutdated = unansweredOutdated.slice(0, OUTDATED_LIMIT)
  const elided = unansweredOutdated.length - shownOutdated.length

  // Green requires BOTH nothing owed AND a complete view. Truncation alone flips
  // the verdict red even when every visible thread is answered.
  const clean = unanswered.length === 0 && !truncated
  const exitCode = clean ? 0 : 1

  const bullet = (t) => `  • ${t.path ?? 'thread'} — ${t.url ?? '(no link)'}`
  const item = (t) => `- \`${t.path ?? 'thread'}\` — ${t.url ?? ''}`
  const truncNoteErr =
    '  ⚠ the review-thread list was TRUNCATED (more threads than one page returns); this result is ' +
    'INCOMPLETE. Unseen threads are treated as unanswered — reply/resolve and re-run so every thread is seen.'
  const truncNoteMd =
    '> ⚠️ **Incomplete:** the review-thread list was truncated (more threads than one page returns). ' +
    'Unseen threads are treated as unanswered; this is not a green result until every thread can be seen.'

  if (clean) {
    return {
      exitCode, clean, truncated, total, answered,
      unansweredLive, unansweredOutdated, shownOutdated, elided,
      stdoutLine: `check-pr-comments-answered: all ${total} review thread(s) answered or resolved. ✅`,
      stderrText: '',
      summaryText: `## ✅ Review comments${head}\n\nAll ${total} review thread(s) answered or resolved.`,
    }
  }

  // ── red path ──────────────────────────────────────────────────────────────
  const errLines = []
  errLines.push('')
  errLines.push(
    `✗ check-pr-comments-answered: ${unanswered.length} of ${total} review thread(s) are unanswered ` +
    `(a reviewer spoke last and the thread is still open):`,
  )
  errLines.push('')
  if (unansweredLive.length > 0) {
    errLines.push(`  Reviewer spoke last (${unansweredLive.length}):`)
    for (const t of unansweredLive) errLines.push(bullet(t))
  }
  if (unansweredOutdated.length > 0) {
    errLines.push('')
    errLines.push(`  You changed these lines — say what you changed, or resolve (${unansweredOutdated.length}):`)
    for (const t of shownOutdated) errLines.push(bullet(t))
    if (elided > 0) errLines.push(`  …and ${elided} more`)
  }
  if (truncated) {
    errLines.push('')
    errLines.push(truncNoteErr)
  }
  errLines.push('')
  errLines.push(
    'Reply to each thread (fixed / deferred-with-reason / contested-because) or resolve it. ' +
    'Per AGENTS.md you must engage every review comment before merge. This check is ADVISORY — it ' +
    `does not block the merge, but it carries the \`${LABEL}\` label and re-runs when you respond.`,
  )
  const stderrText = errLines.join('\n')

  const sections = []
  if (unansweredLive.length > 0) {
    sections.push(`**Reviewer spoke last (${unansweredLive.length}):**\n\n${unansweredLive.map(item).join('\n')}`)
  }
  if (unansweredOutdated.length > 0) {
    const tail = elided > 0 ? `\n- …and ${elided} more` : ''
    sections.push(
      `**You changed these lines — say what you changed, or resolve (${unansweredOutdated.length}):**\n\n` +
      shownOutdated.map(item).join('\n') + tail,
    )
  }
  if (truncated) sections.push(truncNoteMd)
  const heading = unanswered.length > 0
    ? `## ⚠️ ${unanswered.length} unanswered review thread(s)${head}`
    : `## ⚠️ Review comments — incomplete${head}`
  const summaryText = `${heading}\n\n${answered}/${total} answered${truncated ? ' (of the threads visible so far)' : ''}.\n\n${sections.join('\n\n')}`

  return {
    exitCode, clean, truncated, total, answered,
    unansweredLive, unansweredOutdated, shownOutdated, elided,
    stdoutLine: '', stderrText, summaryText,
  }
}

/** First `<!-- pr-comments-exempt: reason -->` directive in the body, if any. */
export function hasExempt(body) {
  if (!body) return false
  return /<!--\s*pr-comments-exempt\s*:\s*\S[\s\S]*?-->/i.test(body)
}

// ───────────────────────────── I/O wrapper (CI) ─────────────────────────────

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

/** Resolve the PR number from the Actions event payload or a CLI arg. */
function resolvePrNumber() {
  const argNum = process.argv.slice(2).find((a) => /^\d+$/.test(a))
  if (argNum) return Number(argNum)
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return null
  let ev
  try {
    ev = JSON.parse(readFileSync(eventPath, 'utf8'))
  } catch {
    return null
  }
  // pull_request / pull_request_review(_comment) → .pull_request.number
  // issue_comment on a PR                        → .issue.number (.issue.pull_request set)
  if (ev.pull_request?.number) return ev.pull_request.number
  if (ev.issue?.pull_request && ev.issue?.number) return ev.issue.number
  return null
}

// `$cursor` walks reviewThreads a page at a time. `pageInfo{hasNextPage}` is the
// truth we were flying blind without: reviewThreads(first:100) alone truncates a
// >100-thread PR SILENTLY — the same "a real thread never entered the count, so
// the guard printed all-answered" failure this whole PR exists to kill, just at
// the page boundary. We paginate to the end so it normally never truncates, and
// still surface hasNextPage so a partial fetch fails red instead of false-green.
const THREADS_QUERY = `
query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      author { login }
      body
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          comments(first: 100) { nodes { author { login } url } }
        }
      }
    }
  }
}`

function fetchPr(owner, repo, number) {
  const threads = []
  let authorLogin = null
  let body = ''
  let cursor = null
  let truncated = false
  // Bound the loop so a bad cursor can never spin forever; 50 pages × 100 = 5000
  // threads is far past any real PR, and if we somehow hit it we mark truncated
  // (fail red) rather than pretend the list is complete.
  for (let page = 0; page < 50; page++) {
    const args = [
      'api', 'graphql',
      '-f', `query=${THREADS_QUERY}`,
      '-F', `owner=${owner}`,
      '-F', `repo=${repo}`,
      '-F', `number=${number}`,
    ]
    if (cursor) args.push('-F', `cursor=${cursor}`)
    const pr = JSON.parse(gh(args))?.data?.repository?.pullRequest
    if (!pr) return page === 0 ? null : { authorLogin, body, threads, truncated }
    authorLogin = pr.author?.login ?? authorLogin
    body = pr.body ?? body
    const rt = pr.reviewThreads ?? {}
    for (const t of rt.nodes ?? []) {
      const comments = (t.comments?.nodes ?? []).map((c) => ({ authorLogin: c.author?.login ?? null, url: c.url }))
      threads.push({ isResolved: t.isResolved, isOutdated: t.isOutdated, path: t.path, url: comments[0]?.url, comments })
    }
    const info = rt.pageInfo ?? {}
    if (!info.hasNextPage) return { authorLogin, body, threads, truncated: false }
    if (!info.endCursor) {
      // hasNextPage true but no cursor to advance → we cannot see the rest.
      truncated = true
      break
    }
    cursor = info.endCursor
  }
  // Fell off the page bound (or lost the cursor) with more still to come: the
  // view is provably incomplete — hand that up so the gate refuses to go green.
  return { authorLogin, body, threads, truncated: true }
}

function syncLabel(owner, repo, number, want) {
  try {
    const labels = JSON.parse(gh(['api', `repos/${owner}/${repo}/issues/${number}/labels`]))
    const has = Array.isArray(labels) && labels.some((l) => l.name === LABEL)
    if (want === has) return
    if (want) {
      gh(['api', '--method', 'POST', `repos/${owner}/${repo}/issues/${number}/labels`, '-f', `labels[]=${LABEL}`])
    } else {
      gh(['api', '--method', 'DELETE', `repos/${owner}/${repo}/issues/${number}/labels/${LABEL}`])
    }
  } catch {
    /* labelling is best-effort; the check conclusion still carries the signal */
  }
}

function writeStepSummary(text) {
  const f = process.env.GITHUB_STEP_SUMMARY
  if (!f) return
  try {
    execFileSync('bash', ['-c', `cat >> "${f}"`], { input: `${text}\n` })
  } catch {
    /* best-effort */
  }
}

function main() {
  const number = resolvePrNumber()
  if (!number) {
    console.log('check-pr-comments-answered: no PR context; skipping.')
    return
  }
  const repoSlug = process.env.GITHUB_REPOSITORY
  if (!repoSlug) {
    console.log('check-pr-comments-answered: GITHUB_REPOSITORY unset; skipping.')
    return
  }
  const [owner, repo] = repoSlug.split('/')

  const pr = fetchPr(owner, repo, number)
  if (!pr) {
    console.log(`check-pr-comments-answered: could not load PR #${number}; skipping.`)
    return
  }

  if (hasExempt(pr.body)) {
    console.log('check-pr-comments-answered: <!-- pr-comments-exempt --> present; skipping (audited in body).')
    syncLabel(owner, repo, number, false)
    return
  }

  // fetch → decide → print. Every non-trivial choice (verdict, label, the two
  // rendered groups, the truncation refusal) lives in decideCommentGate, which
  // is unit-tested; main() only performs I/O so no gate logic can hide from the
  // suite the way the outdated-filter once did.
  const decision = decideCommentGate(pr.threads, pr.authorLogin, { truncated: pr.truncated, prNumber: number })
  syncLabel(owner, repo, number, decision.exitCode !== 0)
  if (decision.stdoutLine) console.log(decision.stdoutLine)
  if (decision.stderrText) console.error(decision.stderrText)
  if (decision.summaryText) writeStepSummary(decision.summaryText)
  process.exitCode = decision.exitCode
}

// Only run the CI path when invoked directly (so the unit test can import the
// pure functions without triggering gh / network).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
