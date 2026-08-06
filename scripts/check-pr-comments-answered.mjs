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
 * I/O: reads the live PR via `gh` (GraphQL for review threads), so it needs no
 * extra deps and runs the same locally as in Actions. With no PR context it is a
 * no-op (exit 0). The pure decision (`classifyThreads`) is exported and unit-tested.
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

const THREADS_QUERY = `
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      author { login }
      body
      reviewThreads(first: 100) {
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
  const out = gh([
    'api', 'graphql',
    '-f', `query=${THREADS_QUERY}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `number=${number}`,
  ])
  const pr = JSON.parse(out)?.data?.repository?.pullRequest
  if (!pr) return null
  const threads = (pr.reviewThreads?.nodes ?? []).map((t) => {
    const comments = (t.comments?.nodes ?? []).map((c) => ({ authorLogin: c.author?.login ?? null, url: c.url }))
    return {
      isResolved: t.isResolved,
      isOutdated: t.isOutdated,
      path: t.path,
      url: comments[0]?.url,
      comments,
    }
  })
  return { authorLogin: pr.author?.login ?? null, body: pr.body ?? '', threads }
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

  const { unanswered, total, answered } = classifyThreads(pr.threads, pr.authorLogin)
  syncLabel(owner, repo, number, unanswered.length > 0)

  if (unanswered.length === 0) {
    console.log(`check-pr-comments-answered: all ${total} review thread(s) answered or resolved. ✅`)
    writeStepSummary(`## ✅ Review comments — PR #${number}\n\nAll ${total} review thread(s) answered or resolved.`)
    return
  }

  // Two groups because they ask for two different things. A live thread wants a
  // decision (fixed / deferred / contested). An outdated one means you ALREADY
  // touched those lines — the reviewer just cannot see what you did, so the ask
  // is a one-line report, not a fresh triage. Collapsing them into one list is
  // what made outdated threads feel like noise and got them skipped in the first
  // place.
  const live = unanswered.filter((t) => !t.isOutdated)
  const outdated = unanswered.filter((t) => t.isOutdated)
  const bullet = (t) => `  • ${t.path ?? 'thread'} — ${t.url ?? '(no link)'}`
  const item = (t) => `- \`${t.path ?? 'thread'}\` — ${t.url ?? ''}`
  // Only the outdated bucket is capped; the live one is the group you must read.
  const shownOutdated = outdated.slice(0, OUTDATED_LIMIT)
  const elided = outdated.length - shownOutdated.length

  console.error(
    `\n✗ check-pr-comments-answered: ${unanswered.length} of ${total} review thread(s) are unanswered ` +
    `(a reviewer spoke last and the thread is still open):\n`,
  )
  if (live.length > 0) {
    console.error(`  Reviewer spoke last (${live.length}):`)
    for (const t of live) console.error(bullet(t))
  }
  if (outdated.length > 0) {
    console.error(
      `\n  You changed these lines — say what you changed, or resolve (${outdated.length}):`,
    )
    for (const t of shownOutdated) console.error(bullet(t))
    if (elided > 0) console.error(`  …and ${elided} more`)
  }
  console.error(
    '\nReply to each thread (fixed / deferred-with-reason / contested-because) or resolve it. ' +
    'Per AGENTS.md you must engage every review comment before merge. This check is ADVISORY — it ' +
    `does not block the merge, but it carries the \`${LABEL}\` label and re-runs when you respond.\n`,
  )

  const sections = []
  if (live.length > 0) {
    sections.push(`**Reviewer spoke last (${live.length}):**\n\n${live.map(item).join('\n')}`)
  }
  if (outdated.length > 0) {
    const tail = elided > 0 ? `\n- …and ${elided} more` : ''
    sections.push(
      `**You changed these lines — say what you changed, or resolve (${outdated.length}):**\n\n` +
      shownOutdated.map(item).join('\n') + tail,
    )
  }
  writeStepSummary(
    `## ⚠️ ${unanswered.length} unanswered review thread(s) — PR #${number}\n\n` +
    `${answered}/${total} answered.\n\n${sections.join('\n\n')}`,
  )
  process.exitCode = 1
}

// Only run the CI path when invoked directly (so the unit test can import the
// pure functions without triggering gh / network).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
