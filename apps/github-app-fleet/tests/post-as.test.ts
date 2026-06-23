/**
 * Unit tests for lib/post-as.ts — the ship-identity rendering + dispatch layer.
 *
 * Everything here is pure/deterministic except `postAs`, whose only side effect
 * is an Octokit REST call; we mock `getOctokitForInstallation` so no network is
 * touched. The contract under test:
 *
 *   - frameBody is IDEMPOTENT (re-framing an already-framed body is a no-op)
 *   - the ship handle grammar `^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$` is enforced
 *   - postAs dispatches to the right REST method per operation kind and frames
 *     the body before sending
 */

import { jest } from '@jest/globals'

// Mock the auth layer BEFORE importing post-as so the mock is wired at import.
const mockOctokit = {
  issues: {
    createComment: jest.fn(),
    create: jest.fn(),
  },
  pulls: {
    createReviewComment: jest.fn(),
    create: jest.fn(),
  },
}
const getOctokitForInstallation = jest.fn(async () => mockOctokit)

jest.unstable_mockModule('../lib/auth.js', () => ({
  getOctokitForInstallation,
}))

// Import AFTER the mock is registered (ESM mocking requires dynamic import).
const { frameBody, isValidShipHandle, postAs, DEFAULT_PORT_DADDY_SHIPS } =
  await import('../lib/post-as.js')

type ShipMeta = import('../lib/post-as.js').ShipMeta

const REVIEWER: ShipMeta = {
  handle: 'reviewer',
  role: 'reads diffs like a careful colleague',
  mark: '◆',
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default resolved values for the REST calls so postAs can read .data.
  mockOctokit.issues.createComment.mockResolvedValue({
    data: { html_url: 'https://github.com/x/y/issues/1#c', id: 111 },
  } as never)
  mockOctokit.issues.create.mockResolvedValue({
    data: { html_url: 'https://github.com/x/y/issues/2', number: 2 },
  } as never)
  mockOctokit.pulls.createReviewComment.mockResolvedValue({
    data: { html_url: 'https://github.com/x/y/pull/3#rc', id: 333 },
  } as never)
  mockOctokit.pulls.create.mockResolvedValue({
    data: { html_url: 'https://github.com/x/y/pull/4', number: 4 },
  } as never)
})

// ---------------------------------------------------------------------------
// isValidShipHandle — the lower-kebab grammar

describe('isValidShipHandle', () => {
  it.each([
    'reviewer',
    'redteam',
    'test-author',
    'upl-checker',
    'a',
    'a1',
    'a-b-c',
    'pd2-thing', // digits allowed after first char
  ])('accepts valid handle %p', (h) => {
    expect(isValidShipHandle(h)).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['Reviewer', 'uppercase'],
    ['REDTEAM', 'all caps'],
    ['-leading', 'leading dash'],
    ['trailing-', 'trailing dash'],
    ['has space', 'space'],
    ['has_underscore', 'underscore'],
    ['café', 'unicode'],
    ['1leading', 'leading digit'],
    ['has.dot', 'dot'],
    ['pd-', 'bare prefix with trailing dash'],
  ])('rejects %p (%s)', (h) => {
    expect(isValidShipHandle(h)).toBe(false)
  })

  it('every DEFAULT_PORT_DADDY_SHIPS handle is itself valid', () => {
    for (const meta of Object.values(DEFAULT_PORT_DADDY_SHIPS)) {
      expect(isValidShipHandle(meta.handle)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// frameBody — wrapping + idempotency

describe('frameBody', () => {
  it('wraps a body with the `**[pd-<handle>]**` header prefix', () => {
    const out = frameBody(REVIEWER, 'the diff looks fine')
    expect(out.startsWith('**[pd-reviewer]**')).toBe(true)
    expect(out).toContain('the diff looks fine')
  })

  it('renders the mark and role into the header when present', () => {
    const out = frameBody(REVIEWER, 'body')
    expect(out).toContain('◆')
    expect(out).toContain('_reads diffs like a careful colleague_')
  })

  it('omits the mark when none is supplied', () => {
    const noMark: ShipMeta = { handle: 'qa', role: 'runs tests in its head' }
    const out = frameBody(noMark, 'body')
    expect(out.startsWith('**[pd-qa]**  _runs tests in its head_')).toBe(true)
  })

  it('renders the silence-this-ship footer with the full handle', () => {
    const out = frameBody(REVIEWER, 'body')
    expect(out).toContain('posted by the Port Daddy fleet')
    expect(out).toContain('`pd-reviewer`')
    expect(out).toContain('portdaddy.dev/docs/fleet/silence')
  })

  it('trims the inner body before embedding it', () => {
    const out = frameBody(REVIEWER, '\n\n  spaced  \n\n')
    expect(out).toContain('\n\nspaced\n\n')
    expect(out).not.toContain('  spaced  ')
  })

  // ---- The load-bearing property: IDEMPOTENCY ----

  it('is idempotent: framing an already-framed body returns it unchanged', () => {
    const once = frameBody(REVIEWER, 'hello')
    const twice = frameBody(REVIEWER, once)
    expect(twice).toBe(once)
  })

  it('is idempotent across many re-frames (round-trip stability)', () => {
    let body = frameBody(REVIEWER, 'stable content')
    for (let i = 0; i < 5; i++) {
      body = frameBody(REVIEWER, body)
    }
    expect(body).toBe(frameBody(REVIEWER, 'stable content'))
    // and the header appears exactly once, never stacked
    const headerCount = body.split('**[pd-reviewer]**').length - 1
    expect(headerCount).toBe(1)
  })

  it('does NOT treat a DIFFERENT ship-framed body as already-framed', () => {
    const reviewerBody = frameBody(REVIEWER, 'hello')
    const redteam: ShipMeta = { handle: 'redteam', role: 'assumes the worst', mark: '▲' }
    const reframed = frameBody(redteam, reviewerBody)
    // redteam's header is prepended; reviewer header is now nested in the body
    expect(reframed.startsWith('**[pd-redteam]**')).toBe(true)
    expect(reframed).toContain('**[pd-reviewer]**')
  })

  it('throws on an invalid ship handle', () => {
    const bad: ShipMeta = { handle: 'Bad Handle', role: 'x' }
    expect(() => frameBody(bad, 'body')).toThrow(/Invalid ship handle/)
  })
})

// ---------------------------------------------------------------------------
// postAs — operation dispatch + framing-before-send (network mocked)

describe('postAs dispatch', () => {
  it('pr-comment → issues.createComment with a framed body', async () => {
    const res = await postAs(REVIEWER, {
      kind: 'pr-comment',
      payload: { owner: 'o', repo: 'r', pull_number: 42, body: 'looks good' },
    })
    expect(mockOctokit.issues.createComment).toHaveBeenCalledTimes(1)
    const arg = mockOctokit.issues.createComment.mock.calls[0][0] as {
      owner: string
      repo: string
      issue_number: number
      body: string
    }
    expect(arg.owner).toBe('o')
    expect(arg.repo).toBe('r')
    expect(arg.issue_number).toBe(42) // pull_number routed to issues API
    expect(arg.body.startsWith('**[pd-reviewer]**')).toBe(true)
    expect(arg.body).toContain('looks good')
    expect(res).toEqual({ ship: 'reviewer', op: 'pr-comment', url: expect.any(String), id: 111 })
  })

  it('issue-comment → issues.createComment with a framed body', async () => {
    await postAs(REVIEWER, {
      kind: 'issue-comment',
      payload: { owner: 'o', repo: 'r', issue_number: 9, body: 'a note' },
    })
    const arg = mockOctokit.issues.createComment.mock.calls[0][0] as { issue_number: number; body: string }
    expect(arg.issue_number).toBe(9)
    expect(arg.body.startsWith('**[pd-reviewer]**')).toBe(true)
  })

  it('issue → issues.create, prefixing the title and labelling the ship', async () => {
    const res = await postAs(REVIEWER, {
      kind: 'issue',
      payload: { owner: 'o', repo: 'r', title: 'Bug found', body: 'details', labels: ['extra'] },
    })
    expect(mockOctokit.issues.create).toHaveBeenCalledTimes(1)
    const arg = mockOctokit.issues.create.mock.calls[0][0] as {
      title: string
      body: string
      labels: string[]
    }
    expect(arg.title).toBe('[pd-reviewer] Bug found')
    expect(arg.body.startsWith('**[pd-reviewer]**')).toBe(true)
    expect(arg.labels).toEqual(['port-daddy-fleet', 'pd-ship:reviewer', 'extra'])
    expect(res.id).toBe(2) // returns issue number, not comment id
  })

  it('pr-review-comment → pulls.createReviewComment, defaulting side to RIGHT', async () => {
    await postAs(REVIEWER, {
      kind: 'pr-review-comment',
      payload: {
        owner: 'o',
        repo: 'r',
        pull_number: 7,
        commit_id: 'deadbeef',
        path: 'lib/x.ts',
        line: 12,
        body: 'this line',
      },
    })
    const arg = mockOctokit.pulls.createReviewComment.mock.calls[0][0] as {
      pull_number: number
      side: string
      body: string
    }
    expect(arg.pull_number).toBe(7)
    expect(arg.side).toBe('RIGHT')
    expect(arg.body.startsWith('**[pd-reviewer]**')).toBe(true)
  })

  it('pr-review-comment honors an explicit side', async () => {
    await postAs(REVIEWER, {
      kind: 'pr-review-comment',
      payload: {
        owner: 'o', repo: 'r', pull_number: 7, commit_id: 'c', path: 'a', line: 1,
        body: 'b', side: 'LEFT',
      },
    })
    const arg = mockOctokit.pulls.createReviewComment.mock.calls[0][0] as { side: string }
    expect(arg.side).toBe('LEFT')
  })

  it('draft-pr → pulls.create with draft:true and a prefixed title', async () => {
    const res = await postAs(REVIEWER, {
      kind: 'draft-pr',
      payload: { owner: 'o', repo: 'r', title: 'Fix', body: 'desc', head: 'feat', base: 'main' },
    })
    const arg = mockOctokit.pulls.create.mock.calls[0][0] as {
      title: string
      draft: boolean
      head: string
      base: string
      body: string
    }
    expect(arg.title).toBe('[pd-reviewer] Fix')
    expect(arg.draft).toBe(true)
    expect(arg.head).toBe('feat')
    expect(arg.base).toBe('main')
    expect(arg.body.startsWith('**[pd-reviewer]**')).toBe(true)
    expect(res.id).toBe(4)
  })

  it('threads the installationId through to getOctokitForInstallation', async () => {
    await postAs(REVIEWER, {
      kind: 'pr-comment',
      payload: { owner: 'o', repo: 'r', pull_number: 1, body: 'b', installationId: 9999 },
    })
    expect(getOctokitForInstallation).toHaveBeenCalledWith(9999)
  })

  it('rejects an invalid ship handle before any network call', async () => {
    const bad: ShipMeta = { handle: 'NOPE', role: 'x' }
    await expect(
      postAs(bad, { kind: 'pr-comment', payload: { owner: 'o', repo: 'r', pull_number: 1, body: 'b' } }),
    ).rejects.toThrow(/Invalid ship handle/)
    expect(getOctokitForInstallation).not.toHaveBeenCalled()
  })
})
