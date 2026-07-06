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
 * A thread NEEDS A REPLY when all of:
 *   - it is not resolved, and
 *   - it is not outdated (the code it pointed at still exists), and
 *   - the LAST comment is from someone other than the PR author — i.e. the ball
 *     is in the author's court (a reviewer spoke last and got no response).
 * Resolving the thread, or the author replying after the reviewer, satisfies it.
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

/**
 * Pure decision core. Given review threads + the PR author's login, return the
 * threads still waiting on the author. No I/O — trivially unit-testable.
 *
 * @param {Array<{isResolved:boolean, isOutdated:boolean, path?:string, url?:string,
 *                comments:Array<{authorLogin:string|null}>}>} threads
 * @param {string} prAuthorLogin
 * @returns {{ unanswered: Array<object>, total:number, answered:number }}
 */
export function classifyThreads(threads, prAuthorLogin) {
  const list = Array.isArray(threads) ? threads : []
  const unanswered = list.filter((t) => {
    if (!t || t.isResolved || t.isOutdated) return false
    const comments = Array.isArray(t.comments) ? t.comments : []
    if (comments.length === 0) return false
    const last = comments[comments.length - 1]
    const lastAuthor = last?.authorLogin ?? null
    // Author (or anyone on the author's side) spoke last → engaged. Only a
    // reviewer-has-the-last-word, still-open thread counts as ignored.
    return lastAuthor !== prAuthorLogin
  })
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

  const lines = unanswered.map((t) => `  • ${t.path ?? 'thread'} — ${t.url ?? '(no link)'}`)
  console.error(
    `\n✗ check-pr-comments-answered: ${unanswered.length} of ${total} review thread(s) are unanswered ` +
    `(a reviewer spoke last and got no reply, and the thread is open):\n`,
  )
  for (const l of lines) console.error(l)
  console.error(
    '\nReply to each thread (fixed / deferred-with-reason / contested-because) or resolve it. ' +
    'Per AGENTS.md you must engage every review comment before merge. This check is ADVISORY — it ' +
    `does not block the merge, but it carries the \`${LABEL}\` label and re-runs when you respond.\n`,
  )
  writeStepSummary(
    `## ⚠️ ${unanswered.length} unanswered review thread(s) — PR #${number}\n\n` +
    `${answered}/${total} answered. Reply to or resolve the rest:\n\n` +
    unanswered.map((t) => `- \`${t.path ?? 'thread'}\` — ${t.url ?? ''}`).join('\n'),
  )
  process.exitCode = 1
}

// Only run the CI path when invoked directly (so the unit test can import the
// pure functions without triggering gh / network).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
