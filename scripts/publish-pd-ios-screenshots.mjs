#!/usr/bin/env node
/**
 * publish-pd-ios-screenshots.mjs
 *
 * Upserts one sticky PR comment embedding the four per-tab screenshots that
 * scripts/capture-screenshots.sh just produced and a prior CI step already
 * pushed to the `ci-screenshots` branch under `pr-<n>/<sha>/`. Private-repo
 * `raw.githubusercontent.com` links 404 for viewers without a separately
 * authenticated raw-domain session, so this links through GitHub's own blob
 * viewer with `?raw=true` instead, which redirects through the authenticated
 * media pipeline every PR viewer already has.
 *
 * Mirrors fleetbot-review-request.mjs's sticky-comment pattern: a marker
 * comment, PATCH if it exists, POST if it doesn't, `gh` CLI throughout so it
 * runs the same locally (with `gh auth login`) and in GitHub Actions.
 */
import { execFileSync } from 'node:child_process'

export const SCREENSHOT_COMMENT_MARKER = '<!-- pd-ios-screenshots -->'

export const SCREENSHOT_TABS = [
  { file: '01-roadmap.png', label: 'Roadmap' },
  { file: '02-harbors.png', label: 'Harbors' },
  { file: '03-asks.png', label: 'Asks' },
  { file: '04-controls.png', label: 'Controls' },
]

export function buildScreenshotComment({ owner, repo, sha, dest, tabs = SCREENSHOT_TABS }) {
  const shortSha = sha.slice(0, 9)
  const rows = tabs
    .map((tab) => {
      const url = `https://github.com/${owner}/${repo}/blob/ci-screenshots/${dest}/${tab.file}?raw=true`
      return `| ${tab.label} | ![${tab.label}](${url}) |`
    })
    .join('\n')

  return [
    '### pd-ios screenshots',
    '',
    `Automated capture at \`${shortSha}\` — the real app, booted in a simulator, driven through all four root tabs via XCUITest. RootView is fixture-backed, so this is deterministic and needs no network/pairing/auth.`,
    '',
    '| Tab | |',
    '| --- | --- |',
    rows,
    '',
    'This is visual evidence only, not a merge gate — `pd-ios` above is the actual compile+test gate.',
    '',
    SCREENSHOT_COMMENT_MARKER,
  ].join('\n')
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

function ghJsonOptional(args, fallback) {
  try {
    const out = gh(args)
    return out ? JSON.parse(out) : fallback
  } catch {
    return fallback
  }
}

function repoParts() {
  const slug = process.env.GITHUB_REPOSITORY
  if (!slug) return null
  const [owner, repo] = slug.split('/')
  return owner && repo ? { owner, repo } : null
}

function upsertStickyComment(owner, repo, number, body) {
  const comments = ghJsonOptional(['api', `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`], [])
  const existing = comments.find((c) => String(c?.body ?? '').includes(SCREENSHOT_COMMENT_MARKER))
  if (existing?.id) {
    gh(['api', '--method', 'PATCH', `repos/${owner}/${repo}/issues/comments/${existing.id}`, '-f', `body=${body}`])
    return
  }
  gh(['api', '--method', 'POST', `repos/${owner}/${repo}/issues/${number}/comments`, '-f', `body=${body}`])
}

function main() {
  const number = process.env.PR_NUMBER
  const sha = process.env.GITHUB_SHA
  const dest = process.env.SCREENSHOTS_DEST
  if (!number || !sha || !dest) {
    console.log('publish-pd-ios-screenshots: missing PR_NUMBER/GITHUB_SHA/SCREENSHOTS_DEST; skipping.')
    return
  }
  const repo = repoParts()
  if (!repo) {
    console.log('publish-pd-ios-screenshots: GITHUB_REPOSITORY unset; skipping.')
    return
  }
  const body = buildScreenshotComment({ owner: repo.owner, repo: repo.repo, sha, dest })
  upsertStickyComment(repo.owner, repo.repo, number, body)
  console.log(`publish-pd-ios-screenshots: comment upserted on PR #${number}`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
