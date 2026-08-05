import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DaemonClientError,
  deleteOrchestratorRule,
  describeDaemonError,
  fetchDashboardStats,
  fetchOrchestratorRules,
  publishMessage,
} from '@/lib/daemon-client'

const fetchMock = vi.fn()

describe('daemon client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubEnv('VITE_PORT_DADDY_URL', 'http://127.0.0.1:9000')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('assembles dashboard stats from live daemon routes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'ok',
        version: '3.8.3',
        pid: 1,
        uptimeSeconds: 10,
        uptimeHuman: '10s',
        metrics: { activePorts: 6 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        running: true,
        fleets: [
          {
            project: 'demo',
            projectDir: '/tmp/demo',
            running: true,
            watchers: 0,
            channels: 0,
            startedAt: 1,
            agents: [
              { name: 'qa', type: 'scheduled', status: 'running', running: true, paused: false, uptime: 1, queueDepth: 0 },
              { name: 'docs', type: 'triggered', status: 'armed', running: false, paused: false, uptime: 1, queueDepth: 0 },
              { name: 'paused', type: 'manual', status: 'paused', running: false, paused: true, uptime: 1, queueDepth: 0 },
            ],
          },
        ],
        totalAgents: 3,
        totalWatchers: 0,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        harbors: [{ name: 'alpha', members: [] }, { name: 'beta', members: [] }],
        count: 2,
      }), { status: 200 }))

    await expect(fetchDashboardStats()).resolves.toEqual({
      activeAgents: 2,
      activeHarbors: 2,
      activePorts: 6,
      daemonVersion: '3.8.3',
      fleetRunning: true,
    })
  })

  it('normalizes network failures into daemon client errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(fetchDashboardStats()).rejects.toMatchObject({
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

  it('describes configuration errors for ui consumers', () => {
    const error = new DaemonClientError({
      kind: 'configuration',
      message: 'Select a daemon endpoint before opening this page.',
    })

    expect(describeDaemonError(error)).toEqual({
      kind: 'configuration',
      message: 'Select a daemon endpoint or open this page from the embedded dashboard',
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
      'http://127.0.0.1:9000/msg/fleet%3Atest',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:9000/orchestrator/rules/7',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
