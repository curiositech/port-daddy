import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DaemonClientError,
  deleteOrchestratorRule,
  describeDaemonError,
  fetchOrchestratorRules,
  publishMessage,
} from '@/lib/daemon-client'

const fetchMock = vi.fn()

describe('daemon client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('normalizes network failures into daemon client errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(fetchOrchestratorRules()).rejects.toMatchObject({
      name: 'DaemonClientError',
      kind: 'network',
    })
  })

  it('describes daemon errors for ui consumers', () => {
    const error = new DaemonClientError({
      kind: 'invalid-response',
      message: 'bad payload',
      body: null,
    })

    expect(describeDaemonError(error)).toEqual({
      kind: 'invalid-response',
      message: 'Daemon returned an unexpected payload',
    })
  })

  it('fetches orchestrator rules as a typed list', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { id: 1, name: 'demo', channelPattern: 'build:*', action: 'spawn', enabled: true, payload: {} },
    ]), { status: 200 }))

    await expect(fetchOrchestratorRules()).resolves.toHaveLength(1)
  })

  it('publishes messages and deletes rules through route-specific helpers', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, deleted: true, id: 7 }), { status: 200 }))

    await publishMessage('fleet:test', { payload: { ok: true }, sender: 'TEST' })
    await deleteOrchestratorRule(7)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:9876/msg/fleet%3Atest',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:9876/orchestrator/rules/7',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
