/**
 * Regression tests for scripts/check-adversarial-review.mjs. The gate exists
 * because PRs can look "reviewed" through Copilot / Claude statuses while still
 * missing Port Daddy's actual adversarial-review verdict contract.
 */
import { describe, expect, test } from '@jest/globals'
import {
  evaluateAdversarialReview,
  normalizeReviewItems,
  parseReviewArtifact,
} from '../../scripts/check-adversarial-review.mjs'

const HEAD = '0123456789abcdef0123456789abcdef01234567'
const NEXT_HEAD = 'fedcba9876543210fedcba9876543210fedcba98'

function issueComment({ body, author = 'reviewer-agent', at = '2026-06-16T12:00:00Z' }) {
  return {
    body,
    user: { login: author },
    created_at: at,
    updated_at: at,
    html_url: `https://github.test/comment/${author}`,
  }
}

function evaluate(comments, options = {}) {
  return evaluateAdversarialReview({
    headSha: options.headSha ?? HEAD,
    prAuthor: options.prAuthor ?? 'feature-author',
    items: normalizeReviewItems(comments, []),
    approvedReviewers: options.approvedReviewers,
  })
}

describe('adversarial review artifact parsing', () => {
  test('extracts reviewer, head SHA, and verdict from the required artifact', () => {
    expect(parseReviewArtifact(`
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP
    `)).toEqual({
      reviewerIdentity: 'feature-dev:code-reviewer',
      headSha: HEAD,
      verdict: 'SHIP',
    })
  })

  test('ignores generic verdict words without the adversarial review marker', () => {
    expect(parseReviewArtifact(`SHIP\nLooks good to me.\nHead-SHA: ${HEAD}`)).toBeNull()
  })
})

describe('adversarial review gate evaluation', () => {
  test('passes a current-head SHIP artifact from a non-author reviewer', () => {
    const result = evaluate([
      issueComment({
        body: `
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP
`,
      }),
    ])

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('accepted')
  })

  test('rejects a self-authored artifact even when the verdict says SHIP', () => {
    const result = evaluate([
      issueComment({
        author: 'feature-author',
        body: `
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP
`,
      }),
    ])

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('none came from an accepted reviewer')
    expect(result.artifacts[0].rejection).toContain('PR author')
  })

  test('rejects stale artifacts tied to an old head SHA', () => {
    const result = evaluate([
      issueComment({
        body: `
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP
`,
      }),
    ], { headSha: NEXT_HEAD })

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('not for the current head SHA')
  })

  test('rejects SHIP-AFTER-FIX until a later current-head SHIP artifact exists', () => {
    const afterFix = issueComment({
      at: '2026-06-16T12:00:00Z',
      body: `
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP-AFTER-FIX
`,
    })

    expect(evaluate([afterFix]).ok).toBe(false)

    const ship = issueComment({
      at: '2026-06-16T12:05:00Z',
      body: `
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP
`,
    })

    const result = evaluate([afterFix, ship])
    expect(result.ok).toBe(true)
    expect(result.latest.verdict).toBe('SHIP')
  })

  test('uses the latest accepted current-head verdict, so a later DO-NOT-SHIP fails', () => {
    const result = evaluate([
      issueComment({
        at: '2026-06-16T12:00:00Z',
        body: `
Adversarial Review
Reviewer: feature-dev:code-reviewer
Head-SHA: ${HEAD}
Verdict: SHIP
`,
      }),
      issueComment({
        at: '2026-06-16T12:05:00Z',
        author: 'security-reviewer',
        body: `
Adversarial Review
Reviewer: auditor
Head-SHA: ${HEAD}
Verdict: DO-NOT-SHIP
`,
      }),
    ])

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('DO-NOT-SHIP')
  })

  test('honors an explicit reviewer allow-list', () => {
    const result = evaluate([
      issueComment({
        author: 'drive-by-commenter',
        body: `
Adversarial Review
Reviewer: drive-by
Head-SHA: ${HEAD}
Verdict: SHIP
`,
      }),
    ], { approvedReviewers: 'trusted-reviewer' })

    expect(result.ok).toBe(false)
    expect(result.artifacts[0].rejection).toContain('ADVERSARIAL_REVIEW_APPROVERS')
  })
})
