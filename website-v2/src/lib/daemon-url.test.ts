import { describe, expect, it } from 'vitest'
import {
  DaemonEndpointConfigurationError,
  buildDaemonUrl,
  resolveDaemonBaseUrl,
} from '@/lib/daemon-url'

describe('daemon url resolution', () => {
  it('prefers an explicit url when provided', () => {
    expect(resolveDaemonBaseUrl({ explicitUrl: 'http://127.0.0.1:9999/' })).toBe('http://127.0.0.1:9999')
  })

  it('prefers the daemon query param over env and fallback', () => {
    const location = {
      origin: 'http://localhost:3144',
      pathname: '/',
      search: '?daemon=http://127.0.0.1:9988',
    }

    expect(resolveDaemonBaseUrl({
      envUrl: 'http://127.0.0.1:7777',
      fallbackUrl: 'http://127.0.0.1:6666',
      location,
    })).toBe('http://127.0.0.1:9988')
  })

  it('uses same-origin when running inside the daemon-hosted fleet ui', () => {
    const location = {
      origin: 'http://127.0.0.1:4321',
      pathname: '/fleet-ui/',
      search: '',
    }

    expect(resolveDaemonBaseUrl({ location })).toBe('')
  })

  it('builds relative same-origin requests inside the daemon-hosted fleet ui', () => {
    const location = {
      origin: 'http://127.0.0.1:4321',
      pathname: '/fleet-ui/dashboard',
      search: '',
    }

    expect(buildDaemonUrl('/activity/subscribe', { location })).toBe('/activity/subscribe')
  })

  it('allows an explicit selected daemon to override an embedded page origin', () => {
    const location = {
      origin: 'http://127.0.0.1:4321',
      pathname: '/fleet-ui/dashboard',
      search: '',
    }

    expect(resolveDaemonBaseUrl({
      explicitUrl: 'http://127.0.0.1:9000',
      location,
    })).toBe('http://127.0.0.1:9000')
  })

  it('fails informatively for standalone browser shells without an endpoint', () => {
    const location = {
      origin: 'http://localhost:3144',
      pathname: '/',
      search: '',
    }

    expect(() => resolveDaemonBaseUrl({ location })).toThrow(DaemonEndpointConfigurationError)
    expect(() => buildDaemonUrl('/activity/subscribe', { location })).toThrow(
      'Select a daemon endpoint before opening this page.',
    )
  })

  it('builds request urls against the resolved daemon base url', () => {
    const location = {
      origin: 'http://localhost:3144',
      pathname: '/',
      search: '?daemon=http://127.0.0.1:9988',
    }

    expect(buildDaemonUrl('/activity/subscribe', { location })).toBe('http://127.0.0.1:9988/activity/subscribe')
  })
})
