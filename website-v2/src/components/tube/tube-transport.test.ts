import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TUBE_KIND,
  isTubeSimulated,
  resolveTubeBackend,
  tubePoll,
  tubePublish,
} from './tube-transport'

const pub = (channel: string, sender: string, body: string, daemonUrl?: string) =>
  tubePublish(channel, sender, { v: 1, kind: TUBE_KIND, body }, daemonUrl)

describe('resolveTubeBackend', () => {
  it('simulates on a public page with no daemon signal', () => {
    const location = { origin: 'https://portdaddy.dev', pathname: '/pd-tube', search: '' }
    expect(resolveTubeBackend(undefined, location)).toEqual({ mode: 'sim' })
    expect(isTubeSimulated(undefined, location)).toBe(true)
  })

  it('goes live on same-origin embedded pages with relative requests', () => {
    const location = { origin: 'http://127.0.0.1:4321', pathname: '/fleet-ui/dashboard', search: '' }
    expect(resolveTubeBackend(undefined, location)).toEqual({
      mode: 'live',
      baseUrl: '',
    })
  })

  it('goes live when given an explicit url (trailing slash trimmed)', () => {
    expect(resolveTubeBackend('http://127.0.0.1:9000/')).toEqual({
      mode: 'live',
      baseUrl: 'http://127.0.0.1:9000',
    })
  })

  it('goes live on a ?daemon= override', () => {
    const location = { origin: 'https://portdaddy.dev', pathname: '/', search: '?daemon=http://127.0.0.1:9000' }
    expect(resolveTubeBackend(undefined, location)).toEqual({
      mode: 'live',
      baseUrl: 'http://127.0.0.1:9000',
    })
  })

  it('lets an explicit selected daemon override an embedded page origin', () => {
    const location = { origin: 'http://127.0.0.1:4312', pathname: '/fleet-ui/', search: '' }
    expect(resolveTubeBackend('http://127.0.0.1:9000', location)).toEqual({
      mode: 'live',
      baseUrl: 'http://127.0.0.1:9000',
    })
  })

  it('ignores an invalid ?daemon= value and simulates', () => {
    const location = { origin: 'https://portdaddy.dev', pathname: '/', search: '?daemon=notaurl' }
    expect(resolveTubeBackend(undefined, location)).toEqual({ mode: 'sim' })
  })
})

describe('simulated transport (no window → sim)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Any fetch in sim mode is a bug; spy so we can assert it is never called.
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fans a standup broadcast out to alice/bob/carol with no network call', async () => {
    const id = await pub('standup:demo', 'standup-bot', 'Standup in 5.')
    expect(fetch).not.toHaveBeenCalled()

    // Replies are scheduled, not instant: nothing yet.
    expect(await tubePoll('standup:demo', id)).toEqual([])

    await vi.advanceTimersByTimeAsync(4000)
    const replies = await tubePoll('standup:demo', id)
    expect(replies.map((m) => m.sender).sort()).toEqual(['alice', 'bob', 'carol'])
    expect(replies.every((m) => m.payload.kind === TUBE_KIND && m.payload.inReplyTo === id)).toBe(
      true,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns a mechanic diagnosis + diff for tests:failed', async () => {
    const id = await pub('tests:failed', 'test-runner', 'FAIL cart/totals.test.ts')
    await vi.advanceTimersByTimeAsync(2500)
    const [reply] = await tubePoll('tests:failed', id)
    expect(reply.sender).toBe('mechanic')
    expect(reply.payload.inReplyTo).toBe(id)
    expect(reply.payload.body).toContain('--- a/src/cart/totals.ts')
  })

  it('builds an agent↔agent incident thread with provenance + a root cause', async () => {
    const id = await pub('incident:checkout', 'incident-bot', 'INCIDENT: checkout p99 8x')
    await vi.advanceTimersByTimeAsync(9000)
    const msgs = await tubePoll('incident:checkout', id)

    // Three distinct agents speak.
    expect(new Set(msgs.map((m) => m.sender))).toEqual(new Set(['alpha', 'bravo', 'charlie']))

    // At least one reply cites another agent message (not the seed) → arrow.
    const ids = new Set(msgs.map((m) => m.id))
    expect(msgs.some((m) => m.payload.inReplyTo != null && ids.has(m.payload.inReplyTo))).toBe(true)

    // Exactly one ROOT CAUSE declaration lands.
    expect(msgs.filter((m) => /^\s*root[\s-]?cause\b/i.test(m.payload.body ?? '')).length).toBe(1)
  })
})

describe('live transport (explicit daemon url → fetch)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the daemon on publish', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 42 }) })
    vi.stubGlobal('fetch', fetchMock)

    const id = await pub('ui:clicks', 'web', 'hi', 'http://127.0.0.1:9000')
    expect(id).toBe(42)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:9000/msg/ui%3Aclicks')
    expect(init.method).toBe('POST')
  })

  it('GETs ?after= on poll', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 5, payload: {} }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const msgs = await tubePoll('ui:clicks', 3, { daemonUrl: 'http://127.0.0.1:9000' })
    expect(msgs).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:9000/msg/ui%3Aclicks?after=3')
  })
})
