import {
  DaemonEndpointConfigurationError,
  buildDaemonUrl,
  type ResolveDaemonBaseUrlOptions,
} from '@/lib/daemon-url'

export type DaemonErrorKind = 'network' | 'http' | 'invalid-response' | 'configuration'

export interface DaemonClientErrorOptions {
  kind: DaemonErrorKind
  message: string
  status?: number
  body?: unknown
  cause?: unknown
}

export class DaemonClientError extends Error {
  readonly kind: DaemonErrorKind
  readonly status?: number
  readonly body?: unknown

  constructor(options: DaemonClientErrorOptions) {
    super(options.message)
    this.name = 'DaemonClientError'
    this.kind = options.kind
    this.status = options.status
    this.body = options.body
    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export interface DaemonFetchJsonOptions extends RequestInit, ResolveDaemonBaseUrlOptions {}

export interface DashboardStats {
  activeAgents: number
  activeHarbors: number
  activePorts: number
  daemonVersion: string
  fleetRunning: boolean
}

export interface OrchestratorRule {
  id: number
  name: string
  channelPattern: string
  action: string
  enabled: boolean
  payload?: Record<string, unknown> | null
}

interface HealthResponse {
  version?: string
  metrics?: {
    activePorts?: number
  }
}

interface FleetResponse {
  running?: boolean
  fleets?: Array<{
    running?: boolean
    agents?: Array<{
      running?: boolean
      paused?: boolean
    }>
  }>
}

interface HarborsResponse {
  count?: number
  harbors?: unknown[]
}

function normalizeError(error: unknown): DaemonClientError {
  if (error instanceof DaemonClientError) {
    return error
  }

  if (error instanceof TypeError) {
    return new DaemonClientError({
      kind: 'network',
      message: error.message || 'Network request failed',
      cause: error,
    })
  }

  if (error instanceof DaemonEndpointConfigurationError) {
    return new DaemonClientError({
      kind: 'configuration',
      message: error.message,
      cause: error,
    })
  }

  return new DaemonClientError({
    kind: 'invalid-response',
    message: error instanceof Error ? error.message : 'Unexpected daemon error',
    cause: error,
  })
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown = null

  try {
    body = await response.json()
  } catch (error) {
    throw new DaemonClientError({
      kind: 'invalid-response',
      message: 'Daemon returned an unexpected payload',
      status: response.status,
      cause: error,
    })
  }

  if (!response.ok) {
    throw new DaemonClientError({
      kind: 'http',
      message: `Daemon request failed (${response.status})`,
      status: response.status,
      body,
    })
  }

  return body as T
}

export async function daemonFetchJson<T>(
  path: string,
  options: DaemonFetchJsonOptions = {},
): Promise<T> {
  const { explicitUrl, envUrl, fallbackUrl, location, headers, ...requestInit } = options

  try {
    const response = await fetch(buildDaemonUrl(path, { explicitUrl, envUrl, fallbackUrl, location }), {
      ...requestInit,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    })

    return await readJsonResponse<T>(response)
  } catch (error) {
    throw normalizeError(error)
  }
}

export function createDaemonEventSource(
  path: string,
  options: ResolveDaemonBaseUrlOptions = {},
): EventSource {
  return new EventSource(buildDaemonUrl(path, options))
}

export function createActivityStream(options: ResolveDaemonBaseUrlOptions = {}): EventSource {
  return createDaemonEventSource('/activity/subscribe', options)
}

export function describeDaemonError(error: unknown): { kind: DaemonErrorKind; message: string } {
  const normalized = normalizeError(error)

  if (normalized.kind === 'network') {
    return { kind: normalized.kind, message: 'Cannot reach the local daemon' }
  }

  if (normalized.kind === 'configuration') {
    return {
      kind: normalized.kind,
      message: 'Select a daemon endpoint or open this page from the embedded dashboard',
    }
  }

  if (normalized.kind === 'http') {
    return { kind: normalized.kind, message: 'Daemon request failed' }
  }

  return { kind: normalized.kind, message: 'Daemon returned an unexpected payload' }
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const [health, fleet, harbors] = await Promise.all([
    daemonFetchJson<HealthResponse>('/health'),
    daemonFetchJson<FleetResponse>('/fleet'),
    daemonFetchJson<HarborsResponse>('/harbors'),
  ])

  const fleetAgents =
    fleet.fleets?.flatMap((item) => item.agents ?? []) ?? []

  const activeAgents = fleetAgents.filter((agent) => agent.running || agent.paused).length
  const activeHarbors = harbors.count ?? harbors.harbors?.length ?? 0
  const activePorts = health.metrics?.activePorts ?? 0
  const daemonVersion = health.version ?? 'unknown'
  const fleetRunning = Boolean(fleet.running)

  return {
    activeAgents,
    activeHarbors,
    activePorts,
    daemonVersion,
    fleetRunning,
  }
}

export async function fetchOrchestratorRules(): Promise<OrchestratorRule[]> {
  return daemonFetchJson<OrchestratorRule[]>('/orchestrator/rules')
}

export async function deleteOrchestratorRule(id: number): Promise<void> {
  await daemonFetchJson(`/orchestrator/rules/${id}`, {
    method: 'DELETE',
  })
}

export async function publishMessage(
  channel: string,
  body: Record<string, unknown>,
): Promise<void> {
  await daemonFetchJson(`/msg/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function fetchActivityTimeline(options: {
  limit?: number
  agentId?: string
  sessionId?: string
} = {}): Promise<unknown[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.agentId) params.set('agent', options.agentId)
  if (options.sessionId) params.set('session', options.sessionId)

  const suffix = params.toString()
  return daemonFetchJson<unknown[]>(`/activity/timeline${suffix ? `?${suffix}` : ''}`)
}
