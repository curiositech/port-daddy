const EMBEDDED_CONTROL_PLANE_PREFIX = '/fleet-ui'

type LocationLike = Pick<Location, 'origin' | 'pathname' | 'search'>

export interface ResolveDaemonBaseUrlOptions {
  explicitUrl?: string | null
  envUrl?: string | null
  fallbackUrl?: string
  location?: LocationLike | null
}

/**
 * Thrown when no daemon endpoint can be resolved: no explicit/query/env url,
 * not served by the daemon itself, and no fallback supplied. Callers must
 * surface this to the visitor (or catch it and enter simulation mode) —
 * never silently substitute a guessed loopback address.
 */
export class DaemonEndpointConfigurationError extends Error {
  constructor(message = 'Select a daemon endpoint before opening this page.') {
    super(message)
    this.name = 'DaemonEndpointConfigurationError'
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveQueryOverride(locationLike: LocationLike | null | undefined): string | null {
  if (!locationLike?.search) return null

  const value = new URLSearchParams(locationLike.search).get('daemon')?.trim()
  if (!value || !isValidHttpUrl(value)) return null
  return normalizeBaseUrl(value)
}

function shouldUseSameOrigin(locationLike: LocationLike | null | undefined): boolean {
  if (!locationLike?.origin || !locationLike.pathname) return false
  return locationLike.pathname.startsWith(EMBEDDED_CONTROL_PLANE_PREFIX)
}

export function resolveDaemonBaseUrl(options: ResolveDaemonBaseUrlOptions = {}): string {
  const locationLike = options.location ?? (typeof window !== 'undefined' ? window.location : null)

  const candidates = [
    options.explicitUrl?.trim(),
    resolveQueryOverride(locationLike),
    options.envUrl?.trim() || import.meta.env.VITE_PORT_DADDY_URL?.trim(),
  ]

  for (const candidate of candidates) {
    if (candidate && isValidHttpUrl(candidate)) {
      return normalizeBaseUrl(candidate)
    }
  }

  if (shouldUseSameOrigin(locationLike)) {
    // The daemon serves this page: route with a relative request, never an
    // absolute guess at the daemon's own origin.
    return ''
  }

  const fallback = options.fallbackUrl?.trim()
  if (fallback && isValidHttpUrl(fallback)) {
    return normalizeBaseUrl(fallback)
  }

  throw new DaemonEndpointConfigurationError()
}

export function buildDaemonUrl(
  path: string,
  options: ResolveDaemonBaseUrlOptions = {},
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseUrl = resolveDaemonBaseUrl(options)
  if (!baseUrl) return normalizedPath
  return new URL(normalizedPath.slice(1), `${baseUrl}/`).toString()
}

