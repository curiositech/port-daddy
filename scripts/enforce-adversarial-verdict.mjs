#!/usr/bin/env node
/**
 * enforce-adversarial-verdict.mjs — runs as a post-step after the
 * claude-adversarial-review action. It does two things the action itself was
 * NOT doing:
 *
 *   1. POSTS the reviewer's output as a PR comment. The action runs Claude but,
 *      by default, Claude's attempts to post are denied by the action's own tool
 *      sandbox (permission_denials_count > 0, "No buffered inline comments").
 *      Rather than fight that sandbox, we read the action's saved execution log
 *      (claude-execution-output.json) and post the final text ourselves via the
 *      job's GITHUB_TOKEN (which has pull-requests: write). The comment is a
 *      sticky one (marker below) — updated in place on re-runs, not duplicated.
 *
 *   2. ENFORCES the verdict. The reviewer ends with `VERDICT: SHIP` /
 *      `SHIP-AFTER-FIX` / `DO-NOT-SHIP`. On DO-NOT-SHIP this step exits non-zero
 *      so the `adversarial-review` check goes red — giving the verdict teeth
 *      instead of being ignorable comment text. SHIP-AFTER-FIX is surfaced but
 *      does not fail (a softer state); SHIP passes.
 *
 * Override (false positives happen — it's an LLM): put
 *   <!-- adversarial-override: <reason> -->
 * in the PR body, or apply the `adversarial-override` label. Then DO-NOT-SHIP
 * is reported but does NOT fail the check.
 *
 * Env: GH_TOKEN (gh), GITHUB_REPOSITORY, GITHUB_EVENT_PATH (for PR number),
 *      CLAUDE_EXEC (path to the action's execution JSON; defaults to the
 *      standard runner temp path). Best-effort + defensive: a missing/garbled
 *      log warns and exits 0 rather than failing a build on an infra hiccup.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const MARKER = '<!-- adversarial-review -->'
const OVERRIDE_LABEL = 'adversarial-override'
const DEFAULT_EXEC = '/home/runner/work/_temp/claude-execution-output.json'

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

function prNumber() {
  const p = process.env.GITHUB_EVENT_PATH
  if (!p || !existsSync(p)) return null
  try {
    const ev = JSON.parse(readFileSync(p, 'utf8'))
    return ev.pull_request?.number ?? ev.issue?.number ?? null
  } catch {
    return null
  }
}

/**
 * Pull the model's final assistant text out of the action's execution log,
 * which may be a JSON array of stream events or newline-delimited JSON. We try,
 * in order: the `result` event's `.result`, else the last `assistant` message's
 * concatenated text blocks.
 */
export function extractFinalText(raw) {
  let events
  try {
    const parsed = JSON.parse(raw)
    events = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    events = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }
  // Prefer an explicit result event carrying the final text.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e?.type === 'result' && typeof e.result === 'string' && e.result.trim()) return e.result.trim()
  }
  // Else the last assistant message's text blocks.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    const content = e?.message?.content ?? e?.content
    if ((e?.type === 'assistant' || e?.role === 'assistant') && Array.isArray(content)) {
      const text = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return null
}

/** Last `VERDICT: X` line in the text → 'SHIP' | 'SHIP-AFTER-FIX' | 'DO-NOT-SHIP' | null. */
export function parseVerdict(text) {
  if (!text) return null
  const matches = [...text.matchAll(/VERDICT:\s*(DO-NOT-SHIP|SHIP-AFTER-FIX|SHIP)\b/gi)]
  if (matches.length === 0) return null
  return matches[matches.length - 1][1].toUpperCase()
}

function upsertStickyComment(repo, number, body) {
  const framed = `${MARKER}\n${body}`
  try {
    const comments = JSON.parse(gh(['api', `repos/${repo}/issues/${number}/comments`, '--paginate']))
    const existing = Array.isArray(comments) ? comments.find((c) => c.body?.includes(MARKER)) : null
    if (existing) {
      gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-f', `body=${framed}`])
      return
    }
  } catch {
    /* fall through to create */
  }
  try {
    gh(['pr', 'comment', String(number), '--body', framed])
  } catch {
    console.error('enforce-adversarial-verdict: could not post the review comment (non-fatal).')
  }
}

function isOverridden(repo, number) {
  try {
    const pr = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`]))
    if (/<!--\s*adversarial-override\s*:\s*\S/i.test(pr.body ?? '')) return true
  } catch {
    /* ignore */
  }
  try {
    const labels = JSON.parse(gh(['api', `repos/${repo}/issues/${number}/labels`]))
    if (Array.isArray(labels) && labels.some((l) => l.name === OVERRIDE_LABEL)) return true
  } catch {
    /* ignore */
  }
  return false
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const number = prNumber()
  if (!repo || !number) {
    console.log('enforce-adversarial-verdict: no PR context; skipping.')
    return
  }
  const execPath = process.env.CLAUDE_EXEC || DEFAULT_EXEC
  if (!existsSync(execPath)) {
    console.log(`enforce-adversarial-verdict: execution log not found at ${execPath}; skipping (non-fatal).`)
    return
  }

  const text = extractFinalText(readFileSync(execPath, 'utf8'))
  if (!text) {
    console.log('enforce-adversarial-verdict: could not extract reviewer text from the log; skipping (non-fatal).')
    return
  }

  upsertStickyComment(repo, number, text)
  const verdict = parseVerdict(text)
  console.log(`enforce-adversarial-verdict: verdict = ${verdict ?? 'NONE'}`)

  if (verdict === 'DO-NOT-SHIP') {
    if (isOverridden(repo, number)) {
      console.log('enforce-adversarial-verdict: DO-NOT-SHIP, but an operator override is present — not failing.')
      return
    }
    console.error(
      '\n✗ Adversarial reviewer verdict: DO-NOT-SHIP. This check is failing on purpose.\n' +
      'The full review (with the findings to address) is posted as a sticky comment on this PR and is ' +
      'reproduced below for the log. To merge over it, add `<!-- adversarial-override: <reason> -->` to ' +
      'the PR body or apply the `adversarial-override` label.\n\n' +
      '──── adversarial review ────\n' + text + '\n────────────────────────────\n',
    )
    process.exitCode = 1
    return
  }
  if (verdict === 'SHIP-AFTER-FIX') {
    console.log('enforce-adversarial-verdict: SHIP-AFTER-FIX — surfaced in the comment; not blocking.')
    return
  }
  console.log('enforce-adversarial-verdict: SHIP (or no blocking verdict). ✅')
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
