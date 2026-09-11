/**
 * Post to GitHub as a specific fleet ship.
 *
 * The App posts as `<app-slug>[bot]` — a single GitHub identity. Per-ship
 * differentiation is rendered into the comment body: a `**[pd-<ship>]**`
 * header tag, an optional unicode mark, a one-line role description, and a
 * signed footer. If GitHub ever exposes per-message identities for Apps,
 * the rendering layer changes; the call sites stay the same.
 *
 * The roster of ships is per-repo, not hardcoded here. Each installed repo
 * supplies its own ship definitions via `pd-fleet.yml` (or any equivalent
 * caller-side config). `postAs` accepts a `ShipMeta` value the caller has
 * resolved; it does not consult a closed enum.
 *
 * Examples of valid ship handles, by project:
 *
 *   port-daddy        pd-reviewer, pd-redteam, pd-qa, pd-test-author, ...
 *   expungement-guide pd-upl-checker, pd-citation-checker, pd-plain-language
 *   jury_rig           pd-skill-media, pd-mermaid-author, pd-skill-grammar
 *
 * The grammar contract is the only constant: `pd-<lower-kebab-case>` for the
 * handle, mark unicode-only (no emoji), role under ~80 chars.
 *
 * See `apps/github-app-fleet/docs/per-project-ships.md` for worked examples
 * and the YAML schema the App reads at runtime.
 */

import { getOctokitForInstallation } from './auth.js'

// ---------------------------------------------------------------------------
// Types

/**
 * A ship handle is a lower-kebab-case identifier without the `pd-` prefix
 * (the prefix is rendered on, not stored). Per-repo configuration supplies
 * the canonical list; runtime validation is light — anything matching the
 * grammar passes.
 */
export type ShipHandle = string

const SHIP_HANDLE_RE = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/

export function isValidShipHandle(handle: string): boolean {
  return SHIP_HANDLE_RE.test(handle)
}

export interface ShipMeta {
  /**
   * Bare ship handle (without `pd-` prefix). Lower-kebab-case. The handle
   * also serves as the `pd-ship:<handle>` issue label so callers can filter.
   */
  handle: ShipHandle
  /**
   * One-line role description rendered into the header. Keep it under ~80
   * characters; it sits next to the handle on a single line.
   */
  role: string
  /**
   * Optional unicode mark for visual differentiation. Geometric primitives
   * only — no emoji. The grammar (`docs/shipwright/SHIP-GRAMMAR.md`) lists
   * eight canonical primitives; any single character that is not an emoji
   * is acceptable.
   */
  mark?: string
}

/**
 * A small default registry, retained for convenience when callers wire the
 * port-daddy fleet without supplying their own meta. Per-repo configuration
 * SHOULD override these. Nothing in this module reads the registry by
 * default — callers pass `ShipMeta` directly.
 */
export const DEFAULT_PORT_DADDY_SHIPS: Record<string, ShipMeta> = {
  reviewer:      { handle: 'reviewer',      role: 'reads diffs like a careful colleague',                 mark: '◆' },
  redteam:       { handle: 'redteam',       role: 'assumes the worst; looks for sharp edges',             mark: '▲' },
  qa:            { handle: 'qa',            role: 'runs tests in its head; flags missing coverage',       mark: '●' },
  'test-author': { handle: 'test-author',   role: 'writes the test that was missing',                     mark: '✚' },
  tautology:     { handle: 'tautology',     role: 'flags vacuous assertions and circular logic',          mark: '◇' },
  unspider:      { handle: 'unspider',      role: 'finds dead code paths the spider can no longer reach', mark: '◐' },
  documentarian: { handle: 'documentarian', role: 'watches the drift between code and docs',              mark: '✦' },
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
 * Wrap a body in the ship's identity prefix and signed footer. Idempotent —
 * wrapping a body that already starts with the same `**[pd-<handle>]**`
 * prefix returns the body unchanged.
 */
export function frameBody(ship: ShipMeta, body: string): string {
  if (!isValidShipHandle(ship.handle)) {
    throw new Error(
      `Invalid ship handle: ${JSON.stringify(ship.handle)}. ` +
        `Expected lower-kebab-case (e.g. 'reviewer', 'upl-checker').`,
    )
  }

  const fullHandle = `pd-${ship.handle}`
  const headerPrefix = `**[${fullHandle}]**`
  if (body.startsWith(headerPrefix)) return body

  const mark = ship.mark ? ` ${ship.mark}` : ''
  const header = `${headerPrefix}${mark}  _${ship.role}_`
  const footer =
    `\n\n<sub>posted by the Port Daddy fleet — \`${fullHandle}\` ` +
    `· [silence this ship](https://portdaddy.dev/docs/fleet/silence)</sub>`

  return `${header}\n\n${body.trim()}${footer}`
}

// ---------------------------------------------------------------------------
// Posters

export interface PostResult {
  ship: ShipHandle
  op: Operation['kind']
  /** URL of the GitHub resource that was created, when applicable. */
  url?: string
  /** Numeric id of the created resource (comment id, issue number, PR number). */
  id?: number
}

/**
 * Post anything as the named ship. The caller supplies the `ShipMeta`
 * resolved from the installed repo's `pd-fleet.yml` (or equivalent
 * caller-side config) — this function does not consult a global registry.
 *
 *   const ship = resolveShip('reviewer')  // caller-side
 *   await postAs(ship, {
 *     kind: 'pr-comment',
 *     payload: { owner: 'curiositech', repo: 'port-daddy', pull_number: 42, body: '...' },
 *   })
 */
export async function postAs(
  ship: ShipMeta,
  op: Operation,
): Promise<PostResult> {
  if (!isValidShipHandle(ship.handle)) {
    throw new Error(
      `Invalid ship handle: ${JSON.stringify(ship.handle)}. ` +
        `Expected lower-kebab-case.`,
    )
  }
  const octokit = await getOctokitForInstallation(op.payload.installationId)
  const fullHandle = `pd-${ship.handle}`

  switch (op.kind) {
    case 'pr-comment': {
      const { owner, repo, pull_number, body } = op.payload
      const r = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: frameBody(ship, body),
      })
      return { ship: ship.handle, op: op.kind, url: r.data.html_url, id: r.data.id }
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
      return { ship: ship.handle, op: op.kind, url: r.data.html_url, id: r.data.id }
    }

    case 'issue': {
      const { owner, repo, title, body, labels } = op.payload
      const r = await octokit.issues.create({
        owner,
        repo,
        title: `[${fullHandle}] ${title}`,
        body: frameBody(ship, body),
        labels: ['port-daddy-fleet', `pd-ship:${ship.handle}`, ...(labels ?? [])],
      })
      return { ship: ship.handle, op: op.kind, url: r.data.html_url, id: r.data.number }
    }

    case 'issue-comment': {
      const { owner, repo, issue_number, body } = op.payload
      const r = await octokit.issues.createComment({
        owner,
        repo,
        issue_number,
        body: frameBody(ship, body),
      })
      return { ship: ship.handle, op: op.kind, url: r.data.html_url, id: r.data.id }
    }

    case 'draft-pr': {
      const { owner, repo, title, body, head, base } = op.payload
      const r = await octokit.pulls.create({
        owner,
        repo,
        title: `[${fullHandle}] ${title}`,
        body: frameBody(ship, body),
        head,
        base,
        draft: true,
      })
      return { ship: ship.handle, op: op.kind, url: r.data.html_url, id: r.data.number }
    }
  }
}
