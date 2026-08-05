import { describe, expect, test } from '@jest/globals'
import {
  DOCUMENTARIAN_CONTEXT,
  GUIDE_REVIEW_CONTEXT,
  formatGuideReviewComment,
  guideReviewDigest,
  resolveTagToCommit,
  selectGuideReviewEvidence,
  validateGuideReviewEvidence,
  validateSourceReviewStatuses,
} from '../../scripts/release-review-gate.mjs'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const evidence = {
  schemaVersion: 1,
  sha: SHA,
  reviews: [
    { role: 'steelman', agentId: 'agent-a', transcriptId: 'tx-a', verdict: 'SHIP', completedAt: '2026-08-04T20:00:00Z' },
    { role: 'countercase', agentId: 'agent-b', transcriptId: 'tx-b', verdict: 'SHIP', completedAt: '2026-08-04T20:01:00Z' },
    { role: 'adversarial', agentId: 'agent-c', transcriptId: 'tx-c', verdict: 'SHIP', completedAt: '2026-08-04T20:02:00Z' },
  ],
}

describe('release source-review evidence', () => {
  test('accepts exactly three independent SHIP reviews bound to the candidate', () => {
    const normalized = validateGuideReviewEvidence(evidence, SHA)
    expect(normalized.reviews.map((review) => review.role)).toEqual(['adversarial', 'countercase', 'steelman'])
  })

  test('rejects SHA drift, duplicate actors, and unresolved findings', () => {
    expect(() => validateGuideReviewEvidence({ ...evidence, sha: 'f'.repeat(40) }, SHA)).toThrow(/does not match/)
    const duplicate = structuredClone(evidence)
    duplicate.reviews[1].agentId = duplicate.reviews[0].agentId
    expect(() => validateGuideReviewEvidence(duplicate, SHA)).toThrow(/distinct agent ids/)
    const blocked = structuredClone(evidence)
    blocked.reviews[2].verdict = 'SHIP-AFTER-FIX'
    expect(() => validateGuideReviewEvidence(blocked, SHA)).toThrow(/must end in SHIP/)
  })

  test('requires a trusted external commit comment and evidence-bound statuses', () => {
    const selected = selectGuideReviewEvidence([
      { author_association: 'NONE', body: formatGuideReviewComment(evidence) },
      { author_association: 'OWNER', body: formatGuideReviewComment(evidence), html_url: 'https://example.test/comment' },
    ], SHA)
    const digest = guideReviewDigest(selected.evidence)
    expect(() => validateSourceReviewStatuses([], SHA, selected.evidence)).toThrow(DOCUMENTARIAN_CONTEXT)
    const statuses = [
      { context: DOCUMENTARIAN_CONTEXT, state: 'success', description: `Documentarian CLEAN ${SHA}`, created_at: '2026-08-04T20:03:00Z' },
      { context: GUIDE_REVIEW_CONTEXT, state: 'success', description: `Guide review ${SHA} ${digest.slice(0, 12)}`, created_at: '2026-08-04T20:04:00Z' },
    ]
    expect(validateSourceReviewStatuses(statuses, SHA, selected.evidence).guideReview.context).toBe(GUIDE_REVIEW_CONTEXT)
  })

  test('resolves annotated tags to their final commit', async () => {
    const calls = []
    const request = async (path) => {
      calls.push(path)
      if (path.startsWith('/git/ref/')) return { object: { type: 'tag', sha: 'a'.repeat(40) } }
      return { object: { type: 'commit', sha: SHA } }
    }
    await expect(resolveTagToCommit('v3.28.0', request)).resolves.toBe(SHA)
    expect(calls).toEqual(['/git/ref/tags/v3.28.0', `/git/tags/${'a'.repeat(40)}`])
  })
})
