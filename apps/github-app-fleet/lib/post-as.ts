/**
 * Post to GitHub as a specific fleet ship.
 *
 * GitHub Apps post as a single `<app-slug>[bot]` user. We get per-ship
 * differentiation by prefixing every body with a `**[pd-${ship}]**` tag and
 * appending a small signed footer. This is the fallback identity scheme — if
 * GitHub ever exposes per-message bot identity to Apps, we swap the rendering
 * layer and the call sites don't change.
 *
 * The seven ships:
 *
 *   reviewer       — reads a diff like a careful colleague; surfaces risk
 *   redteam        — assumes the worst; looks for security, abuse, sharp edges
 *   qa             — runs tests in its head; flags missing coverage
 *   test-author    — writes the test that was missing (proposes a patch)
 *   tautology      — flags vacuous assertions ("expect(true).toBe(true)")
 *   unspider       — finds dead code paths the spider doesn't reach anymore
 *   documentarian  — flags drift between code and docs, proposes diffs
 */

import { getOctokitForInstallation } from './auth.js'

// ---------------------------------------------------------------------------
// Types

export type ShipIdentity =
  | 'reviewer'
  | 'redteam'
  | 'qa'
  | 'test-author'
  | 'tautology'
  | 'unspider'
  | 'documentarian'

export interface ShipMeta {
  /** Short human name used in the body prefix. */
  handle: string
  /** One-line role description for the signed footer. */
  role: string
  /** Emoji-free unicode mark for visual differentiation in the body prefix. */
  mark: string
}

export const SHIPS: Record<ShipIdentity, ShipMeta> = {
  reviewer:       { handle: 'pd-reviewer',       role: 'reads diffs like a careful colleague',                 mark: '◆' },
  redteam:        { handle: 'pd-redteam',        role: 'assumes the worst; looks for sharp edges',             mark: '▲' },
  qa:             { handle: 'pd-qa',             role: 'runs tests in its head; flags missing coverage',       mark: '●' },
  'test-author':  { handle: 'pd-test-author',    role: 'writes the test that was missing',                     mark: '✚' },
  tautology:      { handle: 'pd-tautology',      role: 'flags vacuous assertions and circular logic',          mark: '◇' },
  unspider:       { handle: 'pd-unspider',       role: 'finds dead code paths the spider can no longer reach', mark: '◐' },
  documentarian:  { handle: 'pd-documentarian',  role: 'watches the drift between code and docs',              mark: '✦' },
}

export interface BaseTarget {
  owner: string
  repo: string
  /** Optional installation override. If omitted, uses env default. */
  installationId?: number
}

export interface PRCommentPayload extends BaseTarget {
  /** Pull request number (issues API — works for PR conversation comments). */
  pull_number: number
  /** Markdown body — will be prefixed with the ship's signature block. */
  body: string
}

export interface PRReviewCommentPayload extends BaseTarget {
  pull_number: number
  /** Commit SHA the review is anchored at. */
  commit_id: string
  /** Body for this specific line/range comment. */
  body: string
  /** Path to the file being commented on. */
  path: string
  /** Line in the diff to anchor the comment at (right side). */
  line: number
  /** Optional start line for a multi-line comment. */
  start_line?: number
  side?: 'LEFT' | 'RIGHT'
}

export interface IssuePayload extends BaseTarget {
  title: string
  body: string
  labels?: string[]
}

export interface IssueCommentPayload extends BaseTarget {
  issue_number: number
  body: string
}

export interface DraftPRPayload extends BaseTarget {
  title: string
  /** Body — will be prefixed with the ship's signature block. */
  body: string
  /** Branch to merge from (already pushed). */
  head: string
  /** Branch to merge into. */
  base: string
}

export type Operation =
  | { kind: 'pr-comment';        payload: PRCommentPayload }
  | { kind: 'pr-review-comment'; payload: PRReviewCommentPayload }
  | { kind: 'issue';             payload: IssuePayload }
  | { kind: 'issue-comment';     payload: IssueCommentPayload }
  | { kind: 'draft-pr';          payload: DraftPRPayload }

// ---------------------------------------------------------------------------
// Body framing

/**
 * Wrap a body in the ship's identity prefix + signed footer.
 * Idempotent — wrapping twice produces a single header.
 */
export function frameBody(ship: ShipIdentity, body: string): string {
  const meta = SHIPS[ship]
  if (!meta) throw new Error(`Unknown fleet ship: ${ship}`)

  const headerPrefix = `**[${meta.handle}]**`
  if (body.startsWith(headerPrefix)) return body

  const header = `${headerPrefix} ${meta.mark}  _${meta.role}_`
  const footer =
    `\n\n<sub>posted by the Port Daddy fleet — \`${meta.handle}\` ` +
    `· [silence this ship](https://portdaddy.dev/docs/fleet/silence)</sub>`

  return `${header}\n\n${body.trim()}${footer}`
}

// ---------------------------------------------------------------------------
// Posters

export interface PostResult {
  ship: ShipIdentity
  op: Operation['kind']
  /** URL of the GitHub resource that was created, when applicable. */
  url?: string
  /** Numeric id of the created resource (comment id, issue number, PR number). */
  id?: number
}

/**
 * Post anything as the named ship. Single entry point so call sites don't have
 * to thread the Octokit setup themselves.
 *
 *   await postAs('reviewer', {
 *     kind: 'pr-comment',
 *     payload: { owner: 'curiositech', repo: 'port-daddy', pull_number: 42, body: '...' }
 *   })
 */
export async function postAs(
  ship: ShipIdentity,
  op: Operation,
): Promise<PostResult> {
  if (!(ship in SHIPS)) {
    throw new Error(`Unknown fleet ship: ${ship}`)
  }
  const octokit = await getOctokitForInstallation(op.payload.installationId)

  switch (op.kind) {
    case 'pr-comment': {
      const { owner, repo, pull_number, body } = op.payload
      const r = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: frameBody(ship, body),
      })
      return { ship, op: op.kind, url: r.data.html_url, id: r.data.id }
    }

    case 'pr-review-comment': {
      const { owner, repo, pull_number, body, commit_id, path, line, start_line, side } = op.payload
      const r = await octokit.pulls.createReviewComment({
        owner,
        repo,
        pull_number,
        body: frameBody(ship, body),
        commit_id,
        path,
        line,
        start_line,
        side: side ?? 'RIGHT',
      })
      return { ship, op: op.kind, url: r.data.html_url, id: r.data.id }
    }

    case 'issue': {
      const { owner, repo, title, body, labels } = op.payload
      const r = await octokit.issues.create({
        owner,
        repo,
        title: `[${SHIPS[ship].handle}] ${title}`,
        body: frameBody(ship, body),
        labels: ['port-daddy-fleet', `pd-ship:${ship}`, ...(labels ?? [])],
      })
      return { ship, op: op.kind, url: r.data.html_url, id: r.data.number }
    }

    case 'issue-comment': {
      const { owner, repo, issue_number, body } = op.payload
      const r = await octokit.issues.createComment({
        owner,
        repo,
        issue_number,
        body: frameBody(ship, body),
      })
      return { ship, op: op.kind, url: r.data.html_url, id: r.data.id }
    }

    case 'draft-pr': {
      const { owner, repo, title, body, head, base } = op.payload
      const r = await octokit.pulls.create({
        owner,
        repo,
        title: `[${SHIPS[ship].handle}] ${title}`,
        body: frameBody(ship, body),
        head,
        base,
        draft: true,
      })
      return { ship, op: op.kind, url: r.data.html_url, id: r.data.number }
    }
  }
}
